import type { Router } from "express";
import {
  listPlans,
  createPlan,
  updatePlan,
  subscribe,
  listMemberships,
  getMembership,
  listMembershipInvoices,
  pauseMembership,
  resumeMembership,
  cancelMembership,
  runBilling,
  recordInvoicePayment,
  activeMembershipForClient,
  applyMemberDiscount,
  clientExists,
} from "@prodigy/db";
import { ValidationError, reqString, optString, optInt, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerMembershipRoutes(api: Router): void {
  // ---- plans ----
  api.get(
    "/membership-plans",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      res.json({ plans: await listPlans(userOf(req).tenantId, { activeOnly: req.query.activeOnly === "true" }) });
    })
  );
  api.post(
    "/membership-plans",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const discountBps = optInt(b.discountBps, "discountBps", 0) ?? 0;
      if (discountBps > 10000) throw new ValidationError("Discount can't exceed 100%.");
      res.status(201).json({
        plan: await createPlan(userOf(req).tenantId, {
          name: reqString(b.name, "name"),
          priceCents: optInt(b.priceCents, "priceCents", 0) ?? 0,
          discountBps,
          note: optString(b.note) ?? null,
        }),
      });
    })
  );
  api.patch(
    "/membership-plans/:id",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Parameters<typeof updatePlan>[2] = {};
      if ("name" in b) patch.name = reqString(b.name, "name");
      if ("priceCents" in b) patch.priceCents = optInt(b.priceCents, "priceCents", 0) ?? 0;
      if ("discountBps" in b) {
        const d = optInt(b.discountBps, "discountBps", 0) ?? 0;
        if (d > 10000) throw new ValidationError("Discount can't exceed 100%.");
        patch.discountBps = d;
      }
      if ("note" in b) patch.note = optString(b.note) ?? null;
      if ("isActive" in b) patch.isActive = Boolean(b.isActive);
      const plan = await updatePlan(userOf(req).tenantId, req.params.id, patch);
      if (!plan) {
        res.status(404).json({ error: "Plan not found." });
        return;
      }
      res.json({ plan });
    })
  );

  // ---- billing run (registered before :id routes) ----
  api.post(
    "/memberships/run-billing",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      res.json(await runBilling(userOf(req).tenantId));
    })
  );

  // ---- memberships ----
  api.post(
    "/memberships",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const clientId = optString(b.clientId);
      if (!clientId) throw new ValidationError("Choose a client.");
      if (!(await clientExists(tid, clientId))) throw new ValidationError("That client doesn't exist.");
      const planId = optString(b.planId);
      if (!planId) throw new ValidationError("Choose a plan.");
      const startedOn = optString(b.startedOn);
      if (startedOn && !DATE_RE.test(startedOn)) throw new ValidationError("startedOn must be YYYY-MM-DD.");
      res.status(201).json({ membership: await subscribe(tid, { clientId, planId, startedOn: startedOn ?? undefined }) });
    })
  );
  api.get(
    "/memberships",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const clientId = typeof req.query.clientId === "string" && req.query.clientId ? req.query.clientId : undefined;
      const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
      res.json({ memberships: await listMemberships(userOf(req).tenantId, { clientId, status }) });
    })
  );
  api.get(
    "/memberships/:id",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const membership = await getMembership(tid, req.params.id);
      if (!membership) {
        res.status(404).json({ error: "Membership not found." });
        return;
      }
      res.json({ membership, invoices: await listMembershipInvoices(tid, req.params.id) });
    })
  );
  const lifecycle = (path: string, fn: (t: string, id: string) => Promise<unknown>) =>
    api.post(`/memberships/:id/${path}`, requireAuth, requirePermission("sales.manage"), wrap(async (req, res) => {
      const m = await fn(userOf(req).tenantId, req.params.id);
      if (!m) {
        res.status(404).json({ error: "Membership not found." });
        return;
      }
      res.json({ membership: m });
    }));
  lifecycle("pause", pauseMembership);
  lifecycle("resume", resumeMembership);
  lifecycle("cancel", cancelMembership);

  // ---- invoices ----
  api.post(
    "/membership-invoices/:id/pay",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      res.json({ invoice: await recordInvoicePayment(userOf(req).tenantId, req.params.id) });
    })
  );

  // ---- checkout-side ----
  api.get(
    "/clients/:id/membership",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      res.json({ membership: await activeMembershipForClient(userOf(req).tenantId, req.params.id) });
    })
  );
  api.post(
    "/orders/:id/apply-member-discount",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      res.json({ order: await applyMemberDiscount(userOf(req).tenantId, req.params.id) });
    })
  );
}
