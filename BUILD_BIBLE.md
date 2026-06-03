# BUILD_BIBLE.md — Prodigy ERP

> Durable decision log. Re-read at the start of every session; update whenever a
> decision is made or a slice ships. This is how a fresh chat rebuilds context
> after the conversation history is truncated.

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
- Product inputs (brief §13): now EDITABLE IN-APP — services / variants / prices / categories / rooms shipped in slice 2; staff + hours to follow. No longer a build blocker. Still worth collecting Amber's real menu, hours, current software spend, and a data export from her current booking platform for migration.

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

## 8. Build sequence (Phase 1)
- Slice 1 (SHIPPED): monorepo + API + DB self-heal + seed tenant #1 + status page + deploy loop.
- Slice 2 (SHIPPED): editable service catalog & resources (categories/services/variants/rooms); tenant-scoped CRUD; seeded massage menu ($125/$185/$245); Dashboard + Services & Rooms UI.
- Slice 3 (SHIPPED): **auth + RBAC**. First-party login, first-run Owner setup, invite→accept flow, server-side sessions; per-tenant roles + 20-key permission catalog (Owner-configurable); permission-enforced API (catalog GET requires auth, editing requires `catalog.manage`); web: login/setup screen, accept-invite page, permission-gated nav, Team & Roles admin (invite, change role, deactivate, per-role permission editor, custom roles). Guards: last-owner, self-deactivation, owner-always-full, only-owner-grants-owner. Verified by a 36-case live API suite + reboot-idempotency check.
- Next candidates: clients/CRM → scheduling engine → auto-protocol scheduler (the wedge) → payments/POS (Stripe Connect) + clinical docs (HIPAA-grade) → accounting/GL ledger (posting engine; system of record) → marketing (Twilio/A2P) → inventory → staff ops + hours → embedded payroll (Gusto/Check) → reporting → AI layer.

## 9. Phase map (build now vs. "Coming Soon")
Functional NOW via licensed partners (no platform license): card payments/deposits/payouts (Stripe Connect); payroll w/ tax filing (embedded provider); SMS (Twilio, after the business's A2P 10DLC registration); email; clinical docs w/ HIPAA-grade safeguards; gift cards/memberships/packages; inventory/COGS; the accounting GL / system of record; sales-tax calc + liability + filing-ready reports.
GATED → build infra now, ship behind "Coming Soon", owner flips on after securing approvals: **electronic insurance billing + formal HIPAA program + BAA**. (Anything requiring *us* to hold a license — our own payfac / payroll-filer / lender — is avoided by using the partner instead.)
Not a gated feature: income-tax e-filing (hand off to CPA/TurboTax from tax-ready books).
