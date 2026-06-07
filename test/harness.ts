/**
 * Minimal zero-dependency test harness for Prodigy ERP.
 *
 * Why hand-rolled: the project is a TS monorepo run via tsx; a full framework
 * (vitest/jest) would add config + transform surface we don't need. The gate is
 * "real code paths exercised against real Postgres", which this delivers with a
 * tiny, legible surface. See AUTONOMOUS_BUILD_FRAMEWORK.md P2 (per-increment gate).
 */

export class TestRunner {
  passed = 0;
  failed = 0;
  private failures: string[] = [];

  suite(name: string): void {
    console.log(`\n— ${name}`);
  }

  async test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      this.passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      this.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      this.failures.push(`${name}: ${msg}`);
      console.error(`  ✗ ${name}\n      ${msg}`);
    }
  }

  summary(): boolean {
    const total = this.passed + this.failed;
    console.log(`\n${"=".repeat(48)}`);
    console.log(`  ${this.passed}/${total} passed${this.failed ? `, ${this.failed} FAILED` : ""}`);
    if (this.failed) {
      console.log("\n  Failures:");
      for (const f of this.failures) console.log(`   ✗ ${f}`);
    }
    console.log("=".repeat(48));
    return this.failed === 0;
  }
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEqual<T>(actual: T, expected: T, msg = "assertEqual"): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export async function assertThrows(fn: () => Promise<unknown> | unknown, msg = "expected throw"): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${msg}: function did not throw`);
}
