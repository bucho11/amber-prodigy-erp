import type { Router } from "express";
import {
  listProtocols,
  getProtocol,
  createProtocol,
  updateProtocol,
  applyProtocol,
  listInstances,
  getInstance,
  cancelInstance,
  listAppointments,
  getVariantForBooking,
  clientExists,
  providerIsActive,
  roomExists,
} from "@prodigy/db";
import type { ProtocolStepInput } from "@prodigy/db";
import { ValidationError, reqString, optString, reqInt, wrap } from "./http";
import { requireAuth, requirePermission, userOf, tenantOf } from "./security";

function reqDate(v: unknown, field: string): string {
  const s = reqString(v, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`'${field}' must be a date (YYYY-MM-DD).`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`'${field}' is not a valid date.`);
  return s;
}
function optTime(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (!/^\d{2}:\d{2}$/.test(s)) throw new ValidationError(`'${field}' must be a time (HH:MM).`);
  const [h, m] = s.split(":").map(Number);
  if (h > 23 || m > 59) throw new ValidationError(`'${field}' must be a valid time (HH:MM).`);
  return s;
}

async function parseSteps(tenantId: string, raw: unknown): Promise<ProtocolStepInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError("Add at least one session to the protocol.");
  const steps: ProtocolStepInput[] = raw.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      dayOffset: reqInt(o.dayOffset, `step ${i + 1} day`, 0),
      timeOfDay: optTime(o.timeOfDay, `step ${i + 1} time`),
      serviceVariantId: reqString(o.serviceVariantId, `step ${i + 1} service`),
      label: optString(o.label) ?? null,
    };
  });
  for (const st of steps) {
    if (!(await getVariantForBooking(tenantId, st.serviceVariantId)))
      throw new ValidationError("One of the selected services isn't available to book.");
  }
  return steps;
}

export function registerProtocolRoutes(api: Router): void {
  // ---- templates ----
  api.get(
    "/protocols",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      res.json({ protocols: await listProtocols(userOf(req).tenantId) });
    })
  );

  api.get(
    "/protocols/:id",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const p = await getProtocol(userOf(req).tenantId, req.params.id);
      if (!p) {
        res.status(404).json({ error: "Protocol not found." });
        return;
      }
      res.json({ protocol: p });
    })
  );

  api.post(
    "/protocols",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = reqString(body.name, "name");
      const description = optString(body.description) ?? null;
      const steps = await parseSteps(u.tenantId, body.steps);
      const protocol = await createProtocol(u.tenantId, { name, description, steps });
      res.status(201).json({ protocol });
    })
  );

  api.patch(
    "/protocols/:id",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: { name?: string; description?: string | null; isActive?: boolean; steps?: ProtocolStepInput[] } = {};
      if ("name" in body) patch.name = reqString(body.name, "name");
      if ("description" in body) patch.description = optString(body.description) ?? null;
      if ("isActive" in body) patch.isActive = Boolean(body.isActive);
      if ("steps" in body) patch.steps = await parseSteps(u.tenantId, body.steps);
      const updated = await updateProtocol(u.tenantId, req.params.id, patch);
      if (!updated) {
        res.status(404).json({ error: "Protocol not found." });
        return;
      }
      res.json({ protocol: updated });
    })
  );

  // ---- apply (generate the series) ----
  api.post(
    "/protocols/:id/apply",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const t = tenantOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const clientId = reqString(body.clientId, "clientId");
      const providerId = reqString(body.providerId, "providerId");
      const anchorDate = reqDate(body.anchorDate, "anchorDate");
      const roomId = optString(body.roomId) ?? null;
      const defaultTime = optTime(body.defaultTime, "defaultTime") ?? "09:00";

      if (!(await clientExists(u.tenantId, clientId))) throw new ValidationError("That client doesn't exist.");
      if (!(await providerIsActive(u.tenantId, providerId))) throw new ValidationError("That provider isn't available.");
      if (roomId && !(await roomExists(u.tenantId, roomId))) throw new ValidationError("That room doesn't exist.");

      const result = await applyProtocol(u.tenantId, t.timezone, {
        protocolId: req.params.id,
        clientId,
        providerId,
        anchorDate,
        roomId,
        defaultTime,
      });
      if (!result) {
        res.status(404).json({ error: "Protocol not found." });
        return;
      }
      res.status(201).json(result);
    })
  );

  // ---- instances ----
  api.get(
    "/protocol-instances",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const clientId = typeof req.query.clientId === "string" && req.query.clientId ? req.query.clientId : undefined;
      res.json({ instances: await listInstances(userOf(req).tenantId, { clientId }) });
    })
  );

  api.get(
    "/protocol-instances/:id",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const instance = await getInstance(u.tenantId, req.params.id);
      if (!instance) {
        res.status(404).json({ error: "Protocol plan not found." });
        return;
      }
      const appointments = await listAppointments(u.tenantId, { protocolInstanceId: req.params.id });
      res.json({ instance, appointments });
    })
  );

  api.post(
    "/protocol-instances/:id/cancel",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const updated = await cancelInstance(userOf(req).tenantId, req.params.id);
      if (!updated) {
        res.status(404).json({ error: "Protocol plan not found." });
        return;
      }
      res.json({ instance: updated });
    })
  );
}
