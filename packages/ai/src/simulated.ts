import type { AiProvider, AiCompletionRequest, AiCompletionResult, AiContentBlock, AiToolCall } from "./provider";
import { CLAUDE_MODEL } from "./claude";

/** Stable id for the inert provider — surfaced in results so it's auditable. */
export const SIMULATED_MODEL = "simulated-deterministic-v1";

/** Flatten message content to a string for inspection. */
function textOf(content: string | AiContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content : ""))
    .join(" ");
}

/**
 * Deterministic tool-call directive for tests/demos: a user message containing
 *   call:<tool_name> {optional json input}
 * makes the simulated model emit exactly that tool call (if the tool was offered). This lets the
 * whole agent loop be exercised with no key. Without a directive it answers in text.
 */
function parseDirective(text: string, offered: Set<string>): AiToolCall | null {
  const m = text.match(/call:([a-z0-9_]+)\s*(\{[\s\S]*\})?/i);
  if (!m) return null;
  const name = m[1];
  if (!offered.has(name)) return null;
  let input: unknown = {};
  if (m[2]) {
    try {
      input = JSON.parse(m[2]);
    } catch {
      input = {};
    }
  }
  return { id: `sim_${name}_${text.length}`, name, input };
}

/**
 * Deterministic, dependency-free provider used when no ANTHROPIC_API_KEY is set (P11/A.4).
 * Output is clearly prefixed [SIMULATED] so a simulated path is never mistaken for a live one (P10).
 */
export class SimulatedAiProvider implements AiProvider {
  readonly kind = "simulated" as const;
  readonly model = SIMULATED_MODEL;

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const last = req.messages[req.messages.length - 1];
    const offered = new Set((req.tools ?? []).map((t) => t.name));
    const lastIsToolResult = last && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");

    // 1) If we just got tool results, synthesize a final (text) answer — ends the loop.
    if (lastIsToolResult) {
      const results = (last.content as AiContentBlock[])
        .filter((b): b is Extract<AiContentBlock, { type: "tool_result" }> => b.type === "tool_result")
        .map((b) => (b.isError ? `error(${b.content})` : b.content))
        .join("; ");
      return this.result(
        `[SIMULATED AI] Based on the tool result(s): ${results.slice(0, 300)}`,
        [],
        req
      );
    }

    // 2) If a directive names an offered tool, emit that tool call.
    if (offered.size > 0 && last && last.role === "user") {
      const directive = parseDirective(textOf(last.content), offered);
      if (directive) {
        return this.result("", [directive], req);
      }
    }

    // 3) Otherwise answer in text.
    const prompt = last ? textOf(last.content).trim() : "";
    const preview = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
    const text =
      `[SIMULATED AI — no ANTHROPIC_API_KEY set] Deterministic placeholder. ` +
      (prompt ? `Prompt: "${preview}". ` : `No prompt. `) +
      `Set ANTHROPIC_API_KEY to run live Claude (${CLAUDE_MODEL}).`;
    return this.result(text, [], req);
  }

  private result(text: string, toolCalls: AiToolCall[], req: AiCompletionRequest): AiCompletionResult {
    const inputChars =
      (req.system?.length ?? 0) +
      req.messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
    return {
      text,
      toolCalls,
      provider: "simulated",
      model: SIMULATED_MODEL,
      simulated: true,
      stopReason: toolCalls.length ? "tool_use" : "end_turn",
      usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil((text.length || 16) / 4) },
    };
  }
}
