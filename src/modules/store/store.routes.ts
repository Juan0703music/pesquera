import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { storeOrderLimiter, trackingLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { badRequest } from "../../utils/errors.js";
import { committedByProduct } from "../inventory/stock.js";
import { StoreOrderSchema, type StoreOrderInput } from "../orders/orders.schemas.js";
import { ordersService } from "../orders/orders.service.js";
import { getSettings } from "../settings/settings.routes.js";

const IdParams = z.object({ id: z.uuid("Identificador inválido.") });

/**
 * Tienda en línea (pública, sin sesión): catálogo con lo disponible, pedido y seguimiento.
 * No muestra costos ni cantidades exactas de la bodega: solo si hay o no (y hasta cuánto se puede pedir).
 */
export const storeRoutes = Router();

storeRoutes.get("/", async (_req, res) => {
  const [settings, categories, committed] = await Promise.all([
    getSettings(),
    prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { products: { where: { active: true, inStore: true }, orderBy: { name: "asc" } } },
    }),
    committedByProduct(prisma),
  ]);
  res.set("Cache-Control", "no-store").json({
    data: {
      business: {
        name: settings.businessName, phone: settings.phone, whatsapp: settings.whatsapp, address: settings.address,
        open: settings.storeOpen, deliveryFee: settings.deliveryFee, minOrderTotal: settings.minOrderTotal,
      },
      categories: categories
        .filter((category) => category.products.length > 0)
        .map((category) => ({
          id: category.id,
          name: category.name,
          products: category.products.map((product) => {
            const availableMilli = Math.max(0, product.stockMilli - (committed.get(product.id) ?? 0));
            return {
              id: product.id, name: product.name, description: product.description, unit: product.unit, price: product.price,
              available: availableMilli >= (product.unit === "KG" ? 250 : 1000),
              maxQty: Math.floor(availableMilli / (product.unit === "KG" ? 250 : 1000)) * (product.unit === "KG" ? 0.25 : 1),
            };
          }),
        })),
    },
  });
});

storeRoutes.post("/orders", storeOrderLimiter, validate({ body: StoreOrderSchema }), async (req, res) => {
  const input = req.body as StoreOrderInput;
  if (input.website) throw badRequest("No pudimos recibir el pedido.", "SPAM");
  const { order, trackingKey } = await ordersService.createFromStore(input);
  res.status(201).json({ data: { id: order.id, number: order.number, total: order.total, trackingKey } });
});

storeRoutes.get("/orders/:id", trackingLimiter, validate({ params: IdParams }), async (req, res) => {
  const key = req.get("x-order-key") ?? "";
  res.set("Cache-Control", "no-store").json({ data: await ordersService.track((req.params as z.infer<typeof IdParams>).id, key) });
});
