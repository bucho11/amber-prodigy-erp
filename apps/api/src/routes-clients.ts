import type { Router } from "express";
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  listTags,
  attachTag,
  detachTag,
  type ClientInput,
} from "@prodigy/db";
import { ValidationError, reqString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

type Body = Record<string, unknown>;

/** Present + empty -> null (clear); absent -> undefined (leave unchanged); else trimmed string. */
function strField(body: Body, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v !== "string") throw new ValidationError(`'${key}' must be text`);
  const t = v.trim();
  return t === "" ? null : t;
}
function boolField(body: Body, key: string): boolean | undefined {
  if (!(key in body)) return undefined;
  if (typeof body[key] !== "boolean") throw new ValidationError(`'${key}' must be true or false`);
  return body[key] as boolean;
}
function dateField(body: Body, key: string): string | null | undefined {
  const s = strField(body, key);
  if (s === undefined || s === null) return s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`'${key}' must be a date (YYYY-MM-DD)`);
  return s;
}
function emailField(body: Body, key: string): string | null | undefined {
  const s = strField(body, key);
  if (s === undefined || s === null) return s;
  const lower = s.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) throw new ValidationError("Enter a valid email address.");
  return lower;
}

const TEXT_FIELDS = [
  "firstName",
  "lastName",
  "displayName",
  "phone",
  "pronouns",
  "addressLine1",
  "addressCity",
  "addressState",
  "addressPostal",
  "emergencyContactName",
  "emergencyContactPhone",
  "referralSource",
  "notes",
];

export function registerClientRoutes(api: Router): void {
  api.get(
    "/clients",
    requireAuth,
    requirePermission("clients.view"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      const includeArchived = req.query.includeArchived === "true";
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const clients = await listClients(u.tenantId, {
        search: q,
        includeArchived,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({ clients });
    })
  );

  api.get(
    "/clients/:id",
    requireAuth,
    requirePermission("clients.view"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const client = await getClient(u.tenantId, req.params.id);
      if (!client) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      res.json({ client });
    })
  );

  api.post(
    "/clients",
    requireAuth,
    requirePermission("clients.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Body;
      const firstName = strField(body, "firstName") ?? null;
      const lastName = strField(body, "lastName") ?? null;
      let displayName = strField(body, "displayName") ?? null;
      if (!displayName) displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;
      if (!displayName) throw new ValidationError("Please provide at least a first name.");

      const input: ClientInput = {
        firstName,
        lastName,
        displayName,
        email: emailField(body, "email") ?? null,
        phone: strField(body, "phone") ?? null,
        dateOfBirth: dateField(body, "dateOfBirth") ?? null,
        pronouns: strField(body, "pronouns") ?? null,
        addressLine1: strField(body, "addressLine1") ?? null,
        addressCity: strField(body, "addressCity") ?? null,
        addressState: strField(body, "addressState") ?? null,
        addressPostal: strField(body, "addressPostal") ?? null,
        emergencyContactName: strField(body, "emergencyContactName") ?? null,
        emergencyContactPhone: strField(body, "emergencyContactPhone") ?? null,
        referralSource: strField(body, "referralSource") ?? null,
        marketingOptIn: boolField(body, "marketingOptIn") ?? false,
        smsOptIn: boolField(body, "smsOptIn") ?? false,
        notes: strField(body, "notes") ?? null,
      };
      res.status(201).json({ client: await createClient(u.tenantId, input) });
    })
  );

  api.patch(
    "/clients/:id",
    requireAuth,
    requirePermission("clients.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Body;
      const patch: Record<string, unknown> = {};

      for (const key of TEXT_FIELDS) {
        const v = strField(body, key);
        if (v !== undefined) patch[key] = v;
      }
      const email = emailField(body, "email");
      if (email !== undefined) patch.email = email;
      const dob = dateField(body, "dateOfBirth");
      if (dob !== undefined) patch.dateOfBirth = dob;
      const mkt = boolField(body, "marketingOptIn");
      if (mkt !== undefined) patch.marketingOptIn = mkt;
      const sms = boolField(body, "smsOptIn");
      if (sms !== undefined) patch.smsOptIn = sms;
      if ("status" in body) {
        const s = strField(body, "status");
        if (s !== "active" && s !== "archived") throw new ValidationError("status must be 'active' or 'archived'.");
        patch.status = s;
      }
      if ("displayName" in patch && !patch.displayName) throw new ValidationError("A client name can't be empty.");

      const updated = await updateClient(u.tenantId, req.params.id, patch);
      if (!updated) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      res.json({ client: updated });
    })
  );

  // ---- tags ----
  api.get(
    "/tags",
    requireAuth,
    requirePermission("clients.view"),
    wrap(async (req, res) => {
      const u = userOf(req);
      res.json({ tags: await listTags(u.tenantId) });
    })
  );

  api.post(
    "/clients/:id/tags",
    requireAuth,
    requirePermission("clients.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const name = reqString((req.body ?? {}).name, "name");
      if (name.length > 40) throw new ValidationError("Tag is too long (40 characters max).");
      const tags = await attachTag(u.tenantId, req.params.id, name);
      if (tags === null) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      res.json({ tags });
    })
  );

  api.delete(
    "/clients/:id/tags/:tagId",
    requireAuth,
    requirePermission("clients.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const tags = await detachTag(u.tenantId, req.params.id, req.params.tagId);
      res.json({ tags });
    })
  );
}
