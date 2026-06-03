import { query } from "./index";
import type { ServiceCategory, ServiceVariant, Service, Room } from "@prodigy/contracts";

interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}
interface ServiceRow {
  id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
}
interface VariantRow {
  id: string;
  service_id: string;
  name: string;
  duration_minutes: number;
  price_cents: number;
  is_active: boolean;
}
interface RoomRow {
  id: string;
  name: string;
  is_active: boolean;
}

const mapCategory = (r: CategoryRow): ServiceCategory => ({
  id: r.id,
  name: r.name,
  sortOrder: r.sort_order,
  isActive: r.is_active,
});
const mapVariant = (r: VariantRow): ServiceVariant => ({
  id: r.id,
  serviceId: r.service_id,
  name: r.name,
  durationMinutes: r.duration_minutes,
  priceCents: r.price_cents,
  isActive: r.is_active,
});
const mapService = (r: ServiceRow, variants: ServiceVariant[]): Service => ({
  id: r.id,
  categoryId: r.category_id,
  categoryName: r.category_name,
  name: r.name,
  description: r.description,
  isActive: r.is_active,
  variants,
});
const mapRoom = (r: RoomRow): Room => ({ id: r.id, name: r.name, isActive: r.is_active });

// ---------- Categories ----------
export async function listCategories(tenantId: string): Promise<ServiceCategory[]> {
  const rows = await query<CategoryRow>(
    `SELECT id::text AS id, name, sort_order, is_active
     FROM service_categories WHERE tenant_id = $1 ORDER BY sort_order, name`,
    [tenantId]
  );
  return rows.map(mapCategory);
}

export async function createCategory(
  tenantId: string,
  input: { name: string; sortOrder?: number }
): Promise<ServiceCategory> {
  const rows = await query<CategoryRow>(
    `INSERT INTO service_categories (tenant_id, name, sort_order)
     VALUES ($1, $2, COALESCE($3::integer, 0))
     RETURNING id::text AS id, name, sort_order, is_active`,
    [tenantId, input.name, input.sortOrder ?? null]
  );
  return mapCategory(rows[0]);
}

export async function updateCategory(
  tenantId: string,
  id: string,
  patch: { name?: string; sortOrder?: number; isActive?: boolean }
): Promise<ServiceCategory | null> {
  const rows = await query<CategoryRow>(
    `UPDATE service_categories SET
       name = COALESCE($3::text, name),
       sort_order = COALESCE($4::integer, sort_order),
       is_active = COALESCE($5::boolean, is_active)
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text AS id, name, sort_order, is_active`,
    [tenantId, id, patch.name ?? null, patch.sortOrder ?? null, patch.isActive ?? null]
  );
  return rows[0] ? mapCategory(rows[0]) : null;
}

// ---------- Services (+ variants) ----------
export async function listServices(tenantId: string): Promise<Service[]> {
  const serviceRows = await query<ServiceRow>(
    `SELECT s.id::text AS id, s.category_id::text AS category_id, sc.name AS category_name,
            s.name, s.description, s.is_active
     FROM services s LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.tenant_id = $1
     ORDER BY COALESCE(sc.sort_order, 999), sc.name NULLS LAST, s.name`,
    [tenantId]
  );
  const variantRows = await query<VariantRow>(
    `SELECT id::text AS id, service_id::text AS service_id, name, duration_minutes, price_cents, is_active
     FROM service_variants WHERE tenant_id = $1 ORDER BY duration_minutes, name`,
    [tenantId]
  );
  const byService = new Map<string, ServiceVariant[]>();
  for (const v of variantRows) {
    const arr = byService.get(v.service_id) ?? [];
    arr.push(mapVariant(v));
    byService.set(v.service_id, arr);
  }
  return serviceRows.map((s) => mapService(s, byService.get(s.id) ?? []));
}

