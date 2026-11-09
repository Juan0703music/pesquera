import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { app, product, settings, staff, stockOf } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings({ deliveryFee: 5000 });
});

const customer = { name: "Restaurante El Muelle", phone: "300 456 1234", address: "Calle 22 # 18-05" };

async function newOrder(agent: request.Agent, items: { productId: string; qty: number; note?: string }[], extra: Record<string, unknown> = {}) {
  return agent.post("/api/v1/orders").send({
    source: "WHATSAPP", deliveryType: "DOMICILIO", paymentMethod: "EFECTIVO", customer, items, ...extra,
  });
}

describe("recibir pedidos", () => {
  it("calcula el total por kilo y por unidad, con el domicilio de la configuración", async () => {
    const { agent } = await staff("VENTAS");
    const mojarra = await product({ price: 22000, stock: 20 });
    const hielo = await product({ unit: "UNIDAD", price: 4000, stock: 30 });

    const res = await newOrder(agent, [{ productId: mojarra.id, qty: 2.5, note: "Limpia" }, { productId: hielo.id, qty: 3 }]);

    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([]);
    const order = res.body.data;
    expect(order.status).toBe("RECIBIDO");
    expect(order.items.map((item: { qtyMilli: number; lineTotal: number }) => [item.qtyMilli, item.lineTotal])).toEqual([[2500, 55000], [3000, 12000]]);
    expect(order).toMatchObject({ subtotal: 67000, deliveryFee: 5000, total: 72000, customerPhone: "573004561234", paid: false });
    // El inventario no se toca al recibir: queda comprometido.
    expect(await stockOf(mojarra.id)).toBe(20000);
    const listed = await agent.get("/api/v1/catalog/products");
    expect(listed.body.data.find((item: { id: string }) => item.id === mojarra.id)).toMatchObject({ stockMilli: 20000, committedMilli: 2500, availableMilli: 17500 });
    // El cliente queda guardado por su celular.
    expect(await prisma.customer.count({ where: { phone: "573004561234" } })).toBe(1);
  });

  it("avisa (sin impedirlo) cuando lo pedido supera lo disponible", async () => {
    const { agent } = await staff("VENTAS");
    const pargo = await product({ name: "Pargo rojo", stock: 3 });
    await newOrder(agent, [{ productId: pargo.id, qty: 2 }]);

    const res = await newOrder(agent, [{ productId: pargo.id, qty: 2 }]);

    expect(res.status).toBe(201);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].message).toContain("Pargo rojo: piden 2 kg y hay disponible 1 kg");
  });

  it("exige cantidades enteras en productos por unidad y dirección en los domicilios", async () => {
    const { agent } = await staff("VENTAS");
    const hielo = await product({ name: "Bolsa de hielo", unit: "UNIDAD", stock: 10 });

    const fractional = await newOrder(agent, [{ productId: hielo.id, qty: 1.5 }]);
    expect(fractional.status).toBe(400);
    expect(fractional.body.error.message).toContain("se vende por unidad");

    const noAddress = await newOrder(agent, [{ productId: hielo.id, qty: 1 }], { customer: { name: "Ana" } });
    expect(noAddress.status).toBe(400);
    expect(noAddress.body.error.fields["customer.address"]).toBe("Escribe la dirección del domicilio.");
  });

  it("la venta de mostrador se entrega y descuenta en el acto", async () => {
    const { agent } = await staff("VENTAS");
    const sierra = await product({ price: 26000, stock: 10, cost: 18000 });

    const res = await newOrder(agent, [{ productId: sierra.id, qty: 1.25 }], { source: "MOSTRADOR", deliveryType: "RECOGE", customer: { name: "Cliente de mostrador" }, completeNow: true });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "ENTREGADO", total: 32500, paid: true });
    expect(res.body.data.dispatchedAt).not.toBeNull();
    expect(await stockOf(sierra.id)).toBe(8750);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: "SALIDA_PEDIDO" } });
    expect(movement).toMatchObject({ qtyMilli: -1250, stockAfterMilli: 8750, unitCost: 18000, orderId: res.body.data.id });
  });

  it("no deja vender en el acto más de lo que hay", async () => {
    const { agent } = await staff("VENTAS");
    const pulpo = await product({ name: "Pulpo", stock: 1 });

    const res = await newOrder(agent, [{ productId: pulpo.id, qty: 1.5 }], { source: "MOSTRADOR", deliveryType: "RECOGE", completeNow: true });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("No hay suficiente Pulpo: hay 1 kg y se necesitan 1,5 kg.");
    expect(await prisma.order.count()).toBe(0);
    expect(await stockOf(pulpo.id)).toBe(1000);
  });
});

