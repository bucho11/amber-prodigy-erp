import type { Request, Router } from "express";
import { aiStatus } from "@prodigy/ai";
import { toolDefinitions, type AgentActor } from "@prodigy/agent";
import { wrap } from "./http";
import { requireAuth, userOf } from "./security";

/** Build the agent's acting identity from the authenticated user (same RBAC the UI enforces). */
function actorOf(req: Request): AgentActor {
  const u = userOf(req);
  return {
    tenantId: u.tenantId,
    userId: u.id,
    displayName: u.displayName,
    isOwner: u.role?.isOwner ?? false,
    permissions: u.permissions,
  };
}

/**
 * AI / Agentic-OS surface.
 *  - GET /ai/status — live (Claude) vs the inert simulated seam.
 *  - GET /ai/tools  — the agent tool catalog, each flagged `allowed` for the caller's permissions.
 * The LLM-driven agent loop + an approval-gated execute endpoint land in the next increment.
 */
export function registerAiRoutes(api: Router): void {
  api.get(
    "/ai/status",
    requireAuth,
    wrap(async (_req, res) => {
      res.json(aiStatus());
    })
  );

  api.get(
    "/ai/tools",
    requireAuth,
    wrap(async (req, res) => {
      res.json({ tools: toolDefinitions(actorOf(req)) });
    })
  );
}
