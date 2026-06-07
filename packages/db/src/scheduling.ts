import { query } from "./index";
import type { Appointment, AppointmentStatus, Provider } from "@prodigy/contracts";

export const APPOINTMENT_STATUSES: AppointmentStatus[] = ["booked", "completed", "cancelled", "no_show"];

interface AppointmentRow {
  id: string;
  client_id: string;
  client_name: string;
  provider_id: string;
  provider_name: string;
  room_id: string | null;
  room_name: string | null;
  service_variant_id: string;
  service_name: string;
  variant_name: string;
  duration_minutes: number;
  starts_at: string | Date;
  ends_at: string | Date;
  price_cents: number;
  status: string;
  notes: string | null;
  protocol_instance_id: string | null;
  created_at: string | Date;
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

const APPT_SELECT = `
  SELECT a.id::text AS id,
         a.client_id::text AS client_id, c.display_name AS client_name,
         a.provider_id::text AS provider_id, sp.display_name AS provider_name,
         a.room_id::text AS room_id, r.name AS room_name,
         a.service_variant_id::text AS service_variant_id, s.name AS service_name, sv.name AS variant_name,
         (EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 60)::int AS duration_minutes,
         a.starts_at, a.ends_at, a.price_cents, a.status, a.notes, a.protocol_instance_id, a.created_at
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  JOIN staff_profiles sp ON sp.id = a.provider_id
  LEFT JOIN rooms r ON r.id = a.room_id
  JOIN service_variants sv ON sv.id = a.service_variant_id
  JOIN services s ON s.id = sv.service_id`;

function mapAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    providerId: row.provider_id,
    providerName: row.provider_name,
    roomId: row.room_id,
    roomName: row.room_name,
    serviceVariantId: row.service_variant_id,
    serviceName: row.service_name,
    variantName: row.variant_name,
    durationMinutes: row.duration_minutes,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    priceCents: row.price_cents,
    status: row.status as AppointmentStatus,
    notes: row.notes,
    protocolInstanceId: row.protocol_instance_id,
    createdAt: iso(row.created_at),
  };
}

// ---------- providers (active staff who deliver services) ----------
export async function listProviders(tenantId: string): Promise<Provider[]> {
  const rows = await query<{ id: string; display_name: string; title: string | null; color: string | null }>(
    `SELECT id::text AS id, display_name, title, color FROM staff_profiles
     WHERE tenant_id = $1 AND is_active = true ORDER BY display_name`,
    [tenantId]
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, title: r.title, color: r.color }));
}

// ---------- reference checks ----------
export interface VariantBooking {
  id: string;
  durationMinutes: number;
  priceCents: number;
  serviceName: string;
  variantName: string;
}

