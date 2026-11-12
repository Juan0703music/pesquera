/**
 * Reemplaza a src/modules/auth/auth.service.ts al empaquetar. En el navegador la entrada la maneja
 * sesion.ts; aquí quedan las funciones que usa orders.service para el seguimiento de los pedidos de la
 * tienda (la del QR): un código aleatorio y su huella SHA-256 (síncrona, como en el servidor).
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { randomToken } from "./cripto.js";

export const generateToken = () => randomToken();

export const hashToken = (token: string): string => bytesToHex(sha256(utf8ToBytes(token)));

export const authService = {};
