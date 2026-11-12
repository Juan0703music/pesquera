// Puente de la tienda por QR: conecta este navegador (la pesquera) con los celulares de los clientes.
//
// Corre en UNA sola pestaña de Marea (candado «marea-puente-tienda»): si se cierra, otra lo toma. Habla con
// retransmisores públicos de la red Nostr y con el service worker (que guarda la llave y los datos):
// - publica el catálogo firmado (precios, disponibilidad, fotos, logo) y un «estoy conectada» cada 2 minutos;
// - recibe los pedidos cifrados y se los pasa a Marea, que los registra y prepara la respuesta;
// - con cada cambio de un pedido del QR, le manda al cliente su estado (cifrado solo para él).
import { api } from "/js/core.js";
import { KIND_MENSAJE, RETRANSMISORES, SimplePool } from "/js/nostr.js";

const CANAL_ESTADO = "marea-puente";
const PRESENCIA_CADA_MS = 2 * 60 * 1000;
const REPUBLICAR_TODO_CADA_MS = 12 * 60 * 60 * 1000;
const FOTOS_KEY = "marea-puente-fotos";
const VISTOS_KEY = "marea-puente-vistos";

const canal = new BroadcastChannel(CANAL_ESTADO);
const estado = { activo: false, conectados: 0, total: RETRANSMISORES.length, ultimaPublicacion: null, pedidosRecibidos: 0, error: null };
const avisar = () => canal.postMessage({ tipo: "estado", estado: { ...estado } });
canal.addEventListener("message", ({ data }) => data?.tipo === "pregunta" && avisar());

const leer = (clave, defecto) => {
  try {
    return JSON.parse(localStorage.getItem(clave) ?? "null") ?? defecto;
  } catch {
    return defecto;
  }
};
const guardar = (clave, valor) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento: se vuelve a publicar todo (no pasa nada grave).
  }
};

let pool = null;
let config = null;

async function publicarEventos(eventos) {
  if (!eventos.length) return;
  const resultados = await Promise.allSettled(eventos.flatMap((evento) => pool.publish(RETRANSMISORES, evento)));
  if (resultados.some((r) => r.status === "fulfilled")) {
    estado.ultimaPublicacion = new Date().toISOString();
    estado.error = null;
  }
}

/** Catálogo + estado; fotos y logo solo si cambiaron (o cada 12 horas, para que los retransmisores no los olviden). */
async function publicarCatalogo() {
  const { data } = await api("/tienda/publicacion");
  await publicarEventos([data.catalogo, data.estado]);
  const ultimaVez = leer(`${FOTOS_KEY}-cuando`, 0);
  const publicadas = Date.now() - ultimaVez > REPUBLICAR_TODO_CADA_MS ? {} : leer(FOTOS_KEY, {});
  if (!Object.keys(publicadas).length) guardar(`${FOTOS_KEY}-cuando`, Date.now());
  for (const foto of data.fotos) {
    if (publicadas[foto.productId] === foto.version) continue;
    try {
      await publicarEventos([(await api(`/tienda/foto/${foto.productId}`)).data]);
      publicadas[foto.productId] = foto.version;
    } catch {
      // Se intenta en la próxima publicación.
    }
  }
  if (data.logo && publicadas.__logo !== data.logo.v) {
    await publicarEventos([(await api("/tienda/logo")).data]).catch(() => {});
    publicadas.__logo = data.logo.v;
  }
  guardar(FOTOS_KEY, publicadas);
  avisar();
}

/* ───────────── Mensajes que llegan de los celulares ───────────── */
let cola = [];
let procesando = false;
const vistos = new Set(leer(VISTOS_KEY, []));

