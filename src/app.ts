import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import helmet from "helmet";
import { z } from "zod";
import { originGuard } from "./config/cors.js";
import { prisma } from "./config/database.js";
import { env } from "./config/env.js";
import { authenticate } from "./middlewares/authenticate.js";
import { apiNotFound, errorHandler } from "./middlewares/errorHandler.js";
import { apiLimiter } from "./middlewares/rateLimiter.js";
import { analyticsRoutes } from "./modules/analytics/analytics.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { readSessionToken } from "./modules/auth/session-cookie.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { inventoryRoutes } from "./modules/inventory/inventory.routes.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { salesRoutes } from "./modules/sales/sales.routes.js";
import { settingsRoutes } from "./modules/settings/settings.routes.js";
import { storeRoutes } from "./modules/store/store.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { logger } from "./utils/logger.js";

// Mensajes de validación de Zod en español.
z.config(z.locales.es());

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const threeDir = fileURLToPath(new URL("../node_modules/three/build", import.meta.url));

/** Páginas públicas (tienda en línea e inicio de sesión del equipo). */
const PUBLIC_PAGES: Record<string, string> = {
  "/": "pages/tienda/index.html",
  "/tienda": "pages/tienda/index.html",
  "/tienda/pedido": "pages/tienda/pedido.html",
  "/login": "pages/login.html",
};

/** Pantallas del equipo: sin cookie de sesión van al inicio de sesión (la API valida la sesión en cada llamada). */
const APP_PAGES: Record<string, string> = {
  "/app/pedidos": "pages/app/pedidos.html",
  "/app/inventario": "pages/app/inventario.html",
  "/app/ventas": "pages/app/ventas.html",
  "/app/en-vivo": "pages/app/en-vivo.html",
  "/app/personal": "pages/app/personal.html",
  "/app/ajustes": "pages/app/ajustes.html",
};

function apiRouter(): Router {
  const api = Router();
  api.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.set("Cache-Control", "no-store").json({ data: { status: "ok" } });
    } catch {
      res.status(503).json({ data: { status: "error" } });
    }
  });
  api.use("/auth", authRoutes);
  api.use("/store", storeRoutes);
  // Desde aquí, todo exige sesión.
  api.use(authenticate);
  api.use("/settings", settingsRoutes);
  api.use("/users", usersRoutes);
  api.use("/catalog", catalogRoutes);
  api.use("/inventory", inventoryRoutes);
  api.use("/customers", customersRoutes);
  api.use("/orders", ordersRoutes);
  api.use("/sales", salesRoutes);
  api.use("/analytics", analyticsRoutes);
  return api;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (env.TRUST_PROXY) app.set("trust proxy", env.TRUST_PROXY);

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    const started = performance.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api/")) {
        logger.info({ method: req.method, url: req.originalUrl.split("?")[0], status: res.statusCode, ms: Math.round(performance.now() - started) }, "petición");
      }
    });
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
        },
      },
    }),
  );

  app.use("/api/v1", apiLimiter, originGuard, express.json({ limit: "100kb" }), apiRouter(), apiNotFound);

  // Three.js para las gráficas 3D (servido desde node_modules, sin CDN).
  app.use("/vendor/three", express.static(threeDir, { maxAge: "7d", index: false }));
  app.use(express.static(publicDir, { index: false, maxAge: env.NODE_ENV === "production" ? "1h" : 0 }));

  for (const [route, file] of Object.entries(PUBLIC_PAGES)) {
    app.get(route, (_req, res) => res.sendFile(path.join(publicDir, file)));
  }
  app.get(["/app", "/app/"], (_req, res) => res.redirect(302, "/app/pedidos"));
  for (const [route, file] of Object.entries(APP_PAGES)) {
    app.get(route, (req, res) => {
      if (!readSessionToken(req.headers.cookie)) return res.redirect(302, `/login?volver=${encodeURIComponent(req.originalUrl)}`);
      res.set("Cache-Control", "no-store").sendFile(path.join(publicDir, file));
    });
  }

  app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, "pages/404.html")));
  app.use(errorHandler);
  return app;
}
