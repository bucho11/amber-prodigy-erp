import { query } from "./index";
import type { StaffMember, LinkableUser } from "@prodigy/contracts";

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

interface StaffRow {
  id: string;
  display_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  color: string | null;
  is_active: boolean;
  user_id: string | null;
  user_email: string | null;
  created_at: string | Date;
}
function mapStaff(r: StaffRow): StaffMember {
  return {
    id: r.id,
    displayName: r.display_name,
    title: r.title,
    email: r.email,
    phone: r.phone,
    bio: r.bio,
    color: r.color,
    isActive: r.is_active,
    userId: r.user_id,
    userEmail: r.user_email,
    createdAt: iso(r.created_at),
  };
}

const STAFF_SELECT = `
  SELECT sp.id::text AS id, sp.display_name, sp.title, sp.email, sp.phone, sp.bio, sp.color,
         sp.is_active, sp.user_id::text AS user_id, u.email AS user_email, sp.created_at
  FROM staff_profiles sp
  LEFT JOIN app_users u ON u.id = sp.user_id`;

export async function listStaff(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<StaffMember[]> {
  const rows = await query<StaffRow>(
    `${STAFF_SELECT}
     WHERE sp.tenant_id = $1 AND ($2::boolean OR sp.is_active = true)
     ORDER BY sp.is_active DESC, sp.display_name`,
    [tenantId, opts.includeInactive ?? false]
  );
  return rows.map(mapStaff);
}

export async function getStaff(tenantId: string, id: string): Promise<StaffMember | null> {
  const rows = await query<StaffRow>(`${STAFF_SELECT} WHERE sp.tenant_id = $1 AND sp.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapStaff(rows[0]) : null;
}

/** Is a login account already linked to a *different* provider? (one login ↔ one provider) */
export async function userLinkedElsewhere(tenantId: string, userId: string, exceptStaffId?: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM staff_profiles
     WHERE tenant_id = $1 AND user_id = $2::bigint AND ($3::bigint IS NULL OR id <> $3) LIMIT 1`,
    [tenantId, userId, exceptStaffId ?? null]
  );
  return rows.length > 0;
}

export async function userInTenant(tenantId: string, userId: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM app_users WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, userId]);
  return rows.length > 0;
}

export interface CreateStaffInput {
  displayName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  color: string | null;
  userId: string | null;
}
export async function createStaff(tenantId: string, input: CreateStaffInput): Promise<StaffMember> {
  const rows = await query<{ id: string }>(
    `INSERT INTO staff_profiles (tenant_id, display_name, title, email, phone, bio, color, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id::text AS id`,
    [tenantId, input.displayName, input.title, input.email, input.phone, input.bio, input.color, input.userId]
  );
  const created = await getStaff(tenantId, rows[0].id);
  if (!created) throw new Error("failed to load created staff member");
  return created;
}

export interface UpdateStaffPatch {
  displayName?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
  color?: string | null;
  isActive?: boolean;
  userId?: string | null;
}
export async function updateStaff(tenantId: string, id: string, patch: UpdateStaffPatch): Promise<StaffMember | null> {
  const existing = await getStaff(tenantId, id);
  if (!existing) return null;

  const map: Record<string, string> = {
    displayName: "display_name",
    title: "title",
    email: "email",
    phone: "phone",
    bio: "bio",
    color: "color",
    isActive: "is_active",
    userId: "user_id",
  };
  const sets: string[] = [];
  const params: unknown[] = [tenantId, id];
  for (const [key, col] of Object.entries(map)) {
    if (key in patch) {
      params.push((patch as Record<string, unknown>)[key]);
      const cast = key === "userId" ? "::bigint" : "";
      sets.push(`${col} = $${params.length}${cast}`);
    }
  }
  if (sets.length > 0) {
    await query(`UPDATE staff_profiles SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2`, params);
  }
  return getStaff(tenantId, id);
}

/** Login accounts in this tenant not already linked to another provider (optionally
 *  including the one linked to `exceptStaffId`, so the edit form can show its own). */
export async function listLinkableUsers(tenantId: string, exceptStaffId?: string): Promise<LinkableUser[]> {
  const rows = await query<{ id: string; email: string; display_name: string }>(
    `SELECT u.id::text AS id, u.email, u.display_name
     FROM app_users u
     WHERE u.tenant_id = $1 AND u.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM staff_profiles sp
         WHERE sp.tenant_id = $1 AND sp.user_id = u.id AND ($2::bigint IS NULL OR sp.id <> $2)
       )
     ORDER BY u.display_name`,
    [tenantId, exceptStaffId ?? null]
  );
  return rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name }));
}
