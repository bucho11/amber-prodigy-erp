import type { Router } from "express";
import {
  sellPackage,
  listPackages,
  getPackage,
  listRedeemablePackages,
  voidPackage,
  listPackageTxns,
  redeemPackageToOrder,
  clientExists,
  getVariantForBooking,
} from "@prodigy/db";
import { ValidationError, reqInt, optInt, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

export function registerPackageRoutes(api: Router): void {
  api.post(
    "/packages",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const clientId = optString(b.clientId);
      if (!clientId) throw new ValidationError("Choose a client for the package.");
      if (!(await clientExists(tid, clientId))) throw new ValidationError("That client doesn't exist.");
      const serviceVariantId = optString(b.serviceVariantId);
      if (!serviceVariantId) throw new ValidationError("Choose a service for the package.");
      if (!(await getVariantForBooking(tid, serviceVariantId))) throw new ValidationError("That service isn't available.");
      const totalCredits = reqInt(b.totalCredits, "totalCredits", 1);
      const priceCents = optInt(b.priceCents, "priceCents", 0) ?? 0;
      res.status(201).json({
        package: await sellPackage(tid, { clientId, serviceVariantId, totalCredits, priceCents, note: optString(b.note) ?? null }),
      });
    })
  );

  api.get(
    "/packages",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const clientId = typeof req.query.clientId === "string" && req.query.clientId ? req.query.clientId : undefined;
      res.json({ packages: await listPackages(userOf(req).tenantId, { clientId }) });
    })
  );

  api.get(
    "/packages/:id",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const pkg = await getPackage(tid, req.params.id);
      if (!pkg) {
        res.status(404).json({ error: "Package not found." });
        return;
      }
      res.json({ package: pkg, transactions: await listPackageTxns(tid, req.params.id) });
    })
  );

  api.post(
    "/packages/:id/void",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const pkg = await voidPackage(userOf(req).tenantId, req.params.id);
      if (!pkg) {
        res.status(404).json({ error: "Package not found." });
        return;
      }
      res.json({ package: pkg });
    })
  );

  // A client's redeemable packages (for checkout) — pos.operate.
  api.get(
    "/clients/:id/packages",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      if (!(await clientExists(tid, req.params.id))) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      res.json({ packages: await listRedeemablePackages(tid, req.params.id) });
    })
  );

  // Redeem a package credit onto an order.
  api.post(
    "/orders/:id/redeem-package",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const packageId = optString(b.packageId);
      if (!packageId) throw new ValidationError("packageId is required.");
      const appointmentId = optString(b.appointmentId) ?? null;
      res.status(201).json({ order: await redeemPackageToOrder(tid, req.params.id, packageId, appointmentId) });
    })
  );
}
