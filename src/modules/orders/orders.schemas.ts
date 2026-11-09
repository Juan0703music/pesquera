import { z } from "zod";
import { phoneSchema } from "../../utils/phone.js";
import { qtySchema } from "../../utils/quantity.js";

/**
 * La pesquera no hace domicilios: todos los pedidos se recogen en el local (deliveryType = RECOGE).
 * Los pedidos antiguos con domicilio se conservan en el historial tal como se registraron.
 */

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const PaymentMethodSchema = z.enum(["EFECTIVO", "TRANSFERENCIA", "NEQUI", "BRE_B", "DATAFONO", "CREDITO"], { error: "Elige la forma de pago." });

export const ItemInputSchema = z.object({
  productId: z.uuid("Elige un producto."),
  /** Kilos (con decimales) o unidades, según el producto. */
  qty: qtySchema,
  /** Cómo lo quiere: «Limpio», «En postas»… (lo elige en la tienda o lo escribe el personal). */
  note: optionalText(120),
});

const CustomerInputSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del cliente.").max(80),
  phone: z.preprocess(emptyToUndefined, phoneSchema.optional()),
});

/** Pedido que recibe el personal (mostrador, llamada o WhatsApp). */
export const CreateOrderSchema = z.object({
  source: z.enum(["MOSTRADOR", "TELEFONO", "WHATSAPP"], { error: "Elige por dónde llegó el pedido." }),
  customer: CustomerInputSchema,
  paymentMethod: PaymentMethodSchema,
  /** Ya pagó (no aplica a crédito). */
  paid: z.boolean().default(false),
  notes: optionalText(300),
  items: z.array(ItemInputSchema).min(1, "Agrega al menos un producto.").max(60),
  /** Venta de mostrador: el cliente se la lleva ya (se descuenta del inventario en el acto). */
  completeNow: z.boolean().default(false),
});

/** Pedido desde la tienda en línea (sin sesión). El cliente lo recoge en la pesquera. */
export const StoreOrderSchema = z.object({
  customer: CustomerInputSchema.extend({ phone: phoneSchema }),
  paymentMethod: z.enum(["EFECTIVO", "TRANSFERENCIA", "NEQUI", "BRE_B", "DATAFONO"], { error: "Elige la forma de pago." }),
  notes: optionalText(300),
  items: z.array(ItemInputSchema).min(1, "Agrega al menos un producto.").max(40),
  /** Campo trampa: las personas no lo ven; los robots lo llenan. */
  website: z.string().max(200).optional(),
});

/** «DESPACHADO» se acepta por compatibilidad: como el cliente recoge, despachar es entregar. */
export const StatusSchema = z.object({
  status: z.enum(["ALISTANDO", "LISTO", "DESPACHADO", "ENTREGADO"], { error: "Estado no válido." }),
});

export const WeighSchema = z.object({
  items: z.array(z.object({ itemId: z.uuid(), actualQty: qtySchema })).min(1, "Escribe al menos un peso."),
});

export const CollectSchema = z.object({ paymentMethod: PaymentMethodSchema });

export const CancelSchema = z.object({ reason: z.string().trim().min(3, "Escribe el motivo de la cancelación.").max(200) });

export const ListOrdersQuery = z.object({
  /** board: pedidos abiertos + los cerrados hoy (tablero). */
  view: z.enum(["board", "all"]).default("board"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type StoreOrderInput = z.infer<typeof StoreOrderSchema>;
export type ItemInput = z.infer<typeof ItemInputSchema>;
