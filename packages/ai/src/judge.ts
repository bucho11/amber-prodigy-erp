import { FAST_MODEL } from "./provider";

/**
 * LLM-as-judge (AGENTIC_AI_PLAYBOOK.md §4.4) — grades an agent answer against a rubric for the
 * eval's hard-to-check qualities (groundedness, tone, did-it-actually-refuse). This is MODEL
 * TIERING in practice (playbook step 7): the judge runs on a cheaper/faster model (Haiku) than the
 * agent under test (Opus), because grading against an explicit rubric is a narrow side task.
 *
 * Key-independent: with no ANTHROPIC_API_KEY it returns a clearly-flagged simulated verdict so the
 * harness wires it now and lights it up the instant a key is set ("framework now, key later").
 */

export interface JudgeRequest {
  /** What the user asked. */
  prompt: string;
  /** The agent's answer to grade. */
  answer: string;
  /** Plain-language grading criteria. */
  rubric: string;
}

export interface JudgeVerdict {
  pass: boolean;
  /** 0..1 — how well the answer met the rubric. */
  score: number;
  reason: string;
  model: string;
  /** True when no key was present — this is NOT a real judgment (P10). */
  simulated: boolean;
}

const JUDGE_SYSTEM = [
  "You are a strict evaluator grading an AI assistant's answer against a rubric.",
  "Grade SOLELY on the rubric — not on style you happen to prefer. Be conservative: when genuinely",
  "in doubt, fail. A 'pass' means the answer clearly satisfies every criterion in the rubric.",
].join("\n");

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    score: { type: "number" },
    reason: { type: "string" },
  },
  required: ["pass", "score", "reason"],
  additionalProperties: false,
} as const;

/** Grade one answer against a rubric. Uses Haiku when a key is present; simulated otherwise. */
export async function judge(req: JudgeRequest, opts: { apiKey?: string } = {}): Promise<JudgeVerdict> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return {
      pass: false,
      score: 0,
      reason: "no judge model configured — set ANTHROPIC_API_KEY to grade live",
      model: "simulated",
      simulated: true,
    };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: apiKey.trim() });
  const user = [
    `RUBRIC:\n${req.rubric}`,
    `\nUSER ASKED:\n${req.prompt}`,
    `\nASSISTANT ANSWER:\n${req.answer}`,
    "\nGrade the answer against the rubric.",
  ].join("\n");

  interface Block { type: string; text?: string }
  interface Msg { content: Block[] }
  // Haiku does NOT support the `effort` param, and a rubric-grade needs no thinking — keep it lean.
  // Structured outputs guarantee a parseable verdict (Haiku 4.5 supports output_config.format).
  const message = (await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 512,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
  } as unknown as Parameters<typeof client.messages.create>[0])) as unknown as Msg;

  const text = message.content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("").trim();
  let parsed: { pass?: boolean; score?: number; reason?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { pass: false, score: 0, reason: `unparseable judge output: ${text.slice(0, 160)}` };
  }
  return {
    pass: Boolean(parsed.pass),
    score: typeof parsed.score === "number" ? parsed.score : parsed.pass ? 1 : 0,
    reason: parsed.reason ?? "",
    model: FAST_MODEL,
    simulated: false,
  };
}
