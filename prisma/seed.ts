/**
 * Datos de demostración para desarrollo:  npm run db:seed
 *
 * Crea la pesquera de ejemplo, el equipo (un usuario por rol), el catálogo y 14 días de historia
 * (llegadas de mercancía, pedidos, ventas, mermas) para que el tablero en vivo tenga qué mostrar.
 * Si ya hay productos no hace nada; con SEED_RESET=1 borra todo y vuelve a empezar.
 * En producción no se ejecuta.
 */
import { randomUUID } from "node:crypto";
import { DEMO_PASSWORD, DEMO_USERS } from "../src/config/demo.js";
import { prisma } from "../src/config/database.js";
import { env, isProduction } from "../src/config/env.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import type { DeliveryType, OrderSource, OrderStatus, PaymentMethod, Unit } from "../src/generated/prisma/enums.js";
import { addDays, dateIn, startOfDay } from "../src/utils/dates.js";
import { ordersService } from "../src/modules/orders/orders.service.js";
import { hashPassword } from "../src/utils/password.js";
import { lineTotal } from "../src/utils/quantity.js";

if (isProduction) {
  console.error("El seed de demostración no se ejecuta en producción.");
  process.exit(1);
}



interface DemoProduct {
  name: string;
  unit: Unit;
  price: number;
  cost: number;
  min: number;
  /** Cuánto se vende en un día normal (kilos o unidades). */
  daily: number;
  description?: string;
}

const CATALOG: { category: string; products: DemoProduct[] }[] = [
  {
    category: "Pescados",
    products: [
      { name: "Mojarra roja", unit: "KG", price: 22000, cost: 15000, min: 15, daily: 14, description: "Entera, fresca del día. Se entrega limpia si la pides." },
      { name: "Bocachico", unit: "KG", price: 14000, cost: 9000, min: 15, daily: 12, description: "Del río Sinú." },
      { name: "Pargo rojo", unit: "KG", price: 38000, cost: 27000, min: 10, daily: 8, description: "Pesca artesanal del golfo de Morrosquillo." },
      { name: "Sierra", unit: "KG", price: 26000, cost: 18000, min: 10, daily: 9, description: "Entera o en postas." },
      { name: "Róbalo", unit: "KG", price: 42000, cost: 30000, min: 8, daily: 5 },
      { name: "Bagre", unit: "KG", price: 28000, cost: 19000, min: 8, daily: 6, description: "En postas." },
      { name: "Lebranche", unit: "KG", price: 18000, cost: 12000, min: 6, daily: 4 },
    ],
  },
  {
    category: "Mariscos",
    products: [
      { name: "Camarón tití", unit: "KG", price: 48000, cost: 34000, min: 8, daily: 7 },
      { name: "Langostino", unit: "KG", price: 72000, cost: 52000, min: 5, daily: 4, description: "Calibre 16/20, con cáscara." },
      { name: "Calamar", unit: "KG", price: 36000, cost: 24000, min: 5, daily: 4, description: "Limpio, en anillos o entero." },
      { name: "Pulpo", unit: "KG", price: 58000, cost: 41000, min: 4, daily: 2.5 },
      { name: "Pulpa de jaiba", unit: "KG", price: 64000, cost: 45000, min: 3, daily: 1.5 },
    ],
  },
  {
    category: "Filetes",
    products: [
      { name: "Filete de tilapia", unit: "KG", price: 32000, cost: 22000, min: 8, daily: 7 },
      { name: "Filete de basa", unit: "KG", price: 26000, cost: 17000, min: 8, daily: 6 },
      { name: "Filete de salmón", unit: "KG", price: 89000, cost: 65000, min: 4, daily: 2 },
      { name: "Lomo de atún", unit: "KG", price: 54000, cost: 38000, min: 4, daily: 2.5 },
    ],
  },
  {
    category: "Preparados y otros",
    products: [
      { name: "Bandeja para cazuela", unit: "UNIDAD", price: 38000, cost: 26000, min: 6, daily: 5, description: "1 kg de mezcla de mariscos lista para cazuela." },
      { name: "Bolsa de hielo 5 kg", unit: "UNIDAD", price: 4000, cost: 1800, min: 20, daily: 18 },
      { name: "Salsa tártara 250 g", unit: "UNIDAD", price: 7500, cost: 4200, min: 6, daily: 3 },
    ],
  },
];

