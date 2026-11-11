// Marea — service worker: avisos al celular (Web Push) y pantalla «Sin conexión».
// No guarda datos del negocio: el panel siempre pide la información al servidor.

const CACHE = "marea-v1";
const OFFLINE_URL = "/sin-conexion";
const PRECACHE = [OFFLINE_URL, "/css/app.css", "/js/theme.js", "/js/sin-conexion.js", "/media/logo/icon-192.png", "/media/logo/icon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pantallas: siempre del servidor; sin red, la pantalla «Sin conexión» (que vuelve sola al reconectar).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  // Lo que necesita la pantalla «Sin conexión»: de la red y, si no hay, de la copia.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(url.pathname)) ?? Response.error()));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Marea", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Marea", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/media/logo/icon-192.png",
      badge: "/icons/badge-96.png",
      vibrate: [180, 80, 180],
      data: { url: data.url || "/app/pedidos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/app/pedidos", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const panel = windows.find((client) => new URL(client.url).pathname.startsWith("/app/"));
      if (panel) {
        await panel.focus();
        return panel.navigate(target.href).catch(() => undefined);
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

// El navegador renovó la suscripción: se le avisa al servidor (con la sesión de este equipo).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/api/v1/push", { credentials: "same-origin" });
      if (!res.ok) return;
      const { data } = await res.json();
      const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: data.publicKey });
      await fetch("/api/v1/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
    })(),
  );
});
