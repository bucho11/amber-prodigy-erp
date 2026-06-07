/**
 * AI provider seam (AUTONOMOUS_BUILD_FRAMEWORK.md P11 / A.4).
 *
 * The Agentic-OS layer talks to an LLM ONLY through this interface. A deterministic
 * SimulatedAiProvider backs it when no credential is present, so the whole agent system is
 * buildable and testable with no key; ClaudeAiProvider is the real implementation, selected by
 * one factory when ANTHROPIC_API_KEY is set. The LLM key is NOT a regulated rail — it can go live
 * mid-build — but money/SMS/payroll rails still go last.
 */

export type AiProviderKind = "simulated" | "claude";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCompletionRequest {
  /** System prompt — the agent's instructions / persona. */
  system?: string;
  /** Conversation so far (must start with a user turn, alternating). */
  messages: AiMessage[];
  /** Output ceiling; defaults to a sensible value per provider. */
  maxTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCompletionResult {
  text: string;
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
