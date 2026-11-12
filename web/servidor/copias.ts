/** Restaurar una copia de seguridad (la usan Ajustes y, en un navegador vacío, la pantalla de entrada). */
import { badRequest } from "../../src/utils/errors.js";
import { reemplazarBase, revisarCopia } from "./db.js";
import { live } from "./live.js";

export async function restaurarCopia(bytes: unknown) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw badRequest("Elige el archivo de la copia (.tar.gz).", "BACKUP_REQUIRED");
  const copia = new Blob([bytes as BlobPart], { type: "application/gzip" });
  let valida = false;
  try {
    valida = await revisarCopia(copia);
  } catch {
    valida = false;
  }
  if (!valida) throw badRequest("Ese archivo no es una copia de seguridad de Marea.", "INVALID_BACKUP");
  await reemplazarBase(copia);
  live.emit("settings", "respaldo.restaurado");
}
