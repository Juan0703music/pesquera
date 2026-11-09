import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { DEMO_PASSWORD, DEMO_USERS } from "../../config/demo.js";
import { env } from "../../config/env.js";
import { authenticate, getAuth } from "../../middlewares/authenticate.js";
import { loginLimiter, registerLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { conflict } from "../../utils/errors.js";
import { hashPassword } from "../../utils/password.js";
import { getBrand } from "../settings/settings.routes.js";
import { authService } from "./auth.service.js";
import { can, permissionsOf, ROLE_LABELS } from "./permissions.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-cookie.js";

const LoginSchema = z.object({
  email: z.email("Escribe un correo válido.").trim().toLowerCase(),
  password: z.string().min(1, "Escribe tu contraseña.").max(200),
});

const RegisterSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  email: z.email("Escribe un correo válido.").trim().toLowerCase(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
  /** Puesto que pide quien se registra; el administrador lo confirma o lo cambia al aprobar. Nunca administrador. */
  role: z.enum(["VENTAS", "DESPACHO", "BODEGA"], { error: "Elige tu puesto." }).default("VENTAS"),
});

/** Lo que el panel necesita saber de la persona y de la pesquera. */
async function profile(userId: string) {
  const [user, brand] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } }),
    getBrand(),
  ]);
  return {
    user: { ...user, roleLabel: ROLE_LABELS[user.role] },
    permissions: permissionsOf(user.role),
    businessName: brand.name,
    logo: brand.logo,
    // Solicitudes de acceso por aprobar (solo para quien puede aprobarlas).
    pendingApprovals: can(user.role, "admin.manage") ? await prisma.user.count({ where: { pendingApproval: true } }) : 0,
  };
}

export const authRoutes = Router();

/**
 * Estado para la pantalla de inicio de sesión:
 * - needsSetup: todavía no hay nadie; el primer registro crea al administrador.
 * - demo: en desarrollo, los usuarios de la demostración para entrar con un clic.
 */
authRoutes.get("/status", async (_req, res) => {
  const [users, settings, brand] = await Promise.all([prisma.user.count(), prisma.setting.findUnique({ where: { id: 1 }, select: { businessName: true } }), getBrand()]);
  let demo = null;
  if (env.NODE_ENV === "development") {
    const existing = await prisma.user.findMany({ where: { email: { in: DEMO_USERS.map((user) => user.email) }, active: true }, select: { email: true, role: true, name: true } });
    // En el orden de los puestos: administrador, ventas, despacho, bodega.
    const order = DEMO_USERS.map((user) => user.email as string);
    existing.sort((x, y) => order.indexOf(x.email) - order.indexOf(y.email));
    if (existing.length) demo = { password: DEMO_PASSWORD, users: existing.map((user) => ({ ...user, roleLabel: ROLE_LABELS[user.role] })) };
  }
  res.set("Cache-Control", "no-store").json({ data: { needsSetup: users === 0, businessName: settings?.businessName ?? null, logo: brand.logo, demo } });
});

authRoutes.post("/login", loginLimiter, validate({ body: LoginSchema }), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof LoginSchema>;
  const { token, expiresAt, user } = await authService.login(email, password, req.get("user-agent"));
  setSessionCookie(res, token, expiresAt);
  res.json({ data: await profile(user.id) });
});

/**
 * Registro desde el inicio de sesión.
 * - Si todavía no hay nadie, la cuenta es la del administrador y entra de una vez (configuración inicial).
 * - Si no, queda pendiente: no entra hasta que un administrador la apruebe en «Personal» (así nadie de afuera
 *   puede registrarse y ver ventas, clientes o inventario).
 */
authRoutes.post("/register", registerLimiter, validate({ body: RegisterSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof RegisterSchema>;
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    // Un solo registro a la vez decide quién es el primer administrador.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(918273645)`;
    if (await tx.user.findUnique({ where: { email: input.email } })) {
      throw conflict("Ya existe una cuenta con ese correo. Inicia sesión o pide al administrador que la active.", "EMAIL_TAKEN");
    }
    const first = (await tx.user.count()) === 0;
    return tx.user.create({
      data: first
        ? { name: input.name, email: input.email, passwordHash, role: "ADMIN", active: true }
        : { name: input.name, email: input.email, passwordHash, role: input.role, active: false, pendingApproval: true },
    });
  });

  if (user.role === "ADMIN") {
    const { token, expiresAt } = await authService.openSession(user.id, req.get("user-agent"));
    setSessionCookie(res, token, expiresAt);
    return res.status(201).json({ data: { status: "ACTIVE", profile: await profile(user.id) } });
  }
  live.emit("users", "user.requested", { name: user.name, role: ROLE_LABELS[user.role] });
  res.status(201).json({ data: { status: "PENDING" } });
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
