import { query, withTransaction } from "./index";
import type { Order, Product, ProductTxn } from "@prodigy/contracts";

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  price_cents: number;
  cost_cents: number;
  taxable: boolean;
  track_inventory: boolean;
  stock_qty: number;
  reorder_point: number;
  is_active: boolean;
  created_at: string | Date;
}
function mapProduct(r: ProductRow): Product {
  return {
    id: r.id,
    name: r.name,
    sku: r.sku,
    priceCents: r.price_cents,
    costCents: r.cost_cents,
    taxable: r.taxable,
    trackInventory: r.track_inventory,
    stockQty: r.stock_qty,
    reorderPoint: r.reorder_point,
    belowReorder: r.track_inventory && r.reorder_point > 0 && r.stock_qty <= r.reorder_point,
    isActive: r.is_active,
    createdAt: iso(r.created_at),
  };
}

const PRODUCT_COLS = `id::text AS id, name, sku, price_cents, cost_cents, taxable, track_inventory, stock_qty, reorder_point, is_active, created_at`;

export async function listProducts(
  tenantId: string,
  opts: { activeOnly?: boolean; lowStockOnly?: boolean } = {}
): Promise<Product[]> {
  const rows = await query<ProductRow>(
    `SELECT ${PRODUCT_COLS} FROM products
     WHERE tenant_id = $1
       AND ($2::boolean IS NOT TRUE OR is_active = true)
       AND ($3::boolean IS NOT TRUE OR (track_inventory = true AND reorder_point > 0 AND stock_qty <= reorder_point))
     ORDER BY name`,
    [tenantId, opts.activeOnly ?? false, opts.lowStockOnly ?? false]
  );
  return rows.map(mapProduct);
}

export async function getProduct(tenantId: string, id: string): Promise<Product | null> {
  const rows = await query<ProductRow>(`SELECT ${PRODUCT_COLS} FROM products WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function createProduct(
  tenantId: string,
  input: {
    name: string;
    sku: string | null;
    priceCents: number;
    costCents: number;
    taxable: boolean;
    trackInventory: boolean;
    stockQty: number;
    reorderPoint: number;
  }
): Promise<Product> {
  let id = "";
  await withTransaction(async (q) => {
    const rows = await q<{ id: string }>(
      `INSERT INTO products (tenant_id, name, sku, price_cents, cost_cents, taxable, track_inventory, stock_qty, reorder_point)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
      [
        tenantId,
        input.name,
        input.sku,
        input.priceCents,
        input.costCents,
        input.taxable,
        input.trackInventory,
        input.stockQty,
        input.reorderPoint,
      ]
    );
    id = rows[0].id;
    if (input.trackInventory && input.stockQty !== 0) {
      await q(`INSERT INTO inventory_txns (tenant_id, product_id, kind, qty_delta, note) VALUES ($1, $2::bigint, 'receive', $3, 'Opening stock')`, [
        tenantId,
        id,
        input.stockQty,
      ]);
    }
  });
  const p = await getProduct(tenantId, id);
  if (!p) throw new Error("failed to load created product");
  return p;
}

export async function updateProduct(
  tenantId: string,
  id: string,
  patch: {
    name?: string;
    sku?: string | null;
    priceCents?: number;
    costCents?: number;
    taxable?: boolean;
    trackInventory?: boolean;
    reorderPoint?: number;
    isActive?: boolean;
  }
): Promise<Product | null> {
  const rows = await query<{ id: string }>(
    `UPDATE products SET
       name = COALESCE($3, name),
       sku = COALESCE($4, sku),
       price_cents = COALESCE($5, price_cents),
       cost_cents = COALESCE($6, cost_cents),
       taxable = COALESCE($7, taxable),
       track_inventory = COALESCE($8, track_inventory),
       reorder_point = COALESCE($9, reorder_point),
       is_active = COALESCE($10, is_active)
     WHERE tenant_id = $1 AND id = $2 RETURNING id::text AS id`,
    [
      tenantId,
      id,
      patch.name ?? null,
      patch.sku === undefined ? null : patch.sku,
      patch.priceCents ?? null,
      patch.costCents ?? null,
      patch.taxable ?? null,
      patch.trackInventory ?? null,
      patch.reorderPoint ?? null,
      patch.isActive ?? null,
    ]
  );
  return rows[0] ? getProduct(tenantId, id) : null;
}

