import type { AiProvider, AiMessage, AiContentBlock, AiToolSpec } from "@prodigy/ai";
import type { AgentActor } from "./types";
import { allTools, actorCan, getTool } from "./tools";
import { executeTool } from "./execute";

/** One tool invocation the agent made (or attempted) during a run. */
export interface AgentStep {
  tool: string;
  status: "ok" | "denied" | "requires_approval" | "error";
  reason?: string;
}

export type AgentRun =
  | { status: "completed"; answer: string; steps: AgentStep[] }
  | { status: "needs_approval"; answer: string; pending: { tool: string; input: unknown }[]; steps: AgentStep[] }
  | { status: "max_steps"; answer: string; steps: AgentStep[] };

export interface RunAgentOptions {
  /** Hard iteration cap — the single most important safety control (default 8). */
  maxSteps?: number;
  /** Auto-approve "approval"-risk tools. Only a HUMAN should set this — never the model. Default false. */
  autoApprove?: boolean;
}

const SYSTEM_PROMPT = [
  "You are Prodigy, the operations assistant for a wellness/bodywork business (scheduling, clients,",
  "clinical charting, point-of-sale, and the books). You help the owner and staff get things done.",
  "",
  "How to work:",
  "- Use the provided tools to look things up and to take actions; don't answer from memory when a",
  "  tool can give the real, current data. Never invent numbers, names, IDs, or outcomes.",
  "- Prefer ONE well-chosen tool per step. Read the tool result before deciding the next step.",
  "- Write/financial/clinical tools require human approval: they will PAUSE for sign-off before running.",
  "  Propose them when appropriate, state plainly that they need approval, and never claim they ran.",
  "- If you lack an id or detail a tool needs, ask the user for it or look it up first — don't guess.",
  "- When you have enough to answer, reply concisely in plain language, with the actual figures.",
  "- Money is in US dollars; be precise. Respect that you act only within the user's permissions.",
].join("\n");

/** Deterministic signature of a tool call, to detect the model looping on the same action. */
function callSignature(name: string, input: unknown): string {
  return `${name}:${JSON.stringify(input)}`;
}

/**
 * The agent loop (manual tool-use loop per the Claude API guidance). Defense-in-depth termination
 * (per agent-loop research): (1) hard step cap with an early-stopping synthesis turn so the user
 * always gets an answer; (2) a repeat-call detector so the model can't spin on one tool;
 * (3) natural completion when the model stops calling tools. Approval-risk tools are NOT executed —
 * the loop stops and surfaces them for human sign-off (pre-execution approval).
 *
 * Only tools the actor is permitted to use are offered to the model (defense in depth — executeTool
 * still RBAC-checks every call).
 */
export async function runAgent(
  provider: AiProvider,
  actor: AgentActor,
  userMessage: string,
  opts: RunAgentOptions = {}
): Promise<AgentRun> {
  const maxSteps = Math.max(1, Math.min(opts.maxSteps ?? 8, 25));
  const tools: AiToolSpec[] = allTools()
    .filter((t) => actorCan(actor, t.permission))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

  const messages: AiMessage[] = [{ role: "user", content: userMessage }];
  const steps: AgentStep[] = [];
  const seenCalls = new Set<string>();

  for (let i = 0; i < maxSteps; i++) {
    const res = await provider.complete({ system: SYSTEM_PROMPT, messages, tools });

    // Record the assistant turn (text + any tool calls) so the model sees its own history.
    const assistantBlocks: AiContentBlock[] = [];
    if (res.text) assistantBlocks.push({ type: "text", text: res.text });
    for (const tc of res.toolCalls) assistantBlocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    messages.push({ role: "assistant", content: assistantBlocks.length > 0 ? assistantBlocks : res.text });

    if (res.toolCalls.length === 0) {
      return { status: "completed", answer: res.text, steps };
    }

    const resultBlocks: AiContentBlock[] = [];
    const pending: { tool: string; input: unknown }[] = [];

    for (const tc of res.toolCalls) {
      const sig = callSignature(tc.name, tc.input);
      if (seenCalls.has(sig)) {
        // Repetition guard: feed back a note instead of re-running the identical call.
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: "Already called with these arguments; use the prior result.", isError: true });
        continue;
      }
      seenCalls.add(sig);

      const exec = await executeTool(actor, tc.name, tc.input, { approved: opts.autoApprove });
      steps.push({ tool: tc.name, status: exec.status, reason: "reason" in exec ? exec.reason : undefined });

      if (exec.status === "requires_approval") {
        pending.push({ tool: tc.name, input: exec.input });
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: "PAUSED — awaiting human approval.", isError: false });
      } else if (exec.status === "ok") {
        // Prefer a concise, human-readable summary (token-efficient context); fall back to truncated JSON.
        const summarizer = getTool(tc.name)?.summarize;
        const content = summarizer ? summarizer(exec.result) : JSON.stringify(exec.result).slice(0, 6000);
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content });
      } else {
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: `Error: ${exec.reason}`, isError: true });
      }
    }

    // Any approval-gated call stops the loop for human sign-off (no side effect ran).
    if (pending.length > 0) {
      return { status: "needs_approval", answer: res.text, pending, steps };
    }

    messages.push({ role: "user", content: resultBlocks });
  }

  // Hit the cap — early-stopping synthesis: one more turn with NO tools so the user gets an answer.
  const finalMsgs: AiMessage[] = [
    ...messages,
    { role: "user", content: "You've reached the step limit. Summarize what you found and answer now, without calling any more tools." },
  ];
  const synth = await provider.complete({ system: SYSTEM_PROMPT, messages: finalMsgs });
  return { status: "max_steps", answer: synth.text, steps };
}
