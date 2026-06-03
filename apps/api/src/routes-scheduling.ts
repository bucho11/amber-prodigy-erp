import type { Router } from "express";
import {
  listProviders,
  listAppointments,
  getAppointment,
  createAppointment,
  updateAppointment,
  setAppointmentStatus,
  findConflict,
  getVariantForBooking,
  clientExists,
  providerIsActive,
  roomExists,
  APPOINTMENT_STATUSES,
} from "@prodigy/db";
import type { Conflict } from "@prodigy/db";
import type { AppointmentStatus } from "@prodigy/contracts";
import { ValidationError, reqString, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

function parseWhen(v: unknown, field: string): string {
  const s = reqString(v, field);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`'${field}' must be a valid date and time`);
  return d.toISOString();
}
function optWhen(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return parseWhen(v, field);
}
function addMinutes(isoStart: string, minutes: number): string {
  return new Date(new Date(isoStart).getTime() + minutes * 60000).toISOString();
}
function conflictMessage(c: Conflict): string {
  return c.kind === "provider"
    ? `${c.appointment.providerName} is already booked during that time.`
    : `${c.appointment.roomName ?? "That room"} is already booked during that time.`;
}

export function registerSchedulingRoutes(api: Router): void {
  api.get(
    "/providers",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const u = userOf(req);
      res.json({ providers: await listProviders(u.tenantId) });
    })
  );

  api.get(
    "/appointments",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const from = optWhen(req.query.from, "from");
      const to = optWhen(req.query.to, "to");
      const providerId = typeof req.query.providerId === "string" && req.query.providerId ? req.query.providerId : undefined;
      const clientId = typeof req.query.clientId === "string" && req.query.clientId ? req.query.clientId : undefined;
      res.json({ appointments: await listAppointments(u.tenantId, { from, to, providerId, clientId }) });
    })
  );

  api.get(
    "/appointments/:id",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const appt = await getAppointment(u.tenantId, req.params.id);
      if (!appt) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      res.json({ appointment: appt });
    })
  );

  api.post(
    "/appointments",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const clientId = reqString(body.clientId, "clientId");
      const providerId = reqString(body.providerId, "providerId");
      const serviceVariantId = reqString(body.serviceVariantId, "serviceVariantId");
      const roomId = optString(body.roomId) ?? null;
      const startsAt = parseWhen(body.startsAt, "startsAt");
      const notes = optString(body.notes) ?? null;

      if (!(await clientExists(u.tenantId, clientId))) throw new ValidationError("That client doesn't exist.");
      if (!(await providerIsActive(u.tenantId, providerId)))
        throw new ValidationError("That provider isn't available.");
      if (roomId && !(await roomExists(u.tenantId, roomId))) throw new ValidationError("That room doesn't exist.");
      const variant = await getVariantForBooking(u.tenantId, serviceVariantId);
      if (!variant) throw new ValidationError("That service isn't available to book.");

      const endsAt = addMinutes(startsAt, variant.durationMinutes);
      const conflict = await findConflict(u.tenantId, { providerId, roomId, startsAt, endsAt });
      if (conflict) {
        res.status(409).json({ error: conflictMessage(conflict), conflictAppointmentId: conflict.appointment.id });
        return;
      }
      const appt = await createAppointment(u.tenantId, {
        clientId,
        providerId,
        roomId,
        serviceVariantId,
        startsAt,
        endsAt,
        priceCents: variant.priceCents,
        notes,
      });
      res.status(201).json({ appointment: appt });
    })
  );

  api.patch(
    "/appointments/:id",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const existing = await getAppointment(u.tenantId, req.params.id);
      if (!existing) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }

      const providerId = optString(body.providerId) ?? existing.providerId;
      let roomId: string | null = existing.roomId;
      if ("roomId" in body) roomId = optString(body.roomId) ?? null;
      const variantId = optString(body.serviceVariantId) ?? existing.serviceVariantId;
      const startsAt = optWhen(body.startsAt, "startsAt") ?? existing.startsAt;

      if (providerId !== existing.providerId && !(await providerIsActive(u.tenantId, providerId)))
        throw new ValidationError("That provider isn't available.");
      if (roomId && roomId !== existing.roomId && !(await roomExists(u.tenantId, roomId)))
        throw new ValidationError("That room doesn't exist.");

      let durationMinutes = existing.durationMinutes;
      const patch: Record<string, unknown> = { providerId, roomId, serviceVariantId: variantId, startsAt };
      if (variantId !== existing.serviceVariantId) {
        const variant = await getVariantForBooking(u.tenantId, variantId);
        if (!variant) throw new ValidationError("That service isn't available to book.");
        durationMinutes = variant.durationMinutes;
        patch.priceCents = variant.priceCents;
      }
      const endsAt = addMinutes(startsAt, durationMinutes);
      patch.endsAt = endsAt;
      if ("notes" in body) patch.notes = optString(body.notes) ?? null;

      const conflict = await findConflict(u.tenantId, { providerId, roomId, startsAt, endsAt, excludeId: existing.id });
      if (conflict) {
        res.status(409).json({ error: conflictMessage(conflict), conflictAppointmentId: conflict.appointment.id });
        return;
      }
      const updated = await updateAppointment(u.tenantId, req.params.id, patch);
      res.json({ appointment: updated });
    })
  );

  api.post(
    "/appointments/:id/status",
    requireAuth,
    requirePermission("scheduling.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const status = reqString((req.body ?? {}).status, "status") as AppointmentStatus;
      if (!APPOINTMENT_STATUSES.includes(status)) {
        throw new ValidationError("Invalid status. Use booked, completed, cancelled, or no_show.");
      }
      const updated = await setAppointmentStatus(u.tenantId, req.params.id, status);
      if (!updated) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      res.json({ appointment: updated });
    })
  );
}
