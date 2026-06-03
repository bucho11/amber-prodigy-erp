import { Pool } from "pg";
import type { DbStatus, TenantContext } from "@prodigy/contracts";

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

export class DbNotConfiguredError extends Error {
  constructor() {
    super("Database is not configured (DATABASE_URL not set).");
    this.name = "DbNotConfiguredError";
  }
}

export function isDbConfigured(): boolean {
  return pool !== null;
}

/** Tenant-scoped query helper used by data-access modules. Throws if no DB. */
export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  if (!pool) throw new DbNotConfiguredError();
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/**
 * Self-healing schema (brief 7.2): idempotent DDL applied at every boot so the
 * running app converges to the expected schema with no manual migration step.
 */
async function applySchema(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    -- Foundation (multi-tenant core)
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

    -- Service catalog & resources
    CREATE TABLE IF NOT EXISTS service_categories (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      name        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_service_categories_tenant ON service_categories(tenant_id);

    CREATE TABLE IF NOT EXISTS services (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    BIGINT NOT NULL REFERENCES tenants(id),
      category_id  BIGINT REFERENCES service_categories(id),
      name         TEXT NOT NULL,
      description  TEXT,
      is_active    BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);

    CREATE TABLE IF NOT EXISTS service_variants (
      id               BIGSERIAL PRIMARY KEY,
      tenant_id        BIGINT NOT NULL REFERENCES tenants(id),
      service_id       BIGINT NOT NULL REFERENCES services(id),
      name             TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      price_cents      INTEGER NOT NULL,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_service_variants_tenant ON service_variants(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_service_variants_service ON service_variants(service_id);

    CREATE TABLE IF NOT EXISTS rooms (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      name        TEXT NOT NULL,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_rooms_tenant ON rooms(tenant_id);
  `);
}

/** Seed tenant #1 (Prodigy) + confirmed staff + confirmed massage menu. Idempotent. */
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
       SELECT 1 FROM staff_profiles s WHERE s.tenant_id = $1::bigint AND s.display_name = v.name
     )`,
    [tenantId]
  );

  // Service categories (the niche's natural groupings).
  await pool.query(
    `INSERT INTO service_categories (tenant_id, name, sort_order)
     SELECT $1::bigint, c.name, c.ord
     FROM (VALUES ('Massage & Body', 1),
                  ('Skin Care', 2),
                  ('Lymphatic & Post-Surgical', 3),
                  ('Retail', 4)) AS c(name, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM service_categories sc WHERE sc.tenant_id = $1::bigint AND sc.name = c.name
     )`,
    [tenantId]
  );

  // Confirmed service: Therapeutic Massage (under Massage & Body).
  await pool.query(
    `INSERT INTO services (tenant_id, category_id, name, description)
     SELECT $1::bigint, sc.id, 'Therapeutic Massage', 'Customized therapeutic massage (Swedish, deep tissue, sports).'
     FROM service_categories sc
     WHERE sc.tenant_id = $1::bigint AND sc.name = 'Massage & Body'
       AND NOT EXISTS (
         SELECT 1 FROM services s WHERE s.tenant_id = $1::bigint AND s.name = 'Therapeutic Massage'
       )`,
    [tenantId]
  );

  // Confirmed pricing: 60/90/120 min = $125 / $185 / $245 (stored in cents).
  await pool.query(
    `INSERT INTO service_variants (tenant_id, service_id, name, duration_minutes, price_cents)
     SELECT $1::bigint, s.id, v.name, v.dur, v.price
     FROM services s
     CROSS JOIN (VALUES ('60 min', 60, 12500),
                        ('90 min', 90, 18500),
                        ('120 min', 120, 24500)) AS v(name, dur, price)
     WHERE s.tenant_id = $1::bigint AND s.name = 'Therapeutic Massage'
       AND NOT EXISTS (
         SELECT 1 FROM service_variants sv WHERE sv.tenant_id = $1::bigint AND sv.service_id = s.id
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
  console.log("[db] schema applied + tenant #1 + service menu seeded.");
}

export async function getDbStatus(): Promise<DbStatus> {
  if (!pool) return { configured: false, connected: false, tenants: null, staff: null };
  try {
    const t = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM tenants");
    const s = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM staff_profiles");
    return { configured: true, connected: true, tenants: Number(t.rows[0].count), staff: Number(s.rows[0].count) };
  } catch (err) {
    return { configured: true, connected: false, tenants: null, staff: null, error: (err as Error).message };
  }
}

export async function getTenantBySlug(slug: string): Promise<TenantContext | null> {
  const rows = await query<{ id: string; slug: string; name: string; timezone: string }>(
    "SELECT id::text AS id, slug, name, timezone FROM tenants WHERE slug = $1 LIMIT 1",
    [slug]
  );
  return rows[0] ?? null;
}

export * from "./catalog";
