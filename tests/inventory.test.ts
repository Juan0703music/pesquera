import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { product, settings, staff, stockOf } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

describe("inventario", () => {
  it("una entrada suma existencia y recalcula el costo promedio ponderado", async () => {
    const { agent } = await staff("BODEGA");
    const mojarra = await product({ stock: 10, cost: 15000 });

    const res = await agent.post("/api/v1/inventory/movements").send({ type: "ENTRADA", productId: mojarra.id, qty: 30, unitCost: 17000, supplier: "Lancha La Esperanza" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: "ENTRADA", qtyMilli: 30000, stockAfterMilli: 40000, unitCost: 17000, supplier: "Lancha La Esperanza" });
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: mojarra.id } });
    // (10 × 15.000 + 30 × 17.000) / 40 = 16.500
    expect(updated).toMatchObject({ stockMilli: 40000, avgCost: 16500 });
  });

  it("el conteo físico deja la existencia en lo contado", async () => {
    const { agent } = await staff("BODEGA");
    const sierra = await product({ stock: 12 });

    const res = await agent.post("/api/v1/inventory/movements").send({ type: "AJUSTE", productId: sierra.id, counted: 11.35 });

    expect(res.body.data).toMatchObject({ type: "AJUSTE", qtyMilli: -650, stockAfterMilli: 11350 });
    const same = await agent.post("/api/v1/inventory/movements").send({ type: "AJUSTE", productId: sierra.id, counted: 11.35 });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe("NO_CHANGE");
  });

  it("la merma exige motivo y no puede superar la existencia", async () => {
    const { agent } = await staff("BODEGA");
    const pulpo = await product({ name: "Pulpo", stock: 2 });

    const noReason = await agent.post("/api/v1/inventory/movements").send({ type: "MERMA", productId: pulpo.id, qty: 0.5 });
    expect(noReason.status).toBe(400);

    const tooMuch = await agent.post("/api/v1/inventory/movements").send({ type: "MERMA", productId: pulpo.id, qty: 3, note: "Se dañó" });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.message).toBe("No hay suficiente Pulpo: hay 2 kg y se necesitan 3 kg.");

    const ok = await agent.post("/api/v1/inventory/movements").send({ type: "MERMA", productId: pulpo.id, qty: 0.4, note: "Cadena de frío" });
    expect(ok.body.data).toMatchObject({ qtyMilli: -400, stockAfterMilli: 1600 });
    expect(await stockOf(pulpo.id)).toBe(1600);
  });

  it("el kardex lista los movimientos del producto, el más reciente primero", async () => {
    const { agent } = await staff("BODEGA");
    const basa = await product({ stock: 5 });
    await agent.post("/api/v1/inventory/movements").send({ type: "ENTRADA", productId: basa.id, qty: 5 });

    const res = await agent.get(`/api/v1/inventory/movements?productId=${basa.id}`);

    expect(res.body.data.map((movement: { type: string; stockAfterMilli: number }) => [movement.type, movement.stockAfterMilli])).toEqual([["ENTRADA", 10000], ["ENTRADA", 5000]]);
  });

  it("marca el stock bajo y agotado", async () => {
    const { agent } = await staff("ADMIN");
    await product({ name: "A", stock: 10, min: 5 });
    await product({ name: "B", stock: 4, min: 5 });
    await product({ name: "C", stock: 0, min: 5 });

    const res = await agent.get("/api/v1/catalog/products");

    expect(res.body.data.map((item: { name: string; level: string }) => [item.name, item.level])).toEqual([["A", "OK"], ["B", "BAJO"], ["C", "AGOTADO"]]);
  });

  it("no deja cambiar kilo ↔ unidad a un producto con existencia", async () => {
    const { agent } = await staff("ADMIN");
    const hielo = await product({ unit: "UNIDAD", stock: 10 });

    const res = await agent.patch(`/api/v1/catalog/products/${hielo.id}`).send({ unit: "KG" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("UNIT_LOCKED");
  });
});
