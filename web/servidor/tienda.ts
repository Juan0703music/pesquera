/**
 * Tienda por QR en la versión del navegador (montada en /api/v1/tienda, con sesión).
 *
 * El PC de la pesquera hace de servidor: el «puente» (web/publico/js/puente-tienda.js, en la pestaña de
 * Marea) se conecta a retransmisores públicos de la red Nostr y le pasa aquí los mensajes. Este módulo, que
 * corre en el service worker, es el único que conoce la llave de la tienda:
 * - firma el catálogo (precios, disponibilidad, fotos, logo, cuentas de cobro) que ven los clientes;
 * - abre los pedidos cifrados que mandan los celulares y los registra con las mismas reglas de la tienda;
 * - prepara, cifrados para cada cliente, los avisos de cómo va su pedido.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import * as nip17 from "nostr-tools/nip17";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from "nostr-tools/pure";
import { z, ZodError } from "zod";
import { requirePermission } from "./autenticacion.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { Router, type Req, type Res } from "./express.js";
import { live } from "./live.js";
import { StoreOrderSchema } from "../../src/modules/orders/orders.schemas.js";
import { ordersService } from "../../src/modules/orders/orders.service.js";
import { qrPng } from "../../src/modules/payments/qr-image.js";
import { getSettings } from "../../src/modules/settings/settings.routes.js";
import { render as renderLogo } from "../../src/modules/settings/logo-image.js";
import { buildStoreCatalog } from "../../src/modules/store/store.routes.js";
import { AppError } from "../../src/utils/errors.js";
import { abrirImagen, codificar, lienzo } from "./imagenes.js";

import { D, KIND_DATOS, RETRANSMISORES } from "./tienda-comun.js";

export { D, KIND_DATOS, RETRANSMISORES };
/** Pedidos por hora que puede mandar un mismo celular (evita que alguien llene el tablero de pedidos falsos). */
const PEDIDOS_POR_HORA = 5;

/* ───────────── Dirección del sitio (la pone el service worker) ───────────── */
let sitio = { origen: env.APP_URL, base: "/" };
export function configurarSitio(origen: string, base: string) {
  sitio = { origen, base };
}
const enlaceTienda = (pubkey: string) => `${sitio.origen}${sitio.base}tienda?t=${pubkey}`;

/* ───────────── Llave de la tienda ───────────── */
async function llaveGuardada() {
  const fila = await prisma.storeKey.findUnique({ where: { id: 1 } });
  return fila ? hexToBytes(fila.secretKey) : null;
}

async function llave() {
  const guardada = await llaveGuardada();
  if (!guardada) throw new AppError(409, "STORE_NOT_ACTIVE", "La tienda por QR todavía no está activada. Actívala en Ajustes.");
  return guardada;
}

const ahora = () => Math.floor(Date.now() / 1000);
const firmar = (sk: Uint8Array, d: string, contenido: string) => finalizeEvent({ kind: KIND_DATOS, created_at: ahora(), tags: [["d", d]], content: contenido }, sk);
const mensaje = (sk: Uint8Array, cliente: string, datos: Record<string, unknown>) => nip17.wrapEvent(sk, { publicKey: cliente }, JSON.stringify(datos));

function base64(bytes: Uint8Array) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}
const versionDe = (url: string | undefined) => Number(/[?&]v=(\d+)/.exec(url ?? "")?.[1] ?? 0);

/** Versión pública del logo: en vez de direcciones del PC, la referencia al mensaje que trae la imagen. */
async function logoPublico(logo: { round: boolean; large: string } | null) {
  return logo ? { round: logo.round, d: D.logo, v: versionDe(logo.large) } : null;
}

/** El seguimiento del pedido tal como lo ve el cliente (con el logo como referencia, no como dirección). */
async function seguimiento(orderId: string, trackingKey: string) {
  const pedido = await ordersService.track(orderId, trackingKey);
  return { ...pedido, business: { ...pedido.business, logo: await logoPublico(pedido.business.logo) } };
}

/* ───────────── Rutas ───────────── */
export const tiendaRoutes = Router();

tiendaRoutes.get("/estado", async (_req: Req, res: Res) => {
  const [sk, settings] = await Promise.all([llaveGuardada(), getSettings()]);
  const pubkey = sk ? getPublicKey(sk) : null;
  res.json({
    data: {
      activada: Boolean(sk),
      abierta: settings.storeOpen,
      minOrderTotal: settings.minOrderTotal,
      pubkey,
      enlace: pubkey ? enlaceTienda(pubkey) : null,
      retransmisores: RETRANSMISORES,
    },
  });
});