export async function getVariantForBooking(tenantId: string, variantId: string): Promise<VariantBooking | null> {
  const rows = await query<{
    id: string;
    duration_minutes: number;
    price_cents: number;
    service_name: string;
    variant_name: string;
  }>(
    `SELECT sv.id::text AS id, sv.duration_minutes, sv.price_cents,
            s.name AS service_name, sv.name AS variant_name
     FROM service_variants sv JOIN services s ON s.id = sv.service_id
     WHERE sv.tenant_id = $1 AND sv.id = $2 AND sv.is_active = true LIMIT 1`,
    [tenantId, variantId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    durationMinutes: r.duration_minutes,
    priceCents: r.price_cents,
    serviceName: r.service_name,
    variantName: r.variant_name,
  };
}

export async function clientExists(tenantId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(`SELECT id FROM clients WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return rows.length > 0;
}
export async function providerIsActive(tenantId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM staff_profiles WHERE tenant_id = $1 AND id = $2 AND is_active = true LIMIT 1`,
    [tenantId, id]
  );
  return rows.length > 0;
}
export async function roomExists(tenantId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(`SELECT id FROM rooms WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return rows.length > 0;
}

// ---------- conflict detection (overlap on provider or room) ----------
export interface Conflict {
  kind: "provider" | "room";
  appointment: Appointment;
}

export async function findConflict(
  tenantId: string,
  p: { providerId: string; roomId: string | null; startsAt: string; endsAt: string; excludeId?: string }
): Promise<Conflict | null> {
  const exclude = p.excludeId ?? "0";
  const prov = await query<{ id: string }>(
    `SELECT id::text AS id FROM appointments
     WHERE tenant_id = $1 AND provider_id = $2 AND id <> $5::bigint
       AND status NOT IN ('cancelled','no_show')
       AND starts_at < $4 AND ends_at > $3
     ORDER BY starts_at LIMIT 1`,
    [tenantId, p.providerId, p.startsAt, p.endsAt, exclude]
  );
  if (prov[0]) {
    const a = await getAppointment(tenantId, prov[0].id);
    if (a) return { kind: "provider", appointment: a };
  }
  if (p.roomId) {
    const room = await query<{ id: string }>(
      `SELECT id::text AS id FROM appointments
       WHERE tenant_id = $1 AND room_id = $2 AND id <> $5::bigint
         AND status NOT IN ('cancelled','no_show')
         AND starts_at < $4 AND ends_at > $3
       ORDER BY starts_at LIMIT 1`,
      [tenantId, p.roomId, p.startsAt, p.endsAt, exclude]
    );
    if (room[0]) {
      const a = await getAppointment(tenantId, room[0].id);
      if (a) return { kind: "room", appointment: a };
    }
  }
  return null;
}

// ---------- queries ----------
export async function listAppointments(
  tenantId: string,
  opts: { from?: string; to?: string; providerId?: string; clientId?: string; protocolInstanceId?: string } = {}
): Promise<Appointment[]> {
  const rows = await query<AppointmentRow>(
    `${APPT_SELECT}
     WHERE a.tenant_id = $1
       AND ($2::timestamptz IS NULL OR a.starts_at >= $2)
       AND ($3::timestamptz IS NULL OR a.starts_at < $3)
       AND ($4::bigint IS NULL OR a.provider_id = $4)
       AND ($5::bigint IS NULL OR a.client_id = $5)
       AND ($6::bigint IS NULL OR a.protocol_instance_id = $6)
     ORDER BY a.starts_at`,
    [tenantId, opts.from ?? null, opts.to ?? null, opts.providerId ?? null, opts.clientId ?? null, opts.protocolInstanceId ?? null]
  );
  return rows.map(mapAppointment);
}

export async function getAppointment(tenantId: string, id: string): Promise<Appointment | null> {
  const rows = await query<AppointmentRow>(`${APPT_SELECT} WHERE a.tenant_id = $1 AND a.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapAppointment(rows[0]) : null;
}

export interface CreateAppointmentInput {
  clientId: string;
  providerId: string;
  roomId: string | null;
  serviceVariantId: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  notes: string | null;
  protocolInstanceId?: string | null;
}

export async function createAppointment(tenantId: string, input: CreateAppointmentInput): Promise<Appointment> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO appointments
       (tenant_id, client_id, provider_id, room_id, service_variant_id, starts_at, ends_at, price_cents, notes, status, protocol_instance_id)
     VALUES ($1, $2::bigint, $3::bigint, $4, $5::bigint, $6, $7, $8, $9, 'booked', $10)
     RETURNING id::text AS id`,
    [
      tenantId,
      input.clientId,
      input.providerId,
      input.roomId,
      input.serviceVariantId,
      input.startsAt,
      input.endsAt,
      input.priceCents,
      input.notes,
      input.protocolInstanceId ?? null,
    ]
  );
  const appt = await getAppointment(tenantId, inserted[0].id);
  if (!appt) throw new Error("failed to load created appointment");
  return appt;
}

export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingError";
  }
}

export interface BookCheckedInput {
  clientId: string;
  providerId: string;
  roomId: string | null;
  serviceVariantId: string;
  startsAt: string;
  notes: string | null;
}

/**
 * Book an appointment SAFELY: resolve the service variant (for duration + price), apply the same
 * hard double-booking guard the internal calendar uses (provider + room overlap), then create.
 * Throws SchedulingError on a bad reference, invalid time, or conflict. One safe entry point so the
 * agent books through the exact same guard humans do (P7) — never a raw, unchecked insert.
 */
export async function bookAppointmentChecked(tenantId: string, input: BookCheckedInput): Promise<Appointment> {
  const variant = await getVariantForBooking(tenantId, input.serviceVariantId);
  if (!variant) throw new SchedulingError("That service variant isn't available.");
  const start = new Date(input.startsAt);
  if (isNaN(start.getTime())) throw new SchedulingError("That start time is invalid.");
  const startsAt = start.toISOString();
  const endsAt = new Date(start.getTime() + variant.durationMinutes * 60000).toISOString();

  const conflict = await findConflict(tenantId, { providerId: input.providerId, roomId: input.roomId, startsAt, endsAt });
  if (conflict) throw new SchedulingError(`That time conflicts with an existing ${conflict.kind} booking.`);

  return createAppointment(tenantId, {
    clientId: input.clientId,
    providerId: input.providerId,
    roomId: input.roomId,
    serviceVariantId: variant.id,
    startsAt,
    endsAt,
    priceCents: variant.priceCents,
    notes: input.notes,
    protocolInstanceId: null,
  });
}

const APPT_UPDATE_COLUMNS: Record<string, string> = {
  clientId: "client_id",
  providerId: "provider_id",
  roomId: "room_id",
  serviceVariantId: "service_variant_id",
  startsAt: "starts_at",
  endsAt: "ends_at",
  priceCents: "price_cents",
  notes: "notes",
  status: "status",
};

export async function updateAppointment(
  tenantId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<Appointment | null> {
  const sets: string[] = [];
  const params: unknown[] = [tenantId, id];
  for (const [key, col] of Object.entries(APPT_UPDATE_COLUMNS)) {
    if (key in patch && patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length === 0) return getAppointment(tenantId, id);
  const rows = await query<{ id: string }>(
    `UPDATE appointments SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING id::text AS id`,
    params
  );
  if (!rows[0]) return null;
  return getAppointment(tenantId, id);
}

export async function setAppointmentStatus(
  tenantId: string,
  id: string,
  status: AppointmentStatus
): Promise<Appointment | null> {
  const rows = await query<{ id: string }>(
    `UPDATE appointments SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id::text AS id`,
    [tenantId, id, status]
  );
  if (!rows[0]) return null;
  return getAppointment(tenantId, id);
}