const CUSTOMERS = [
  ["Restaurante El Muelle", "3004561234", "Av. Las Peñitas # 22-10"],
  ["Asadero La Bahía", "3015552211", "Calle 28 # 15-40"],
  ["María Fernanda Ruiz", "3107894561", "Barrio Majagual, Cra 9 # 4-15"],
  ["Hotel Playa Mar", "3186543210", "Vía al mar km 2"],
  ["Pedro Luis Salgado", "3123334455", "Barrio Venecia, Calle 20 # 30-12"],
  ["Cevichería Don Chepe", "3209876543", "Calle 22 # 18-05"],
  ["Ana Milena Tous", "3145556677", "Urb. Los Alpes, Mz 4 Casa 8"],
  ["Comidas Rápidas El Golfo", "3001112233", "Cra 25 # 26-60"],
  ["Jorge Eliécer Martínez", "3157778899", "Barrio La Gallera, Calle 9 # 12-33"],
  ["Club de Pesca Morrosquillo", "3173219876", "Muelle principal"],
  ["Rosa Elena Vergara", "3026667788", "Barrio Pioneros, Cra 4 # 16-20"],
  ["Restaurante Sabor Sinú", "3112223344", "Calle 18 # 21-14"],
] as const;

/** Cómo puede pedir el cliente cada producto de la demostración. */
export function cutsFor(category: string, name: string): string[] {
  if (category === "Pescados") return ["Entero", "Limpio", "Sin cabeza", "En postas", "En filete"];
  if (/Camarón|Langostino/.test(name)) return ["Entero", "Pelado", "Pelado y desvenado"];
  if (name === "Calamar") return ["Entero", "En anillos"];
  if (name === "Pulpo") return ["Entero", "Limpio"];
  return [];
}

const SUPPLIERS = ["Lancha La Esperanza", "Asociación de Pescadores de Tolú", "Acuícola del Sinú", "Distribuidora Mar Caribe"];

// Generador pseudoaleatorio con semilla: la demostración sale igual cada vez.
let seed = 20261108;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
function weighted<T>(entries: [T, number][]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[0]![0];
}

/** Hora del día con picos de madrugada (restaurantes) y de tarde. */
const HOUR_WEIGHTS: [number, number][] = [
  [6, 5], [7, 9], [8, 10], [9, 8], [10, 7], [11, 6], [12, 4], [13, 3], [14, 4], [15, 5], [16, 7], [17, 8], [18, 5],
];

