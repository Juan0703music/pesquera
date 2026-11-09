import { z } from "zod";
import type { Unit } from "../generated/prisma/enums.js";
import { badRequest } from "./errors.js";

/**
 * Cantidades en milésimas («milli»): por kilo son gramos (1,5 kg → 1500) y por unidad son milésimas
 * de unidad (3 unidades → 3000). Así kilos y unidades se guardan, suman y comparan con enteros.
 */
export const MILLI = 1000;

/** Máximo por línea o movimiento para detectar errores de digitación: 20 toneladas o 20.000 unidades. */
export const MAX_QTY = 20_000;

/** Cantidad tal como la escribe la persona (kilos con decimales o unidades enteras). */
export const qtySchema = z
  .number({ error: "Escribe una cantidad." })
  .positive("La cantidad debe ser mayor que cero.")
  .max(MAX_QTY, "La cantidad es demasiado alta.");

/** 1.5 (kg) → 1500. Exige unidades enteras en productos por unidad y mínimo 10 g en productos por kilo. */
export function toMilli(qty: number, unit: Unit, productName = "el producto"): number {
  const milli = Math.round(qty * MILLI);
  if (unit === "UNIDAD" && milli % MILLI !== 0) {
    throw badRequest(`${productName} se vende por unidad: escribe una cantidad entera.`, "INVALID_QUANTITY");
  }
  if (unit === "KG" && milli < 10) {
    throw badRequest(`La cantidad mínima de ${productName} es 10 gramos (0,01 kg).`, "INVALID_QUANTITY");
  }
  return milli;
}

export const fromMilli = (milli: number) => milli / MILLI;

/** Valor de una línea: precio por kilo/unidad × cantidad, redondeado al peso (mitades hacia arriba). */
export function lineTotal(unitPrice: number, qtyMilli: number): number {
  return Math.floor((unitPrice * qtyMilli) / MILLI + 0.5);
}

/** «1,5 kg» o «3 und» para mensajes. */
export function formatQty(milli: number, unit: Unit): string {
  const value = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(milli / MILLI);
  return unit === "KG" ? `${value} kg` : `${value} und`;
}
