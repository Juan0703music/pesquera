import * as nip17 from "nostr-tools/nip17";
import { generateSecretKey, getPublicKey, verifyEvent, type Event } from "nostr-tools/pure";
import { beforeAll, describe, expect, it } from "vitest";
import { atender } from "../servidor/api.js";
import { abrirBase } from "../servidor/db.js";

async function pedir(metodo: string, ruta: string, cuerpo?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (cuerpo !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-marea-sesion"] = token;
  const respuesta = await atender(new Request(`http://marea.local${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), new URL(`http://marea.local${ruta}`).pathname);
  const texto = (await respuesta?.text()) ?? "";
  return { status: respuesta?.status ?? 404, body: (texto ? JSON.parse(texto) : null) as Record<string, any> };
}

let admin = "";
let tiendaPub = "";
let productId = "";
const cliente = generateSecretKey();
const clientePub = getPublicKey(cliente);

/** Lo que haría el celular del cliente: cifrar un mensaje para la tienda. */
const alaTienda = (datos: unknown, sk = cliente) => nip17.wrapEvent(sk, { publicKey: tiendaPub }, JSON.stringify(datos));
/** Y abrir lo que la tienda le responde. */
const abrir = (evento: Event, sk = cliente) => JSON.parse(nip17.unwrapEvent(evento, sk).content);

const pedidoDeAna = (qty = 2) => ({
  tipo: "pedido",
  ref: `ref-${Math.random()}`,
  pedido: { customer: { name: "Ana Torres", phone: "300 111 2233" }, paymentMethod: "EFECTIVO", items: [{ productId, qty }] },
});

beforeAll(async () => {
  await abrirBase(undefined, {});
  admin = (await pedir("POST", "/api/v1/auth/setup", { businessName: "LU&MAR", name: "Juan David" })).body.data.token;
  const cat = await pedir("POST", "/api/v1/catalog/categories", { name: "Pescados" }, admin);
  productId = (await pedir("POST", "/api/v1/catalog/products", { name: "Mojarra roja", categoryId: cat.body.data.id, unit: "KG", price: 18000 }, admin)).body.data.id;
  await pedir("POST", "/api/v1/inventory/movements", { type: "ENTRADA", productId, qty: 30, unitCost: 12000 }, admin);
});

describe("tienda por QR", () => {
  it("se activa una vez: crea su llave y su enlace fijo", async () => {
    expect((await pedir("GET", "/api/v1/tienda/estado", undefined, admin)).body.data.activada).toBe(false);
    const activa = await pedir("PUT", "/api/v1/tienda/estado", { abierta: true }, admin);
    expect(activa.status).toBe(200);
    tiendaPub = activa.body.data.pubkey;
    expect(tiendaPub).toMatch(/^[0-9a-f]{64}$/);
    expect(activa.body.data.enlace).toContain(`tienda?t=${tiendaPub}`);
    // Volver a activarla no cambia la llave (el QR impreso sigue sirviendo).
    expect((await pedir("PUT", "/api/v1/tienda/estado", { abierta: true }, admin)).body.data.pubkey).toBe(tiendaPub);
  });

  it("publica el catálogo firmado por la tienda, con precios y disponibilidad", async () => {
    const { body } = await pedir("GET", "/api/v1/tienda/publicacion", undefined, admin);
    const evento = body.data.catalogo as Event;
    expect(verifyEvent(evento)).toBe(true);
    expect(evento.pubkey).toBe(tiendaPub);
    const catalogo = JSON.parse(evento.content);
    expect(catalogo.business).toMatchObject({ name: "LU&MAR", open: true });
    expect(catalogo.categories[0].products[0]).toMatchObject({ name: "Mojarra roja", price: 18000, available: true });
    expect(JSON.parse(body.data.estado.content).abierta).toBe(true);
  });

  it("un pedido cifrado del celular entra a «Recibidos» y el cliente recibe la confirmación", async () => {
    const mensaje = alaTienda(pedidoDeAna());
    const res = await pedir("POST", "/api/v1/tienda/mensajes", { eventos: [mensaje] }, admin);
    expect(res.status).toBe(200);
    expect(res.body.data.nuevos).toHaveLength(1);
    const respuesta = abrir(res.body.data.respuestas[0]);
    expect(respuesta).toMatchObject({ tipo: "confirmado", pedido: { status: "RECIBIDO", total: 36000, customerName: "Ana Torres" } });

    const pedidos = await pedir("GET", "/api/v1/orders", undefined, admin);
    expect(pedidos.body.data.some((o: { source: string; customerName: string }) => o.source === "WEB" && o.customerName === "Ana Torres")).toBe(true);

    // El mismo mensaje llega por otro retransmisor: no se duplica.
    const otraVez = await pedir("POST", "/api/v1/tienda/mensajes", { eventos: [mensaje] }, admin);
    expect(otraVez.body.data.nuevos).toHaveLength(0);
    expect(abrir(otraVez.body.data.respuestas[0]).pedido.number).toBe(respuesta.pedido.number);
  });

  it("cada cambio de estado se le avisa al cliente, y puede preguntar cómo va", async () => {
    const pedidos = await pedir("GET", "/api/v1/orders", undefined, admin);
    const id = pedidos.body.data.find((o: { source: string }) => o.source === "WEB").id;
    expect((await pedir("POST", `/api/v1/orders/${id}/status`, { status: "ALISTANDO" }, admin)).status).toBe(200);

    const avisos = await pedir("POST", "/api/v1/tienda/avisos", { orderIds: [id] }, admin);
    expect(abrir(avisos.body.data.respuestas[0])).toMatchObject({ tipo: "estado", pedido: { id, status: "ALISTANDO" } });

    const consulta = await pedir("POST", "/api/v1/tienda/mensajes", { eventos: [alaTienda({ tipo: "consulta", orderId: id })] }, admin);
    expect(abrir(consulta.body.data.respuestas[0]).pedido.status).toBe("ALISTANDO");

    // Otro celular no puede consultar un pedido ajeno.
    const intruso = generateSecretKey();
    const ajeno = await pedir("POST", "/api/v1/tienda/mensajes", { eventos: [alaTienda({ tipo: "consulta", orderId: id }, intruso)] }, admin);
    expect(ajeno.body.data.respuestas).toHaveLength(0);
  });

  it("pedidos imposibles se rechazan con el motivo (más de lo disponible, tienda cerrada)", async () => {
    const mucho = await pedir("POST", "/api/v1/tienda/mensajes", { eventos: [alaTienda(pedidoDeAna(500))] }, admin);
    expect(abrir(mucho.body.data.respuestas[0]).tipo).toBe("rechazado");

    await pedir("PUT", "/api/v1/tienda/estado", { abierta: false }, admin);
    const cerrada = await pedir("POST", "/api/v1/tienda/mensajes", { eventos: [alaTienda(pedidoDeAna())] }, admin);
    const respuesta = abrir(cerrada.body.data.respuestas[0]);
    expect(respuesta.tipo).toBe("rechazado");
    expect(respuesta.mensaje).toContain("no está recibiendo pedidos");
    await pedir("PUT", "/api/v1/tienda/estado", { abierta: true }, admin);
  });

  it("los mensajes para otra tienda o dañados se ignoran", async () => {
    const otraTienda = getPublicKey(generateSecretKey());
    const paraOtra = nip17.wrapEvent(cliente, { publicKey: otraTienda }, JSON.stringify(pedidoDeAna()));
    const res = await pedir("POST", "/api/v1/tienda/mensajes", { eventos: [paraOtra] }, admin);
    expect(res.body.data).toEqual({ respuestas: [], nuevos: [] });
  });

  it("el cliente no necesita sesión, pero el puente sí (la API de la tienda exige sesión de Marea)", async () => {
    expect((await pedir("GET", "/api/v1/tienda/publicacion")).status).toBe(401);
    expect(clientePub).toMatch(/^[0-9a-f]{64}$/);
  });
});
