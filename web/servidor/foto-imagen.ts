/** Foto del producto en el navegador (reemplaza a src/modules/catalog/photo-image.ts al empaquetar). */
import { AppError } from "../../src/utils/errors.js";
import { abrirImagen, codificar, dentro, lienzo } from "./imagenes.js";

const MIN_SIDE = 320;

export async function processPhoto(input: Uint8Array) {
  const imagen = await abrirImagen(input, "No pudimos abrir esa imagen. Sube una foto en JPG, PNG o WebP.");
  try {
    if (Math.min(imagen.width, imagen.height) < MIN_SIDE) {
      throw new AppError(422, "PHOTO_TOO_SMALL", `La foto es muy pequeña (${imagen.width} × ${imagen.height}). Usa una de al menos ${MIN_SIDE} píxeles por lado.`);
    }
    // Grande: hasta 1400 px, para la ficha.
    const grande = dentro(imagen.width, imagen.height, 1400, 1400);
    const g = lienzo(grande.ancho, grande.alto);
    g.ctx.drawImage(imagen, 0, 0, grande.ancho, grande.alto);

    // Pequeña: 640 × 480 recortada al centro, para las listas.
    const escala = Math.max(640 / imagen.width, 480 / imagen.height);
    const recorteAncho = 640 / escala;
    const recorteAlto = 480 / escala;
    const p = lienzo(640, 480);
    p.ctx.drawImage(imagen, (imagen.width - recorteAncho) / 2, (imagen.height - recorteAlto) / 2, recorteAncho, recorteAlto, 0, 0, 640, 480);

    const [large, small] = await Promise.all([codificar(g.canvas, "image/webp", 0.8), codificar(p.canvas, "image/webp", 0.78)]);
    return { large, small };
  } finally {
    imagen.close();
  }
}
