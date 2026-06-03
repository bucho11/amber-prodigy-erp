import { query, withTransaction } from "./index";
import { getOrder, OrderNotFoundError, OrderClosedError } from "./payments";
import { postPackageSold } from "./ledger";
import type { ServicePackage, PackageTxn, Order } from "@prodigy/contracts";

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageError";
  }
}

interface PkgRow {
  id: string;
  client_id: string;
  client_name: string | null;
  service_variant_id: string;
  service_name: string | null;
  total_credits: number;
  remaining_credits: number;
  price_cents: number;
  status: ServicePackage["status"];
  note: string | null;
  created_at: string | Date;
}
function mapPkg(r: PkgRow): ServicePackage {
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    serviceVariantId: r.service_variant_id,
    serviceName: r.service_name,
    totalCredits: r.total_credits,
    remainingCredits: r.remaining_credits,
    priceCents: r.price_cents,
    status: r.status,
    note: r.note,
    createdAt: iso(r.created_at),
  };
}

const PKG_SELECT = `
  SELECT p.id::text AS id, p.client_id::text AS client_id, c.display_name AS client_name,
         p.service_variant_id::text AS service_variant_id, (s.name || ' · ' || sv.name) AS service_name,
         p.total_credits, p.remaining_credits, p.price_cents, p.status, p.note, p.created_at
  FROM packages p
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN service_variants sv ON sv.id = p.service_variant_id
  LEFT JOIN services s ON s.id = sv.service_id`;

export async function sellPackage(
  tenantId: string,
  input: { clientId: string; serviceVariantId: string; totalCredits: number; priceCents: number; note: string | null }
): Promise<ServicePackage> {
  let id = "";
  await withTransaction(async (q) => {
    const rows = await q<{ id: string }>(
      `INSERT INTO packages (tenant_id, client_id, service_variant_id, total_credits, remaining_credits, price_cents, status, note)
       VALUES ($1, $2::bigint, $3::bigint, $4, $4, $5, 'active', $6) RETURNING id::text AS id`,
      [tenantId, input.clientId, input.serviceVariantId, input.totalCredits, input.priceCents, input.note]
    );
    id = rows[0].id;
    await q(`INSERT INTO package_txns (tenant_id, package_id, kind, credits) VALUES ($1, $2::bigint, 'issue', $3)`, [
      tenantId,
      id,
      input.totalCredits,
    ]);
  });
  const pkg = await getPackage(tenantId, id);
  if (!pkg) throw new Error("failed to load sold package");
  try {
    await postPackageSold(tenantId, { id: pkg.id, priceCents: pkg.priceCents, serviceName: pkg.serviceName });
  } catch (e) {
    console.error("[ledger] package post failed", e);
  }
  return pkg;
}

export async function listPackages(tenantId: string, opts: { clientId?: string } = {}): Promise<ServicePackage[]> {
  const rows = await query<PkgRow>(
    `${PKG_SELECT}
     WHERE p.tenant_id = $1 AND ($2::bigint IS NULL OR p.client_id = $2)
     ORDER BY p.created_at DESC LIMIT 200`,
    [tenantId, opts.clientId ?? null]
  );
  return rows.map(mapPkg);
}

export async function getPackage(tenantId: string, id: string): Promise<ServicePackage | null> {
  const rows = await query<PkgRow>(`${PKG_SELECT} WHERE p.tenant_id = $1 AND p.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapPkg(rows[0]) : null;
}

/** Active packages with credits remaining for a client (for checkout redemption). */
export async function listRedeemablePackages(tenantId: string, clientId: string): Promise<ServicePackage[]> {
  const rows = await query<PkgRow>(
    `${PKG_SELECT}
     WHERE p.tenant_id = $1 AND p.client_id = $2 AND p.status = 'active' AND p.remaining_credits > 0
     ORDER BY p.created_at`,
    [tenantId, clientId]
  );
  return rows.map(mapPkg);
}

export async function voidPackage(tenantId: string, id: string): Promise<ServicePackage | null> {
  const existing = await getPackage(tenantId, id);
  if (!existing) return null;
  if (existing.status === "void") return existing;
  await withTransaction(async (q) => {
    await q(`UPDATE packages SET status = 'void' WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    await q(`INSERT INTO package_txns (tenant_id, package_id, kind, credits) VALUES ($1, $2::bigint, 'void', $3)`, [
      tenantId,
      id,
      -existing.remainingCredits,
    ]);
  });
  return getPackage(tenantId, id);
}

export async function listPackageTxns(tenantId: string, packageId: string): Promise<PackageTxn[]> {
  const rows = await query<{ id: string; kind: string; credits: number; order_id: string | null; created_at: string | Date }>(
    `SELECT id::text AS id, kind, credits, order_id::text AS order_id, created_at
     FROM package_txns WHERE tenant_id = $1 AND package_id = $2 ORDER BY id DESC`,
    [tenantId, packageId]
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, credits: r.credits, orderId: r.order_id, createdAt: iso(r.created_at) }));
}

/** Atomically redeem one package credit onto an open order as a $0 service line. */
export async function redeemPackageToOrder(
  tenantId: string,
  orderId: string,
  packageId: string,
  appointmentId: string | null
): Promise<Order> {
  const pkg = await getPackage(tenantId, packageId);
  if (!pkg) throw new PackageError("Package not found.");
  const description = pkg.serviceName ? `${pkg.serviceName} (package credit)` : "Package credit";

  await withTransaction(async (q) => {
    const ord = await q<{ status: string; client_id: string | null }>(
      `SELECT status, client_id::text AS client_id FROM orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    if (!ord[0]) throw new OrderNotFoundError();
    if (ord[0].status !== "open") throw new OrderClosedError();

    const pr = await q<{ status: string; remaining_credits: number; client_id: string; service_variant_id: string }>(
      `SELECT status, remaining_credits, client_id::text AS client_id, service_variant_id::text AS service_variant_id
       FROM packages WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, packageId]
    );
    const row = pr[0];
    if (!row) throw new PackageError("Package not found.");
    if (row.status !== "active") throw new PackageError("That package isn't active.");
    if (row.remaining_credits < 1) throw new PackageError("That package has no credits left.");
    if (!ord[0].client_id) throw new PackageError("Attach the client to this sale before redeeming their package.");
    if (ord[0].client_id !== row.client_id) throw new PackageError("That package belongs to a different client.");

    await q(
      `INSERT INTO order_line_items
         (tenant_id, order_id, kind, description, quantity, unit_price_cents, amount_cents, taxable, service_variant_id, appointment_id, package_id)
       VALUES ($1, $2::bigint, 'service', $3, 1, 0, 0, false, $4::bigint, $5::bigint, $6::bigint)`,
      [tenantId, orderId, description, row.service_variant_id, appointmentId, packageId]
    );
    await q(`UPDATE packages SET remaining_credits = remaining_credits - 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, packageId]);
    await q(`INSERT INTO package_txns (tenant_id, package_id, kind, credits, order_id) VALUES ($1, $2::bigint, 'redeem', -1, $3::bigint)`, [
      tenantId,
      packageId,
      orderId,
    ]);
  });

  const order = await getOrder(tenantId, orderId);
  if (!order) throw new Error("failed to load order after redemption");
  return order;
}
