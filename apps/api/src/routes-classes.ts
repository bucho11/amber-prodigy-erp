import type { Router } from "express";
import { createClassSession, listClassSessions, getClassSession, listRoster, enrollClient, setEnrollmentStatus } from "@prodigy/db";
import { reqString, optString, reqInt, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

export function registerClassRoutes(api: Router): void {
  api.get(
    "/classes",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      res.json({ classes: await listClassSessions(userOf(req).tenantId, { upcomingOnly: optString(req.query.upcoming) === "true" }) });
    })
  );

  api.post(
    "/classes",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const cls = await createClassSession(userOf(req).tenantId, {
        name: reqString(b.name, "name"),
        providerId: optString(b.providerId) ?? null,
        roomId: optString(b.roomId) ?? null,
        startsAt: reqString(b.startsAt, "startsAt"),
        endsAt: reqString(b.endsAt, "endsAt"),
        capacity: reqInt(b.capacity, "capacity", 1),
      });
      res.status(201).json({ class: cls });
    })
  );

  api.get(
    "/classes/:id/roster",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const id = reqString(req.params.id, "id");
      const cls = await getClassSession(userOf(req).tenantId, id);
      if (!cls) {
        res.status(404).json({ error: "Class not found." });
        return;
      }
      res.json({ class: cls, roster: await listRoster(userOf(req).tenantId, id) });
    })
  );

  api.post(
    "/classes/:id/enroll",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const cls = await enrollClient(userOf(req).tenantId, reqString(req.params.id, "id"), reqString(b.clientId, "clientId"));
      res.json({ class: cls });
    })
  );

  api.post(
    "/enrollments/:id/status",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      await setEnrollmentStatus(userOf(req).tenantId, reqString(req.params.id, "id"), reqString(b.status, "status"));
      res.json({ ok: true });
    })
  );
}
