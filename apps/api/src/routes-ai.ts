import type { Request, Router } from "express";
import { aiStatus, createAiProvider } from "@prodigy/ai";
import { toolDefinitions, runAgent, type AgentActor } from "@prodigy/agent";
import { reqString, wrap } from "./http";
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

  // Run the agent for one user message. Read tools auto-run (RBAC-gated); write tools pause for
  // approval (status "needs_approval") — this endpoint never auto-approves. With no key the inert
  // simulated provider answers, so the surface works end-to-end before any credential.
  api.post(
    "/ai/agent",
    requireAuth,
    wrap(async (req, res) => {
      const message = reqString(req.body?.message, "message");
      const run = await runAgent(createAiProvider(), actorOf(req), message);
      res.json(run);
    })
  );
}
