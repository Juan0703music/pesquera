import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { authenticate, getAuth } from "../../middlewares/authenticate.js";
import { loginLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { authService } from "./auth.service.js";
import { permissionsOf, ROLE_LABELS } from "./permissions.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-cookie.js";

const LoginSchema = z.object({
  email: z.email("Escribe un correo válido.").trim().toLowerCase(),
  password: z.string().min(1, "Escribe tu contraseña.").max(200),
});

/** Lo que el panel necesita saber de la persona y de la pesquera. */
async function profile(userId: string) {
  const [user, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } }),
    prisma.setting.findUnique({ where: { id: 1 }, select: { businessName: true } }),
  ]);
  return {
    user: { ...user, roleLabel: ROLE_LABELS[user.role] },
    permissions: permissionsOf(user.role),
    businessName: settings?.businessName ?? "Pesquera",
  };
}

export const authRoutes = Router();

authRoutes.post("/login", loginLimiter, validate({ body: LoginSchema }), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof LoginSchema>;
  const { token, expiresAt, user } = await authService.login(email, password, req.get("user-agent"));
  setSessionCookie(res, token, expiresAt);
  res.json({ data: await profile(user.id) });
});

authRoutes.post("/logout", async (req, res) => {
  const token = readSessionToken(req.headers.cookie);
  if (token) {
    const resolved = await authService.resolveSession(token);
    if (resolved) await authService.logout(resolved.auth.sessionId);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRoutes.get("/me", authenticate, async (req, res) => {
  res.json({ data: await profile(getAuth(req).userId) });
});
