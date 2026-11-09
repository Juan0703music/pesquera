import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { app, product, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

/** Foto de prueba con datos de ubicación (EXIF), como las del celular. */
async function photoWithGps() {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#2b6f8f" } })
    .jpeg()
    .withExif({ IFD0: { Make: "Celular", Model: "Prueba" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "9/1 30/1 0/1" } })
    .toBuffer();
}

describe("fotos de los productos", () => {
  it("se procesan en dos tamaños WebP, sin metadatos, y se sirven con versión", async () => {
    const { agent } = await staff("ADMIN");
    const pargo = await product({ name: "Pargo rojo", stock: 5 });
    const original = await photoWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const res = await agent.put(`/api/v1/catalog/products/${pargo.id}/photo`).set("Content-Type", "image/jpeg").send(original);

    expect(res.status).toBe(200);
    expect(res.body.data.photo).toEqual({ small: `/media/products/${pargo.id}/small.webp?v=1`, large: `/media/products/${pargo.id}/large.webp?v=1` });
    const small = await request(app).get(res.body.data.photo.small).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(small.status).toBe(200);
    expect(small.headers["content-type"]).toBe("image/webp");
    expect(small.headers["cache-control"]).toContain("immutable");
    const meta = await sharp(small.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(["webp", 640, 480, undefined]);

    // Inventario y tienda la muestran.
    const listed = (await agent.get("/api/v1/catalog/products")).body.data[0];
    expect(listed.photo.small).toContain("v=1");
    const store = (await request(app).get("/api/v1/store")).body.data;
    expect(store.categories[0].products[0].photo.large).toBe(`/media/products/${pargo.id}/large.webp?v=1`);

    // Al quitarla ya no aparece.
    await agent.delete(`/api/v1/catalog/products/${pargo.id}/photo`).expect(204);
    expect((await agent.get("/api/v1/catalog/products")).body.data[0].photo).toBeNull();
    expect((await request(app).get(`/media/products/${pargo.id}/small.webp`)).status).toBe(404);
  });

  it("rechaza lo que no es imagen, las fotos muy pequeñas y a quien no administra el catálogo", async () => {
    const { agent } = await staff("ADMIN");
    const { agent: ventas } = await staff("VENTAS");
    const bagre = await product({ stock: 5 });
    const tiny = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#fff" } }).png().toBuffer();

    const fake = await agent.put(`/api/v1/catalog/products/${bagre.id}/photo`).set("Content-Type", "image/png").send(Buffer.from("no soy una foto"));
    expect(fake.status).toBe(415);
    const small = await agent.put(`/api/v1/catalog/products/${bagre.id}/photo`).set("Content-Type", "image/png").send(tiny);
    expect(small.status).toBe(422);
    expect(small.body.error.code).toBe("PHOTO_TOO_SMALL");
    const denied = await ventas.put(`/api/v1/catalog/products/${bagre.id}/photo`).set("Content-Type", "image/jpeg").send(await photoWithGps());
    expect(denied.status).toBe(403);
  });
});

describe("cómo lo quiere el cliente (cortes)", () => {
  it("el administrador define los cortes y la tienda los muestra; el elegido llega en el pedido", async () => {
    const { agent } = await staff("ADMIN");
    const mojarra = await product({ name: "Mojarra roja", price: 20000, stock: 10 });

    const res = await agent.patch(`/api/v1/catalog/products/${mojarra.id}`).send({ cutOptions: ["Entero", " Limpio ", "limpio", "En postas"] });
    expect(res.body.data.cutOptions).toEqual(["Entero", "limpio", "En postas"]);

    const store = (await request(app).get("/api/v1/store")).body.data;
    expect(store.categories[0].products[0].cutOptions).toEqual(["Entero", "limpio", "En postas"]);

    const placed = await request(app).post("/api/v1/store/orders").send({
      paymentMethod: "EFECTIVO", customer: { name: "Yuranis", phone: "301 555 7788" }, items: [{ productId: mojarra.id, qty: 1.5, note: "En postas" }],
    });
    expect(placed.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.body.data.id }, include: { items: true } });
    expect(order.items[0]).toMatchObject({ note: "En postas", qtyMilli: 1500 });
    expect(order).toMatchObject({ deliveryType: "RECOGE", deliveryFee: 0, total: 30000 });
  });
});

describe("la pizarra del día", () => {
  it("marca lo que llegó hoy, lo que queda poco y cuenta lo más pedido", async () => {
    const { agent } = await staff("ADMIN");
    const sierra = await product({ name: "Sierra", stock: 0, min: 5 });
    const pulpo = await product({ name: "Pulpo", stock: 0.6 });
    const bagre = await product({ name: "Bagre", stock: 20 });
    // Las existencias iniciales llegaron hace dos días.
    await prisma.inventoryMovement.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    // Bodega registra hoy la llegada de la sierra.
    await agent.post("/api/v1/inventory/movements").send({ type: "ENTRADA", productId: sierra.id, qty: 12, supplier: "Lancha La Esperanza" }).expect(201);
    // El bagre se vendió en dos pedidos recientes.
    for (const qty of [1, 2]) {
      await agent.post("/api/v1/orders").send({ source: "MOSTRADOR", paymentMethod: "EFECTIVO", customer: { name: "Cliente" }, items: [{ productId: bagre.id, qty }], completeNow: true }).expect(201);
    }

    const products = (await request(app).get("/api/v1/store")).body.data.categories.flatMap((category: { products: unknown[] }) => category.products);
    const byName = (name: string) => products.find((item: { name: string }) => item.name === name);

    expect(byName("Sierra").arrivedAt).not.toBeNull();
    expect(byName("Sierra").fewLeft).toBe(false);
    expect(byName("Bagre").arrivedAt).toBeNull();
    expect(byName("Bagre").popularity).toBe(2);
    expect(byName("Pulpo")).toMatchObject({ available: true, fewLeft: true, maxQty: 0.5 });
    expect(pulpo.id).toBeTruthy();
  });
});
