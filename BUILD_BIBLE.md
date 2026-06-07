# BUILD_BIBLE.md — Prodigy ERP

> Durable decision log. Re-read at the start of every session; update whenever a
> decision is made or a slice ships. This is how a fresh chat rebuilds context
> after the conversation history is truncated.

---

## 0. Operating framework, live status & BUILD LOG (adopted 2026-06-07)

### 0.1 Operating framework
We operate under **`AUTONOMOUS_BUILD_FRAMEWORK.md`** (committed at repo root — read it in full).
Its principles are binding: verify-before-build (P1); a per-increment quality gate (P2);
depth-first to a real completion bar (P3); commit+push every increment as the only durable
memory (P5); honest outcome reporting (P6); single source of truth (P7); additive & reversible
by default (P8); security & tenancy are defaults not features (P9); boundary honesty *in the code*
(P10); build the whole system with inert swappable integration seams (P11); a11y/UX/terminology
as quality gates (P12). All prior Prodigy build discipline (below, §1–§10) still applies and is
**consistent with** the framework — this section layers the framework's two-metric reporting,
BUILD LOG cadence, and live-audit harness on top.

**Per-increment loop:** verify-before-build → gate → commit+push → log a `BL-NNN` entry → next.
Stop to ask only on a genuine fork (scope, architecture, money/permission-model changes, anything
outward-facing or irreversible). Otherwise keep momentum.

**The gate (today):** `npm run typecheck` + `npm run build` + `npm test` — all GREEN 2026-06-07.
`npm test` (BL-003) stands up a **real ephemeral Postgres** and runs the money-path suite (7/7) against
live SQL; CI (`.github/workflows/ci.yml`) runs typecheck+build+test on every push/PR against a Postgres
service. **Standing policy:** every increment must clear typecheck + build + test before moving on (P2),
and grow the suite for any money/clinical/permission path it touches.

**Research mandate (ratified):** before every non-trivial feature or strategic call, web-research
how ≥2–3 category leaders (per axis, see §0.3) solve it — architecture, UX, terminology, economics —
and cite what was modelled, in the BL entry. Owner wants this "to the highest degree." Model from
reality, not priors.

### 0.2 Two-metric completion tracker (newest first)
> **Metric A — Overall (to real production for real users):** the full three-layer ERP serving
> real tenants, *including* live external rails (card processing, SMS/email send, payroll ACH +
> tax filing), runtime-verified money/data paths, and formal HIPAA/BAA where insurance billing is
> live. Moves slowly and honestly; includes everything outside the container.
> **Metric B — Build-ready (no external creds):** everything finishable in-container before the
> regulated rails. B = 100% means "only Bucho's integration/provisioning work remains."

