import { Router } from "express";
import { z } from "zod";
import { getAuth } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { badRequest } from "../../utils/errors.js";
import { deviceLabel, isAllowedEndpoint, pushService } from "./push.service.js";

/** Avisos al celular (montado en /api/v1/push, con sesión). */
export const pushRoutes = Router();

const base64url = z.string().min(16).max(200).regex(/^[A-Za-z0-9_-]+=*$/);
const SubscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: base64url, auth: base64url }),
});
const EndpointSchema = z.object({ endpoint: z.url().max(1000) });

pushRoutes.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  res.json({ data: { publicKey: await pushService.publicKey(), devices: await pushService.devices(userId) } });
});

pushRoutes.post("/subscriptions", validate({ body: SubscriptionSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof SubscriptionSchema>;
  if (!isAllowedEndpoint(input.endpoint)) throw badRequest("Ese navegador no es compatible con los avisos.", "PUSH_ENDPOINT_NOT_ALLOWED");
  await pushService.subscribe(getAuth(req).userId, input, deviceLabel(req.headers["user-agent"]));
  res.status(201).json({ data: { ok: true } });
});

pushRoutes.delete("/subscriptions", validate({ body: EndpointSchema }), async (req, res) => {
  await pushService.unsubscribe(getAuth(req).userId, (req.body as z.infer<typeof EndpointSchema>).endpoint);
  res.status(204).end();
});

/** Aviso de prueba a los equipos de quien lo pide. */
pushRoutes.post("/test", async (req, res) => {
  const delivered = await pushService.send(
    { title: "Avisos activados", body: "Así te llegará cada pedido nuevo, aunque tengas la app cerrada.", url: "/app/pedidos", tag: "prueba" },
    { permission: "orders.view", onlyUserId: getAuth(req).userId },
  );
  res.json({ data: { delivered } });
});
