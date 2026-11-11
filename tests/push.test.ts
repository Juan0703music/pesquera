import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Los avisos no salen a internet en las pruebas: se registra lo que se habría enviado.
const sent = vi.hoisted(() => [] as { endpoint: string; payload: Record<string, string> }[]);
const failures = vi.hoisted(() => new Map<string, number>());
vi.mock("web-push", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return {
    default: {
      ...actual.default,
      sendNotification: vi.fn(async (subscription: { endpoint: string }, body: string) => {
        const status = failures.get(subscription.endpoint);
        if (status) throw Object.assign(new Error("push failed"), { statusCode: status });
        sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(body) });
        return { statusCode: 201 };
      }),
    },
  };
});

const { prisma } = await import("../src/config/database.js");
const { app, product, settings, staff } = await import("./helpers/app.js");
const { resetDatabase } = await import("./helpers/db.js");

beforeEach(async () => {
  await resetDatabase();
  await settings();
  sent.length = 0;
  failures.clear();
});

const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

/** Espera a que terminen los envíos (salen después de responder el pedido, sin frenarlo). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

async function storeOrder() {
  const mojarra = await product({ name: `Mojarra ${Math.random()}`, unit: "UNIDAD", stock: 20, price: 15000 });
  const res = await request(app)
    .post("/api/v1/store/orders")
    .send({ paymentMethod: "EFECTIVO", customer: { name: "Ana Torres", phone: "300 111 2233" }, items: [{ productId: mojarra.id, qty: 2 }] });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe("suscripción de un equipo", () => {
  it("entrega la llave pública (la crea una vez y la conserva)", async () => {
    const { agent } = await staff("VENTAS");
    const first = await agent.get("/api/v1/push").expect(200);
    const second = await agent.get("/api/v1/push").expect(200);
    expect(first.body.data.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(second.body.data.publicKey).toBe(first.body.data.publicKey);
  });

  it("sin sesión no se puede suscribir", async () => {
    await request(app).post("/api/v1/push/subscriptions").send({ endpoint: endpoint("a"), keys }).expect(401);
  });

  it("solo acepta los servicios de avisos de los navegadores (nunca direcciones cualquiera)", async () => {
    const { agent } = await staff("VENTAS");
    const bad = await agent.post("/api/v1/push/subscriptions").send({ endpoint: "https://intranet.example.com/hook", keys });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("PUSH_ENDPOINT_NOT_ALLOWED");
    await agent.post("/api/v1/push/subscriptions").send({ endpoint: "http://fcm.googleapis.com/fcm/send/x", keys }).expect(400);
    await agent.post("/api/v1/push/subscriptions").set("User-Agent", "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile").send({ endpoint: endpoint("a"), keys }).expect(201);
    const saved = await prisma.pushSubscription.findFirstOrThrow();
    expect(saved.device).toBe("Android · Chrome");
  });

  it("si otra persona entra en el mismo celular, los avisos pasan a ella; al salir se borran", async () => {
    const ana = await staff("VENTAS", "Ana");
    const luis = await staff("DESPACHO", "Luis");
    await ana.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("celular"), keys }).expect(201);
    await luis.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("celular"), keys }).expect(201);
    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(luis.user.id);

    // Ana no puede borrar la suscripción de Luis.
    await ana.agent.delete("/api/v1/push/subscriptions").send({ endpoint: endpoint("celular") }).expect(204);
    expect(await prisma.pushSubscription.count()).toBe(1);
    await luis.agent.delete("/api/v1/push/subscriptions").send({ endpoint: endpoint("celular") }).expect(204);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

describe("aviso de pedido nuevo", () => {
  it("un pedido de la tienda le llega a todo el equipo con avisos activados", async () => {
    const admin = await staff("ADMIN", "Juan");
    const bodega = await staff("BODEGA", "Rafa");
    await admin.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("juan"), keys }).expect(201);
    await bodega.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("rafa"), keys }).expect(201);

    const order = await storeOrder();
    await settle();

    expect(sent.map((item) => item.endpoint).sort()).toEqual([endpoint("juan"), endpoint("rafa")]);
    expect(sent[0]?.payload).toMatchObject({
      title: `Pedido nuevo #${order.number}`,
      url: `/app/pedidos?pedido=${order.id}`,
      tag: `pedido-${order.id}`,
    });
    expect(sent[0]?.payload.body).toContain("Ana Torres · Tienda en línea");
    expect((await prisma.pushSubscription.findFirstOrThrow({ where: { endpoint: endpoint("juan") } })).lastSentAt).not.toBeNull();
  });

  it("no le avisa a quien registró el pedido, ni por una venta de mostrador ya entregada, ni a cuentas desactivadas", async () => {
    const ventas = await staff("VENTAS", "Carlos");
    const admin = await staff("ADMIN", "Juan");
    const antiguo = await staff("DESPACHO", "Ya no trabaja");
    await ventas.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("carlos"), keys }).expect(201);
    await admin.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("juan"), keys }).expect(201);
    await antiguo.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("antiguo"), keys }).expect(201);
    await prisma.user.update({ where: { id: antiguo.user.id }, data: { active: false } });

    const sierra = await product({ name: "Sierra", stock: 30, price: 28000 });
    await ventas.agent
      .post("/api/v1/orders")
      .send({ source: "WHATSAPP", paymentMethod: "EFECTIVO", customer: { name: "Doña Marta", phone: "310 222 3344" }, items: [{ productId: sierra.id, qty: 1.5 }] })
      .expect(201);
    await settle();
    expect(sent.map((item) => item.endpoint)).toEqual([endpoint("juan")]);
    expect(sent[0]?.payload.body).toContain("Doña Marta · WhatsApp");

    sent.length = 0;
    await ventas.agent
      .post("/api/v1/orders")
      .send({ source: "MOSTRADOR", paymentMethod: "EFECTIVO", customer: { name: "Cliente" }, items: [{ productId: sierra.id, qty: 1 }], completeNow: true })
      .expect(201);
    await settle();
    expect(sent).toEqual([]);
  });

  it("un celular que ya no existe (410) se borra solo", async () => {
    const admin = await staff("ADMIN");
    await admin.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("viejo"), keys }).expect(201);
    await admin.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("nuevo"), keys }).expect(201);
    failures.set(endpoint("viejo"), 410);

    await storeOrder();
    await settle();
    expect((await prisma.pushSubscription.findMany()).map((row) => row.endpoint)).toEqual([endpoint("nuevo")]);
  });

  it("el aviso de prueba solo va a los equipos de quien lo pide", async () => {
    const admin = await staff("ADMIN");
    const otro = await staff("VENTAS");
    await admin.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("mio"), keys }).expect(201);
    await otro.agent.post("/api/v1/push/subscriptions").send({ endpoint: endpoint("otro"), keys }).expect(201);
    const res = await admin.agent.post("/api/v1/push/test").expect(200);
    expect(res.body.data.delivered).toBe(1);
    expect(sent.map((item) => item.endpoint)).toEqual([endpoint("mio")]);
  });
});
