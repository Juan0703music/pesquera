/**
 * Sesión en la versión del navegador (reemplaza a src/middlewares/authenticate.ts al empaquetar).
 * Cada pantalla manda el código de su sesión en la cabecera «X-Marea-Sesion» (lo guarda el navegador
 * al entrar). Los permisos por rol son los mismos del servidor (src/modules/auth/permissions.ts).
 */
import { can, type Permission } from "../../src/modules/auth/permissions.js";
import { forbidden, unauthorized } from "../../src/utils/errors.js";
import type { Handler, Req } from "./express.js";
import { resolverSesion, SESSION_HEADER, type AuthContext } from "./sesiones.js";

export { SESSION_HEADER, type AuthContext };

export const authenticate: Handler = async (req, _res, next) => {
  const token = req.headers[SESSION_HEADER];
  if (!token) throw unauthorized();
  const auth = await resolverSesion(token);
  if (!auth) throw unauthorized("Tu sesión terminó. Entra de nuevo.", "SESSION_EXPIRED");
  req.auth = auth;
  next();
};

export function requirePermission(permission: Permission): Handler {
  return (req, _res, next) => {
    const auth = getAuth(req);
    if (!can(auth.role, permission)) throw forbidden("Tu rol no tiene permiso para esta acción.");
    next();
  };
}

export function getAuth(req: Req): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth as AuthContext;
}
