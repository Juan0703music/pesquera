import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import { salesService, todayIn } from "./sales.service.js";

const DayQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha AAAA-MM-DD.")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Fecha inválida.")
    .optional(),
});

export const salesRoutes = Router();

salesRoutes.get("/day", requirePermission("sales.view"), validate({ query: DayQuery }), async (req, res) => {
  const { date } = req.query as z.infer<typeof DayQuery>;
  res.json({ data: await salesService.day(date ?? todayIn()) });
});