/** Manual stock movement (receiving, corrections, physical counts). Stock may go negative. */
export async function adjustStock(
  tenantId: string,
  id: string,
  input: { kind: "receive" | "adjust" | "count"; qtyDelta: number; note: string | null }
): Promise<Product> {
  const existing = await getProduct(tenantId, id);
  if (!existing) throw new InventoryError("Product not found.");
  if (!existing.trackInventory) throw new InventoryError("This product doesn't track inventory.");
  if (input.qtyDelta === 0) throw new InventoryError("Enter a non-zero quantity.");
  await withTransaction(async (q) => {
    await q(`UPDATE products SET stock_qty = stock_qty + $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, input.qtyDelta]);
    await q(`INSERT INTO inventory_txns (tenant_id, product_id, kind, qty_delta, note) VALUES ($1, $2::bigint, $3, $4, $5)`, [
      tenantId,
      id,
      input.kind,
      input.qtyDelta,
      input.note,
    ]);
  });
  const p = await getProduct(tenantId, id);
  if (!p) throw new Error("failed to load product after adjustment");
  return p;
}

export async function listProductTxns(tenantId: string, productId: string): Promise<ProductTxn[]> {
  const rows = await query<{ id: string; kind: string; qty_delta: number; order_id: string | null; note: string | null; created_at: string | Date }>(
    `SELECT id::text AS id, kind, qty_delta, order_id::text AS order_id, note, created_at
     FROM inventory_txns WHERE tenant_id = $1 AND product_id = $2 ORDER BY id DESC LIMIT 200`,
    [tenantId, productId]
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, qtyDelta: r.qty_delta, orderId: r.order_id, note: r.note, createdAt: iso(r.created_at) }));
}

// ---------- automatic stock movement on sale (idempotent; never throws to caller) ----------

/** Decrement stock for tracked product lines when a sale settles. */
export async function applyOrderStockOnSettlement(tenantId: string, order: Order): Promise<void> {
  const productLines = order.lineItems.filter((l) => l.productId);
  if (!productLines.length) return;
  const existing = await query(`SELECT 1 FROM inventory_txns WHERE tenant_id = $1 AND order_id = $2 AND kind = 'sale' LIMIT 1`, [
    tenantId,
    order.id,
  ]);
  if (existing.length) return;
  await withTransaction(async (q) => {
    for (const l of productLines) {
      const pr = await q<{ track_inventory: boolean }>(
        `SELECT track_inventory FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, l.productId]
      );
      if (!pr[0] || !pr[0].track_inventory) continue;
      await q(`UPDATE products SET stock_qty = stock_qty - $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, l.productId, l.quantity]);
      await q(`INSERT INTO inventory_txns (tenant_id, product_id, kind, qty_delta, order_id) VALUES ($1, $2::bigint, 'sale', $3, $4::bigint)`, [
        tenantId,
        l.productId,
        -l.quantity,
        order.id,
      ]);
    }
  });
}

/** Put stock back when a settled sale is refunded. */
export async function restoreOrderStockOnRefund(tenantId: string, orderId: string): Promise<void> {
  const returned = await query(`SELECT 1 FROM inventory_txns WHERE tenant_id = $1 AND order_id = $2 AND kind = 'return' LIMIT 1`, [
    tenantId,
    orderId,
  ]);
  if (returned.length) return;
  const sales = await query<{ product_id: string; qty_delta: number }>(
    `SELECT product_id::text AS product_id, qty_delta FROM inventory_txns WHERE tenant_id = $1 AND order_id = $2 AND kind = 'sale'`,
    [tenantId, orderId]
  );
  if (!sales.length) return;
  await withTransaction(async (q) => {
    for (const s of sales) {
      const restore = -s.qty_delta; // the sale delta is negative
      await q(`UPDATE products SET stock_qty = stock_qty + $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, s.product_id, restore]);
      await q(`INSERT INTO inventory_txns (tenant_id, product_id, kind, qty_delta, order_id) VALUES ($1, $2::bigint, 'return', $3, $4::bigint)`, [
        tenantId,
        s.product_id,
        restore,
        orderId,
      ]);
    }
  });
}
