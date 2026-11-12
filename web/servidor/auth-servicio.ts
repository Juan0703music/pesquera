/**
 * Reemplaza a src/modules/auth/auth.service.ts al empaquetar. En el navegador la entrada la maneja
 * sesion.ts; aquí solo quedan las funciones que importa orders.service para el seguimiento de pedidos de la
 * tienda en línea, que no existe en esta versión (ninguna ruta las usa).
 */
import { randomToken } from "./cripto.js";

export const generateToken = () => randomToken();

export const hashToken = (_token: string): string => {
  throw new Error("El seguimiento de pedidos de la tienda en línea no existe en la versión del navegador.");
};

export const authService = {};
