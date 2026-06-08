import type { Router } from "express";
import { addToWaitlist, listWaitlist, setWaitlistStatus } from "@prodigy/db";
import { reqString, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

export function registerWaitlistRoutes(api: Router): void {
  api.get(
    "/waitlist",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      res.json({ waitlist: await listWaitlist(userOf(req).tenantId, { status: optString(req.query.status) }) });
    })
  );

  api.post(
    "/waitlist",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const entry = await addToWaitlist(userOf(req).tenantId, {
        clientId: reqString(b.clientId, "clientId"),
        serviceVariantId: optString(b.serviceVariantId) ?? null,
        providerId: optString(b.providerId) ?? null,
        preferredWindow: optString(b.preferredWindow) ?? null,
        notes: optString(b.notes) ?? null,
      });
      res.status(201).json({ entry });
    })
  );

  api.post(
    "/waitlist/:id/status",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      res.json({ entry: await setWaitlistStatus(userOf(req).tenantId, reqString(req.params.id, "id"), reqString(b.status, "status")) });
    })
  );
}
