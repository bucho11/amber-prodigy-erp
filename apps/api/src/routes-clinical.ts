import type { Request, Router } from "express";
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
  recordAudit,
} from "@prodigy/db";
import type { UpdateSoapPatch, AuditInput } from "@prodigy/db";
import { ValidationError, reqString, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Best-effort clinical-access audit (never blocks the clinical operation).
async function audit(req: Request, input: AuditInput): Promise<void> {
  try {
    const u = userOf(req);
    await recordAudit(u.tenantId, { id: u.id, displayName: u.displayName }, input);
  } catch (err) {
    console.error("[audit] failed to record", err);
  }
}

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
      const intake = await getIntake(tid, req.params.id);
      await audit(req, { action: "view", resourceType: "intake", clientId: req.params.id });
      res.json({ intake });
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
      await audit(req, { action: "update", resourceType: "intake", clientId: req.params.id, detail: "Saved intake" });
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
      const notes = await listSoapNotes(tid, req.params.id);
      await audit(req, { action: "view", resourceType: "soap_list", clientId: req.params.id });
      res.json({ notes });
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
      await audit(req, { action: "create", resourceType: "soap", resourceId: note.id, clientId });
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
      await audit(req, { action: "view", resourceType: "soap", resourceId: n.id, clientId: n.clientId });
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
      const note = await updateSoapNote(tid, req.params.id, patch);
      await audit(req, { action: "update", resourceType: "soap", resourceId: req.params.id, clientId: existing.clientId });
      res.json({ note });
    })
  );
}
