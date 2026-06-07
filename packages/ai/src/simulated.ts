import type { AiProvider, AiCompletionRequest, AiCompletionResult } from "./provider";
import { CLAUDE_MODEL } from "./claude";

/** Stable id for the inert provider — surfaced in results so it's auditable. */
export const SIMULATED_MODEL = "simulated-deterministic-v1";

/**
 * Deterministic, dependency-free provider used when no ANTHROPIC_API_KEY is set (P11/A.4).
 * Its output is clearly prefixed [SIMULATED] so a simulated path is never mistaken for a live
 * one (P10). Deterministic by construction so tests are stable and reproducible.
 */
export class SimulatedAiProvider implements AiProvider {
  readonly kind = "simulated" as const;
  readonly model = SIMULATED_MODEL;

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt = (lastUser?.content ?? "").trim();
    const preview = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;

    const text =
      `[SIMULATED AI — no ANTHROPIC_API_KEY set] ` +
      `Deterministic placeholder response. ` +
      (prompt ? `Received a ${prompt.length}-char prompt: "${preview}". ` : `No user prompt provided. `) +
      `Set ANTHROPIC_API_KEY to run live Claude (${CLAUDE_MODEL}).`;

    const inputChars = (req.system?.length ?? 0) + req.messages.reduce((sum, m) => sum + m.content.length, 0);
    return {
      text,
      provider: "simulated",
      model: SIMULATED_MODEL,
      simulated: true,
      stopReason: "end_turn",
      // Deterministic ~chars/4 estimate so usage is present but obviously not a billed figure.
      usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(text.length / 4) },
    };
  }
}
