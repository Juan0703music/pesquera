import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { getAuth, requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { badRequest, conflict } from "../../utils/errors.js";
import { hashPassword } from "../../utils/password.js";
import { authService } from "../auth/auth.service.js";
import { ROLE_LABELS } from "../auth/permissions.js";

const RoleSchema = z.enum(["ADMIN", "VENTAS", "DESPACHO", "BODEGA"], { error: "Elige un rol." });
const PasswordSchema = z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200);

const CreateUserSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre.").max(80),
  email: z.email("Escribe un correo válido.").trim().toLowerCase(),
  role: RoleSchema,
  password: PasswordSchema,
});

const UpdateUserSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: RoleSchema.optional(),
  active: z.boolean().optional(),
  password: PasswordSchema.optional(),
});

const IdParams = z.object({ id: z.uuid("Identificador inválido.") });

const select = { id: true, name: true, email: true, role: true, active: true, pendingApproval: true, createdAt: true } as const;
const toDto = <T extends { role: keyof typeof ROLE_LABELS }>(user: T) => ({ ...user, roleLabel: ROLE_LABELS[user.role] });

export const usersRoutes = Router();
usersRoutes.use(requirePermission("admin.manage"));

usersRoutes.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ select, orderBy: [{ pendingApproval: "desc" }, { active: "desc" }, { name: "asc" }] });
  res.json({ data: users.map(toDto) });
});

usersRoutes.post("/", validate({ body: CreateUserSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof CreateUserSchema>;
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw conflict("Ya existe un usuario con ese correo.", "EMAIL_TAKEN");
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, role: input.role, passwordHash: await hashPassword(input.password) },
    select,
  });
  res.status(201).json({ data: toDto(user) });
});

usersRoutes.patch("/:id", validate({ params: IdParams, body: UpdateUserSchema }), async (req, res) => {
  const { id } = req.params as z.infer<typeof IdParams>;
  const input = req.body as z.infer<typeof UpdateUserSchema>;
  const auth = getAuth(req);
  // El administrador no se puede quitar a sí mismo el acceso (la pesquera se quedaría sin administrador).
  if (id === auth.userId && (input.active === false || (input.role && input.role !== "ADMIN"))) {
    throw badRequest("No puedes desactivarte ni quitarte el rol de administrador a ti mismo.", "SELF_LOCKOUT");
  }
  const user = await prisma.user.update({
    where: { id },
    data: {
      name: input.name,
      role: input.role,
      active: input.active,
      // Activar una solicitud de acceso es aprobarla.
      ...(input.active === true ? { pendingApproval: false } : {}),
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
    },
    select,
  });
  // Al desactivarlo, cambiarle el rol o la contraseña, sus sesiones abiertas se cierran.
  if (input.active === false || input.password || input.role) await authService.revokeAll(id);
  live.emit("users", "user.updated");
  res.json({ data: toDto(user) });
});

/** Rechaza una solicitud de acceso (solo cuentas que nunca fueron aprobadas). */
usersRoutes.delete("/:id", validate({ params: IdParams }), async (req, res) => {
  const { id } = req.params as z.infer<typeof IdParams>;
  const { count } = await prisma.user.deleteMany({ where: { id, pendingApproval: true } });
  if (count === 0) throw conflict("Solo se pueden rechazar solicitudes pendientes. Para quitarle el acceso a alguien, desactívalo.", "NOT_PENDING");
  live.emit("users", "user.rejected");
  res.status(204).end();
});
