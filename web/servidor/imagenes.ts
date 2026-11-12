/**
 * Imágenes en el navegador (OffscreenCanvas): lo que en el servidor hace sharp.
 * Volver a dibujar la imagen en un lienzo también le quita los metadatos (por ejemplo, la ubicación GPS).
 */
import { AppError } from "../../src/utils/errors.js";

export async function abrirImagen(bytes: Uint8Array, mensaje: string): Promise<ImageBitmap> {
  try {
    // «from-image»: respeta la orientación que guarda el celular (fotos de lado).
    return await createImageBitmap(new Blob([bytes as BlobPart]), { imageOrientation: "from-image" });
  } catch {
    throw new AppError(415, "INVALID_IMAGE", mensaje);
  }
}

export function lienzo(ancho: number, alto: number) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(ancho)), Math.max(1, Math.round(alto)));
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

export async function codificar(canvas: OffscreenCanvas, type: "image/png" | "image/webp", quality?: number) {
  const blob = await canvas.convertToBlob({ type, quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Medidas para que quepa dentro de un cuadro, sin agrandar si ya es más pequeña. */
export function dentro(ancho: number, alto: number, maxAncho: number, maxAlto: number, agrandar = false) {
  let escala = Math.min(maxAncho / ancho, maxAlto / alto);
  if (!agrandar) escala = Math.min(1, escala);
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

/** Dibuja la imagen centrada dentro de un cuadrado (lo que sobra queda transparente). */
export function dibujarContenida(ctx: OffscreenCanvasRenderingContext2D, imagen: CanvasImageSource & { width: number; height: number }, x: number, y: number, lado: number) {
  const { ancho, alto } = dentro(imagen.width, imagen.height, lado, lado, true);
  ctx.drawImage(imagen, x + (lado - ancho) / 2, y + (lado - alto) / 2, ancho, alto);
}
