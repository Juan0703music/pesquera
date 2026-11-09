import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { getAuth, requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { copSchema } from "../../utils/money.js";
import { formatQty, MAX_QTY, qtySchema, toMilli } from "../../utils/quantity.js";
import { applyStockChange } from "./stock.js";

const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().max(max).optional());

/**
 * ENTRADA: llega mercancía (cantidad que entra y, si se conoce, su costo por kilo/unidad).
 * AJUSTE: conteo físico (la cantidad es lo que hay realmente en la bodega).
 * MERMA: pérdida (cantidad que se pierde y el motivo).
 */
const MovementSchema = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("ENTRADA"), productId: z.uuid(), qty: qtySchema, unitCost: copSchema.optional(), supplier: optionalText(80), note: optionalText(200) }),
    z.object({ type: z.literal("AJUSTE"), productId: z.uuid(), counted: z.number().min(0, "El conteo no puede ser negativo.").max(MAX_QTY), note: optionalText(200) }),
    z.object({ type: z.literal("MERMA"), productId: z.uuid(), qty: qtySchema, note: z.string().trim().min(3, "Escribe el motivo de la merma.").max(200) }),
  ],
  { error: "Elige el tipo de movimiento." },
);

const ListQuery = z.object({
  productId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const inventoryRoutes = Router();

inventoryRoutes.post("/movements", requirePermission("inventory.move"), validate({ body: MovementSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof MovementSchema>;
  const auth = getAuth(req);

  const movement = await prisma.$transaction(async (tx) => {
    // Bloquea el producto: el costo promedio y el conteo se calculan sobre la existencia real del momento.
    const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${input.productId}::uuid FOR UPDATE`;
    if (!locked) throw notFound("El producto no existe.");
    const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });

    if (input.type === "ENTRADA") {
      const qtyMilli = toMilli(input.qty, product.unit, product.name);
      if (input.unitCost !== undefined) {
        // Costo promedio ponderado: (existencia × costo actual + entrada × costo nuevo) / total.
        const totalMilli = product.stockMilli + qtyMilli;
        const avgCost = Math.round((product.stockMilli * product.avgCost + qtyMilli * input.unitCost) / totalMilli);
        await tx.product.update({ where: { id: product.id }, data: { avgCost } });
      }
      return applyStockChange(tx, {
        productId: product.id, deltaMilli: qtyMilli, type: "ENTRADA", unitCost: input.unitCost, supplier: input.supplier, note: input.note, userId: auth.userId,
      });
    }
    if (input.type === "AJUSTE") {
      const countedMilli = input.counted === 0 ? 0 : toMilli(input.counted, product.unit, product.name);
      const delta = countedMilli - product.stockMilli;
      if (delta === 0) throw badRequest(`La existencia de ${product.name} ya es ${formatQty(countedMilli, product.unit)}.`, "NO_CHANGE");
      return applyStockChange(tx, { productId: product.id, deltaMilli: delta, type: "AJUSTE", note: input.note ?? "Conteo físico", userId: auth.userId });
    }
    const lostMilli = toMilli(input.qty, product.unit, product.name);
    return applyStockChange(tx, { productId: product.id, deltaMilli: -lostMilli, type: "MERMA", unitCost: product.avgCost, note: input.note, userId: auth.userId });
  });

  const product = await prisma.product.findUniqueOrThrow({ where: { id: input.productId }, select: { name: true, unit: true } });
  live.emit("inventory", `inventory.${input.type.toLowerCase()}`, { product: product.name, qtyMilli: movement?.qtyMilli, unit: product.unit, by: auth.name });
  res.status(201).json({ data: movement });
});

inventoryRoutes.get("/movements", requirePermission("inventory.view"), validate({ query: ListQuery }), async (req, res) => {
  const { productId, limit } = req.query as unknown as z.infer<typeof ListQuery>;
  const movements = await prisma.inventoryMovement.findMany({
    where: productId ? { productId } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { product: { select: { name: true, unit: true } }, user: { select: { name: true } }, order: { select: { number: true } } },
  });
  res.json({ data: movements });
});
