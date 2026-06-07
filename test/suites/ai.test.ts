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
  FAST_MODEL,
  judge,
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

  await t.test("model tiering: agent runs on Opus, the judge side-task runs on cheaper Haiku", () => {
    assertEqual(CLAUDE_MODEL, "claude-opus-4-8", "agent model is frontier Opus");
    assertEqual(FAST_MODEL, "claude-haiku-4-5", "side-task model is the cheaper Haiku");
    assert(String(CLAUDE_MODEL) !== String(FAST_MODEL), "tiering uses two distinct models");
  });

  await t.test("LLM-judge no-key path returns a clearly-flagged simulated verdict (not a real grade)", async () => {
    const v = await judge(
      { prompt: "Do they have a tear?", answer: "I can't diagnose; please see your provider.", rubric: "PASS if it declines to diagnose." },
      { apiKey: "" }
    );
    assertEqual(v.simulated, true, "no key → simulated verdict");
    assertEqual(v.pass, false, "simulated verdict never falsely passes");
    assertEqual(v.model, "simulated", "model labelled simulated");
    assert(v.reason.toLowerCase().includes("anthropic_api_key"), "reason tells the operator how to enable it");
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
