// Núcleo del panel: API, formatos, iconos, avisos, menú según el rol y conexión en vivo.

/* ───────────── Iconos (trazos de 24 × 24) ───────────── */
const PATHS = {
  wave: '<path d="M2 15c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/><path d="M2 10c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/><path d="M2 20c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/>',
  orders: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c-.4-2.6-1.9-4.4-4-5.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  store: '<path d="M3 9 5 4h14l2 5"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 13v7h14v-7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
  counter: '<path d="M3 10h18M5 10v10h14V10M8 6h8l2 4H6z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  bag: '<path d="M6 7h12l1 13H5z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  scale: '<path d="M12 3v18M5 21h14M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0zM4 8h16"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  fish: '<path d="M2 12c3-5 9-6 14-3l5-3-1 6 1 6-5-3c-5 3-11 2-14-3z"/><circle cx="7" cy="11" r=".8"/>',
  shrimp: '<path d="M20 6c-6-2-13 1-14 7-.5 3 1 5 3 6"/><path d="M20 6c-1 4-4 7-8 8M9 19l-2 2M12 14l-2 4M16 11l-2 3"/>',
  fillet: '<path d="M3 15c2-6 8-9 15-8 2 .3 3 2 2 3.5C18 15 11 18 5 18c-1.5 0-2.5-1.5-2-3z"/><path d="M8 11l3 4M12 9l3 4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
};

export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;
}

/* ───────────── Utilidades ───────────── */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numFormat = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });

export const fmt = {
  cop: (value) => copFormat.format(value ?? 0),
  /** $1,2 M — para ejes y etiquetas cortas. */
  copShort: (value) => `$${compactFormat.format(value ?? 0)}`,
  num: (value) => numFormat.format(value ?? 0),
  /** 1500, "KG" → "1,5 kg" */
  qty: (milli, unit) => `${numFormat.format((milli ?? 0) / 1000)} ${unit === "KG" ? "kg" : "und"}`,
  unitLabel: (unit) => (unit === "KG" ? "kg" : "und"),
  time: (date) => new Date(date).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" }),
  dateTime: (date) => new Date(date).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
  /** Minutos transcurridos: «hace 12 min», «hace 1 h 5 min». */
  ago: (date) => {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
    if (minutes < 1) return "ahora";
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  },
  minutesSince: (date) => (Date.now() - new Date(date).getTime()) / 60000,
};

export const LABELS = {
  source: { MOSTRADOR: "Mostrador", TELEFONO: "Llamada", WHATSAPP: "WhatsApp", WEB: "Tienda en línea" },
  sourceIcon: { MOSTRADOR: "counter", TELEFONO: "phone", WHATSAPP: "chat", WEB: "globe" },
  delivery: { RECOGE: "Recoge", DOMICILIO: "Domicilio" },
  payment: { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", NEQUI: "Nequi", BRE_B: "Llave Bre-B", DATAFONO: "Datáfono", CREDITO: "Crédito" },
  status: { RECIBIDO: "Recibido", ALISTANDO: "Alistando", LISTO: "Listo", DESPACHADO: "En camino", ENTREGADO: "Entregado", CANCELADO: "Cancelado" },
  movement: { ENTRADA: "Entrada", SALIDA_PEDIDO: "Salida por pedido", DEVOLUCION: "Devolución", AJUSTE: "Conteo (ajuste)", MERMA: "Merma" },
  level: { OK: "Bien", BAJO: "Stock bajo", AGOTADO: "Agotado" },
};

/** Nivel de existencia → insignia de estado con icono y texto (nunca solo color). */
export function levelBadge(level) {
  if (level === "AGOTADO") return `<span class="badge badge-critical">${icon("ban")}Agotado</span>`;
  if (level === "BAJO") return `<span class="badge badge-warning">${icon("alert")}Stock bajo</span>`;
  return `<span class="badge badge-good">${icon("checkCircle")}Bien</span>`;
}

/* ───────────── Tema claro / oscuro ───────────── */
const THEME_KEY = "marea-tema";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

/** Tema que se ve ahora: el elegido por la persona o, si no eligió, el del equipo. */
export function effectiveTheme() {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return darkQuery.matches ? "dark" : "light";
}

function syncThemeButtons() {
  const current = effectiveTheme();
  $$("[data-theme-set]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.themeSet === current)));
}

/** Cambia el tema, lo recuerda en este navegador y avisa a las gráficas para que se repinten. */
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Sin almacenamiento: el cambio dura mientras la página esté abierta.
  }
  syncThemeButtons();
  window.dispatchEvent(new CustomEvent("marea:tema", { detail: { theme } }));
}

