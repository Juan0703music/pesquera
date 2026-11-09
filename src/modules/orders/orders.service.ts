import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { OrderSource, OrderStatus, PaymentMethod } from "../../generated/prisma/enums.js";
import { live } from "../../services/live.service.js";
import type { AuthContext } from "../../types/express.js";
import { dateIn, startOfDay } from "../../utils/dates.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/errors.js";
import { formatCOP } from "../../utils/money.js";
import { formatQty, lineTotal, toMilli } from "../../utils/quantity.js";
import { generateToken, hashToken } from "../auth/auth.service.js";
import { applyStockChange, committedByProduct, OPEN_STATUSES } from "../inventory/stock.js";
import { paymentAccountsService } from "../payments/payment-accounts.service.js";
import { getSettings } from "../settings/settings.routes.js";
import type { CreateOrderInput, ItemInput, StoreOrderInput } from "./orders.schemas.js";

/** Orden del flujo: solo se avanza, nunca se devuelve. */
const FLOW: OrderStatus[] = ["RECIBIDO", "ALISTANDO", "LISTO", "DESPACHADO", "ENTREGADO"];
const isOpen = (status: OrderStatus) => (OPEN_STATUSES as readonly OrderStatus[]).includes(status);

export const STATUS_LABELS: Record<OrderStatus, string> = {
  RECIBIDO: "Recibido",
  ALISTANDO: "Alistando",
  LISTO: "Listo",
  DESPACHADO: "Despachado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};

const orderInclude = {
  items: { orderBy: { id: "asc" } },
  createdBy: { select: { name: true } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Lo que ve el panel de un pedido (sin la clave de seguimiento). */
function toDto(order: OrderWithItems) {
  const { trackingKeyHash: _hidden, createdBy, ...rest } = order;
  return { ...rest, createdByName: createdBy?.name ?? null, statusLabel: STATUS_LABELS[order.status], paid: order.paidAt !== null };
}

interface BuiltLine {
  productId: string;
  productName: string;
  unit: "KG" | "UNIDAD";
  unitPrice: number;
  qtyMilli: number;
  lineTotal: number;
  note: string | null;
}

/** Valida los productos y calcula cada línea con el precio vigente. */
async function buildLines(tx: Prisma.TransactionClient, items: ItemInput[], { store }: { store: boolean }): Promise<BuiltLine[]> {
  const ids = [...new Set(items.map((item) => item.productId))];
  const products = new Map((await tx.product.findMany({ where: { id: { in: ids } } })).map((product) => [product.id, product]));
  return items.map((item) => {
    const product = products.get(item.productId);
    if (!product || !product.active || (store && !product.inStore)) {
      throw badRequest(product ? `${product.name} ya no está a la venta.` : "Uno de los productos ya no existe.", "PRODUCT_UNAVAILABLE");
    }
    const qtyMilli = toMilli(item.qty, product.unit, product.name);
    return {
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      unitPrice: product.price,
      qtyMilli,
      lineTotal: lineTotal(product.price, qtyMilli),
      note: item.note ?? null,
    };
  });
}

/** Productos del pedido cuya cantidad supera lo disponible (existencia − pedidos abiertos). */
async function shortages(tx: Prisma.TransactionClient, lines: BuiltLine[]) {
  const ids = [...new Set(lines.map((line) => line.productId))];
  const [products, committed] = await Promise.all([
    tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true, stockMilli: true } }),
    committedByProduct(tx, ids),
  ]);
  const wanted = new Map<string, number>();
  for (const line of lines) wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.qtyMilli);
  return products
    .map((product) => ({ ...product, wantedMilli: wanted.get(product.id) ?? 0, availableMilli: product.stockMilli - (committed.get(product.id) ?? 0) }))
    .filter((product) => product.wantedMilli > product.availableMilli)
    .map((product) => ({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      wantedMilli: product.wantedMilli,
      availableMilli: Math.max(0, product.availableMilli),
      message: `${product.name}: piden ${formatQty(product.wantedMilli, product.unit)} y hay disponible ${formatQty(Math.max(0, product.availableMilli), product.unit)}.`,
    }));
}

/** Cliente por celular: lo crea o actualiza su nombre y dirección. */
async function upsertCustomer(tx: Prisma.TransactionClient, customer: { name: string; phone?: string; address?: string }) {
  if (!customer.phone) return null;
  return tx.customer.upsert({
    where: { phone: customer.phone },
    create: { name: customer.name, phone: customer.phone, address: customer.address ?? null },
    update: { name: customer.name, ...(customer.address ? { address: customer.address } : {}) },
  });
}

