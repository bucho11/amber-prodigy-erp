import type { Router } from "express";
import {
  getStaff,
  getHours,
  setHours,
  listTimeOff,
  addTimeOff,
  removeTimeOff,
  computeAvailability,
  getVariantForBooking,
} from "@prodigy/db";
import type { WorkingHour } from "@prodigy/contracts";
import { ValidationError, reqString, optString, reqInt, wrap } from "./http";
import { requireAuth, requirePermission, userOf, tenantOf } from "./security";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function ensureProvider(tenantId: string, providerId: string): Promise<void> {
  if (!(await getStaff(tenantId, providerId))) throw new ValidationError("That provider doesn't exist.");
}

export function registerAvailabilityRoutes(api: Router): void {
  // ---- weekly working hours ----
  api.get(
    "/staff/:id/hours",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      await ensureProvider(tid, req.params.id);
      res.json({ hours: await getHours(tid, req.params.id) });
    })
  );

  api.put(
    "/staff/:id/hours",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      await ensureProvider(tid, req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!Array.isArray(body.hours)) throw new ValidationError("'hours' must be an array.");
      const hours: WorkingHour[] = body.hours.map((h, i) => {
        const o = (h ?? {}) as Record<string, unknown>;
        const dayOfWeek = reqInt(o.dayOfWeek, `hours[${i}].dayOfWeek`, 0);
        if (dayOfWeek > 6) throw new ValidationError("Day of week must be 0–6.");
        const startMinute = reqInt(o.startMinute, `hours[${i}].startMinute`, 0);
        const endMinute = reqInt(o.endMinute, `hours[${i}].endMinute`, 0);
        if (endMinute > 1440) throw new ValidationError("Times must fall within a day.");
        if (startMinute >= endMinute) throw new ValidationError("Each time range must start before it ends.");
        return { dayOfWeek, startMinute, endMinute };
      });
      res.json({ hours: await setHours(tid, req.params.id, hours) });
    })
  );

  // ---- time off ----
  api.get(
    "/staff/:id/time-off",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      await ensureProvider(tid, req.params.id);
      res.json({ timeOff: await listTimeOff(tid, req.params.id) });
    })
  );

  api.post(
    "/staff/:id/time-off",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      await ensureProvider(tid, req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const startDate = reqString(body.startDate, "startDate");
      if (!DATE_RE.test(startDate)) throw new ValidationError("startDate must be YYYY-MM-DD.");
      const endDate = optString(body.endDate) ?? startDate;
      if (!DATE_RE.test(endDate)) throw new ValidationError("endDate must be YYYY-MM-DD.");
      if (endDate < startDate) throw new ValidationError("End date can't be before the start date.");
      const allDay = body.allDay === undefined ? true : Boolean(body.allDay);
      let startMinute: number | null = null;
      let endMinute: number | null = null;
      if (!allDay) {
        startMinute = reqInt(body.startMinute, "startMinute", 0);
        endMinute = reqInt(body.endMinute, "endMinute", 0);
        if (endMinute > 1440) throw new ValidationError("Times must fall within a day.");
        if (startMinute >= endMinute) throw new ValidationError("Time off must start before it ends.");
      }
      const timeOff = await addTimeOff(tid, req.params.id, {
        startDate,
        endDate,
        allDay,
        startMinute,
        endMinute,
        reason: optString(body.reason) ?? null,
      });
      res.status(201).json({ timeOff });
    })
  );

  api.delete(
    "/staff/:id/time-off/:offId",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const ok = await removeTimeOff(tid, req.params.id, req.params.offId);
      if (!ok) {
        res.status(404).json({ error: "Time off not found." });
        return;
      }
      res.json({ ok: true });
    })
  );

  // ---- availability (open slots) ----
  api.get(
    "/availability",
    requireAuth,
    requirePermission("scheduling.view"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const providerId = optString(req.query.providerId);
      if (!providerId) throw new ValidationError("providerId is required.");
      await ensureProvider(tid, providerId);
      const date = optString(req.query.date);
      if (!date || !DATE_RE.test(date)) throw new ValidationError("A valid date (YYYY-MM-DD) is required.");

      let durationMinutes: number;
      const svId = optString(req.query.serviceVariantId);
      if (svId) {
        const v = await getVariantForBooking(tid, svId);
        if (!v) throw new ValidationError("That service isn't available.");
        durationMinutes = v.durationMinutes;
      } else {
        durationMinutes = reqInt(req.query.durationMinutes, "durationMinutes", 5);
      }
      const step = req.query.step ? reqInt(req.query.step, "step", 5) : 15;
      const availability = await computeAvailability(tid, providerId, date, durationMinutes, tenantOf(req).timezone, step);
      res.json({ availability });
    })
  );
}
