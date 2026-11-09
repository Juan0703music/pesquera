import { z } from "zod";

/** Dinero: enteros en pesos colombianos (COP), sin centavos. Tope por valor: 100 millones. */
export const MAX_COP = 100_000_000;

export const copSchema = z
  .number({ error: "Escribe un valor en pesos." })
  .int("El valor debe ser un número entero de pesos (sin centavos).")
  .min(0, "El valor no puede ser negativo.")
  .max(MAX_COP, "El valor es demasiado alto.");

export const formatCOP = (value: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