/** Activa la tienda (la primera vez crea su llave: el QR queda fijo desde entonces) y la abre o la pausa. */
tiendaRoutes.put(
  "/estado",
  requirePermission("admin.manage"),
  async (req: Req, res: Res, next) => {
    try {
      req.body = z.object({ abierta: z.boolean(), minOrderTotal: z.number().int().min(0).max(10_000_000).optional() }).parse(req.body ?? {});
      next();
    } catch (error) {
      next(error);
    }
  },
  async (req: Req, res: Res) => {
    const { abierta, minOrderTotal } = req.body as { abierta: boolean; minOrderTotal?: number };
    if (!(await llaveGuardada())) {
      await prisma.storeKey.createMany({ data: [{ id: 1, secretKey: bytesToHex(generateSecretKey()) }], skipDuplicates: true });
    }
    const actual = await getSettings();
    await prisma.setting.upsert({
      where: { id: 1 },
      create: { id: 1, businessName: actual.businessName, storeOpen: abierta, minOrderTotal: minOrderTotal ?? actual.minOrderTotal },
      update: { storeOpen: abierta, ...(minOrderTotal !== undefined ? { minOrderTotal } : {}) },
    });
    live.emit("settings", "tienda.estado", { abierta });
    const pubkey = getPublicKey(await llave());
    res.json({ data: { activada: true, abierta, pubkey, enlace: enlaceTienda(pubkey) } });
  },
);

/** QR de la tienda (para imprimir o mostrar en el mostrador). */
tiendaRoutes.get("/qr.png", async (_req: Req, res: Res) => {
  const pubkey = getPublicKey(await llave());
  res.set("Content-Disposition", 'attachment; filename="qr-tienda.png"').type("png").send(await qrPng(enlaceTienda(pubkey)));
});

/**
 * Lo que el puente publica: el catálogo (con las fotos y el logo como referencias), el estado (abierta y la
 * hora: los clientes saben así si la pesquera está conectada) y la lista de fotos con su versión.
 */
tiendaRoutes.get("/publicacion", async (_req: Req, res: Res) => {
  const sk = await llave();
  const catalogo = await buildStoreCatalog();
  const fotos: { productId: string; version: number }[] = [];
  const publico = {
    ...catalogo,
    business: { ...catalogo.business, logo: await logoPublico(catalogo.business.logo) },
    categories: catalogo.categories.map((categoria) => ({
      ...categoria,
      products: categoria.products.map((producto) => {
        if (!producto.photo) return { ...producto, photo: null };
        const version = versionDe(producto.photo.small);
        fotos.push({ productId: producto.id, version });
        return { ...producto, photo: { d: D.foto(producto.id), v: version } };
      }),
    })),
  };
  res.json({
    data: {
      catalogo: firmar(sk, D.catalogo, JSON.stringify(publico)),
      estado: firmar(sk, D.estado, JSON.stringify({ abierta: catalogo.business.open, hora: Date.now() })),
      fotos,
      logo: publico.business.logo,
    },
  });
});

/** Solo el estado (cada pocos minutos: «la pesquera está conectada»). */
tiendaRoutes.get("/presencia", async (_req: Req, res: Res) => {
  const sk = await llave();
  res.json({ data: firmar(sk, D.estado, JSON.stringify({ abierta: (await getSettings()).storeOpen, hora: Date.now() })) });
});

/** Foto del producto, más liviana para los datos móviles del cliente (400 × 300). */
tiendaRoutes.get("/foto/:id", async (req: Req, res: Res) => {
  const sk = await llave();
  const id = z.uuid().parse(req.params.id);
  const [foto, producto] = await Promise.all([
    prisma.productPhoto.findUnique({ where: { productId: id }, select: { small: true } }),
    prisma.product.findUnique({ where: { id }, select: { photoVersion: true } }),
  ]);
  if (!foto || !producto) throw new AppError(404, "NOT_FOUND", "Ese producto no tiene foto.");
  let bytes: Uint8Array = foto.small;
  if (typeof OffscreenCanvas === "function") {
    const imagen = await abrirImagen(foto.small, "No se pudo abrir la foto.");
    const { canvas, ctx } = lienzo(400, 300);
    ctx.drawImage(imagen, 0, 0, 400, 300);
    imagen.close();
    bytes = await codificar(canvas, "image/webp", 0.7);
  }
  res.json({ data: firmar(sk, D.foto(id), JSON.stringify({ v: producto.photoVersion, tipo: "image/webp", datos: base64(bytes) })) });
});

