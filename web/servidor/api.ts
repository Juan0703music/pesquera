/**
 * La «API» de Marea dentro del navegador: las mismas rutas del servidor (src/modules/*), montadas en un
 * enrutador compatible con Express, con la entrada, el personal y las copias propios de esta versión.
 * El service worker le pasa cada petición de las pantallas a `atender`.
 */
import { apiNotFound, errorHandler } from "../../src/middlewares/errorHandler.js";
import { analyticsRoutes } from "../../src/modules/analytics/analytics.routes.js";
import { catalogRoutes } from "../../src/modules/catalog/catalog.routes.js";
import { mediaRoutes } from "../../src/modules/catalog/photos.js";
import { customersRoutes } from "../../src/modules/customers/customers.routes.js";
import { inventoryRoutes } from "../../src/modules/inventory/inventory.routes.js";
import { ordersRoutes } from "../../src/modules/orders/orders.routes.js";
import { paymentAccountsRoutes } from "../../src/modules/payments/payment-accounts.routes.js";
import { paymentAccountsService } from "../../src/modules/payments/payment-accounts.service.js";
import { salesRoutes } from "../../src/modules/sales/sales.routes.js";
import { logoMediaRoutes } from "../../src/modules/settings/logo.js";
import { settingsRoutes } from "../../src/modules/settings/settings.routes.js";
import { authenticate } from "./autenticacion.js";
import { prisma } from "./db.js";
import { createResponse, Router, type Req, type Res } from "./express.js";
import { personalRoutes } from "./personal.js";
import { respaldoRoutes } from "./respaldo.js";
import { sesionRoutes } from "./sesion.js";
import { tiendaRoutes } from "./tienda.js";

const api = Router();
api.get("/health", async (_req: Req, res: Res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ data: { status: "ok", modo: "navegador" } });
});
api.use("/auth", sesionRoutes);
// QR de cobro en PNG para guardarlo o enviarlo (como en la tienda del servidor: sin sesión).
api.get("/store/payment-accounts/:id/qr.png", async (req: Req, res: Res) => {
  const png = await paymentAccountsService.qrPng(req.params.id ?? "");
  res.set("Content-Disposition", 'attachment; filename="qr-de-pago.png"').type("png").send(png);
});
// Desde aquí, todo exige sesión.
api.use(authenticate);
api.use("/settings", settingsRoutes);
api.use("/users", personalRoutes);
api.use("/catalog", catalogRoutes);
api.use("/inventory", inventoryRoutes);
api.use("/customers", customersRoutes);
api.use("/orders", ordersRoutes);
api.use("/payment-accounts", paymentAccountsRoutes);
api.use("/sales", salesRoutes);
api.use("/analytics", analyticsRoutes);
api.use("/respaldo", respaldoRoutes);
api.use("/tienda", tiendaRoutes);

const raiz = Router();
raiz.use("/api/v1", api, apiNotFound);
raiz.use("/media", mediaRoutes, logoMediaRoutes);
raiz.use(errorHandler);

const RAW_TYPES = /^(image\/|application\/(gzip|x-gzip|octet-stream))/;

/**
 * Atiende una petición. `ruta` es la dirección sin la base del sitio (por ejemplo «/api/v1/orders»).
 * Devuelve null si nadie la atiende (para que el navegador siga con su comportamiento normal).
 */
export async function atender(request: Request, ruta: string, base = "/"): Promise<Response | null> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => (headers[key] = value));
  const method = request.method.toUpperCase();

  let body: unknown;
  let parseError: unknown;
  if (method !== "GET" && method !== "HEAD") {
    const type = headers["content-type"] ?? "";
    if (type.includes("application/json")) {
      const text = await request.text();
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        parseError = { type: "entity.parse.failed" };
      }
    } else if (RAW_TYPES.test(type)) {
      body = Buffer.from(await request.arrayBuffer());
    }
  }

  const req: Req = {
    method,
    path: ruta,
    url: ruta + url.search,
    originalUrl: ruta + url.search,
    baseUrl: "",
    params: {},
    query: Object.fromEntries(url.searchParams),
    headers,
    body,
    requestId: crypto.randomUUID(),
  };
  const res = createResponse();
  let atendida = true;

  if (parseError) {
    await errorHandler(parseError, req as never, res as never, () => {});
  } else {
    raiz(req, res, (error) => {
      if (res.headersSent) return;
      if (error) void errorHandler(error, req as never, res as never, () => {});
      else {
        atendida = false;
        res.end();
      }
    });
  }
  await res.terminada;
  if (!atendida) return null;

  const status = res.statusCode;
  const sinCuerpo = status === 204 || status === 304 || method === "HEAD";
  let cuerpo = res.body ?? null;
  // Las direcciones de fotos y logo («/media/…») llevan la base del sitio (por ejemplo «/pesquera/media/…»).
  if (base !== "/" && typeof cuerpo === "string" && (res.headers["content-type"] ?? "").includes("json")) {
    cuerpo = cuerpo.replaceAll('"/media/', `"${base}media/`);
  }
  return new Response(sinCuerpo ? null : (cuerpo as BodyInit | null), { status, headers: res.headers });
}