describe("alistar, pesar y despachar", () => {
  it("el peso real cambia el total y pasa el pedido a «Alistando»", async () => {
    const { agent: ventas } = await staff("VENTAS");
    const { agent: despacho } = await staff("DESPACHO");
    const camaron = await product({ price: 48000, stock: 10 });
    const order = (await newOrder(ventas, [{ productId: camaron.id, qty: 2 }])).body.data;

    const res = await despacho.post(`/api/v1/orders/${order.id}/weigh`).send({ items: [{ itemId: order.items[0].id, actualQty: 2.134 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ALISTANDO");
    expect(res.body.data.items[0]).toMatchObject({ qtyMilli: 2000, actualQtyMilli: 2134, lineTotal: 102432 });
    expect(res.body.data).toMatchObject({ subtotal: 102432, total: 107432 });
  });

  it("al despachar descuenta el peso real y deja el kardex con el costo", async () => {
    const { agent: ventas } = await staff("VENTAS");
    const { agent: despacho } = await staff("DESPACHO");
    const mojarra = await product({ price: 22000, stock: 20, cost: 15000 });
    const order = (await newOrder(ventas, [{ productId: mojarra.id, qty: 3 }])).body.data;
    await despacho.post(`/api/v1/orders/${order.id}/weigh`).send({ items: [{ itemId: order.items[0].id, actualQty: 3.2 }] });
    await despacho.post(`/api/v1/orders/${order.id}/status`).send({ status: "LISTO" }).expect(200);

    const res = await despacho.post(`/api/v1/orders/${order.id}/status`).send({ status: "DESPACHADO" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("DESPACHADO");
    expect(await stockOf(mojarra.id)).toBe(16800);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: "SALIDA_PEDIDO" } });
    expect(movement).toMatchObject({ qtyMilli: -3200, stockAfterMilli: 16800, unitCost: 15000 });

    // Entregar después no vuelve a descontar.
    await despacho.post(`/api/v1/orders/${order.id}/status`).send({ status: "ENTREGADO" }).expect(200);
    expect(await stockOf(mojarra.id)).toBe(16800);
    const detail = await despacho.get(`/api/v1/orders/${order.id}`);
    expect(detail.body.data.events.map((event: { status: string }) => event.status)).toEqual(["RECIBIDO", "ALISTANDO", "LISTO", "DESPACHADO", "ENTREGADO"]);
  });

  it("si el cliente recoge, despachar es entregar", async () => {
    const { agent } = await staff("VENTAS");
    const bagre = await product({ stock: 5 });
    const order = (await newOrder(agent, [{ productId: bagre.id, qty: 1 }], { deliveryType: "RECOGE" })).body.data;

    const res = await agent.post(`/api/v1/orders/${order.id}/status`).send({ status: "DESPACHADO" });

    expect(res.body.data.status).toBe("ENTREGADO");
    expect(res.body.data.deliveredAt).not.toBeNull();
    expect(await stockOf(bagre.id)).toBe(4000);
  });

  it("no deja devolver un pedido a un estado anterior", async () => {
    const { agent } = await staff("ADMIN");
    const bagre = await product({ stock: 5 });
    const order = (await newOrder(agent, [{ productId: bagre.id, qty: 1 }])).body.data;
    await agent.post(`/api/v1/orders/${order.id}/status`).send({ status: "LISTO" }).expect(200);

    const res = await agent.post(`/api/v1/orders/${order.id}/status`).send({ status: "ALISTANDO" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("sin mercancía suficiente no despacha y el pedido sigue igual", async () => {
    const { agent } = await staff("ADMIN");
    const langostino = await product({ name: "Langostino", stock: 1 });
    const order = (await newOrder(agent, [{ productId: langostino.id, qty: 2 }])).body.data;

    const res = await agent.post(`/api/v1/orders/${order.id}/status`).send({ status: "DESPACHADO" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RECIBIDO");
    expect(await stockOf(langostino.id)).toBe(1000);
  });

  it("dos personas despachando a la vez descuentan una sola vez", async () => {
    const { agent: uno } = await staff("DESPACHO");
    const { agent: dos } = await staff("DESPACHO");
    const { agent: ventas } = await staff("VENTAS");
    const calamar = await product({ stock: 10 });
    const order = (await newOrder(ventas, [{ productId: calamar.id, qty: 2 }])).body.data;

    const results = await Promise.all([
      uno.post(`/api/v1/orders/${order.id}/status`).send({ status: "DESPACHADO" }),
      dos.post(`/api/v1/orders/${order.id}/status`).send({ status: "DESPACHADO" }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await stockOf(calamar.id)).toBe(8000);
    expect(await prisma.inventoryMovement.count({ where: { type: "SALIDA_PEDIDO" } })).toBe(1);
  });
});

describe("cobrar y cancelar", () => {
  it("registra el pago; a crédito queda por cobrar", async () => {
    const { agent } = await staff("VENTAS");
    const bagre = await product({ stock: 5 });
    const order = (await newOrder(agent, [{ productId: bagre.id, qty: 1 }])).body.data;

    const credit = await agent.post(`/api/v1/orders/${order.id}/collect`).send({ paymentMethod: "CREDITO" });
    expect(credit.body.data).toMatchObject({ paymentMethod: "CREDITO", paid: false });

    const paid = await agent.post(`/api/v1/orders/${order.id}/collect`).send({ paymentMethod: "NEQUI" });
    expect(paid.body.data).toMatchObject({ paymentMethod: "NEQUI", paid: true });
  });

  it("ventas cancela antes de despachar; después, solo el administrador y la mercancía vuelve", async () => {
    const { agent: ventas } = await staff("VENTAS");
    const { agent: admin } = await staff("ADMIN");
    const robalo = await product({ stock: 10 });
    const open = (await newOrder(ventas, [{ productId: robalo.id, qty: 1 }])).body.data;
    const cancelled = await ventas.post(`/api/v1/orders/${open.id}/cancel`).send({ reason: "El cliente ya no lo quiere" });
    expect(cancelled.body.data).toMatchObject({ status: "CANCELADO", cancelReason: "El cliente ya no lo quiere" });
    expect(await stockOf(robalo.id)).toBe(10000);

    const sold = (await newOrder(ventas, [{ productId: robalo.id, qty: 2 }], { deliveryType: "RECOGE", source: "MOSTRADOR", completeNow: true })).body.data;
    expect(await stockOf(robalo.id)).toBe(8000);

    const denied = await ventas.post(`/api/v1/orders/${sold.id}/cancel`).send({ reason: "Devolución" });
    expect(denied.status).toBe(403);

    const voided = await admin.post(`/api/v1/orders/${sold.id}/cancel`).send({ reason: "Devolución del cliente" });
    expect(voided.status).toBe(200);
    expect(await stockOf(robalo.id)).toBe(10000);
    expect(await prisma.inventoryMovement.findFirstOrThrow({ where: { type: "DEVOLUCION" } })).toMatchObject({ qtyMilli: 2000, stockAfterMilli: 10000 });
  });
});

describe("tablero de pedidos", () => {
  it("muestra los abiertos y los cerrados de hoy, sin la clave de seguimiento", async () => {
    const { agent } = await staff("BODEGA");
    const { agent: ventas } = await staff("VENTAS");
    const bagre = await product({ stock: 5 });
    await newOrder(ventas, [{ productId: bagre.id, qty: 1 }]);

    const res = await agent.get("/api/v1/orders");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).not.toHaveProperty("trackingKeyHash");
  });
});
