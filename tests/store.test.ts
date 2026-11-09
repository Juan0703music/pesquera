import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { app, product, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings({ minOrderTotal: 0, storeOpen: true });
});

const buyer = { name: "María Fernanda", phone: "310 789 4561" };

describe("tienda en línea", () => {
  it("muestra lo que hay sin revelar costos ni existencias exactas", async () => {
    await product({ name: "Mojarra roja", price: 22000, stock: 8, cost: 15000 });
    await product({ name: "Pulpo", stock: 0 });
    await product({ name: "Solo mostrador", stock: 5, inStore: false });

    const res = await request(app).get("/api/v1/store");

    expect(res.status).toBe(200);
    const products = res.body.data.categories.flatMap((category: { products: unknown[] }) => category.products);
    expect(products.map((item: { name: string; available: boolean }) => [item.name, item.available])).toEqual([["Mojarra roja", true], ["Pulpo", false]]);
    expect(products[0]).not.toHaveProperty("avgCost");
    expect(products[0]).not.toHaveProperty("stockMilli");
    expect(products[0].maxQty).toBe(8);
  });

  it("recibe el pedido, aparece en el tablero y el cliente lo sigue con su clave", async () => {
    const mojarra = await product({ name: "Mojarra roja", price: 22000, stock: 8 });

    const res = await request(app).post("/api/v1/store/orders").send({
      paymentMethod: "NEQUI", customer: buyer, items: [{ productId: mojarra.id, qty: 2 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ number: 1, total: 44000 });
    const { id, trackingKey } = res.body.data;

    const { agent } = await staff("VENTAS");
    const board = await agent.get("/api/v1/orders");
    expect(board.body.data[0]).toMatchObject({ source: "WEB", customerName: "María Fernanda", status: "RECIBIDO" });

    const tracked = await request(app).get(`/api/v1/store/orders/${id}`).set("X-Order-Key", trackingKey);
    expect(tracked.status).toBe(200);
    expect(tracked.body.data).toMatchObject({ number: 1, status: "RECIBIDO", total: 44000, deliveryType: "RECOGE" });

    const wrongKey = await request(app).get(`/api/v1/store/orders/${id}`).set("X-Order-Key", "no-es-la-clave");
    expect(wrongKey.status).toBe(404);
  });

  it("no deja pedir más de lo disponible (descontando los pedidos abiertos)", async () => {
    const camaron = await product({ name: "Camarón tití", stock: 3 });
    const { agent } = await staff("VENTAS");
    await agent.post("/api/v1/orders").send({
      source: "TELEFONO", deliveryType: "RECOGE", paymentMethod: "EFECTIVO", customer: { name: "Hotel" }, items: [{ productId: camaron.id, qty: 2 }],
    });

    const res = await request(app).post("/api/v1/store/orders").send({
      deliveryType: "RECOGE", paymentMethod: "EFECTIVO", customer: buyer, items: [{ productId: camaron.id, qty: 1.5 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OUT_OF_STOCK");
    expect(res.body.error.message).toContain("Camarón tití: piden 1,5 kg y hay disponible 1 kg");
  });

  it("respeta la tienda cerrada, el pedido mínimo y el campo trampa", async () => {
    const sierra = await product({ price: 10000, stock: 10 });
    const order = { deliveryType: "RECOGE", paymentMethod: "EFECTIVO", customer: buyer, items: [{ productId: sierra.id, qty: 1 }] };

    await settings({ minOrderTotal: 20000 });
    const small = await request(app).post("/api/v1/store/orders").send(order);
    expect(small.status).toBe(400);
    expect(small.body.error.code).toBe("MIN_ORDER");

    const robot = await request(app).post("/api/v1/store/orders").send({ ...order, website: "http://spam" });
    expect(robot.status).toBe(400);

    await settings({ storeOpen: false, minOrderTotal: 0 });
    const closed = await request(app).post("/api/v1/store/orders").send(order);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe("STORE_CLOSED");
    expect(await prisma.order.count()).toBe(0);
  });
});
