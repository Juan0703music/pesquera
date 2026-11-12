/** Sesiones de la versión del navegador: crear y comprobar (las usan la entrada y el middleware de sesión). */
import type { Role } from "../../src/generated/prisma/enums.js";
import { sha256, randomToken } from "./cripto.js";
import { prisma } from "./db.js";
import { env } from "./env.js";

export const SESSION_HEADER = "x-marea-sesion";

export interface AuthContext {
  userId: string;
  sessionId: string;
  name: string;
  role: Role;
}

const DAY = 24 * 60 * 60 * 1000;

export async function crearSesion(userId: string, userAgent?: string) {
  const token = randomToken();
  await prisma.session.create({
    data: { userId, tokenHash: await sha256(token), userAgent: userAgent?.slice(0, 300) ?? null, expiresAt: new Date(Date.now() + env.SESSION_TTL_DAYS * DAY) },
  });
  return token;
}

/** Sesión vigente de una persona activa, o null. Se renueva sola mientras se use. */
export async function resolverSesion(token: string): Promise<AuthContext | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: await sha256(token) }, include: { user: { select: { id: true, name: true, role: true, active: true } } } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now() || !session.user.active) return null;
  if (Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + env.SESSION_TTL_DAYS * DAY) } });
  }
  return { userId: session.user.id, sessionId: session.id, name: session.user.name, role: session.user.role };
}
