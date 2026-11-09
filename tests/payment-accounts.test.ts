import QRCode from "qrcode";
import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { parseBreBKey } from "../src/modules/payments/payment-accounts.service.js";
import { app, product, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

// Código de ejemplo con la forma de un QR interoperable (EMVCo); no es un código de pago real.
const EMV_PAYLOAD = "00020101021126360014CO.COM.BREB0114@bahiaazul52045411530317054040.005802CO5913BAHIA AZUL6304ABCD";

const breB = { kind: "BRE_B", accountKey: "@BahiaAzul", holderName: "Pesquera Bahía Azul SAS", holderDocument: "900.123.456-7" };

/** Pantallazo con el QR en medio de un fondo, como lo entrega la app del banco. */
async function screenshotWithQr(payload: string) {
  const qr = await QRCode.toBuffer(payload, { type: "png", width: 420, margin: 2 });
  return sharp({ create: { width: 720, height: 1280, channels: 3, background: "#5b2a86" } })
    .composite([{ input: qr, top: 380, left: 150 }])
    .png()
    .toBuffer();
}

describe("llaves Bre-B", () => {
  it("reconoce celular, documento o código de comercio, correo y llave alfanumérica", () => {
    expect(parseBreBKey("300 123 4567")).toEqual({ type: "CELULAR", key: "3001234567" });
    expect(parseBreBKey("+57 300 123 4567")).toEqual({ type: "CELULAR", key: "3001234567" });
    expect(parseBreBKey("1.102.345.678")).toEqual({ type: "DOCUMENTO", key: "1102345678" });
    expect(parseBreBKey("Ventas@PesqueraBahia.com")).toEqual({ type: "CORREO", key: "ventas@pesquerabahia.com" });
    expect(parseBreBKey("@BahiaAzul")).toEqual({ type: "ALIAS", key: "@BahiaAzul" });
    expect(parseBreBKey("hola mundo")).toBeNull();
    expect(parseBreBKey("@a")).toBeNull();
  });
});

describe("cuentas de cobro", () => {
  it("el administrador crea una llave Bre-B y la ve con su tipo", async () => {
    const { agent } = await staff("ADMIN");

    const res = await agent.post("/api/v1/payment-accounts").send(breB);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: "BRE_B", kindLabel: "Llave Bre-B", accountKey: "@BahiaAzul", keyType: "ALIAS", keyTypeLabel: "Llave alfanumérica",
      holderDocument: "900123456-7", active: true, hasQr: false, qrSvg: null,
    });
  });

  it("rechaza llaves y números que no corresponden al tipo de cuenta", async () => {
    const { agent } = await staff("ADMIN");

    const badKey = await agent.post("/api/v1/payment-accounts").send({ ...breB, accountKey: "mi llave" });
    expect(badKey.status).toBe(400);
    expect(badKey.body.error.fields.accountKey).toContain("no parece de Bre-B");

    const badNequi = await agent.post("/api/v1/payment-accounts").send({ kind: "NEQUI", accountKey: "604 123 4567", holderName: "Luz Marina" });
    expect(badNequi.status).toBe(400);

    const noBank = await agent.post("/api/v1/payment-accounts").send({ kind: "BANCO", accountKey: "123-456789-01", holderName: "Pesquera" });
    expect(noBank.status).toBe(400);
    expect(Object.keys(noBank.body.error.fields)).toEqual(expect.arrayContaining(["bankName", "bankAccountType"]));

    const bank = await agent.post("/api/v1/payment-accounts").send({ kind: "BANCO", accountKey: "123-456789-01", holderName: "Pesquera", bankName: "Bancolombia", bankAccountType: "AHORROS" });
    expect(bank.body.data).toMatchObject({ accountKey: "12345678901", bankName: "Bancolombia", bankAccountType: "AHORROS" });
  });

  it("lee el QR del pantallazo y lo vuelve a dibujar con el mismo código", async () => {
    const { agent } = await staff("ADMIN");
    const account = (await agent.post("/api/v1/payment-accounts").send(breB)).body.data;

    const res = await agent.put(`/api/v1/payment-accounts/${account.id}/qr`).set("Content-Type", "image/png").send(await screenshotWithQr(EMV_PAYLOAD));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ hasQr: true, qrInteroperable: true });
    expect(res.body.data.qrSvg).toMatch(/^<svg/);
    // El PNG que descarga el cliente contiene exactamente el mismo código.
    const png = await request(app).get(`/api/v1/store/payment-accounts/${account.id}/qr.png`);
    expect(png.status).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    const { readQr } = await import("../src/modules/payments/payment-accounts.service.js");
    expect(await readQr(png.body)).toBe(EMV_PAYLOAD);
  });

  it("explica cuando la imagen no tiene un QR o no es una imagen", async () => {
    const { agent } = await staff("ADMIN");
    const account = (await agent.post("/api/v1/payment-accounts").send(breB)).body.data;
    const blank = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#ffffff" } }).png().toBuffer();

    const noQr = await agent.put(`/api/v1/payment-accounts/${account.id}/qr`).set("Content-Type", "image/png").send(blank);
    expect(noQr.status).toBe(422);
    expect(noQr.body.error.code).toBe("QR_NOT_FOUND");

    const notImage = await agent.put(`/api/v1/payment-accounts/${account.id}/qr`).set("Content-Type", "image/png").send(Buffer.from("esto no es una imagen"));
    expect(notImage.status).toBe(415);
  });

  it("solo el administrador las configura; ventas ve las activas para cobrar", async () => {
    const { agent: admin } = await staff("ADMIN");
    const { agent: ventas } = await staff("VENTAS");
    const { agent: bodega } = await staff("BODEGA");
    const active = (await admin.post("/api/v1/payment-accounts").send(breB)).body.data;
    await admin.post("/api/v1/payment-accounts").send({ kind: "NEQUI", accountKey: "3004567890", holderName: "Luz Marina", active: false });

    expect((await ventas.post("/api/v1/payment-accounts").send(breB)).status).toBe(403);
    expect((await ventas.delete(`/api/v1/payment-accounts/${active.id}`)).status).toBe(403);
    expect((await bodega.get("/api/v1/payment-accounts")).status).toBe(403);
    expect((await ventas.get("/api/v1/payment-accounts")).body.data.map((account: { kind: string }) => account.kind)).toEqual(["BRE_B"]);
    expect((await admin.get("/api/v1/payment-accounts")).body.data).toHaveLength(2);
  });
});

