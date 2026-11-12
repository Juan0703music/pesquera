import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { processPhoto } from "./photo-image.js";

/**
 * Fotos de los productos. Se suben desde Inventario y se guardan ya procesadas:
 * - grande (hasta 1400 px, para la ficha) y pequeña (640 × 480 recortada al centro de interés, para las listas);
 * - en WebP y sin metadatos (se quita, por ejemplo, la ubicación GPS que traen las fotos del celular).
 * Van en la base de datos (tabla aparte): una pesquera tiene pocas decenas de productos y así la copia de
 * seguridad de la base incluye todo.
 */

/** Dirección pública de la foto; cambia con cada foto nueva (el navegador puede guardarla para siempre). */
export function photoUrls(product: { id: string; photoVersion: number; photo: unknown }) {
  if (!product.photo) return null;
  const query = `?v=${product.photoVersion}`;
  return { small: `/media/products/${product.id}/small.webp${query}`, large: `/media/products/${product.id}/large.webp${query}` };
}

const IdParams = z.object({ id: z.uuid("Identificador inválido.") });
const idOf = (params: unknown) => (params as z.infer<typeof IdParams>).id;
const imageBody = express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "15mb" });

/** Rutas del panel (montadas en /api/v1/catalog/products). */
export const productPhotoRoutes = Router();

productPhotoRoutes.put("/:id/photo", requirePermission("catalog.manage"), imageBody, validate({ params: IdParams }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest("Sube la foto en JPG, PNG o WebP.", "IMAGE_REQUIRED");
  const id = idOf(req.params);
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!product) throw notFound("El producto no existe.");
  const { large, small } = await processPhoto(req.body);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.productPhoto.upsert({ where: { productId: id }, create: { productId: id, large, small }, update: { large, small } });
    return tx.product.update({ where: { id }, data: { photoVersion: { increment: 1 } }, select: { id: true, photoVersion: true, photo: { select: { updatedAt: true } } } });
  });
  live.emit("catalog", "product.photo", { name: product.name });
  res.json({ data: { photo: photoUrls(updated) } });
});

productPhotoRoutes.delete("/:id/photo", requirePermission("catalog.manage"), validate({ params: IdParams }), async (req, res) => {
  const id = idOf(req.params);
  await prisma.productPhoto.deleteMany({ where: { productId: id } });
  await prisma.product.update({ where: { id }, data: { photoVersion: { increment: 1 } } });
  live.emit("catalog", "product.photo");
  res.status(204).end();
});

/** Ruta pública de las imágenes: /media/products/:id/small.webp o large.webp. */
export const mediaRoutes = Router();

const MediaParams = z.object({ id: z.uuid(), size: z.enum(["small", "large"]) });

mediaRoutes.get("/products/:id/:size.webp", async (req, res, next) => {
  const parsed = MediaParams.safeParse(req.params);
  if (!parsed.success) return next();
  const where = { productId: parsed.data.id };
  const bytes =
    parsed.data.size === "large"
      ? (await prisma.productPhoto.findUnique({ where, select: { large: true } }))?.large
      : (await prisma.productPhoto.findUnique({ where, select: { small: true } }))?.small;
  if (!bytes) return res.status(404).set("Cache-Control", "no-store").end();
  // Con ?v= (versión de la foto) la dirección nunca vuelve a servir otra imagen: se guarda un año.
  res.set("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300");
  res.type("image/webp").send(Buffer.from(bytes));
});
