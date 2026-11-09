import { rateLimit, type Options } from "express-rate-limit";
import { isTest } from "../config/env.js";

const handler: Options["handler"] = (_req, res, _next, options) => {
  res.status(options.statusCode).json({
    error: { code: "TOO_MANY_REQUESTS", message: "Demasiados intentos. Espera unos minutos e intenta de nuevo." },
  });
};

const common = { standardHeaders: "draft-8", legacyHeaders: false, handler, skip: () => isTest } satisfies Partial<Options>;

/** Límite general de la API por IP. */
export const apiLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 600 });

/** Inicio de sesión: solo cuentan los intentos fallidos (fuerza bruta de contraseñas). */
export const loginLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true });

/** Pedidos desde la tienda en línea (evita llenar el tablero de pedidos falsos). */
export const storeOrderLimiter = rateLimit({ ...common, windowMs: 10 * 60_000, limit: 10 });

/** Seguimiento de un pedido de la tienda (la pantalla consulta cada pocos segundos). */
export const trackingLimiter = rateLimit({ ...common, windowMs: 10 * 60_000, limit: 300 });

/** Registro de cuentas desde el inicio de sesión. */
export const registerLimiter = rateLimit({ ...common, windowMs: 60 * 60_000, limit: 10 });
