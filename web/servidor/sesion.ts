/**
 * Entrada al sistema en la versión del navegador (montada en /api/v1/auth).
 *
 * - La primera vez se crea el administrador (y el nombre de la pesquera). Sin correos ni contraseñas largas.
 * - Después, la pantalla de entrada muestra al equipo: cada persona toca su nombre y, si tiene PIN, lo escribe.
 * - La sesión es un código aleatorio que el navegador guarda; aquí solo se guarda su huella (SHA-256).
 */
import { z } from "zod";
import { permissionsOf, ROLE_LABELS } from "../../src/modules/auth/permissions.js";
import { getBrand } from "../../src/modules/settings/settings.routes.js";
import { validate } from "../../src/middlewares/validate.js";
import { AppError, conflict, unauthorized } from "../../src/utils/errors.js";
import { getAuth } from "./autenticacion.js";
import { restaurarCopia } from "./copias.js";
import { hashPin, sha256, verifyPin } from "./cripto.js";
import { prisma } from "./db.js";
import { Router } from "./express.js";
import { live } from "./live.js";
import { crearSesion, resolverSesion, SESSION_HEADER } from "./sesiones.js";

export const PinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, "El PIN son de 4 a 8 números.");
const NameSchema = z.string().trim().min(2, "Escribe el nombre.").max(80);

const SetupSchema = z.object({
  businessName: z.string().trim().min(2, "Escribe el nombre de la pesquera.").max(80),
  name: NameSchema,
  pin: z.preprocess((value) => (value === "" ? undefined : value), PinSchema.optional()),
});
const LoginSchema = z.object({
  userId: z.uuid("Elige quién eres."),
  pin: z.string().trim().max(8).optional(),
});

/** Correo interno (la tabla lo exige único); nadie lo ve ni lo usa para entrar. */
export const internalEmail = () => `persona-${crypto.randomUUID()}@marea.local`;

/** Lo que el panel necesita saber de la persona y de la pesquera (igual que en el servidor). */
export async function perfil(userId: string) {
  const [user, brand] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, passwordHash: true } }),
    getBrand(),
  ]);
  const { passwordHash, ...rest } = user;
  return {
    user: { ...rest, roleLabel: ROLE_LABELS[user.role], hasPin: Boolean(passwordHash) },
    permissions: permissionsOf(user.role),
    businessName: brand.name,
    logo: brand.logo,
    pendingApprovals: 0,
  };
}

/** Intentos fallidos de PIN por persona: después de 5, un minuto de espera. */
const intentos = new Map<string, { fallos: number; hasta: number }>();

export const sesionRoutes = Router();

/** Pantalla de entrada: si falta el primer administrador y quiénes pueden entrar. */
sesionRoutes.get("/status", async (_req, res) => {
  const [people, brand] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, passwordHash: true }, orderBy: [{ role: "asc" }, { name: "asc" }] }),
    getBrand(),
  ]);
  res.json({
    data: {
      needsSetup: (await prisma.user.count()) === 0,
      businessName: (await prisma.setting.findUnique({ where: { id: 1 }, select: { businessName: true } }))?.businessName ?? null,
      logo: brand.logo,
      people: people.map((person) => ({ id: person.id, name: person.name, role: person.role, roleLabel: ROLE_LABELS[person.role], hasPin: Boolean(person.passwordHash) })),
    },
  });
});

/** Primera vez: la pesquera y su administrador. */
sesionRoutes.post("/setup", validate({ body: SetupSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof SetupSchema>;
  const pinHash = input.pin ? await hashPin(input.pin) : "";
  const user = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) throw conflict("Marea ya tiene administrador en este navegador. Entra con tu nombre.", "ALREADY_SET_UP");
    await tx.setting.upsert({ where: { id: 1 }, create: { id: 1, businessName: input.businessName }, update: { businessName: input.businessName } });
    return tx.user.create({ data: { name: input.name, email: internalEmail(), role: "ADMIN", passwordHash: pinHash } });
  });
  const token = await crearSesion(user.id, req.headers["user-agent"]);
  live.emit("users", "user.created", { name: user.name });
  live.emit("settings", "settings.updated");
  res.status(201).json({ data: { token, profile: await perfil(user.id) } });
});

/** Navegador vacío (otro computador): se trae todo desde una copia de seguridad, sin entrar. */
sesionRoutes.post("/restaurar", async (req, res) => {
  if ((await prisma.user.count()) > 0) throw conflict("Este navegador ya tiene datos. Para restaurar, entra como administrador y usa «Ajustes».", "ALREADY_SET_UP");
  await restaurarCopia(req.body);
  res.json({ data: { ok: true } });
});

sesionRoutes.post("/login", validate({ body: LoginSchema }), async (req, res) => {
  const { userId, pin } = req.body as z.infer<typeof LoginSchema>;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, active: true, passwordHash: true } });
  if (!user || !user.active) throw unauthorized("Esa persona ya no tiene acceso. Pídele al administrador que la active en Personal.", "USER_INACTIVE");

  if (user.passwordHash) {
    const estado = intentos.get(userId);
    if (estado && estado.hasta > Date.now()) {
      throw new AppError(429, "TOO_MANY_ATTEMPTS", `Demasiados intentos. Espera ${Math.ceil((estado.hasta - Date.now()) / 1000)} segundos.`);
    }
    if (!pin || !(await verifyPin(pin, user.passwordHash))) {
      const fallos = (estado?.fallos ?? 0) + 1;
      intentos.set(userId, { fallos: fallos >= 5 ? 0 : fallos, hasta: fallos >= 5 ? Date.now() + 60_000 : 0 });
      throw new AppError(401, "WRONG_PIN", "El PIN no es correcto.");
    }
    intentos.delete(userId);
  }

  const token = await crearSesion(user.id, req.headers["user-agent"]);
  res.json({ data: { token, profile: await perfil(user.id) } });
});

sesionRoutes.post("/logout", async (req, res) => {
  const token = req.headers[SESSION_HEADER];
  if (token) await prisma.session.updateMany({ where: { tokenHash: await sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.status(204).end();
});

sesionRoutes.get("/me", async (req, res, next) => {
  const token = req.headers[SESSION_HEADER];
  const auth = token ? await resolverSesion(token) : null;
  if (!auth) return next(unauthorized("Tu sesión terminó. Entra de nuevo.", "SESSION_EXPIRED"));
  req.auth = auth;
  res.json({ data: await perfil(getAuth(req).userId) });
});

/** Cada persona puede poner, cambiar o quitar su propio PIN. */
sesionRoutes.put(
  "/pin",
  validate({ body: z.object({ pin: z.preprocess((value) => (value === "" ? null : value), PinSchema.nullable()) }) }),
  async (req, res, next) => {
    const token = req.headers[SESSION_HEADER];
    const auth = token ? await resolverSesion(token) : null;
    if (!auth) return next(unauthorized());
    const { pin } = req.body as { pin: string | null };
    await prisma.user.update({ where: { id: auth.userId }, data: { passwordHash: pin ? await hashPin(pin) : "" } });
    res.json({ data: { hasPin: Boolean(pin) } });
  },
);
