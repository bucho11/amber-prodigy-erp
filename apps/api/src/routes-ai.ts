import type { Router } from "express";
import { aiStatus } from "@prodigy/ai";
import { wrap } from "./http";
import { requireAuth } from "./security";

/**
 * AI surface. For now: a status endpoint so the app can show whether the Agentic-OS layer is
 * running live (Claude) or on the inert simulated seam. The agent runtime + tool registry land
 * in subsequent increments and register here.
 */
export function registerAiRoutes(api: Router): void {
  api.get(
    "/ai/status",
    requireAuth,
    wrap(async (_req, res) => {
      res.json(aiStatus());
    })
  );
}
