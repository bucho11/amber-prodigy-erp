/**
 * LIVE-AUDIT HARNESS — scaffold (INERT by default).
 *
 * Implements AUTONOMOUS_BUILD_FRAMEWORK.md Part 5: "running the app beats reading it."
 * This file defines the audit matrix (Personas × Roles × Aspects) and the route list, and
 * — when the optional headless-browser deps are installed — screenshots every route and runs
 * an axe accessibility pass, writing PNGs + a findings JSON the agent then reviews.
 *
 * It is intentionally inert until enabled, so it adds zero weight to install/build/test:
 *   npm i -D puppeteer-core @sparticuz/chromium @axe-core/puppeteer
 *   npm run dev            # in another shell, with a seeded DATABASE_URL
 *   AUDIT_BASE_URL=http://localhost:3000 npx tsx scripts/audit/audit.ts
 *
 * Until those deps exist, running it prints setup guidance and exits 0.
 */

/** Every route worth auditing. Public routes need no auth; app routes are gated by role. */
export const ROUTES: { path: string; auth: "public" | "app"; note: string }[] = [
  { path: "/book", auth: "public", note: "client-facing online booking" },
  { path: "/", auth: "app", note: "dashboard / system status" },
  { path: "/clients", auth: "app", note: "CRM list + profiles (clinical section gated)" },
  { path: "/schedule", auth: "app", note: "calendar / scheduling" },
  { path: "/protocols", auth: "app", note: "auto-protocol scheduler (the wedge)" },
  { path: "/checkout", auth: "app", note: "POS / payments / gift cards / packages" },
  { path: "/books", auth: "app", note: "general ledger / trial balance / journal" },
  { path: "/inventory", auth: "app", note: "products + stock" },
  { path: "/reports", auth: "app", note: "sales / income / inventory reports" },
  { path: "/memberships", auth: "app", note: "plans + member dues" },
  { path: "/team", auth: "app", note: "staff/providers + roles & permissions" },
  { path: "/audit", auth: "app", note: "clinical-access audit log (settings.manage)" },
];

/** Distinct kinds of user/customer the product serves — plus credibility lenses. */
export const PERSONAS = [
  "owner (Amber)",
  "front-desk staff",
  "provider / therapist",
  "accountant / bookkeeper",
  "client (booking online)",
  "investor / credibility lens",
] as const;

/** Every permission role to test access integrity against (P9 — server-enforced). */
export const ROLES = ["owner", "admin", "provider", "front_desk", "accountant", "read-only"] as const;

/** Be rigorous and exhaustive (framework Part 5). */
export const ASPECTS = [
  "terminology / voice",
  "information architecture",
  "persona-fit",
  "role / permission integrity",
  "UX & task-flows",
  "visual & interaction consistency",
  "accessibility (axe + manual)",
  "empty / first-run states",
  "trust & honesty (money formatting, disclaimers, no fake data)",
  "performance & polish",
  "credibility",
  "sellability / conversion",
] as const;

export type Severity = "Blocker" | "Major" | "Minor" | "Polish";

async function tryLoadBrowserDeps(): Promise<null | {
  puppeteer: unknown;
  chromium: unknown;
  AxePuppeteer: unknown;
}> {
  try {
    const [puppeteer, chromium, axe] = await Promise.all([
      import("puppeteer-core" as string),
      import("@sparticuz/chromium" as string),
      import("@axe-core/puppeteer" as string),
    ]);
    return {
      puppeteer: (puppeteer as { default?: unknown }).default ?? puppeteer,
      chromium: (chromium as { default?: unknown }).default ?? chromium,
      AxePuppeteer: (axe as { AxePuppeteer?: unknown }).AxePuppeteer,
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const deps = await tryLoadBrowserDeps();
  if (!deps) {
    console.log("LIVE-AUDIT HARNESS — inert (browser deps not installed).\n");
    console.log("To enable screenshots + axe a11y:");
    console.log("  npm i -D puppeteer-core @sparticuz/chromium @axe-core/puppeteer");
    console.log("  npm run dev   # seeded DATABASE_URL, in another shell");
    console.log("  AUDIT_BASE_URL=http://localhost:3000 npx tsx scripts/audit/audit.ts\n");
    console.log(`Matrix ready: ${PERSONAS.length} personas × ${ROLES.length} roles × ${ASPECTS.length} aspects`);
    console.log(`Routes to capture: ${ROUTES.length}`);
    console.log("\nWhen enabled this will: log in per role via the auth endpoint, goto each route,");
    console.log("screenshot({fullPage}), run AxePuppeteer().analyze(), and write PNGs + findings.json");
    console.log("to scripts/audit/out/ for the agent to review (report-first, then fix in waves).");
    process.exit(0);
  }

  // --- enabled path (only runs once the optional deps are present) ---
  console.log("LIVE-AUDIT HARNESS — enabled. (screenshot + axe implementation goes here)");
  console.log(`BASE_URL = ${process.env.AUDIT_BASE_URL ?? "http://localhost:3000"}`);
  // Implementation note for the next increment: launch headless via @sparticuz/chromium,
  // authenticate with a page.evaluate(fetch(...)) against /api/auth/login per ROLES, then for
  // each ROUTE: page.goto, screenshot to scripts/audit/out/<role>/<route>.png, and
  // new AxePuppeteer(page).analyze() → aggregate violations into findings.json with Severity.
  process.exit(0);
}

main().catch((err) => {
  console.error("[audit] crashed:", err);
  process.exit(1);
});
