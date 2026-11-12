/** Registro mínimo para la versión del navegador (reemplaza a pino). Los errores salen completos en la consola. */
type Log = (objOrMsg?: unknown, msg?: string) => void;

function detalle(valor: unknown): string {
  if (valor instanceof Error) return `${valor.name}: ${valor.message}${valor.stack ? `\n${valor.stack}` : ""}`;
  if (valor && typeof valor === "object") {
    const posible = (valor as { err?: unknown; error?: unknown }).err ?? (valor as { error?: unknown }).error;
    if (posible instanceof Error) return detalle(posible);
    try {
      return JSON.stringify(valor);
    } catch {
      return String(valor);
    }
  }
  return String(valor ?? "");
}

const silent: Log = () => {};
const warn: Log = (obj, msg) => console.warn(`[Marea] ${msg ?? ""} ${detalle(obj)}`.trim());
const error: Log = (obj, msg) => console.error(`[Marea] ${msg ?? ""} ${detalle(obj)}`.trim());

export const logger = {
  trace: silent,
  debug: silent,
  info: silent,
  warn,
  error,
  fatal: error,
  child: () => logger,
};