| Date | Metric A (overall) | Metric B (build-ready) | Note |
|------|--------------------|------------------------|------|
| 2026-06-07 | **~29%** | **~77%** | **BL-021 — behavioral constitution (reliability playbook, arc start).** Adopted `AGENTIC_AI_PLAYBOOK.md`'s "reliability is the product" thesis. Put a 12-rule **non-negotiable constitution** at the top of the agent system prompt, adapted to wellness/clinical + grounded in 2026 wellness-AI rules (CA AB 489): tools-first, no-guessing, label-the-source, empty-means-say-so, **no medical advice / not a clinician**, recommendations-are-analysis, confirm-high-stakes-**even-under-pressure**, **reconcile-don't-over-certify**, anti-sycophancy, hard-scope. Exported + regression-guarded (rules can't be silently dropped). 40/40. |
| 2026-06-07 | **~28%** | **~76%** | **BL-020 — agent context quality (context engineering).** Tool results now return concise, human-readable summaries (e.g. "Sales …: 12 paid orders, net sales $X…") instead of raw JSON with internal IDs — token-efficient context (Anthropic: token usage drives ~80% of agent performance). Enriched the agent system prompt (use real data, one tool/step, never claim un-approved writes ran), and wired **adaptive thinking + effort:high** on the live Claude path (recommended for agentic work). 39/39 tests, eval 15/15. |
| 2026-06-07 | **~27%** | **~75%** | **BL-019 — agent EVAL harness (evaluation-driven development).** Per Anthropic's agent guidance ("measure tool use, spot failures, iterate") + the eval literature (tool-selection accuracy is the core metric): added heuristic intent→tool routing to the simulated provider (smarter keyless demo + a deterministic stand-in for the model), and `scripts/eval/eval.ts` (`npm run eval`) scoring tool-selection across 15 realistic scenarios. **Baseline: 15/15 = 100%** (confirms tool names are discriminative); runs against live Claude when a key is set (the true measure). Metric B crossed 75%. |
| 2026-06-07 | **~27%** | **~74%** | **BL-018 — audit coverage 4→14 screens; fixed 4 real a11y bugs.** Extended the live-audit harness to click through every authed nav screen (Calendar, Clients, Checkout, Books+Expenses, Inventory, Reports, Memberships, Team, Audit) + capture violation node targets. Surfaced + fixed: unlabeled date/provider selects (Calendar), unlabeled role selects + invite email (Team), low-contrast "Full access" badge — **14/14 screens now 0 axe violations**. 38/38 tests green. |
| 2026-06-07 | **~26%** | **~73%** | **BL-017 — Expenses UI + API (humans, not just the agent).** `POST /api/expenses` (books.manage) + a one-click "Expenses" subtab/form in Books (pick expense account → amount → memo → date → balanced entry). Completes `recordExpense` across the stack (db→agent→API→UI). 38/38 green. |
| 2026-06-07 | **~26%** | **~72%** | **BL-016 — back-office depth: record_expense (agent-callable bookkeeping).** New `recordExpense` ledger fn (Dr expense acct / Cr Cash, balanced, validates account is expense-type) + `record_expense` agent tool (books.manage, approval). The agent can now do real bookkeeping with human sign-off. 38/38 green (verified: balanced entry, wrong-account rejected, books balance). |
| 2026-06-07 | **~26%** | **~71%** | **BL-015 — agent-action history (governance/transparency).** `listAgentApprovals` gained a `decided` filter; new `listRecentDecidedApprovals` + `GET /api/ai/approvals/history`; Assistant now shows a "Recent agent actions" log (Approved & ran / Rejected / Failed) beneath the pending inbox. Owners can audit what the AI proposed and how it was decided. 37/37 green; audit re-run 0 axe violations. |
| 2026-06-07 | **~26%** | **~70%** | **BL-014 — agent can BOOK appointments (safely).** New `bookAppointmentChecked` db fn (variant lookup → **double-booking guard** [`findConflict`, the same one the calendar uses] → create) + `book_appointment` agent tool (scheduling.manage, approval). The AI-receptionist capability the leaders lead with — but conflict-prevention is enforced (research: the hard requirement) and it's human-approved. 36/36 green (verified: conflict rejected, exactly one appt written). **Metric B crossed 70%.** |
| 2026-06-07 | **~25%** | **~69%** | **BL-013 — agent gains a clinical WRITE tool (approval-gated).** `add_soap_note` (clinical.manage, approval) lets the agent draft a SOAP note into a client's chart — but it pauses for human sign-off (clinical = high-stakes) and runs under the approver's RBAC through the same `executeTool` path. An AI-charting capability (cf. Jane/Noterro). 35/35 green. `book_appointment` deferred to a dedicated increment because it needs the double-booking guard (research: conflict-prevention is non-negotiable for AI booking). |
| 2026-06-07 | **~25%** | **~68%** | **BL-012 — broaden the agent registry + FIX a real audit-integrity bug.** Added 5 read tools (find_client, list_appointments, sales_summary, income_summary, inventory_snapshot) so "Ask Prodigy" spans CRM/scheduling/reporting/inventory — all RBAC-gated, calling real db fns. The live gate then caught a latent **security bug**: `verifyAuditChain` sorted by a text alias (`id::text AS id`) → lexicographic order → with ≥10 entries it walked the hash chain out of order and **falsely reported tampering**. Fixed (order by the real bigint column); guarded by a >10-entry intact test + a real-tamper-still-detected test. 34/34 green. |
| 2026-06-07 | **~24%** | **~67%** | **BL-011 — design-system polish: elevation, focus rings, button states.** Added `:root` design tokens (`--radius`, `--shadow`/`--shadow-sm`, `--ring`); soft card elevation, primary-button shadow + hover lift, input focus rings, font smoothing, and **keyboard `:focus-visible` rings on every interactive element** (P12). Global (no component JSX touched) → lifts every screen. Audit re-run: still **0 axe violations**; visually reviewed. Next: per-screen polish + feature depth. |
| 2026-06-07 | **~24%** | **~66%** | **BL-010 — UI overhaul #1: sidebar navigation + layout shell.** Replaced the centered topnav (12 tabs overflowing/wrapping) with a modern grouped **left sidebar** (Front desk / Back office / Setup) + a wider content area — the standard premium-SaaS shell (Boulevard/Mangomint aesthetic). Preserved the `<main>` landmark + single `<h1>`; `aria-current` on the active item; responsive collapse. Audit re-run: **still 0 axe violations**, topnav-overflow finding resolved. Visually reviewed. Next: design-token/typography refinement + per-screen polish, then clinical/back-office depth. |
| 2026-06-07 | **~23%** | **~64%** | **BL-009 — live-audit harness activated + first a11y pass to ZERO.** `scripts/audit/audit.ts` now real: spins ephemeral PG + boots the server, logs in, screenshots login/dashboard/assistant/public-booking, runs axe. First pass found 4 serious + 5 moderate (contrast, missing `<main>`, no `<h1>`); fixed in a low-risk wave (darkened muted/accent tokens to WCAG-AA, added landmarks + an h1) → **re-run: 0 violations on all 4 screens** (objective numbers verified moved). Visually reviewed the renders. Next: NORTH_STAR #1 UI/design-system overhaul (incl. the topnav-overflow IA issue the audit surfaced). |
| 2026-06-07 | **~22%** | **~62%** | **BL-008 — the agent reaches the app: "Ask Prodigy" + approvals inbox.** New `Assistant.tsx` (assistive-copilot pattern): chat → `/api/ai/agent`, transparent tool-step trail, live-vs-simulated badge, and a pending-approvals inbox with Approve/Reject wired to `/api/ai/approvals`. Added an Assistant nav tab (all users; agent only exposes each user's permitted tools). Runtime-smoked: server boots, `agent_approvals` self-heals on boot, all AI routes wired + 401-gated. Next: activate the live-audit harness (screenshots/axe) on the new screens, then UI/design-system overhaul. |
| 2026-06-07 | **~21%** | **~58%** | **BL-007 — durable approval queue (human-in-the-loop complete).** New `agent_approvals` table + `@prodigy/db` persistence + `@prodigy/agent` workflow (request → list pending → approve/reject). Approve executes once under the approver's RBAC through `executeTool` (validated, real db path, audited); pending-guarded against double-execute. `/api/ai/agent` now persists proposed writes; `GET/POST /api/ai/approvals[/:id/approve|reject]`. 5 tests green (30/30). The agentic propose→approve→execute→audit loop is end-to-end. Next: the conversational UI surface + approvals inbox. |
| 2026-06-07 | **~20%** | **~55%** | **BL-006 — the LLM agent loop (the differentiator runs).** Extended the provider seam for tool-use (text/tool_use/tool_result blocks; SimulatedAiProvider emits deterministic tool calls). New `runAgent` orchestrator: manual tool-use loop over the registry with research-backed guardrails — hard step cap + early-stopping synthesis, repeat-call detector, approval pauses. `POST /api/ai/agent` runs it (simulated until a key drops). 5 loop tests green (25/25). The Agentic OS now *operates*, end to end, with no key. Next: a persisted approval queue + the conversational UI surface. |
| 2026-06-07 | **~19%** | **~50%** | **BL-005 — Agentic-OS runtime: audited, RBAC-gated tool registry.** `@prodigy/agent` — typed tools wrapping the real db modules (books/POS/gift cards/CRM), `executeTool` choke point enforcing server-side RBAC → input validation → **pre-execution approval gate** (money/clinical/outward pause for human sign-off) → execute → tamper-evident audit. `/api/ai/tools` exposes the catalog with per-actor `allowed`. 8 runtime tests green (20/20 total). Next: the LLM-driven agent loop (tool-use) over this registry. |
| 2026-06-07 | **~18%** | **~46%** | **BL-004 — AI core foundation, step 1: provider seam.** `@prodigy/ai` (AiProvider interface + deterministic SimulatedAiProvider + ClaudeAiProvider behind one factory, model `claude-opus-4-8`); `/api/ai/status` surfaces live-vs-simulated; 5 seam tests green. The Agentic OS can now be built+tested with no key (P11). Next: agent runtime + audited tool registry. Research: modelled the agent surface on Zenoti's 9-agent "AI Workforce" + Mangomint Flows. |
| 2026-06-07 | **~17%** | **~43%** | **BL-003 — reproducible gate landed.** Committed live-DB test harness (ephemeral Postgres, 7/7 money-path tests green), type-gated test code, GitHub Actions CI (typecheck+build+test), and an inert live-audit harness scaffold. B1 done. Small bump: the foundation is now verifiable + CI-guarded (de-risks everything downstream), but no user-facing feature shipped. Next: AI core foundation. |
| 2026-06-07 | **~16%** | **~40%** | **Re-baseline (scope expanded, P6):** vision is now a *maximalist, end-to-end, Agentic-OS* platform — absorb every feature the wellness niche wants AND lead with an agentic AI layer (orchestrator + domain agents). The denominator grew a lot, so both % drop honestly even though no code regressed. The 20 shipped slices are unchanged; what's now "100%" is much bigger (full feature absorption + the whole agent system + UI overhaul + back-office/clinical depth). |
| 2026-06-07 | **~22%** | **~60%** | Framework adopted; gates verified green. 20 slices shipped (foundation→POS→GL→inventory→reporting→memberships→public booking→clinical audit→self-serve manage). *(Superseded by the re-baseline above once the Agentic-OS vision was ratified.)* |

### 0.3 Ratified alignment (kickoff 2026-06-07 — durable; do not re-litigate)
- **Outcome & bar:** the reframed North Star (see `NORTH_STAR.md`) — the first wellness-vertical
  platform that runs front-of-house like the best salon/spa software, charts+bills like the best
  clinical software, and keeps books+payroll like real accounting software, AI-native, best-in-class
  UI, in one system. "Done" overall = Metric A above (the project-wide Definition of DONE in
  `PROJECT_STATE.md §1`, previously "TO CONFIRM", is hereby anchored to Metric A). Per-increment bar:
  "a senior engineer would ship this" depth (P3) + the gate.
- **The two metrics:** as defined in §0.2.
- **Autonomy:** **FULL** — fix low-risk silently, build straight through the loop; propose only
  genuine structural forks. Constant, extensive web-research modelling from industry leaders is
  required to the highest degree (§0.1 research mandate).
- **Gates:** typecheck + build now (green); committed live-DB test suite + CI added as Increment 1,
  then part of every increment's "done" (Q3: "yes, test harness as an early increment").
- **Git:** develop + commit + push **every increment** to `claude/autonomous-build-setup-saEZw`
  (a change from prior slices, which pushed straight to `main`). No PR / nothing outward-facing
  unless Bucho asks. Replit deploy loop unchanged (§5).
- **Reference leaders (per axis):** front-of-house → **Boulevard, Mangomint** (+ Vagaro parity,
  Zenoti "everything"); clinical → **Jane, ClinicSense, Noterro**; back-office → **CheckMark, Gusto**
  (+ ADP); pricing/acquisition → Fresha; mobile/design → GlossGenius. Full landscape in `NORTH_STAR.md`.
- **Product ambition (ratified 2026-06-07 — expanded vision):** this is a **maximalist, end-to-end**
  platform that **absorbs every feature & capability the niche could ever want** (front-of-house +
  clinical + back-office, to 10/10 depth), and **leads with Agentic AI**. Take the vision to its
  highest value; improve continuously; web-research is the primary tool and must be used heavily.
- **Agentic-AI vision (ratified 2026-06-07 — the differentiator):** an **Agentic OS** — a central
  **orchestrator** plus **per-domain agents** (front-desk/booking, clinical scribe, books &
  reconciliation, marketing/comms, inventory/purchasing, analytics) that take **real,
  permission-scoped, fully-audited actions** on the user's behalf, with **human-approval gates** on
  anything that moves money, touches clinical/PII, or is outward-facing. The platform "runs itself";
  staff supervise. **Provider:** **Claude (Anthropic), latest models**, behind an **inert simulated
  provider seam** (deterministic, clearly flagged — framework P11/A.4) so the entire agent system is
  built & tested with **no key**; it lights up live when `ANTHROPIC_API_KEY` is present. The LLM key
  is **not** a regulated rail (it can go live mid-build, non-blocking); money/SMS/payroll rails still
  go LAST. **Sequence:** gate (Inc 1) → AI core foundation (provider seam + agent runtime + tool/
  function registry over existing modules + memory + audit + approval gates) → then every subsequent
  build, including the UI overhaul (which becomes the agentic surface), is designed AI-native around it.
- **Niche scope:** wedge-deep on **massage/bodywork/wellness-clinical** to 10/10, but **architect
  multi-vertical** (salon/spa/med-spa/fitness) so broadening later is config, not a rebuild.
- **Agentic-AI reliability playbook (ratified 2026-06-07 — adopted `AGENTIC_AI_PLAYBOOK.md`):** the
  thesis is **reliability is the product, not capability** (pass^k, not pass@1). Ratified for Prodigy:
  (a) **reliability-first** priority for the AI arc — our stakes (clinical charts + money) are HIGHER
  than the playbook's source project, so consistency matters more; (b) build the **pass^k eval
  framework now, light up live when an `ANTHROPIC_API_KEY` is set** (key-later); (c) action tiers — our
  writes are already 100% approval-gated, so the high-value add is **simulate-first impact previews** at
  the approval step (undo is lower priority since nothing auto-executes); (d) **hard scope** (Rule 10 +
  6, grounded in 2026 wellness-AI rules incl. CA AB 489): the agent **declines medical/clinical advice**
  (surfaces chart data but never diagnoses/recommends treatment; never implies it's a licensed provider),
  frames money/legal as **analysis not directives**, and declines anything outside this business's ops.
  The 12-rule **behavioral constitution** lives at the top of the agent system prompt (BL-021).
- **Hard constraints (LOCKED, from `NORTH_STAR.md`):** (1) regulated external rails — live card
  processing, SMS/email **sending**, payroll tax filing / ACH — are activated **LAST**, right before
  ship, and only with Bucho's own accounts (build the software around them earlier as inert seams).
  (2) First workstream after the gate = UI/design-system overhaul. (3) Differentiate, don't just
  clone. (4) Live code is truth; verify before claiming; honest caveats; never ship secrets/credentials/
  source to a public surface; every query tenant-scoped; every by-id mutation ownership-checked.

### 0.4 Deferred backlog (nothing silently dropped; B-NN)
- ~~**B1 — Committed test harness + CI**~~ ✅ **DONE (BL-003)**: `test/` runner spins an ephemeral
  Postgres (drops to the `postgres` user via uid/gid; `pg_ctl -l` so spawnSync doesn't hang on the
  daemon's pipes), applies the self-healing schema, runs the money-path suite (7/7) against live SQL,
  tears down. Type-gated via `test/tsconfig.json`. `npm test` + CI (`.github/workflows/ci.yml`,
  Postgres service via `TEST_DATABASE_URL`).
- ~~**B2 — Live-audit harness**~~ ✅ **ACTIVE (BL-009)**: `scripts/audit/audit.ts` spins an ephemeral
  PG + boots the server, logs in via `setup-owner`, screenshots login/dashboard/assistant/public-booking
  with headless Chromium (`@sparticuz/chromium`), and runs axe (`@axe-core/puppeteer`); writes PNGs +
  `findings.json` to `scripts/audit/out/` (gitignored). `npm run audit`. Extend to more screens/roles as
  the UI grows. Known open finding (deferred to the UI overhaul): topnav overflow/wrap with 12 tabs.
- **B3 — UI / design-system overhaul** (NORTH_STAR workstream #1; starts after the gate).
- **B4 — Clinical depth:** form builder + e-sign, richer charting/body charts, AI/predictive notes,
  superbills / insurance-billing **prep** (electronic billing itself is rails/HIPAA-gated).
- **B5 — Back-office depth:** A/R, A/P + vendors + bill pay, bank reconciliation, financial statements
  (Balance Sheet / P&L / Cash Flow), period close, payroll **calc** → paystubs → checks → 1099/W-2 prep
  (ACH + filing rails-gated).
- **B6 — Front-of-house polish:** deposits (Stripe-gated), waitlist, classes, website/branded app,
  reviews/reputation, resources.
- **B7 — AI CORE / Agentic OS** *(the differentiator; epic — starts right after the gate)*:
  (a) **provider seam** — `AiProvider` interface + deterministic `SimulatedAiProvider` (no key) +
  `ClaudeAiProvider` (Anthropic, latest models) behind one factory; (b) **agent runtime** — an
  orchestrator + per-domain agents; (c) **tool/function registry** — typed, permission-scoped,
  tenant-scoped, **audited** tool calls that wrap the EXISTING db modules (booking, POS, ledger,
  clinical, inventory, …) so agents act through the same guards humans do; (d) **memory** (per-tenant,
  per-conversation) + **approval gates** (money/clinical/outward actions require human sign-off);
  (e) surfaced in the UI as the agentic command surface. Research Agentic AI heavily before building.
- **B-SCOPE — Maximal feature absorption** *(standing directive)*: continuously close parity gaps vs
  the reference leaders across all three layers (front-of-house, clinical, back-office) to 10/10 depth.
  Each major feature: research ≥2–3 leaders first, cite in the BL entry.
- **B8 — Comms/marketing engine** (campaigns, automations, templates, loyalty, AI copy) — built now,
  **sending deferred** to the rails step.
- **B-RAILS (owner-gated, activated LAST):** Stripe go-live, Twilio + A2P 10DLC, payroll ACH + tax
  filing, formal HIPAA/BAA + electronic insurance billing, public-booking CAPTCHA/rate-limiting (infra).
- **B-MERGE:** decide eventual merge/PR strategy for `claude/autonomous-build-setup-saEZw` → `main`
  (prior slices were committed directly to `main`).

### 0.5 BUILD LOG (newest first)
<!-- New increments prepend a BL-NNN entry here. Format: WHAT / WHY-HOW / BOUNDARY / GATES. -->

### BL-021 (2026-06-07) — Behavioral constitution: the reliability playbook begins [reliability is the product]
WHAT: Adopted `AGENTIC_AI_PLAYBOOK.md` (kickoff ritual; decisions in §0.3). Added a 12-rule
`AGENT_CONSTITUTION` at the top of the agent system prompt (`orchestrator.ts`), adapted to a
wellness/clinical operations context: tools-first, no-guessing, label-the-source, empty-means-say-so,
recommendations-are-analysis (not a CPA/attorney), **NOT A CLINICIAN — no medical advice** (surface
chart data, never diagnose/recommend treatment, never imply a licensed provider), logged-data-only,
uncertainty-changes-the-answer, no-fabrication, **hard scope** (decline out-of-domain in character),
**high-stakes confirmation even under pressure**, **reconcile-don't-over-certify + anti-sycophancy**.
Exported the constitution and added a regression test asserting every non-negotiable phrase is present.
WHY/HOW: The playbook's core thesis — consistency > peak capability for a business copilot (τ-bench
pass^k). Our context raises the stakes vs. the source project (clinical charts + money), so the
constitution's safety rules matter more, not less. Hard-scope grounded in 2026 wellness-AI guidance
(strict separation of operations from medical advice; CA AB 489 — don't imply licensed-provider status;
guardrails in structure, not just prose). Rules 6/10/11/12 are the additions our prior prompt lacked.
The constitution is a system-prompt change → its behavioral effect is judged on the LIVE model (the
simulated heuristic ignores prose); the regression test guards the rules' PRESENCE so they can't be
dropped silently (playbook: "a behavior you can't prove safe becomes a rule, then a regression test").
BOUNDARY: Behavioral adherence (does the live agent actually refuse medical advice / confirm under
pressure?) is UNVERIFIED until the pass^k eval runs against live Claude (next: BL-022 framework, then a
key). Structural separation for hard-stakes is already in code (approval gate + RBAC + tenant scope);
the constitution reinforces it in language. Reconciliation (Rule 12) is stated but not yet wired as a
cross-source tool check — that's a follow-up (playbook §5.2).
GATES: typecheck PASS, build PASS, test 40/40 PASS.

### BL-020 (2026-06-07) — Agent context quality: tool-result summaries + system prompt + adaptive thinking [context engineering]
WHAT: (1) Added an optional `summarize(result)` to `AgentTool` and concise formatters to the read tools
(trial balance, recent sales, gift cards, find client, appointments, sales summary, inventory) — the
orchestrator now feeds the model a short human-readable line (e.g. "Trial balance: 17 accounts; total
debits $X = total credits $X (balanced).") instead of raw JSON with internal IDs; falls back to
truncated JSON for un-summarized tools. (2) Rewrote the agent system prompt: use real tool data (never
invent), one well-chosen tool per step, read results before deciding, never claim an approval-gated
write ran, ask for missing ids. (3) Wired `thinking:{type:"adaptive"}` + `output_config:{effort:"high"}`
on `ClaudeAiProvider` (the recommended agentic setting). Test asserts the summary is a short sentence,
not raw JSON.
WHY/HOW: Directly applies the context-engineering research (Anthropic "writing tools for agents" +
"effective context engineering"): return meaningful, token-efficient context, not raw IDs — token usage
explains ~80% of agent performance variance. Cleaner context → better reasoning + lower cost on the live
path. Adaptive thinking + high effort is Claude's recommended config for tool-use/agentic work.
BOUNDARY: Summaries cover the main read tools; `list_accounts`/`income_summary` still fall back to JSON
(fine — small/typed). The adaptive-thinking + effort params run only on the live Claude path (untested
here, no key) and assume the installed SDK accepts them (Anthropic SDK that supports Opus 4.8 surface);
if an older SDK rejects `output_config.effort`, drop it — the agent still works. System-prompt quality is
judged on the live model (the simulated heuristic ignores it).
GATES: typecheck PASS, build PASS, test 39/39 PASS, eval 15/15 (100%).

### BL-019 (2026-06-07) — Agent evaluation harness: evaluation-driven development [measure the AI to improve it]
WHAT: (1) Added heuristic intent→tool routing to `SimulatedAiProvider` — scores a prompt's distinctive
words against each offered tool's name tokens and picks the best (keeps the `call:` directive as an
override). This makes the keyless assistant actually route to tools (better demo) AND gives the eval a
deterministic stand-in for the model. (2) New `scripts/eval/eval.ts` (`npm run eval`) — stands up the
seeded instance, runs the agent over 15 realistic prompts, and scores TOOL-SELECTION ACCURACY (did it
route to the right tool). Baseline against the heuristic: **15/15 = 100%**. Runs against live Claude
when `ANTHROPIC_API_KEY` is set (the real measure).
WHY/HOW: This is the directive to make the agentic AI operate at its highest capability — and the
unanimous research answer is **evaluation-driven development**: Anthropic's "Building/Writing effective
tools for agents" ("measure how Claude uses your tools, spot failure modes, iterate") and the agent-eval
literature (T-Eval / trajectory evals; tool-selection + argument + trajectory are the core metrics).
You can't improve what you don't measure — so we now have a capability score to track and gate against
regressions. The eval doubles as a check that tool names are discriminative (Anthropic: "clear, distinct
names"); a miss would flag an ambiguous name to fix. Sources: anthropic.com/research/building-effective-
agents, anthropic.com/engineering/writing-tools-for-agents, confident-ai agent-eval guide, arxiv T-Eval.
BOUNDARY: The simulated heuristic measures whether NAMES are discriminative, not the model's true
reasoning — the real capability number comes from `ANTHROPIC_API_KEY=… npm run eval` (live Claude),
which also exercises ARGUMENT correctness (the heuristic passes empty args). Eval scores selection only,
not full trajectory/multi-step plans or argument accuracy yet (next eval iterations). It's a tracked
quality signal (a score), not a blocking gate (like the audit harness). 15 scenarios — expand over time.
GATES: typecheck PASS, build PASS, test 38/38 PASS, eval 15/15 (100%) on the simulated baseline.

### BL-018 (2026-06-07) — Expand live-audit to 14 screens; fix 4 real a11y bugs [the audit harness pays off again]
WHAT: Extended `scripts/audit/audit.ts` to click through every authenticated nav screen (Calendar,
Clients, Checkout, Books + the Expenses subtab, Inventory, Reports, Memberships, Team & Roles, Audit)
and capture each axe violation's node target + HTML snippet (for pinpointing). First expanded run found
3 critical + 1 serious on screens never audited; fixed in a wave: added `aria-label`s to the Calendar
toolbar date input + provider filter `<select>`, the Team invite email + role `<select>`s and the
per-member role-change `<select>`; darkened the `.role-badge.full` text to clear WCAG-AA contrast.
Re-ran → **14/14 screens at 0 axe violations**.
WHY/HOW: BL-009's harness only covered 4 screens, so most of the app's a11y was unverified (a known
boundary). Standing up + clicking through the real app surfaced unlabeled form controls — invisible to
static review, real blockers for screen-reader/keyboard users (P12). Fixed objectively (re-ran to confirm
0), and the harness now records node targets so future findings are directly actionable.
BOUNDARY: Still owner-role only (per-role audits — e.g. what a front-desk user sees — are a later pass).
Screens are captured in their default/empty state (no seeded appointments/sales), so data-dense layouts
(a full calendar, a long ledger) aren't visually stress-tested yet. Booking/editor modals and sub-forms
opened by buttons aren't auto-captured.
GATES: typecheck PASS, build PASS, test 38/38 PASS, audit 14/14 screens 0 axe violations.

### BL-017 (2026-06-07) — Expenses UI + API: one-click expense entry in Books [the feature, human-usable]
WHAT: `POST /api/expenses` (requireAuth + books.manage) → `recordExpense` (LedgerError already maps to
400). New "Expenses" subtab in `Books.tsx` (shown to books.manage users) — a `ExpensesView` form: pick
an expense-type account, enter amount + memo + date, post a balanced Dr expense / Cr Cash entry, with a
success confirmation. Reuses the existing form/field/input/button patterns.
WHY/HOW: BL-016 gave the *agent* expense recording; this makes it human-usable directly — completing the
feature across db → agent → API → UI (the same `recordExpense` core, one source of truth, P7). A
one-click expense form is far friendlier than balancing a manual journal entry by hand, which is what
Books required before. Account dropdown is filtered to expense-type accounts so you can't mis-post.
BOUNDARY: The Books/Expenses screen isn't in the live-audit screenshot set yet (the harness captures
login/dashboard/assistant/public-booking) — it reuses already-audited components, but a dedicated axe
pass on Books is a follow-up (extend the harness route list). The new HTTP route isn't unit-tested at
the HTTP layer (consistent with the other routes); `recordExpense` underneath is fully unit-tested.
Still cash-basis (credits Cash; no A/P).
GATES: typecheck PASS, build PASS, test 38/38 PASS.

### BL-016 (2026-06-07) — Back-office depth: record_expense (agent-callable bookkeeping) [the agent keeps the books]
WHAT: New `recordExpense(tenantId, {expenseAccountCode, amountCents, memo, date?})` in `ledger.ts` —
posts a balanced journal entry Dr <expense account> / Cr Cash 1010 via `createJournalEntry`; validates
the account exists AND is expense-type, and the amount is a positive integer. New `record_expense`
agent tool (books.manage, approval). Tests: pauses without approval, RBAC-denied without books.manage,
non-expense account rejected, approved post creates exactly one balanced entry and the trial balance
still balances (38/38).
WHY/HOW: Advances the back-office layer (one of the three the platform fuses) and gives the agent a
real bookkeeping action — "record that we paid $X for Y" — through the existing double-entry GL (P7),
gated by approval since it touches the books. Single safe entry point (no raw journal inserts from the
agent). Account-type validation prevents nonsense like crediting an expense or debiting cash twice.
BOUNDARY: Cash-basis simplification — every expense credits Cash 1010 (no A/P / unpaid-bill tracking;
that's a fuller vendors/bills increment later). No expense categories beyond the seeded chart, no
attachments/receipts, no recurring expenses. Not yet surfaced in the Books UI as a form (agent-only +
the existing manual-journal UI); a dedicated expense form is a later UI increment.
GATES: typecheck PASS, build PASS, test 38/38 PASS.

### BL-015 (2026-06-07) — Agent-action history in the Assistant [governance + transparency]
WHAT: `listAgentApprovals` gained a `decided` filter (status <> 'pending'); new
`listRecentDecidedApprovals(tenantId)` in `@prodigy/agent`; new `GET /api/ai/approvals/history`; and a
"Recent agent actions" card in `Assistant.tsx` that lists each decided action with an outcome badge
(Approved & ran / Rejected / Failed). The pending-inbox refresh now loads pending + history together.
WHY/HOW: Trust in an agentic system comes from transparency (the copilot-UX research) — owners need to
see not just what's pending but what the AI has actually done and how each was decided. Reuses the
existing approval rows (no schema change) — the history IS the decided approvals. Verified: a db test
confirms the `decided` filter excludes pending + includes executed/rejected; the live-audit harness
re-ran with the new UI section at 0 axe violations.
BOUNDARY: History shows the last 25 decided approvals (no pagination/filtering yet) and the proposed
input, not a rich diff of what changed. Read-only actions (auto-run tools) aren't in this list — they're
on the tamper-evident audit log (resourceType `agent_tool`); a unified "everything the agent did" view
(merging auto reads + approved writes) is a later enhancement. No per-action drill-down yet.
GATES: typecheck PASS, build PASS, test 37/37 PASS, audit 0 axe violations.

### BL-014 (2026-06-07) — Agent books appointments, double-booking-guarded [the AI-receptionist action]
WHAT: New `bookAppointmentChecked(tenantId, input)` in `@prodigy/db/scheduling.ts` — resolves the
service variant (duration + price), applies the same hard double-booking guard the internal calendar
uses (`findConflict` on provider + room overlap), then creates; throws a typed `SchedulingError` on a
bad reference, invalid time, or conflict. New `book_appointment` agent tool (scheduling.manage,
approval) calls it. Tests: pauses without approval, RBAC-denied without scheduling.manage, approved
booking succeeds, and a second booking at the same provider+time is rejected as a conflict — with
exactly one appointment persisted (36/36).
WHY/HOW: This is the headline AI-receptionist capability (cf. Zenoti's AI Workforce). The research was
unanimous that **double-booking prevention is the hard requirement**, so I did NOT expose raw
`createAppointment`; instead a single safe entry point wraps it with the conflict guard (P7 — humans
and the agent book through the same guard) and it's approval-gated (writes to the calendar). The agent
provides clientId/providerId/serviceVariantId/startsAt; duration/price/endsAt are derived server-side so
the model can't fabricate them.
BOUNDARY: `bookAppointmentChecked` enforces the hard double-booking guard but not working-hours
availability (advisory, consistent with the existing internal calendar — only the overlap guard is hard).
`SchedulingError` isn't mapped in the HTTP error handler yet (no HTTP route uses the fn — the agent tool
catches it via `executeTool`); wire that mapping when an internal booking route adopts it. The agent
must already know the provider/variant ids (it can get them via `list_appointments`/catalog tools or the
human supplies them) — a friendlier "book by name/time" resolver is a later enhancement.
GATES: typecheck PASS, build PASS, test 36/36 PASS.

### BL-013 (2026-06-07) — Agent clinical write tool: add_soap_note (approval-gated) [the agent can now act, not just read]
WHAT: Added `add_soap_note` to the registry — permission `clinical.manage`, risk `approval`. Drafts a
SOAP note (S/O/A/P + date) into a client's chart via the real `createSoapNote` db fn. Required-date
validator (`reqDate`). Tests: pauses without approval (no write), denied for a role lacking
clinical.manage, and on approval writes exactly one note carrying the right content (35/35).
WHY/HOW: First agent WRITE beyond gift cards — an AI-charting capability the clinical leaders (Jane,
Noterro) lead with. Clinical data is high-stakes, so it's approval-gated (never auto-runs) and executes
under the approver's authority through the same `executeTool` choke point (validated → real db → audited).
Researched AI-booking guardrails first and deliberately deferred `book_appointment`: raw
`createAppointment` has no conflict guard, and the research is unanimous that double-booking prevention
is the hard requirement — so that tool needs `findConflict` wired in, as its own careful increment.
BOUNDARY: `add_soap_note` doesn't validate the date is sane vs. the client's history or attach an
appointment/provider (nulls for now) — a fuller clinical-charting tool (link appointment, body chart,
templates) is later. `book_appointment` and other write tools (refunds, inventory adjust) are not yet
exposed. Clinical note content is whatever the model proposes — the human approves before it's saved.
GATES: typecheck PASS, build PASS, test 35/35 PASS.

### BL-012 (2026-06-07) — Broaden agent tools + fix a latent audit-integrity bug [more capability, hardened security]
WHAT: Added 5 read tools to `@prodigy/agent` registry — `find_client` (clients.view), `list_appointments`
(scheduling.view), `sales_summary` + `income_summary` (reports.view), `inventory_snapshot` (inventory.view)
— each RBAC-gated, calling the real db functions, with sensible date defaults (month-to-date / today).
"Ask Prodigy" now answers across CRM, scheduling, reporting, and inventory, not just books/POS. Added
tests for execution, per-tool RBAC, and bad-date rejection.
WHY/HOW: Advances "absorb every feature" + "lead with agentic AI" — the agent's usefulness scales with
its tool surface. **The live gate then caught a real security bug:** `verifyAuditChain` did
`SELECT id::text AS id ... ORDER BY id ASC` — the text alias shadows the bigint column, so Postgres
sorted LEXICOGRAPHICALLY (1, 10, 11, 2, …). Under 10 rows lexical==numeric so it passed; the new tools
pushed the agent-audit count to 11, so verification walked the hash chain out of order and **falsely
reported tampering** on an untampered log. The chain is WRITTEN correctly (`recordAudit` orders by the
real column); only verification mis-sorted. Fixed by ordering on `audit_log.id` (the bigint column).
Added two guards: an "intact with >10 entries" assertion + a "real tamper is still detected with >10
entries" test (SQL-mutate a row → expect `intact:false`) — so the fix can't silently regress and we know
detection still works.
BOUNDARY: New tools are reads only (writes like book_appointment remain to be added as approval tools).
Date handling is UTC-day granularity (tenant-tz nuance deferred). The bug fix is verification-only — no
historical data was corrupted (write path was always correct), but any prior "tamper detected" result
from a ≥10-entry log was a false positive and should be re-checked post-deploy.
GATES: typecheck PASS, build PASS, test 34/34 PASS (added 4: registry exec, per-tool RBAC, bad-date, tamper).

### BL-011 (2026-06-07) — Design-system polish: elevation, focus rings, button states [premium feel, global]
WHAT: Added design tokens to `:root` (`--radius`, `--shadow-sm`, `--shadow`, `--ring`) and applied them
globally: soft card elevation (`box-shadow` on `.card`), primary-button shadow + hover lift + active
press, input focus rings, body font-smoothing, and a keyboard `:focus-visible` ring on every interactive
element (links, buttons, nav items, inputs). All in `styles.css` — zero component JSX changed, so every
screen benefits at once.
WHY/HOW: The leaders (Boulevard/Mangomint) read "premium" largely through restrained elevation and
crisp interaction states; tokenizing shadow/radius/ring makes that consistent and tunable. The
`:focus-visible` rings are a real accessibility win (keyboard nav, P12) that axe doesn't auto-flag but
the manual standard requires. Verified objectively (re-ran the audit: 0 axe violations) and visually
(reviewed the Assistant render — cards now have subtle depth, buttons feel responsive).
BOUNDARY: Global polish only — not a per-screen redesign; individual screens (checkout ticket, books
tables, clinical forms) still get bespoke attention later. No web font added (system stack kept — avoids
a network dependency the sandbox/audit can't load anyway). Light mode only; no theming system yet.
GATES: typecheck PASS, build PASS, test 30/30 PASS, audit 0 axe violations.

### BL-010 (2026-06-07) — UI overhaul #1: sidebar navigation + layout shell [NORTH_STAR #1 begins]
WHAT: Rebuilt the app shell (`apps/web/src/App.tsx` Shell) from a centered, wrapping topnav into a
**left sidebar** layout: brand `<h1>` on top, nav grouped into Front desk / Back office / Setup
(driven by a `NAV` config + a `can` permission map, so gating logic is one place now), user + Sign out
pinned at the bottom, and a `<main className="content">` area (max-width 980, up from 760). New CSS
(`.app-layout`/`.sidebar`/`.nav-group`/`.nav-item`/`.content`) with a responsive collapse < 760px.
WHY/HOW: The BL-009 audit surfaced the topnav overflowing/wrapping with 12 tabs — a real IA defect.
Research (Boulevard/Mangomint/GlossGenius reviews) — the leaders win on clean, premium, app-like
layouts; a grouped left sidebar is the category-standard fix and reads far more "operating system" than a
row of tabs. Kept accessibility intact: single `<main>` landmark, single `<h1>`, `aria-current="page"`
on the active item, `aria-label` on the nav. Verified objectively — re-ran the live-audit harness:
**still 0 axe violations** on all 4 screens — and reviewed the rendered dashboard (grouped nav, active
state, bottom user block; design holds). Also consolidated the old scattered `can*` flags into one map.
BOUNDARY: Layout/nav only — this is the first UI increment, not the full design-system overhaul
(typography scale, spacing tokens, component polish, dark mode, brand identity come next). The old
`.shell`/`.tab` CSS is left in place (harmless, unused) rather than churned out. Mobile collapse is
functional but not deeply tuned. Screens themselves are unchanged inside the new content area.
GATES: typecheck PASS, build PASS, test 30/30 PASS, audit 0 axe violations (topnav-overflow resolved).

### BL-009 (2026-06-07) — Live-audit harness activated + a11y wave to zero [run the app, don't just read it]
WHAT: Replaced the inert audit scaffold with a working harness (`scripts/audit/audit.ts`): spins an
ephemeral Postgres + boots `apps/api/dist`, drives headless Chromium (`@sparticuz/chromium` +
`puppeteer-core`), logs in via `POST /api/auth/setup-owner`, screenshots login + dashboard + the new
Assistant + public booking, runs `@axe-core/puppeteer` on each, and writes PNGs + `findings.json` to
`scripts/audit/out/` (gitignored). First pass: 4 serious + 5 moderate axe violation types. Fixed in a
low-risk wave: darkened `--muted` (#8a8178→#6e6358) and `--accent` (#9a6b4f→#8a5a3e) to clear WCAG-AA
contrast on white and on accent-soft; wrapped login + public pages in `<main>` landmarks; promoted the
brand to `<h1>` (with a CSS reset so it keeps its size). Re-ran → **0 violations on all 4 screens**.
WHY/HOW: Framework Part 5 — static review misses contrast/landmark/heading issues; standing the app up
and running axe gives objective numbers. Verified the deps could launch headless BEFORE building the
harness (P1/P2) — a minimal launch+screenshot smoke first. Fixed objectively (re-ran to confirm the
numbers moved, not just "looks fixed"). Reviewed the actual PNGs (Assistant + dashboard) for visual
integrity after the token changes — design held.
BOUNDARY: Audited 4 screens as the owner role only; per-role + more screens (checkout, books, clinical)
come as the UI grows. Contrast fix was at the token level (covers most text); component one-offs would
surface in future passes. The audit deps are devDeps (heavy) — `npm run audit` is manual, not in CI.
Surfaced but DEFERRED to the UI overhaul: the topnav overflows/wraps with 12 tabs (structural IA, not a
silent fix). Screenshots are artifacts (gitignored), not committed.
GATES: typecheck PASS, build PASS, test 30/30 PASS, **axe 0 violations** (was 9 types).

### BL-008 (2026-06-07) — "Ask Prodigy" assistant + approvals inbox in the web app [the agent becomes usable]
WHAT: New `apps/web/src/Assistant.tsx` — a conversational assistant screen: a message thread that
posts to `/api/ai/agent` and renders the answer plus a transparent per-tool step trail (ran / needs
approval / denied / error, colour-dotted), a live-vs-simulated provider badge from `/api/ai/status`,
and a **pending-approvals inbox** listing `/api/ai/approvals` with Approve/Reject buttons. Added an
"Assistant" nav tab (visible to all authenticated users) + supporting CSS (incl. an `.sr-only` a11y
helper). Web-local TS interfaces mirror the API shapes so no server package leaks into the browser bundle.
WHY/HOW: Research (Microsoft HAX / uxforai / Clockwise) — the **assistive side-panel/screen copilot**
is the right pattern for ongoing support; trust comes from transparency (show the steps + provider
mode) and from confirmation on consequential actions (our approval inbox); "build the tool-calling
layer first" (done in BL-004–007), chat UI last. Kept the voice direct, not faux-human, and made it
explicit the human is in charge. Verified at runtime through the real Express app: server boots,
`agent_approvals` self-heals on boot, `/api/health` 200, and `/api/ai/{status,tools,agent,approvals}`
all return 401 (wired + auth-gated, not 404).
BOUNDARY: No automated UI/DOM test or live screenshot yet — verification is build + a routing/auth
HTTP smoke; the visual + axe pass waits on activating the live-audit harness (B2, next). With no
ANTHROPIC_API_KEY the assistant answers via the simulated seam (the badge says so). No streaming /
conversation persistence yet (each send is one turn; thread is client-side state). The approvals inbox
shows pending only (no decided-history view yet).
GATES: typecheck PASS (incl. web), build PASS (vite + api), test 30/30 PASS, runtime smoke green.

### BL-007 (2026-06-07) — Durable approval queue: human-in-the-loop, end to end [governance for autonomous actions]
WHAT: New `agent_approvals` table (idempotent schema) + `@prodigy/db/approvals.ts` persistence
(`createAgentApproval` / `listAgentApprovals` / `getAgentApproval` / pending-guarded `decideAgentApproval`)
+ `@prodigy/agent/approvals.ts` workflow (`requestApproval`, `listPendingApprovals`, `decideApproval`).
`/api/ai/agent` now persists any proposed-but-unapproved actions; added `GET /api/ai/approvals` and
`POST /api/ai/approvals/:id/{approve,reject}`. 5 live tests (now 30/30).
WHY/HOW: BL-005/006 surfaced approvals in-memory; this makes them durable so a human can decide them
out-of-band (the realistic HITL flow). On approve, the action runs under the APPROVER's authority —
they must hold the tool's permission — and goes through the same `executeTool` choke point (validated →
real db path → audited), so there's exactly one money/permission/audit path whether a human or an agent
initiates (P7/P9). The DB UPDATE is `WHERE status='pending'`, so a decided approval can never
double-execute (verified). Reject closes with no side effect; a denied approve leaves it pending.
BOUNDARY: No conversational UI / approvals-inbox screen yet (API only — that's the next increment).
The new API endpoints are wired + typecheck + build but not yet covered by automated HTTP tests (the
workflow + persistence are fully unit-tested at the package level; HTTP-level coverage waits on the
live-audit harness). `requested_by`/`decided_by` are stored without a users FK (survive user deletion);
they're audit metadata, not joins.
GATES: typecheck PASS, build PASS, test 30/30 PASS (7 money + 5 AI + 8 agent + 5 loop + 5 approvals).

### BL-006 (2026-06-07) — The LLM-driven agent loop over the registry [the Agentic OS now operates]
WHAT: Extended the AI provider seam for tool-use — `AiToolSpec`/`AiToolCall` + text/tool_use/tool_result
content blocks on `AiMessage`, `tools` on the request, `toolCalls` on the result; `SimulatedAiProvider`
now emits deterministic tool calls (a `call:<tool> {json}` directive) and synthesizes a final answer
after tool results; `ClaudeAiProvider` maps the same shapes 1:1 to the Anthropic Messages API. New
`runAgent()` orchestrator (`packages/agent/src/orchestrator.ts`): the manual tool-use loop — offer the
actor's permitted tools, run the model, execute its tool calls via `executeTool`, feed results back,
loop. `POST /api/ai/agent` runs it for one message. 5 loop tests (now 25/25).
WHY/HOW: Web research on agent-loop guardrails (Steve Kinney / aiqnahub / Vellum) converged on
defense-in-depth termination — so the loop has (1) a HARD step cap (1–25, default 8) with an
**early-stopping synthesis** turn (no tools) so the user always gets an answer, (2) a **repeat-call
detector** (same tool+args won't re-run), and (3) natural completion when the model stops calling
tools. Approval-risk tools are surfaced as `needs_approval` and never executed in-loop (pre-execution
approval, from BL-005). Only permitted tools are offered (defense in depth; `executeTool` still
RBAC-checks). Tested entirely through the deterministic simulated provider — no key, no network (P11).
The Claude path is built + typechecked but UNTESTED LIVE (cast at the SDK boundary; runs only with a key).
BOUNDARY: No persisted approval queue yet — `needs_approval` returns the pending calls to the caller;
a human re-invokes with approval (the durable queue + UI is next). `/api/ai/agent` is wired + builds but
not yet covered by an automated HTTP test (the orchestrator logic is fully unit-tested; HTTP-level tests
need the live-audit harness). No streaming; single-message turns (no conversation persistence yet).
GATES: typecheck PASS, build PASS, test 25/25 PASS (7 money + 5 AI + 8 agent + 5 agent-loop).

### BL-005 (2026-06-07) — Agentic-OS runtime: audited, permission-scoped tool registry [the agent's security backbone]
WHAT: New `@prodigy/agent` package — `AgentTool` registry (6 initial tools spanning books, POS, gift
cards, CRM: `get_trial_balance`, `list_accounts`, `list_recent_sales`, `list_gift_cards` [auto/read];
`create_client`, `issue_gift_card` [approval/write]), an `AgentActor` carrying the human's resolved
RBAC permission set, and `executeTool()` — the single choke point: tool-exists → server-side RBAC
(owner⇒all, same keys as humans) → input validation → **pre-execution approval gate** → execute via
the existing db function → tamper-evident audit of every branch. `toolDefinitions(actor)` returns the
catalog with a per-actor `allowed` flag; `/api/ai/tools` exposes it. 8 live tests (now 20/20).
WHY/HOW: Web research (HITL approval patterns — sitepoint/redis/dzone) converged on a hard rule:
**approval must gate BEFORE side effects**, 100% of high-risk actions require it, low-risk auto-runs
under RBAC. So write tools (money/data) return `requires_approval` and DO NOT run until `{approved:true}`;
reads auto-run. Tools call the SAME db functions the UI does (P7/P9 — one money path, one permission
catalog, no parallel source of truth). Audit reuses the existing per-tenant hash chain (resourceType
`agent_tool`) so agent activity is on the same tamper-evident trail as clinical access — additive, no
schema change (P8). Fixed a tsconfig `rootDir` issue (importing @prodigy/db source put files outside
the agent package's rootDir → TS6059; dropped rootDir since the package is noEmit).
BOUNDARY: No LLM loop yet — `executeTool` is driven directly (and by tests), not yet by the model;
the tool-use agent loop over this registry is the next increment. Approvals return a `requires_approval`
envelope but there's no persisted approval queue/UI yet (the caller decides). Audit `detail` includes
serialized input (lives in the gated, sensitive audit log). Tool set is an initial slice, not full coverage.
GATES: typecheck PASS, build PASS, test 20/20 PASS (7 money + 5 AI + 8 agent).

### BL-004 (2026-06-07) — AI core foundation #1: the provider seam [the Agentic-OS differentiator begins]
WHAT: New `@prodigy/ai` workspace package — `AiProvider` interface + types (`provider.ts`), a
deterministic `SimulatedAiProvider` (`simulated.ts`), a live `ClaudeAiProvider` (`claude.ts`, model
`claude-opus-4-8`, SDK lazy-imported), and one `createAiProvider()`/`aiStatus()` factory
(`factory.ts`) that picks live-vs-simulated off `ANTHROPIC_API_KEY`. Wired `/api/ai/status`
(authed) so the app shows whether AI is live or on the inert seam. Added 5 seam tests (now 12/12).
WHY/HOW: Framework P11/A.4 — build the whole system behind inert, swappable integration abstractions
so the entire Agentic OS is buildable+testable with no credential; the integration phase becomes a
config-flip. Provider = Claude per the project's AI-native steer and the loaded claude-api skill
(Opus 4.8, latest/most-capable). The SDK is a node_modules dep kept external by tsup and lazy-imported,
so simulated mode never loads it. Research (framework "≥3 leaders"): modelled the eventual agent
surface on **Zenoti's "AI Workforce"** (9 purpose-built agents — receptionist that books/follows-up,
concierge running the lifecycle autonomously, smart gap-fill, churn→win-back, inventory forecast→
reorder) and **Mangomint** (automation Flows + unified comms; strong automation, not truly agentic).
Our wedge vs both: agents act through audited, permission-scoped tools across ALL THREE layers incl.
real GL + clinical, with human-approval gates — a fusion neither leader offers.
BOUNDARY: This is only the seam — no agent runtime, tool registry, memory, or approval gates yet
(next increments). `ClaudeAiProvider.complete()` is typed + built but UNTESTED LIVE (no key in
sandbox; api.anthropic.com unreachable) — only the simulated path and factory selection are exercised.
Adaptive thinking (`thinking:{type:"adaptive"}`) is intentionally omitted from the create call until
the live agent loop is wired and the SDK version is verified against it — noted to add then.
GATES: typecheck PASS (incl. SDK types + new pkg), build PASS, test 12/12 PASS (7 money + 5 AI seam).

### BL-003 (2026-06-07) — Reproducible quality gate: live-DB test harness + CI + audit scaffold [closes the biggest framework gap]
WHAT: Built `test/` — a zero-dependency runner (`harness.ts`) + an ephemeral-Postgres helper
(`pg-ephemeral.ts`) + a money-path suite (`suites/money.test.ts`, 7 tests) + orchestrator (`run.ts`),
wired as `npm test`. The suite drives REAL code against REAL SQL: POS totals + settlement GL posting,
discount/tip → revenue/gratuities, refund reversal, gift-card issuance + redemption, package
sale/redeem/restore, and tenant isolation (P9) — asserting the trial balance stays balanced at every
checkpoint. Added `.github/workflows/ci.yml` (typecheck+build+test on every push/PR against a Postgres
service via `TEST_DATABASE_URL`), type-gated the test code (`test/tsconfig.json`, folded into
`npm run typecheck`), and scaffolded the inert live-audit harness (`scripts/audit/audit.ts`,
`npm run audit`) defining the Personas×Roles×Aspects matrix + route list.
WHY/HOW: The §7 "live suites" cited per-slice were ad-hoc and never committed — so "tests pass" wasn't
reproducible, the single biggest gap vs framework P2. Now it is, and CI makes it automatic. Two real
bugs found + fixed while standing it up: (1) Postgres refuses to run as root → drop to the `postgres`
user via Node `{uid,gid}` (cleaner than `su`, which hung on PAM in this container); (2) `pg_ctl start`
without `-l` lets the daemonized postmaster inherit spawnSync's stdout/stderr pipes, so spawnSync hangs
forever waiting for EOF — fixed by redirecting the server log with `-l`. Forced `listen_addresses=127.0.0.1`
so packages/db treats the test DB as local (no SSL).
BOUNDARY: Suite covers the money paths first (highest cost-of-error, P4); other domains (scheduling,
clinical, availability, booking) are not yet covered — grow per-increment. Audit harness is inert until
its browser deps are installed (deliberate — keeps install/build/test light until there are surfaces
worth auditing). Tests need a local Postgres (present here) or CI's service.
GATES: typecheck PASS (incl. test/), build PASS, **test 7/7 PASS** against live Postgres, audit scaffold
runs inert (exit 0). All green end-to-end.

### BL-002 (2026-06-07) — Ratify the maximalist Agentic-OS vision + re-baseline metrics [sets the whole architecture]
WHAT: Recorded Bucho's expanded vision in §0.3 (maximalist end-to-end feature absorption + lead with
Agentic AI), the agentic-AI architecture decision (Agentic OS: orchestrator + permission-scoped,
audited domain agents with human-approval gates; Claude behind an inert simulated seam; sequence =
gate → AI core → AI-native everything; multi-vertical architecture, wedge-deep first). Expanded the
backlog (B7 → AI CORE epic; new B-SCOPE directive). Re-baselined the two metrics DOWN (A 22→16%,
B 60→40%) because the target grew, not because anything regressed.
WHY/HOW: Bucho granted full autonomy after this alignment; per P6 (honest reporting) and Part 3 (say
why a metric moves), a bigger denominator must lower the % even with zero code change — over-claiming
here would be the dishonest move. Provider = Claude per the project's AI-native steer + framework P11
(build behind a swappable, simulated-by-default seam) so the agent system is fully buildable with no key.
BOUNDARY: No AI code yet — this is the ratified plan. Metrics are honest estimates. The Claude seam,
agent runtime, and tool registry are designed, not built (next epic after the gate).
GATES: Docs-only increment; typecheck + build unaffected (last green this session). No code changed.

### BL-001 (2026-06-07) — Adopt the Autonomous Build Framework + kickoff alignment [foundation for all future work]
WHAT: Committed `AUTONOMOUS_BUILD_FRAMEWORK.md` to repo root; augmented this Bible (in place) with
§0 — framework adoption, the two-metric tracker (A≈22% / B≈60%), ratified kickoff alignment, the
deferred backlog (B1–B8 + rails), and this BUILD LOG. Ran the kickoff ritual; recorded Bucho's
answers (full autonomy + heavy research mandate; gate-first; augment-in-place).
WHY/HOW: This is a mature 20-slice project, not greenfield — the existing decision log (§1–§10) is the
durable memory the framework prizes, so I augmented rather than overwrote (P7 single source of truth).
Verified the gate actually runs before relying on it: fresh `npm install` → `npm run typecheck` exit 0
→ `npm run build` exit 0.
BOUNDARY: Committed/reproducible test suite + CI do not exist yet (the §7 "live suites" were ad-hoc,
uncommitted) — that's Increment 1 (B1). Metrics are honest estimates, not instrument-measured.
GATES: typecheck PASS (exit 0), build PASS (exit 0). No committed tests yet (by design — next increment).

## 1. What this is
Prodigy ERP — a multi-tenant "wellness operating system" for clinical massage +
esthetics + post-surgical lymphatic businesses. Tenant #1 is **Prodigy Massage and
Wellness** (Carson City, NV; timezone America/Los_Angeles). Goal: replace the
fragmented stack (booking/POS, marketing/SMS/reviews, clinical notes, payroll,
financing, e-commerce) with one platform plus a native AI layer. Multi-tenant from
line one — Prodigy is simply tenant #1. Full vision lives in the project brief.

## 2. Non-negotiables (locked)
- Multi-tenant, shared DB, row-level: `tenant_id` on every business table, indexed; all queries tenant-scoped.
- Money in integer **CENTS**. Rates in **BASIS POINTS** (3.5% = 350 bps; 50% deposit = 5000 bps).
- Timestamps stored UTC, presented in the tenant timezone.
- **Self-healing schema at boot**: idempotent `CREATE TABLE / ADD COLUMN IF NOT EXISTS`. No manual migrations.
- Persistent data lives in the database only (deploy filesystem is ephemeral).
- Append-only audit log for sensitive actions; soft-delete for clinical/financial records.
- Enterprise-grade; every shipped slice is complete, compiling, and demoable.
- Card surcharge is compliance-critical: credit-card only (BIN-gated), capped at the lower of network max and true cost of acceptance, disclosed at checkout. Prodigy's current 3.5% must be brought to the compliant maximum.

## 3. Architecture (as built)
- Monorepo via **npm workspaces** (chosen over pnpm for Replit-native deploys — no corepack step).
- `packages/contracts` — shared TS types + the locked conventions above.
- `packages/db` — Postgres pool (`pg`), self-healing schema, seed, status. Boots gracefully with NO database (degraded mode) so the first deploy is always green.
- `apps/api` — Express (TypeScript), bundled with tsup -> `dist/index.js`. Serves the built web client + `/api/*` + `/api/health`. Single process on `PORT`.
- `apps/web` — React + Vite SPA, built to `apps/web/dist`, served by the API.
- **RBAC (built, slice 3)**: per-tenant roles + a 20-key permission catalog stored as data, Owner-configurable. First-party auth (email+password via Node `scrypt`, server-side sessions in Postgres, httpOnly cookies); provider-agnostic so SSO can plug in later.

## 4. Commands
- Install:   `npm install`
- Typecheck: `npm run typecheck`
- Build:     `npm run build`   (web, then api)
- Start:     `npm run start`   -> `node apps/api/dist/index.js`
- Dev / Replit Run: `npm run dev`  (build + start; single process on `PORT`)

## 5. Deploy loop
GitHub `main` is the single source of truth. Claude edits in its sandbox, verifies
(typecheck + build), pushes to `main`. Owner presses **Pull** then **Publish** in Replit.
Replit Deploy config (confirm in UI): build = `npm install && npm run build`,
run = `npm run start`. Provisioning Replit Postgres sets `DATABASE_URL` and activates
persistence + the seeded tenant on the next Publish.

## 6. Open decisions — DO NOT GUESS; confirm with owner
- ~~Identity provider~~ RESOLVED (slice 3): first-party auth + RBAC built in-house (no external IdP needed now; SSO addable later without changing the permission model).
- Payment processor: **Stripe Connect** (Stripe holds the money-transmitter licenses; platform needs none). Integrate at the payments/POS slice; business connects its own Stripe account. Surcharge stays credit-only, BIN-gated, capped, disclosed.
- SMS: integrate **Twilio** at the marketing slice; sending gated by the business's **A2P 10DLC** brand/campaign registration (carrier registration, ~days–weeks; enforcement live since Feb 2025).
- Product inputs (brief §13): now EDITABLE IN-APP — services / variants / prices / categories / rooms shipped in slice 2; **staff/providers shipped in slice 7** (provider **working hours / availability** still to follow). No longer a build blocker. Still worth collecting Amber's real menu, hours, current software spend, and a data export from her current booking platform for migration.

## 7. Decision log
- 2026-06-02 — Repo `bucho11/amber-prodigy-erp`; GitHub-first bootstrap (code originates in the repo, Replit imports it to deploy).
- 2026-06-02 — npm workspaces over pnpm (Replit-native).
- 2026-06-02 — Express 4 for slice 1 (avoids v5 routing gotchas); revisit when needed.
- 2026-06-02 — Graceful no-DB boot so the first Publish is always green; persistence activates when `DATABASE_URL` is present.
- 2026-06-03 — Brief §13 "drop-in gap" (unknown per-business inputs) resolved by making the catalog editable in-app (slice 2). Doubles as future multi-tenant self-serve onboarding.
- 2026-06-03 — Per-request tenant context: `x-tenant-slug` header → `req.tenant` (defaults to `prodigy`). Seam for real identity later; every catalog query is tenant-scoped.
- 2026-06-03 — Partial updates use a fixed `COALESCE($n::type, col)` pattern (no dynamic SQL); soft-delete via `is_active`. Variant inserts use `INSERT…SELECT … WHERE service belongs to tenant` to enforce tenant ownership.
- 2026-06-03 — **Auth/RBAC approach (slice 3)**: first-party email+password (Node `scrypt`, no native deps), server-side sessions in Postgres (token hashed at rest), httpOnly + SameSite=Lax cookies (Secure unless `ALLOW_INSECURE_COOKIES`). Chosen over an external IdP so the Owner signs up for nothing and the permission model stays fully ours; provider-agnostic for later SSO.
- 2026-06-03 — **Permissions are DATA, Owner-configurable**: 20-key catalog (contracts) bundled into per-tenant roles; defaults (owner/admin/provider/front_desk/accountant/client) seeded with sensible perms ONLY on first creation, so Owner edits survive reboots. Owner role = implicit all-permissions; cannot be limited or removed (last-owner / self-deactivation / only-owner-grants-owner guards).
- 2026-06-03 — **Accounting basis**: accrual is the internal truth (gift cards/memberships/packages are deferred revenue) with a cash-basis reporting toggle. Build the double-entry GL as the system of record (replace QuickBooks); keeping books is not a regulated activity.
- 2026-06-03 — **Regulated capabilities via licensed partners** (research-backed; NOT legal advice — owner to confirm w/ counsel): payments→Stripe Connect; payroll filing→embedded provider (Gusto Embedded/Check file across 50 states — avoid becoming an IRS Reporting Agent/EFIN ourselves); SMS→Twilio+A2P 10DLC; sales tax→own calc/liability/reporting now, auto-filing via Avalara later. We own the niche math + GL posting; partners hold the licenses.
- 2026-06-03 — **HIPAA**: a cash/card massage-wellness business NOT billing insurance electronically is NOT a covered entity; clinical notes alone don't trigger it. Build clinical docs now with HIPAA-grade safeguards (RBAC, encryption, audit logs). Electronic insurance billing + formal HIPAA + BAA = Phase 3, behind "Coming Soon".
- 2026-06-03 — **Phasing rule**: build everything now; anything needing an approval the *owner* must secure ships behind a "Coming Soon" flag with infra fully built, switched on later. Only genuinely-gated item: electronic insurance billing / formal HIPAA.

- 2026-06-03 — **Clients/CRM (slice 4)**: tags are a normalized per-tenant catalog (`tags` + `client_tags`), case-insensitive-unique, get-or-create on attach. Client soft-delete via `status` (active/archived), never hard delete. `notes` is explicitly NON-clinical (front-desk preferences); clinical SOAP notes remain a separate HIPAA-grade slice. Client partial updates use a whitelisted dynamic SET builder that distinguishes absent (leave unchanged) from empty (clear to null).

- 2026-06-03 — **Scheduling (slice 5)**: appointments store UTC timestamps; `ends_at` is persisted (duration = ends−starts, robust to later variant edits) and `price_cents` is snapshotted at booking. Conflict = time-overlap (`starts < other.ends AND ends > other.starts`, strict so adjacent slots are fine) on the same provider, and on the same room when one is set; ignores `cancelled`/`no_show`. Status enum: booked / completed / cancelled / no_show. v1 time UX is browser-local (Amber operates in the tenant tz, Pacific); booking in tenant-tz regardless of the user's location is a later refinement. No provider working-hours yet, so open-slot availability is the next scheduling enhancement.

- 2026-06-03 — **Staff seed = Amber only.** Removed the early placeholder 'Keshia' from the concept per owner: staff seed now seeds just Amber, plus a one-time FK-safe cleanup that deletes a previously-seeded Keshia from existing tenants (skips if she's referenced by an appointment). Prodigy has a team but names are kept generic for now; real staff get added later (staff-ops slice).

- 2026-06-03 — **Auto-protocol scheduler (slice 6 — the post-surgical wedge)**: a reusable **protocol template** is a named sequence of **steps**, each with a `day_offset` from an **anchor date** (= the client's procedure/start date = day 0), an optional per-step `time_of_day`, a service variant, and an optional label. **Applying** a template to a client from an anchor date generates the whole booked series in one action. Key design choices: (a) **anchor-date + day-offset model** so one template fits any procedure date; (b) **server-side timezone conversion** — the generator turns tenant-local wall time into the correct UTC instant via `packages/db/time.ts` (`zonedWallTimeToUtc`, DST-correct through `Intl`), because the server (not the browser) creates these appointments; (c) **conflict-SKIP, not fail** — a step that collides with an existing booking (reusing slice-5 `findConflict` on provider+room) is left unbooked and reported in a `skipped[]` list with a reason; the rest still book (returns `created[]` + `skipped[]`); (d) generated appointments carry a nullable `protocol_instance_id` FK so a plan and its sessions stay linked (added to `appointments` via idempotent `ALTER … ADD COLUMN IF NOT EXISTS`); (e) **instances** snapshot the protocol name at apply time and track status (active/completed/cancelled); **cancelInstance** cancels a plan's still-booked sessions (leaves `completed` ones as history) and frees those slots for re-application. Template writes are transactional (new `withTransaction` helper). Permission-gated `scheduling.view` / `scheduling.manage`. Web: Protocols tab w/ Templates / Active-plans subtabs, a template editor (sessions = day/time/service/label), an apply screen with a live schedule preview + booked/skipped result, and an instance detail w/ cancel. Verified by a 34-case live suite (template CRUD; TZ 10:00 PDT→17:00Z & 14:00 PDT→21:00Z; full conflict-skip [re-apply → all 5 skipped]; partial [pre-booked day-0 → 1 skipped / 4 created]; instance list/detail; cancel cascade; re-apply after cancel; validation; gating).

- 2026-06-03 — **Staff / providers (slice 7)**: `staff_profiles` is the bookable-people table (distinct from `app_users` logins). Extended it (idempotent ALTERs, placed after `app_users` so the FK resolves) with title/email/phone/bio/**color** + a nullable **user_id** linking a provider to a login account (one login ↔ at most one provider, guarded both on create and update). Full CRUD gated `staff.manage` (reuses the existing permission — no catalog churn); `/providers` (active staff) now also returns color and feeds the Calendar + Protocol scheduler. Deactivation just drops a provider from the bookable list (existing appointments keep their FK; no cascade). Update uses the whitelisted dynamic-SET pattern (absent = unchanged, "" = cleared to null). `listLinkableUsers` returns tenant logins not already linked to another provider (optionally including the one a given provider already holds, so the edit form shows it). Web: a **Providers subtab** on the Team page (alongside Logins & roles) — list (color dot, title, linked login, active state) + editor (name/title/color palette/contact/bio/link). Verified by a 29-case live suite (CRUD; whitelist + null-clear; color/email validation; link + double-link/nonexistent guards; linkable-users except-logic; providers reflection incl. color; new provider bookable; deactivate/reactivate; gating). NOTE: provider **working hours / availability** (open-slot logic) and provider↔service mapping are still deferred.

- 2026-06-03 — **Payments / POS (slice 8 — Phase 1 capstone)**: built the sale **system of record** plus a gated Stripe Connect seam. Schema (idempotent, end of applySchema): `tenants` gains `tax_rate_bps` / `stripe_account_id` / `stripe_charges_enabled`; new `orders`, `order_line_items` (kind, qty, unit/amount cents, **taxable**, optional `service_variant_id` + `appointment_id` links), `payments` (method, amount cents, status, processor_ref). Money is integer cents throughout; tax is basis points. **Recompute** runs after every line/discount/tip change: subtotal = Σ amount; tax = round(taxableSubtotal × bps / 10000) on taxable lines at list price; total = max(0, subtotal − discount + tax + tip). (Simplifications, flagged as NOT tax advice: discount does not reduce the tax base; services default non-taxable, products taxable.) `addPayment` is transactional (FOR UPDATE) and auto-flips the order to `paid` + sets `closed_at` once recorded/succeeded payments cover a positive total; cash/external/other record immediately, stripe records `pending` until the webhook. `void` is open-only; `refund` is paid-only (marks its payments refunded). **Stripe Connect** (`apps/api/stripe-connect.ts`) is dependency-free (global `fetch` + `crypto`): `isStripePlatformConfigured()` gates everything on `STRIPE_SECRET_KEY`; connect creates a Standard account + onboarding AccountLink; status-refresh reads `charges_enabled`; the webhook verifies the HMAC-SHA256 signature (`STRIPE_WEBHOOK_SECRET`) and handles `payment_intent.succeeded` / `account.updated`; card charges create a PaymentIntent on the connected account. With no key present every Stripe route returns a clean 503 `comingSoon` (connect/webhook) or a 400 with guidance (attempting a Stripe card payment), and `/payments/config` omits `stripe_card` from available methods. Global error handler now maps by name: OrderNotFoundError→404, OrderClosedError→400, StripeNotConfiguredError→503. `express.json` captures `rawBody` (verify callback) for webhook signatures. Permission-gated `pos.operate` / `financials.view` / `settings.manage`. Web: Checkout tab (New sale → ticket → receipt; Recent sales + detail + refund; Payments setup = tax % + Stripe connect/refresh/status). Verified by a 35-case live suite. **HONEST CONSTRAINT: the live Stripe card-charging path is built but UNTESTED — api.stripe.com is unreachable in the sandbox and Amber hasn't connected an account; only the manual payment methods + the not-configured/guarded behavior are exercised. To go live: set `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET`) in Replit secrets and have Amber complete Stripe onboarding via Payments setup.**

- 2026-06-03 — **Clinical documentation (slice 9 — first Phase 1.5 build)**: client **health intake** (one per client: reason for visit, medical conditions, medications, allergies, surgeries, injuries, pregnancy, pressure preference, areas to avoid, notes) with a **consent-to-treat** acknowledgment + typed signature — the original signing timestamp is preserved across edits and cleared only if consent is withdrawn. **SOAP visit notes** (Subjective / Objective / Assessment / Plan) per client, each with a date, optional provider, and optional link to an appointment. Schema (idempotent, end of applySchema): `client_intake` (PK = client_id, CASCADE on client delete) + `soap_notes`. Access is **permission-gated**: `clinical.view` for reads, `clinical.manage` for writes — verified the split (a view-only role reads but gets 403 on writes; a no-clinical role gets 403 on reads; no cookie → 401). References validated (client exists, provider exists, appointment belongs to the same client); SOAP dates must be YYYY-MM-DD. Web: a **Clinical section on the client profile** (Clients → open a client), shown only to clinical-view users — an intake card (view + edit) and a SOAP list + note editor (date / provider / linked-appointment + S/O/A/P). Also removed a stray "Keshia" placeholder left in the client notes field. Verified by a 26-case live suite. NOTE: this is HIPAA-*grade* handling (strict access control + tenant isolation), not formal HIPAA — electronic insurance billing, a signed BAA, and a clinical-access **audit log** remain later/Phase 3 safeguards.

- 2026-06-03 — **Provider availability (slice 10)**: weekly **working hours** per provider (multiple time ranges per day, stored as minutes-from-local-midnight) and **time off** (a date or date range, all-day or a partial window, optional reason). New `provider_hours` + `provider_time_off` tables (CASCADE on provider delete) and time helpers `utcToZonedParts` / `dayOfWeekFor`. The **availability engine** (`computeAvailability`) takes provider + date + service duration + tenant tz and returns the day's working windows, busy blocks, and **open start-times**: it merges the weekday's windows, subtracts time-off and the provider's existing (non-cancelled) appointments — converting each appointment's UTC start/end into local minutes (DST-correct) — then emits slots on a step (default 15 min) where the full duration fits. Hours/time-off CRUD gated `staff.manage`; `/availability` read gated `scheduling.view`. IMPORTANT: availability is **advisory** — the booking form uses it to suggest open slots, but `createAppointment` was deliberately NOT changed (the only hard guard remains double-booking), so existing flows and the protocol auto-scheduler are unaffected. Web: a working-hours editor + time-off manager on the provider editor (Team → Providers → edit), and an **open-slots picker** in the booking form (pick provider + date + service → tap a time). Verified by a 36-case live suite (hours CRUD; fresh-day slot count; appointment + partial/all-day time-off subtraction; no-hours day; duration sensitivity; multi-range lunch gap; validation; delete; gating).

- 2026-06-03 — **Gift cards (slice 11)**: prepaid stored-value cards, redeemable at checkout. New `gift_cards` (unique code per tenant, initial + balance cents, status, optional client) + `gift_card_txns` (issue/redeem/void ledger, signed amounts, optional order link). Codes are generated from an unambiguous charset (no 0/O/1/I), formatted XXXX-XXXX-XXXX, uniqueness-checked; issuance writes an `issue` ledger entry. **Redemption is a payment method**: POST /orders/:id/payments with method `gift_card` + a `code` runs `payOrderWithGiftCard`, which in ONE transaction locks the order + card (FOR UPDATE), validates active + sufficient balance, records the payment (method gift_card, processor_ref=code), deducts the balance, writes a `redeem` ledger entry, and settles the order if covered — so balance and recorded payment can't drift. Void freezes a card (records a void entry). `/payments/config` now always offers `gift_card`; new `GiftCardError` → 400 in the global handler. Gating: issue/list/get/void gated `sales.manage`; the code `lookup` (for redemption) gated `pos.operate`. Web: a **Gift cards subtab in Checkout** (issue with optional client + note; list; detail with balance, transaction history, void) and a **gift-card option in the ticket's payment methods** (enter code → redeem). Verified by a 26-case live suite (issue + ledger; full + partial redemption; insufficient/void/unknown-code guards; validation; config; gating). NOTE: prepaid **service packages** (credits for a service) and **recurring memberships** (subscriptions — would lean on Stripe) are the remaining pieces of this group, not yet built.

- 2026-06-03 — **Service packages (slice 12)**: prepaid bundles of credits for a service, redeemed at checkout. New `packages` (client_id, service_variant_id, total + remaining credits, price_cents, status) + `package_txns` (issue/redeem/restore/void ledger, signed credits, optional order link), plus `order_line_items.package_id` (added by idempotent ALTER after `packages` exists). Selling writes an `issue` entry. **Redemption is a dedicated action**: POST /orders/:id/redeem-package with {packageId} runs `redeemPackageToOrder`, which in ONE transaction locks the order + package (FOR UPDATE), validates the package is active, has credits, and belongs to the order's client, then adds a **$0 service line** tied to the package (the prepaid service shows on the ticket without changing the total), decrements a credit, and writes a `redeem` ledger entry. Credits are **restored** automatically: `removeLineItem` returns the credit if the removed line had a `package_id`, and `voidOrder` returns credits for every package line on the order (both via `restore` ledger entries) — so a package's remaining count can't drift from what's actually been used. Void freezes a package. New `PackageError` → 400. Gating: sell/list/get/void gated `sales.manage`; a client's redeemable packages (`GET /clients/:id/packages`) and redeem gated `pos.operate`. Web: a **Packages subtab in Checkout** (sell with client + service + credit count + price + note; list; detail with credits, ledger, void) and **package-credit quick-redeem chips in the ticket** (shown when the sale has a client with credits; one tap adds the prepaid line). Verified by a 29-case live suite (sell + ledger; redeem-to-order; restore on line-removal and on void; owner/credit/void guards; validation; gating).

- 2026-06-03 — **General ledger (slice 13)**: double-entry accounting backbone. New `accounts` (chart of accounts: code, name, type, normal_side, is_active; UNIQUE per tenant), `journal_entries` (entry_date, memo, source_type, source_id, reverses_entry_id self-FK), and `journal_lines` (entry_id CASCADE, account_id, debit_cents, credit_cents). A standard 16-account chart is seeded idempotently (1010 Cash, 1200 AR, 1500 Inventory, 2100 Sales Tax Payable, 2150 Gratuities Payable, 2200 Gift Card Liability, 2300 Unearned Package Revenue, 3000 Owner's Equity, 3900 Retained Earnings, 4000 Sales Revenue, 4900 Other Income, 5000 COGS, 6000 Operating Expenses, 6100 Merchant Fees, 6200 Rent & Facilities, 6300 Payroll Expense). `normalSideFor(type)`: asset/expense → debit, others → credit. `createJournalEntry` validates ≥2 lines, each line debit-XOR-credit, debits == credits > 0, and every account exists, inserting entry + lines in one transaction. `trialBalance` sums each account's net (debits − credits), places it on its natural column, skips zero balances, and always returns equal debit/credit totals. **Automatic posting** (in `ledger.ts`, idempotent via source_type+source_id with reverses_entry_id IS NULL, never throws on a missing account — just skips — and every call site is wrapped in try/catch so a books hiccup can never break a sale): order settlement debits Cash (and Gift Card Liability for the gift-card-paid portion) and credits Sales Revenue (net of discount), Sales Tax Payable, and Gratuities Payable; void/refund posts a mirror reversing entry (reverses_entry_id set, guarded against double-reversal); gift-card issuance debits Cash / credits Gift Card Liability; package sale debits Cash / credits Sales Revenue (package redemption posts nothing). **Accounting simplifications (NOT formal accrual):** cash-basis-ish; all payment methods map to Cash 1010 (no card-clearing/undeposited-funds split); package revenue recognized at sale not delivery; gift-card void posts no GL entry; entry dates use the UTC date. NOTE: void-reversal only fires if a settlement exists, and voidable orders are always still open (unpaid), so in practice the refund path is the real reversal trigger. New `LedgerError` → 400. Gating: read (accounts list, journal, trial balance) `financials.view`; write (create/patch accounts, post manual journal) `books.manage`. Web: a **Books nav tab** (gated `financials.view`||`books.manage`) with three subtabs — Trial Balance (account balances + equal totals), Journal (entry list, drill-down to lines, and a balanced manual-entry form with a live debits/credits balance indicator), and Chart of Accounts (list + add). Verified by a 47-case live suite (chart seeding; balanced manual entries + four rejection paths; auto-posting for cash sale with tax+tip, discount-reduces-revenue, gift-card issuance + liability draw-down, refund reversal round-trip, package sale; redemption posts nothing; custom account + dup/bad-type rejection; trial balance balances at every checkpoint; full gating).

- 2026-06-03 — **Inventory (slice 14)**: retail products + stock tracking. New `products` (name, sku, price_cents, cost_cents, taxable, track_inventory, stock_qty, reorder_point, is_active) + `inventory_txns` (signed ledger: receive/adjust/count/sale/return, optional order link) + `order_line_items.product_id` (idempotent ALTER after `products` exists). `AddLineInput` gained `productId`; the line INSERT and `fetchLines` carry it. Creating a tracked product with opening stock writes a `receive` entry. `adjustStock` (receive/adjust/count) moves stock + logs a txn (stock may go negative; non-tracked products reject adjustment). `belowReorder` is computed (tracked && reorder_point > 0 && stock_qty <= reorder_point); `listProducts` supports a `lowStock` filter. **POS integration**: POST /orders/:id/products {productId, quantity} resolves the product server-side (name/price/taxable) and adds a product line linked by product_id (reuses `addLineItem`). **Stock moves on the same settle/refund hooks as the GL**: `applyOrderStockOnSettlement` decrements tracked product lines once at settlement (idempotent via a `sale` txn guard; locks each product row), `restoreOrderStockOnRefund` adds them back on refund (`return` txns, guarded). Both wrapped in try/catch so a stock hiccup never breaks a sale, and both no-op when there are no tracked product lines. Stock decrements at SETTLEMENT, not when a product is added to an open cart, so an unpaid cart holds no stock and line-removal needs no restore. NOTE: inventory is NOT yet posted to the GL (no COGS / inventory-asset entries) — `cost_cents` is captured for margin/future use; auto-COGS is a deliberate later slice. New `InventoryError` → 400. Gating: products list/get `inventory.view`; create/patch/adjust `inventory.manage`; add-to-order `pos.operate`. Web: a new **Inventory nav tab** (gated `inventory.view`||`inventory.manage`) — product list with low-stock badges, add-product form, and a product detail view (current stock, receive/adjust/count control, recent movements, compact edit, activate/deactivate) — plus **retail-product quick-add chips in the checkout ticket** (active products fetched on mount; one tap adds a unit). Verified by a 30-case live suite (create + opening-stock txn; receive/adjust + zero-adjust reject; low-stock filter; sell decrements at settlement with stock unchanged until paid; refund restores; non-tracked product never decrements; bad/inactive product rejected; full gating). All stock expectations in the suite are derived by arithmetic, not hand-computed.

- 2026-06-03 — **Reporting (slice 15)**: read-only business reports. New `reports.ts` (no schema; pure aggregation over existing tables) + `routes-reports.ts`, all gated `reports.view`. `salesSummary(from,to)`: over PAID orders by `closed_at::date` in range — subtotal, discount, net sales (subtotal−discount), tax, tips, total collected, paid count; plus payments-by-method (joined to those orders, recorded/succeeded only) and refunds (status='refunded' in range, by closed date). `incomeSummary(from,to)`: revenue/expense P&L from `journal_lines`→`accounts`→`journal_entries` filtered by `entry_date` in range — revenue = credit balance, expense = debit balance, per-account breakdown + net income. `inventorySnapshot()` (not date-ranged): active tracked product count, stock value at cost and at retail (Σ stock_qty×cost / ×price), out-of-stock count, and the low-stock list. Date range defaults to current month; from/to validated YYYY-MM-DD. Web: a new **Reports nav tab** (gated `reports.view`) with a date-range picker (This month / Last 30 days / This year presets) driving Sales, Income, and Inventory cards. NOTE: refunds are attributed by the order's settlement date (refund date isn't separately stored); income reflects only what's posted to the ledger (so inventory/COGS isn't in it yet, consistent with slice 14). Verified by a 20-case live suite (sales figures incl. discount/tax/tip/refund + payments-by-method; ledger income revenue/expense/net incl. a manual expense; inventory value at cost & retail + low-stock; date-range filter excludes out-of-range; bad-date 400; gating). Expectations derived by arithmetic; a harness-only string bug in the first run was fixed and re-verified clean.

- 2026-06-03 — **Inventory → books / COGS (slice 16)**: closed the inventory↔ledger gap with a perpetual-inventory loop (no schema change; all in `ledger.ts` + hooks). Refactored reversal into a generic `reverseEntryForSource(sourceType)`; `reverseOrderSettlement` and new `reverseOrderCOGS` both delegate to it. New idempotent GL postings (each guarded by source_type + inventory_txn id, try/catch-wrapped so a books hiccup never breaks a stock move): **opening stock** at product creation → Dr Inventory 1500 / Cr Owner's Equity 3000 (`inv_open`); **receiving** stock (`adjustStock` receive) → Dr Inventory / Cr Cash 1010 (`inv_receive`, assumes paid on receipt); **adjust/count** → the value change flows through Operating Expenses 6000 (`inv_adjust`); **sale** (`postOrderCOGS` at settlement, one entry/order = Σ line.qty × product.cost for tracked lines) → Dr COGS 5000 / Cr Inventory 1500 (`cogs`, source_id = orderId); **refund** → `reverseOrderCOGS` mirrors it. Net effect: the Inventory (1500) asset balance now equals stock-at-cost at every step, and the income report's COGS expense line makes net income reflect true product margin — surfaced through the EXISTING Books trial balance + Reports income (no report/UI change needed). Cost basis = the product's CURRENT `cost_cents` at the time of each posting (current-cost method, not FIFO/layers): accurate when cost is stable; a cost change between receipt and sale can drift Inventory vs the snapshot until a count reconciles. Zero-cost or non-tracked products post no COGS/inventory entries. Verified by a 33-case live suite + a 5-case focused check (opening→equity, receive→cash, shrinkage→opex, sale→COGS with Inventory == stock value at every checkpoint, refund reverses COGS + revenue, income shows the COGS line and margin, zero-cost/non-tracked post nothing, trial balance balanced throughout). One harness-only string bug was caught and the assertion re-verified directly green.

- 2026-06-03 — **Recurring memberships (slice 17)**: paid plans + client subscriptions + dues billing. New `membership_plans` (name, price_cents, billing_period 'monthly', discount_bps member benefit, is_active, note), `memberships` (client, plan, status active|paused|cancelled, snapshot price_cents + discount_bps, started_on, current_period_start/end, cancelled_at), and `membership_invoices` (period_start/end, amount_cents, status pending|paid|void, paid_at). Seeded a new account **4100 Membership Revenue** (the idempotent chart seed adds it to tenant #1 on next boot). `memberships.ts`: plan CRUD; `subscribe` snapshots the plan's price + discount onto the membership and opens the first dues invoice for the initial period (a $0 invoice is auto-'paid' with no GL); `listMemberships`/`getMembership` (+invoices); pause/resume/cancel via a status-transition guard (`setStatus` rejects illegal moves, e.g. pause-a-cancelled → 400); `runBilling` generates the next dues invoice for active memberships whose `current_period_end <= CURRENT_DATE` (one period per run, dup-guarded by period_start, advances the period via SQL `interval '1 month'`); `recordInvoicePayment` marks a pending invoice paid and posts Dr Cash 1010 / Cr Membership Revenue 4100 (idempotent via source 'membership_invoice'); `applyMemberDiscount` sets an open order's discount to round(subtotal × member discount_bps) using the existing `updateAdjustments`; `activeMembershipForClient` for the checkout lookup. **Stripe recurring auto-charge is NOT built** (intentionally gated like card payments — the manual/cash dues path is what's functional). New `MembershipError` → 400. Gating: plans/memberships/billing/invoice-pay `sales.manage`; client-membership lookup + apply-member-discount `pos.operate`. Web: a **Memberships nav tab** (Plans subtab: list + add with dues + member-discount %; Members subtab: subscribe, Run-billing button, member list, and a member detail with dues invoices + Record-payment + pause/resume/cancel) + a **member-discount control in the checkout ticket** (shows the member's plan + % and one-tap applies it). Verified by a 34-case live suite + 4-case focused check (plans incl. >100%-discount reject; subscribe + snapshot survives a later plan-price change + first invoice; $0-plan invoice auto-paid no GL; payment + GL to 4100/1010; billing run due/idempotent/skips-paused; member-discount math; no-client + after-cancel rejects; lifecycle guards; gating). Dues recognized as revenue when the invoice is paid (cash-basis), consistent with the rest of the books. (Two harness-only test-string slips were caught and re-verified directly.)

- 2026-06-03 — **Client-facing online booking (slice 18)**: the first PUBLIC, unauthenticated surface (no schema change — reuses existing tables). New `booking.ts` (db) + `routes-public.ts` (no `requireAuth`; tenant resolved from the `x-tenant-slug` header by the existing `resolveTenant`). Endpoints: `GET /public/booking-info` (business name + bookable services [active variants of active services] + bookable providers [active staff]); `GET /public/slots` (open slots for a service+provider+date via the existing `computeAvailability`); `POST /public/book` (instant booking). `publicBook` validates the variant (`getVariantForBooking`), recomputes endsAt from the variant duration, re-checks the requested wall time is a genuine open slot (working hours + time off + existing appts, via `computeAvailability`) AND runs the same `findConflict` double-booking guard the internal calendar uses, then matches-or-creates the client by email (never revealing whether they existed) and writes a 'booked' appointment (notes 'Booked online'). Returns only confirmation data (service, provider, time) — no other client/appt data leaks. New `BookingError` → 400. Web: a fully public `/book` page (`PublicBooking.tsx`, rendered before the auth gate; reads the tenant slug from the path, sends `x-tenant-slug`) — choose service → provider → date → open-slot chips → contact details → on-screen confirmation; a conflict refreshes the slot list. Security posture: only public-safe catalog/provider/slot data is exposed; the booking write is the only mutation, guarded by availability + conflict checks; **no CAPTCHA / rate-limiting** (noted caveat — needs infra) and **no confirmation email/SMS** yet (the Stripe/Twilio-style gate; confirmation is on-screen and the appt appears on the internal calendar immediately). Verified by a 21-case live suite (no-auth info/slots/book, SQL-verified writes, booked-slot-disappears, double-booking 400, off-grid/bad-email/missing-field 400s, unknown-tenant 404, internal endpoints still 401) + a 5-case focused check (two non-overlapping bookings → 2 appts / 1 matched client; overlap correctly blocks 09:15 after a 09:00 hour). One test-design slip (assuming an overlapping slot stayed free) was caught and re-verified — the guard was working as intended.

- 2026-06-03 — **Clinical-access audit log (slice 19)**: a tamper-evident record of who viewed/created/edited clients' clinical records. New `audit_log` table with a per-tenant **hash chain** (each row stores `prev_hash` + `hash = sha256(prev_hash | tenant | actor | action | resource_type | resource_id | client_id | detail | entry_ts)`; `entry_ts` is a dedicated TEXT column holding the exact ISO timestamp folded into the hash so verification is byte-deterministic). `audit.ts`: `recordAudit` appends inside a transaction guarded by `pg_advisory_xact_lock(hashtext('audit:'||tenant))` so concurrent writes can't fork the chain; `listAuditLog` (client filter, paginated, joins client name); `verifyAuditChain` recomputes the whole chain → `{intact, count, brokenAtId?}` (any insert/alter/delete is detected). Instrumented all six clinical routes (best-effort, never blocks the clinical op): GET intake → view/intake; PUT intake → update/intake; POST soap → create/soap (+resourceId); GET soap-list → view/soap_list; GET soap → view/soap; PATCH soap → update/soap — each records actor (id+name from `userOf`) + clientId. Read gated **settings.manage** (the log itself is sensitive). `routes-audit.ts`: GET /audit-log (?clientId,?limit) + GET /audit-log/verify. Web: an **Audit nav tab** (gated settings.manage) listing when/who/action/record/client with a client filter + a "Verify integrity" button. Scope: clinical access only (extendable). Caveat: logging is best-effort (an audit hiccup won't fail a clinical read/write); regulatory-grade guaranteed logging would make it transactional with the op. Verified by an 11-case live suite (events on every path, actor/client captured, all six event types, client filter, chain intact, **SQL tamper detected at the altered row**, gating 403/401) + a 7-case focused re-run (exactly 6 events for 6 accesses; tamper on a different row detected). A test-design slip (an audited endpoint hit twice → off-by-one count) was caught and re-verified.

- 2026-06-03 — **Client self-serve cancel/reschedule (slice 20)**: extends the public booking surface. Added a nullable `manage_token` to `appointments` (unique partial index; set only on online bookings) and an optional `excludeAppointmentId` to `computeAvailability` (so an appointment being rescheduled doesn't block its own near-time slots). `booking.ts`: `publicBook` now mints a 24-byte base64url `manageToken`, stamps it on the appointment, and returns it in the confirmation; new token-based `getBookingByToken` / `cancelBooking` / `rescheduleSlots` / `rescheduleBooking`. Cancel/reschedule require a still-`booked`, future appointment; reschedule re-runs the open-slot check (excluding self) AND `findConflict` (excludeId = the appt) before moving `starts_at`/`ends_at`. Returns only the client's own booking view (service, provider, time, status, canModify) — the token is the authorization, scoped by tenant. `routes-public.ts`: unauthenticated GET /public/booking/:token, POST .../cancel, GET .../slots, POST .../reschedule. Web: a public `/book/manage/<token>` page (`PublicManageBooking.tsx`, before the auth gate) — view, reschedule (date → open slots → confirm), cancel; and the booking confirmation now shows a "Manage or cancel this booking" link to that page (how the client keeps it until email is wired). No email yet (the link is on-screen). Verified by a 14-case live suite (token in confirmation; view; exclude-self shows the current time as reschedulable; reschedule with SQL-verified move; conflict onto another booking → 400; cancel with SQL-verified status; canModify flips; post-cancel reschedule/cancel → 400; bad token → 400; all no-auth) + a 4-case focused check (persisted starts_at moves 09:00→10:00, ends_at stays 60 min). A shell-quoting bug in one SQL assertion's `to_char` was caught and re-verified via epoch.

## 8. Build sequence (Phase 1)
- Slice 1 (SHIPPED): monorepo + API + DB self-heal + seed tenant #1 + status page + deploy loop.
- Slice 2 (SHIPPED): editable service catalog & resources (categories/services/variants/rooms); tenant-scoped CRUD; seeded massage menu ($125/$185/$245); Dashboard + Services & Rooms UI.
- Slice 3 (SHIPPED): **auth + RBAC**. First-party login, first-run Owner setup, invite→accept flow, server-side sessions; per-tenant roles + 20-key permission catalog (Owner-configurable); permission-enforced API (catalog GET requires auth, editing requires `catalog.manage`); web: login/setup screen, accept-invite page, permission-gated nav, Team & Roles admin (invite, change role, deactivate, per-role permission editor, custom roles). Guards: last-owner, self-deactivation, owner-always-full, only-owner-grants-owner. Verified by a 36-case live API suite + reboot-idempotency check.
- Slice 4 (SHIPPED): **clients / CRM**. Client record (name, contact, DOB, pronouns, address, emergency contact, referral source, marketing + SMS consent, non-clinical notes); searchable list; soft archive via `status`; normalized per-tenant **tags** (`tags` + `client_tags`, case-insensitive get-or-create) with attach/detach; permission-gated (`clients.view` read, `clients.manage` write). Web: searchable list w/ tag chips + archived toggle, full profile editor, tag management. Verified by live API suite (CRUD / search / tags / archive / gating) + served-app smoke.
- Slice 5 (SHIPPED): **scheduling / calendar**. Appointments tie client + provider (staff) + optional room + service variant at a UTC time; `ends_at` and `price_cents` computed/snapshotted from the variant. **Double-booking prevention** via time-overlap checks on provider and room (adjacent slots allowed; cancelled/no-show don't block). Book / reschedule / change-service / cancel / complete / no-show; day-range + provider/client queries; `/providers` = active staff. Permission-gated (`scheduling.view` / `scheduling.manage`). Web: day agenda (date nav + provider filter) with status actions + booking/reschedule form with searchable client picker and inline conflict errors. Verified by 30-case live suite.
- Slice 6 (SHIPPED): **auto-protocol scheduler (the wedge)**. Define a reusable recovery protocol (named sequence of sessions, each = day-offset from an anchor/procedure date + service + optional time + label), then **apply** it to a client from an anchor date to auto-book the whole series at once — timezone-correct (server-side `zonedWallTimeToUtc`, DST-safe) and **conflict-skipping** (colliding steps are left unbooked + reported, the rest book; returns created + skipped). Plans (instances) snapshot the protocol name, link their generated appointments via `protocol_instance_id`, and support cancel (cascades to still-booked sessions, frees the slots). Permission-gated (`scheduling.view` / `scheduling.manage`). Web: Protocols tab (Templates / Active-plans), template editor, apply-with-preview, instance detail + cancel. Verified by 34-case live suite.
- Slice 7 (SHIPPED): **staff / providers**. Manage the bookable team — provider profiles (name, title, calendar color, contact, bio) + optional link to a login account (one login ↔ one provider, guarded), activate/deactivate; reuses `staff.manage`. New providers are immediately bookable in the Calendar + Protocol scheduler, and `/providers` returns color. Web: Providers subtab on the Team page (list + editor). Verified by 29-case live suite.
- Slice 8 (SHIPPED — Phase 1 capstone): **payments / POS**. Full point-of-sale system of record — orders with line items (services/products/custom), per-line taxable flag, tenant tax rate (bps), discount + tip, cents-accurate totals, partial→settle payment lifecycle (auto-marks paid + closed), void (open only), refund (paid only). Methods working today: **cash, external card, other**. A complete **Stripe Connect seam** sits behind a config gate (connect/onboarding-link + status-refresh + signature-verified webhook + PaymentIntent on the connected account) and stays "Coming soon" until BOTH `STRIPE_SECRET_KEY` is set AND Amber connects her account. Permission-gated `pos.operate` / `financials.view` / `settings.manage`. Web: Checkout tab (New sale / Recent sales / Payments setup). Verified by 35-case live suite. HONEST CONSTRAINT: the live Stripe card-charging path is built but never exercised against real Stripe (sandbox can't reach api.stripe.com + Amber hasn't connected) — only manual methods + the not-configured behavior are tested.
- **PHASE 1 COMPLETE** — Bucho declared payments/POS the last Phase 1 build (2026-06-03). The eight slices deliver: foundation + self-healing Postgres + deploy loop → editable service menu & rooms → auth + Owner-configurable RBAC → clients/CRM → scheduling/calendar (double-booking prevention) → auto-protocol scheduler (the wedge) → staff/providers → payments/POS.
- Slice 9 (SHIPPED — first Phase 1.5 build): **clinical documentation**. Per-client health intake with consent-to-treat + typed signature (original signing time preserved, cleared if consent withdrawn), and SOAP visit notes (date, optional provider, optional appointment link). Permission-gated `clinical.view` / `clinical.manage`. Web: Clinical section on the client profile. Verified by 26-case live suite. HIPAA-*grade* access control, not formal HIPAA.
- Slice 10 (SHIPPED): **provider availability**. Weekly working hours + time off per provider, and an availability engine computing open booking slots (subtracting existing appointments + time off, DST-correct). Advisory only — the booking form suggests open slots; `createAppointment` is unchanged (double-booking stays the hard guard), so protocols/existing flows are untouched. Gated `staff.manage` (hours/time-off) + `scheduling.view` (availability). Web: hours + time-off editors on the provider page, and an open-slots picker in the booking form. Verified by 36-case live suite.
- Slice 11 (SHIPPED): **gift cards**. Prepaid stored-value cards with a balance ledger, redeemable at checkout as a payment method (atomic: locks order + card, records payment, deducts balance, settles). Issue/manage/void gated `sales.manage`; code lookup gated `pos.operate`. Web: Gift cards subtab in Checkout + a gift-card payment option in the ticket. Verified by 26-case live suite.
- Slice 12 (SHIPPED): **service packages**. Prepaid bundles of service credits, redeemed at checkout as a $0 service line; credits auto-restore when a package line is removed or the sale is voided (atomic, ledger-backed). Sell/manage/void gated `sales.manage`; redeemable-list + redeem gated `pos.operate`. Web: Packages subtab in Checkout + package-credit quick-redeem chips in the ticket. Verified by 29-case live suite.
- Slice 13 (SHIPPED): **general ledger**. Double-entry chart of accounts + balanced journal entries + trial balance, with automatic posting from sales (cash / gift-card-liability split → revenue / tax / tips), void & refund reversal, gift-card issuance, and package sales. Read gated `financials.view`; write gated `books.manage`. Web: Books nav tab (Trial Balance / Journal + manual entry / Chart of Accounts). Cash-basis-ish simplifications noted in the decision log. Verified by 47-case live suite.
- Slice 14 (SHIPPED): **inventory**. Retail products with stock tracking; stock decrements at sale settlement and restores on refund (idempotent, ledger-backed); manual receive/adjust/count; low-stock flagging. Products list/get gated `inventory.view`; create/patch/adjust gated `inventory.manage`; add-to-order gated `pos.operate`. Web: Inventory nav tab + retail product chips in the ticket. Inventory↔GL (COGS) deferred. Verified by 30-case live suite.
- Slice 15 (SHIPPED): **reporting**. Read-only sales summary (net sales/tax/tips/discounts/total + payments-by-method + refunds), ledger income summary (revenue/expense/net), and inventory snapshot (value at cost & retail + low-stock); date-range filtered; gated `reports.view`. Web: Reports nav tab. Verified by 20-case live suite.
- Slice 16 (SHIPPED): **inventory → books / COGS**. Perpetual-inventory loop: opening stock → equity, receipts → cash, adjustments → opex, sale → COGS (Dr 5000 / Cr 1500) at settlement, refund reverses. The Inventory asset now equals stock-at-cost and the income report reflects true product margin. Current-cost basis (simplification noted); surfaces through the existing Books + Reports (no new UI). Verified by 33 + 5-case live suite.
- Slice 17 (SHIPPED): **recurring memberships**. Plans (dues + member-discount benefit), client subscriptions (subscribe/pause/resume/cancel, monthly periods), a dues billing run, recording manual/cash payments (posted to the books via new Membership Revenue 4100), and a member discount applied at checkout. Recurring card auto-charge stays behind the Stripe gate. Gated sales.manage / pos.operate. Web: Memberships nav tab + member-discount control in the ticket. Verified by 34 + 4-case live suite.
- Slice 18 (SHIPPED): **client-facing online booking** (first public surface; no schema change). Public `/book` page + `/public/*` endpoints (no auth, tenant by slug): list services/providers, show open slots, instant-book (validates the slot + reuses the double-booking guard, matches/creates the client by email, writes a 'booked' appt). On-screen confirmation; no email/CAPTCHA yet (noted). `db/booking.ts`, `api/routes-public.ts`, `web/PublicBooking.tsx`. Verified by 21 + 5-case live suite.
- Slice 19 (SHIPPED): **clinical-access audit log**. Hash-chained `audit_log` (tamper-evident); `recordAudit`/`verifyAuditChain`/`listAuditLog`; all six clinical read/write routes instrumented (view/create/update with actor + client); read gated settings.manage. Web: Audit tab with client filter + integrity check. `db/audit.ts`, `api/routes-audit.ts`, `web/Audit.tsx`. Verified by 11 + 7-case live suite.
- Slice 20 (SHIPPED): **client self-serve cancel/reschedule**. `manage_token` on appointments + token-based public view/cancel/reschedule (reuses availability + double-booking guards, excludes self); confirmation shows a manage link. `computeAvailability` gained an optional exclude-self param. `db/booking.ts`, `api/routes-public.ts`, `web/PublicManageBooking.tsx`. Verified by 14 + 4-case live suite.
- Phase 1.5 / Phase 2 candidates (if the build continues): marketing (Twilio/A2P) → embedded payroll (Gusto/Check) → AI layer → online-booking enhancements ("any available" provider, confirmation email/SMS behind the Twilio/email gate, deposits behind Stripe) → extend the audit log to other sensitive areas. Stripe go-live (incl. membership auto-charge), electronic insurance billing, and formal HIPAA/BAA remain owner-secured / gated.

## 9. Phase map (build now vs. "Coming Soon")
Functional NOW via licensed partners (no platform license): card payments/deposits/payouts (Stripe Connect); payroll w/ tax filing (embedded provider); SMS (Twilio, after the business's A2P 10DLC registration); email; clinical docs w/ HIPAA-grade safeguards; gift cards/memberships/packages; inventory/COGS; the accounting GL / system of record; sales-tax calc + liability + filing-ready reports.
GATED → build infra now, ship behind "Coming Soon", owner flips on after securing approvals: **electronic insurance billing + formal HIPAA program + BAA**. (Anything requiring *us* to hold a license — our own payfac / payroll-filer / lender — is avoided by using the partner instead.)
Not a gated feature: income-tax e-filing (hand off to CPA/TurboTax from tax-ready books).

## 10. Vision reframe — North Star v2 (2026-06-04)
Bucho judged the current platform too bland (UI especially) and too shallow vs. the category leader ("Vagaro beats us 100%"). We researched the full niche (Vagaro, Zenoti, Boulevard, Mangomint, GlossGenius, Fresha, Mindbody, Phorest, WellnessLiving on the salon/spa side; Jane, ClinicSense, Noterro, MassageBook on the clinical side; CheckMark, Gusto/ADP, QuickBooks on the books/payroll side) and reframed the North Star. Full living doc: **`NORTH_STAR.md`** (read it at session start alongside the others).

**Reframed North Star:** the first wellness-vertical platform that runs the front of house like the best salon/spa software, charts & bills like the best clinical software, and keeps the books & payroll like real accounting software — AI-native, best-in-class UI, one system. **Key strategic insight: no competitor fuses all three layers** (front-of-house + clinical + real books/payroll); that fusion is our defensible, currently-unoccupied position. Our GL is already deeper than Vagaro's (which only syncs to QuickBooks) and even Zenoti's — a real wedge. Entry wedge = massage/bodywork/wellness-clinical (Amber's world).

**Bucho's locked decisions (2026-06-04):**
- North Star framing: **BOTH — leapfrog (differentiate) first, then parity.**
- First workstream: **UI / design-system overhaul.**
- **LOCKED OPERATING RULE — regulated rails activate LAST, "the very end, before we ship," with Bucho's own accounts.** Covers live card payment processing, SMS/email *sending*, and payroll tax filing / ACH. We may build the software AROUND them earlier (POS UI, comms/campaign engine, payroll calc + paystubs + checks + filing prep) but must NOT wire the live external service / move money / send messages until the final pre-launch step. ALWAYS reference this before building anything that touches those rails.

**Sequence:** (1) UI overhaul → (2) differentiated depth + rail-free parity (comms/marketing engine with sending deferred; clinical depth incl. form builder/e-sign/body charts/superbill prep; back-office depth incl. A/R, A/P+vendors, bank rec, financial statements, period close, payroll calc/paystubs/checks/1099-W2 prep; front-of-house polish incl. deposits/waitlist/classes/website builder/reviews) → (3) regulated rails go-live last.
