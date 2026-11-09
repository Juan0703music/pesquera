import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { copSchema } from "../../utils/money.js";
import { mobilePhoneSchema, phoneSchema } from "../../utils/phone.js";
import { logoInfo, logoRound, logoRoutes } from "./logo.js";

const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(max).nullable().optional());
const optionalPhone = (schema: typeof phoneSchema) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullable().optional());

const SettingsSchema = z.object({
  businessName: z.string().trim().min(2, "Escribe el nombre de la pesquera.").max(80),
  phone: optionalPhone(phoneSchema),
  whatsapp: optionalPhone(mobilePhoneSchema),
  address: optionalText(200),
  storeOpen: z.boolean(),
  minOrderTotal: copSchema,
});

export const DEFAULT_SETTINGS = { businessName: "Pesquera", storeOpen: true, deliveryFee: 0, minOrderTotal: 0, hasLogo: false, logoVersion: 0 };

export async function getSettings() {
  return (await prisma.setting.findUnique({ where: { id: 1 } })) ?? { id: 1, phone: null, whatsapp: null, address: null, updatedAt: new Date(0), ...DEFAULT_SETTINGS };
}

export const settingsRoutes = Router();

/** Nombre y logo de la pesquera, como los muestran el panel, la entrada, la tienda y el seguimiento. */
export async function getBrand() {
  const settings = await getSettings();
  return { name: settings.businessName, logo: logoInfo(settings, settings.hasLogo ? await logoRound() : null) };
}

settingsRoutes.get("/", async (_req, res) => {
  const settings = await getSettings();
  res.json({ data: { ...settings, logo: logoInfo(settings, settings.hasLogo ? await logoRound() : null) } });
});

// Logo: PUT (subir), PATCH (redondo o no) y DELETE /settings/logo.
settingsRoutes.use(logoRoutes);

settingsRoutes.put("/", requirePermission("admin.manage"), validate({ body: SettingsSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof SettingsSchema>;
  const settings = await prisma.setting.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
  live.emit("settings", "settings.updated");
  res.json({ data: settings });
});
