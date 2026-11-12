import { beforeAll, describe, expect, it } from "vitest";
import { atender } from "../servidor/api.js";
import { abrirBase, reemplazarBase, volcarBase } from "../servidor/db.js";

/** Una petición como las que manda una pantalla. */
async function pedir(metodo: string, ruta: string, cuerpo?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-marea-sesion"] = token;
  const respuesta = await atender(
    new Request(`http://marea.local${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }),
    new URL(`http://marea.local${ruta}`).pathname,
  );
  if (!respuesta) return { status: 404, body: null as never };
  const texto = await respuesta.text();
  return { status: respuesta.status, body: (texto ? JSON.parse(texto) : null) as Record<string, any> };
}

let admin = "";

beforeAll(async () => {
  await abrirBase(undefined, {});
});

describe("Marea en el navegador", () => {
  it("la primera vez crea la pesquera y su administrador", async () => {
    const estado = await pedir("GET", "/api/v1/auth/status");
    expect(estado.body.data).toMatchObject({ needsSetup: true, people: [] });
    const creada = await pedir("POST", "/api/v1/auth/setup", { businessName: "LU&MAR", name: "Juan David", pin: "" });
    expect(creada.status).toBe(201);
    admin = creada.body.data.token;
    expect(creada.body.data.profile).toMatchObject({ businessName: "LU&MAR", user: { name: "Juan David", role: "ADMIN", hasPin: false } });
    expect((await pedir("POST", "/api/v1/auth/setup", { businessName: "Otra", name: "Intruso" })).status).toBe(409);
  });

  it("sin sesión no deja ver nada", async () => {
    expect((await pedir("GET", "/api/v1/orders")).status).toBe(401);
    expect((await pedir("GET", "/api/v1/orders", undefined, "codigo-falso")).status).toBe(401);
  });

  it("catálogo, entrada de mercancía, pedido, venta de mostrador, ventas y tablero en vivo", async () => {
    const cat = await pedir("POST", "/api/v1/catalog/categories", { name: "Pescados" }, admin);
    expect(cat.status).toBe(201);
    const mojarra = await pedir("POST", "/api/v1/catalog/products", { name: "Mojarra roja", categoryId: cat.body.data.id, unit: "KG", price: 18000 }, admin);
    expect(mojarra.status).toBe(201);
    const entrada = await pedir("POST", "/api/v1/inventory/movements", { type: "ENTRADA", productId: mojarra.body.data.id, qty: 30, unitCost: 12000, supplier: "Lancha" }, admin);
    expect(entrada.status, JSON.stringify(entrada.body)).toBe(201);

    const pedido = await pedir(
      "POST",
      "/api/v1/orders",
      { source: "WHATSAPP", paymentMethod: "EFECTIVO", customer: { name: "Doña Marta", phone: "310 222 3344" }, items: [{ productId: mojarra.body.data.id, qty: 2.5 }] },
      admin,
    );
    expect(pedido.status, JSON.stringify(pedido.body)).toBe(201);
    expect(pedido.body.data.total).toBe(45000);

    const mostrador = await pedir(
      "POST",
      "/api/v1/orders",
      { source: "MOSTRADOR", paymentMethod: "EFECTIVO", customer: { name: "Cliente" }, items: [{ productId: mojarra.body.data.id, qty: 1 }], completeNow: true },
      admin,
    );
    expect(mostrador.body.data.status).toBe("ENTREGADO");

    const ventas = await pedir("GET", "/api/v1/sales/day", undefined, admin);
    expect(ventas.status, JSON.stringify(ventas.body)).toBe(200);
    const vivo = await pedir("GET", "/api/v1/analytics/live", undefined, admin);
    expect(vivo.status, JSON.stringify(vivo.body)).toBe(200);
  });

  it("personal con PIN: entra con su PIN, el equivocado se rechaza y su rol limita lo que ve", async () => {
    const carlos = await pedir("POST", "/api/v1/users", { name: "Carlos Mendoza", role: "VENTAS", pin: "4321" }, admin);
    expect(carlos.status).toBe(201);
    expect(carlos.body.data).toMatchObject({ hasPin: true, roleLabel: "Ventas" });

    const estado = await pedir("GET", "/api/v1/auth/status");
    expect(estado.body.data.people.map((p: { name: string }) => p.name).sort()).toEqual(["Carlos Mendoza", "Juan David"]);

    const mal = await pedir("POST", "/api/v1/auth/login", { userId: carlos.body.data.id, pin: "1111" });
    expect(mal.status).toBe(401);
    expect(mal.body.error.code).toBe("WRONG_PIN");
    const bien = await pedir("POST", "/api/v1/auth/login", { userId: carlos.body.data.id, pin: "4321" });
    expect(bien.status).toBe(200);
    const token = bien.body.data.token;
    expect((await pedir("GET", "/api/v1/orders", undefined, token)).status).toBe(200);
    expect((await pedir("GET", "/api/v1/users", undefined, token)).status).toBe(403);
    expect((await pedir("GET", "/api/v1/respaldo/descargar", undefined, token)).status).toBe(403);

    // Al desactivarlo, su sesión deja de servir.
    await pedir("PATCH", `/api/v1/users/${carlos.body.data.id}`, { active: false }, admin);
    expect((await pedir("GET", "/api/v1/orders", undefined, token)).status).toBe(401);
  });

  it("nunca queda la pesquera sin administrador", async () => {
    const yo = (await pedir("GET", "/api/v1/auth/me", undefined, admin)).body.data.user;
    const res = await pedir("PATCH", `/api/v1/users/${yo.id}`, { role: "VENTAS" }, admin);
    expect(res.status).toBe(409);
    expect((await pedir("PATCH", `/api/v1/users/${yo.id}`, { active: false }, admin)).status).toBe(400);
  });

  it("la copia de seguridad trae la base completa y se puede restaurar", async () => {
    const copia = await volcarBase();
    expect(copia.size).toBeGreaterThan(100_000);
    await pedir("POST", "/api/v1/catalog/categories", { name: "Mariscos" }, admin);
    expect((await pedir("GET", "/api/v1/catalog/categories", undefined, admin)).body.data).toHaveLength(2);

    await reemplazarBase(copia);
    const despues = await pedir("GET", "/api/v1/catalog/categories", undefined, admin);
    expect(despues.status).toBe(200);
    expect(despues.body.data.map((c: { name: string }) => c.name)).toEqual(["Pescados"]);
    expect((await pedir("GET", "/api/v1/orders", undefined, admin)).body.data.length).toBeGreaterThan(0);
  });

  it("un archivo cualquiera no se acepta como copia", async () => {
    const res = await atender(
      new Request("http://marea.local/api/v1/respaldo/restaurar", { method: "POST", headers: { "content-type": "application/gzip", "x-marea-sesion": admin }, body: new Uint8Array([1, 2, 3, 4]) }),
      "/api/v1/respaldo/restaurar",
    );
    expect(res?.status).toBe(400);
    expect((await res!.json()).error.code).toBe("INVALID_BACKUP");
  });
});
