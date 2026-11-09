import { Router } from "express";
import { requirePermission } from "../../middlewares/authenticate.js";
import { analyticsService } from "./analytics.service.js";

export const analyticsRoutes = Router();

analyticsRoutes.get("/live", requirePermission("analytics.view"), async (_req, res) => {
  res.set("Cache-Control", "no-store").json({ data: await analyticsService.live() });
});
