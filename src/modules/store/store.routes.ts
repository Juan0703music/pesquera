import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { storeOrderLimiter, trackingLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { badRequest } from "../../utils/errors.js";
import { env } from "../../config/env.js";
import { dayRange, todayIn } from "../sales/sales.service.js";
import { photoUrls } from "../catalog/photos.js";
import { committedByProduct } from "../inventory/stock.js";
import { StoreOrderSchema, type StoreOrderInput } from "../orders/orders.schemas.js";
import { ordersService } from "../orders/orders.service.js";
import { paymentAccountsService } from "../payments/payment-accounts.service.js";
import { getSettings } from "../settings/settings.routes.js";

const IdParams = z.object({ id: z.uuid("Identificador inválido.") });

/**
 * Tienda en línea (pública, sin sesión): catálogo con lo disponible, pedido y seguimiento.
 * No muestra costos ni cantidades exactas de la bodega: solo si hay o no (y hasta cuánto se puede pedir).
 */
export const storeRoutes = Router();

/** Pedidos en los que aparece cada producto (últimos 14 días): «lo más pedido» cuando hoy no ha llegado nada. */
async function popularity(since: Date) {
  const rows = await prisma.$queryRaw<{ product_id: string; orders: number }[]>`
    SELECT oi.product_id, COUNT(DISTINCT oi.order_id)::int AS orders
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status IN ('DESPACHADO', 'ENTREGADO') AND o.dispatched_at >= ${since}
    GROUP BY oi.product_id`;
  return new Map(rows.map((row) => [row.product_id, row.orders]));
}

storeRoutes.get("/", async (_req, res) => {
  const today = dayRange(todayIn());
  const [settings, categories, committed, payment, arrivals, popular] = await Promise.all([
    getSettings(),
    prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        products: {
          where: { active: true, inStore: true },
          orderBy: { name: "asc" },
          include: { photo: { select: { updatedAt: true } } },
        },
      },
    }),
    committedByProduct(prisma),
    paymentAccountsService.forStore(),
    // Lo que llegó hoy (entradas de mercancía desde la medianoche, hora de Colombia).
    prisma.inventoryMovement.groupBy({ by: ["productId"], where: { type: "ENTRADA", createdAt: { gte: today.start, lt: today.end } }, _max: { createdAt: true } }),
    popularity(new Date(today.start.getTime() - 14 * 86_400_000)),
  ]);
  const arrivedAt = new Map(arrivals.map((row) => [row.productId, row._max.createdAt]));
  res.set("Cache-Control", "no-store").json({
    data: {
      // Cuentas para pagar por transferencia (llave Bre-B, Nequi, Daviplata, banco) y cuáles van con cada forma de pago.
      payment,
      business: {
        name: settings.businessName, phone: settings.phone, whatsapp: settings.whatsapp, address: settings.address,
        open: settings.storeOpen, minOrderTotal: settings.minOrderTotal, timeZone: env.TIME_ZONE,
      },
      today: todayIn(),
      categories: categories
        .filter((category) => category.products.length > 0)
        .map((category) => ({
          id: category.id,
          name: category.name,
          products: category.products.map((product) => {
            const step = product.unit === "KG" ? 250 : 1000;
            const availableMilli = Math.max(0, product.stockMilli - (committed.get(product.id) ?? 0));
            const available = availableMilli >= step;
            return {
              id: product.id, name: product.name, description: product.description, unit: product.unit, price: product.price,
              available,
              maxQty: Math.floor(availableMilli / step) * (step / 1000),
              // «Quedan pocos»: bajo el mínimo de la bodega o menos de tres pasos (¾ kg o 3 unidades).
              fewLeft: available && (availableMilli <= product.minStockMilli || availableMilli < step * 3),
              arrivedAt: arrivedAt.get(product.id) ?? null,
              cutOptions: product.cutOptions,
              photo: photoUrls(product),
              popularity: popular.get(product.id) ?? 0,
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

/** QR de pago en PNG, para guardarlo y cargarlo en la app del banco desde el mismo celular. */
storeRoutes.get("/payment-accounts/:id/qr.png", trackingLimiter, validate({ params: IdParams }), async (req, res) => {
  const png = await paymentAccountsService.qrPng((req.params as z.infer<typeof IdParams>).id);
  res.set("Cache-Control", "no-store").set("Content-Disposition", 'inline; filename="qr-de-pago.png"').type("png").send(png);
});

storeRoutes.get("/orders/:id", trackingLimiter, validate({ params: IdParams }), async (req, res) => {
  const key = req.get("x-order-key") ?? "";
  res.set("Cache-Control", "no-store").json({ data: await ordersService.track((req.params as z.infer<typeof IdParams>).id, key) });
});
