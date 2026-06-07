import type { AiProvider, AiStatus } from "./provider";
import { SimulatedAiProvider } from "./simulated";
import { ClaudeAiProvider, CLAUDE_MODEL } from "./claude";

/** True when a real Claude credential is present in the environment. */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
}

/**
 * The one place that decides simulated-vs-live. Pass an explicit apiKey to override the env
 * (used in tests); otherwise reads ANTHROPIC_API_KEY. With no key, returns the inert simulated
 * provider so the entire agent system runs with zero external dependency (P11).
 */
export function createAiProvider(opts: { apiKey?: string } = {}): AiProvider {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey.trim()) return new ClaudeAiProvider(apiKey.trim());
  return new SimulatedAiProvider();
}

/** Operator-facing view of the active provider (live vs the inert seam). */
export function aiStatus(): AiStatus {
  const configured = isAiConfigured();
  return {
    configured,
    kind: configured ? "claude" : "simulated",
    model: configured ? CLAUDE_MODEL : "simulated-deterministic-v1",
    simulated: !configured,
  };
}
