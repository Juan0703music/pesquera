import type { RequestHandler } from "express";
import { forbidden } from "../utils/errors.js";
import { env } from "./env.js";

export const appOrigin = new URL(env.APP_URL).origin;

/** Mismo origen que la aplicación o que la petición (p. ej. abierta por la IP del computador en el Wi-Fi). */
export function isAllowedOrigin(origin: string, requestHost?: string): boolean {
  if (origin === appOrigin) return true;
  try {
    return requestHost !== undefined && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protección CSRF para la API con cookie de sesión: rechaza peticiones que modifican datos
 * cuando vienen de otro sitio. Se complementa con la cookie SameSite=Lax y JSON obligatorio.
 */
export const originGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get("sec-fetch-site") === "cross-site") return next(forbidden("Solicitud de otro sitio rechazada."));
  const origin = req.get("origin");
  if (origin && !isAllowedOrigin(origin, req.host)) return next(forbidden("Origen no permitido."));
  next();
};
