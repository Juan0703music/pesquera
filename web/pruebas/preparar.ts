// En el navegador el service worker compila el motor de Prisma al arrancar; aquí se hace desde el archivo.
import { readFileSync } from "node:fs";

(globalThis as { __mareaCompiladorPrisma?: WebAssembly.Module }).__mareaCompiladorPrisma = new WebAssembly.Module(
  readFileSync(new URL("../generado/prisma/internal/query_compiler_fast_bg.wasm", import.meta.url)),
);
