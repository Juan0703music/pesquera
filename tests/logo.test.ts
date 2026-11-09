import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, product, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

/** Logo de prueba: cuadrado blanco con un círculo verde, como un logo redondo en JPG. */
const roundLogo = () =>
  sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#fff"/><circle cx="450" cy="450" r="440" fill="#1f7a1f"/></svg>'))
    .jpeg()
    .toBuffer();

const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

async function alphaAt(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3];
}

describe("logo de la pesquera", () => {
  it("se sube en Ajustes y se recorta en círculo, con esquinas transparentes", async () => {
    const { agent } = await staff("ADMIN");

    const res = await agent.put("/api/v1/settings/logo?round=true").set("Content-Type", "image/jpeg").send(await roundLogo());

    expect(res.status).toBe(200);
    expect(res.body.data.logo).toEqual({ large: "/media/logo/logo-512.webp?v=1", small: "/media/logo/logo-192.webp?v=1", round: true });
    const large = await binary(request(app).get(res.body.data.logo.large));
    expect(large.headers["content-type"]).toBe("image/webp");
    const meta = await sharp(large.body as Buffer).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([512, 512, true]);
    expect(await alphaAt(large.body as Buffer, 2, 2)).toBe(0); // esquina transparente
    expect(await alphaAt(large.body as Buffer, 256, 256)).toBe(255); // centro opaco

    const icon = await binary(request(app).get("/media/logo/icon-32.png"));
    expect((await sharp(icon.body as Buffer).metadata()).width).toBe(32);
    const apple = await binary(request(app).get("/media/logo/apple-180.png"));
    expect(await alphaAt(apple.body as Buffer, 0, 0)).toBe(255); // el ícono del celular va sobre blanco
  });

  it("aparece en la sesión, la entrada, la tienda y el seguimiento", async () => {
    const { agent } = await staff("ADMIN");
    await agent.put("/api/v1/settings/logo").set("Content-Type", "image/jpeg").send(await roundLogo()).expect(200);
    const mojarra = await product({ stock: 5 });

    expect((await agent.get("/api/v1/auth/me")).body.data.logo.small).toBe("/media/logo/logo-192.webp?v=1");
    expect((await request(app).get("/api/v1/auth/status")).body.data.logo.round).toBe(true);
    expect((await request(app).get("/api/v1/store")).body.data.business.logo.large).toBe("/media/logo/logo-512.webp?v=1");
    const placed = await request(app).post("/api/v1/store/orders").send({ paymentMethod: "EFECTIVO", customer: { name: "Ana", phone: "300 111 2233" }, items: [{ productId: mojarra.id, qty: 1 }] });
    const track = await request(app).get(`/api/v1/store/orders/${placed.body.data.id}`).set("X-Order-Key", placed.body.data.trackingKey);
    expect(track.body.data.business).toEqual({ name: "Pesquera de Prueba", logo: { large: "/media/logo/logo-512.webp?v=1", small: "/media/logo/logo-192.webp?v=1", round: true } });
  });

  it("si no es redondo no se recorta; al quitarlo vuelve el ícono de Marea", async () => {
    const { agent } = await staff("ADMIN");
    await agent.put("/api/v1/settings/logo?round=false").set("Content-Type", "image/jpeg").send(await roundLogo()).expect(200);
    const square = await binary(request(app).get("/media/logo/logo-512.webp?v=1"));
    expect(await alphaAt(square.body as Buffer, 2, 2)).toBe(255);

    const changed = await agent.patch("/api/v1/settings/logo").send({ round: true });
    expect(changed.body.data.logo.large).toBe("/media/logo/logo-512.webp?v=2");

    await agent.delete("/api/v1/settings/logo").expect(204);
    expect((await agent.get("/api/v1/settings")).body.data.logo).toBeNull();
    expect((await request(app).get("/media/logo/logo-512.webp")).status).toBe(404);
    expect((await request(app).get("/media/logo/icon-32.png")).status).toBe(200); // ícono por defecto
  });

  it("solo el administrador lo cambia y se rechazan imágenes inválidas o muy pequeñas", async () => {
    const { agent } = await staff("ADMIN");
    const { agent: ventas } = await staff("VENTAS");
    expect((await ventas.put("/api/v1/settings/logo").set("Content-Type", "image/jpeg").send(await roundLogo())).status).toBe(403);
    expect((await agent.put("/api/v1/settings/logo").set("Content-Type", "image/png").send(Buffer.from("no es imagen"))).status).toBe(415);
    const tiny = await sharp({ create: { width: 60, height: 60, channels: 3, background: "#fff" } }).png().toBuffer();
    const small = await agent.put("/api/v1/settings/logo").set("Content-Type", "image/png").send(tiny);
    expect(small.status).toBe(422);
    expect(small.body.error.code).toBe("LOGO_TOO_SMALL");
  });
});
