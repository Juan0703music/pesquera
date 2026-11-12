/** Logo en el navegador (reemplaza a src/modules/settings/logo-image.ts al empaquetar). Mismo contrato. */
import { AppError } from "../../src/utils/errors.js";
import { abrirImagen, codificar, dibujarContenida, lienzo } from "./imagenes.js";

const MIN_SIDE = 128;

export const VARIANTS = {
  "logo-512.webp": { size: 512, format: "webp", padded: false },
  "logo-192.webp": { size: 192, format: "webp", padded: false },
  "icon-32.png": { size: 32, format: "png", padded: false },
  "icon-192.png": { size: 192, format: "png", padded: false },
  "icon-512.png": { size: 512, format: "png", padded: false },
  "apple-180.png": { size: 180, format: "png", padded: true },
  "maskable-512.png": { size: 512, format: "png", padded: true },
} as const;
export type Variant = keyof typeof VARIANTS;

/** Lo deja cuadrado (1024 px, centrado sobre transparente) y en PNG. */
export async function normalize(input: Uint8Array) {
  const imagen = await abrirImagen(input, "No pudimos abrir esa imagen. Sube el logo en PNG, JPG o WebP.");
  try {
    if (Math.min(imagen.width, imagen.height) < MIN_SIDE) {
      throw new AppError(422, "LOGO_TOO_SMALL", `El logo es muy pequeño (${imagen.width} × ${imagen.height}). Usa uno de al menos ${MIN_SIDE} píxeles por lado.`);
    }
    const { canvas, ctx } = lienzo(1024, 1024);
    dibujarContenida(ctx, imagen, 0, 0, 1024);
    return codificar(canvas, "image/png");
  } finally {
    imagen.close();
  }
}

function recortarCirculo(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, lado: number) {
  ctx.beginPath();
  ctx.arc(x + lado / 2, y + lado / 2, lado / 2, 0, Math.PI * 2);
  ctx.clip();
}

export async function render(image: Uint8Array, round: boolean, variant: Variant) {
  const { size, format, padded } = VARIANTS[variant];
  const logo = await abrirImagen(image, "El logo guardado no se pudo abrir.");
  try {
    const { canvas, ctx } = lienzo(size, size);
    if (padded) {
      const maskable = variant.startsWith("maskable-");
      const inner = Math.round(size * (maskable ? (round ? 0.74 : 0.56) : 0.86));
      const offset = (size - inner) / 2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      if (round) recortarCirculo(ctx, offset, offset, inner);
      dibujarContenida(ctx, logo, offset, offset, inner);
    } else {
      if (round) recortarCirculo(ctx, 0, 0, size);
      dibujarContenida(ctx, logo, 0, 0, size);
    }
    return codificar(canvas, format === "webp" ? "image/webp" : "image/png", format === "webp" ? 0.88 : undefined);
  } finally {
    logo.close();
  }
}

const OLAS = ["M12 26c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5", "M12 36c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5", "M12 46c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5"];

/** Ícono de Marea (la ola) cuando la pesquera aún no tiene logo. */
export async function defaultIcon(variant: Variant) {
  const { size } = VARIANTS[variant];
  const { canvas, ctx } = lienzo(size, size);
  ctx.scale(size / 64, size / 64);
  const degradado = ctx.createLinearGradient(0, 0, 64, 64);
  degradado.addColorStop(0, "#3fd6e8");
  degradado.addColorStop(0.55, "#0b8fb0");
  degradado.addColorStop(1, "#0b5f7a");
  ctx.fillStyle = degradado;
  ctx.beginPath();
  ctx.roundRect(0, 0, 64, 64, variant.startsWith("maskable-") ? 0 : 15);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  for (const ola of OLAS) ctx.stroke(new Path2D(ola));
  return codificar(canvas, "image/png");
}
