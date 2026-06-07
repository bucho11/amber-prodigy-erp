/**
 * AGENT EVALUATION HARNESS (evaluation-driven development — Anthropic's guidance for tool-using agents).
 *
 * Measures the agent's TOOL-SELECTION accuracy: for each realistic prompt, does the agent route to the
 * right tool? Runs against the deterministic simulated heuristic by default (a baseline + a check that
 * tool names are discriminative), or against live Claude when ANTHROPIC_API_KEY is set (the true measure).
 *
 * Run:  npm run eval        (simulated baseline)
 *       ANTHROPIC_API_KEY=... npm run eval   (live Claude)
 *
 * This is a quality signal (a score to track + improve), not a hard gate — see BUILD_BIBLE §0.
 */
import { startEphemeralPg, type EphemeralPg } from "../../test/pg-ephemeral";

interface Scenario {
  prompt: string;
  /** The tool the agent should route this intent to (null = should answer directly, no tool). */
  expect: string | null;
}

// Realistic owner/front-desk asks, grounded in the product (Anthropic: "eval tasks grounded in real uses").
const SCENARIOS: Scenario[] = [
  { prompt: "What's the current trial balance?", expect: "get_trial_balance" },
  { prompt: "List the chart of accounts.", expect: "list_accounts" },
  { prompt: "Show me the most recent sales.", expect: "list_recent_sales" },
  { prompt: "Give me a sales summary for this month.", expect: "sales_summary" },
  { prompt: "What's our income and profit summary?", expect: "income_summary" },
  { prompt: "What's the current inventory snapshot?", expect: "inventory_snapshot" },
  { prompt: "List our gift cards and balances.", expect: "list_gift_cards" },
  { prompt: "Find the client named Jordan.", expect: "find_client" },
  { prompt: "What appointments are scheduled?", expect: "list_appointments" },
  { prompt: "Book an appointment for the client.", expect: "book_appointment" },
  { prompt: "Record an expense for cleaning supplies.", expect: "record_expense" },
  { prompt: "Add a SOAP note to the chart.", expect: "add_soap_note" },
  { prompt: "Issue a gift card for fifty dollars.", expect: "issue_gift_card" },
  { prompt: "Create a new client record.", expect: "create_client" },
  { prompt: "Hi there, nice weather!", expect: null },
];

async function main(): Promise<void> {
  let ephemeral: EphemeralPg | null = null;
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else {
    ephemeral = await startEphemeralPg();
    process.env.DATABASE_URL = ephemeral.url;
  }

  try {
    const db = (await import("@prodigy/db")) as typeof import("@prodigy/db");
    await db.initDb();
    const { runAgent } = await import("@prodigy/agent");
    const { createAiProvider, aiStatus } = await import("@prodigy/ai");

    const provider = createAiProvider();
    const status = aiStatus();
    const tenant = await db.getTenantBySlug("prodigy");
    if (!tenant) throw new Error("tenant not seeded");
    const owner = { tenantId: tenant.id, userId: "1", displayName: "Eval Runner", isOwner: true, permissions: [] as string[] };

    console.log(`\nAGENT TOOL-SELECTION EVAL — provider: ${status.simulated ? "simulated heuristic" : `live Claude (${status.model})`}\n`);
    let pass = 0;
    const misses: string[] = [];
    for (const s of SCENARIOS) {
      const run = await runAgent(provider, owner, s.prompt);
      const selected =
        run.steps[0]?.tool ?? (run.status === "needs_approval" ? run.pending[0]?.tool : undefined) ?? null;
      const ok = selected === s.expect;
      if (ok) pass++;
      else misses.push(`"${s.prompt}" → ${selected ?? "(none)"} (expected ${s.expect ?? "(none)"})`);
      console.log(`  ${ok ? "✓" : "✗"} ${s.prompt}  →  ${selected ?? "(direct answer)"}`);
    }

    const pct = Math.round((pass / SCENARIOS.length) * 100);
    console.log(`\n${"=".repeat(56)}`);
    console.log(`  Tool-selection accuracy: ${pass}/${SCENARIOS.length} = ${pct}%`);
    if (misses.length) {
      console.log("\n  Misses (candidates for clearer tool names/descriptions):");
      for (const m of misses) console.log(`   ✗ ${m}`);
    }
    console.log("=".repeat(56));
  } finally {
    if (ephemeral) ephemeral.stop();
  }
  // Exit promptly: stopping Postgres makes the db pool's open connections error asynchronously;
  // exiting here terminates before that noise surfaces (same pattern as the test runner).
  process.exit(0);
}

main().catch((err) => {
  console.error("[eval] crashed:", err);
  process.exit(1);
});
