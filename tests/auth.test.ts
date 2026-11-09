import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { app, PASSWORD, product, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

describe("sesiones", () => {
  it("inicia sesión, devuelve el perfil con sus permisos y la cierra", async () => {
    const { agent, email } = await staff("DESPACHO", "Yeison");

    const me = await agent.get("/api/v1/auth/me");
    expect(me.body.data.user).toMatchObject({ name: "Yeison", email, role: "DESPACHO", roleLabel: "Despacho" });
    expect(me.body.data.permissions).toContain("orders.dispatch");
    expect(me.body.data.permissions).not.toContain("analytics.view");
    expect(me.body.data.businessName).toBe("Pesquera de Prueba");

    await agent.post("/api/v1/auth/logout").expect(204);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("rechaza la contraseña incorrecta y a los usuarios desactivados", async () => {
    const { email, user } = await staff("VENTAS");
    const wrong = await request(app).post("/api/v1/auth/login").send({ email, password: "otra-cosa" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");

    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const inactive = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
    expect(inactive.status).toBe(401);
    expect(inactive.body.error.code).toBe("USER_INACTIVE");
  });

  it("desactivar a alguien cierra su sesión abierta", async () => {
    const { agent: admin } = await staff("ADMIN");
    const { agent: ventas, user } = await staff("VENTAS");
    expect((await ventas.get("/api/v1/auth/me")).status).toBe(200);

    await admin.patch(`/api/v1/users/${user.id}`).send({ active: false }).expect(200);

    expect((await ventas.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("el administrador no se puede quitar el acceso a sí mismo", async () => {
    const { agent, user } = await staff("ADMIN");
    const res = await agent.patch(`/api/v1/users/${user.id}`).send({ role: "VENTAS" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SELF_LOCKOUT");
  });

  it("rechaza peticiones que cambian datos desde otro sitio", async () => {
    const { agent } = await staff("ADMIN");
    const res = await agent.post("/api/v1/catalog/categories").set("Origin", "https://otro-sitio.com").send({ name: "Pescados" });
    expect(res.status).toBe(403);
  });
});

describe("permisos por rol", () => {
  it("cada rol hace solo lo de su puesto", async () => {
    const { agent: bodega } = await staff("BODEGA");
    const { agent: despacho } = await staff("DESPACHO");
    const { agent: ventas } = await staff("VENTAS");
    const mojarra = await product({ stock: 5 });
    const order = { source: "MOSTRADOR", deliveryType: "RECOGE", paymentMethod: "EFECTIVO", customer: { name: "Ana" }, items: [{ productId: mojarra.id, qty: 1 }] };

    expect((await bodega.post("/api/v1/orders").send(order)).status).toBe(403);
    expect((await despacho.post("/api/v1/orders").send(order)).status).toBe(403);
    expect((await ventas.post("/api/v1/orders").send(order)).status).toBe(201);

    expect((await ventas.post("/api/v1/inventory/movements").send({ type: "ENTRADA", productId: mojarra.id, qty: 1 })).status).toBe(403);
    expect((await bodega.post("/api/v1/inventory/movements").send({ type: "ENTRADA", productId: mojarra.id, qty: 1 })).status).toBe(201);

    expect((await ventas.get("/api/v1/analytics/live")).status).toBe(403);
    expect((await bodega.get("/api/v1/sales/day")).status).toBe(403);
    expect((await ventas.get("/api/v1/sales/day")).status).toBe(200);
    expect((await ventas.patch(`/api/v1/catalog/products/${mojarra.id}`).send({ price: 1 })).status).toBe(403);
    expect((await despacho.get("/api/v1/users")).status).toBe(403);
  });

  it("sin sesión la API responde 401 y las pantallas llevan al inicio de sesión", async () => {
    expect((await request(app).get("/api/v1/orders")).status).toBe(401);
    const page = await request(app).get("/app/pedidos");
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe("/login?volver=%2Fapp%2Fpedidos");
  });
});
