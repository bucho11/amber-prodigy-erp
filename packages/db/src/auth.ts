import { query } from "./index";
import type { AuthUserRole, TeamMember, RoleWithPermissions } from "@prodigy/contracts";

// ---------- row types ----------
interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  status: string;
  role_id: string | null;
  role_key: string | null;
  role_name: string | null;
  role_is_owner: boolean | null;
}

const USER_SELECT = `
  SELECT u.id::text AS id, u.email, u.password_hash, u.display_name, u.status,
         r.id::text AS role_id, r.key AS role_key, r.name AS role_name, r.is_owner AS role_is_owner
  FROM app_users u LEFT JOIN roles r ON r.id = u.role_id`;

function mapRole(row: UserRow): AuthUserRole | null {
  if (!row.role_id || !row.role_key || row.role_name === null) return null;
  return { id: row.role_id, key: row.role_key, name: row.role_name, isOwner: row.role_is_owner ?? false };
}

export interface DbUser {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  status: string;
  role: AuthUserRole | null;
}

function mapUser(row: UserRow): DbUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    status: row.status,
    role: mapRole(row),
  };
}

// ---------- users ----------
export async function ownerExists(tenantId: string): Promise<boolean> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM app_users u JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_id = $1 AND r.is_owner = true AND u.status <> 'disabled'`,
    [tenantId]
  );
  return Number(rows[0]?.n ?? "0") > 0;
}

export async function countActiveOwners(tenantId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM app_users u JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_id = $1 AND r.is_owner = true AND u.status = 'active'`,
    [tenantId]
  );
  return Number(rows[0]?.n ?? "0");
}

export async function getUserByEmail(tenantId: string, email: string): Promise<DbUser | null> {
  const rows = await query<UserRow>(`${USER_SELECT} WHERE u.tenant_id = $1 AND u.email = $2 LIMIT 1`, [
    tenantId,
    email.toLowerCase(),
  ]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getUserById(tenantId: string, id: string): Promise<DbUser | null> {
  const rows = await query<UserRow>(`${USER_SELECT} WHERE u.tenant_id = $1 AND u.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function createUser(
  tenantId: string,
  input: { email: string; displayName: string; passwordHash: string | null; roleId: string; status: string }
): Promise<DbUser> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO app_users (tenant_id, email, display_name, password_hash, role_id, status)
     VALUES ($1, $2, $3, $4, $5::bigint, $6)
     RETURNING id::text AS id`,
    [tenantId, input.email.toLowerCase(), input.displayName, input.passwordHash, input.roleId, input.status]
  );
  const user = await getUserById(tenantId, inserted[0].id);
  if (!user) throw new Error("failed to load created user");
  return user;
}

export async function setUserPassword(tenantId: string, userId: string, passwordHash: string): Promise<void> {
  await query(
    `UPDATE app_users SET password_hash = $3, status = 'active' WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId, passwordHash]
  );
}

export async function listUsers(tenantId: string): Promise<TeamMember[]> {
  const rows = await query<UserRow>(`${USER_SELECT} WHERE u.tenant_id = $1 ORDER BY u.created_at`, [tenantId]);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    status: r.status,
    role: mapRole(r),
  }));
}

export async function updateUserRole(tenantId: string, userId: string, roleId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE app_users SET role_id = $3::bigint
     WHERE tenant_id = $1 AND id = $2
       AND EXISTS (SELECT 1 FROM roles r WHERE r.id = $3::bigint AND r.tenant_id = $1)
     RETURNING id`,
    [tenantId, userId, roleId]
  );
  return rows.length > 0;
}

export async function setUserStatus(tenantId: string, userId: string, status: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE app_users SET status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, userId, status]
  );
  return rows.length > 0;
}

// ---------- sessions ----------
export interface SessionUser {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  status: string;
  role: AuthUserRole | null;
}

