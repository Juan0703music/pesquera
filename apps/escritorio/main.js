// Marea para Windows: el panel de la pesquera en su propia ventana.
//
// - Se conecta a la nube de Marea (Railway + Supabase). La dirección viene dentro del instalador
//   (servidor.json, la escribe GitHub al construirlo): quien lo instala solo abre Marea y entra con su
//   cuenta. Los datos viven en la nube: este programa no guarda nada del negocio, solo la sesión.
// - Al cerrar la ventana queda en la bandeja del sistema, conectado en vivo: suena y muestra un aviso de
//   Windows con cada pedido nuevo. Arranca solo con Windows (se puede apagar en el menú de la bandeja).
// - Sin internet muestra «Sin conexión» y vuelve sola al panel cuando el servidor responde.
"use strict";

const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, net, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ID = "io.github.juan0703music.marea";
const ICON = path.join(__dirname, "recursos", "icono.png");
const PAGES = path.join(__dirname, "paginas");
const ALLOWED_PERMISSIONS = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.setAppUserModelId(APP_ID);

/* ───────────── Preferencias (carpeta de datos de la app) ───────────── */
const configFile = () => path.join(app.getPath("userData"), "marea.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
  return next;
}

/** Solo https (o http en este mismo equipo, para pruebas). Devuelve el origen o "" si no sirve. */
function normalizeServer(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return url.protocol === "https:" || local ? url.origin : "";
  } catch {
    return "";
  }
}

/** Dirección de la nube con que se construyó el instalador (servidor.json). */
function bakedServer() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "servidor.json"), "utf8")).url ?? "";
  } catch {
    return "";
  }
}

// MAREA_SERVIDOR solo sirve para probar el programa en desarrollo; el instalador usa servidor.json.
const serverUrl = () => normalizeServer(process.env.MAREA_SERVIDOR || bakedServer());
const sameOrigin = (url) => {
  try {
    return new URL(url).origin === serverUrl();
  } catch {
    return false;
  }
};
const PAGES_URL = `${pathToFileURL(PAGES).href}/`;
/** Pantallas propias del programa («Sin conexión»), nunca otros archivos del equipo. */
const isOwnPage = (url) => {
  try {
    return new URL(url).href.toLowerCase().startsWith(PAGES_URL.toLowerCase());
  } catch {
    return false;
  }
};

/* ───────────── Ventana ───────────── */
let win = null;
let tray = null;
let quitting = false;
let openCount = 0;

function loadPanel() {
  const server = serverUrl();
  // Un instalador sin dirección (solo los de ensayo) muestra el aviso en vez de preguntarla.
  if (!server) return showOffline("");
  return win.loadURL(`${server}/app/pedidos`);
}

