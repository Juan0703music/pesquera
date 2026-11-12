import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { defaultIcon, normalize, render, VARIANTS, type Variant } from "./logo-image.js";

const cache = new Map<string, Uint8Array>();

/**
 * Logo de la pesquera. Lo sube el administrador en Ajustes y se usa en el panel, el inicio de sesión,
 * la tienda, el seguimiento del pedido y el ícono de la pestaña. Se guarda una vez normalizado (PNG
 * cuadrado de hasta 1024 px, sin metadatos) y cada tamaño se genera al pedirlo (con caché en memoria).
 * Un logo redondo se recorta en círculo con fondo transparente, así se ve bien sobre fondos oscuros.
 */

/** Direcciones del logo para las pantallas (null si no hay). */
export function logoInfo(settings: { hasLogo: boolean; logoVersion: number }, round: boolean | null) {
  if (!settings.hasLogo) return null;
  const v = `?v=${settings.logoVersion}`;
  return { large: `/media/logo/logo-512.webp${v}`, small: `/media/logo/logo-192.webp${v}`, round: round ?? true };
}

/** Si el logo es redondo (para la forma con que se muestra). */
export async function logoRound() {
  return (await prisma.businessLogo.findUnique({ where: { id: 1 }, select: { round: true } }))?.round ?? null;
}

/* ───────────── Rutas del panel (montadas en /api/v1/settings) ───────────── */
const imageBody = express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "10mb" });
const RoundQuery = z.object({ round: z.enum(["true", "false"]).default("true") });

export const logoRoutes = Router();

logoRoutes.put("/logo", requirePermission("admin.manage"), imageBody, validate({ query: RoundQuery }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest("Sube el logo en PNG, JPG o WebP.", "IMAGE_REQUIRED");
  const round = (req.query as unknown as z.infer<typeof RoundQuery>).round === "true";
  const image = await normalize(req.body);
  const settings = await prisma.$transaction(async (tx) => {
    await tx.businessLogo.upsert({ where: { id: 1 }, create: { id: 1, image, round }, update: { image, round } });
    const current = await tx.setting.findUnique({ where: { id: 1 } });
    if (!current) throw notFound("Primero guarda los datos de la pesquera en Ajustes.");
    return tx.setting.update({ where: { id: 1 }, data: { hasLogo: true, logoVersion: { increment: 1 } } });
  });
  cache.clear();
  live.emit("settings", "logo.updated");
  res.json({ data: { logo: logoInfo(settings, round) } });
});

logoRoutes.patch("/logo", requirePermission("admin.manage"), validate({ body: z.object({ round: z.boolean() }) }), async (req, res) => {
  const { round } = req.body as { round: boolean };
  const updated = await prisma.businessLogo.updateMany({ where: { id: 1 }, data: { round } });
  if (!updated.count) throw notFound("Todavía no hay logo.");
  const settings = await prisma.setting.update({ where: { id: 1 }, data: { logoVersion: { increment: 1 } } });
  cache.clear();
  live.emit("settings", "logo.updated");
  res.json({ data: { logo: logoInfo(settings, round) } });
});

logoRoutes.delete("/logo", requirePermission("admin.manage"), async (_req, res) => {
  await prisma.businessLogo.deleteMany({ where: { id: 1 } });
  await prisma.setting.updateMany({ where: { id: 1 }, data: { hasLogo: false, logoVersion: { increment: 1 } } });
  cache.clear();
  live.emit("settings", "logo.removed");
  res.status(204).end();
});

/* ───────────── Ruta pública de las imágenes (/media/logo/<nombre>) ───────────── */
export const logoMediaRoutes = Router();

logoMediaRoutes.get("/logo/:variant", async (req, res, next) => {
  const variant = req.params.variant as Variant;
  if (!(variant in VARIANTS)) return next();
  const settings = await prisma.setting.findUnique({ where: { id: 1 }, select: { hasLogo: true, logoVersion: true } });
  const isIcon = !variant.startsWith("logo-");
  if (!settings?.hasLogo) {
    if (!isIcon) return res.status(404).set("Cache-Control", "no-store").end();
    const key = `default:${variant}`;
    if (!cache.has(key)) cache.set(key, await defaultIcon(variant));
    return res.set("Cache-Control", "public, max-age=300").type("png").send(cache.get(key));
  }
  const key = `${settings.logoVersion}:${variant}`;
  if (!cache.has(key)) {
    const logo = await prisma.businessLogo.findUnique({ where: { id: 1 } });
    if (!logo) return res.status(404).set("Cache-Control", "no-store").end();
    cache.set(key, await render(logo.image, logo.round, variant));
  }
  // Con ?v= la dirección nunca vuelve a servir otro logo: se guarda un año. El ícono de la pestaña va sin versión.
  res.set("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300");
  res.type(VARIANTS[variant].format === "webp" ? "image/webp" : "png").send(cache.get(key));
});
