# LAUNCH_READINESS.md — Prodigy ERP

_Pre-launch readiness for **Prodigy Massage & Wellness** (tenant `prodigy`)._
_Snapshot verified against the code at commit `eff3104` (20 slices shipped). Update as things change._

This is the go-live companion to `PROJECT_STATE.md` (state) and `BUILD_BIBLE.md` (decision log).
Treat the checkboxes as a working list.

---

## 1. Works today — zero setup

The entire internal core runs out of the box, and the app ships seeded with Amber as owner, a sample
"Therapeutic Massage" service (60/90/120 min at $125/$185/$245), a 17-account chart of accounts, and the
default roles.

- Scheduling with hard double-booking prevention; auto-protocol scheduling
- Clients / CRM; clinical charting (intake + SOAP notes)
- Checkout / POS — cash, external card, gift card, package, other (Stripe card is gated; see §4)
- Gift cards; prepaid service packages
- General ledger + trial balance with automatic posting (sales, tax, tips, gift cards, packages, COGS, dues)
- Perpetual inventory with COGS → margin in the income report
- Reporting — sales, income, inventory snapshots
- Memberships — plans, subscriptions, dues billing run, member discount at checkout (manual dues)
- Public booking page at **`/book`** with self-serve cancel/reschedule (manage link per booking)
- Tamper-evident clinical-access audit log (admin "Audit" tab)

---

## 2. Must configure in-app before launch (no external accounts)

- [ ] **Set the sales tax rate.** `tenants.tax_rate_bps` defaults to **0** — every sale rings up tax-free
      until you set it. Confirm with your accountant which lines are taxable (retail products vs. services).
- [ ] **Set working hours for every provider** (Availability). Open slots come entirely from `provider_hours`;
      with none set, `/book` shows no times and the internal slot finder is empty. **Most common "it's broken" cause.**
- [ ] **Replace the seeded sample** with your real service menu, variants, prices, and rooms.
- [ ] **Add real staff/providers and send login invites;** review the default role permissions per person.
- [ ] **Confirm business name + timezone** (timezone drives all slot math; currently America/Los_Angeles).

---

## 3. Production / deploy settings (critical)

- [ ] **Publish-data switch.** Pre-launch, "Copy your development database schema & data to production" on a
      schema-changing publish is correct. **The moment real bookings/clients/sales exist in production, stop
      doing that** (it overwrites prod with dev) and use the non-destructive publish. *This is the single most
      dangerous go-live gotcha.*
- [ ] **Secure cookies.** Sessions are `httpOnly` + `sameSite=lax` + `secure` unless `ALLOW_INSECURE_COOKIES="true"`.
      Production is secure-by-default — just ensure that env var is **not set** in the Replit production environment.
- [ ] **`APP_URL`** points at the live domain (used by the Stripe Connect flow).
- [ ] **Database backup/restore** path confirmed.

---

## 4. Gated — needs an external account to turn on

_Built as seams, never live-tested because the build sandbox can't reach these services._

- [ ] **Stripe** — set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Until then, Stripe card payments,
      Stripe Connect onboarding, membership **auto-charge**, and booking **deposits** return a "not configured"
      503. Everything else in checkout works without it.
- [ ] **Messaging — Twilio (SMS) + an email provider.** Nothing is wired today beyond an `sms_opt_in` flag on
      clients. So there are **no** appointment reminders, **no** booking/confirmation emails or texts, and **no**
      marketing sends. The booking confirmation and the self-serve manage/cancel link are **on-screen only**
      until this is built.

---

## 5. Pre-launch smoke test (run on production after §2–§3)

- [ ] Set tax rate + one provider's hours
- [ ] Ring a real sale → confirm the total, then confirm the trial balance balances
- [ ] Book yourself through `/book`
- [ ] Open the manage link → reschedule, then cancel
- [ ] Confirm both changes reflect on the internal calendar
- [ ] Run the sales + income reports for the day
- [ ] Open the Audit tab → "Verify integrity"

---

## 6. Known limitations — go in with eyes open (not blockers)

- **Accounting** is cash-basis-ish (all payment methods post to Cash 1010; package & membership-dues revenue
  recognized at sale/payment; gift-card void posts no GL; inventory uses current-cost, not FIFO). A useful
  bookkeeping layer, **not a CPA substitute**.
- **Clinical** records have HIPAA-*grade* safeguards but this is **not** a formal HIPAA/BAA arrangement, and there
  is no electronic insurance billing. The audit log records best-effort.
- **Public booking** has no CAPTCHA / rate-limiting; the manage link is unguessable but anyone holding it can
  manage that one booking.
- **Membership dues** are manual (no card auto-charge yet).
- **Open-slot suggestions** are advisory; the hard double-booking guard runs at booking time.

---

## Bottom line

Launch-ready for an **in-person, cash / external-card practice today** once tax, hours, and the real menu are
set and the production-data switch is understood. **Card-online** and any **reminders/confirmations** are the
two capabilities that need your external accounts (Stripe, Twilio/email) before they light up.
