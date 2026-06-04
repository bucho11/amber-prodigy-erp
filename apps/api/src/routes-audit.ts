import type { Router } from "express";
import { listAuditLog, verifyAuditChain } from "@prodigy/db";
import { wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

export function registerAuditRoutes(api: Router): void {
  api.get(
    "/audit-log",
    requireAuth,
    requirePermission("settings.manage"),
    wrap(async (req, res) => {
      const clientId = typeof req.query.clientId === "string" && req.query.clientId ? req.query.clientId : undefined;
      const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || undefined : undefined;
      res.json({ entries: await listAuditLog(userOf(req).tenantId, { clientId, limit }) });
    })
  );

  api.get(
    "/audit-log/verify",
    requireAuth,
    requirePermission("settings.manage"),
    wrap(async (req, res) => {
      res.json(await verifyAuditChain(userOf(req).tenantId));
    })
  );
}
