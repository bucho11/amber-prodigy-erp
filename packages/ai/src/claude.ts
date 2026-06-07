import type {
  AiProvider,
  AiCompletionRequest,
  AiCompletionResult,
  AiContentBlock,
  AiToolCall,
  AiMessage,
} from "./provider";

/** Default model — the latest, most capable Claude. Adaptive thinking, per the Claude API guidance. */
export const CLAUDE_MODEL = "claude-opus-4-8";

/** Map our content blocks to the Anthropic Messages API shape. */
function toSdkContent(content: string | AiContentBlock[]): unknown {
  if (typeof content === "string") return content;
  return content.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError ?? false };
  });
}

/**
 * Live provider backed by Claude (Anthropic). The SDK is lazy-imported inside complete() so it is
 * never loaded in simulated mode (P11). Selected by the factory only when ANTHROPIC_API_KEY is set.
 */
export class ClaudeAiProvider implements AiProvider {
  readonly kind = "claude" as const;
  readonly model = CLAUDE_MODEL;

  constructor(private readonly apiKey: string) {}

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    // Lazy import: with no key the factory never constructs this class, so the SDK never loads.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const params: Record<string, unknown> = {
      model: CLAUDE_MODEL,
      max_tokens: req.maxTokens ?? 16000,
      messages: req.messages.map((m: AiMessage) => ({ role: m.role, content: toSdkContent(m.content) })),
      // Adaptive thinking + high effort is the recommended setting for agentic/tool-use work (Claude
      // API guidance). Let Claude decide how much to reason per step; no fixed token budget.
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    };
    if (req.system) params.system = req.system;
    if (req.tools && req.tools.length > 0) {
      params.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    }

    // Cast at the SDK boundary to exactly the fields we read (non-streaming Message). Our params are
    // a structurally-correct subset of MessageCreateParams; this path only runs live (with a key).
    interface ClaudeBlock { type: string; text?: string; id?: string; name?: string; input?: unknown }
    interface ClaudeMessage {
      content: ClaudeBlock[];
      stop_reason: string | null;
      usage: { input_tokens: number; output_tokens: number };
    }
    const message = (await client.messages.create(
      params as unknown as Parameters<typeof client.messages.create>[0]
    )) as unknown as ClaudeMessage;

    const text = message.content.map((block) => (block.type === "text" ? block.text ?? "" : "")).join("");
    const toolCalls: AiToolCall[] = message.content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id ?? "", name: block.name ?? "", input: block.input ?? {} }));

    return {
      text,
      toolCalls,
      provider: "claude",
      model: CLAUDE_MODEL,
      simulated: false,
      stopReason: message.stop_reason ?? null,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}
