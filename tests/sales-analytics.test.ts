import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { product, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings({ deliveryFee: 5000 });
});

async function sell(agent: Awaited<ReturnType<typeof staff>>["agent"], items: { productId: string; qty: number }[], paymentMethod = "EFECTIVO") {
  const res = await agent.post("/api/v1/orders").send({
    source: "MOSTRADOR", deliveryType: "RECOGE", paymentMethod, customer: { name: "Cliente" }, items, completeNow: true,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe("ventas del día", () => {
  it("suma ventas, formas de pago, lo cobrado, los kilos y la ganancia estimada", async () => {
    const { agent } = await staff("ADMIN");
    const mojarra = await product({ price: 20000, stock: 50, cost: 14000 });
    const hielo = await product({ unit: "UNIDAD", price: 4000, stock: 50, cost: 2000 });
    await sell(agent, [{ productId: mojarra.id, qty: 2 }, { productId: hielo.id, qty: 1 }]);
    await sell(agent, [{ productId: mojarra.id, qty: 1.5 }], "NEQUI");
    await sell(agent, [{ productId: hielo.id, qty: 5 }], "CREDITO");

    const res = await agent.get("/api/v1/sales/day");

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toMatchObject({
      total: 94000, count: 3, avgTicket: 31333, collected: 74000, pending: 20000, kgMilli: 3500, unitsMilli: 6000,
      // Costo: 3,5 kg × 14.000 + 6 und × 2.000 = 61.000
      costOfGoods: 61000, grossProfit: 33000, marginPct: 35.1, cancelled: 0,
    });
    expect(res.body.data.byPayment.map((row: { method: string; total: number }) => [row.method, row.total])).toEqual([["EFECTIVO", 44000], ["NEQUI", 30000], ["CREDITO", 20000]]);
    expect(res.body.data.topProducts[0]).toMatchObject({ productId: mojarra.id, qtyMilli: 3500, total: 70000 });
  });

  it("cuenta cada venta en el día de Colombia, no en el de UTC", async () => {
    const { agent } = await staff("ADMIN");
    const pargo = await product({ price: 30000, stock: 10 });
    const order = await sell(agent, [{ productId: pargo.id, qty: 1 }]);
    // 7 de noviembre a las 11:30 p. m. en Colombia = 8 de noviembre 04:30 UTC.
    await prisma.order.update({ where: { id: order.id }, data: { dispatchedAt: new Date("2026-11-08T04:30:00Z") } });

    const nov7 = await agent.get("/api/v1/sales/day?date=2026-11-07");
    const nov8 = await agent.get("/api/v1/sales/day?date=2026-11-08");

    expect(nov7.body.data.summary.total).toBe(30000);
    expect(nov8.body.data.summary.total).toBe(0);
  });
});

describe("tablero en vivo", () => {
  it("resume el día: ventas, pedidos abiertos, ventas por hora y categoría, y la bodega", async () => {
    const { agent } = await staff("ADMIN");
    const mojarra = await product({ name: "Mojarra roja", price: 20000, stock: 10, cost: 14000, min: 9 });
    await sell(agent, [{ productId: mojarra.id, qty: 2 }]);
    await agent.post("/api/v1/orders").send({
      source: "WHATSAPP", deliveryType: "RECOGE", paymentMethod: "EFECTIVO", customer: { name: "Pendiente" }, items: [{ productId: mojarra.id, qty: 1 }],
    });

    const res = await agent.get("/api/v1/analytics/live");

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.kpis).toMatchObject({ salesToday: 40000, ordersToday: 1, avgTicket: 40000, kgSoldMilli: 2000, openOrders: 1, lowStock: 1 });
    expect(data.salesByHourCategory).toHaveLength(1);
    expect(data.salesByHourCategory[0]).toMatchObject({ categoryId: mojarra.categoryId, total: 40000 });
    expect(data.days).toHaveLength(14);
    expect(data.inventory[0]).toMatchObject({ name: "Mojarra roja", stockMilli: 8000, committedMilli: 1000, availableMilli: 7000, level: "BAJO", stockValue: 112000 });
    expect(data.pipeline.find((row: { status: string }) => row.status === "RECIBIDO").count).toBe(1);
    expect(data.activity.length).toBeGreaterThan(0);
  });
});
