import { Prisma } from "../../generated/prisma/client.js";
import type { DbClient } from "../../config/database.js";
import { conflict } from "../../utils/errors.js";
import { formatQty } from "../../utils/quantity.js";

/** Estados en los que un pedido todavía no ha salido: su mercancía está comprometida, no descontada. */
export const OPEN_STATUSES = ["RECIBIDO", "ALISTANDO", "LISTO"] as const;

/**
 * Cantidad comprometida por producto: lo que llevan los pedidos abiertos (con el peso real si ya se pesó).
 * Disponible = existencia − comprometido.
 */
export async function committedByProduct(db: DbClient, productIds?: string[]): Promise<Map<string, number>> {
  const filter = productIds?.length ? Prisma.sql`AND oi.product_id IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
  const rows = await db.$queryRaw<{ product_id: string; milli: number }[]>`
    SELECT oi.product_id, SUM(COALESCE(oi.actual_qty_milli, oi.qty_milli))::float8 AS milli
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status IN ('RECIBIDO', 'ALISTANDO', 'LISTO') ${filter}
    GROUP BY oi.product_id`;
  return new Map(rows.map((row) => [row.product_id, Number(row.milli)]));
}

interface StockChange {
  productId: string;
  /** Positivo entra, negativo sale (milésimas). */
  deltaMilli: number;
  type: "ENTRADA" | "SALIDA_PEDIDO" | "DEVOLUCION" | "AJUSTE" | "MERMA";
  unitCost?: number | null;
  supplier?: string | null;
  note?: string | null;
  orderId?: string | null;
  userId?: string | null;
}

/**
 * Aplica un cambio de existencia y deja el movimiento en el kardex, dentro de la transacción `tx`.
 * Las salidas usan una actualización condicional (`stock >= cantidad`): dos despachos al mismo tiempo
 * nunca dejan la existencia en negativo.
 */
export async function applyStockChange(tx: Prisma.TransactionClient, change: StockChange) {
  if (change.deltaMilli === 0) return null;
  if (change.deltaMilli < 0) {
    const needed = -change.deltaMilli;
    const { count } = await tx.product.updateMany({
      where: { id: change.productId, stockMilli: { gte: needed } },
      data: { stockMilli: { decrement: needed } },
    });
    if (count === 0) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: change.productId }, select: { name: true, unit: true, stockMilli: true } });
      throw conflict(
        `No hay suficiente ${product.name}: hay ${formatQty(product.stockMilli, product.unit)} y se necesitan ${formatQty(needed, product.unit)}.`,
        "INSUFFICIENT_STOCK",
      );
    }
  } else {
    await tx.product.update({ where: { id: change.productId }, data: { stockMilli: { increment: change.deltaMilli } } });
  }
  const product = await tx.product.findUniqueOrThrow({ where: { id: change.productId }, select: { stockMilli: true } });
  return tx.inventoryMovement.create({
    data: {
      productId: change.productId,
      type: change.type,
      qtyMilli: change.deltaMilli,
      stockAfterMilli: product.stockMilli,
      unitCost: change.unitCost ?? null,
      supplier: change.supplier ?? null,
      note: change.note ?? null,
      orderId: change.orderId ?? null,
      userId: change.userId ?? null,
    },
  });
}
