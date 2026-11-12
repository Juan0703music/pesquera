/** Lo que comparten la pesquera (service worker y puente) y la tienda del cliente. */

/** Retransmisores públicos y gratuitos de la red Nostr (probados: aceptan mensajes de 128 KB o más). */
export const RETRANSMISORES = ["wss://relay.snort.social", "wss://offchain.pub", "wss://nostr.oxtr.dev", "wss://relay.nostr.net", "wss://relay.primal.net"];

/** Datos de aplicación reemplazables (NIP-78): el último publicado reemplaza al anterior. */
export const KIND_DATOS = 30078;

/** Mensajes cifrados (NIP-17 / NIP-59): pedidos del cliente y respuestas de la tienda. */
export const KIND_MENSAJE = 1059;

export const D = {
  catalogo: "marea-catalogo",
  estado: "marea-estado",
  logo: "marea-logo",
  foto: (productId: string) => `marea-foto-${productId}`,
};

/** Si el último «estoy conectada» de la pesquera es más viejo que esto, la tienda se muestra cerrada. */
export const PRESENCIA_MAXIMA_MS = 6 * 60 * 1000;
