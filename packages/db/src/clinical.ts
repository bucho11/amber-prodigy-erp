import { query } from "./index";
import type { ClientIntake, SoapNote, SoapNoteListItem } from "@prodigy/contracts";

const iso = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
const dateStr = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// ---------- intake ----------
interface IntakeRow {
  client_id: string;
  reason_for_visit: string | null;
  medical_conditions: string | null;
  medications: string | null;
  allergies: string | null;
  surgeries: string | null;
  injuries: string | null;
  pregnant: boolean | null;
  pressure_preference: string | null;
  areas_to_avoid: string | null;
  notes: string | null;
  consent_to_treat: boolean;
  signature_name: string | null;
  signed_at: string | Date | null;
  updated_at: string | Date;
}
function mapIntake(r: IntakeRow): ClientIntake {
  return {
    clientId: r.client_id,
    reasonForVisit: r.reason_for_visit,
    medicalConditions: r.medical_conditions,
    medications: r.medications,
    allergies: r.allergies,
    surgeries: r.surgeries,
    injuries: r.injuries,
    pregnant: r.pregnant,
    pressurePreference: r.pressure_preference,
    areasToAvoid: r.areas_to_avoid,
    notes: r.notes,
    consentToTreat: r.consent_to_treat,
    signatureName: r.signature_name,
    signedAt: iso(r.signed_at),
    hasIntake: true,
    updatedAt: iso(r.updated_at),
  };
}

const EMPTY_INTAKE = (clientId: string): ClientIntake => ({
  clientId,
  reasonForVisit: null,
  medicalConditions: null,
  medications: null,
  allergies: null,
  surgeries: null,
  injuries: null,
  pregnant: null,
  pressurePreference: null,
  areasToAvoid: null,
  notes: null,
  consentToTreat: false,
  signatureName: null,
  signedAt: null,
  hasIntake: false,
  updatedAt: null,
});

export async function getIntake(tenantId: string, clientId: string): Promise<ClientIntake> {
  const rows = await query<IntakeRow>(
    `SELECT client_id::text AS client_id, reason_for_visit, medical_conditions, medications, allergies, surgeries,
            injuries, pregnant, pressure_preference, areas_to_avoid, notes, consent_to_treat, signature_name, signed_at, updated_at
     FROM client_intake WHERE tenant_id = $1 AND client_id = $2 LIMIT 1`,
    [tenantId, clientId]
  );
  return rows[0] ? mapIntake(rows[0]) : EMPTY_INTAKE(clientId);
}

export interface IntakeInput {
  reasonForVisit: string | null;
  medicalConditions: string | null;
  medications: string | null;
  allergies: string | null;
  surgeries: string | null;
  injuries: string | null;
  pregnant: boolean | null;
  pressurePreference: string | null;
  areasToAvoid: string | null;
  notes: string | null;
  consentToTreat: boolean;
  signatureName: string | null;
}
export async function upsertIntake(tenantId: string, clientId: string, input: IntakeInput): Promise<ClientIntake> {
  // Preserve the original consent signing time; (re)set it only on the consent transition.
  const existing = await query<{ signed_at: string | Date | null }>(
    `SELECT signed_at FROM client_intake WHERE tenant_id = $1 AND client_id = $2 LIMIT 1`,
    [tenantId, clientId]
  );
  const prevSigned = existing[0]?.signed_at ?? null;
  const consented = input.consentToTreat && !!(input.signatureName && input.signatureName.trim());
  const signedAt = consented ? prevSigned ?? new Date() : null;

  await query(
    `INSERT INTO client_intake
       (client_id, tenant_id, reason_for_visit, medical_conditions, medications, allergies, surgeries, injuries,
        pregnant, pressure_preference, areas_to_avoid, notes, consent_to_treat, signature_name, signed_at, updated_at)
     VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
     ON CONFLICT (client_id) DO UPDATE SET
       reason_for_visit = EXCLUDED.reason_for_visit,
       medical_conditions = EXCLUDED.medical_conditions,
       medications = EXCLUDED.medications,
       allergies = EXCLUDED.allergies,
       surgeries = EXCLUDED.surgeries,
       injuries = EXCLUDED.injuries,
       pregnant = EXCLUDED.pregnant,
       pressure_preference = EXCLUDED.pressure_preference,
       areas_to_avoid = EXCLUDED.areas_to_avoid,
       notes = EXCLUDED.notes,
       consent_to_treat = EXCLUDED.consent_to_treat,
       signature_name = EXCLUDED.signature_name,
       signed_at = EXCLUDED.signed_at,
       updated_at = now()`,
    [
      clientId,
      tenantId,
      input.reasonForVisit,
      input.medicalConditions,
      input.medications,
      input.allergies,
      input.surgeries,
      input.injuries,
      input.pregnant,
      input.pressurePreference,
      input.areasToAvoid,
      input.notes,
      input.consentToTreat,
      input.signatureName,
      signedAt,
    ]
  );
  return getIntake(tenantId, clientId);
}

