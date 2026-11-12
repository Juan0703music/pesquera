// Ajustes → Tienda por QR: activar, abrir o pausar, ver la conexión, y el QR para imprimir o compartir.
import { $, api, descargar, esc, fmt, motorListo, sesionGuardada, showError, toast } from "/js/core.js";

const money = (value) => Number(String(value).replace(/\D/g, "")) || 0;
let config = null;
let qrUrl = null;
let puente = null;

async function cargarQr() {
  await motorListo();
  const res = await fetch("/api/v1/tienda/qr.png", { headers: { "X-Marea-Sesion": sesionGuardada.get() ?? "" } });
  if (!res.ok) return;
  if (qrUrl) URL.revokeObjectURL(qrUrl);
  qrUrl = URL.createObjectURL(await res.blob());
  $("#tqr-codigo").innerHTML = `<img src="${qrUrl}" alt="Código QR de la tienda" />`;
  $("#cartel-qr").src = qrUrl;
}

function hora(iso) {
  return iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" }) : "—";
}

function pintarEstado() {
  if (!config?.activada) return;
  const conectados = puente?.conectados ?? 0;
  const total = puente?.total ?? config.retransmisores.length;
  const enLinea = puente?.activo && conectados > 0;
  $("#tqr-estado").innerHTML = `
    <div><dt>Conexión</dt><dd>${enLinea ? `En línea (${conectados} de ${total} retransmisores)` : puente?.activo ? "Conectando…" : "Esperando: abre cualquier pantalla de Marea"}</dd></div>
    <div><dt>Catálogo publicado</dt><dd>${hora(puente?.ultimaPublicacion)}</dd></div>
    <div><dt>Pedidos por QR (desde que abriste Marea)</dt><dd>${fmt.num(puente?.pedidosRecibidos ?? 0)}</dd></div>
    ${puente?.error ? `<div><dt>Último problema</dt><dd>${esc(puente.error)}</dd></div>` : ""}`;
}

function pintar() {
  $("#tqr-inactiva").hidden = config.activada;
  $("#tqr-activa").hidden = !config.activada;
  if (!config.activada) return;
  $("#tqr-abierta").checked = config.abierta;
  $("#tqr-minimo").value = config.minOrderTotal ? fmt.num(config.minOrderTotal) : "";
  $("#tqr-abrir").href = config.enlace;
  pintarEstado();
}

async function cargar() {
  config = (await api("/tienda/estado")).data;
  pintar();
  if (config.activada) await cargarQr();
}

async function guardar(cambios) {
  try {
    const { data } = await api("/tienda/estado", { method: "PUT", body: { abierta: config.abierta, minOrderTotal: config.minOrderTotal, ...cambios } });
    config = { ...config, ...data, ...cambios };
    pintar();
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

$("#tqr-activar").addEventListener("click", async (event) => {
  const boton = event.currentTarget;
  boton.disabled = true;
  if (await guardar({ abierta: true })) {
    await cargar();
    toast("Tienda por QR activada", { detail: "Descarga el QR y ponlo en el mostrador o compártelo por WhatsApp.", iconName: "qr", timeout: 7000 });
  }
  boton.disabled = false;
});
$("#tqr-abierta").addEventListener("change", async (event) => {
  const abierta = event.target.checked;
  if (await guardar({ abierta })) toast(abierta ? "Recibiendo pedidos por el QR" : "Pedidos por el QR en pausa", { detail: abierta ? "" : "Los clientes ven la tienda, pero no pueden pedir." });
});
$("#tqr-minimo").addEventListener("change", (event) => guardar({ minOrderTotal: money(event.target.value) }));
$("#tqr-descargar").addEventListener("click", () => descargar("/tienda/qr.png", "qr-tienda.png").catch(showError));
$("#tqr-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(config.enlace);
    toast("Enlace copiado", { detail: "Pégalo en tu estado de WhatsApp o en tus redes." });
  } catch {
    prompt("Copia el enlace de tu tienda:", config.enlace);
  }
});
$("#tqr-imprimir").addEventListener("click", async () => {
  const { data } = await api("/settings");
  $("#cartel-nombre").textContent = data.businessName;
  if (data.logo) {
    $("#cartel-logo").src = data.logo.large;
    $("#cartel-logo").hidden = false;
  }
  document.body.classList.add("imprimiendo-cartel");
  setTimeout(() => {
    window.print();
    document.body.classList.remove("imprimiendo-cartel");
  }, 300);
});

// Estado del puente (lo maneja una de las pestañas de Marea).
const canal = new BroadcastChannel("marea-puente");
canal.addEventListener("message", ({ data }) => {
  if (data?.tipo !== "estado") return;
  puente = data.estado;
  pintarEstado();
});
setInterval(() => canal.postMessage({ tipo: "pregunta" }), 5000);
canal.postMessage({ tipo: "pregunta" });

cargar().catch(showError);
