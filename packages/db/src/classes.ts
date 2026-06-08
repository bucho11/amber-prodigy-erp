import { query } from "./index";
import type { ClassRosterEntry, ClassSession } from "@prodigy/contracts";

/**
 * Group classes (BL-036): scheduled group sessions with a capacity and a roster. Enrolling is
 * capacity-checked — a full class is rejected (front-of-house then adds the client to the waitlist,
 * BL-035). Roster statuses (enrolled/cancelled/attended/no_show) let staff reconcile attendance.
 */
export class ClassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassError";
  }
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const n = (v: unknown): number => Number(v ?? 0);

interface SessionRow {
  id: string;
  name: string;
  provider_id: string | null;
  provider_name: string | null;
  room_id: string | null;
  room_name: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  capacity: number;
  enrolled: string;
  status: ClassSession["status"];
}
const SESSION_SELECT = `SELECT cs.id::text AS id, cs.name, cs.provider_id::text AS provider_id, sp.display_name AS provider_name,
       cs.room_id::text AS room_id, r.name AS room_name, cs.starts_at, cs.ends_at, cs.capacity, cs.status,
       (SELECT COUNT(*) FROM class_enrollments e WHERE e.class_session_id = cs.id AND e.status = 'enrolled')::bigint AS enrolled
  FROM class_sessions cs
  LEFT JOIN staff_profiles sp ON sp.id = cs.provider_id
  LEFT JOIN rooms r ON r.id = cs.room_id`;
const mapSession = (r: SessionRow): ClassSession => {
  const enrolledCount = n(r.enrolled);
  return {
    id: r.id,
    name: r.name,
    providerId: r.provider_id,
    providerName: r.provider_name,
    roomId: r.room_id,
    roomName: r.room_name,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    capacity: r.capacity,
    enrolledCount,
    spotsLeft: Math.max(0, r.capacity - enrolledCount),
    status: r.status,
  };
};

export interface ClassInput {
  name: string;
  providerId?: string | null;
  roomId?: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
}

export async function createClassSession(tenantId: string, input: ClassInput): Promise<ClassSession> {
  if (!input.name?.trim()) throw new ClassError("A class name is required.");
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new ClassError("Capacity must be a positive whole number.");
  if (!input.startsAt || !input.endsAt) throw new ClassError("Start and end times are required.");
  if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new ClassError("The class must end after it starts.");
  const rows = await query<{ id: string }>(
    `INSERT INTO class_sessions (tenant_id, name, provider_id, room_id, starts_at, ends_at, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
    [tenantId, input.name.trim(), input.providerId ?? null, input.roomId ?? null, input.startsAt, input.endsAt, input.capacity]
  );
  const s = await getClassSession(tenantId, rows[0].id);
  if (!s) throw new Error("failed to load created class");
  return s;
}

export async function getClassSession(tenantId: string, id: string): Promise<ClassSession | null> {
  const rows = await query<SessionRow>(`${SESSION_SELECT} WHERE cs.tenant_id = $1 AND cs.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function listClassSessions(tenantId: string, opts: { upcomingOnly?: boolean } = {}): Promise<ClassSession[]> {
  const rows = await query<SessionRow>(
    `${SESSION_SELECT} WHERE cs.tenant_id = $1 ${opts.upcomingOnly ? "AND cs.ends_at >= now() AND cs.status = 'scheduled'" : ""} ORDER BY cs.starts_at`,
    [tenantId]
  );
  return rows.map(mapSession);
}

export async function listRoster(tenantId: string, classSessionId: string): Promise<ClassRosterEntry[]> {
  const rows = await query<{ id: string; client_id: string; client_name: string; status: ClassRosterEntry["status"]; created_at: string | Date }>(
    `SELECT e.id::text AS id, e.client_id::text AS client_id, c.display_name AS client_name, e.status, e.created_at
       FROM class_enrollments e JOIN clients c ON c.id = e.client_id
      WHERE e.tenant_id = $1 AND e.class_session_id = $2
      ORDER BY (e.status = 'cancelled'), e.created_at`,
    [tenantId, classSessionId]
  );
  return rows.map((r) => ({ enrollmentId: r.id, clientId: r.client_id, clientName: r.client_name, status: r.status, createdAt: iso(r.created_at) }));
}

export async function enrollClient(tenantId: string, classSessionId: string, clientId: string): Promise<ClassSession> {
  const session = await getClassSession(tenantId, classSessionId);
  if (!session) throw new ClassError("Class not found.");
  if (session.status !== "scheduled") throw new ClassError("That class isn't open for enrollment.");
  const existing = await query<{ status: string }>(
    `SELECT status FROM class_enrollments WHERE tenant_id = $1 AND class_session_id = $2 AND client_id = $3 LIMIT 1`,
    [tenantId, classSessionId, clientId]
  );
  if (existing[0]?.status === "enrolled") return session; // already enrolled — idempotent
  if (session.spotsLeft <= 0) throw new ClassError("This class is full. Add the client to the waitlist instead.");
  await query(
    `INSERT INTO class_enrollments (tenant_id, class_session_id, client_id, status)
     VALUES ($1, $2::bigint, $3::bigint, 'enrolled')
     ON CONFLICT (class_session_id, client_id) DO UPDATE SET status = 'enrolled'`,
    [tenantId, classSessionId, clientId]
  );
  const updated = await getClassSession(tenantId, classSessionId);
  return updated!;
}

const ENROLLMENT_STATUSES = ["enrolled", "cancelled", "attended", "no_show"] as const;
export async function setEnrollmentStatus(tenantId: string, enrollmentId: string, status: string): Promise<void> {
  if (!ENROLLMENT_STATUSES.includes(status as (typeof ENROLLMENT_STATUSES)[number])) throw new ClassError("Invalid enrollment status.");
  const rows = await query(
    `UPDATE class_enrollments SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, enrollmentId, status]
  );
  if (!rows.length) throw new ClassError("Enrollment not found.");
}