// ---------- SOAP notes ----------
interface SoapRow {
  id: string;
  client_id: string;
  appointment_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  note_date: string | Date;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}
function mapSoap(r: SoapRow): SoapNote {
  return {
    id: r.id,
    clientId: r.client_id,
    appointmentId: r.appointment_id,
    providerId: r.provider_id,
    providerName: r.provider_name,
    date: dateStr(r.note_date),
    subjective: r.subjective,
    objective: r.objective,
    assessment: r.assessment,
    plan: r.plan,
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
  };
}

const SOAP_SELECT = `
  SELECT sn.id::text AS id, sn.client_id::text AS client_id, sn.appointment_id::text AS appointment_id,
         sn.provider_id::text AS provider_id, sp.display_name AS provider_name, sn.note_date,
         sn.subjective, sn.objective, sn.assessment, sn.plan, sn.created_at, sn.updated_at
  FROM soap_notes sn
  LEFT JOIN staff_profiles sp ON sp.id = sn.provider_id`;

export async function listSoapNotes(tenantId: string, clientId: string): Promise<SoapNoteListItem[]> {
  const rows = await query<SoapRow>(
    `${SOAP_SELECT} WHERE sn.tenant_id = $1 AND sn.client_id = $2 ORDER BY sn.note_date DESC, sn.id DESC`,
    [tenantId, clientId]
  );
  return rows.map((r) => ({
    id: r.id,
    date: dateStr(r.note_date),
    providerName: r.provider_name,
    appointmentId: r.appointment_id,
    createdAt: iso(r.created_at) as string,
  }));
}

export async function getSoapNote(tenantId: string, id: string): Promise<SoapNote | null> {
  const rows = await query<SoapRow>(`${SOAP_SELECT} WHERE sn.tenant_id = $1 AND sn.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapSoap(rows[0]) : null;
}

export interface CreateSoapInput {
  clientId: string;
  appointmentId: string | null;
  providerId: string | null;
  date: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
}
export async function createSoapNote(tenantId: string, input: CreateSoapInput): Promise<SoapNote> {
  const rows = await query<{ id: string }>(
    `INSERT INTO soap_notes (tenant_id, client_id, appointment_id, provider_id, note_date, subjective, objective, assessment, plan)
     VALUES ($1, $2::bigint, $3::bigint, $4::bigint, $5, $6, $7, $8, $9)
     RETURNING id::text AS id`,
    [
      tenantId,
      input.clientId,
      input.appointmentId,
      input.providerId,
      input.date,
      input.subjective,
      input.objective,
      input.assessment,
      input.plan,
    ]
  );
  const note = await getSoapNote(tenantId, rows[0].id);
  if (!note) throw new Error("failed to load created note");
  return note;
}

export interface UpdateSoapPatch {
  appointmentId?: string | null;
  providerId?: string | null;
  date?: string;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
}
export async function updateSoapNote(tenantId: string, id: string, patch: UpdateSoapPatch): Promise<SoapNote | null> {
  const map: Record<string, string> = {
    appointmentId: "appointment_id",
    providerId: "provider_id",
    date: "note_date",
    subjective: "subjective",
    objective: "objective",
    assessment: "assessment",
    plan: "plan",
  };
  const sets: string[] = [];
  const params: unknown[] = [tenantId, id];
  for (const [key, col] of Object.entries(map)) {
    if (key in patch) {
      params.push((patch as Record<string, unknown>)[key]);
      const cast = key === "appointmentId" || key === "providerId" ? "::bigint" : "";
      sets.push(`${col} = $${params.length}${cast}`);
    }
  }
  if (sets.length > 0) {
    sets.push("updated_at = now()");
    await query(`UPDATE soap_notes SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2`, params);
  }
  return getSoapNote(tenantId, id);
}

/** True if the appointment exists for this tenant and belongs to the given client. */
export async function appointmentBelongsToClient(tenantId: string, appointmentId: string, clientId: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM appointments WHERE tenant_id = $1 AND id = $2 AND client_id = $3 LIMIT 1`, [
    tenantId,
    appointmentId,
    clientId,
  ]);
  return rows.length > 0;
}
