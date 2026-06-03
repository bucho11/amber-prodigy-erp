import type { Router, Response } from "express";
import {
  ownerExists,
  countActiveOwners,
  getUserByEmail,
  getUserById,
  createUser,
  listUsers,
  updateUserRole,
  setUserStatus,
  createSession,
  deleteSession,
  getRolePermissions,
  createInvitation,
  getInvitationByToken,
  markInvitationAccepted,
  listRolesWithPermissions,
  getRoleById,
  getRoleByKey,
  createRole,
  setRolePermissions,
} from "@prodigy/db";
import { PERMISSION_CATALOG, PERMISSION_KEYS, type AuthUser } from "@prodigy/contracts";
import { ValidationError, reqString, reqEmail, reqPassword, wrap } from "./http";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  hashToken,
  parseCookies,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookieOptions,
  requireAuth,
  requirePermission,
  tenantOf,
  userOf,
  loginRateLimited,
  resetLoginAttempts,
} from "./security";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function startSession(res: Response, tenantId: string, userId: string): Promise<void> {
  const token = generateToken();
  await createSession(tenantId, userId, hashToken(token), new Date(Date.now() + SESSION_TTL_MS));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

async function loadAuthUser(tenantId: string, userId: string): Promise<AuthUser> {
  const u = await getUserById(tenantId, userId);
  if (!u) throw new Error("user not found after creation");
  const isOwner = u.role?.isOwner ?? false;
  const permissions = isOwner ? [...PERMISSION_KEYS] : u.role ? await getRolePermissions(tenantId, u.role.id) : [];
  return {
    id: u.id,
    tenantId,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    permissions,
  };
}

export function registerAuthRoutes(api: Router): void {
  // ---- public ----
  api.get(
    "/auth/context",
    wrap(async (req, res) => {
      const t = tenantOf(req);
      const needsSetup = !(await ownerExists(t.id));
      res.json({ tenant: { slug: t.slug, name: t.name }, needsSetup });
    })
  );

  api.get(
    "/auth/me",
    requireAuth,
    wrap(async (req, res) => {
      res.json({ user: userOf(req) });
    })
  );

  api.post(
    "/auth/setup-owner",
    wrap(async (req, res) => {
      const t = tenantOf(req);
      if (await ownerExists(t.id)) {
        res.status(409).json({ error: "This business already has an owner. Please sign in." });
        return;
      }
      const email = reqEmail(req.body?.email);
      const password = reqPassword(req.body?.password);
      const displayName = reqString(req.body?.displayName, "displayName");
      const ownerRole = await getRoleByKey(t.id, "owner");
      if (!ownerRole) {
        res.status(500).json({ error: "Owner role is missing for this business." });
        return;
      }
      if (await getUserByEmail(t.id, email)) {
        res.status(409).json({ error: "That email is already registered." });
        return;
      }
      const user = await createUser(t.id, {
        email,
        displayName,
        passwordHash: hashPassword(password),
        roleId: ownerRole.id,
        status: "active",
      });
      await startSession(res, t.id, user.id);
      res.status(201).json({ user: await loadAuthUser(t.id, user.id) });
    })
  );

  api.post(
    "/auth/login",
    wrap(async (req, res) => {
      const t = tenantOf(req);
      const email = reqEmail(req.body?.email);
      const password = reqPassword(req.body?.password);
      const rlKey = `${t.id}:${email}`;
      if (loginRateLimited(rlKey)) {
        res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
        return;
      }
      const user = await getUserByEmail(t.id, email);
      if (!user || user.status === "disabled" || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ error: "Incorrect email or password." });
        return;
      }
      resetLoginAttempts(rlKey);
      await startSession(res, t.id, user.id);
      res.json({ user: await loadAuthUser(t.id, user.id) });
    })
  );

  api.post(
    "/auth/logout",
    wrap(async (req, res) => {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) await deleteSession(hashToken(token));
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      res.json({ ok: true });
    })
  );

  api.get(
    "/auth/invite/:token",
    wrap(async (req, res) => {
      const inv = await getInvitationByToken(hashToken(req.params.token));
      if (!inv) {
        res.status(404).json({ error: "This invitation is invalid or has expired." });
        return;
      }
      res.json({ email: inv.email, roleName: inv.roleName });
    })
  );

  api.post(
    "/auth/accept-invite",
    wrap(async (req, res) => {
      const token = reqString(req.body?.token, "token");
      const password = reqPassword(req.body?.password);
      const displayName = reqString(req.body?.displayName, "displayName");
      const inv = await getInvitationByToken(hashToken(token));
      if (!inv) {
        res.status(404).json({ error: "This invitation is invalid or has expired." });
        return;
      }
      if (await getUserByEmail(inv.tenantId, inv.email)) {
        res.status(409).json({ error: "You already have an account. Please sign in." });
        return;
      }
      const user = await createUser(inv.tenantId, {
        email: inv.email,
        displayName,
        passwordHash: hashPassword(password),
        roleId: inv.roleId,
        status: "active",
      });
      await markInvitationAccepted(inv.id);
      await startSession(res, inv.tenantId, user.id);
      res.status(201).json({ user: await loadAuthUser(inv.tenantId, user.id) });
    })
  );

  // ---- team management (staff.manage) ----
  api.get(
    "/team/users",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      res.json({ users: await listUsers(u.tenantId) });
    })
  );

  api.post(
    "/team/invites",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const email = reqEmail(req.body?.email);
      const roleId = reqString(req.body?.roleId, "roleId");
      const role = await getRoleById(u.tenantId, roleId);
      if (!role) {
        res.status(400).json({ error: "Unknown role." });
        return;
      }
      if (role.isOwner) {
        res.status(400).json({ error: "You can't invite someone directly as Owner." });
        return;
      }
      if (await getUserByEmail(u.tenantId, email)) {
        res.status(409).json({ error: "That email is already on your team." });
        return;
      }
      const token = generateToken();
      await createInvitation(u.tenantId, {
        email,
        roleId,
        tokenHash: hashToken(token),
        invitedBy: u.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
      const origin = `${req.protocol}://${req.get("host")}`;
      res.status(201).json({ email, roleName: role.name, inviteUrl: `${origin}/accept-invite?token=${token}` });
    })
  );

  api.post(
    "/team/users/:id/role",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const roleId = reqString(req.body?.roleId, "roleId");
      const target = await getUserById(u.tenantId, req.params.id);
      if (!target) {
        res.status(404).json({ error: "Team member not found." });
        return;
      }
      const newRole = await getRoleById(u.tenantId, roleId);
      if (!newRole) {
        res.status(400).json({ error: "Unknown role." });
        return;
      }
      if (newRole.isOwner && !u.role?.isOwner) {
        res.status(403).json({ error: "Only an Owner can assign the Owner role." });
        return;
      }
      if (target.role?.isOwner && !newRole.isOwner && (await countActiveOwners(u.tenantId)) <= 1) {
        res.status(400).json({ error: "You can't remove the last Owner. Assign another Owner first." });
        return;
      }
      await updateUserRole(u.tenantId, req.params.id, roleId);
      res.json({ ok: true });
    })
  );

  api.post(
    "/team/users/:id/status",
    requireAuth,
    requirePermission("staff.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const status = reqString(req.body?.status, "status");
      if (status !== "active" && status !== "disabled") {
        res.status(400).json({ error: "status must be 'active' or 'disabled'." });
        return;
      }
      const target = await getUserById(u.tenantId, req.params.id);
      if (!target) {
        res.status(404).json({ error: "Team member not found." });
        return;
      }
      if (target.id === u.id && status === "disabled") {
        res.status(400).json({ error: "You can't deactivate your own account." });
        return;
      }
      if (target.role?.isOwner && status === "disabled" && (await countActiveOwners(u.tenantId)) <= 1) {
        res.status(400).json({ error: "You can't deactivate the last Owner." });
        return;
      }
      await setUserStatus(u.tenantId, req.params.id, status);
      res.json({ ok: true });
    })
  );

  // ---- roles & permissions (roles.manage) ----
  api.get(
    "/roles",
    requireAuth,
    requirePermission("roles.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      res.json({ roles: await listRolesWithPermissions(u.tenantId), catalog: PERMISSION_CATALOG });
    })
  );

  api.post(
    "/roles",
    requireAuth,
    requirePermission("roles.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const name = reqString(req.body?.name, "name");
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
      const baseKey = `custom_${slug || "role"}`;
      const existing = await listRolesWithPermissions(u.tenantId);
      const keys = new Set(existing.map((r) => r.key));
      let key = baseKey;
      let n = 1;
      while (keys.has(key)) key = `${baseKey}_${n++}`;
      res.status(201).json({ role: await createRole(u.tenantId, key, name) });
    })
  );

  api.put(
    "/roles/:id/permissions",
    requireAuth,
    requirePermission("roles.manage"),
    wrap(async (req, res) => {
      const u = userOf(req);
      const role = await getRoleById(u.tenantId, req.params.id);
      if (!role) {
        res.status(404).json({ error: "Role not found." });
        return;
      }
      if (role.isOwner) {
        res.status(400).json({ error: "The Owner role always has full access and can't be limited." });
        return;
      }
      const body = req.body?.permissions;
      if (!Array.isArray(body)) throw new ValidationError("'permissions' must be an array");
      const valid = new Set(PERMISSION_KEYS);
      const perms = [...new Set(body.map((p) => String(p)))].filter((p) => valid.has(p));
      await setRolePermissions(u.tenantId, req.params.id, perms);
      res.json({ ok: true, permissions: perms });
    })
  );
}
