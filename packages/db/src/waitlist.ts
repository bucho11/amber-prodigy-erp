import { query } from "./index";
import type { WaitlistEntry } from "@prodigy/contracts";

/**
 * Waitlist (BL-035): clients waiting for a slot, with their preferred service / provider / timeframe.
 * Front-of-house surfaces matching entries when a slot opens (e.g. a cancellation). Auto-notify on
 * cancellation needs a comms rail (deferred) — this is the track-and-surface core.
 */
export class WaitlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaitlistError";
  }
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const STATUSES = ["waiting", "placed", "cancelled"] as const;

interface Row {
  id: string;
  client_id: string;
  client_name: string;
  service_variant_id: string | null;
  service_name: string | null;
  provider_id: string | null;
  provider_name: string | null;
  preferred_window: string | null;
  notes: string | null;
  status: WaitlistEntry["status"];
  created_at: string | Date;
}
const SELECT = `SELECT w.id::text AS id, w.client_id::text AS client_id, c.display_name AS client_name,
       w.service_variant_id::text AS service_variant_id, s.name AS service_name,
       w.provider_id::text AS provider_id, sp.display_name AS provider_name,
       w.preferred_window, w.notes, w.status, w.created_at
  FROM waitlist w
  JOIN clients c ON c.id = w.client_id
  LEFT JOIN service_variants sv ON sv.id = w.service_variant_id
  LEFT JOIN services s ON s.id = sv.service_id
  LEFT JOIN staff_profiles sp ON sp.id = w.provider_id`;
const map = (r: Row): WaitlistEntry => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name,
  serviceVariantId: r.service_variant_id,
  serviceName: r.service_name,
  providerId: r.provider_id,
  providerName: r.provider_name,
  preferredWindow: r.preferred_window,
  notes: r.notes,
  status: r.status,
  createdAt: iso(r.created_at),
});

export interface WaitlistInput {
  clientId: string;
  serviceVariantId?: string | null;
  providerId?: string | null;
  preferredWindow?: string | null;
  notes?: string | null;
}

export async function addToWaitlist(tenantId: string, input: WaitlistInput): Promise<WaitlistEntry> {
  if (!input.clientId) throw new WaitlistError("A client is required.");
  const client = await query(`SELECT 1 FROM clients WHERE tenant_id = $1 AND id = $2`, [tenantId, input.clientId]);
  if (!client.length) throw new WaitlistError("Client not found.");
  const rows = await query<{ id: string }>(
    `INSERT INTO waitlist (tenant_id, client_id, service_variant_id, provider_id, preferred_window, notes)
     VALUES ($1, $2::bigint, $3, $4, $5, $6) RETURNING id::text AS id`,
    [
      tenantId,
      input.clientId,
      input.serviceVariantId ?? null,
      input.providerId ?? null,
      input.preferredWindow?.trim() || null,
      input.notes?.trim() || null,
    ]
  );
  const entry = await getWaitlistEntry(tenantId, rows[0].id);
  if (!entry) throw new Error("failed to load waitlist entry");
  return entry;
}

export async function getWaitlistEntry(tenantId: string, id: string): Promise<WaitlistEntry | null> {
  const rows = await query<Row>(`${SELECT} WHERE w.tenant_id = $1 AND w.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function listWaitlist(tenantId: string, opts: { status?: string } = {}): Promise<WaitlistEntry[]> {
  const rows = await query<Row>(
    `${SELECT} WHERE w.tenant_id = $1 AND ($2::text IS NULL OR w.status = $2) ORDER BY w.created_at`,
    [tenantId, opts.status ?? null]
  );
  return rows.map(map);
}

export async function setWaitlistStatus(tenantId: string, id: string, status: string): Promise<WaitlistEntry> {
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) throw new WaitlistError("Invalid status.");
  const res = await query(`UPDATE waitlist SET status = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, status]);
  const entry = await getWaitlistEntry(tenantId, id);
  if (!entry) throw new WaitlistError("Waitlist entry not found.");
  void res;
  return entry;
}
