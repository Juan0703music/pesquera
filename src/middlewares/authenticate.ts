import type { Request, RequestHandler } from "express";
import { authService } from "../modules/auth/auth.service.js";
import { can, type Permission } from "../modules/auth/permissions.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../modules/auth/session-cookie.js";
import type { AuthContext } from "../types/express.js";
import { forbidden, unauthorized } from "../utils/errors.js";

/** Exige una sesión válida (cookie httpOnly). Deja la persona en `req.auth`. */
export const authenticate: RequestHandler = async (req, res, next) => {
  const token = readSessionToken(req.headers.cookie);
  if (!token) throw unauthorized();
  const resolved = await authService.resolveSession(token);
  if (!resolved) {
    clearSessionCookie(res);
    throw unauthorized("Tu sesión expiró. Inicia sesión de nuevo.", "SESSION_EXPIRED");
  }
  if (resolved.renewedExpiresAt) setSessionCookie(res, token, resolved.renewedExpiresAt);
  req.auth = resolved.auth;
  next();
};

/** Exige que el rol de la persona tenga el permiso. Va después de `authenticate`. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const auth = getAuth(req);
    if (!can(auth.role, permission)) throw forbidden("Tu rol no tiene permiso para esta acción.");
    next();
  };
}

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
