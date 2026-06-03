import { Pool } from "pg";
import type { DbStatus } from "@prodigy/contracts";

const DATABASE_URL = process.env.DATABASE_URL;

let pool: Pool | null = null;
if (DATABASE_URL) {
  const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    max: 5,
  });
}

export function isDbConfigured(): boolean {
  return pool !== null;
}

/**
 * Self-healing schema (brief 7.2): idempotent DDL applied at every boot so the
 * running app converges to the expected schema with no manual migration step.
 * Foundation tables only for this slice.
 */
async function applySchema(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id          BIGSERIAL PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      timezone    TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    BIGINT NOT NULL REFERENCES tenants(id),
      external_id  TEXT,
      email        TEXT,
      display_name TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'front_desk',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant ON user_profiles(tenant_id);

    CREATE TABLE IF NOT EXISTS staff_profiles (
      id            BIGSERIAL PRIMARY KEY,
      tenant_id     BIGINT NOT NULL REFERENCES tenants(id),
      display_name  TEXT NOT NULL,
      title         TEXT,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_staff_profiles_tenant ON staff_profiles(tenant_id);

    CREATE TABLE IF NOT EXISTS clients (
      id               BIGSERIAL PRIMARY KEY,
      tenant_id        BIGINT NOT NULL REFERENCES tenants(id),
      display_name     TEXT NOT NULL,
      email            TEXT,
      phone            TEXT,
      marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);
  `);
}

/** Seed tenant #1 (Prodigy) and the two confirmed staff. Idempotent. */
async function seedTenantOne(): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tenants (slug, name, timezone)
     VALUES ('prodigy', 'Prodigy Massage and Wellness', 'America/Los_Angeles')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const tenantId = rows[0].id;
  await pool.query(
    `INSERT INTO staff_profiles (tenant_id, display_name, title)
     SELECT $1::bigint, v.name, v.title
     FROM (VALUES ('Amber', 'Owner / Massage Therapist'),
                  ('Keshia', 'Esthetician')) AS v(name, title)
     WHERE NOT EXISTS (
       SELECT 1 FROM staff_profiles s
       WHERE s.tenant_id = $1::bigint AND s.display_name = v.name
     )`,
    [tenantId]
  );
}

/** Run at boot. Never fatal: the app must boot even with no database. */
export async function initDb(): Promise<void> {
  if (!pool) {
    console.warn(
      "[db] DATABASE_URL not set - booting WITHOUT a database. Provision Postgres and redeploy to activate persistence."
    );
    return;
  }
  await applySchema();
  await seedTenantOne();
  console.log("[db] schema applied + tenant #1 seeded.");
}

export async function getDbStatus(): Promise<DbStatus> {
  if (!pool) return { configured: false, connected: false, tenants: null, staff: null };
  try {
    const t = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM tenants");
    const s = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM staff_profiles");
    return {
      configured: true,
      connected: true,
      tenants: Number(t.rows[0].count),
      staff: Number(s.rows[0].count),
    };
  } catch (err) {
    return { configured: true, connected: false, tenants: null, staff: null, error: (err as Error).message };
  }
}
