import { query, withTransaction } from "./index";
import { findConflict, createAppointment, getVariantForBooking } from "./scheduling";
import { zonedWallTimeToUtc, addDays } from "./time";
import type {
  Protocol,
  ProtocolStep,
  ProtocolListItem,
  ProtocolInstance,
  ApplyProtocolResult,
  ApplyProtocolSkip,
  Appointment,
} from "@prodigy/contracts";

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

// ---------- templates ----------
export async function listProtocols(tenantId: string): Promise<ProtocolListItem[]> {
  const rows = await query<{
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    step_count: string;
    span_days: string;
  }>(
    `SELECT p.id::text AS id, p.name, p.description, p.is_active,
            COUNT(s.id)::text AS step_count,
            COALESCE(MAX(s.day_offset) - MIN(s.day_offset), 0)::text AS span_days
     FROM protocols p
     LEFT JOIN protocol_steps s ON s.protocol_id = p.id
     WHERE p.tenant_id = $1
     GROUP BY p.id
     ORDER BY p.is_active DESC, p.name`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.is_active,
    stepCount: Number(r.step_count),
    spanDays: Number(r.span_days),
  }));
}

export async function getProtocol(tenantId: string, id: string): Promise<Protocol | null> {
  const headers = await query<{
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    created_at: string | Date;
  }>(`SELECT id::text AS id, name, description, is_active, created_at FROM protocols WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [
    tenantId,
    id,
  ]);
  const h = headers[0];
  if (!h) return null;
  const steps = await query<{
    id: string;
    step_number: number;
    day_offset: number;
    time_of_day: string | null;
    service_variant_id: string;
    service_name: string;
    variant_name: string;
    duration_minutes: number;
    price_cents: number;
    label: string | null;
  }>(
    `SELECT ps.id::text AS id, ps.step_number, ps.day_offset, ps.time_of_day,
            ps.service_variant_id::text AS service_variant_id,
            s.name AS service_name, sv.name AS variant_name,
            sv.duration_minutes, sv.price_cents, ps.label
     FROM protocol_steps ps
     JOIN service_variants sv ON sv.id = ps.service_variant_id
     JOIN services s ON s.id = sv.service_id
     WHERE ps.tenant_id = $1 AND ps.protocol_id = $2
     ORDER BY ps.step_number`,
    [tenantId, id]
  );
  return {
    id: h.id,
    name: h.name,
    description: h.description,
    isActive: h.is_active,
    createdAt: iso(h.created_at),
    steps: steps.map<ProtocolStep>((s) => ({
      id: s.id,
      stepNumber: s.step_number,
      dayOffset: s.day_offset,
      timeOfDay: s.time_of_day,
      serviceVariantId: s.service_variant_id,
      serviceName: s.service_name,
      variantName: s.variant_name,
      durationMinutes: s.duration_minutes,
      priceCents: s.price_cents,
      label: s.label,
    })),
  };
}

export interface ProtocolStepInput {
  dayOffset: number;
  timeOfDay: string | null;
  serviceVariantId: string;
  label: string | null;
}

export async function createProtocol(
  tenantId: string,
  input: { name: string; description: string | null; steps: ProtocolStepInput[] }
): Promise<Protocol> {
  const id = await withTransaction(async (q) => {
    const rows = await q<{ id: string }>(
      `INSERT INTO protocols (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING id::text AS id`,
      [tenantId, input.name, input.description]
    );
    const newId = rows[0].id;
    for (let i = 0; i < input.steps.length; i++) {
      const st = input.steps[i];
      await q(
        `INSERT INTO protocol_steps (tenant_id, protocol_id, step_number, day_offset, time_of_day, service_variant_id, label)
         VALUES ($1, $2::bigint, $3, $4, $5, $6::bigint, $7)`,
        [tenantId, newId, i + 1, st.dayOffset, st.timeOfDay, st.serviceVariantId, st.label]
      );
    }
    return newId;
  });
  const proto = await getProtocol(tenantId, id);
  if (!proto) throw new Error("failed to load created protocol");
  return proto;
}

export async function updateProtocol(
  tenantId: string,
  id: string,
  patch: { name?: string; description?: string | null; isActive?: boolean; steps?: ProtocolStepInput[] }
): Promise<Protocol | null> {
  const existing = await getProtocol(tenantId, id);
  if (!existing) return null;
  await withTransaction(async (q) => {
    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];
    if (patch.name !== undefined) {
      params.push(patch.name);
      sets.push(`name = $${params.length}`);
    }
    if (patch.description !== undefined) {
      params.push(patch.description);
      sets.push(`description = $${params.length}`);
    }
    if (patch.isActive !== undefined) {
      params.push(patch.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (sets.length > 0) {
      await q(`UPDATE protocols SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2`, params);
    }
    if (patch.steps) {
      await q(`DELETE FROM protocol_steps WHERE tenant_id = $1 AND protocol_id = $2`, [tenantId, id]);
      for (let i = 0; i < patch.steps.length; i++) {
        const st = patch.steps[i];
        await q(
          `INSERT INTO protocol_steps (tenant_id, protocol_id, step_number, day_offset, time_of_day, service_variant_id, label)
           VALUES ($1, $2::bigint, $3, $4, $5, $6::bigint, $7)`,
          [tenantId, id, i + 1, st.dayOffset, st.timeOfDay, st.serviceVariantId, st.label]
        );
      }
    }
  });
  return getProtocol(tenantId, id);
}

// ---------- instances ----------
interface InstanceRow {
  id: string;
  protocol_id: string | null;
  protocol_name: string;
  client_id: string;
  client_name: string;
  anchor_date: string;
  provider_id: string;
  provider_name: string;
  room_id: string | null;
  room_name: string | null;
  status: string;
  created_at: string | Date;
  appointment_count: string;
}
function mapInstance(r: InstanceRow): ProtocolInstance {
  return {
    id: r.id,
    protocolId: r.protocol_id,
    protocolName: r.protocol_name,
    clientId: r.client_id,
    clientName: r.client_name,
    anchorDate: r.anchor_date,
    providerId: r.provider_id,
    providerName: r.provider_name,
    roomId: r.room_id,
    roomName: r.room_name,
    status: r.status,
    createdAt: iso(r.created_at),
    appointmentCount: Number(r.appointment_count),
  };
}

const INSTANCE_SELECT = `
  SELECT pi.id::text AS id, pi.protocol_id::text AS protocol_id, pi.protocol_name,
         pi.client_id::text AS client_id, c.display_name AS client_name,
         to_char(pi.anchor_date, 'YYYY-MM-DD') AS anchor_date,
         pi.provider_id::text AS provider_id, sp.display_name AS provider_name,
         pi.room_id::text AS room_id, r.name AS room_name,
         pi.status, pi.created_at,
         COUNT(a.id)::text AS appointment_count
  FROM protocol_instances pi
  JOIN clients c ON c.id = pi.client_id
  JOIN staff_profiles sp ON sp.id = pi.provider_id
  LEFT JOIN rooms r ON r.id = pi.room_id
  LEFT JOIN appointments a ON a.protocol_instance_id = pi.id`;

export async function listInstances(tenantId: string, opts: { clientId?: string } = {}): Promise<ProtocolInstance[]> {
  const rows = await query<InstanceRow>(
    `${INSTANCE_SELECT}
     WHERE pi.tenant_id = $1 AND ($2::bigint IS NULL OR pi.client_id = $2)
     GROUP BY pi.id, c.display_name, sp.display_name, r.name
     ORDER BY pi.created_at DESC`,
    [tenantId, opts.clientId ?? null]
  );
  return rows.map(mapInstance);
}

export async function getInstance(tenantId: string, id: string): Promise<ProtocolInstance | null> {
  const rows = await query<InstanceRow>(
    `${INSTANCE_SELECT}
     WHERE pi.tenant_id = $1 AND pi.id = $2
     GROUP BY pi.id, c.display_name, sp.display_name, r.name
     LIMIT 1`,
    [tenantId, id]
  );
  return rows[0] ? mapInstance(rows[0]) : null;
}

export interface ApplyProtocolInput {
  protocolId: string;
  clientId: string;
  anchorDate: string; // YYYY-MM-DD (tenant-local)
  providerId: string;
  roomId: string | null;
  defaultTime: string; // HH:MM, used when a step has no time_of_day
}

export async function applyProtocol(
  tenantId: string,
  tenantTimezone: string,
  input: ApplyProtocolInput
): Promise<ApplyProtocolResult | null> {
  const protocol = await getProtocol(tenantId, input.protocolId);
  if (!protocol) return null;

  const instRows = await query<{ id: string }>(
    `INSERT INTO protocol_instances (tenant_id, protocol_id, protocol_name, client_id, anchor_date, provider_id, room_id, status)
     VALUES ($1, $2::bigint, $3, $4::bigint, $5, $6::bigint, $7, 'active')
     RETURNING id::text AS id`,
    [tenantId, protocol.id, protocol.name, input.clientId, input.anchorDate, input.providerId, input.roomId]
  );
  const instanceId = instRows[0].id;

  const created: Appointment[] = [];
  const skipped: ApplyProtocolSkip[] = [];

  for (const step of protocol.steps) {
    const date = addDays(input.anchorDate, step.dayOffset);
    const time = step.timeOfDay || input.defaultTime;
    const startsAt = zonedWallTimeToUtc(date, time, tenantTimezone);

    const variant = await getVariantForBooking(tenantId, step.serviceVariantId);
    if (!variant) {
      skipped.push({ stepNumber: step.stepNumber, dayOffset: step.dayOffset, reason: "Service is no longer available." });
      continue;
    }
    const endsAt = new Date(new Date(startsAt).getTime() + variant.durationMinutes * 60000).toISOString();

    const conflict = await findConflict(tenantId, {
      providerId: input.providerId,
      roomId: input.roomId,
      startsAt,
      endsAt,
    });
    if (conflict) {
      const who = conflict.kind === "provider" ? conflict.appointment.providerName : conflict.appointment.roomName ?? "room";
      skipped.push({
        stepNumber: step.stepNumber,
        dayOffset: step.dayOffset,
        reason: `${who} already booked at that time — left unbooked.`,
      });
      continue;
    }

    const appt = await createAppointment(tenantId, {
      clientId: input.clientId,
      providerId: input.providerId,
      roomId: input.roomId,
      serviceVariantId: step.serviceVariantId,
      startsAt,
      endsAt,
      priceCents: variant.priceCents,
      notes: step.label,
      protocolInstanceId: instanceId,
    });
    created.push(appt);
  }

  const instance = await getInstance(tenantId, instanceId);
  if (!instance) throw new Error("failed to load protocol instance");
  return { instance, created, skipped };
}

export async function cancelInstance(tenantId: string, id: string): Promise<ProtocolInstance | null> {
  const existing = await getInstance(tenantId, id);
  if (!existing) return null;
  await withTransaction(async (q) => {
    // Cancel future/booked sessions; leave completed ones as historical record.
    await q(
      `UPDATE appointments SET status = 'cancelled'
       WHERE tenant_id = $1 AND protocol_instance_id = $2 AND status NOT IN ('cancelled', 'completed')`,
      [tenantId, id]
    );
    await q(`UPDATE protocol_instances SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  });
  return getInstance(tenantId, id);
}