/** Descuenta del inventario lo que sale con el pedido (peso real si se pesó) y deja el costo de lo vendido. */
async function deductStock(tx: Prisma.TransactionClient, order: OrderWithItems, userId: string | null) {
  const perProduct = new Map<string, number>();
  for (const item of order.items) perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0) + (item.actualQtyMilli ?? item.qtyMilli));
  for (const [productId, milli] of perProduct) {
    const { avgCost } = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { avgCost: true } });
    await applyStockChange(tx, { productId, deltaMilli: -milli, type: "SALIDA_PEDIDO", unitCost: avgCost, orderId: order.id, userId, note: `Pedido #${order.number}` });
  }
}

/** Devuelve al inventario la mercancía de un pedido despachado que se anula. */
async function returnStock(tx: Prisma.TransactionClient, order: OrderWithItems, userId: string) {
  const movements = await tx.inventoryMovement.groupBy({ by: ["productId"], where: { orderId: order.id }, _sum: { qtyMilli: true } });
  for (const movement of movements) {
    const net = movement._sum.qtyMilli ?? 0;
    if (net < 0) await applyStockChange(tx, { productId: movement.productId, deltaMilli: -net, type: "DEVOLUCION", orderId: order.id, userId, note: `Pedido #${order.number} anulado` });
  }
}

async function findOrder(id: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const order = await db.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw notFound("El pedido no existe.");
  return order;
}

/**
 * Cambia el estado solo si nadie lo cambió mientras tanto (dos personas pulsando a la vez no descuentan dos veces).
 */
async function guardedUpdate(tx: Prisma.TransactionClient, order: OrderWithItems, data: Prisma.OrderUpdateManyMutationInput) {
  const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status, updatedAt: order.updatedAt }, data });
  if (count === 0) throw conflict("Otra persona acaba de modificar este pedido. Revisa su estado actual.", "CONCURRENT_UPDATE");
}

