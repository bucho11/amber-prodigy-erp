# NORTH_STAR.md — Prodigy ERP Vision & Competitive Strategy

_Living strategy doc. Companion to `PROJECT_STATE.md` (state), `BUILD_BIBLE.md` (decision log),
and `LAUNCH_READINESS.md` (go-live). Last major update: vision reframe after Vagaro/CheckMark +
full-landscape research._

---

## The reframed North Star

> **The first wellness-vertical platform that runs the front of house like the best salon/spa
> software, charts and bills like the best clinical software, and keeps the books and payroll like
> real accounting software — AI-native, with a best-in-class UI — in one system.**

We are building an **ERP for wellness/bodywork practices**: everything, end to end. The bar is the
category leaders, and we intend to **(1) leapfrog them on a differentiated axis, then (2) reach
feature parity** — in that order.

Entry wedge: **massage / bodywork / wellness-clinical practices** (Amber's world), where the salon
platforms are clinically shallow and the clinical platforms are weak on business/marketing/books.
Win that wedge, then broaden toward full salon/spa/med-spa/fitness.

---

## LOCKED OPERATING RULES (always reference)

1. **Regulated external rails are activated LAST — at the very end, right before ship — and only
   with Bucho's own accounts.** This covers: **live card payment processing**, **SMS/email
   sending**, and **payroll tax filing / ACH**. We may BUILD the software around them earlier
   (POS UI, comms/campaign engine, payroll calc + paystubs + checks, filing prep), but we do NOT
   wire the live external service / move money / send messages until the final pre-launch step.
   Bucho will bring the accounts then.
2. **First workstream = UI / design-system overhaul.** Highest leverage for perceived quality;
   fully in our control.
3. **Differentiate, don't just clone.** Feature-for-feature parity with a 17-year incumbent + its
   marketplace moat is a losing race on its own. We win by fusing three layers nobody fuses.
4. All prior build discipline still applies (see `BUILD_BIBLE.md`): live code is truth; verify
   before claiming; per-slice completion bar; honest caveats.

---

## The competitive landscape — who sets the bar on each axis

_From research (2026). Each names the bar we must clear on that dimension._

- **Vagaro** — breadth + affordability + consumer **marketplace** (20M+) + payroll & booth-rent.
  The parity baseline. Weakness: no real accounting (syncs to QuickBooks), shallow clinical.
- **Zenoti** — the enterprise **"everything ERP,"** AI-driven (dynamic pricing, abandoned-cart
  recovery, smart add-on suggestions), multi-location, EMR + HIPAA/BAA; explicitly replaces
  8–12 tools (scheduling, POS, marketing automation, SMS/reputation, payroll, tips, analytics).
  Closest thing to our "everything" vision — but enterprise-priced ($200–600+/loc/mo), complex,
  steep learning curve, and still **not a real general-ledger accounting system.**
- **Boulevard** — premium **UX**, Precision Scheduling, integrated POS, two-way messaging,
  marketing/loyalty, digital forms, memberships. The high-end design/experience bar.
- **Mangomint** — highest-rated; **operational excellence + automation**, intelligent waitlist,
  best-in-class support, modern UX. The "delightful modern UX + automation" bar.
- **GlossGenius** — solo/**mobile-first**, beautiful design, integrated payments, targeted
  marketing. The gorgeous-on-a-phone + payments bar.
- **Fresha** — **free**, marketplace-driven, monetized via payments/marketing. The pricing-model +
  acquisition bar.
- **Mindbody** — class/fitness scheduling at scale + marketplace; dated, overwhelming UI (our
  opening).
- **Phorest** — marketing/loyalty/**reputation** + branded app. The retention-marketing bar.
- **Jane** — multidisciplinary **clinical**: charting with 1,000+ templates, body charts,
  dictation, narratives/smart phrases; **insurance billing, superbills, direct billing**;
  telehealth; HIPAA/PIPEDA/GDPR; Jane Payments. The clinical/health bar.
- **ClinicSense** — massage-specific SOAP + intake (EMR), client/insurance billing, superbills in
  seconds, reminders, HIPAA, tax-ready exports. The massage-clinic bar.
- **Noterro** — **AI/predictive charting**, AI note-taker, branded client app, clean minimal UI.
  The AI-charting bar.
- **CheckMark** — real back office: **Payroll** (federal + 50-state tax tables, ACH direct deposit,
  MICR checks, W-2/W-3/941/940/944/943, 1099 e-file via IRS FIRE, employee self-service, PTO,
  garnishments/401k) + **MultiLedger** (GL, A/R, A/P, inventory, job costing, bank reconciliation,
  financial statements, 1099/1096, multiple sales-tax categories, period locking). The real
  books/payroll bar.
- **Gusto / ADP** — modern automated payroll (multi-jurisdiction filing, benefits, self-onboarding).

**Key insight:** _No single competitor fuses all three layers._ Salon/spa platforms own
front-of-house; clinical platforms own charting + insurance; accounting/payroll tools own real
books + payroll. The pinnacle position is the **fusion** — and it is currently unoccupied.

---

## Our three-layer model (the thing to be best at)

1. **Front of house** (match Vagaro/Boulevard/Mangomint/Zenoti): scheduling, online booking +
   marketplace presence, POS, memberships/packages/gift cards, marketing + comms + loyalty, forms,
   classes, website/branded app, reviews/reputation, AI growth tools.
2. **Clinical** (match Jane/ClinicSense/Noterro): rich charting (templates, body charts, dictation,
   AI/predictive notes), intake/consent/forms + e-sign, **insurance billing + superbills**,
   telehealth, HIPAA-grade + BAA path. _(We already have a tamper-evident clinical audit log —
   ahead here.)_
3. **Back office** (match CheckMark/Gusto + exceed Vagaro): real double-entry GL _(already built —
   our wedge)_, A/R + A/P + vendors + bill pay, bank reconciliation, financial statements
   (Balance Sheet / P&L / Cash Flow), period close, **full payroll** (calc → paystubs → checks →
   tax filing), 1099/W-2, booth-rent/contractor management.

Cross-cutting: **AI core** (the differentiator Bucho wants) and **best-in-class UI** (workstream #1).

---

## Build sequence (leverage-ordered; rails last)

1. **UI / design-system overhaul** — make it look and feel state-of-the-art. _(NOW)_
2. **Differentiated depth + parity that needs no external rails**, roughly:
   - Comms + marketing **engine** (campaign builder, automations, templates, loyalty, AI copy) —
     built now, **sending deferred** to rails step.
   - Clinical depth (form builder + e-sign, richer charting, body charts, superbills/insurance prep).
   - Back-office depth (A/R, A/P + vendors, bank rec, financial statements, period close, payroll
     calc + paystubs + checks + 1099/W-2 prep).
   - Front-of-house polish (deposits, waitlist, classes, website builder, reviews, resources).
3. **Regulated rails — VERY END, before ship, with Bucho's accounts:** payments go-live, SMS/email
   sending, payroll ACH + tax filing.

---

## Open / to refine
- Exact entry-wedge scope (massage-clinical first vs. broader salon/spa from the start).
- Pricing/packaging and whether this stays single-tenant (Amber) or becomes multi-tenant SaaS.
- How deep the AI core goes, and where it shows up first.
- Marketplace/discovery: a real network-effects problem, not just a feature — decide if/when.
