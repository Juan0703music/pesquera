import jsqrModule from "jsqr";
import QRCode from "qrcode";
import sharp from "sharp";
import { AppError } from "../../utils/errors.js";

/**
 * Imágenes de los códigos QR de cobro: leer el QR de un pantallazo y dibujarlo en PNG. La versión que
 * corre en el navegador (web/) usa su propio módulo con el mismo contrato (web/servidor/qr-imagen.ts).
 */

// jsQR es CommonJS: según el cargador, la función llega como default o como default.default.
type ReadQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;
const jsQR = ((jsqrModule as unknown as { default?: ReadQr }).default ?? jsqrModule) as unknown as ReadQr;

/** Lee el código QR de una imagen (pantallazo o foto). Prueba varios tamaños porque jsQR es sensible a la escala. */
export async function readQr(input: Uint8Array): Promise<string | null> {
  for (const size of [1600, 1000, 2400, 700]) {
    try {
      const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: "attemptBoth" });
      if (found?.data) return found.data;
    } catch {
      throw new AppError(415, "INVALID_IMAGE", "No pudimos abrir esa imagen. Sube un pantallazo en PNG, JPG o WebP.");
    }
  }
  return null;
}

/** El QR de cobro en PNG grande (para enviarlo por WhatsApp o imprimirlo). */
export async function qrPng(payload: string): Promise<Uint8Array> {
  return QRCode.toBuffer(payload, { type: "png", width: 900, margin: 4, errorCorrectionLevel: "M" });
}
