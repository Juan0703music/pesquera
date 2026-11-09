import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { addDays } from "../../utils/dates.js";
import { listProductsWithStock } from "../catalog/catalog.routes.js";
import { STATUS_LABELS } from "../orders/orders.service.js";
import { dayRange, PAYMENT_LABELS, todayIn } from "../sales/sales.service.js";

/** Días del histórico que se dibujan en 3D. */
export const HISTORY_DAYS = 14;

const tz = () => env.TIME_ZONE;

/**
 * Foto del negocio en este instante para el tablero en vivo. El tablero la vuelve a pedir
 * cada vez que llega un aviso por Socket.IO (pedido nuevo, despacho, entrada de mercancía…).
 */
export const analyticsService = {
  async live() {
    const today = todayIn();
    const { start, end } = dayRange(today);
    const now = new Date();
    // Mismo tramo de ayer (desde la medianoche hasta esta misma hora) para comparar en vivo.
    const yesterday = dayRange(addDays(today, -1));
    const yesterdaySameTime = new Date(yesterday.start.getTime() + (now.getTime() - start.getTime()));
    const historyStart = dayRange(addDays(today, -(HISTORY_DAYS - 1))).start;

    const [
      categories,
      kpiRows,
      yesterdayRows,
      byHourCategory,
      byDayCategory,
      pipeline,
      payments,
      sources,
      topProducts,
      inventory,
      events,
      movements,
    ] = await Promise.all([
      prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      prisma.$queryRaw<{ total: number; count: number; avg_minutes: number | null; collected: number }[]>`
        SELECT COALESCE(SUM(total), 0)::float8 AS total, COUNT(*)::int AS count,
               AVG(EXTRACT(EPOCH FROM (dispatched_at - created_at)) / 60)::float8 AS avg_minutes,
               COALESCE(SUM(total) FILTER (WHERE paid_at IS NOT NULL), 0)::float8 AS collected
        FROM orders WHERE status IN ('DESPACHADO', 'ENTREGADO') AND dispatched_at >= ${start} AND dispatched_at < ${end}`,
      prisma.$queryRaw<{ total: number; count: number }[]>`
        SELECT COALESCE(SUM(total), 0)::float8 AS total, COUNT(*)::int AS count
        FROM orders WHERE status IN ('DESPACHADO', 'ENTREGADO') AND dispatched_at >= ${yesterday.start} AND dispatched_at < ${yesterdaySameTime}`,
      prisma.$queryRaw<{ hour: number; category_id: string; total: number; kg_milli: number }[]>`
        SELECT EXTRACT(HOUR FROM o.dispatched_at AT TIME ZONE ${tz()})::int AS hour, p.category_id,
               SUM(oi.line_total)::float8 AS total,
               SUM(CASE WHEN oi.unit = 'KG' THEN COALESCE(oi.actual_qty_milli, oi.qty_milli) ELSE 0 END)::float8 AS kg_milli
        FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
        WHERE o.status IN ('DESPACHADO', 'ENTREGADO') AND o.dispatched_at >= ${start} AND o.dispatched_at < ${end}
        GROUP BY 1, 2`,
      prisma.$queryRaw<{ day: string; category_id: string; total: number }[]>`
        SELECT to_char(o.dispatched_at AT TIME ZONE ${tz()}, 'YYYY-MM-DD') AS day, p.category_id, SUM(oi.line_total)::float8 AS total
        FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
        WHERE o.status IN ('DESPACHADO', 'ENTREGADO') AND o.dispatched_at >= ${historyStart} AND o.dispatched_at < ${end}
        GROUP BY 1, 2`,
      prisma.order.groupBy({ by: ["status"], where: { OR: [{ status: { in: ["RECIBIDO", "ALISTANDO", "LISTO", "DESPACHADO"] } }, { createdAt: { gte: start, lt: end } }] }, _count: true }),
      prisma.order.groupBy({ by: ["paymentMethod"], where: { status: { in: ["DESPACHADO", "ENTREGADO"] }, dispatchedAt: { gte: start, lt: end } }, _sum: { total: true }, _count: true }),
      prisma.order.groupBy({ by: ["source"], where: { createdAt: { gte: start, lt: end }, status: { not: "CANCELADO" } }, _sum: { total: true }, _count: true }),
      prisma.$queryRaw<{ product_id: string; name: string; unit: string; qty_milli: number; total: number }[]>`
        SELECT oi.product_id, MAX(oi.product_name) AS name, MAX(oi.unit::text) AS unit,
               SUM(COALESCE(oi.actual_qty_milli, oi.qty_milli))::float8 AS qty_milli, SUM(oi.line_total)::float8 AS total
        FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status IN ('DESPACHADO', 'ENTREGADO') AND o.dispatched_at >= ${start} AND o.dispatched_at < ${end}
        GROUP BY oi.product_id ORDER BY total DESC LIMIT 8`,
      listProductsWithStock({ active: true }),
      prisma.orderEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 14,
        include: { order: { select: { number: true, customerName: true, total: true, source: true } }, user: { select: { name: true } } },
      }),
      prisma.inventoryMovement.findMany({
        where: { type: { in: ["ENTRADA", "AJUSTE", "MERMA"] } },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { product: { select: { name: true, unit: true } }, user: { select: { name: true } } },
      }),
    ]);

    const kpi = kpiRows[0] ?? { total: 0, count: 0, avg_minutes: null, collected: 0 };
    const prev = yesterdayRows[0] ?? { total: 0, count: 0 };
    const kgToday = byHourCategory.reduce((sum, row) => sum + Number(row.kg_milli), 0);
    const statusCount = (status: string) => pipeline.find((row) => row.status === status)?._count ?? 0;

    const activity = [
      ...events.map((event) => ({
        at: event.createdAt,
        kind: "order" as const,
        status: event.status,
        title: `Pedido #${event.order.number} · ${STATUS_LABELS[event.status]}`,
        detail: [event.order.customerName, event.note, event.user?.name].filter(Boolean).join(" · "),
        amount: event.order.total,
      })),
      ...movements.map((movement) => ({
        at: movement.createdAt,
        kind: "inventory" as const,
        status: movement.type,
        title: `${movement.type === "ENTRADA" ? "Entrada" : movement.type === "MERMA" ? "Merma" : "Ajuste"} · ${movement.product.name}`,
        detail: [movement.supplier, movement.note, movement.user?.name].filter(Boolean).join(" · "),
        qtyMilli: movement.qtyMilli,
        unit: movement.product.unit,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 16);

    return {
      generatedAt: now,
      date: today,
      timeZone: tz(),
      categories,
      kpis: {
        salesToday: Number(kpi.total),
        ordersToday: kpi.count,
        avgTicket: kpi.count ? Math.round(Number(kpi.total) / kpi.count) : 0,
        collectedToday: Number(kpi.collected),
        kgSoldMilli: kgToday,
        avgDispatchMinutes: kpi.avg_minutes === null ? null : Math.round(Number(kpi.avg_minutes)),
        salesYesterdaySameTime: Number(prev.total),
        ordersYesterdaySameTime: prev.count,
        openOrders: statusCount("RECIBIDO") + statusCount("ALISTANDO") + statusCount("LISTO"),
        onTheWay: statusCount("DESPACHADO"),
        lowStock: inventory.filter((product) => product.level !== "OK").length,
        inventoryValue: inventory.reduce((sum, product) => sum + product.stockValue, 0),
      },
      pipeline: (["RECIBIDO", "ALISTANDO", "LISTO", "DESPACHADO", "ENTREGADO", "CANCELADO"] as const).map((status) => ({
        status, label: STATUS_LABELS[status], count: statusCount(status),
      })),
      salesByHourCategory: byHourCategory.map((row) => ({ hour: row.hour, categoryId: row.category_id, total: Number(row.total) })),
      salesByDayCategory: byDayCategory.map((row) => ({ day: row.day, categoryId: row.category_id, total: Number(row.total) })),
      days: Array.from({ length: HISTORY_DAYS }, (_, index) => addDays(today, index - (HISTORY_DAYS - 1))),
      payments: payments
        .map((row) => ({ method: row.paymentMethod, label: PAYMENT_LABELS[row.paymentMethod], total: row._sum.total ?? 0, count: row._count }))
        .sort((a, b) => b.total - a.total),
      sources: sources.map((row) => ({ source: row.source, total: row._sum.total ?? 0, count: row._count })).sort((a, b) => b.count - a.count),
      topProducts: topProducts.map((row) => ({ productId: row.product_id, name: row.name, unit: row.unit, qtyMilli: Number(row.qty_milli), total: Number(row.total) })),
      inventory: inventory.map((product) => ({
        id: product.id,
        name: product.name,
        unit: product.unit,
        categoryId: product.category.id,
        categoryName: product.category.name,
        stockMilli: product.stockMilli,
        committedMilli: product.committedMilli,
        availableMilli: product.availableMilli,
        minStockMilli: product.minStockMilli,
        level: product.level,
        stockValue: product.stockValue,
      })),
      activity,
    };
  },
};