/** Logo (192 px) para el encabezado de la tienda y del seguimiento. */
tiendaRoutes.get("/logo", async (_req: Req, res: Res) => {
  const sk = await llave();
  const [logo, settings] = await Promise.all([prisma.businessLogo.findUnique({ where: { id: 1 } }), getSettings()]);
  if (!logo || !settings.hasLogo) throw new AppError(404, "NOT_FOUND", "La pesquera no tiene logo.");
  const bytes = typeof OffscreenCanvas === "function" ? await renderLogo(logo.image, logo.round, "logo-192.webp") : logo.image;
  res.json({ data: firmar(sk, D.logo, JSON.stringify({ v: settings.logoVersion, tipo: typeof OffscreenCanvas === "function" ? "image/webp" : "image/png", datos: base64(bytes) })) });
});

const MensajesSchema = z.object({ eventos: z.array(z.object({ id: z.string(), kind: z.number(), pubkey: z.string(), created_at: z.number(), content: z.string(), tags: z.array(z.array(z.string())), sig: z.string() })).max(50) });
const PedidoSchema = z.object({ tipo: z.literal("pedido"), ref: z.string().max(64), pedido: z.unknown() });
const ConsultaSchema = z.object({ tipo: z.literal("consulta"), orderId: z.uuid() });

/** Abre los mensajes cifrados que llegaron (pedidos y consultas) y devuelve las respuestas, ya cifradas. */
tiendaRoutes.post("/mensajes", async (req: Req, res: Res) => {
  const sk = await llave();
  const { eventos } = MensajesSchema.parse(req.body ?? {});
  const respuestas: Event[] = [];
  const nuevos: string[] = [];

  for (const evento of eventos) {
    let rumor: { id: string; pubkey: string; content: string };
    try {
      rumor = nip17.unwrapEvent(evento as Event, sk);
    } catch {
      continue; // No es para esta tienda o está dañado.
    }
    let contenido: unknown;
    try {
      contenido = JSON.parse(rumor.content);
    } catch {
      continue;
    }

    const consulta = ConsultaSchema.safeParse(contenido);
    if (consulta.success) {
      const online = await prisma.onlineOrder.findUnique({ where: { orderId: consulta.data.orderId } });
      if (online && online.customerPubkey === rumor.pubkey) respuestas.push(mensaje(sk, rumor.pubkey, { tipo: "estado", pedido: await seguimiento(online.orderId, online.trackingKey) }));
      continue;
    }

    const pedido = PedidoSchema.safeParse(contenido);
    if (!pedido.success) continue;
    const { ref } = pedido.data;

    // El mismo mensaje puede llegar por varios retransmisores: se registra una sola vez.
    const repetido = await prisma.onlineOrder.findUnique({ where: { messageId: rumor.id } });
    if (repetido) {
      respuestas.push(mensaje(sk, rumor.pubkey, { tipo: "confirmado", ref, pedido: await seguimiento(repetido.orderId, repetido.trackingKey) }));
      continue;
    }
    try {
      const recientes = await prisma.onlineOrder.count({ where: { customerPubkey: rumor.pubkey, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
      if (recientes >= PEDIDOS_POR_HORA) throw new AppError(429, "TOO_MANY_ORDERS", "Ya enviaste varios pedidos en la última hora. Escríbenos por WhatsApp si necesitas otro.");
      const input = StoreOrderSchema.parse(pedido.data.pedido);
      if (input.website) throw new AppError(400, "SPAM", "No pudimos recibir el pedido.");
      const { order, trackingKey } = await ordersService.createFromStore(input);
      await prisma.onlineOrder.create({ data: { messageId: rumor.id, orderId: order.id, customerPubkey: rumor.pubkey, trackingKey } });
      nuevos.push(order.id);
      respuestas.push(mensaje(sk, rumor.pubkey, { tipo: "confirmado", ref, pedido: await seguimiento(order.id, trackingKey) }));
    } catch (error) {
      const campos = error instanceof ZodError ? Object.fromEntries(error.issues.map((issue) => [issue.path.join("."), issue.message])) : undefined;
      const texto = error instanceof AppError ? error.message : error instanceof ZodError ? "Revisa los datos del pedido." : "No pudimos registrar el pedido. Intenta de nuevo.";
      respuestas.push(mensaje(sk, rumor.pubkey, { tipo: "rechazado", ref, mensaje: texto, ...(campos ? { campos } : {}) }));
    }
  }
  res.json({ data: { respuestas, nuevos } });
});

/** Avisos de estado para los clientes de estos pedidos (si llegaron por el QR). */
tiendaRoutes.post("/avisos", async (req: Req, res: Res) => {
  const sk = await llave();
  const { orderIds } = z.object({ orderIds: z.array(z.uuid()).max(50) }).parse(req.body ?? {});
  const online = await prisma.onlineOrder.findMany({ where: { orderId: { in: orderIds } } });
  const respuestas = await Promise.all(online.map(async (fila) => mensaje(sk, fila.customerPubkey, { tipo: "estado", pedido: await seguimiento(fila.orderId, fila.trackingKey) })));
  res.json({ data: { respuestas } });
});
