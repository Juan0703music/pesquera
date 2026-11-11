import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import sharp from "sharp";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";

/**
 * Marea como app instalada: en Android (la app de la tienda de apps o «Instalar» de Chrome) y en el
 * computador. Aquí van el manifiesto, el service worker (avisos y pantalla sin conexión), el ícono
 * pequeño de las notificaciones y la verificación que pide Android para abrir el panel sin barra de
 * direcciones (Digital Asset Links).
 */
export const pwaRoutes = Router();

const publicDir = fileURLToPath(new URL("../../../public", import.meta.url));

/** Colores del menú «mar profundo»: barra de estado y fondo mientras abre la app. */
export const APP_COLORS = { theme: "#062130", background: "#062130" };

pwaRoutes.get("/manifest.webmanifest", async (_req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: 1 }, select: { businessName: true, logoVersion: true } });
  const name = settings?.businessName?.trim() || "Marea";
  const v = `?v=${settings?.logoVersion ?? 0}`;
  res
    .type("application/manifest+json")
    .set("Cache-Control", "public, max-age=300")
    .send(
      JSON.stringify({
        id: "/app/pedidos",
        name,
        short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
        description: "Pedidos, despacho, inventario y ventas de la pesquera, en vivo.",
        lang: "es-CO",
        dir: "ltr",
        start_url: "/app/pedidos",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: APP_COLORS.theme,
        background_color: APP_COLORS.background,
        icons: [
          { src: `/media/logo/icon-192.png${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `/media/logo/icon-512.png${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `/media/logo/maskable-512.png${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Pedidos", url: "/app/pedidos" },
          { name: "Inventario", url: "/app/inventario" },
          { name: "Ventas del día", url: "/app/ventas" },
        ],
      }),
    );
});

// El service worker se revisa en cada visita: así una versión nueva llega enseguida.
pwaRoutes.get("/sw.js", (_req, res) => {
  res.set({ "Cache-Control": "no-cache", "Content-Type": "text/javascript; charset=utf-8" }).sendFile(path.join(publicDir, "sw.js"));
});

pwaRoutes.get("/sin-conexion", (_req, res) => {
  res.set("Cache-Control", "no-cache").sendFile(path.join(publicDir, "pages/sin-conexion.html"));
});

/** Ícono pequeño de las notificaciones en Android: silueta blanca de las olas sobre transparente. */
let badge: Buffer | null = null;
pwaRoutes.get("/icons/badge-96.png", async (_req, res) => {
  badge ??= await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24">
      <g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round">
        <path d="M2 15c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/><path d="M2 10c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/><path d="M2 20c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/>
      </g></svg>`),
  )
    .png()
    .toBuffer();
  res.set("Cache-Control", "public, max-age=604800").type("png").send(badge);
});

/**
 * Digital Asset Links: le confirma a Android que la app firmada con esta llave es de este sitio.
 * Con eso la app abre el panel a pantalla completa (sin barra de direcciones) y recibe los avisos.
 */
pwaRoutes.get("/.well-known/assetlinks.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600").json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: env.ANDROID_PACKAGE, sha256_cert_fingerprints: env.ANDROID_CERT_SHA256 },
    },
  ]);
});
