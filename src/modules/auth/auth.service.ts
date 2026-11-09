import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { AuthContext } from "../../types/express.js";
import { unauthorized } from "../../utils/errors.js";
import { verifyAgainstDummy, verifyPassword } from "../../utils/password.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = env.SESSION_TTL_DAYS * DAY_MS;
/** Vida máxima de una sesión aunque se siga usando. */
const SESSION_MAX_LIFETIME_MS = Math.max(30, env.SESSION_TTL_DAYS) * DAY_MS;
/** Frecuencia máxima con la que se actualiza `last_used_at`. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Token aleatorio de 256 bits; en la base solo se guarda su SHA-256. */
export const generateToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const authService = {
  async login(email: string, password: string, userAgent?: string) {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const valid = user ? await verifyPassword(user.passwordHash, password) : await verifyAgainstDummy(password);
    if (!user || !valid) throw unauthorized("Correo o contraseña incorrectos.", "INVALID_CREDENTIALS");
    if (user.pendingApproval) {
      throw unauthorized("Tu cuenta está esperando que el administrador la apruebe. Te avisará cuando puedas entrar.", "ACCOUNT_PENDING");
    }
    if (!user.active) throw unauthorized("Tu usuario está desactivado. Habla con el administrador.", "USER_INACTIVE");

    const { token, expiresAt } = await authService.openSession(user.id, userAgent);
    await prisma.session.deleteMany({
      where: { userId: user.id, OR: [{ expiresAt: { lt: new Date() } }, { createdAt: { lt: new Date(Date.now() - SESSION_MAX_LIFETIME_MS) } }] },
    });
    return { token, expiresAt, user };
  },

  /**
   * Valida el token de la cookie. null si no existe, fue revocado, venció o el usuario está inactivo.
   * Renovación deslizante: cuando queda menos de la mitad de la vida, se extiende.
   */
  async resolveSession(token: string): Promise<{ auth: AuthContext; renewedExpiresAt?: Date } | null> {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now || !session.user.active) return null;
    if (now - session.createdAt.getTime() > SESSION_MAX_LIFETIME_MS) return null;

    let renewedExpiresAt: Date | undefined;
    if (session.expiresAt.getTime() - now < SESSION_TTL_MS / 2) {
      renewedExpiresAt = new Date(now + SESSION_TTL_MS);
      await prisma.session.update({ where: { id: session.id }, data: { expiresAt: renewedExpiresAt, lastUsedAt: new Date() } });
    } else if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }
    const { user } = session;
    return { auth: { userId: user.id, sessionId: session.id, name: user.name, role: user.role }, renewedExpiresAt };
  },

  /** Abre una sesión para un usuario ya validado (p. ej. el administrador recién creado). */
  async openSession(userId: string, userAgent?: string) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({ data: { userId, tokenHash: hashToken(token), userAgent: userAgent?.slice(0, 255), expiresAt } });
    return { token, expiresAt };
  },

  async logout(sessionId: string) {
    await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /** Cierra todas las sesiones de un usuario (al desactivarlo o cambiarle la contraseña). */
  async revokeAll(userId: string) {
    await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },
};
