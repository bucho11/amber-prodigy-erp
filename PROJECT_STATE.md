# PROJECT_STATE.md — Prodigy ERP

> Durable state for BUILD MODE. **Source of truth = the live code**; this file is reconciled
> against it at session start and updated as work completes. Companion file `BUILD_BIBLE.md`
> holds the full per-slice decision log + locked conventions; this file is the at-a-glance
> anchor, current position, and path to done.

## 1. Project anchor (the "why" — user owns this; I do not invent it)
- **North Star:** One integrated operating system for massage / wellness practices —
  scheduling, clients, charting, checkout, books, and inventory in one place — replacing the
  patchwork of separate booking, POS, and bookkeeping tools. Prodigy Massage & Wellness
  (owner: Amber, Carson City NV) is tenant #1 and the design partner; the platform is
  multi-tenant from the schema up.
- **Why it must exist:** small wellness businesses run on disconnected tools (one app books,
  another rings up sales, a spreadsheet or third service does the books). Nothing talks to
  anything. This unifies operations so the front desk, the ledger, and stock stay in sync
  automatically, on one tenant-isolated platform.
- **Definition of DONE (overall): TO CONFIRM WITH USER.** Working reconstruction: Phase 1 core
  ops + the prepaid/financial layer (gift cards, packages, general ledger, inventory) are
  done; remaining candidates (reporting, memberships, marketing, payroll, microsite, clinical
  audit log, inventory→GL) are sequenced and shipped on the user's priority. External-dependent
  pieces (Stripe go-live, Twilio/A2P, embedded payroll, formal HIPAA/BAA, electronic insurance
  billing) stay gated until the owner provisions them. *The user owns this definition.*
- **Stack / environment reality:** TypeScript monorepo (npm workspaces). API: Express 4 (Node),
  Postgres via `pg`, bundled by tsup → `apps/api/dist/index.js`. Web: React + Vite
  (`apps/web`), served by the API. Self-healing idempotent schema on boot; money in integer
  cents; rates in basis points; UTC timestamps; `tenant_id` on every table; soft-delete.
  Hosted on Replit (separate dev + prod DBs; on publish choose "Copy development database
  schema & data to production"). GitHub `main` is the source of truth; edits are made + verified
  in a Linux sandbox and pushed; the user taps **Pull + Publish**. The sandbox cannot reach
  Stripe / Twilio, so those paths are wired but untested-live by design.

## 2. Definition of DONE — current phase
- **Current phase: UNDEFINED** — awaiting the user's pick of the next line item (see §5). Last
  shipped: Slice 17 (recurring memberships).
- **Standing per-slice completion bar** (every slice must clear all of these): schema +
  contracts + db module + routes + wiring → typecheck + build green → a live DB test suite
  passing → `BUILD_BIBLE.md` + this file updated → committed + pushed to `main` → plain-language
  report to the user.

## 3. Built & verified
*(Verified 2026-06-03; typecheck + build PASS; live test suites green; working tree clean.
Proof = the files named; all 17 slices are committed to origin/main. The live commit hash is
shown in each reply's BUILD STATUS header.)*
1. Foundation — monorepo, self-healing Postgres, deploy loop. `packages/db/src/index.ts`
2. Auth + owner-configurable RBAC. `db/auth.ts`, `api/routes-auth.ts`, `api/security.ts`
3. Editable service catalog + rooms. `db/catalog.ts`, `web/Services.tsx`
4. Clients / CRM. `db/clients.ts`, `web/Clients.tsx`
5. Scheduling / calendar, double-booking prevention. `db/scheduling.ts`, `web/Schedule.tsx`
6. Auto-protocol scheduler (post-surgical wedge). `db/protocols.ts`, `web/Protocols.tsx`
7. Staff / providers. `db/staff.ts`, `web/Staff.tsx`
8. Payments / POS — orders, cents math, partial→settle, void/refund, cash/card/other; Stripe
   Connect seam GATED + untested-live. `db/payments.ts`, `api/routes-payments.ts`, `web/Checkout.tsx`
9. Clinical docs — intake + consent + SOAP (HIPAA-grade safeguards, not formal HIPAA).
   `db/clinical.ts`, `web/Clinical.tsx`
10. Provider availability — hours + time off + open-slot engine (advisory). `db/availability.ts`, `web/Availability.tsx`
11. Gift cards — prepaid stored value, redeem as payment. `db/giftcards.ts`, `api/routes-giftcards.ts`
12. Service packages — prepaid credits, redeem as $0 line, auto-restore. `db/packages.ts`, `api/routes-packages.ts`
13. General ledger — chart of accounts, balanced journal, trial balance, auto-posting from
    sales (cash / gift-card-liability split → revenue / tax / tips), void/refund reversal,
    gift-card issuance, package sale. `db/ledger.ts`, `api/routes-ledger.ts`, `web/Books.tsx`
14. Inventory — products + stock; decrement at settlement, restore on refund; receive/adjust/
    count; low-stock flagging. `db/inventory.ts`, `api/routes-inventory.ts`, `web/Inventory.tsx`
15. Reporting — read-only sales summary, ledger income summary, inventory snapshot; date-ranged;
    gated `reports.view`. `db/reports.ts`, `api/routes-reports.ts`, `web/Reports.tsx`
16. Inventory → books / COGS — perpetual-inventory GL loop: opening→equity, receive→cash,
    adjust→opex, sale→COGS, refund reverses; Inventory asset = stock-at-cost; margin in income
    report. `db/ledger.ts` + hooks in `db/inventory.ts`, `db/payments.ts`, `db/giftcards.ts`
17. Recurring memberships — plans, subscriptions (pause/resume/cancel), dues billing run,
    manual dues payment → books (Membership Revenue 4100), member discount at checkout; card
    auto-charge gated. `db/memberships.ts`, `api/routes-memberships.ts`, `web/Memberships.tsx`

## 4. Current position
Tree clean, 0 ahead of origin, typecheck + build green. Nothing in progress. Ready to begin the
next phase once the user names it.

## 5. Ordered path to completion (candidates — user picks order)
1. Client-facing microsite / online booking (engine exists; needs a public surface).
2. Clinical-access audit log (fully internal).
3. Marketing — appointment reminders / campaigns; needs Twilio / A2P 10DLC.
4. Embedded payroll — Gusto / Check; external.
- **Gated on owner/external setup:** Stripe go-live, Twilio, payroll, formal HIPAA/BAA, electronic insurance billing.

## 6. PROPOSALS backlog (ideas awaiting the user's call)
- (none open)

## 7. Known boundaries / honest caveats (carried from BUILD_BIBLE)
- Accounting is cash-basis-ish: all payment methods post to Cash 1010; package revenue
  recognized at sale; gift-card void posts no GL entry; inventory uses a current-cost basis
  (not FIFO/layers) and assumes stock is paid for on receipt. Useful bookkeeping, not a CPA substitute.
- Stripe / Twilio paths are wired but never live-tested (sandbox cannot reach them). Recurring
  membership card auto-charge is not built at all (manual/cash dues only); it's gated like card payments.
- Clinical = HIPAA-grade safeguards, NOT formal HIPAA / BAA; no electronic insurance billing.
- Availability open-slots is advisory; the only hard double-booking guard is at booking time.