function showOffline(failedUrl) {
  win.loadFile(path.join(PAGES, "sin-conexion.html"), { query: { servidor: serverUrl(), volver: failedUrl || "" } });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  writeConfig({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
}

function createWindow({ hidden }) {
  const saved = readConfig().window ?? {};
  win = new BrowserWindow({
    width: saved.width ?? 1360,
    height: saved.height ?? 860,
    x: saved.x,
    y: saved.y,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "Marea",
    icon: ICON,
    backgroundColor: "#062130",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      // Conectado y sonando aunque la ventana esté escondida en la bandeja.
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (saved.maximized) win.maximize();
  win.once("ready-to-show", () => {
    if (!hidden) win.show();
  });

  // Cerrar la ventana la esconde: Marea sigue en la bandeja avisando de los pedidos.
  win.on("close", (event) => {
    saveBounds();
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (!readConfig().trayNoticeShown && Notification.isSupported()) {
      new Notification({ title: "Marea sigue abierta", body: "Te avisa de cada pedido nuevo desde la bandeja del sistema. Para cerrarla del todo: clic derecho en el ícono → Salir.", icon: ICON }).show();
      writeConfig({ trayNoticeShown: true });
    }
  });
  let boundsTimer;
  for (const eventName of ["resize", "move"]) {
    win.on(eventName, () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(saveBounds, 800);
    });
  }
  win.on("focus", () => win.flashFrame(false));

  const contents = win.webContents;
  // Solo se navega dentro del servidor de Marea y de las pantallas propias; lo demás, al navegador.
  contents.on("will-navigate", (event, url) => {
    if (sameOrigin(url) || isOwnPage(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    // -3: navegación cancelada (no es un error de red).
    if (isMainFrame && code !== -3 && !url.startsWith("file://")) showOffline(url);
  });
  contents.on("render-process-gone", () => setTimeout(loadPanel, 1000));
  contents.on("page-title-updated", () => updateTray());

  loadPanel();
}

function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (["https:", "http:", "mailto:", "tel:"].includes(protocol)) shell.openExternal(url);
  } catch {
    // Dirección inválida: se ignora.
  }
}

/* ───────────── Bandeja del sistema ───────────── */
function autoStartEnabled() {
  return app.getLoginItemSettings({ args: ["--oculto"] }).openAtLogin;
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ["--oculto"] });
  writeConfig({ autoStart: enabled });
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(openCount > 0 ? `Marea · ${openCount} ${openCount === 1 ? "pedido abierto" : "pedidos abiertos"}` : "Marea");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir Marea", click: showWindow },
      { type: "separator" },
      { label: "Iniciar con Windows", type: "checkbox", checked: autoStartEnabled(), click: (item) => setAutoStart(item.checked) },
      { type: "separator" },
      {
        label: "Salir de Marea",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  updateTray();
}

/* ───────────── Mensajes de las pantallas (preload.js) ───────────── */
const fromOwnPage = (event) => isOwnPage(event.senderFrame?.url ?? "");

ipcMain.on("marea:mostrar", showWindow);
ipcMain.on("marea:atencion", () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});
ipcMain.on("marea:pedidos-abiertos", (_event, count) => {
  openCount = Math.max(0, Math.floor(Number(count) || 0));
  updateTray();
});
ipcMain.handle("marea:info", () => ({ version: app.getVersion(), servidor: serverUrl() }));

/** ¿Ya responde la nube? (la pantalla «Sin conexión» lo pregunta cada 5 segundos). */
ipcMain.handle("marea:comprobar", async (event) => {
  const server = serverUrl();
  if (!fromOwnPage(event) || !server) return { ok: false };
  try {
    const res = await net.fetch(`${server}/api/v1/health`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok && body?.data?.status === "ok" };
  } catch {
    return { ok: false };
  }
});

ipcMain.on("marea:reintentar", (event) => {
  if (fromOwnPage(event)) loadPanel();
});

/* ───────────── Arranque ───────────── */
app.on("second-instance", showWindow);
app.on("before-quit", () => {
  quitting = true;
});

app.whenReady().then(() => {
  // Permisos: solo avisos, copiar al portapapeles y pantalla completa (modo pantalla de «En vivo 3D»).
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && (sameOrigin(details.requestingUrl) || isOwnPage(details.requestingUrl)));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));

  // Atajos de siempre (F5, Ctrl + rueda, F11) sin barra de menú visible.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Ver",
        submenu: [
          { role: "reload", label: "Recargar" },
          { role: "forceReload", label: "Recargar sin caché" },
          { role: "toggleDevTools", label: "Herramientas de desarrollo" },
          { type: "separator" },
          { role: "resetZoom", label: "Tamaño normal" },
          { role: "zoomIn", label: "Ampliar" },
          { role: "zoomOut", label: "Reducir" },
          { type: "separator" },
          { role: "togglefullscreen", label: "Pantalla completa" },
        ],
      },
    ]),
  );

  // La primera vez queda activado «Iniciar con Windows»: los avisos llegan desde que se prende el equipo.
  if (readConfig().autoStart === undefined) setAutoStart(true);

  createWindow({ hidden: process.argv.includes("--oculto") });
  createTray();
});

// Con la ventana cerrada, Marea sigue en la bandeja (solo «Salir» la cierra).
app.on("window-all-closed", () => {});
