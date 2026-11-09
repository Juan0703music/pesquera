import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";

const SearchQuery = z.object({ q: z.string().trim().max(60).default("") });

export const customersRoutes = Router();

/** Búsqueda por nombre o celular para el formulario de pedidos (autocompletar). */
customersRoutes.get("/", requirePermission("orders.create"), validate({ query: SearchQuery }), async (req, res) => {
  const { q } = req.query as unknown as z.infer<typeof SearchQuery>;
  const digits = q.replace(/\D/g, "");
  const customers = await prisma.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }
      : {},
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: { _count: { select: { orders: true } } },
  });
  res.json({ data: customers.map(({ _count, ...customer }) => ({ ...customer, orderCount: _count.orders })) });
});
