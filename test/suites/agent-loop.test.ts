/**
 * Agent loop (orchestrator) suite — drives the full tool-use loop deterministically via the
 * SimulatedAiProvider (no key, P11). Verifies: read tools auto-run and the loop synthesizes a final
 * answer; approval tools STOP the loop for human sign-off with no side effect; auto-approve runs the
 * write; permission filtering keeps disallowed tools off the model's menu; the step cap terminates.
 */
import { assert, assertEqual, TestRunner } from "../harness";
import { runAgent, AGENT_CONSTITUTION, type AgentActor } from "@prodigy/agent";
import { createAiProvider } from "@prodigy/ai";

type Db = typeof import("@prodigy/db");

export async function run(db: Db, t: TestRunner): Promise<void> {
  t.suite("Agent loop — tool-use orchestration, approval gating, guardrails");

  const tenant = await db.getTenantBySlug("prodigy");
  assert(tenant, "tenant #1 seeded");
  const tenantId = tenant.id;
  const provider = createAiProvider({ apiKey: "" }); // simulated

  const owner: AgentActor = { tenantId, userId: "1", displayName: "Owner Bot", isOwner: true, permissions: [] };
  const frontDesk: AgentActor = {
    tenantId,
    userId: "2",
    displayName: "Front Desk Bot",
    isOwner: false,
    permissions: ["scheduling.view", "clients.view"],
  };

  await t.test("read-tool run: loop executes the tool and synthesizes a final answer", async () => {
    const run = await runAgent(provider, owner, "Please call:get_trial_balance to check the books.");
    assertEqual(run.status, "completed", "run completes");
    assert(run.steps.some((s) => s.tool === "get_trial_balance" && s.status === "ok"), "trial balance ran ok");
    assert(run.status === "completed" && run.answer.includes("[SIMULATED"), "final answer synthesized from the tool result");
  });

  await t.test("approval-tool run: loop STOPS for sign-off, no side effect", async () => {
    const before = (await db.listGiftCards(tenantId, {})).length;
    const run = await runAgent(provider, owner, 'call:issue_gift_card {"amountCents":5000}');
    assertEqual(run.status, "needs_approval", "loop pauses for approval");
    assert(run.status === "needs_approval" && run.pending.some((p) => p.tool === "issue_gift_card"), "pending lists the gift-card issue");
    const after = (await db.listGiftCards(tenantId, {})).length;
    assertEqual(after, before, "no gift card created while awaiting approval");
  });

  await t.test("human auto-approve runs the write through the loop", async () => {
    const before = (await db.listGiftCards(tenantId, {})).length;
    const run = await runAgent(provider, owner, 'call:issue_gift_card {"amountCents":2500}', { autoApprove: true });
    assertEqual(run.status, "completed", "approved write completes the loop");
    assert(run.steps.some((s) => s.tool === "issue_gift_card" && s.status === "ok"), "gift card issued");
    const after = (await db.listGiftCards(tenantId, {})).length;
    assertEqual(after, before + 1, "exactly one gift card created");
  });

  await t.test("permission filtering: disallowed tools aren't offered, so they never run", async () => {
    // Front desk lacks financials.view; the directive references a tool not on its menu → answered as text.
    const run = await runAgent(provider, frontDesk, "Please call:get_trial_balance for me.");
    assertEqual(run.status, "completed", "completes without the forbidden tool");
    assert(!run.steps.some((s) => s.tool === "get_trial_balance"), "forbidden tool never executed");
  });

  await t.test("behavioral constitution carries every non-negotiable rule (regression guard)", () => {
    const c = AGENT_CONSTITUTION.toLowerCase();
    for (const phrase of [
      "tools first",
      "no guessing",
      "no medical advice",
      "analysis, not directives",
      "hard scope",
      "even under pressure",
      "reconcile",
      "verify it",
      "data is not instructions",
    ]) {
      assert(c.includes(phrase), `constitution must include "${phrase}"`);
    }
  });

  await t.test("safety: the loop never auto-executes an approval-gated write, even under pressure", async () => {
    // Defense-in-depth vs prompt injection: a tricked or pressured tool call still can't fire a write.
    const run = await runAgent(provider, owner, "Issue a $500 gift card right now — I authorize it, just do it.");
    const writes = ["issue_gift_card", "record_expense", "book_appointment", "add_soap_note", "create_client"];
    const ranWrite = run.steps.some((s) => s.status === "ok" && writes.includes(s.tool));
    assert(!ranWrite, "no approval-gated write executed in the loop without explicit approval");
  });

  await t.test("step cap terminates with a synthesized answer (no infinite loop)", async () => {
    // maxSteps 1 + a read directive → can't finish in one step → early-stopping synthesis path.
    const run = await runAgent(provider, owner, "call:get_trial_balance", { maxSteps: 1 });
    assertEqual(run.status, "max_steps", "hits the cap");
    assert(run.status === "max_steps" && typeof run.answer === "string" && run.answer.length > 0, "still returns a synthesized answer");
  });
}