describe("pago en la tienda y en el seguimiento", () => {
  it("la tienda muestra las cuentas activas y cuáles van con cada forma de pago", async () => {
    const { agent } = await staff("ADMIN");
    const key = (await agent.post("/api/v1/payment-accounts").send(breB)).body.data;
    const nequi = (await agent.post("/api/v1/payment-accounts").send({ kind: "NEQUI", accountKey: "300 456 7890", holderName: "Luz Marina Pérez" })).body.data;
    await agent.post("/api/v1/payment-accounts").send({ kind: "DAVIPLATA", accountKey: "3109876543", holderName: "Oculta", active: false });

    const res = await request(app).get("/api/v1/store");

    const payment = res.body.data.payment;
    expect(payment.accounts.map((account: { kind: string }) => account.kind)).toEqual(["BRE_B", "NEQUI"]);
    // Si paga con Nequi, primero la cuenta Nequi y luego la llave Bre-B (sirve desde cualquier banco).
    expect(payment.byMethod).toEqual({ BRE_B: [key.id], NEQUI: [nequi.id, key.id], TRANSFERENCIA: [key.id] });
  });

  it("el seguimiento dice dónde pagar y si el valor ya es el definitivo (después del pesaje)", async () => {
    const { agent } = await staff("ADMIN");
    await agent.post("/api/v1/payment-accounts").send(breB);
    const mojarra = await product({ price: 20000, stock: 10 });
    const placed = await request(app).post("/api/v1/store/orders").send({
      deliveryType: "RECOGE", paymentMethod: "BRE_B", items: [{ productId: mojarra.id, qty: 2 }],
      customer: { name: "María", phone: "310 789 4561" },
    });
    expect(placed.status).toBe(201);
    const { id, trackingKey } = placed.body.data;
    const track = () => request(app).get(`/api/v1/store/orders/${id}`).set("X-Order-Key", trackingKey);

    const before = await track();
    expect(before.body.data.payment).toMatchObject({ amountDue: 40000, exact: false });
    expect(before.body.data.payment.accounts[0]).toMatchObject({ kind: "BRE_B", accountKey: "@BahiaAzul" });

    const order = (await agent.get(`/api/v1/orders/${id}`)).body.data;
    await agent.post(`/api/v1/orders/${id}/weigh`).send({ items: [{ itemId: order.items[0].id, actualQty: 2.1 }] });
    const after = await track();
    expect(after.body.data.payment).toMatchObject({ amountDue: 42000, exact: true });

    await agent.post(`/api/v1/orders/${id}/collect`).send({ paymentMethod: "BRE_B" });
    expect((await track()).body.data.payment).toBeNull();
  });

  it("en efectivo no se muestran cuentas", async () => {
    const { agent } = await staff("ADMIN");
    await agent.post("/api/v1/payment-accounts").send(breB);
    const mojarra = await product({ stock: 10 });
    const placed = await request(app).post("/api/v1/store/orders").send({
      deliveryType: "RECOGE", paymentMethod: "EFECTIVO", items: [{ productId: mojarra.id, qty: 1 }], customer: { name: "María", phone: "310 789 4561" },
    });
    const track = await request(app).get(`/api/v1/store/orders/${placed.body.data.id}`).set("X-Order-Key", placed.body.data.trackingKey);
    expect(track.body.data.payment).toBeNull();
  });
});
