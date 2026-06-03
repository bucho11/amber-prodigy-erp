import type { Router } from "express";
import {
  listAccounts,
  createAccount,
  updateAccount,
  createJournalEntry,
  listJournalEntries,
  getJournalEntry,
  trialBalance,
  ACCOUNT_TYPES,
} from "@prodigy/db";
import type { AccountType, JournalLineInput } from "@prodigy/contracts";
import { ValidationError, reqString, optString, reqInt, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerLedgerRoutes(api: Router): void {
  api.get(
    "/accounts",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      res.json({ accounts: await listAccounts(userOf(req).tenantId, { activeOnly: req.query.activeOnly === "true" }) });
    })
  );

  api.post(
    "/accounts",
    requireAuth,
    requirePermission("books.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const code = reqString(b.code, "code");
      const name = reqString(b.name, "name");
      const type = reqString(b.type, "type") as AccountType;
      if (!ACCOUNT_TYPES.includes(type))
        throw new ValidationError("Type must be asset, liability, equity, revenue, or expense.");
      res.status(201).json({ account: await createAccount(userOf(req).tenantId, { code, name, type }) });
    })
  );

  api.patch(
    "/accounts/:id",
    requireAuth,
    requirePermission("books.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const account = await updateAccount(userOf(req).tenantId, req.params.id, {
        name: optString(b.name),
        isActive: b.isActive === undefined ? undefined : Boolean(b.isActive),
      });
      if (!account) {
        res.status(404).json({ error: "Account not found." });
        return;
      }
      res.json({ account });
    })
  );

  api.get(
    "/journal",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      const limit = req.query.limit ? reqInt(req.query.limit, "limit", 1) : undefined;
      const from = optString(req.query.from);
      const to = optString(req.query.to);
      if (from && !DATE_RE.test(from)) throw new ValidationError("from must be YYYY-MM-DD.");
      if (to && !DATE_RE.test(to)) throw new ValidationError("to must be YYYY-MM-DD.");
      res.json({ entries: await listJournalEntries(userOf(req).tenantId, { limit, from, to }) });
    })
  );

  api.get(
    "/journal/:id",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      const entry = await getJournalEntry(userOf(req).tenantId, req.params.id);
      if (!entry) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      res.json({ entry });
    })
  );

  api.post(
    "/journal",
    requireAuth,
    requirePermission("books.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const entryDate = reqString(b.entryDate, "entryDate");
      if (!DATE_RE.test(entryDate)) throw new ValidationError("entryDate must be YYYY-MM-DD.");
      if (!Array.isArray(b.lines) || b.lines.length < 2) throw new ValidationError("Add at least two lines.");
      const lines: JournalLineInput[] = b.lines.map((l, i) => {
        const o = (l ?? {}) as Record<string, unknown>;
        const accountId = optString(o.accountId);
        if (!accountId) throw new ValidationError(`lines[${i}].accountId is required.`);
        const debitCents = o.debitCents === undefined ? 0 : reqInt(o.debitCents, `lines[${i}].debitCents`, 0);
        const creditCents = o.creditCents === undefined ? 0 : reqInt(o.creditCents, `lines[${i}].creditCents`, 0);
        return { accountId, debitCents, creditCents };
      });
      res.status(201).json({
        entry: await createJournalEntry(userOf(req).tenantId, {
          entryDate,
          memo: optString(b.memo) ?? null,
          sourceType: "manual",
          sourceId: null,
          lines,
        }),
      });
    })
  );

  api.get(
    "/reports/trial-balance",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      res.json({ trialBalance: await trialBalance(userOf(req).tenantId) });
    })
  );
}