async function procesarCola() {
  if (procesando || !cola.length) return;
  procesando = true;
  const lote = cola.splice(0, 20);
  try {
    const { data } = await api("/tienda/mensajes", { method: "POST", body: { eventos: lote } });
    await publicarEventos(data.respuestas);
    estado.pedidosRecibidos += data.nuevos.length;
    for (const evento of lote) vistos.add(evento.id);
    guardar(VISTOS_KEY, [...vistos].slice(-800));
    if (data.nuevos.length) programarCatalogo(); // cambió lo disponible
    avisar();
  } catch (error) {
    estado.error = error.message;
    cola.unshift(...lote);
    avisar();
    await new Promise((r) => setTimeout(r, 5000));
  } finally {
    procesando = false;
    if (cola.length) void procesarCola();
  }
}

let suscripcion = null;
function suscribirse() {
  suscripcion?.close();
  // Los mensajes cifrados llevan una fecha aleatoria de hasta 2 días antes (NIP-59): se piden los de 3 días.
  suscripcion = pool.subscribeMany(RETRANSMISORES, { kinds: [KIND_MENSAJE], "#p": [config.pubkey], since: Math.floor(Date.now() / 1000) - 3 * 86400 }, {
    onevent(evento) {
      if (vistos.has(evento.id) || cola.some((e) => e.id === evento.id)) return;
      cola.push(evento);
      setTimeout(() => void procesarCola(), 250);
    },
    onclose() {
      // Si se cae, se vuelve a conectar sola.
      setTimeout(() => estado.activo && suscribirse(), 5000);
    },
  });
}

/* ───────────── Cambios en Marea → catálogo y avisos a los clientes ───────────── */
let temporizadorCatalogo = null;
function programarCatalogo() {
  clearTimeout(temporizadorCatalogo);
  temporizadorCatalogo = setTimeout(() => publicarCatalogo().catch((e) => ((estado.error = e.message), avisar())), 4000);
}

const pendientesDeAviso = new Set();
let temporizadorAvisos = null;
function programarAviso(orderId) {
  pendientesDeAviso.add(orderId);
  clearTimeout(temporizadorAvisos);
  temporizadorAvisos = setTimeout(async () => {
    const orderIds = [...pendientesDeAviso];
    pendientesDeAviso.clear();
    try {
      const { data } = await api("/tienda/avisos", { method: "POST", body: { orderIds } });
      await publicarEventos(data.respuestas);
    } catch {
      orderIds.forEach((id) => pendientesDeAviso.add(id));
    }
  }, 600);
}

function escucharMarea() {
  const enVivo = new BroadcastChannel("marea-en-vivo");
  enVivo.addEventListener("message", ({ data: evento }) => {
    if (!evento) return;
    if (evento.scope === "orders" && evento.data?.id) programarAviso(evento.data.id);
    if (["orders", "inventory", "catalog", "settings"].includes(evento.scope)) programarCatalogo();
    if (evento.kind === "tienda.estado") void revisarActivacion();
  });
}

function medirConexiones() {
  const conexiones = pool?.listConnectionStatus?.();
  estado.conectados = conexiones ? [...conexiones.values()].filter(Boolean).length : 0;
  avisar();
}

/* ───────────── Arranque ───────────── */
async function revisarActivacion() {
  config = (await api("/tienda/estado")).data;
  if (!config.activada || estado.activo) {
    if (estado.activo) programarCatalogo();
    return;
  }
  estado.activo = true;
  pool = new SimplePool();
  suscribirse();
  await publicarCatalogo().catch((e) => (estado.error = e.message));
  setInterval(async () => {
    try {
      await publicarEventos([(await api("/tienda/presencia")).data]);
    } catch (error) {
      estado.error = error.message;
    }
    medirConexiones();
  }, PRESENCIA_CADA_MS);
  setTimeout(medirConexiones, 4000);
}

/** Lo llama core.js al abrir cualquier pantalla del panel. */
export function iniciarPuente() {
  if (!("locks" in navigator) || typeof BroadcastChannel !== "function") return;
  void navigator.locks.request("marea-puente-tienda", async () => {
    escucharMarea();
    await revisarActivacion().catch((e) => ((estado.error = e.message), avisar()));
    // El candado se queda tomado mientras esta pestaña esté abierta.
    await new Promise(() => {});
  });
}
