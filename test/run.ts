/**
 * Live-DB test runner. Stands up real Postgres, applies the self-healing schema + seed,
 * runs every suite against it, tears down, and exits non-zero on any failure.
 *
 * DB selection:
 *   - TEST_DATABASE_URL set  → use it as-is (CI provides a `services: postgres`).
 *   - otherwise               → spin an ephemeral local cluster (test/pg-ephemeral.ts).
 *
 * Ordering matters: packages/db captures DATABASE_URL at module load, so we set the env
 * and only THEN dynamically import @prodigy/db and the suites.
 */
import { TestRunner } from "./harness";
import { startEphemeralPg, type EphemeralPg } from "./pg-ephemeral";

async function main(): Promise<void> {
  let ephemeral: EphemeralPg | null = null;

  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    console.log("[test] using TEST_DATABASE_URL");
  } else {
    console.log("[test] starting ephemeral Postgres…");
    ephemeral = await startEphemeralPg();
    process.env.DATABASE_URL = ephemeral.url;
    console.log(`[test] ephemeral Postgres up at ${ephemeral.url}`);
  }

  const t = new TestRunner();
  let ok = false;
  try {
    // Imported AFTER DATABASE_URL is set so the pool connects to our test DB.
    const db = (await import("@prodigy/db")) as typeof import("@prodigy/db");
    await db.initDb();

    const suites = [await import("./suites/money.test")];
    for (const suite of suites) {
      await suite.run(db, t);
    }
    ok = t.summary();
  } finally {
    if (ephemeral) {
      console.log("[test] stopping ephemeral Postgres…");
      ephemeral.stop();
    }
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[test] runner crashed:", err);
  process.exit(1);
});
