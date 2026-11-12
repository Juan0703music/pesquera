// Copias de seguridad en Ajustes: descargar, restaurar y ver cómo está guardado Marea en este navegador.
import { $, apiRaw, ApiError, descargarCopia, sesionGuardada, showError, toast, ultimaCopia } from "/js/core.js";

const megas = (bytes) => `${(bytes / 1024 / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;

async function pintarEstado() {
  const ultima = ultimaCopia();
  const persistente = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
  const espacio = await navigator.storage?.estimate?.().catch(() => null);
  $("#copias-estado").innerHTML = `
    <div><dt>Última copia</dt><dd>${ultima ? ultima.toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" }) : "Nunca"}</dd></div>
    <div><dt>Espacio usado</dt><dd>${espacio?.usage ? megas(espacio.usage) : "—"}</dd></div>
    <div><dt>Protección del navegador</dt><dd>${persistente ? "Activa: el navegador no borra estos datos por falta de espacio" : "Normal: si el disco se llena, el navegador podría borrar datos. Por eso las copias son importantes."}</dd></div>`;
}

$("#copia-descargar").addEventListener("click", async (event) => {
  const boton = event.currentTarget;
  boton.disabled = true;
  try {
    await descargarCopia();
    await pintarEstado();
  } catch (error) {
    showError(error);
  } finally {
    boton.disabled = false;
  }
});

$("#copia-archivo").addEventListener("change", async (event) => {
  const archivo = event.target.files[0];
  event.target.value = "";
  if (!archivo) return;
  if (!confirm(`¿Restaurar «${archivo.name}»? Todo lo que hay ahora en este navegador se reemplaza por lo de la copia.`)) return;
  try {
    toast("Restaurando la copia…", { iconName: "refresh", timeout: 4000 });
    await apiRaw("/respaldo/restaurar", { method: "POST", body: archivo });
    sesionGuardada.clear();
    location.href = "/login";
  } catch (error) {
    showError(error instanceof ApiError ? error : new ApiError(0, { error: { message: "No se pudo restaurar la copia." } }));
  }
});

pintarEstado().catch(() => {});
