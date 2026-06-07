import { query } from "./index";

/** A persisted, human-gated agent action (the durable side of the approval queue). */
export interface AgentApproval {
  id: string;
  tool: string;
  input: unknown;
  status: "pending" | "executed" | "rejected" | "failed";
  actorName: string;
  requestedBy: string | null;
  result: unknown | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

interface ApprovalRow {
  id: string;
  tool: string;
  input_json: string;
  status: AgentApproval["status"];
  actor_name: string;
  requested_by: string | null;
  result_json: string | null;
  decided_by: string | null;
  created_at: string | Date;
  decided_at: string | Date | null;
}

const iso = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

function safeParse(json: string | null): unknown {
  if (json === null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function mapApproval(r: ApprovalRow): AgentApproval {
  return {
    id: r.id,
    tool: r.tool,
    input: safeParse(r.input_json),
    status: r.status,
    actorName: r.actor_name,
    requestedBy: r.requested_by,
    result: safeParse(r.result_json),
    decidedBy: r.decided_by,
    createdAt: iso(r.created_at) as string,
    decidedAt: iso(r.decided_at),
  };
}

const SELECT = `
  SELECT id::text AS id, tool, input_json, status, actor_name,
         requested_by::text AS requested_by, result_json, decided_by::text AS decided_by,
         created_at, decided_at
  FROM agent_approvals`;

export async function createAgentApproval(
  tenantId: string,
  input: { requestedBy: string | null; actorName: string; tool: string; input: unknown }
): Promise<AgentApproval> {
  const rows = await query<ApprovalRow>(
    `INSERT INTO agent_approvals (tenant_id, requested_by, actor_name, tool, input_json, status)
     VALUES ($1, $2::bigint, $3, $4, $5, 'pending')
     RETURNING id::text AS id, tool, input_json, status, actor_name,
               requested_by::text AS requested_by, result_json, decided_by::text AS decided_by,
               created_at, decided_at`,
    [tenantId, input.requestedBy, input.actorName, input.tool, JSON.stringify(input.input ?? {})]
  );
  return mapApproval(rows[0]);
}

export async function listAgentApprovals(
  tenantId: string,
  opts: { status?: string; decided?: boolean; limit?: number } = {}
): Promise<AgentApproval[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await query<ApprovalRow>(
    `${SELECT} WHERE tenant_id = $1
       AND ($2::text IS NULL OR status = $2)
       AND ($3::boolean IS NOT TRUE OR status <> 'pending')
     ORDER BY id DESC LIMIT $4`,
    [tenantId, opts.status ?? null, opts.decided ?? false, limit]
  );
  return rows.map(mapApproval);
}

export async function getAgentApproval(tenantId: string, id: string): Promise<AgentApproval | null> {
  const rows = await query<ApprovalRow>(`${SELECT} WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapApproval(rows[0]) : null;
}

/** Decide a pending approval. Guarded so only a still-pending row transitions (no double-execute). */
export async function decideAgentApproval(
  tenantId: string,
  id: string,
  decision: { status: AgentApproval["status"]; decidedBy: string | null; result: unknown | null }
): Promise<AgentApproval | null> {
  const rows = await query<ApprovalRow>(
    `UPDATE agent_approvals
     SET status = $3, decided_by = $4::bigint, result_json = $5, decided_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
     RETURNING id::text AS id, tool, input_json, status, actor_name,
               requested_by::text AS requested_by, result_json, decided_by::text AS decided_by,
               created_at, decided_at`,
    [tenantId, id, decision.status, decision.decidedBy, decision.result === null ? null : JSON.stringify(decision.result)]
  );
  return rows[0] ? mapApproval(rows[0]) : null;
}
