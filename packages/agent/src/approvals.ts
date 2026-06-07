import {
  createAgentApproval,
  listAgentApprovals,
  getAgentApproval,
  decideAgentApproval,
  type AgentApproval,
} from "@prodigy/db";
import type { AgentActor, ToolExecution } from "./types";
import { getTool, actorCan } from "./tools";
import { executeTool } from "./execute";

/** Persist an agent-proposed action for human sign-off (the durable side of the approval gate). */
export async function requestApproval(actor: AgentActor, tool: string, input: unknown): Promise<AgentApproval> {
  return createAgentApproval(actor.tenantId, {
    requestedBy: actor.userId,
    actorName: actor.displayName,
    tool,
    input,
  });
}

export async function listPendingApprovals(tenantId: string): Promise<AgentApproval[]> {
  return listAgentApprovals(tenantId, { status: "pending" });
}

export type ApprovalOutcome =
  | { status: "executed"; approval: AgentApproval; execution: ToolExecution }
  | { status: "failed"; approval: AgentApproval; execution: ToolExecution }
  | { status: "rejected"; approval: AgentApproval }
  | { status: "denied"; reason: string }
  | { status: "not_found" }
  | { status: "already_decided"; approval: AgentApproval };

/**
 * A human decides a pending approval. On approve, the action runs under the APPROVER's authority —
 * they must hold the tool's permission (RBAC), and execution goes through the same `executeTool`
 * choke point (so it's validated, executed via the real db path, and audited). The DB transition is
 * pending-guarded, so an approval can never double-execute.
 */
export async function decideApproval(
  approver: AgentActor,
  approvalId: string,
  decision: "approve" | "reject"
): Promise<ApprovalOutcome> {
  const approval = await getAgentApproval(approver.tenantId, approvalId);
  if (!approval) return { status: "not_found" };
  if (approval.status !== "pending") return { status: "already_decided", approval };

  if (decision === "reject") {
    const updated = await decideAgentApproval(approver.tenantId, approvalId, {
      status: "rejected",
      decidedBy: approver.userId,
      result: null,
    });
    return { status: "rejected", approval: updated ?? approval };
  }

  // Approve: the approver must themselves hold the permission (don't change state if not).
  const tool = getTool(approval.tool);
  if (!tool) {
    const failed = await decideAgentApproval(approver.tenantId, approvalId, {
      status: "failed",
      decidedBy: approver.userId,
      result: { error: `Unknown tool '${approval.tool}'.` },
    });
    return { status: "failed", approval: failed ?? approval, execution: { status: "error", tool: approval.tool, reason: "Unknown tool." } };
  }
  if (!actorCan(approver, tool.permission)) {
    return { status: "denied", reason: `You need '${tool.permission}' to approve this.` };
  }

  const execution = await executeTool(approver, approval.tool, approval.input, { approved: true });
  const newStatus = execution.status === "ok" ? "executed" : "failed";
  const updated = await decideAgentApproval(approver.tenantId, approvalId, {
    status: newStatus,
    decidedBy: approver.userId,
    result: execution,
  });
  return newStatus === "executed"
    ? { status: "executed", approval: updated ?? approval, execution }
    : { status: "failed", approval: updated ?? approval, execution };
}
