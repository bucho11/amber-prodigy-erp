import { query } from "./index";
import type { Client, ClientListItem, Tag } from "@prodigy/contracts";

interface ClientRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  pronouns: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  referral_source: string | null;
  marketing_opt_in: boolean;
  sms_opt_in: boolean;
  notes: string | null;
  status: string;
  created_at: string | Date;
}

const CLIENT_COLUMNS = `
  id::text AS id, first_name, last_name, display_name, email, phone,
  to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, pronouns,
  address_line1, address_city, address_state, address_postal,
  emergency_contact_name, emergency_contact_phone, referral_source,
  marketing_opt_in, sms_opt_in, notes, status, created_at`;

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function mapClient(row: ClientRow, tags: Tag[]): Client {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
    pronouns: row.pronouns,
    addressLine1: row.address_line1,
    addressCity: row.address_city,
    addressState: row.address_state,
    addressPostal: row.address_postal,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    referralSource: row.referral_source,
    marketingOptIn: row.marketing_opt_in,
    smsOptIn: row.sms_opt_in,
    notes: row.notes,
    status: row.status,
    createdAt: iso(row.created_at),
    tags,
  };
}

async function tagsForClients(tenantId: string, clientIds: string[]): Promise<Map<string, Tag[]>> {
  const map = new Map<string, Tag[]>();
  if (clientIds.length === 0) return map;
  const rows = await query<{ client_id: string; id: string; name: string }>(
    `SELECT ct.client_id::text AS client_id, t.id::text AS id, t.name
     FROM client_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.tenant_id = $1 AND ct.client_id = ANY($2::bigint[])
     ORDER BY t.name`,
    [tenantId, clientIds]
  );
  for (const r of rows) {
    const arr = map.get(r.client_id) ?? [];
    arr.push({ id: r.id, name: r.name });
    map.set(r.client_id, arr);
  }
  return map;
}

export async function listClients(
  tenantId: string,
  opts: { search?: string; includeArchived?: boolean; limit?: number } = {}
): Promise<ClientListItem[]> {
  const search = opts.search && opts.search.trim() !== "" ? `%${opts.search.trim()}%` : null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await query<ClientRow>(
    `SELECT ${CLIENT_COLUMNS} FROM clients
     WHERE tenant_id = $1
       AND ($2::boolean OR status = 'active')
       AND ($3::text IS NULL OR display_name ILIKE $3 OR email ILIKE $3 OR phone ILIKE $3
            OR first_name ILIKE $3 OR last_name ILIKE $3)
     ORDER BY display_name
     LIMIT $4`,
    [tenantId, opts.includeArchived ?? false, search, limit]
  );
  const tagMap = await tagsForClients(tenantId, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    createdAt: iso(r.created_at),
    tags: tagMap.get(r.id) ?? [],
  }));
}

export async function getClient(tenantId: string, id: string): Promise<Client | null> {
  const rows = await query<ClientRow>(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [
    tenantId,
    id,
  ]);
  if (!rows[0]) return null;
  const tagMap = await tagsForClients(tenantId, [rows[0].id]);
  return mapClient(rows[0], tagMap.get(rows[0].id) ?? []);
}

export interface ClientInput {
  firstName?: string | null;
  lastName?: string | null;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  pronouns?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPostal?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  referralSource?: string | null;
  marketingOptIn?: boolean;
  smsOptIn?: boolean;
  notes?: string | null;
}

export async function createClient(tenantId: string, input: ClientInput): Promise<Client> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO clients
       (tenant_id, first_name, last_name, display_name, email, phone, date_of_birth, pronouns,
        address_line1, address_city, address_state, address_postal,
        emergency_contact_name, emergency_contact_phone, referral_source,
        marketing_opt_in, sms_opt_in, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'active')
     RETURNING id::text AS id`,
    [
      tenantId,
      input.firstName ?? null,
      input.lastName ?? null,
      input.displayName,
      input.email ?? null,
      input.phone ?? null,
      input.dateOfBirth ?? null,
      input.pronouns ?? null,
      input.addressLine1 ?? null,
      input.addressCity ?? null,
      input.addressState ?? null,
      input.addressPostal ?? null,
      input.emergencyContactName ?? null,
      input.emergencyContactPhone ?? null,
      input.referralSource ?? null,
      input.marketingOptIn ?? false,
      input.smsOptIn ?? false,
      input.notes ?? null,
    ]
  );
  const client = await getClient(tenantId, inserted[0].id);
  if (!client) throw new Error("failed to load created client");
  return client;
}

// Whitelisted column map for safe partial updates (keys are fixed, values parameterized).
const UPDATE_COLUMNS: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  displayName: "display_name",
  email: "email",
  phone: "phone",
  dateOfBirth: "date_of_birth",
  pronouns: "pronouns",
  addressLine1: "address_line1",
  addressCity: "address_city",
  addressState: "address_state",
  addressPostal: "address_postal",
  emergencyContactName: "emergency_contact_name",
  emergencyContactPhone: "emergency_contact_phone",
  referralSource: "referral_source",
  marketingOptIn: "marketing_opt_in",
  smsOptIn: "sms_opt_in",
  notes: "notes",
  status: "status",
};

export async function updateClient(
  tenantId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<Client | null> {
  const sets: string[] = [];
  const params: unknown[] = [tenantId, id];
  for (const [key, col] of Object.entries(UPDATE_COLUMNS)) {
    if (key in patch && patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length === 0) return getClient(tenantId, id);
  const rows = await query<{ id: string }>(
    `UPDATE clients SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING id::text AS id`,
    params
  );
  if (!rows[0]) return null;
  return getClient(tenantId, id);
}

// ---------- tags ----------
export async function listTags(tenantId: string): Promise<Tag[]> {
  const rows = await query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM tags WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

async function getOrCreateTag(tenantId: string, name: string): Promise<Tag> {
  const existing = await query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM tags WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [tenantId, name]
  );
  if (existing[0]) return { id: existing[0].id, name: existing[0].name };
  const created = await query<{ id: string; name: string }>(
    `INSERT INTO tags (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, lower(name)) DO UPDATE SET name = tags.name
     RETURNING id::text AS id, name`,
    [tenantId, name]
  );
  return { id: created[0].id, name: created[0].name };
}

/** Attach a tag (by name) to a client, creating the tag if needed. Returns the client's tags. Null if client missing. */
export async function attachTag(tenantId: string, clientId: string, name: string): Promise<Tag[] | null> {
  const exists = await query<{ id: string }>(`SELECT id FROM clients WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [
    tenantId,
    clientId,
  ]);
  if (!exists[0]) return null;
  const tag = await getOrCreateTag(tenantId, name);
  await query(
    `INSERT INTO client_tags (tenant_id, client_id, tag_id) VALUES ($1, $2, $3::bigint) ON CONFLICT DO NOTHING`,
    [tenantId, clientId, tag.id]
  );
  return (await tagsForClients(tenantId, [clientId])).get(clientId) ?? [];
}

export async function detachTag(tenantId: string, clientId: string, tagId: string): Promise<Tag[]> {
  await query(`DELETE FROM client_tags WHERE tenant_id = $1 AND client_id = $2 AND tag_id = $3`, [
    tenantId,
    clientId,
    tagId,
  ]);
  return (await tagsForClients(tenantId, [clientId])).get(clientId) ?? [];
}
