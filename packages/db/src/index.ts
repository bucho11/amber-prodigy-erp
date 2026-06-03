import { Pool } from "pg";
import type { DbStatus, TenantContext } from "@prodigy/contracts";
import { DEFAULT_ROLES, DEFAULT_ROLE_PERMISSIONS } from "@prodigy/contracts";

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

/** Run a set of statements in a single transaction. The callback gets a scoped
 *  query function; the transaction commits on success and rolls back on throw. */
export async function withTransaction<T>(
  fn: (q: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>
): Promise<T> {
  if (!pool) throw new DbNotConfiguredError();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scoped = async <R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<R[]> => {
      const res = await client.query(text, params);
      return res.rows as R[];
    };
    const result = await fn(scoped);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

    -- Identity & access (RBAC). Roles + permissions are per-tenant and owner-editable.
    CREATE TABLE IF NOT EXISTS roles (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      key         TEXT NOT NULL,
      name        TEXT NOT NULL,
      is_owner    BOOLEAN NOT NULL DEFAULT false,
      is_system   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

    CREATE TABLE IF NOT EXISTS role_permissions (
      tenant_id      BIGINT NOT NULL REFERENCES tenants(id),
      role_id        BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_key)
    );
    CREATE INDEX IF NOT EXISTS idx_role_permissions_tenant ON role_permissions(tenant_id);

    CREATE TABLE IF NOT EXISTS app_users (
      id            BIGSERIAL PRIMARY KEY,
      tenant_id     BIGINT NOT NULL REFERENCES tenants(id),
      email         TEXT NOT NULL,
      password_hash TEXT,
      display_name  TEXT NOT NULL,
      role_id       BIGINT REFERENCES roles(id),
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_app_users_tenant ON app_users(tenant_id);

    CREATE TABLE IF NOT EXISTS sessions (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      user_id     BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS invitations (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      email       TEXT NOT NULL,
      role_id     BIGINT NOT NULL REFERENCES roles(id),
      token_hash  TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'pending',
      invited_by  BIGINT REFERENCES app_users(id),
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);

    -- Clients / CRM (extends the foundation clients table)
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS date_of_birth DATE;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS pronouns TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line1 TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_city TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_state TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_postal TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_source TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(tenant_id, status);

    CREATE TABLE IF NOT EXISTS tags (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tenant ON tags(tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_tenant_name ON tags(tenant_id, lower(name));

    CREATE TABLE IF NOT EXISTS client_tags (
      tenant_id  BIGINT NOT NULL REFERENCES tenants(id),
      client_id  BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tag_id     BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (client_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_client_tags_tenant ON client_tags(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_client_tags_tag ON client_tags(tag_id);

    -- Scheduling
    CREATE TABLE IF NOT EXISTS appointments (
      id                 BIGSERIAL PRIMARY KEY,
      tenant_id          BIGINT NOT NULL REFERENCES tenants(id),
      client_id          BIGINT NOT NULL REFERENCES clients(id),
      provider_id        BIGINT NOT NULL REFERENCES staff_profiles(id),
      room_id            BIGINT REFERENCES rooms(id),
      service_variant_id BIGINT NOT NULL REFERENCES service_variants(id),
      starts_at          TIMESTAMPTZ NOT NULL,
      ends_at            TIMESTAMPTZ NOT NULL,
      price_cents        INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'booked',
      notes              TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_tenant_time ON appointments(tenant_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments(tenant_id, provider_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_room ON appointments(tenant_id, room_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(tenant_id, client_id);

    -- Auto-protocol scheduler (the post-surgical "wedge")
    CREATE TABLE IF NOT EXISTS protocols (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      name        TEXT NOT NULL,
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_protocols_tenant ON protocols(tenant_id);

    CREATE TABLE IF NOT EXISTS protocol_steps (
      id                 BIGSERIAL PRIMARY KEY,
      tenant_id          BIGINT NOT NULL REFERENCES tenants(id),
      protocol_id        BIGINT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
      step_number        INTEGER NOT NULL,
      day_offset         INTEGER NOT NULL,
      time_of_day        TEXT,
      service_variant_id BIGINT NOT NULL REFERENCES service_variants(id),
      label              TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_protocol_steps_protocol ON protocol_steps(protocol_id);

    CREATE TABLE IF NOT EXISTS protocol_instances (
      id            BIGSERIAL PRIMARY KEY,
      tenant_id     BIGINT NOT NULL REFERENCES tenants(id),
      protocol_id   BIGINT REFERENCES protocols(id),
      protocol_name TEXT NOT NULL,
      client_id     BIGINT NOT NULL REFERENCES clients(id),
      anchor_date   DATE NOT NULL,
      provider_id   BIGINT NOT NULL REFERENCES staff_profiles(id),
      room_id       BIGINT REFERENCES rooms(id),
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_protocol_instances_tenant ON protocol_instances(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_protocol_instances_client ON protocol_instances(tenant_id, client_id);

    -- Link generated appointments back to their protocol instance.
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS protocol_instance_id BIGINT REFERENCES protocol_instances(id);

    -- Provider profile fields (slice 7); placed last so app_users exists for the FK.
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS color TEXT;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES app_users(id);

    -- Billing / Stripe Connect state on the tenant (slice 8).
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false;

    -- Point of sale / payments (slice 8). Money in integer cents.
    CREATE TABLE IF NOT EXISTS orders (
      id             BIGSERIAL PRIMARY KEY,
      tenant_id      BIGINT NOT NULL REFERENCES tenants(id),
      client_id      BIGINT REFERENCES clients(id),
      status         TEXT NOT NULL DEFAULT 'open',
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      tax_cents      INTEGER NOT NULL DEFAULT 0,
      tip_cents      INTEGER NOT NULL DEFAULT 0,
      total_cents    INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at      TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(tenant_id, client_id);

    CREATE TABLE IF NOT EXISTS order_line_items (
      id                 BIGSERIAL PRIMARY KEY,
      tenant_id          BIGINT NOT NULL REFERENCES tenants(id),
      order_id           BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      kind               TEXT NOT NULL DEFAULT 'custom',
      description        TEXT NOT NULL,
      quantity           INTEGER NOT NULL DEFAULT 1,
      unit_price_cents   INTEGER NOT NULL DEFAULT 0,
      amount_cents       INTEGER NOT NULL DEFAULT 0,
      taxable            BOOLEAN NOT NULL DEFAULT false,
      service_variant_id BIGINT REFERENCES service_variants(id),
      appointment_id     BIGINT REFERENCES appointments(id)
    );
    CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_line_items(order_id);

    CREATE TABLE IF NOT EXISTS payments (
      id            BIGSERIAL PRIMARY KEY,
      tenant_id     BIGINT NOT NULL REFERENCES tenants(id),
      order_id      BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      method        TEXT NOT NULL,
      amount_cents  INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'recorded',
      processor_ref TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

    -- Clinical records (slice 9). Access is permission-gated (clinical.view / clinical.manage).
    CREATE TABLE IF NOT EXISTS client_intake (
      client_id           BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      tenant_id           BIGINT NOT NULL REFERENCES tenants(id),
      reason_for_visit    TEXT,
      medical_conditions  TEXT,
      medications         TEXT,
      allergies           TEXT,
      surgeries           TEXT,
      injuries            TEXT,
      pregnant            BOOLEAN,
      pressure_preference TEXT,
      areas_to_avoid      TEXT,
      notes               TEXT,
      consent_to_treat    BOOLEAN NOT NULL DEFAULT false,
      signature_name      TEXT,
      signed_at           TIMESTAMPTZ,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_client_intake_tenant ON client_intake(tenant_id);

    CREATE TABLE IF NOT EXISTS soap_notes (
      id             BIGSERIAL PRIMARY KEY,
      tenant_id      BIGINT NOT NULL REFERENCES tenants(id),
      client_id      BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      appointment_id BIGINT REFERENCES appointments(id),
      provider_id    BIGINT REFERENCES staff_profiles(id),
      note_date      DATE NOT NULL,
      subjective     TEXT,
      objective      TEXT,
      assessment     TEXT,
      plan           TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_soap_client ON soap_notes(tenant_id, client_id, note_date DESC);

    -- Provider availability (slice 10): weekly working hours + time off. Minutes = minutes-from-midnight, local wall time.
    CREATE TABLE IF NOT EXISTS provider_hours (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    BIGINT NOT NULL REFERENCES tenants(id),
      provider_id  BIGINT NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
      day_of_week  SMALLINT NOT NULL,
      start_minute INTEGER NOT NULL,
      end_minute   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_hours ON provider_hours(tenant_id, provider_id, day_of_week);

    CREATE TABLE IF NOT EXISTS provider_time_off (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    BIGINT NOT NULL REFERENCES tenants(id),
      provider_id  BIGINT NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
      start_date   DATE NOT NULL,
      end_date     DATE NOT NULL,
      all_day      BOOLEAN NOT NULL DEFAULT true,
      start_minute INTEGER,
      end_minute   INTEGER,
      reason       TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_provider_time_off ON provider_time_off(tenant_id, provider_id, start_date);

    -- Gift cards (slice 11): prepaid stored value, redeemable at checkout. Money in cents.
    CREATE TABLE IF NOT EXISTS gift_cards (
      id            BIGSERIAL PRIMARY KEY,
      tenant_id     BIGINT NOT NULL REFERENCES tenants(id),
      code          TEXT NOT NULL,
      client_id     BIGINT REFERENCES clients(id),
      initial_cents INTEGER NOT NULL,
      balance_cents INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      note          TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_gift_cards_tenant ON gift_cards(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gift_cards_client ON gift_cards(tenant_id, client_id);

    CREATE TABLE IF NOT EXISTS gift_card_txns (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    BIGINT NOT NULL REFERENCES tenants(id),
      gift_card_id BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,       -- issue | redeem | void
      amount_cents INTEGER NOT NULL,    -- signed: +issue, -redeem
      order_id     BIGINT REFERENCES orders(id),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_gift_card_txns ON gift_card_txns(tenant_id, gift_card_id);

    -- Service packages (slice 12): prepaid credits for a service, redeemed at checkout.
    CREATE TABLE IF NOT EXISTS packages (
      id                 BIGSERIAL PRIMARY KEY,
      tenant_id          BIGINT NOT NULL REFERENCES tenants(id),
      client_id          BIGINT NOT NULL REFERENCES clients(id),
      service_variant_id BIGINT NOT NULL REFERENCES service_variants(id),
      total_credits      INTEGER NOT NULL,
      remaining_credits  INTEGER NOT NULL,
      price_cents        INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'active',
      note               TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_packages_client ON packages(tenant_id, client_id);

    CREATE TABLE IF NOT EXISTS package_txns (
      id          BIGSERIAL PRIMARY KEY,
      tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
      package_id  BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,      -- issue | redeem | restore | void
      credits     INTEGER NOT NULL,   -- signed
      order_id    BIGINT REFERENCES orders(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_package_txns ON package_txns(tenant_id, package_id);

    -- Link an order line to the package credit that covered it (placed after packages exists).
    ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS package_id BIGINT REFERENCES packages(id);
  `);
}

/** Seed default roles (+ starter permissions) for a tenant. Permissions seed only
 *  when a role is first created, so later Owner edits are never overwritten. */
async function seedRoles(tenantId: string): Promise<void> {
  if (!pool) return;
  for (const role of DEFAULT_ROLES) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO roles (tenant_id, key, name, is_owner, is_system)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING id`,
      [tenantId, role.key, role.name, role.isOwner]
    );
    const created = res.rows[0];
    if (!created || role.isOwner) continue;
    const perms = DEFAULT_ROLE_PERMISSIONS[role.key] ?? [];
    if (perms.length === 0) continue;
    const placeholders = perms.map((_, i) => `($1, $2, $${i + 3})`).join(", ");
    await pool.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission_key)
       VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      [tenantId, created.id, ...perms]
    );
  }
}

/** Seed tenant #1 (Prodigy) + roles + confirmed staff + confirmed massage menu. Idempotent. */
async function seedTenantOne(): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tenants (slug, name, timezone)
     VALUES ('prodigy', 'Prodigy Massage and Wellness', 'America/Los_Angeles')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const tenantId = rows[0].id;

  await seedRoles(tenantId);

  await pool.query(
    `INSERT INTO staff_profiles (tenant_id, display_name, title)
     SELECT $1::bigint, v.name, v.title
     FROM (VALUES ('Amber', 'Owner / Massage Therapist')) AS v(name, title)
     WHERE NOT EXISTS (
       SELECT 1 FROM staff_profiles s WHERE s.tenant_id = $1::bigint AND s.display_name = v.name
     )`,
    [tenantId]
  );

  // One-time cleanup: remove the early placeholder 'Keshia' staff profile from existing
  // databases (FK-safe: skips if any appointment references it).
  await pool.query(
    `DELETE FROM staff_profiles
     WHERE tenant_id = $1::bigint AND display_name = 'Keshia' AND title = 'Esthetician'
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.provider_id = staff_profiles.id)`,
    [tenantId]
  );

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
  console.log("[db] schema applied + tenant #1 + roles + service menu seeded.");
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
export * from "./auth";
export * from "./clients";
export * from "./scheduling";
export * from "./protocols";
export * from "./staff";
export * from "./payments";
export * from "./clinical";
export * from "./availability";
export * from "./giftcards";
export * from "./packages";
