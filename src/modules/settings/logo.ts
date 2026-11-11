import express, { Router } from "express";
import sharp from "sharp";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { AppError, badRequest, notFound } from "../../utils/errors.js";

/**
 * Logo de la pesquera. Lo sube el administrador en Ajustes y se usa en el panel, el inicio de sesión,
 * la tienda, el seguimiento del pedido y el ícono de la pestaña. Se guarda una vez normalizado (PNG
 * cuadrado de hasta 1024 px, sin metadatos) y cada tamaño se genera al pedirlo (con caché en memoria).
 * Un logo redondo se recorta en círculo con fondo transparente, así se ve bien sobre fondos oscuros.
 */

const MIN_SIDE = 128;

/** Tamaños que se sirven en /media/logo/<nombre>. */
const VARIANTS = {
  "logo-512.webp": { size: 512, format: "webp", padded: false },
  "logo-192.webp": { size: 192, format: "webp", padded: false },
  "icon-32.png": { size: 32, format: "png", padded: false },
  "icon-192.png": { size: 192, format: "png", padded: false },
  "icon-512.png": { size: 512, format: "png", padded: false },
  // Ícono para guardar la tienda en la pantalla del celular: cuadrado, sin transparencia (el sistema lo recorta).
  "apple-180.png": { size: 180, format: "png", padded: true },
  // Ícono de la app instalada (Android lo recorta en círculo, gota o cuadrado): fondo completo y el logo
  // dentro de la zona segura (el círculo central del 80 %).
  "maskable-512.png": { size: 512, format: "png", padded: true },
} as const;
type Variant = keyof typeof VARIANTS;

const cache = new Map<string, Buffer>();

async function normalize(input: Buffer) {
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: 60_000_000 }).metadata();
  } catch {
    throw new AppError(415, "INVALID_IMAGE", "No pudimos abrir esa imagen. Sube el logo en PNG, JPG o WebP.");
  }
  if (!meta.width || !meta.height) throw new AppError(415, "INVALID_IMAGE", "No pudimos abrir esa imagen. Sube el logo en PNG, JPG o WebP.");
  if (Math.min(meta.width, meta.height) < MIN_SIDE) {
    throw new AppError(422, "LOGO_TOO_SMALL", `El logo es muy pequeño (${meta.width} × ${meta.height}). Usa uno de al menos ${MIN_SIDE} píxeles por lado.`);
  }
  // Cuadrado: si no lo es, se centra sobre fondo transparente.
  return sharp(input, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 }, withoutEnlargement: false })
    .png()
    .toBuffer();
}

const circleMask = (size: number) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

async function render(image: Buffer, round: boolean, variant: Variant) {
  const { size, format, padded } = VARIANTS[variant];
  if (padded) {
    const maskable = variant.startsWith("maskable-");
    // En el ícono «maskable» un logo cuadrado debe caber en el círculo seguro (80 % ⇒ 56 % de lado).
    const inner = Math.round(size * (maskable ? (round ? 0.74 : 0.56) : 0.86));
    let logo = sharp(image).resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } });
    if (round) logo = sharp(await logo.png().toBuffer()).composite([{ input: circleMask(inner), blend: "dest-in" }]);
    return sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } })
      .composite([{ input: await logo.png().toBuffer(), gravity: "center" }])
      .png()
      .toBuffer();
  }
  let pipeline = sharp(image).resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).ensureAlpha();
  if (round) pipeline = sharp(await pipeline.png().toBuffer()).composite([{ input: circleMask(size), blend: "dest-in" }]);
  return format === "webp" ? pipeline.webp({ quality: 88, alphaQuality: 100 }).toBuffer() : pipeline.png().toBuffer();
}

/** Ícono de Marea (la ola) para la pestaña cuando la pesquera aún no tiene logo. */
async function defaultIcon(variant: Variant) {
  const { size } = VARIANTS[variant];
  // El ícono «maskable» va a sangre (sin esquinas redondas): el sistema le pone la forma.
  const radius = variant.startsWith("maskable-") ? 0 : 15;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fd6e8"/><stop offset=".55" stop-color="#0b8fb0"/><stop offset="1" stop-color="#0b5f7a"/></linearGradient></defs>
    <rect width="64" height="64" rx="${radius}" fill="url(#g)"/>
    <g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round">
      <path d="M12 26c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5"/><path d="M12 36c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5"/><path d="M12 46c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5"/>
    </g></svg>`;
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

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
    cache.set(key, await render(Buffer.from(logo.image), logo.round, variant));
  }
  // Con ?v= la dirección nunca vuelve a servir otro logo: se guarda un año. El ícono de la pestaña va sin versión.
  res.set("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300");
  res.type(VARIANTS[variant].format === "webp" ? "image/webp" : "png").send(cache.get(key));
});