export async function createService(
  tenantId: string,
  input: { name: string; categoryId?: string | null; description?: string | null }
): Promise<Service> {
  const rows = await query<ServiceRow>(
    `INSERT INTO services (tenant_id, category_id, name, description)
     VALUES ($1, $2::bigint, $3, $4::text)
     RETURNING id::text AS id, category_id::text AS category_id, NULL::text AS category_name, name, description, is_active`,
    [tenantId, input.categoryId ?? null, input.name, input.description ?? null]
  );
  return mapService(rows[0], []);
}

export async function updateService(
  tenantId: string,
  id: string,
  patch: { name?: string; categoryId?: string | null; description?: string | null; isActive?: boolean }
): Promise<Service | null> {
  const rows = await query<ServiceRow>(
    `UPDATE services SET
       name = COALESCE($3::text, name),
       category_id = COALESCE($4::bigint, category_id),
       description = COALESCE($5::text, description),
       is_active = COALESCE($6::boolean, is_active)
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text AS id, category_id::text AS category_id, NULL::text AS category_name, name, description, is_active`,
    [tenantId, id, patch.name ?? null, patch.categoryId ?? null, patch.description ?? null, patch.isActive ?? null]
  );
  return rows[0] ? mapService(rows[0], []) : null;
}

// ---------- Variants ----------
export async function createVariant(
  tenantId: string,
  serviceId: string,
  input: { name: string; durationMinutes: number; priceCents: number }
): Promise<ServiceVariant | null> {
  // INSERT...SELECT guarantees the parent service belongs to this tenant.
  const rows = await query<VariantRow>(
    `INSERT INTO service_variants (tenant_id, service_id, name, duration_minutes, price_cents)
     SELECT $1, s.id, $3, $4::integer, $5::integer
     FROM services s WHERE s.id = $2::bigint AND s.tenant_id = $1
     RETURNING id::text AS id, service_id::text AS service_id, name, duration_minutes, price_cents, is_active`,
    [tenantId, serviceId, input.name, input.durationMinutes, input.priceCents]
  );
  return rows[0] ? mapVariant(rows[0]) : null;
}

export async function updateVariant(
  tenantId: string,
  id: string,
  patch: { name?: string; durationMinutes?: number; priceCents?: number; isActive?: boolean }
): Promise<ServiceVariant | null> {
  const rows = await query<VariantRow>(
    `UPDATE service_variants SET
       name = COALESCE($3::text, name),
       duration_minutes = COALESCE($4::integer, duration_minutes),
       price_cents = COALESCE($5::integer, price_cents),
       is_active = COALESCE($6::boolean, is_active)
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text AS id, service_id::text AS service_id, name, duration_minutes, price_cents, is_active`,
    [tenantId, id, patch.name ?? null, patch.durationMinutes ?? null, patch.priceCents ?? null, patch.isActive ?? null]
  );
  return rows[0] ? mapVariant(rows[0]) : null;
}

// ---------- Rooms ----------
export async function listRooms(tenantId: string): Promise<Room[]> {
  const rows = await query<RoomRow>(
    `SELECT id::text AS id, name, is_active FROM rooms WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return rows.map(mapRoom);
}

export async function createRoom(tenantId: string, input: { name: string }): Promise<Room> {
  const rows = await query<RoomRow>(
    `INSERT INTO rooms (tenant_id, name) VALUES ($1, $2)
     RETURNING id::text AS id, name, is_active`,
    [tenantId, input.name]
  );
  return mapRoom(rows[0]);
}

export async function updateRoom(
  tenantId: string,
  id: string,
  patch: { name?: string; isActive?: boolean }
): Promise<Room | null> {
  const rows = await query<RoomRow>(
    `UPDATE rooms SET name = COALESCE($3::text, name), is_active = COALESCE($4::boolean, is_active)
     WHERE tenant_id = $1 AND id = $2
     RETURNING id::text AS id, name, is_active`,
    [tenantId, id, patch.name ?? null, patch.isActive ?? null]
  );
  return rows[0] ? mapRoom(rows[0]) : null;
}
