import crypto from "node:crypto";
import type { Request, RequestHandler } from "express";
import { getSessionUser, getRolePermissions } from "@prodigy/db";
import { PERMISSION_KEYS, type AuthUser, type TenantContext } from "@prodigy/contracts";

// ---------- password hashing (scrypt; built into Node, no native deps) ----------
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

// ---------- session tokens ----------
export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const SESSION_COOKIE = "pmw_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.ALLOW_INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// ---------- request context helpers ----------
export function tenantOf(req: Request): TenantContext {
  if (!req.tenant) throw new Error("tenant context not resolved");
  return req.tenant;
}
export function userOf(req: Request): AuthUser {
  if (!req.user) throw new Error("user not authenticated");
  return req.user;
}

// ---------- middleware ----------
export const requireAuth: RequestHandler = (req, res, next) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  getSessionUser(hashToken(token))
    .then(async (su) => {
      if (!su || su.status === "disabled") {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const isOwner = su.role?.isOwner ?? false;
      const permissions = isOwner
        ? [...PERMISSION_KEYS]
        : su.role
        ? await getRolePermissions(su.tenantId, su.role.id)
        : [];
      req.user = {
        id: su.userId,
        tenantId: su.tenantId,
        email: su.email,
        displayName: su.displayName,
        role: su.role,
        permissions,
      };
      next();
    })
    .catch(next);
};

export const requirePermission = (key: string): RequestHandler => (req, res, next) => {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (u.role?.isOwner || u.permissions.includes(key)) {
    next();
    return;
  }
  res.status(403).json({ error: "You don't have permission to do that." });
};

// ---------- crude in-memory login rate limiter ----------
const attempts = new Map<string, { count: number; first: number }>();
const RL_MAX = 10;
const RL_WINDOW_MS = 15 * 60 * 1000;

export function loginRateLimited(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > RL_WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > RL_MAX;
}
export function resetLoginAttempts(key: string): void {
  attempts.delete(key);
}
