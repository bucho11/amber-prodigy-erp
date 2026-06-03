import type { Router } from "express";
import {
  getIntake,
  upsertIntake,
  listSoapNotes,
  getSoapNote,
  createSoapNote,
  updateSoapNote,
  appointmentBelongsToClient,
  clientExists,
  getStaff,
} from "@prodigy/db";
import type { UpdateSoapPatch } from "@prodigy/db";
import { ValidationError, reqString, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerClinicalRoutes(api: Router): void {
  // ---- intake ----
  api.get(
    "/clients/:id/intake",
    requireAuth,
    requirePermission("clinical.view"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      if (!(await clientExists(tid, req.params.id))) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      res.json({ intake: await getIntake(tid, req.params.id) });
    })
  );

  api.put(
    "/clients/:id/intake",
    requireAuth,
    requirePermission("clinical.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      if (!(await clientExists(tid, req.params.id))) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const pregnant = b.pregnant === null || b.pregnant === undefined || b.pregnant === "" ? null : Boolean(b.pregnant);
      const intake = await upsertIntake(tid, req.params.id, {
        reasonForVisit: optString(b.reasonForVisit) ?? null,
        medicalConditions: optString(b.medicalConditions) ?? null,
        medications: optString(b.medications) ?? null,
        allergies: optString(b.allergies) ?? null,
        surgeries: optString(b.surgeries) ?? null,
        injuries: optString(b.injuries) ?? null,
        pregnant,
        pressurePreference: optString(b.pressurePreference) ?? null,
        areasToAvoid: optString(b.areasToAvoid) ?? null,
        notes: optString(b.notes) ?? null,
        consentToTreat: Boolean(b.consentToTreat),
        signatureName: optString(b.signatureName) ?? null,
      });
      res.json({ intake });
    })
  );

  // ---- SOAP notes ----
  api.get(
    "/clients/:id/soap-notes",
    requireAuth,
    requirePermission("clinical.view"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      if (!(await clientExists(tid, req.params.id))) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      res.json({ notes: await listSoapNotes(tid, req.params.id) });
    })
  );

  api.post(
    "/clients/:id/soap-notes",
    requireAuth,
    requirePermission("clinical.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const clientId = req.params.id;
      if (!(await clientExists(tid, clientId))) {
        res.status(404).json({ error: "Client not found." });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const date = reqString(b.date, "date");
      if (!DATE_RE.test(date)) throw new ValidationError("Date must be in YYYY-MM-DD format.");
      const providerId = optString(b.providerId) ?? null;
      if (providerId && !(await getStaff(tid, providerId))) throw new ValidationError("That provider doesn't exist.");
      const appointmentId = optString(b.appointmentId) ?? null;
      if (appointmentId && !(await appointmentBelongsToClient(tid, appointmentId, clientId)))
        throw new ValidationError("That appointment isn't for this client.");
      const note = await createSoapNote(tid, {
        clientId,
        appointmentId,
        providerId,
        date,
        subjective: optString(b.subjective) ?? null,
        objective: optString(b.objective) ?? null,
        assessment: optString(b.assessment) ?? null,
        plan: optString(b.plan) ?? null,
      });
      res.status(201).json({ note });
    })
  );

  api.get(
    "/soap-notes/:id",
    requireAuth,
    requirePermission("clinical.view"),
    wrap(async (req, res) => {
      const n = await getSoapNote(userOf(req).tenantId, req.params.id);
      if (!n) {
        res.status(404).json({ error: "Note not found." });
        return;
      }
      res.json({ note: n });
    })
  );

  api.patch(
    "/soap-notes/:id",
    requireAuth,
    requirePermission("clinical.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const existing = await getSoapNote(tid, req.params.id);
      if (!existing) {
        res.status(404).json({ error: "Note not found." });
        return;
      }
      const patch: UpdateSoapPatch = {};
      if ("date" in b) {
        const d = reqString(b.date, "date");
        if (!DATE_RE.test(d)) throw new ValidationError("Date must be in YYYY-MM-DD format.");
        patch.date = d;
      }
      if ("providerId" in b) {
        const pid = optString(b.providerId) ?? null;
        if (pid && !(await getStaff(tid, pid))) throw new ValidationError("That provider doesn't exist.");
        patch.providerId = pid;
      }
      if ("appointmentId" in b) {
        const aid = optString(b.appointmentId) ?? null;
        if (aid && !(await appointmentBelongsToClient(tid, aid, existing.clientId)))
          throw new ValidationError("That appointment isn't for this client.");
        patch.appointmentId = aid;
      }
      if ("subjective" in b) patch.subjective = optString(b.subjective) ?? null;
      if ("objective" in b) patch.objective = optString(b.objective) ?? null;
      if ("assessment" in b) patch.assessment = optString(b.assessment) ?? null;
      if ("plan" in b) patch.plan = optString(b.plan) ?? null;
      res.json({ note: await updateSoapNote(tid, req.params.id, patch) });
    })
  );
}
