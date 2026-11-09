import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { PaymentMethod } from "../../generated/prisma/enums.js";
import { addDays, dateIn, startOfDay } from "../../utils/dates.js";

/** Una venta es un pedido que salió de la pesquera (despachado o entregado) y no se anuló. */
const SOLD = ["DESPACHADO", "ENTREGADO"] as const;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  NEQUI: "Nequi",
  DATAFONO: "Datáfono",
  CREDITO: "Crédito",
};

export const todayIn = (timeZone = env.TIME_ZONE) => dateIn(new Date(), timeZone);

/** Rango [inicio, fin) de un día de calendario en la zona horaria de la pesquera. */
export function dayRange(date: string) {
  return { start: startOfDay(date, env.TIME_ZONE), end: startOfDay(addDays(date, 1), env.TIME_ZONE) };
}

export const salesService = {
  /** Ventas de un día y cierre de caja: totales por forma de pago, cobrado vs. por cobrar, kilos y ganancia estimada. */
  async day(date: string) {
    const { start, end } = dayRange(date);
    const [orders, cancelled, costRows] = await Promise.all([
      prisma.order.findMany({
        where: { status: { in: [...SOLD] }, dispatchedAt: { gte: start, lt: end } },
        include: { items: true, createdBy: { select: { name: true } } },
        orderBy: { dispatchedAt: "desc" },
      }),
      prisma.order.count({ where: { status: "CANCELADO", cancelledAt: { gte: start, lt: end } } }),
      // Costo de lo vendido: las salidas guardan el costo promedio del momento en que se despachó.
      prisma.$queryRaw<{ cost: number }[]>`
        SELECT COALESCE(SUM(-m.qty_milli::float8 * COALESCE(m.unit_cost, 0) / 1000), 0)::float8 AS cost
        FROM inventory_movements m JOIN orders o ON o.id = m.order_id
        WHERE m.type = 'SALIDA_PEDIDO' AND o.status IN ('DESPACHADO', 'ENTREGADO')
          AND o.dispatched_at >= ${start} AND o.dispatched_at < ${end}`,
    ]);

    const byPayment = new Map<PaymentMethod, { total: number; count: number }>();
    const bySource = new Map<string, { total: number; count: number }>();
    const products = new Map<string, { productId: string; name: string; unit: string; qtyMilli: number; total: number }>();
    let total = 0;
    let collected = 0;
    let kgMilli = 0;
    let unitsMilli = 0;
    let deliveryFees = 0;

    for (const order of orders) {
      total += order.total;
      deliveryFees += order.deliveryFee;
      if (order.paidAt) collected += order.total;
      const payment = byPayment.get(order.paymentMethod) ?? { total: 0, count: 0 };
      payment.total += order.total;
      payment.count += 1;
      byPayment.set(order.paymentMethod, payment);
      const source = bySource.get(order.source) ?? { total: 0, count: 0 };
      source.total += order.total;
      source.count += 1;
      bySource.set(order.source, source);
      for (const item of order.items) {
        const milli = item.actualQtyMilli ?? item.qtyMilli;
        if (item.unit === "KG") kgMilli += milli;
        else unitsMilli += milli;
        const product = products.get(item.productId) ?? { productId: item.productId, name: item.productName, unit: item.unit, qtyMilli: 0, total: 0 };
        product.qtyMilli += milli;
        product.total += item.lineTotal;
        products.set(item.productId, product);
      }
    }

    const costOfGoods = Math.round(Number(costRows[0]?.cost ?? 0));
    const productRevenue = total - deliveryFees;
    return {
      date,
      summary: {
        total,
        count: orders.length,
        avgTicket: orders.length ? Math.round(total / orders.length) : 0,
        collected,
        pending: total - collected,
        kgMilli,
        unitsMilli,
        deliveryFees,
        costOfGoods,
        /** Ganancia bruta estimada: ventas de producto − costo promedio de lo vendido. */
        grossProfit: productRevenue - costOfGoods,
        marginPct: productRevenue > 0 ? Math.round(((productRevenue - costOfGoods) / productRevenue) * 1000) / 10 : 0,
        cancelled,
      },
      byPayment: [...byPayment.entries()].map(([method, value]) => ({ method, label: PAYMENT_LABELS[method], ...value })).sort((a, b) => b.total - a.total),
      bySource: [...bySource.entries()].map(([source, value]) => ({ source, ...value })).sort((a, b) => b.total - a.total),
      topProducts: [...products.values()].sort((a, b) => b.total - a.total).slice(0, 10),
      orders: orders.map((order) => ({
        id: order.id,
        number: order.number,
        dispatchedAt: order.dispatchedAt,
        customerName: order.customerName,
        source: order.source,
        deliveryType: order.deliveryType,
        paymentMethod: order.paymentMethod,
        paymentLabel: PAYMENT_LABELS[order.paymentMethod],
        paid: order.paidAt !== null,
        status: order.status,
        total: order.total,
        itemCount: order.items.length,
        createdByName: order.createdBy?.name ?? null,
      })),
    };
  },
};
