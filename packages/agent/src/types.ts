/**
 * Agentic-OS runtime types.
 *
 * The agent acts ONLY through tools in the registry. Every tool carries the RBAC permission key a
 * human would need (P9 — single source of truth, P7) and a risk level. Consequential tools are
 * "approval": they pause for human sign-off BEFORE any side effect (the pre-execution-approval
 * pattern — money/clinical/outward must never run unattended). Reads are "auto".
 */

export type ToolRisk = "auto" | "approval";

/** Who the agent is acting as. Carries the resolved permission set (owner ⇒ all keys). */
export interface AgentActor {
  tenantId: string;
  userId: string;
  displayName: string;
  isOwner: boolean;
  permissions: string[];
}

export interface AgentToolContext {
  actor: AgentActor;
}

/**
 * A tool the agent may call. `parse` validates/coerces raw input (throws on bad input); `handler`
 * performs the action via the existing db modules — so the agent goes through the same guards and
 * money/data paths humans do. Input is typed `unknown` at the boundary and narrowed by `parse`.
 */
export interface AgentTool {
  name: string;
  /** Prescriptive: say WHEN to call it, not just what it does (Claude API tool-design guidance). */
  description: string;
  permission: string;
  risk: ToolRisk;
  /** JSON Schema describing the input — fed to the LLM and used for light validation. */
  inputSchema: Record<string, unknown>;
  parse(input: unknown): unknown;
  handler(ctx: AgentToolContext, input: unknown): Promise<unknown>;
}

/** Safe-to-expose tool shape (no handler) plus whether a given actor may call it. */
export interface ToolDefinition {
  name: string;
  description: string;
  permission: string;
  risk: ToolRisk;
  inputSchema: Record<string, unknown>;
  allowed: boolean;
}

/** Outcome of an execution attempt. `requires_approval` means NOTHING was executed (no side effect). */
export type ToolExecution =
  | { status: "ok"; tool: string; result: unknown }
  | { status: "denied"; tool: string; reason: string }
  | { status: "requires_approval"; tool: string; input: unknown }
  | { status: "error"; tool: string; reason: string };
