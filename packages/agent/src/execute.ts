import { recordAudit } from "@prodigy/db";
import type { AuditAction } from "@prodigy/contracts";
import type { AgentActor, ToolExecution } from "./types";
import { getTool, actorCan } from "./tools";

export interface ExecuteOpts {
  /** Set true only after a human has approved an "approval"-risk tool call. */
  approved?: boolean;
}

/** Best-effort tamper-evident audit of every agent tool attempt (reuses the existing hash chain). */
async function audit(actor: AgentActor, action: AuditAction, detail: string): Promise<void> {
  try {
    await recordAudit(
      actor.tenantId,
      { id: actor.userId, displayName: actor.displayName },
      { action, resourceType: "agent_tool", detail }
    );
  } catch (err) {
    // Never let an audit hiccup block (or unblock) an action.
    console.error("[agent] audit write failed:", err);
  }
}

/**
 * The single choke point for agent actions. Order matters and is security-load-bearing:
 *   1. tool must exist
 *   2. RBAC — actor must hold the tool's permission (owner ⇒ all). Server-side (P9), same keys as humans.
 *   3. validate input (throws → error, no side effect)
 *   4. PRE-EXECUTION approval gate — "approval" tools return requires_approval and DO NOT run
 *   5. execute via the existing db module, then audit the outcome
 * Every branch is audited so the agent's activity is fully reconstructable + tamper-evident.
 */
export async function executeTool(
  actor: AgentActor,
  name: string,
  rawInput: unknown,
  opts: ExecuteOpts = {}
): Promise<ToolExecution> {
  const tool = getTool(name);
  if (!tool) return { status: "error", tool: name, reason: `Unknown tool '${name}'.` };

  if (!actorCan(actor, tool.permission)) {
    await audit(actor, "view", `DENIED ${name} — missing '${tool.permission}'`);
    return { status: "denied", tool: name, reason: `You don't have permission ('${tool.permission}') to do that.` };
  }

  let input: unknown;
  try {
    input = tool.parse(rawInput);
  } catch (err) {
    return { status: "error", tool: name, reason: (err as Error).message };
  }

  if (tool.risk === "approval" && !opts.approved) {
    await audit(actor, "view", `PENDING APPROVAL ${name} ${JSON.stringify(input)}`);
    return { status: "requires_approval", tool: name, input };
  }

  try {
    const result = await tool.handler({ actor }, input);
    await audit(actor, tool.risk === "auto" ? "view" : "create", `EXECUTED ${name} ${JSON.stringify(input)}`);
    return { status: "ok", tool: name, result };
  } catch (err) {
    await audit(actor, "view", `ERROR ${name}: ${(err as Error).message}`);
    return { status: "error", tool: name, reason: (err as Error).message };
  }
}
