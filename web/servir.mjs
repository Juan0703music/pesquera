/**
 * Sirve web/dist como lo hace GitHub Pages (archivos estáticos, «/app/pedidos» → app/pedidos.html), para
 * probar la versión del navegador en este computador:  node web/servir.mjs [--base /pesquera/] [--puerto 4173]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const argumento = (nombre, defecto) => {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? defecto : process.argv[i + 1];
};
const BASE = argumento("--base", "/");
const PUERTO = Number(argumento("--puerto", "4173"));
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function archivo(ruta) {
  for (const candidato of [ruta, `${ruta}.html`, path.join(ruta, "index.html")]) {
    try {
      if ((await stat(candidato)).isFile()) return candidato;
    } catch {
      // Sigue con el siguiente.
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end("Fuera del sitio");
    return;
  }
  const relativa = decodeURIComponent(url.pathname.slice(BASE.length));
  const destino = path.normalize(path.join(DIST, relativa));
  if (!destino.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  const encontrado = await archivo(destino);
  if (!encontrado) {
    res.writeHead(404, { "Content-Type": TIPOS[".html"] }).end(await readFile(path.join(DIST, "404.html")));
    return;
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(encontrado)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(await readFile(encontrado));
}).listen(PUERTO, () => console.log(`Marea (navegador) en http://localhost:${PUERTO}${BASE}`));
