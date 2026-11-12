import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * Pruebas de la versión del navegador (web/): el mismo «servidor» que corre en el service worker, aquí en
 * Node con PGlite en memoria. Los reemplazos de módulos son los mismos de web/construir.mjs.
 */
const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const ts = (ruta: string) => path.join(RAIZ, ruta);
const REEMPLAZOS = new Map([
  [ts("src/config/database.ts"), ts("web/servidor/db.ts")],
  [ts("src/config/env.ts"), ts("web/servidor/env.ts")],
  [ts("src/utils/logger.ts"), ts("web/servidor/logger.ts")],
  [ts("src/services/live.service.ts"), ts("web/servidor/live.ts")],
  [ts("src/middlewares/authenticate.ts"), ts("web/servidor/autenticacion.ts")],
  [ts("src/modules/push/push.service.ts"), ts("web/servidor/avisos.ts")],
  [ts("src/modules/auth/auth.service.ts"), ts("web/servidor/auth-servicio.ts")],
  [ts("src/modules/catalog/photo-image.ts"), ts("web/servidor/foto-imagen.ts")],
  [ts("src/modules/settings/logo-image.ts"), ts("web/servidor/logo-imagen.ts")],
  [ts("src/modules/payments/qr-image.ts"), ts("web/servidor/qr-imagen.ts")],
  [ts("src/middlewares/rateLimiter.ts"), ts("web/servidor/limites.ts")],
]);
const PRISMA_SERVIDOR = ts("src/generated/prisma") + path.sep;
const PRISMA_WEB = ts("web/generado/prisma") + path.sep;

function navegador(): Plugin {
  return {
    name: "marea-navegador",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "express") return ts("web/servidor/express.ts");
      if (source === "virtual:migraciones") return "\0marea-migraciones";
      if (source.endsWith(".wasm?module")) return "\0marea-compilador-prisma";
      if (!importer || !/^\.\.?\//.test(source)) return null;
      const absoluta = path.resolve(path.dirname(importer), source).replace(/\.js$/, ".ts");
      if (REEMPLAZOS.has(absoluta)) return REEMPLAZOS.get(absoluta)!;
      if (absoluta.startsWith(PRISMA_SERVIDOR)) return PRISMA_WEB + absoluta.slice(PRISMA_SERVIDOR.length);
      return null;
    },
    load(id) {
      if (id === "\0marea-compilador-prisma") return "export default globalThis.__mareaCompiladorPrisma;";
      if (id !== "\0marea-migraciones") return null;
      const carpeta = ts("prisma/migrations");
      const migraciones = readdirSync(carpeta)
        .filter((nombre) => /^\d/.test(nombre))
        .sort()
        .map((nombre) => ({ nombre, sql: readFileSync(path.join(carpeta, nombre, "migration.sql"), "utf8") }));
      return `export const MIGRACIONES = ${JSON.stringify(migraciones)};`;
    },
  };
}

export default defineConfig({
  plugins: [navegador()],
  test: {
    include: ["web/pruebas/**/*.test.ts"],
    setupFiles: ["web/pruebas/preparar.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
