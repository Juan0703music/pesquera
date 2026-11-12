// Conexión de la tienda (en el celular del cliente) con la pesquera, por retransmisores públicos de Nostr.
//
// - El catálogo lo firma la pesquera: solo se acepta lo publicado por la llave del QR.
// - Cada celular tiene su propia llave (guardada en el celular): con ella se cifran los pedidos y a ella
//   llegan, cifrados, los avisos de cómo va el pedido. Nadie más puede leerlos.
import { D, KIND_DATOS, KIND_MENSAJE, PRESENCIA_MAXIMA_MS, RETRANSMISORES, SimplePool, bytesToHex, generateSecretKey, getPublicKey, hexToBytes, nip17 } from "/js/nostr.js";

const TIENDA_KEY = "marea-tienda";
const CLIENTE_KEY = "marea-cliente-llave";
const pool = new SimplePool();

function leer(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function guardar(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Navegación privada: vale mientras la página esté abierta.
  }
}

/** La llave de la tienda viene en el QR (?t=…); se recuerda para volver sin el QR. */
export function llaveDeTienda() {
  const delEnlace = new URLSearchParams(location.search).get("t");
  if (delEnlace && /^[0-9a-f]{64}$/.test(delEnlace)) {
    guardar(TIENDA_KEY, delEnlace);
    return delEnlace;
  }
  const guardada = leer(TIENDA_KEY);
  return guardada && /^[0-9a-f]{64}$/.test(guardada) ? guardada : null;
}

let llaveCliente = null;
function miLlave() {
  if (llaveCliente) return llaveCliente;
  const guardada = leer(CLIENTE_KEY);
  llaveCliente = guardada && /^[0-9a-f]{64}$/.test(guardada) ? hexToBytes(guardada) : generateSecretKey();
  if (!guardada) guardar(CLIENTE_KEY, bytesToHex(llaveCliente));
  return llaveCliente;
}

export class ErrorTienda extends Error {
  constructor(mensaje, { codigo, campos } = {}) {
    super(mensaje);
    this.code = codigo;
    this.fields = campos;
  }
}

/* ───────────── Catálogo, estado, fotos y logo (públicos, firmados por la pesquera) ───────────── */
/**
 * Escucha el catálogo y el estado de la pesquera. `alCambiar({ catalogo, estado })` se llama con lo más reciente
 * cada vez que la pesquera publica algo nuevo (precios, disponibilidad, abierta o cerrada).
 */
export function escucharTienda(tienda, alCambiar) {
  const ultimo = {};
  const datos = { catalogo: null, estado: null };
  return pool.subscribeMany(RETRANSMISORES, { kinds: [KIND_DATOS], authors: [tienda], "#d": [D.catalogo, D.estado] }, {
    onevent(evento) {
      const d = evento.tags.find((tag) => tag[0] === "d")?.[1];
      if (!d || (ultimo[d] ?? 0) > evento.created_at) return;
      ultimo[d] = evento.created_at;
      try {
        const contenido = JSON.parse(evento.content);
        if (d === D.catalogo) datos.catalogo = contenido;
        if (d === D.estado) datos.estado = { ...contenido, recibido: evento.created_at * 1000 };
        alCambiar({ ...datos });
      } catch {
        // Mensaje dañado: se ignora.
      }
    },
  });
}

/** ¿La pesquera está conectada y recibiendo pedidos? (su último «estoy conectada» es reciente). */
export function pesqueraConectada(estado) {
  return Boolean(estado) && Date.now() - estado.recibido < PRESENCIA_MAXIMA_MS;
}

/** Trae imágenes (fotos de productos o el logo) por su referencia; `alLlegar(d, urlDeDatos, version)`. */
export function traerImagenes(tienda, referencias, alLlegar) {
  const unicas = [...new Set(referencias)];
  if (!unicas.length) return null;
  const versiones = {};
  return pool.subscribeMany(RETRANSMISORES, { kinds: [KIND_DATOS], authors: [tienda], "#d": unicas }, {
    onevent(evento) {
      const d = evento.tags.find((tag) => tag[0] === "d")?.[1];
      try {
        const { v, tipo, datos } = JSON.parse(evento.content);
        if ((versiones[d] ?? -1) >= v) return;
        versiones[d] = v;
        alLlegar(d, `data:${tipo};base64,${datos}`, v);
      } catch {
        // Imagen dañada: se queda la ilustración.
      }
    },
  });
}

/* ───────────── Pedido y seguimiento (cifrados) ───────────── */
function enviar(tienda, datos) {
  const evento = nip17.wrapEvent(miLlave(), { publicKey: tienda }, JSON.stringify(datos));
  return Promise.any(pool.publish(RETRANSMISORES, evento)).catch(() => {
    throw new ErrorTienda("No hay conexión con la pesquera. Revisa tu internet e intenta de nuevo.", { codigo: "SIN_CONEXION" });
  });
}

function escucharRespuestas(alLlegar) {
  const yo = getPublicKey(miLlave());
  // Los mensajes cifrados llevan una fecha aleatoria de hasta 2 días antes: se piden los de 3 días.
  return pool.subscribeMany(RETRANSMISORES, { kinds: [KIND_MENSAJE], "#p": [yo], since: Math.floor(Date.now() / 1000) - 3 * 86400 }, {
    onevent(evento) {
      try {
        const rumor = nip17.unwrapEvent(evento, miLlave());
        alLlegar(JSON.parse(rumor.content), rumor);
      } catch {
        // No era para mí o está dañado.
      }
    },
  });
}

/** Manda el pedido y espera la confirmación de la pesquera (o el motivo del rechazo). */
export async function enviarPedido(tienda, pedido, { esperaMs = 25000 } = {}) {
  const ref = bytesToHex(crypto.getRandomValues(new Uint8Array(12)));
  let sub;
  const respuesta = new Promise((resolve, reject) => {
    sub = escucharRespuestas((mensaje, rumor) => {
      if (mensaje.ref !== ref || rumor.pubkey !== tienda) return;
      if (mensaje.tipo === "confirmado") resolve(mensaje.pedido);
      else if (mensaje.tipo === "rechazado") reject(new ErrorTienda(mensaje.mensaje, { codigo: "RECHAZADO", campos: mensaje.campos }));
    });
    setTimeout(() => reject(new ErrorTienda("La pesquera no respondió a tiempo. Puede que no esté conectada: intenta de nuevo en un momento.", { codigo: "SIN_RESPUESTA" })), esperaMs);
  });
  try {
    await new Promise((r) => setTimeout(r, 400)); // la escucha queda lista antes de enviar
    await enviar(tienda, { tipo: "pedido", ref, pedido });
    return await respuesta;
  } finally {
    sub?.close();
  }
}

/** Sigue un pedido: `alCambiar(pedido)` con cada aviso de la pesquera (y pregunta cómo va al empezar). */
export function seguirPedido(tienda, orderId, alCambiar) {
  let ultimo = 0;
  const sub = escucharRespuestas((mensaje, rumor) => {
    if (rumor.pubkey !== tienda || !mensaje.pedido || mensaje.pedido.id !== orderId) return;
    if (rumor.created_at < ultimo) return;
    ultimo = rumor.created_at;
    alCambiar(mensaje.pedido);
  });
  const preguntar = () => enviar(tienda, { tipo: "consulta", orderId }).catch(() => {});
  setTimeout(preguntar, 600);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && preguntar());
  return sub;
}
