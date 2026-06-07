/**
 * AI provider seam (AUTONOMOUS_BUILD_FRAMEWORK.md P11 / A.4).
 *
 * The Agentic-OS layer talks to an LLM ONLY through this interface. A deterministic
 * SimulatedAiProvider backs it when no credential is present, so the whole agent system is
 * buildable and testable with no key; ClaudeAiProvider is the real implementation, selected by
 * one factory when ANTHROPIC_API_KEY is set. The LLM key is NOT a regulated rail — it can go live
 * mid-build — but money/SMS/payroll rails still go last.
 *
 * Tool-use shapes mirror the Anthropic Messages API (text / tool_use / tool_result blocks) so the
 * ClaudeAiProvider maps 1:1 and the SimulatedAiProvider can emit deterministic tool calls.
 */

export type AiProviderKind = "simulated" | "claude";

/**
 * Model tiering (AGENTIC_AI_PLAYBOOK.md step 7): the agent loop runs on frontier Opus (judgment),
 * while narrow side tasks (the LLM-judge, summarization) run on a cheaper/faster model. Haiku 4.5 is
 * ~5x cheaper than Opus and ample for rubric-grading.
 */
export const FAST_MODEL = "claude-haiku-4-5";

/** A tool the model may call (name + description + JSON Schema for the input). */
export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A tool call the model emitted. */
export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** Conversation content blocks (a superset of plain text, for tool-use turns). */
export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface AiMessage {
  role: "user" | "assistant";
  /** Plain string for simple turns, or blocks for tool-use turns. */
  content: string | AiContentBlock[];
}

export interface AiCompletionRequest {
  /** System prompt — the agent's instructions / persona. */
  system?: string;
  /** Conversation so far (must start with a user turn). */
  messages: AiMessage[];
  /** Tools the model may call this turn. */
  tools?: AiToolSpec[];
  /** Output ceiling; defaults to a sensible value per provider. */
  maxTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCompletionResult {
  text: string;
  /** Tool calls the model wants executed (empty when it answered directly). */
  toolCalls: AiToolCall[];
  provider: AiProviderKind;
  model: string;
  /** True when this came from the inert simulated seam (P10 — never mistake simulated for live). */
  simulated: boolean;
  stopReason: string | null;
  usage: AiUsage | null;
}

export interface AiProvider {
  readonly kind: AiProviderKind;
  readonly model: string;
  complete(req: AiCompletionRequest): Promise<AiCompletionResult>;
}

/** Surfaced to the app so operators can see whether AI is live or running the inert seam. */
export interface AiStatus {
  /** Is a real provider credential present? */
  configured: boolean;
  kind: AiProviderKind;
  model: string;
  /** True when the active provider is the simulated seam. */
  simulated: boolean;
}
