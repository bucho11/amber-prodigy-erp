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
- RBAC roles (planned): owner / admin / therapist / front_desk / client.

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
- Identity provider (orgs -> tenants): Clerk / Auth0 / WorkOS / other — not chosen.
- Payment processor + surcharge BIN provider.
- SMS provider + A2P 10DLC registration path.
- Product inputs (brief §13): now EDITABLE IN-APP — services / variants / prices / categories / rooms shipped in slice 2; staff + hours to follow. No longer a build blocker. Still worth collecting Amber's real menu, hours, current software spend, and a data export from her current booking platform for migration.

## 7. Decision log
- 2026-06-02 — Repo `bucho11/amber-prodigy-erp`; GitHub-first bootstrap (code originates in the repo, Replit imports it to deploy).
- 2026-06-02 — npm workspaces over pnpm (Replit-native).
- 2026-06-02 — Express 4 for slice 1 (avoids v5 routing gotchas); revisit when needed.
- 2026-06-02 — Graceful no-DB boot so the first Publish is always green; persistence activates when `DATABASE_URL` is present.
- 2026-06-03 — Brief §13 "drop-in gap" (unknown per-business inputs) resolved by making the catalog editable in-app (slice 2). Doubles as future multi-tenant self-serve onboarding.
- 2026-06-03 — Per-request tenant context: `x-tenant-slug` header → `req.tenant` (defaults to `prodigy`). Seam for real identity later; every catalog query is tenant-scoped.
- 2026-06-03 — Partial updates use a fixed `COALESCE($n::type, col)` pattern (no dynamic SQL); soft-delete via `is_active`. Variant inserts use `INSERT…SELECT … WHERE service belongs to tenant` to enforce tenant ownership.

## 8. Build sequence (Phase 1)
- Slice 1 (SHIPPED): monorepo + API + DB self-heal + seed tenant #1 + status page + deploy loop.
- Slice 2 (SHIPPED): service catalog & resources — editable categories / services / variants (prices) / rooms; tenant-scoped CRUD API; self-healing schema extended; seeded Prodigy massage menu ($125/$185/$245); two-tab web UI (Dashboard + Services & Rooms).
- Next candidates: identity/auth (pick provider) + clients/CRM -> scheduling engine -> auto-protocol scheduler (the wedge) -> payments/POS -> clinical docs -> marketing -> inventory -> staff ops + hours -> reporting -> AI layer.