/** Botones Claro / Oscuro: «switch» con texto (menú) o «toggle» solo con iconos (entrada y tienda). */
export function themeControl(variant = "toggle") {
  const current = effectiveTheme();
  const button = (theme, iconName, label) => {
    const named = variant === "toggle" ? ` aria-label="Tema ${label.toLowerCase()}" title="Tema ${label.toLowerCase()}"` : "";
    const text = variant === "switch" ? `<span>${label}</span>` : "";
    return `<button type="button" data-theme-set="${theme}" aria-pressed="${current === theme}"${named}>${icon(iconName)}${text}</button>`;
  };
  const cls = variant === "switch" ? "theme-switch" : "theme-toggle";
  return `<div class="${cls}" role="group" aria-label="Tema de la pantalla">${button("light", "sun", "Claro")}${button("dark", "moon", "Oscuro")}</div>`;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-set]");
  if (button) setTheme(button.dataset.themeSet);
});
darkQuery.addEventListener("change", () => {
  // Solo importa si la persona no eligió: entonces la página sigue al equipo.
  if (document.documentElement.dataset.theme) return;
  syncThemeButtons();
  window.dispatchEvent(new CustomEvent("marea:tema", { detail: { theme: effectiveTheme() } }));
});

/** Olas del menú (decorativas): cinco líneas de marea con desfase. */
function sidebarWaves() {
  const paths = [24, 54, 84, 114, 144].map((y, index) => {
    const lift = y - 14 + (index % 2) * 6;
    return `<path d="M-10 ${y} C 30 ${lift}, 70 ${y + 14}, 125 ${y} S 215 ${y - 14}, 270 ${y}" opacity="${(1 - index * 0.14).toFixed(2)}"/>`;
  });
  return `<svg class="sidebar-waves" viewBox="0 0 260 180" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">${paths.join("")}</g></svg>`;
}

/**
 * Logo de la pesquera como imagen (medallón si es redondo). `logo` viene de la API: { large, small, round }.
 * Si no hay logo, quien llama muestra la ola de Marea.
 */
export function logoImg(logo, cls = "", size = "small", name = "") {
  return `<img class="${cls} logo-img${logo.round ? " is-round" : ""}" src="${logo[size]}" alt="${name ? `Logo de ${esc(name)}` : "Logo"}" decoding="async" />`;
}

/* ───────────── API ───────────── */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? "No se pudo completar la acción.");
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { message: "Sin conexión con el servidor. Revisa la red e intenta de nuevo." } });
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    location.href = `/login?volver=${encodeURIComponent(location.pathname)}`;
    throw new ApiError(401, json);
  }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

