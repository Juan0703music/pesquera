/**
 * Personal en la versión del navegador (montado en /api/v1/users, solo el administrador).
 * Cada persona tiene nombre, rol y un PIN opcional para entrar. Nunca queda la pesquera sin un
 * administrador activo, y nadie puede desactivarse a sí mismo.
 */
import { z } from "zod";
import { ROLE_LABELS } from "../../src/modules/auth/permissions.js";
import { validate } from "../../src/middlewares/validate.js";
import { badRequest, conflict, notFound } from "../../src/utils/errors.js";
import { getAuth, requirePermission } from "./autenticacion.js";
import { hashPin } from "./cripto.js";
import { prisma } from "./db.js";
import { Router } from "./express.js";
import { live } from "./live.js";
import { internalEmail, PinSchema } from "./sesion.js";

const RoleSchema = z.enum(["ADMIN", "VENTAS", "DESPACHO", "BODEGA"], { error: "Elige un rol." });
const optionalPin = z.preprocess((value) => (value === "" ? undefined : value), PinSchema.optional());

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre.").max(80),
  role: RoleSchema,
  pin: optionalPin,
});
const UpdateSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre.").max(80).optional(),
  role: RoleSchema.optional(),
  active: z.boolean().optional(),
  /** PIN nuevo (vacío: no se cambia). */
  pin: optionalPin,
  /** Quitar el PIN: entra con solo tocar su nombre. */
  removePin: z.boolean().optional(),
});
const IdParams = z.object({ id: z.uuid("Identificador inválido.") });

const select = { id: true, name: true, role: true, active: true, passwordHash: true, createdAt: true } as const;
type Row = { id: string; name: string; role: keyof typeof ROLE_LABELS; active: boolean; passwordHash: string; createdAt: Date };

function dto(user: Row, selfId: string) {
  const { passwordHash, ...rest } = user;
  return { ...rest, roleLabel: ROLE_LABELS[user.role], hasPin: Boolean(passwordHash), isSelf: user.id === selfId };
}

export const personalRoutes = Router();
personalRoutes.use(requirePermission("admin.manage"));

personalRoutes.get("/", async (req, res) => {
  const users = await prisma.user.findMany({ select, orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }] });
  res.json({ data: users.map((user) => dto(user, getAuth(req).userId)) });
});

personalRoutes.post("/", validate({ body: CreateSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof CreateSchema>;
  const user = await prisma.user.create({
    data: { name: input.name, role: input.role, email: internalEmail(), passwordHash: input.pin ? await hashPin(input.pin) : "" },
    select,
  });
  live.emit("users", "user.created", { name: user.name });
  res.status(201).json({ data: dto(user, getAuth(req).userId) });
});

personalRoutes.patch("/:id", validate({ params: IdParams, body: UpdateSchema }), async (req, res) => {
  const { id } = req.params as z.infer<typeof IdParams>;
  const input = req.body as z.infer<typeof UpdateSchema>;
  const me = getAuth(req);

  const user = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id }, select });
    if (!current) throw notFound("Esa persona no existe.");
    if (id === me.userId && input.active === false) throw badRequest("No puedes desactivarte a ti mismo.", "CANNOT_DEACTIVATE_SELF");
    const losesAdmin = current.role === "ADMIN" && current.active && (input.active === false || (input.role && input.role !== "ADMIN"));
    if (losesAdmin) {
      const admins = await tx.user.count({ where: { role: "ADMIN", active: true } });
      if (admins <= 1) throw conflict("Debe quedar al menos un administrador activo.", "LAST_ADMIN");
    }
    const passwordHash = input.removePin ? "" : input.pin ? await hashPin(input.pin) : undefined;
    const updated = await tx.user.update({
      where: { id },
      data: { name: input.name, role: input.role, active: input.active, ...(passwordHash !== undefined ? { passwordHash } : {}) },
      select,
    });
    // Al desactivarla o cambiarle el PIN, sus sesiones abiertas se cierran.
    if (input.active === false || passwordHash !== undefined) {
      await tx.session.updateMany({ where: { userId: id, revokedAt: null, ...(id === me.userId ? { NOT: { id: me.sessionId } } : {}) }, data: { revokedAt: new Date() } });
    }
    return updated;
  });

  live.emit("users", "user.updated", { name: user.name });
  res.json({ data: dto(user, me.userId) });
});
