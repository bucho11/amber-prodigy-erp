import type { Request, Router } from "express";
import { aiStatus, createAiProvider } from "@prodigy/ai";
import {
  toolDefinitions,
  runAgent,
  requestApproval,
  listPendingApprovals,
  listRecentDecidedApprovals,
  decideApproval,
  approvalPreview,
  type AgentActor,
} from "@prodigy/agent";

/** Attach a plain-language impact preview to each approval before sending to the client. */
function withPreview<T extends { tool: string; input: unknown }>(a: T): T & { preview: string } {
  return { ...a, preview: approvalPreview(a.tool, a.input) };
}
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
      const actor = actorOf(req);
      const run = await runAgent(createAiProvider(), actor, message);
      // Persist any proposed-but-unapproved actions so a human can decide them durably.
      if (run.status === "needs_approval") {
        const approvals = [];
        for (const p of run.pending) approvals.push(withPreview(await requestApproval(actor, p.tool, p.input)));
        res.json({ ...run, approvals });
        return;
      }
      res.json(run);
    })
  );

  // The human-in-the-loop approval queue.
  api.get(
    "/ai/approvals",
    requireAuth,
    wrap(async (req, res) => {
      res.json({ approvals: (await listPendingApprovals(actorOf(req).tenantId)).map(withPreview) });
    })
  );

  // Agent-action history: recently approved/rejected/executed actions.
  api.get(
    "/ai/approvals/history",
    requireAuth,
    wrap(async (req, res) => {
      res.json({ approvals: (await listRecentDecidedApprovals(actorOf(req).tenantId)).map(withPreview) });
    })
  );

  api.post(
    "/ai/approvals/:id/approve",
    requireAuth,
    wrap(async (req, res) => {
      const outcome = await decideApproval(actorOf(req), req.params.id, "approve");
      if (outcome.status === "not_found") {
        res.status(404).json({ error: "Approval not found." });
        return;
      }
      if (outcome.status === "denied") {
        res.status(403).json({ error: outcome.reason });
        return;
      }
      res.json(outcome);
    })
  );

  api.post(
    "/ai/approvals/:id/reject",
    requireAuth,
    wrap(async (req, res) => {
      const outcome = await decideApproval(actorOf(req), req.params.id, "reject");
      if (outcome.status === "not_found") {
        res.status(404).json({ error: "Approval not found." });
        return;
      }
      res.json(outcome);
    })
  );
}
