/**
 * Copias de seguridad en la versión del navegador (montado en /api/v1/respaldo, solo el administrador).
 * La copia es la base completa de PostgreSQL (fotos y logo incluidos) en un archivo .tar.gz que se descarga
 * al computador. Restaurar reemplaza todo lo de este navegador por lo de la copia, después de revisarla.
 */
import { requirePermission } from "./autenticacion.js";
import { restaurarCopia } from "./copias.js";
import { volcarBase } from "./db.js";
import { Router } from "./express.js";

export const respaldoRoutes = Router();
respaldoRoutes.use(requirePermission("admin.manage"));

respaldoRoutes.get("/descargar", async (_req, res) => {
  const copia = await volcarBase();
  const fecha = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Bogota", dateStyle: "short" }).format(new Date());
  res
    .set({ "Content-Disposition": `attachment; filename="marea-copia-${fecha}.tar.gz"`, "Cache-Control": "no-store" })
    .type("application/gzip")
    .send(copia);
});

respaldoRoutes.post("/restaurar", async (req, res) => {
  await restaurarCopia(req.body);
  res.json({ data: { ok: true } });
});
