import sharp from "sharp";
import { AppError } from "../../utils/errors.js";

/**
 * Procesa la foto de un producto con sharp: grande (hasta 1400 px) y pequeña (640 × 480 recortada al centro
 * de interés), en WebP y sin metadatos. La versión que corre en el navegador (web/) usa su propio módulo
 * con el mismo contrato (web/servidor/imagenes.ts).
 */
const MIN_SIDE = 320;

export async function processPhoto(input: Buffer) {
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: 60_000_000 }).metadata();
  } catch {
    throw new AppError(415, "INVALID_IMAGE", "No pudimos abrir esa imagen. Sube una foto en JPG, PNG o WebP.");
  }
  if (!meta.width || !meta.height) throw new AppError(415, "INVALID_IMAGE", "No pudimos abrir esa imagen. Sube una foto en JPG, PNG o WebP.");
  if (Math.min(meta.width, meta.height) < MIN_SIDE) {
    throw new AppError(422, "PHOTO_TOO_SMALL", `La foto es muy pequeña (${meta.width} × ${meta.height}). Usa una de al menos ${MIN_SIDE} píxeles por lado.`);
  }
  const base = () => sharp(input, { limitInputPixels: 60_000_000 }).rotate();
  const [large, small] = await Promise.all([
    base().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
    base().resize({ width: 640, height: 480, fit: "cover", position: sharp.strategy.attention }).webp({ quality: 78 }).toBuffer(),
  ]);
  return { large, small };
}
