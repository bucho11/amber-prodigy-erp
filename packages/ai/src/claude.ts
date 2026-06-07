import type { AiProvider, AiCompletionRequest, AiCompletionResult } from "./provider";

/** Default model — the latest, most capable Claude. Adaptive thinking, per the Claude API guidance. */
export const CLAUDE_MODEL = "claude-opus-4-8";

/**
 * Live provider backed by Claude (Anthropic). The SDK is lazy-imported inside complete() so it is
 * never loaded in simulated mode (P11 — the seam stays inert with no key). Selected by the factory
 * only when ANTHROPIC_API_KEY is present.
 */
export class ClaudeAiProvider implements AiProvider {
  readonly kind = "claude" as const;
  readonly model = CLAUDE_MODEL;

  constructor(private readonly apiKey: string) {}

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    // Lazy import: with no key the factory never constructs this class, so the SDK never loads.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: req.maxTokens ?? 16000,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    return {
      text,
      provider: "claude",
      model: CLAUDE_MODEL,
      simulated: false,
      stopReason: message.stop_reason ?? null,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}
