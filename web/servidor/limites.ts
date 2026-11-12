/**
 * Reemplaza a src/middlewares/rateLimiter.ts al empaquetar: en el navegador no hay visitantes de internet
 * llamando a la API (los pedidos del QR se limitan por cliente en tienda.ts).
 */
import type { Handler } from "./express.js";

const pasar: Handler = (_req, _res, next) => next();

export const apiLimiter = pasar;
export const loginLimiter = pasar;
export const storeOrderLimiter = pasar;
export const trackingLimiter = pasar;
export const registerLimiter = pasar;
