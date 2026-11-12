/**
 * Construye la versión de Marea que corre en el navegador (web/dist), lista para publicar como sitio estático.
 *
 *   node web/construir.mjs                 sitio en la raíz («/»), para probar en este computador
 *   node web/construir.mjs --base /pesquera/   para GitHub Pages (https://juan0703music.github.io/pesquera/)
 *
 * - Copia las pantallas (web/publico) y ajusta sus direcciones a la base del sitio.
 * - Empaqueta el «servidor» (web/servidor/sw.ts + las rutas de src/modules) en dist/sw.js con esbuild,
 *   cambiando lo que solo existe en Node por su versión del navegador.
 * - Copia el motor: PostgreSQL en WebAssembly (PGlite) y el compilador de consultas de Prisma.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(RAIZ, "web");
const DIST = path.join(WEB, "dist");
const desde = (...partes) => path.join(RAIZ, ...partes);

const argumento = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
};
let BASE = argumento("--base") ?? "/";
if (!BASE.startsWith("/")) BASE = `/${BASE}`;
if (!BASE.endsWith("/")) BASE += "/";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const escribir = (destino, datos) => {
  mkdirSync(path.dirname(destino), { recursive: true });
  writeFileSync(destino, datos);
};

/* ───────────── 1. Pantallas, con las direcciones según la base ───────────── */
// Direcciones absolutas del sitio («/js/…», «/app/pedidos», «/login»…) → «/pesquera/js/…».
const DIRECCIONES = /(["'`(=])\/(api\/v1|js\/|css\/|media\/|vendor\/|app\/|app(?=["'`])|login(?=["'`?#])|404\.html)/g;
const reescribir = (texto) => (BASE === "/" ? texto : texto.replace(DIRECCIONES, `$1${BASE}$2`));

function copiarCarpeta(origen, destino) {
  for (const nombre of readdirSync(origen)) {
    const de = path.join(origen, nombre);
    const a = path.join(destino, nombre);
    if (statSync(de).isDirectory()) copiarCarpeta(de, a);
    else if (/\.(html|js|css)$/.test(nombre)) escribir(a, reescribir(readFileSync(de, "utf8")));
    else escribir(a, readFileSync(de));
  }
}
copiarCarpeta(path.join(WEB, "publico"), DIST);
writeFileSync(path.join(DIST, ".nojekyll"), ""); // GitHub Pages: servir los archivos tal cual

/* ───────────── 2. Three.js y la tipografía (sin CDN) ───────────── */
const three = desde("node_modules/three/build");
for (const archivo of ["three.module.js", "three.core.js"]) {
  try {
    escribir(path.join(DIST, "vendor/three", archivo), readFileSync(path.join(three, archivo)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (archivo === "three.module.js") throw error;
  }
}
const css = readFileSync(path.join(WEB, "publico/css/app.css"), "utf8");
for (const [, fuente] of css.matchAll(/url\(["']?\/vendor\/fonts\/([^"')]+)["']?\)/g)) {
  escribir(path.join(DIST, "vendor/fonts", fuente), readFileSync(desde("node_modules/@fontsource-variable/bricolage-grotesque/files", fuente)));
}

/* ───────────── 3. Motor: PGlite y el compilador de Prisma ───────────── */
const MOTOR = {
  "motor/pglite.wasm": desde("node_modules/@electric-sql/pglite/dist/pglite.wasm"),
  "motor/initdb.wasm": desde("node_modules/@electric-sql/pglite/dist/initdb.wasm"),
  "motor/pglite.data": desde("node_modules/@electric-sql/pglite/dist/pglite.data"),
  "motor/prisma.wasm": desde("web/generado/prisma/internal/query_compiler_fast_bg.wasm"),
};
for (const [destino, origen] of Object.entries(MOTOR)) escribir(path.join(DIST, destino), readFileSync(origen));

/* ───────────── 4. Listas de archivos y versiones (para guardarlos y poder abrir sin internet) ───────────── */
function listar(carpeta, prefijo = "") {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = path.join(carpeta, nombre);
    const relativa = prefijo + nombre;
    return statSync(ruta).isDirectory() ? listar(ruta, `${relativa}/`) : [relativa];
  });
}
const huella = (archivos) => {
  const hash = createHash("sha256");
  for (const archivo of archivos.sort()) hash.update(archivo).update(readFileSync(path.join(DIST, archivo)));
  return hash.digest("hex").slice(0, 12);
};
const archivosApp = listar(DIST).filter((archivo) => !archivo.startsWith("motor/") && archivo !== ".nojekyll");
const archivosMotor = Object.keys(MOTOR);

/* ───────────── 5. El «servidor»: service worker con las rutas de Marea ───────────── */
const ts = (ruta) => desde(ruta);
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
]);
const PRISMA_SERVIDOR = ts("src/generated/prisma") + path.sep;
const PRISMA_WEB = ts("web/generado/prisma") + path.sep;

const navegador = {
  name: "marea-navegador",
  setup(b) {
    b.onResolve({ filter: /^express$/ }, () => ({ path: ts("web/servidor/express.ts") }));
    b.onResolve({ filter: /^virtual:migraciones$/ }, () => ({ path: "migraciones", namespace: "marea" }));
    b.onResolve({ filter: /\.wasm\?module$/ }, () => ({ path: "compilador-prisma", namespace: "marea" }));
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.resolveDir) return undefined;
      const absoluta = path.resolve(args.resolveDir, args.path).replace(/\.js$/, ".ts");
      if (REEMPLAZOS.has(absoluta)) return { path: REEMPLAZOS.get(absoluta) };
      if (absoluta.startsWith(PRISMA_SERVIDOR)) return { path: PRISMA_WEB + absoluta.slice(PRISMA_SERVIDOR.length) };
      return undefined;
    });
    b.onLoad({ filter: /^migraciones$/, namespace: "marea" }, () => {
      const carpeta = desde("prisma/migrations");
      const migraciones = readdirSync(carpeta)
        .filter((nombre) => /^\d/.test(nombre))
        .sort()
        .map((nombre) => ({ nombre, sql: readFileSync(path.join(carpeta, nombre, "migration.sql"), "utf8") }));
      return { contents: `export const MIGRACIONES = ${JSON.stringify(migraciones)};`, loader: "js" };
    });
    // El cliente web de Prisma pide su compilador como módulo WebAssembly: el service worker lo compila al arrancar.
    b.onLoad({ filter: /^compilador-prisma$/, namespace: "marea" }, () => ({
      contents: "export default globalThis.__mareaCompiladorPrisma;",
      loader: "js",
    }));
  },
};

const resultado = await build({
  entryPoints: [ts("web/servidor/sw.ts")],
  outfile: path.join(DIST, "sw.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  metafile: true,
  inject: [ts("web/servidor/inyectar.ts")],
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.url": "self.location.href",
    __MAREA_VERSION__: JSON.stringify(huella(archivosApp)),
    __MAREA_ARCHIVOS__: JSON.stringify(archivosApp),
    __MAREA_MOTOR__: JSON.stringify({ version: huella(archivosMotor), archivos: archivosMotor }),
  },
  plugins: [navegador],
  logLevel: "warning",
});

const peso = (archivo) => `${(statSync(path.join(DIST, archivo)).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`Marea para el navegador lista en web/dist (base «${BASE}»):`);
console.log(`  ${archivosApp.length} archivos de pantallas · sw.js ${peso("sw.js")} · motor ${archivosMotor.map(peso).join(" + ")}`);
if (process.argv.includes("--analizar")) {
  const { analyzeMetafile } = await import("esbuild");
  console.log(await analyzeMetafile(resultado.metafile, { verbose: false }));
}
