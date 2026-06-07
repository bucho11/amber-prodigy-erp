import type { Router } from "express";
import { createVendor, listVendors, createBill, listBills, payBill, payablesSummary } from "@prodigy/db";
import { ValidationError, reqString, optString, reqInt, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = (v: unknown, field: string): string | undefined => {
  const s = optString(v);
  if (s === undefined) return undefined;
  if (!DATE_RE.test(s)) throw new ValidationError(`${field} must be YYYY-MM-DD.`);
  return s;
};

export function registerPayableRoutes(api: Router): void {
  // ---- vendors ----
  api.get(
    "/vendors",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      res.json({ vendors: await listVendors(userOf(req).tenantId, { activeOnly: optString(req.query.active) === "true" }) });
    })
  );

  api.post(
    "/vendors",
    requireAuth,
    requirePermission("books.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const vendor = await createVendor(userOf(req).tenantId, {
        name: reqString(b.name, "name"),
        email: optString(b.email) ?? null,
        phone: optString(b.phone) ?? null,
        notes: optString(b.notes) ?? null,
      });
      res.status(201).json({ vendor });
    })
  );

  // ---- bills ----
  api.get(
    "/bills",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      res.json({ bills: await listBills(userOf(req).tenantId, { status: optString(req.query.status), vendorId: optString(req.query.vendorId) }) });
    })
  );

  api.get(
    "/payables/summary",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      res.json({ summary: await payablesSummary(userOf(req).tenantId, optDate(req.query.asOf, "asOf")) });
    })
  );

  api.post(
    "/bills",
    requireAuth,
    requirePermission("books.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const bill = await createBill(userOf(req).tenantId, {
        vendorId: reqString(b.vendorId, "vendorId"),
        expenseAccountCode: reqString(b.expenseAccountCode, "expenseAccountCode"),
        amountCents: reqInt(b.amountCents, "amountCents", 1),
        billDate: optDate(b.billDate, "billDate"),
        dueDate: optDate(b.dueDate, "dueDate"),
        memo: optString(b.memo) ?? null,
      });
      res.status(201).json({ bill });
    })
  );

  api.post(
    "/bills/:id/pay",
    requireAuth,
    requirePermission("books.manage"),
    wrap(async (req, res) => {
      res.json({ bill: await payBill(userOf(req).tenantId, reqString(req.params.id, "id")) });
    })
  );
}