async function totalsFor(lines: { lineTotal: number }[], deliveryFee: number) {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function announceCreated(order: OrderWithItems) {
  live.emit("orders", "order.created", {
    id: order.id, number: order.number, customerName: order.customerName, total: order.total, source: order.source, status: order.status,
  });
  if (!isOpen(order.status)) live.emit("inventory", "inventory.sale", { number: order.number });
}

export const ordersService = {
  STATUS_LABELS,

  /** Pedido del personal. Devuelve avisos si algún producto supera lo disponible (no lo impide: el pesaje manda). */
  async create(input: CreateOrderInput, actor: AuthContext) {
    const settings = await getSettings();
    const result = await prisma.$transaction(async (tx) => {
      const lines = await buildLines(tx, input.items, { store: false });
      const warnings = await shortages(tx, lines);
      const customer = await upsertCustomer(tx, input.customer);
      const fee = input.deliveryType === "DOMICILIO" ? (input.deliveryFee ?? settings.deliveryFee) : 0;
      const totals = await totalsFor(lines, fee);
      const now = new Date();
      const paidAt = input.paymentMethod !== "CREDITO" && (input.paid || input.completeNow) ? now : null;
      const created = await tx.order.create({
        data: {
          source: input.source as OrderSource,
          status: input.completeNow ? "ENTREGADO" : "RECIBIDO",
          deliveryType: input.deliveryType,
          customerId: customer?.id ?? null,
          customerName: input.customer.name,
          customerPhone: input.customer.phone ?? null,
          address: input.deliveryType === "DOMICILIO" ? (input.customer.address ?? null) : null,
          notes: input.notes ?? null,
          paymentMethod: input.paymentMethod,
          paidAt,
          ...totals,
          createdById: actor.userId,
          ...(input.completeNow ? { dispatchedAt: now, deliveredAt: now } : {}),
          items: { create: lines },
          events: { create: { status: input.completeNow ? "ENTREGADO" : "RECIBIDO", userId: actor.userId, note: input.completeNow ? "Venta de mostrador" : null } },
        },
        include: orderInclude,
      });
      if (input.completeNow) await deductStock(tx, created, actor.userId);
      return { order: created, warnings: input.completeNow ? [] : warnings };
    });
    announceCreated(result.order);
    return { order: toDto(result.order), warnings: result.warnings };
  },

  /** Pedido de la tienda en línea: no deja pedir más de lo disponible. Devuelve la clave de seguimiento. */
  async createFromStore(input: StoreOrderInput) {
    const settings = await getSettings();
    if (!settings.storeOpen) throw conflict("La tienda no está recibiendo pedidos en este momento.", "STORE_CLOSED");
    const trackingKey = generateToken();
    const order = await prisma.$transaction(async (tx) => {
      const lines = await buildLines(tx, input.items, { store: true });
      const missing = await shortages(tx, lines);
      if (missing.length > 0) {
        throw conflict(`No alcanza el producto disponible. ${missing.map((item) => item.message).join(" ")}`, "OUT_OF_STOCK");
      }
      const totals = await totalsFor(lines, input.deliveryType === "DOMICILIO" ? settings.deliveryFee : 0);
      if (totals.subtotal < settings.minOrderTotal) {
        throw badRequest(`El pedido mínimo en línea es de ${formatCOP(settings.minOrderTotal)}.`, "MIN_ORDER");
      }
      const customer = await upsertCustomer(tx, input.customer);
      return tx.order.create({
        data: {
          source: "WEB",
          deliveryType: input.deliveryType,
          customerId: customer?.id ?? null,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          address: input.deliveryType === "DOMICILIO" ? (input.customer.address ?? null) : null,
          notes: input.notes ?? null,
          paymentMethod: input.paymentMethod,
          ...totals,
          trackingKeyHash: hashToken(trackingKey),
          items: { create: lines },
          events: { create: { status: "RECIBIDO", note: "Pedido en línea" } },
        },
        include: orderInclude,
      });
    });
    announceCreated(order);
    return { order: toDto(order), trackingKey };
  },

  async list(view: "board" | "all", limit: number) {
    const today = startOfDay(dateIn(new Date(), env.TIME_ZONE), env.TIME_ZONE);
    const where: Prisma.OrderWhereInput =
      view === "board"
        ? {
            OR: [
              { status: { in: [...OPEN_STATUSES, "DESPACHADO"] } },
              { status: "ENTREGADO", deliveredAt: { gte: today } },
              { status: "CANCELADO", cancelledAt: { gte: today } },
            ],
          }
        : {};
    const orders = await prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: view === "board" ? "asc" : "desc" }, take: limit });
    return orders.map(toDto);
  },

  async get(id: string) {
    const order = await findOrder(id);
    const events = await prisma.orderEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } });
    return { ...toDto(order), events: events.map((event) => ({ ...event, statusLabel: STATUS_LABELS[event.status], userName: event.user?.name ?? null })) };
  },

  /** Peso o cantidad real al alistar. Recalcula el total. Si el pedido estaba «Recibido», pasa a «Alistando». */
  async weigh(id: string, items: { itemId: string; actualQty: number }[], actor: AuthContext) {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await findOrder(id, tx);
      if (!isOpen(order.status)) throw conflict("Este pedido ya salió o fue cancelado: no se puede volver a pesar.", "ORDER_CLOSED");
      const byId = new Map(order.items.map((item) => [item.id, item]));
      for (const { itemId, actualQty } of items) {
        const item = byId.get(itemId);
        if (!item) throw badRequest("Una de las líneas no pertenece a este pedido.", "ITEM_MISMATCH");
        const actualQtyMilli = toMilli(actualQty, item.unit, item.productName);
        await tx.orderItem.update({ where: { id: itemId }, data: { actualQtyMilli, lineTotal: lineTotal(item.unitPrice, actualQtyMilli) } });
      }
      const lines = await tx.orderItem.findMany({ where: { orderId: id }, select: { lineTotal: true } });
      const totals = await totalsFor(lines, order.deliveryFee);
      const startsPreparing = order.status === "RECIBIDO";
      await guardedUpdate(tx, order, { ...totals, ...(startsPreparing ? { status: "ALISTANDO", preparingAt: new Date() } : {}) });
      if (startsPreparing) await tx.orderEvent.create({ data: { orderId: id, status: "ALISTANDO", userId: actor.userId, note: "Pesaje" } });
      return findOrder(id, tx);
    });
    live.emit("orders", "order.weighed", { id, number: updated.number, total: updated.total, status: updated.status });
    return toDto(updated);
  },

  /**
   * Avanza el pedido. Al salir de la pesquera (despachado, o entregado si el cliente recoge) se descuenta
   * del inventario en la misma transacción. Si el cliente recoge, «despachar» es entregar.
   */
  async changeStatus(id: string, requested: "ALISTANDO" | "LISTO" | "DESPACHADO" | "ENTREGADO", actor: AuthContext) {
    const result = await prisma.$transaction(async (tx) => {
      const order = await findOrder(id, tx);
      const to: OrderStatus = requested === "DESPACHADO" && order.deliveryType === "RECOGE" ? "ENTREGADO" : requested;
      if (order.status === "CANCELADO") throw conflict("El pedido está cancelado.", "ORDER_CANCELLED");
      if (FLOW.indexOf(to) <= FLOW.indexOf(order.status)) {
        throw conflict(`El pedido ya está «${STATUS_LABELS[order.status]}»: no puede pasar a «${STATUS_LABELS[to]}».`, "INVALID_TRANSITION");
      }
      const now = new Date();
      const leaves = isOpen(order.status) && (to === "DESPACHADO" || to === "ENTREGADO");
      const data: Prisma.OrderUpdateManyMutationInput = { status: to };
      if (to === "ALISTANDO") data.preparingAt = order.preparingAt ?? now;
      if (to === "LISTO") data.readyAt = now;
      if (leaves) data.dispatchedAt = now;
      if (to === "ENTREGADO") data.deliveredAt = now;
      await guardedUpdate(tx, order, data);
      if (leaves) await deductStock(tx, order, actor.userId);
      await tx.orderEvent.create({ data: { orderId: id, status: to, userId: actor.userId } });
      return { order: await findOrder(id, tx), leaves };
    });
    live.emit("orders", "order.status", { id, number: result.order.number, status: result.order.status, customerName: result.order.customerName, by: actor.name });
    if (result.leaves) live.emit("inventory", "inventory.sale", { number: result.order.number });
    return toDto(result.order);
  },

  /** Registra el pago. Con «crédito» queda por cobrar. */
  async collect(id: string, paymentMethod: PaymentMethod, actor: AuthContext) {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await findOrder(id, tx);
      if (order.status === "CANCELADO") throw conflict("El pedido está cancelado.", "ORDER_CANCELLED");
      await guardedUpdate(tx, order, { paymentMethod, paidAt: paymentMethod === "CREDITO" ? null : new Date() });
      await tx.orderEvent.create({
        data: { orderId: id, status: order.status, userId: actor.userId, note: paymentMethod === "CREDITO" ? "Queda a crédito" : `Pagado (${paymentMethod.toLowerCase()})` },
      });
      return findOrder(id, tx);
    });
    live.emit("orders", "order.paid", { id, number: updated.number, total: updated.total, paymentMethod });
    return toDto(updated);
  },

  /** Cancela. Si ya salió, solo el administrador, y la mercancía vuelve al inventario. */
  async cancel(id: string, reason: string, actor: AuthContext) {
    const result = await prisma.$transaction(async (tx) => {
      const order = await findOrder(id, tx);
      if (order.status === "CANCELADO") throw conflict("El pedido ya estaba cancelado.", "ORDER_CANCELLED");
      const alreadyLeft = !isOpen(order.status);
      if (alreadyLeft && actor.role !== "ADMIN") throw forbidden("El pedido ya salió: solo el administrador puede anularlo.", "ADMIN_ONLY");
      await guardedUpdate(tx, order, { status: "CANCELADO", cancelledAt: new Date(), cancelReason: reason });
      if (alreadyLeft) await returnStock(tx, order, actor.userId);
      await tx.orderEvent.create({ data: { orderId: id, status: "CANCELADO", userId: actor.userId, note: reason } });
      return { order: await findOrder(id, tx), alreadyLeft };
    });
    live.emit("orders", "order.cancelled", { id, number: result.order.number, customerName: result.order.customerName, by: actor.name });
    if (result.alreadyLeft) live.emit("inventory", "inventory.return", { number: result.order.number });
    return toDto(result.order);
  },

  /** Seguimiento público de un pedido de la tienda (con su clave). */
  async track(id: string, key: string) {
    const order = await prisma.order.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" } }, events: { orderBy: { createdAt: "asc" } } } });
    if (!order || !order.trackingKeyHash || order.trackingKeyHash !== hashToken(key)) throw notFound("No encontramos ese pedido.");
    // Dónde pagar (si eligió una forma de pago por transferencia) y si el valor ya es el definitivo:
    // lo que va por kilo se pesa al alistar, así que antes del pesaje el total es estimado.
    const open = order.status !== "CANCELADO" && order.paidAt === null;
    const accounts = open ? await paymentAccountsService.forMethod(order.paymentMethod) : [];
    const exact = order.status === "DESPACHADO" || order.status === "ENTREGADO" || order.items.every((item) => item.unit !== "KG" || item.actualQtyMilli !== null);
    return {
      // El WhatsApp de la pesquera, para enviar el comprobante del pago.
      payment: accounts.length ? { accounts, amountDue: order.total, exact, whatsapp: (await getSettings()).whatsapp } : null,
      id: order.id,
      number: order.number,
      status: order.status,
      statusLabel: STATUS_LABELS[order.status],
      deliveryType: order.deliveryType,
      customerName: order.customerName,
      address: order.address,
      paymentMethod: order.paymentMethod,
      paid: order.paidAt !== null,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      createdAt: order.createdAt,
      cancelReason: order.cancelReason,
      items: order.items.map((item) => ({
        productName: item.productName, unit: item.unit, unitPrice: item.unitPrice, qtyMilli: item.qtyMilli, actualQtyMilli: item.actualQtyMilli, lineTotal: item.lineTotal, note: item.note,
      })),
      timeline: order.events.map((event) => ({ status: event.status, statusLabel: STATUS_LABELS[event.status], at: event.createdAt })),
    };
  },
};
