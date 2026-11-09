import { Router } from "express";
import type { z } from "zod";
import { z as zod } from "zod";
import { getAuth, requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import {
  CancelSchema,
  CollectSchema,
  CreateOrderSchema,
  ListOrdersQuery,
  StatusSchema,
  WeighSchema,
  type CreateOrderInput,
} from "./orders.schemas.js";
import { ordersService } from "./orders.service.js";

const IdParams = zod.object({ id: zod.uuid("Identificador inválido.") });
const idOf = (params: unknown) => (params as z.infer<typeof IdParams>).id;

export const ordersRoutes = Router();

ordersRoutes.get("/", requirePermission("orders.view"), validate({ query: ListOrdersQuery }), async (req, res) => {
  const { view, limit } = req.query as unknown as z.infer<typeof ListOrdersQuery>;
  res.json({ data: await ordersService.list(view, limit) });
});

ordersRoutes.post("/", requirePermission("orders.create"), validate({ body: CreateOrderSchema }), async (req, res) => {
  const { order, warnings } = await ordersService.create(req.body as CreateOrderInput, getAuth(req));
  res.status(201).json({ data: order, warnings });
});

ordersRoutes.get("/:id", requirePermission("orders.view"), validate({ params: IdParams }), async (req, res) => {
  res.json({ data: await ordersService.get(idOf(req.params)) });
});

ordersRoutes.post("/:id/weigh", requirePermission("orders.dispatch"), validate({ params: IdParams, body: WeighSchema }), async (req, res) => {
  const { items } = req.body as z.infer<typeof WeighSchema>;
  res.json({ data: await ordersService.weigh(idOf(req.params), items, getAuth(req)) });
});

ordersRoutes.post("/:id/status", requirePermission("orders.dispatch"), validate({ params: IdParams, body: StatusSchema }), async (req, res) => {
  const { status } = req.body as z.infer<typeof StatusSchema>;
  res.json({ data: await ordersService.changeStatus(idOf(req.params), status, getAuth(req)) });
});

ordersRoutes.post("/:id/collect", requirePermission("orders.collect"), validate({ params: IdParams, body: CollectSchema }), async (req, res) => {
  const { paymentMethod } = req.body as z.infer<typeof CollectSchema>;
  res.json({ data: await ordersService.collect(idOf(req.params), paymentMethod, getAuth(req)) });
});

ordersRoutes.post("/:id/cancel", requirePermission("orders.cancel"), validate({ params: IdParams, body: CancelSchema }), async (req, res) => {
  const { reason } = req.body as z.infer<typeof CancelSchema>;
  res.json({ data: await ordersService.cancel(idOf(req.params), reason, getAuth(req)) });
});
