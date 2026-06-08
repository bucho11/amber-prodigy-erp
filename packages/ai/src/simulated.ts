import type { AiProvider, AiCompletionRequest, AiCompletionResult, AiContentBlock, AiToolCall, AiToolSpec } from "./provider";
import { CLAUDE_MODEL } from "./claude";

// Generic function words that shouldn't drive tool selection.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "what", "whats", "how", "much", "many", "this", "that", "please", "you",
  "our", "are", "was", "were", "have", "has", "into", "from", "about", "want", "need", "can", "could",
  "would", "should", "tell", "give", "any", "all", "out", "now", "today", "month", "week", "year", "their",
]);

/**
 * Heuristic intent → tool router for the simulated provider: score the prompt's distinctive words
 * against each offered tool's NAME tokens, pick the best. This makes the keyless assistant actually
 * route to tools (a better demo) AND gives the eval harness a deterministic stand-in for the model's
 * tool-selection — which doubles as a check that tool names are discriminative (Anthropic's guidance).
 */
function heuristicPick(text: string, tools: AiToolSpec[]): AiToolCall | null {
  const words = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  let best: AiToolSpec | null = null;
  let bestScore = 0;
  for (const t of tools) {
    const kws = t.name.toLowerCase().split(/[_\s]+/).filter((w) => w.length >= 3);
    let score = 0;
    for (const w of words) {
      // Exact token match is a stronger signal than a substring match, so weight it higher —
      // otherwise "waitlist" fuzzy-matches "list" and ties every list_* tool (first one wins).
      let matched = 0;
      for (const k of kws) {
        if (w === k) {
          matched = 2;
          break;
        }
        if (w.length >= 4 && k.length >= 4 && (w.includes(k) || k.includes(w))) matched = Math.max(matched, 1);
      }
      score += matched;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best && bestScore >= 1 ? { id: `sim_${best.name}_${text.length}`, name: best.name, input: {} } : null;
}

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

    // 2) Choose a tool: an explicit `call:<tool>` directive wins; otherwise route by heuristic intent.
    if (offered.size > 0 && last && last.role === "user") {
      const promptText = textOf(last.content);
      const directive = parseDirective(promptText, offered);
      if (directive) return this.result("", [directive], req);
      const picked = heuristicPick(promptText, req.tools ?? []);
      if (picked) return this.result("", [picked], req);
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
