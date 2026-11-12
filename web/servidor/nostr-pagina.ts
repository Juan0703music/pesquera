/** Lo de Nostr que usan las pantallas (el puente del panel y la tienda del cliente): se empaqueta en js/nostr.js. */
export { SimplePool } from "nostr-tools/pool";
export { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
export * as nip17 from "nostr-tools/nip17";
export { bytesToHex, hexToBytes } from "@noble/hashes/utils";
export { D, KIND_DATOS, KIND_MENSAJE, PRESENCIA_MAXIMA_MS, RETRANSMISORES } from "./tienda-comun.js";
