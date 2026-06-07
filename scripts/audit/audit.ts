/**
 * LIVE-AUDIT HARNESS (AUTONOMOUS_BUILD_FRAMEWORK.md Part 5 — "running the app beats reading it").
 *
 * Stands up a real, seeded instance with no external services, drives it with a headless browser,
 * screenshots the key screens, and runs an axe accessibility pass — writing PNGs + findings.json to
 * scripts/audit/out/ for the agent to review and fix in waves.
 *
 * Run:  npm run build && npm run audit
 * Deps (dev): puppeteer-core, @sparticuz/chromium, @axe-core/puppeteer. If absent, prints guidance.
 *
 * DB/server: spins an ephemeral Postgres + boots apps/api/dist, unless AUDIT_BASE_URL points at a
 * running, seeded instance.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Audit matrix (Personas × Roles × Aspects) — the lens for reviewing every finding. */
export const PERSONAS = ["owner (Amber)", "front-desk", "provider", "accountant", "client", "investor/credibility"] as const;
export const ROLES = ["owner", "admin", "provider", "front_desk", "accountant", "read-only"] as const;
export const ASPECTS = [
  "terminology/voice", "information architecture", "persona-fit", "role/permission integrity",
  "UX & task-flows", "visual & interaction consistency", "accessibility (axe + manual)",
  "empty/first-run states", "trust & honesty", "performance & polish", "credibility", "sellability",
] as const;

const OUT_DIR = join(process.cwd(), "scripts/audit/out");
const OWNER = { email: "audit-owner@prodigy.local", password: "AuditOwner!2026", displayName: "Audit Owner" };

interface AxeViolation { id: string; impact: string | null; description: string; help: string; nodes: number }
interface ScreenFinding { screen: string; url: string; axeViolations: AxeViolation[] }

async function loadDeps(): Promise<null | { puppeteer: any; chromium: any; AxePuppeteer: any }> {
  try {
    const [p, c, a] = await Promise.all([
      import("puppeteer-core" as string),
      import("@sparticuz/chromium" as string),
      import("@axe-core/puppeteer" as string),
    ]);
    return { puppeteer: (p as any).default ?? p, chromium: (c as any).default ?? c, AxePuppeteer: (a as any).AxePuppeteer };
  } catch {
    return null;
  }
}

function printInert(): void {
  console.log("LIVE-AUDIT HARNESS — inert (browser deps not installed).\n");
  console.log("  npm i -D puppeteer-core @sparticuz/chromium @axe-core/puppeteer");
  console.log("  npm run build && npm run audit\n");
  console.log(`Matrix: ${PERSONAS.length} personas × ${ROLES.length} roles × ${ASPECTS.length} aspects`);
}

/** Spin an ephemeral Postgres + boot the built server; returns base URL + a teardown. */
async function standUpInstance(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  if (process.env.AUDIT_BASE_URL) {
    return { baseUrl: process.env.AUDIT_BASE_URL.replace(/\/$/, ""), stop: async () => {} };
  }
  const { startEphemeralPg } = await import("../../test/pg-ephemeral");
  const pg = await startEphemeralPg();
  const port = 3940 + Math.floor(Math.random() * 50);
  const server: ChildProcess = spawn("node", ["apps/api/dist/index.js"], {
    env: { ...process.env, DATABASE_URL: pg.url, PORT: String(port), ALLOW_INSECURE_COOKIES: "true", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start in 30s")), 30000);
    server.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("listening on")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      server.kill("SIGTERM");
      pg.stop();
    },
  };
}

async function main(): Promise<void> {
  const deps = await loadDeps();
  if (!deps) {
    printInert();
    process.exit(0);
  }
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const instance = await standUpInstance();
  const { baseUrl } = instance;
  console.log(`[audit] instance at ${baseUrl}`);

  const browser = await deps.puppeteer.launch({
    args: [...deps.chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: await deps.chromium.executablePath(),
    headless: true,
  });
  const findings: ScreenFinding[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });

    const shoot = async (screen: string): Promise<void> => {
      await new Promise((r) => setTimeout(r, 600)); // let the SPA settle
      await page.screenshot({ path: join(OUT_DIR, `${screen}.png`), fullPage: true });
      let axeViolations: AxeViolation[] = [];
      try {
        const results = await new deps.AxePuppeteer(page).analyze();
        axeViolations = (results.violations as any[]).map((v) => ({
          id: v.id, impact: v.impact ?? null, description: v.description, help: v.help, nodes: v.nodes.length,
        }));
      } catch (e) {
        console.error(`[audit] axe failed on ${screen}:`, (e as Error).message);
      }
      findings.push({ screen, url: page.url(), axeViolations });
      console.log(`[audit] ${screen}: ${axeViolations.length} axe violation type(s)`);
    };

    // 1) Login (unauthenticated)
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle2" });
    await shoot("01-login");

    // 2) First-run owner setup (sets the session cookie), then the authed app.
    await page.evaluate(async (owner) => {
      await fetch("/api/auth/setup-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(owner),
      });
    }, OWNER);
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle2" });
    await shoot("02-dashboard");

    // 3) The new AI Assistant screen.
    const clickedAssistant = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Assistant");
      if (btn) { (btn as HTMLButtonElement).click(); return true; }
      return false;
    });
    if (clickedAssistant) await shoot("03-assistant");

    // 4) Public client-facing booking page.
    await page.goto(`${baseUrl}/book`, { waitUntil: "networkidle2" });
    await shoot("04-public-booking");
  } finally {
    await browser.close();
    await instance.stop();
  }

  writeFileSync(join(OUT_DIR, "findings.json"), JSON.stringify({ generatedAt: new Date().toISOString(), findings }, null, 2));

  const bySeverity: Record<string, number> = {};
  for (const f of findings) for (const v of f.axeViolations) bySeverity[v.impact ?? "unknown"] = (bySeverity[v.impact ?? "unknown"] ?? 0) + 1;
  console.log("\n=== AXE SUMMARY (violation types by impact) ===");
  console.log(JSON.stringify(bySeverity, null, 2));
  console.log(`Screens captured: ${findings.length} → scripts/audit/out/`);
}

main().catch((err) => {
  console.error("[audit] crashed:", err);
  process.exit(1);
});
