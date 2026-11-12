/** QR de cobro en el navegador (reemplaza a src/modules/payments/qr-image.ts al empaquetar). */
import jsqrModule from "jsqr";
import QRCode from "qrcode";
import { abrirImagen, codificar, dentro, lienzo } from "./imagenes.js";

type ReadQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;
const jsQR = ((jsqrModule as unknown as { default?: ReadQr }).default ?? jsqrModule) as unknown as ReadQr;

/** Lee el QR de un pantallazo o foto. Prueba varios tamaños porque jsQR es sensible a la escala. */
export async function readQr(input: Uint8Array): Promise<string | null> {
  const imagen = await abrirImagen(input, "No pudimos abrir esa imagen. Sube un pantallazo en PNG, JPG o WebP.");
  try {
    for (const lado of [1600, 1000, 2400, 700]) {
      const { ancho, alto } = dentro(imagen.width, imagen.height, lado, lado);
      const { ctx } = lienzo(ancho, alto);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, ancho, alto);
      ctx.drawImage(imagen, 0, 0, ancho, alto);
      const { data } = ctx.getImageData(0, 0, ancho, alto);
      const found = jsQR(data, ancho, alto, { inversionAttempts: "attemptBoth" });
      if (found?.data) return found.data;
    }
    return null;
  } finally {
    imagen.close();
  }
}

/** El QR de cobro en PNG grande (≈900 px, margen de 4 módulos). */
export async function qrPng(payload: string): Promise<Uint8Array> {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const modulos = qr.modules.size;
  const margen = 4;
  const escala = Math.max(1, Math.floor(900 / (modulos + margen * 2)));
  const lado = (modulos + margen * 2) * escala;
  const { canvas, ctx } = lienzo(lado, lado);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, lado, lado);
  ctx.fillStyle = "#000000";
  for (let fila = 0; fila < modulos; fila++) {
    for (let col = 0; col < modulos; col++) {
      if (qr.modules.get(fila, col)) ctx.fillRect((col + margen) * escala, (fila + margen) * escala, escala, escala);
    }
  }
  return codificar(canvas, "image/png");
}
