/**
 * Marea en el navegador: este service worker es el «servidor».
 *
 * - Guarda las pantallas para que abran sin internet.
 * - Abre la base de datos (PostgreSQL en WebAssembly, guardado en el navegador) y atiende /api/v1 y /media
 *   con las mismas rutas de Marea.
 * - Solo una copia de la base puede estar abierta: un candado (Web Locks) evita que dos versiones del
 *   service worker la abran a la vez durante una actualización.
 */
import { atender } from "./api.js";
import { abrirBase, esperarCambio } from "./db.js";

declare const self: ServiceWorkerGlobalScope;
declare const __MAREA_VERSION__: string;
declare const __MAREA_ARCHIVOS__: string[];
declare const __MAREA_MOTOR__: { version: string; archivos: string[] };

const BASE = new URL(self.registration.scope).pathname; // p. ej. «/pesquera/»
const CACHE_APP = `marea-app-${__MAREA_VERSION__}`;
const CACHE_MOTOR = `marea-motor-${__MAREA_MOTOR__.version}`;

/* ───────────── Instalación: guarda las pantallas y el motor de la base ───────────── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const app = await caches.open(CACHE_APP);
      await app.addAll(__MAREA_ARCHIVOS__.map((archivo) => BASE + archivo));
      const motor = await caches.open(CACHE_MOTOR);
      for (const archivo of __MAREA_MOTOR__.archivos) {
        if (!(await motor.match(BASE + archivo))) await motor.add(BASE + archivo);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) {
        if (nombre.startsWith("marea-") && ![CACHE_APP, CACHE_MOTOR, AJUSTES].includes(nombre)) await caches.delete(nombre);
      }
      await self.clients.claim();
    })(),
  );
});

/* ───────────── Base de datos ───────────── */
async function recurso(archivo: string) {
  const respuesta = (await caches.match(BASE + archivo)) ?? (await fetch(BASE + archivo));
  if (!respuesta.ok) throw new Error(`No se pudo cargar ${archivo} (${respuesta.status}).`);
  return respuesta;
}

/**
 * Qué base está en uso. Al restaurar una copia se pasa a una base nueva («idb://marea-<fecha>») y la ubicación
 * se guarda aquí, en el almacenamiento del service worker.
 */
const AJUSTES = "marea-ajustes";
const CLAVE_UBICACION = `${BASE}__base-actual`;

async function leerUbicacion() {
  const guardada = await (await caches.open(AJUSTES)).match(CLAVE_UBICACION);
  return (guardada && (await guardada.text())) || "idb://marea";
}

async function guardarUbicacion(ubicacion: string | undefined) {
  if (ubicacion) await (await caches.open(AJUSTES)).put(CLAVE_UBICACION, new Response(ubicacion));
}

/** Borra las bases que quedaron de restauraciones anteriores (nadie las tiene abiertas al arrancar). */
async function limpiarBasesViejas(actual: string) {
  if (!("databases" in indexedDB)) return;
  const nombre = actual.slice("idb://".length);
  for (const db of await indexedDB.databases()) {
    if (db.name && /^\/pglite\/marea(-\d+)?$/.test(db.name) && db.name !== `/pglite/${nombre}`) indexedDB.deleteDatabase(db.name);
  }
}

let lista: Promise<void> | null = null;

function baseLista() {
  lista ??= (async () => {
    // El candado se queda tomado mientras viva este service worker.
    await new Promise<void>((concedido) => {
      void navigator.locks.request("marea-base", () => {
        concedido();
        return new Promise(() => {});
      });
    });
    const [pglite, initdb, prismaWasm, datos] = await Promise.all([
      recurso("motor/pglite.wasm").then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
      recurso("motor/initdb.wasm").then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
      recurso("motor/prisma.wasm").then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
      recurso("motor/pglite.data").then((r) => r.blob()),
    ]);
    (globalThis as { __mareaCompiladorPrisma?: WebAssembly.Module }).__mareaCompiladorPrisma = prismaWasm;
    const ubicacion = await leerUbicacion();
    await abrirBase(ubicacion, { pgliteWasmModule: pglite, initdbWasmModule: initdb, fsBundle: datos }, { alCambiar: guardarUbicacion });
    void limpiarBasesViejas(ubicacion);
  })().catch((error) => {
    lista = null;
    throw error;
  });
  return lista;
}

/* ───────────── Peticiones ───────────── */
function archivoDePagina(ruta: string) {
  const limpia = ruta.replace(/\/+$/, "") || "/";
  if (limpia === "/") return "index.html";
  return limpia.endsWith(".html") ? limpia.slice(1) : `${limpia.slice(1)}.html`;
}

async function pagina(request: Request, ruta: string) {
  const guardada = await caches.match(BASE + archivoDePagina(ruta));
  if (guardada) return guardada;
  try {
    const red = await fetch(request);
    if (red.status !== 404) return red;
  } catch {
    // Sin red: abajo se muestra la página de «no existe».
  }
  return (await caches.match(`${BASE}404.html`)) ?? new Response("No encontrada", { status: 404 });
}

async function datos(request: Request, ruta: string) {
  try {
    await baseLista();
    await esperarCambio();
    return (await atender(request, ruta, BASE)) ?? new Response(null, { status: 404 });
  } catch (error) {
    console.error("[Marea]", error);
    return new Response(JSON.stringify({ error: { code: "DB_UNAVAILABLE", message: "No se pudo abrir la base de datos de este navegador. Recarga la página." } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  const ruta = `/${url.pathname.slice(BASE.length)}`;

  if (ruta.startsWith("/api/v1/") || ruta.startsWith("/media/")) {
    event.respondWith(datos(event.request, ruta));
    return;
  }
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(pagina(event.request, ruta));
    return;
  }
  event.respondWith((async () => (await caches.match(event.request, { ignoreSearch: true })) ?? fetch(event.request))());
});

/* ───────────── Mensajes de las pantallas ───────────── */
self.addEventListener("message", (event) => {
  // «latido»: las pantallas abiertas lo mandan cada 20 s para que el navegador no duerma la base.
  if (event.data === "abrir-base") event.waitUntil(baseLista().catch(() => undefined));
});
