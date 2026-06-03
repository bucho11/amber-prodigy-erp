import type { Router } from "express";
import {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  listLinkableUsers,
  userInTenant,
  userLinkedElsewhere,
} from "@prodigy/db";
import type { UpdateStaffPatch } from "@prodigy/db";
import { ValidationError, reqString, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

function optColor(v: unknown): string | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) throw new ValidationError("Color must be a hex value like #7C3AED.");
  return s;
}
function optEmailVal(v: unknown): string | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new ValidationError("Enter a valid email address.");
  return s;
}

async function validateLink(tenantId: string, userId: string, exceptStaffId?: string): Promise<void> {
  if (!(await userInTenant(tenantId, userId))) throw new ValidationError("That login account doesn't exist.");
  if (await userLinkedElsewhere(tenantId, userId, exceptStaffId))
    throw new ValidationError("That login is already linked to another provider.");
}

export function registerStaffRoutes(api: Router): void {
  api.get(
    "/staff",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
      res.json({ staff: await listStaff(userOf(req).tenantId, { includeInactive }) });
    })
  );

  // Must precede "/staff/:id" so the literal path isn't captured as an id.
  api.get(
    "/staff/linkable-users",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const exceptStaffId = typeof req.query.staffId === "string" && req.query.staffId ? req.query.staffId : undefined;
      res.json({ users: await listLinkableUsers(userOf(req).tenantId, exceptStaffId) });
    })
  );

  api.get(
    "/staff/:id",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const s = await getStaff(userOf(req).tenantId, req.params.id);
      if (!s) {
        res.status(404).json({ error: "Provider not found." });
        return;
      }
      res.json({ staff: s });
    })
  );

  api.post(
    "/staff",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const displayName = reqString(body.displayName, "displayName");
      const userId = optString(body.userId) ?? null;
      if (userId) await validateLink(u.tenantId, userId);
      const staff = await createStaff(u.tenantId, {
        displayName,
        title: optString(body.title) ?? null,
        email: optEmailVal(body.email),
        phone: optString(body.phone) ?? null,
        bio: optString(body.bio) ?? null,
        color: optColor(body.color),
        userId,
      });
      res.status(201).json({ staff });
    })
  );

  api.patch(
    "/staff/:id",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: UpdateStaffPatch = {};
      if ("displayName" in body) patch.displayName = reqString(body.displayName, "displayName");
      if ("title" in body) patch.title = optString(body.title) ?? null;
      if ("email" in body) patch.email = optEmailVal(body.email);
      if ("phone" in body) patch.phone = optString(body.phone) ?? null;
      if ("bio" in body) patch.bio = optString(body.bio) ?? null;
      if ("color" in body) patch.color = optColor(body.color);
      if ("isActive" in body) patch.isActive = Boolean(body.isActive);
      if ("userId" in body) {
        const userId = optString(body.userId) ?? null;
        if (userId) await validateLink(u.tenantId, userId, req.params.id);
        patch.userId = userId;
      }
      const updated = await updateStaff(u.tenantId, req.params.id, patch);
      if (!updated) {
        res.status(404).json({ error: "Provider not found." });
        return;
      }
      res.json({ staff: updated });
    })
  );
}
