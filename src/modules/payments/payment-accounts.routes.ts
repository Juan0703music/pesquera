import express, { Router } from "express";
import { z } from "zod";
import { getAuth, requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { badRequest, forbidden } from "../../utils/errors.js";
import { can } from "../auth/permissions.js";
import { PaymentAccountSchema, type PaymentAccountInput } from "./payment-accounts.schemas.js";
import { paymentAccountsService } from "./payment-accounts.service.js";

const IdParams = z.object({ id: z.uuid("Identificador inválido.") });
const idOf = (params: unknown) => (params as z.infer<typeof IdParams>).id;

/** Pantallazos del QR: PNG, JPG o WebP de hasta 8 MB (se leen y no se guardan). */
const imageBody = express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "8mb" });

export const paymentAccountsRoutes = Router();

/**
 * El administrador ve todas; quien cobra (ventas) ve las activas para mostrarle el QR al cliente
 * en el mostrador o enviarle los datos por WhatsApp.
 */
paymentAccountsRoutes.get("/", (req, _res, next) => {
  const auth = getAuth(req);
  if (!can(auth.role, "orders.collect") && !can(auth.role, "admin.manage")) return next(forbidden("Tu rol no tiene permiso para ver las cuentas de cobro."));
  next();
}, async (req, res) => {
  res.json({ data: await paymentAccountsService.list({ activeOnly: !can(getAuth(req).role, "admin.manage") }) });
});

paymentAccountsRoutes.post("/", requirePermission("admin.manage"), validate({ body: PaymentAccountSchema }), async (req, res) => {
  res.status(201).json({ data: await paymentAccountsService.create(req.body as PaymentAccountInput) });
});

paymentAccountsRoutes.put("/:id", requirePermission("admin.manage"), validate({ params: IdParams, body: PaymentAccountSchema }), async (req, res) => {
  res.json({ data: await paymentAccountsService.update(idOf(req.params), req.body as PaymentAccountInput) });
});

paymentAccountsRoutes.patch(
  "/:id/active",
  requirePermission("admin.manage"),
  validate({ params: IdParams, body: z.object({ active: z.boolean() }) }),
  async (req, res) => {
    res.json({ data: await paymentAccountsService.setActive(idOf(req.params), (req.body as { active: boolean }).active) });
  },
);

paymentAccountsRoutes.delete("/:id", requirePermission("admin.manage"), validate({ params: IdParams }), async (req, res) => {
  await paymentAccountsService.remove(idOf(req.params));
  res.status(204).end();
});

/** Sube el pantallazo del QR (cuerpo = la imagen, con su Content-Type). */
paymentAccountsRoutes.put("/:id/qr", requirePermission("admin.manage"), imageBody, validate({ params: IdParams }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw badRequest("Sube el pantallazo del QR en PNG, JPG o WebP.", "IMAGE_REQUIRED");
  }
  res.json({ data: await paymentAccountsService.setQr(idOf(req.params), req.body) });
});

paymentAccountsRoutes.delete("/:id/qr", requirePermission("admin.manage"), validate({ params: IdParams }), async (req, res) => {
  res.json({ data: await paymentAccountsService.clearQr(idOf(req.params)) });
});
