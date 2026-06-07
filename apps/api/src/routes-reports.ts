import type { Router } from "express";
import { salesSummary, incomeSummary, balanceSheet, receivablesAging, inventorySnapshot } from "@prodigy/db";
import { ValidationError, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function range(req: { query: Record<string, unknown> }): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const from = optString(req.query.from) ?? today.slice(0, 8) + "01";
  const to = optString(req.query.to) ?? today;
  if (!DATE_RE.test(from)) throw new ValidationError("from must be YYYY-MM-DD.");
  if (!DATE_RE.test(to)) throw new ValidationError("to must be YYYY-MM-DD.");
  return { from, to };
}

export function registerReportRoutes(api: Router): void {
  api.get(
    "/reports/sales",
    requireAuth,
    requirePermission("reports.view"),
    wrap(async (req, res) => {
      const { from, to } = range(req);
      res.json({ salesSummary: await salesSummary(userOf(req).tenantId, from, to) });
    })
  );

  api.get(
    "/reports/income",
    requireAuth,
    requirePermission("reports.view"),
    wrap(async (req, res) => {
      const { from, to } = range(req);
      res.json({ incomeSummary: await incomeSummary(userOf(req).tenantId, from, to) });
    })
  );

  api.get(
    "/reports/balance-sheet",
    requireAuth,
    requirePermission("reports.view"),
    wrap(async (req, res) => {
      const asOf = optString(req.query.asOf) ?? new Date().toISOString().slice(0, 10);
      if (!DATE_RE.test(asOf)) throw new ValidationError("asOf must be YYYY-MM-DD.");
      res.json({ balanceSheet: await balanceSheet(userOf(req).tenantId, asOf) });
    })
  );

  api.get(
    "/reports/receivables-aging",
    requireAuth,
    requirePermission("reports.view"),
    wrap(async (req, res) => {
      const asOf = optString(req.query.asOf) ?? new Date().toISOString().slice(0, 10);
      if (!DATE_RE.test(asOf)) throw new ValidationError("asOf must be YYYY-MM-DD.");
      res.json({ aging: await receivablesAging(userOf(req).tenantId, asOf) });
    })
  );

  api.get(
    "/reports/inventory",
    requireAuth,
    requirePermission("reports.view"),
    wrap(async (req, res) => {
      res.json({ inventorySnapshot: await inventorySnapshot(userOf(req).tenantId) });
    })
  );
}
