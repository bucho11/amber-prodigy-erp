/**
 * AI provider seam suite — proves the inert path is correct and deterministic (P11/A.4), so the
 * whole Agentic-OS layer is buildable and testable with no ANTHROPIC_API_KEY.
 */
import { assert, assertEqual, TestRunner } from "../harness";
import {
  createAiProvider,
  aiStatus,
  isAiConfigured,
  SimulatedAiProvider,
  ClaudeAiProvider,
  CLAUDE_MODEL,
} from "@prodigy/ai";

export async function run(_db: unknown, t: TestRunner): Promise<void> {
  t.suite("AI provider seam — simulated default, deterministic, factory selection");

  await t.test("factory returns the simulated provider when no key is given", () => {
    const p = createAiProvider({ apiKey: "" });
    assert(p instanceof SimulatedAiProvider, "no key → SimulatedAiProvider");
    assertEqual(p.kind, "simulated", "kind is simulated");
  });

  await t.test("factory returns the Claude provider when a key IS given (not invoked live)", () => {
    const p = createAiProvider({ apiKey: "sk-test-not-real" });
    assert(p instanceof ClaudeAiProvider, "key → ClaudeAiProvider");
    assertEqual(p.kind, "claude", "kind is claude");
    assertEqual(p.model, CLAUDE_MODEL, "model is the latest Claude");
  });

  await t.test("simulated completion is labelled [SIMULATED] and flagged simulated (P10)", async () => {
    const p = createAiProvider({ apiKey: "" });
    const out = await p.complete({ messages: [{ role: "user", content: "Summarize today's bookings." }] });
    assert(out.simulated === true, "result flagged simulated");
    assert(out.text.includes("[SIMULATED"), "output is unmistakably labelled simulated");
    assertEqual(out.provider, "simulated", "provider is simulated");
  });

  await t.test("simulated completion is deterministic for the same input", async () => {
    const p = createAiProvider({ apiKey: "" });
    const req = { system: "You are a helpful assistant.", messages: [{ role: "user" as const, content: "Hi there" }] };
    const a = await p.complete(req);
    const b = await p.complete(req);
    assertEqual(a.text, b.text, "identical input → identical output");
    assertEqual(a.usage?.inputTokens, b.usage?.inputTokens, "deterministic usage estimate");
  });

  await t.test("aiStatus reflects no-key (simulated) state", () => {
    const had = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assertEqual(isAiConfigured(), false, "not configured without a key");
      const s = aiStatus();
      assertEqual(s.simulated, true, "status reports simulated");
      assertEqual(s.kind, "simulated", "status kind simulated");
      assertEqual(s.configured, false, "status not configured");
    } finally {
      if (had !== undefined) process.env.ANTHROPIC_API_KEY = had;
    }
  });
}
