/** Lo que algunos módulos esperan de Node o de un sitio aislado, en su versión para el navegador (esbuild lo inyecta). */
import { Buffer } from "buffer";

const process = {
  env: { NODE_ENV: "production" } as Record<string, string | undefined>,
  versions: {} as Record<string, string>,
  platform: "browser",
  cwd: () => "/",
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
};

/**
 * El runtime de Prisma pregunta «¿es un SharedArrayBuffer?» al guardar bytes (fotos, logo). Ese tipo solo existe
 * en sitios con aislamiento entre orígenes, que GitHub Pages no ofrece: sin él la pregunta revienta. Con esta clase
 * vacía la respuesta es simplemente «no». (PGlite no lo usa.)
 */
const SharedArrayBufferSeguro: typeof SharedArrayBuffer =
  typeof globalThis.SharedArrayBuffer === "function" ? globalThis.SharedArrayBuffer : (class SharedArrayBuffer {} as unknown as typeof globalThis.SharedArrayBuffer);

export { Buffer, process, SharedArrayBufferSeguro as SharedArrayBuffer };