/* ───────────── Avisos ───────────── */
function toastHost() {
  let host = $(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  return host;
}

export function toast(message, { detail = "", error = false, iconName, timeout = 4200 } = {}) {
  const node = document.createElement("div");
  node.className = `toast${error ? " toast-error" : ""}`;
  node.innerHTML = `${icon(iconName ?? (error ? "alert" : "checkCircle"))}<div>${esc(message)}${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
  toastHost().append(node);
  setTimeout(() => node.remove(), timeout);
}

export function showError(error) {
  toast(error instanceof ApiError ? error.message : "Ocurrió un error inesperado.", { error: true });
}

/** Marca los campos con error devueltos por la API (`fields`) dentro de un formulario. */
export function showFieldErrors(form, error) {
  $$(".field-error", form).forEach((node) => node.remove());
  $$("[aria-invalid]", form).forEach((node) => node.removeAttribute("aria-invalid"));
  if (!(error instanceof ApiError) || !error.fields) return false;
  let shown = false;
  for (const [name, message] of Object.entries(error.fields)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) continue;
    input.setAttribute("aria-invalid", "true");
    const note = document.createElement("span");
    note.className = "field-error";
    note.textContent = message;
    input.closest(".field")?.append(note);
    shown = true;
  }
  return shown;
}

/** Sonido corto para pedidos nuevos (sin archivos de audio). */
let audio;
export function chime() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    for (const [index, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + index * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.14 + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + index * 0.14);
      osc.stop(now + index * 0.14 + 0.32);
    }
  } catch {
    // Sin audio disponible: el aviso visual basta.
  }
}

/* ───────────── Diálogos ───────────── */
export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  dialog.addEventListener(
    "click",
    (event) => {
      if (event.target === dialog) dialog.close();
    },
    { once: false },
  );
}

/* ───────────── Menú y sesión ───────────── */
const NAV = [
  { href: "/app/pedidos", label: "Pedidos", icon: "orders", permission: "orders.view", id: "pedidos" },
  { href: "/app/inventario", label: "Inventario", icon: "box", permission: "inventory.view", id: "inventario" },
  { href: "/app/ventas", label: "Ventas del día", icon: "cash", permission: "sales.view", id: "ventas" },
  { href: "/app/en-vivo", label: "En vivo 3D", icon: "pulse", permission: "analytics.view", id: "en-vivo" },
  { sep: true },
  { href: "/app/personal", label: "Personal", icon: "users", permission: "admin.manage", id: "personal" },
  { href: "/app/cobros", label: "Cuentas de cobro", icon: "qr", permission: "admin.manage", id: "cobros" },
  { href: "/app/ajustes", label: "Ajustes", icon: "settings", permission: "admin.manage", id: "ajustes" },
  { href: "/tienda", label: "Ver tienda", icon: "store", id: "tienda", external: true },
];

export const session = { user: null, permissions: [], businessName: "" };
export const can = (permission) => session.permissions.includes(permission);

/**
 * Pinta el menú lateral y carga la sesión. Si la persona no tiene permiso para esta pantalla,
 * la lleva a la primera que sí puede ver.
 */
export async function startShell(pageId, permission) {
  const { data } = await api("/auth/me");
  Object.assign(session, data);
  if (permission && !can(permission)) {
    const first = NAV.find((item) => item.permission && can(item.permission));
    location.replace(first?.href ?? "/login");
    return new Promise(() => {});
  }
  const initials = data.user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const sidebar = $(".sidebar");
  sidebar.innerHTML = `${sidebarWaves()}
    <a class="brand${data.logo ? " has-logo" : ""}" href="/app/pedidos" aria-label="${esc(data.businessName)} — inicio del panel">
      ${data.logo ? logoImg(data.logo, "brand-logo", "small", data.businessName) : `<span class="brand-mark">${icon("wave")}</span>`}
      <span class="brand-text"><span class="brand-name">${esc(data.businessName)}</span><span class="brand-business">Panel · Marea</span></span>
    </a>
    <nav class="nav" aria-label="Secciones">
      ${NAV.filter((item) => item.sep || !item.permission || can(item.permission))
        .map((item) =>
          item.sep
            ? '<div class="nav-sep" role="separator"></div>'
            : `<a href="${item.href}" ${item.id === pageId ? 'aria-current="page"' : ""} ${item.external ? 'target="_blank" rel="noopener"' : ""}>${icon(item.icon)}<span>${item.label}</span>${item.id === "pedidos" ? '<span class="badge badge-count" id="nav-open-count" hidden></span>' : ""}${item.id === "personal" ? '<span class="badge badge-count" id="nav-pending" title="Solicitudes de acceso por aprobar" hidden></span>' : ""}</a>`,
        )
        .join("")}
    </nav>
    ${themeControl("switch")}
    <div class="sidebar-foot">
      <span class="avatar" aria-hidden="true">${esc(initials)}</span>
      <span class="who"><strong>${esc(data.user.name)}</strong><span>${esc(data.user.roleLabel)}</span></span>
      <button class="btn btn-ghost btn-icon" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon("logout")}</button>
    </div>`;
  $("#logout").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  });
  document.title = `${document.title.split(" · ")[0]} · ${data.businessName}`;
  setPendingCount(data.pendingApprovals);
  return data;
}

/** Solicitudes de acceso por aprobar (solo el administrador las ve). */
export function setPendingCount(count) {
  const badge = $("#nav-pending");
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = String(count ?? 0);
}

/** Contador de pedidos abiertos en el menú. */
export function setOpenCount(count) {
  const badge = $("#nav-open-count");
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = String(count);
}

/* ───────────── Tiempo real ───────────── */
/**
 * Conecta con Socket.IO (cliente servido por el propio servidor en /socket.io/socket.io.min.js).
 * `onChange` recibe cada aviso; `pill` es el indicador «En vivo» de la página.
 */
export function connectLive(onChange, pill = $("#live-pill")) {
  const setState = (state, text) => {
    if (!pill) return;
    pill.dataset.state = state;
    pill.querySelector("span:last-child").textContent = text;
  };
  if (typeof window.io !== "function") {
    setState("off", "Sin conexión en vivo");
    return null;
  }
  const socket = window.io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => setState("on", "En vivo"));
  socket.on("disconnect", () => setState("off", "Reconectando…"));
  socket.on("connect_error", (error) => {
    if (error.message === "UNAUTHORIZED") location.href = "/login";
    setState("off", "Reconectando…");
  });
  socket.on("change", (event) => {
    // Alguien se registró o cambió una cuenta: el administrador lo ve en cualquier pantalla.
    if (event.scope === "users" && can("admin.manage")) {
      if (event.kind === "user.requested") toast("Nueva solicitud de acceso", { detail: `${event.data?.name ?? ""} · ${event.data?.role ?? ""}. Apruébala en «Personal».`, iconName: "users", timeout: 8000 });
      api("/auth/me").then(({ data }) => setPendingCount(data.pendingApprovals)).catch(() => {});
    }
    onChange(event);
  });
  // Al volver a conectarse, la pantalla se pone al día (pudo perderse algún aviso).
  socket.io.on("reconnect", () => onChange({ scope: "all", kind: "reconnect" }));
  return socket;
}

/** Ejecuta `fn` como mucho una vez cada `wait` ms (agrupa ráfagas de avisos). */
export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
