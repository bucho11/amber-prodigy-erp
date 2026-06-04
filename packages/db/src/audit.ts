import { createHash } from "node:crypto";
import { query, withTransaction } from "./index";
import type { AuditAction, AuditEntry } from "@prodigy/contracts";

export interface AuditActor {
  id: string;
  displayName: string;
}
export interface AuditInput {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  clientId?: string | null;
  detail?: string | null;
}

// The exact byte string folded into each row's hash. Built only from columns that round-trip exactly.
function payloadOf(fields: {
  tenantId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  clientId: string | null;
  detail: string | null;
  entryTs: string;
}): string {
  return [
    fields.tenantId,
    fields.actorUserId,
    fields.action,
    fields.resourceType,
    fields.resourceId ?? "",
    fields.clientId ?? "",
    fields.detail ?? "",
    fields.entryTs,
  ].join("|");
}
const chainHash = (prevHash: string, payload: string): string => createHash("sha256").update(`${prevHash}|${payload}`).digest("hex");

/** Append a hash-chained audit entry. Serialized per tenant so the chain stays linear. */
export async function recordAudit(tenantId: string, actor: AuditActor, input: AuditInput): Promise<void> {
  await withTransaction(async (q) => {
    // Serialize concurrent audit writes for this tenant so prev_hash is read-then-written atomically.
    await q(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`audit:${tenantId}`]);
    const prevRows = await q<{ hash: string }>(`SELECT hash FROM audit_log WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`, [tenantId]);
    const prevHash = prevRows[0]?.hash ?? "";
    const entryTs = new Date().toISOString();
    const payload = payloadOf({
      tenantId,
      actorUserId: actor.id,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      clientId: input.clientId ?? null,
      detail: input.detail ?? null,
      entryTs,
    });
    const hash = chainHash(prevHash, payload);
    await q(
      `INSERT INTO audit_log (tenant_id, actor_user_id, actor_name, action, resource_type, resource_id, client_id, detail, entry_ts, prev_hash, hash)
       VALUES ($1, $2::bigint, $3, $4, $5, $6, $7::bigint, $8, $9, $10, $11)`,
      [
        tenantId,
        actor.id,
        actor.displayName,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        input.clientId ?? null,
        input.detail ?? null,
        entryTs,
        prevHash,
        hash,
      ]
    );
  });
}

export async function listAuditLog(
  tenantId: string,
  opts: { clientId?: string; limit?: number } = {}
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await query<{
    id: string;
    actor_name: string;
    action: AuditAction;
    resource_type: string;
    resource_id: string | null;
    client_id: string | null;
    client_name: string | null;
    detail: string | null;
    created_at: string | Date;
  }>(
    `SELECT a.id::text AS id, a.actor_name, a.action, a.resource_type, a.resource_id,
            a.client_id::text AS client_id, c.display_name AS client_name, a.detail, a.created_at
     FROM audit_log a LEFT JOIN clients c ON c.id = a.client_id
     WHERE a.tenant_id = $1 AND ($2::bigint IS NULL OR a.client_id = $2)
     ORDER BY a.id DESC LIMIT $3`,
    [tenantId, opts.clientId ?? null, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    actorName: r.actor_name,
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    clientId: r.client_id,
    clientName: r.client_name,
    detail: r.detail,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  }));
}

/** Recompute the chain to detect any inserted, altered, or deleted entry. */
export async function verifyAuditChain(tenantId: string): Promise<{ intact: boolean; count: number; brokenAtId?: string }> {
  const rows = await query<{
    id: string;
    tenant_id: string;
    actor_user_id: string | null;
    action: string;
    resource_type: string;
    resource_id: string | null;
    client_id: string | null;
    detail: string | null;
    entry_ts: string;
    prev_hash: string;
    hash: string;
  }>(
    `SELECT id::text AS id, tenant_id::text AS tenant_id, actor_user_id::text AS actor_user_id, action,
            resource_type, resource_id, client_id::text AS client_id, detail, entry_ts, prev_hash, hash
     FROM audit_log WHERE tenant_id = $1 ORDER BY id ASC`,
    [tenantId]
  );
  let prev = "";
  for (const r of rows) {
    if (r.prev_hash !== prev) return { intact: false, count: rows.length, brokenAtId: r.id };
    const payload = payloadOf({
      tenantId: r.tenant_id,
      actorUserId: r.actor_user_id ?? "",
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      clientId: r.client_id,
      detail: r.detail,
      entryTs: r.entry_ts,
    });
    if (chainHash(prev, payload) !== r.hash) return { intact: false, count: rows.length, brokenAtId: r.id };
    prev = r.hash;
  }
  return { intact: true, count: rows.length };
}