export async function createSession(
  tenantId: string,
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await query(
    `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [tenantId, userId, tokenHash, expiresAt.toISOString()]
  );
}

export async function getSessionUser(tokenHash: string): Promise<SessionUser | null> {
  const rows = await query<{
    user_id: string;
    tenant_id: string;
    email: string;
    display_name: string;
    status: string;
    role_id: string | null;
    role_key: string | null;
    role_name: string | null;
    role_is_owner: boolean | null;
  }>(
    `SELECT s.user_id::text AS user_id, s.tenant_id::text AS tenant_id,
            u.email, u.display_name, u.status,
            r.id::text AS role_id, r.key AS role_key, r.name AS role_name, r.is_owner AS role_is_owner
     FROM sessions s
     JOIN app_users u ON u.id = s.user_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
     LIMIT 1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    role:
      row.role_id && row.role_key && row.role_name !== null
        ? { id: row.role_id, key: row.role_key, name: row.role_name, isOwner: row.role_is_owner ?? false }
        : null,
  };
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

// ---------- invitations ----------
export interface DbInvitation {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  status: string;
}

export async function createInvitation(
  tenantId: string,
  input: { email: string; roleId: string; tokenHash: string; invitedBy: string; expiresAt: Date }
): Promise<void> {
  await query(
    `INSERT INTO invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3::bigint, $4, $5::bigint, $6)`,
    [tenantId, input.email.toLowerCase(), input.roleId, input.tokenHash, input.invitedBy, input.expiresAt.toISOString()]
  );
}

export async function getInvitationByToken(tokenHash: string): Promise<(DbInvitation & { tenantId: string }) | null> {
  const rows = await query<{
    id: string;
    tenant_id: string;
    email: string;
    role_id: string;
    role_name: string;
    status: string;
  }>(
    `SELECT i.id::text AS id, i.tenant_id::text AS tenant_id, i.email, i.role_id::text AS role_id,
            r.name AS role_name, i.status
     FROM invitations i JOIN roles r ON r.id = i.role_id
     WHERE i.token_hash = $1 AND i.status = 'pending' AND i.expires_at > now()
     LIMIT 1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, tenantId: row.tenant_id, email: row.email, roleId: row.role_id, roleName: row.role_name, status: row.status };
}

export async function markInvitationAccepted(id: string): Promise<void> {
  await query(`UPDATE invitations SET status = 'accepted' WHERE id = $1`, [id]);
}

// ---------- roles & permissions ----------
interface RoleRow {
  id: string;
  key: string;
  name: string;
  is_owner: boolean;
  is_system: boolean;
}

export async function listRolesWithPermissions(tenantId: string): Promise<RoleWithPermissions[]> {
  const roles = await query<RoleRow>(
    `SELECT id::text AS id, key, name, is_owner, is_system FROM roles WHERE tenant_id = $1 ORDER BY is_owner DESC, name`,
    [tenantId]
  );
  const perms = await query<{ role_id: string; permission_key: string }>(
    `SELECT role_id::text AS role_id, permission_key FROM role_permissions WHERE tenant_id = $1`,
    [tenantId]
  );
  const byRole = new Map<string, string[]>();
  for (const p of perms) {
    const arr = byRole.get(p.role_id) ?? [];
    arr.push(p.permission_key);
    byRole.set(p.role_id, arr);
  }
  return roles.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    isOwner: r.is_owner,
    isSystem: r.is_system,
    permissions: byRole.get(r.id) ?? [],
  }));
}

export async function getRoleById(
  tenantId: string,
  id: string
): Promise<{ id: string; key: string; name: string; isOwner: boolean; isSystem: boolean } | null> {
  const rows = await query<RoleRow>(
    `SELECT id::text AS id, key, name, is_owner, is_system FROM roles WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id]
  );
  const r = rows[0];
  return r ? { id: r.id, key: r.key, name: r.name, isOwner: r.is_owner, isSystem: r.is_system } : null;
}

export async function getRoleByKey(
  tenantId: string,
  key: string
): Promise<{ id: string; key: string; name: string; isOwner: boolean } | null> {
  const rows = await query<RoleRow>(
    `SELECT id::text AS id, key, name, is_owner, is_system FROM roles WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, key]
  );
  const r = rows[0];
  return r ? { id: r.id, key: r.key, name: r.name, isOwner: r.is_owner } : null;
}

export async function getRolePermissions(tenantId: string, roleId: string): Promise<string[]> {
  const rows = await query<{ permission_key: string }>(
    `SELECT permission_key FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`,
    [tenantId, roleId]
  );
  return rows.map((r) => r.permission_key);
}

export async function createRole(tenantId: string, key: string, name: string): Promise<RoleWithPermissions> {
  const rows = await query<RoleRow>(
    `INSERT INTO roles (tenant_id, key, name, is_owner, is_system)
     VALUES ($1, $2, $3, false, false)
     RETURNING id::text AS id, key, name, is_owner, is_system`,
    [tenantId, key, name]
  );
  const r = rows[0];
  return { id: r.id, key: r.key, name: r.name, isOwner: r.is_owner, isSystem: r.is_system, permissions: [] };
}

/** Replace a role's permission set. Caller must ensure the role is not the Owner role. */
export async function setRolePermissions(tenantId: string, roleId: string, permissions: string[]): Promise<void> {
  await query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`, [tenantId, roleId]);
  if (permissions.length === 0) return;
  const placeholders = permissions.map((_, i) => `($1, $2, $${i + 3})`).join(", ");
  await query(
    `INSERT INTO role_permissions (tenant_id, role_id, permission_key) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    [tenantId, roleId, ...permissions]
  );
}
