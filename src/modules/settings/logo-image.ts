import sharp from "sharp";
import { AppError } from "../../utils/errors.js";

/**
 * Imágenes del logo con sharp: lo normaliza al subirlo y genera cada tamaño. La versión que corre en el
 * navegador (web/) usa su propio módulo con el mismo contrato (web/servidor/logo-imagen.ts).
 */

const MIN_SIDE = 128;

/** Tamaños que se sirven en /media/logo/<nombre>. */
export const VARIANTS = {
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
export type Variant = keyof typeof VARIANTS;

export async function normalize(input: Uint8Array) {
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

export async function render(image: Uint8Array, round: boolean, variant: Variant) {
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
export async function defaultIcon(variant: Variant) {
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
