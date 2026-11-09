import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { live } from "../../services/live.service.js";
import { conflict } from "../../utils/errors.js";
import { copSchema } from "../../utils/money.js";
import { MAX_QTY, toMilli } from "../../utils/quantity.js";
import { committedByProduct } from "../inventory/stock.js";

const IdParams = z.object({ id: z.uuid("Identificador inválido.") });
const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(max).nullable().optional());

const CategorySchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre de la categoría.").max(40),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const ProductSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del producto.").max(80),
  categoryId: z.uuid("Elige una categoría."),
  description: optionalText(300),
  unit: z.enum(["KG", "UNIDAD"], { error: "Elige si se vende por kilo o por unidad." }),
  price: copSchema,
  /** Nivel de alerta en kilos o unidades. */
  minStock: z.number().min(0).max(MAX_QTY).default(0),
  active: z.boolean().default(true),
  inStore: z.boolean().default(true),
});
const UpdateProductSchema = ProductSchema.partial();

export const productSelect = {
  id: true,
  name: true,
  description: true,
  unit: true,
  price: true,
  avgCost: true,
  stockMilli: true,
  minStockMilli: true,
  active: true,
  inStore: true,
  category: { select: { id: true, name: true } },
} as const;

/** Productos con existencia, comprometido (pedidos abiertos), disponible y estado de alerta. */
export async function listProductsWithStock(where: { active?: boolean } = {}) {
  const [products, committed] = await Promise.all([
    prisma.product.findMany({ where, select: productSelect, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }] }),
    committedByProduct(prisma),
  ]);
  return products.map((product) => {
    const committedMilli = committed.get(product.id) ?? 0;
    const availableMilli = product.stockMilli - committedMilli;
    const level = product.stockMilli <= 0 ? "AGOTADO" : product.stockMilli <= product.minStockMilli ? "BAJO" : "OK";
    return { ...product, committedMilli, availableMilli, level, stockValue: Math.round((product.stockMilli * product.avgCost) / 1000) };
  });
}

export const catalogRoutes = Router();

catalogRoutes.get("/categories", async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });
  res.json({ data: categories.map(({ _count, ...category }) => ({ ...category, productCount: _count.products })) });
});

catalogRoutes.post("/categories", requirePermission("catalog.manage"), validate({ body: CategorySchema }), async (req, res) => {
  const input = req.body as z.infer<typeof CategorySchema>;
  if (await prisma.category.findUnique({ where: { name: input.name } })) throw conflict("Ya existe una categoría con ese nombre.");
  const category = await prisma.category.create({ data: input });
  live.emit("catalog", "category.created");
  res.status(201).json({ data: category });
});

catalogRoutes.patch("/categories/:id", requirePermission("catalog.manage"), validate({ params: IdParams, body: CategorySchema.partial() }), async (req, res) => {
  const category = await prisma.category.update({ where: { id: (req.params as z.infer<typeof IdParams>).id }, data: req.body as Partial<z.infer<typeof CategorySchema>> });
  live.emit("catalog", "category.updated");
  res.json({ data: category });
});

catalogRoutes.get("/products", requirePermission("inventory.view"), async (req, res) => {
  const includeInactive = req.query.all === "1";
  res.json({ data: await listProductsWithStock(includeInactive ? {} : { active: true }) });
});

catalogRoutes.post("/products", requirePermission("catalog.manage"), validate({ body: ProductSchema }), async (req, res) => {
  const { minStock, ...input } = req.body as z.infer<typeof ProductSchema>;
  if (await prisma.product.findUnique({ where: { name: input.name } })) throw conflict("Ya existe un producto con ese nombre.");
  const product = await prisma.product.create({
    data: { ...input, minStockMilli: minStock ? toMilli(minStock, input.unit, input.name) : 0 },
    select: productSelect,
  });
  live.emit("catalog", "product.created", { name: product.name });
  res.status(201).json({ data: product });
});

catalogRoutes.patch("/products/:id", requirePermission("catalog.manage"), validate({ params: IdParams, body: UpdateProductSchema }), async (req, res) => {
  const { id } = req.params as z.infer<typeof IdParams>;
  const { minStock, ...input } = req.body as z.infer<typeof UpdateProductSchema>;
  const current = await prisma.product.findUniqueOrThrow({ where: { id } });
  const unit = input.unit ?? current.unit;
  // Cambiar kilo ↔ unidad con existencias haría que las cantidades guardadas significaran otra cosa.
  if (input.unit && input.unit !== current.unit && current.stockMilli > 0) {
    throw conflict("No puedes cambiar la unidad de venta de un producto con existencias. Deja la existencia en cero primero.", "UNIT_LOCKED");
  }
  const product = await prisma.product.update({
    where: { id },
    data: { ...input, ...(minStock !== undefined ? { minStockMilli: minStock ? toMilli(minStock, unit, current.name) : 0 } : {}) },
    select: productSelect,
  });
  live.emit("catalog", "product.updated", { name: product.name });
  res.json({ data: product });
});