async function reset() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(({ tablename }) => `"${tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function main() {
  if (process.env.SEED_RESET === "1") {
    await reset();
    console.log("Base de datos vaciada.");
  } else if ((await prisma.product.count()) > 0) {
    console.log("Ya hay datos: no se crea la demostración (usa SEED_RESET=1 npm run db:seed para empezar de cero).");
    return;
  }

  const tz = env.TIME_ZONE;
  const now = new Date();
  const today = dateIn(now, tz);

  await prisma.setting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      businessName: "Pesquera Bahía Azul",
      phone: "573004567890",
      whatsapp: "573004567890",
      address: "Calle 15 # 12-30, Tolú, Sucre",
      storeOpen: true,
      deliveryFee: 0,
      minOrderTotal: 20000,
    },
    update: {},
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = await Promise.all(DEMO_USERS.map((user) => prisma.user.create({ data: { ...user, passwordHash } })));
  const [admin, ventas, despacho, bodega] = users as [(typeof users)[number], (typeof users)[number], (typeof users)[number], (typeof users)[number]];

  const customers = await Promise.all(
    CUSTOMERS.map(([name, phone, address]) => prisma.customer.create({ data: { name, phone: `57${phone}`, address } })),
  );

  type Live = DemoProduct & { id: string; categoryId: string; stock: number; avgCost: number };
  const products: Live[] = [];
  for (const [index, group] of CATALOG.entries()) {
    const category = await prisma.category.create({ data: { name: group.category, sortOrder: index } });
    for (const product of group.products) {
      const created = await prisma.product.create({
        data: {
          name: product.name, description: product.description, unit: product.unit, price: product.price,
          minStockMilli: product.min * 1000, categoryId: category.id, cutOptions: cutsFor(group.category, product.name),
        },
      });
      products.push({ ...product, id: created.id, categoryId: category.id, stock: 0, avgCost: product.cost });
    }
  }

  const movements: (Prisma.InventoryMovementCreateManyInput & { createdAt: Date })[] = [];
  const orders: (Prisma.OrderCreateManyInput & { createdAt: Date })[] = [];
  const items: Prisma.OrderItemCreateManyInput[] = [];
  const events: Prisma.OrderEventCreateManyInput[] = [];

  const at = (date: string, hour: number, minute = Math.floor(rand() * 60)) => new Date(startOfDay(date, tz).getTime() + (hour * 60 + minute) * 60_000);
  // Nada puede quedar en el futuro: los pedidos de hace un momento terminan «hace 30 segundos».
  const plusMinutes = (date: Date, minutes: number) => new Date(Math.min(date.getTime() + minutes * 60_000, now.getTime() - 30_000));
  const nowParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const nowMinutes = Number(nowParts.find((part) => part.type === "hour")?.value) * 60 + Number(nowParts.find((part) => part.type === "minute")?.value);

  /** Entrada de mercancía: llega lo de ~2,5 días de venta y se ajusta el costo promedio. */
  function receive(product: Live, when: Date, days = 2.5, atLeastMilli = 0) {
    const planned = Math.round(product.daily * days * (0.8 + rand() * 0.5) * (product.unit === "KG" ? 1000 : 1)) * (product.unit === "KG" ? 1 : 1000);
    const qtyMilli = Math.max(planned, Math.ceil(atLeastMilli / 1000) * 1000);
    const unitCost = Math.round((product.cost * (0.93 + rand() * 0.14)) / 50) * 50;
    product.avgCost = Math.round((product.stock * product.avgCost + qtyMilli * unitCost) / (product.stock + qtyMilli));
    product.stock += qtyMilli;
    movements.push({
      id: randomUUID(), productId: product.id, type: "ENTRADA", qtyMilli, stockAfterMilli: product.stock, unitCost,
      supplier: product.unit === "KG" ? pick(SUPPLIERS) : "Distribuidora Mar Caribe", userId: bodega.id, createdAt: when,
    });
  }

  const HISTORY = 14;
  for (let offset = HISTORY - 1; offset >= 0; offset--) {
    const date = addDays(today, -offset);
    const isToday = offset === 0;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    // Viernes y sábado se vende más; el domingo, menos.
    const dayFactor = weekday === 5 || weekday === 6 ? 1.3 : weekday === 0 ? 0.75 : 1;

    // Llega la lancha a las 5 a. m.: se repone lo que esté por debajo de dos días de venta.
    for (const product of products) {
      if (product.stock < product.daily * 3 * 1000) receive(product, at(date, 5, Math.floor(rand() * 40)), 3.2);
    }

    const orderCount = Math.round((26 + rand() * 12) * dayFactor);
    const slots = Array.from({ length: orderCount }, () => {
      const hour = weighted(HOUR_WEIGHTS);
      return { hour, minute: Math.floor(rand() * 60) };
    })
      .filter((slot) => !isToday || slot.hour * 60 + slot.minute < nowMinutes - 2)
      .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

    for (const [index, slot] of slots.entries()) {
      const createdAt = at(date, slot.hour, slot.minute);
      const minutesAgo = (now.getTime() - createdAt.getTime()) / 60_000;
      const isBusiness = rand() < 0.35;
      const customer = rand() < 0.7 ? pick(customers) : null;
      const source: OrderSource = weighted([["MOSTRADOR", 42], ["WHATSAPP", 26], ["TELEFONO", 17], ["WEB", 15]]);
      // La pesquera no hace domicilios: todos los pedidos se recogen en el local.
      const deliveryType: DeliveryType = "RECOGE";
      const paymentMethod: PaymentMethod = weighted([["EFECTIVO", 40], ["NEQUI", 25], ["TRANSFERENCIA", 15], ["DATAFONO", 12], ["CREDITO", isBusiness ? 25 : 3]]);

      // Pedidos de hoy aún en curso: los más recientes siguen abiertos.
      let status: OrderStatus = "ENTREGADO";
      if (isToday && minutesAgo < 75 && source !== "MOSTRADOR") {
        status = minutesAgo < 12 ? "RECIBIDO" : minutesAgo < 25 ? "ALISTANDO" : minutesAgo < 40 ? "LISTO" : "ENTREGADO";
      }
      if (!isToday && rand() < 0.03) status = "CANCELADO";

      const lineCount = weighted([[1, 40], [2, 32], [3, 18], [4, 10]]);
      const chosen = new Set<Live>();
      while (chosen.size < lineCount) chosen.add(weighted(products.map((product) => [product, product.daily] as [Live, number])));

      const orderId = randomUUID();
      const lines = [...chosen].map((product) => {
        let qtyMilli: number;
        if (product.unit === "KG") {
          const kg = isBusiness ? 3 + rand() * 9 : 0.5 + rand() * 2.5;
          qtyMilli = Math.max(500, Math.round(kg * 2) * 500);
        } else {
          qtyMilli = (isBusiness ? 2 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 2)) * 1000;
        }
        // Reposición extra si se acabó a mitad del día.
        if (status !== "CANCELADO" && product.stock < qtyMilli * 1.1) receive(product, plusMinutes(createdAt, -20), 1.5, qtyMilli * 1.1 - product.stock);
        const weighedOrDone = status !== "RECIBIDO";
        // El peso real casi nunca es exacto: ±6 %.
        const actualQtyMilli = product.unit === "KG" && weighedOrDone ? Math.max(100, Math.round(qtyMilli * (0.95 + rand() * 0.11) / 10) * 10) : null;
        const sold = actualQtyMilli ?? qtyMilli;
        return {
          id: randomUUID(), orderId, productId: product.id, productName: product.name, unit: product.unit, unitPrice: product.price,
          qtyMilli, actualQtyMilli, lineTotal: lineTotal(product.price, sold), note: product.unit === "KG" && rand() < 0.2 ? pick(["Limpio", "En postas", "Sin cabeza", "En filete", "Bien escamado"]) : null,
          _product: product, _sold: sold,
        };
      });

      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const deliveryFee = 0;
      const preparingAt = status === "RECIBIDO" ? null : plusMinutes(createdAt, 3 + rand() * 6);
      const readyAt = ["LISTO", "ENTREGADO"].includes(status) ? plusMinutes(createdAt, 10 + rand() * 12) : null;
      const leaves = status === "ENTREGADO";
      const dispatchedAt = leaves ? (source === "MOSTRADOR" ? plusMinutes(createdAt, 4 + rand() * 6) : plusMinutes(createdAt, 18 + rand() * 20)) : null;
      const deliveredAt = status === "ENTREGADO" ? dispatchedAt : null;
      const creator = source === "WEB" ? null : pick([ventas.id, ventas.id, admin.id]);
      const name = customer?.name ?? pick(["Cliente de mostrador", "Señora Carmen", "Don Álvaro", "Cliente ocasional", "Yuranis", "Ledys", "Don Manuel"]);
      const paid = status !== "CANCELADO" && paymentMethod !== "CREDITO" && (leaves || rand() < 0.3);

      orders.push({
        id: orderId, source, status, deliveryType, customerId: customer?.id ?? null, customerName: name,
        customerPhone: customer?.phone ?? null, address: null,
        notes: index % 9 === 0 ? "Llamar al llegar" : null, paymentMethod, paidAt: paid ? (dispatchedAt ?? createdAt) : null,
        subtotal, deliveryFee, total: subtotal + deliveryFee, createdById: creator, createdAt, preparingAt, readyAt, dispatchedAt, deliveredAt,
        cancelledAt: status === "CANCELADO" ? plusMinutes(createdAt, 8) : null, cancelReason: status === "CANCELADO" ? "El cliente ya no lo necesita" : null,
        updatedAt: deliveredAt ?? dispatchedAt ?? readyAt ?? preparingAt ?? createdAt,
      });
      for (const { _product, _sold, ...line } of lines) {
        items.push(line);
        if (leaves) {
          _product.stock -= _sold;
          movements.push({
            id: randomUUID(), productId: _product.id, type: "SALIDA_PEDIDO", qtyMilli: -_sold, stockAfterMilli: _product.stock,
            unitCost: _product.avgCost, orderId, userId: despacho.id, note: "Pedido", createdAt: dispatchedAt!,
          });
        }
      }
      const timeline: [OrderStatus, Date | null, string | null][] = [
        ["RECIBIDO", createdAt, creator],
        ["ALISTANDO", preparingAt, despacho.id],
        ["LISTO", readyAt, despacho.id],
        ["ENTREGADO", dispatchedAt, despacho.id],
        ["CANCELADO", status === "CANCELADO" ? plusMinutes(createdAt, 8) : null, ventas.id],
      ];
      for (const [eventStatus, when, userId] of timeline) {
        if (when && when <= now) events.push({ id: randomUUID(), orderId, status: eventStatus, userId, createdAt: when });
      }
    }

    // Merma de fin de día en algún producto fresco.
    if (!isToday && rand() < 0.6) {
      const product = pick(products.filter((item) => item.unit === "KG" && item.stock > 2000));
      if (product) {
        const lost = Math.round((0.3 + rand() * 1.2) * 10) * 100;
        product.stock -= lost;
        movements.push({
          id: randomUUID(), productId: product.id, type: "MERMA", qtyMilli: -lost, stockAfterMilli: product.stock, unitCost: product.avgCost,
          note: pick(["Deshidratación en la nevera", "Se dañó por cadena de frío", "Recorte de limpieza"]), userId: bodega.id, createdAt: at(date, 19),
        });
      }
    }
  }

  // Dos productos con existencia baja para que las alertas se vean.
  for (const name of ["Pulpo", "Filete de salmón"]) {
    const product = products.find((item) => item.name === name)!;
    const target = Math.round(product.min * 0.5) * 1000;
    if (product.stock > target) {
      const lost = product.stock - target;
      product.stock = target;
      movements.push({
        id: randomUUID(), productId: product.id, type: "AJUSTE", qtyMilli: -lost, stockAfterMilli: target,
        note: "Conteo físico", userId: bodega.id, createdAt: plusMinutes(now, -95),
      });
    }
  }

  orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  await prisma.order.createMany({ data: orders });
  await prisma.orderItem.createMany({ data: items });
  await prisma.orderEvent.createMany({ data: events });
  movements.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  await prisma.inventoryMovement.createMany({ data: movements });
  for (const product of products) {
    await prisma.product.update({ where: { id: product.id }, data: { stockMilli: product.stock, avgCost: product.avgCost } });
  }

  // Pedidos abiertos ahora mismo (con el servicio real), para que el tablero de pedidos tenga trabajo.
  const asUser = (user: typeof admin) => ({ userId: user.id, sessionId: "seed", name: user.name, role: user.role });
  const byName = (name: string) => products.find((product) => product.name === name)!.id;
  const open = [
    { customer: customers[0]!, source: "WHATSAPP", items: [["Mojarra roja", 6], ["Camarón tití", 2]], to: "LISTO" },
    { customer: customers[3]!, source: "TELEFONO", items: [["Filete de basa", 5], ["Bolsa de hielo 5 kg", 4]], to: "LISTO" },
    { customer: customers[2]!, source: "WHATSAPP", items: [["Pargo rojo", 1.5]], to: "ALISTANDO" },
    { customer: customers[5]!, source: "TELEFONO", items: [["Calamar", 3], ["Camarón tití", 2.5], ["Salsa tártara 250 g", 2]], to: null },
    { customer: customers[6]!, source: "WHATSAPP", items: [["Sierra", 2], ["Bocachico", 3]], to: null },
  ] as const;
  for (const entry of open) {
    const { order } = await ordersService.create(
      {
        source: entry.source, paymentMethod: "EFECTIVO", paid: false, completeNow: false,
        customer: { name: entry.customer.name, phone: entry.customer.phone },
        items: entry.items.map(([name, qty]) => ({ productId: byName(name), qty })),
      },
      asUser(ventas),
    );
    if (entry.to) {
      const weighed = await ordersService.weigh(
        order.id,
        order.items.filter((item) => item.unit === "KG").map((item) => ({ itemId: item.id, actualQty: Math.round((item.qtyMilli / 1000) * (0.97 + rand() * 0.06) * 100) / 100 })),
        asUser(despacho),
      );
      if (entry.to !== "ALISTANDO") await ordersService.changeStatus(weighed.id, "LISTO", asUser(despacho));
    }
  }

  console.log(`Pesquera de demostración lista: ${products.length} productos, ${orders.length + open.length} pedidos en ${HISTORY} días, ${movements.length} movimientos de inventario.`);
  console.log(`Entra en ${env.APP_URL}/login con cualquiera de estos usuarios (contraseña: ${DEMO_PASSWORD}):`);
  for (const user of DEMO_USERS) console.log(`  · ${user.email.padEnd(24)} ${user.role}`);
}

await main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
