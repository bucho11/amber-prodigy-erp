import type { Router } from "express";
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  adjustStock,
  listProductTxns,
  addLineItem,
} from "@prodigy/db";
import { ValidationError, reqString, optString, reqInt, optInt, optBool, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

const ADJUST_KINDS = ["receive", "adjust", "count"];

export function registerInventoryRoutes(api: Router): void {
  api.get(
    "/products",
    requireAuth,
    requirePermission("inventory.view"),
    wrap(async (req, res) => {
      res.json({
        products: await listProducts(userOf(req).tenantId, {
          activeOnly: req.query.activeOnly === "true",
          lowStockOnly: req.query.lowStock === "true",
        }),
      });
    })
  );

  api.post(
    "/products",
    requireAuth,
    requirePermission("inventory.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      res.status(201).json({
        product: await createProduct(userOf(req).tenantId, {
          name: reqString(b.name, "name"),
          sku: optString(b.sku) ?? null,
          priceCents: optInt(b.priceCents, "priceCents", 0) ?? 0,
          costCents: optInt(b.costCents, "costCents", 0) ?? 0,
          taxable: optBool(b.taxable) ?? true,
          trackInventory: optBool(b.trackInventory) ?? true,
          stockQty: optInt(b.stockQty, "stockQty", -100000000) ?? 0,
          reorderPoint: optInt(b.reorderPoint, "reorderPoint", 0) ?? 0,
        }),
      });
    })
  );

  api.get(
    "/products/:id",
    requireAuth,
    requirePermission("inventory.view"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const product = await getProduct(tid, req.params.id);
      if (!product) {
        res.status(404).json({ error: "Product not found." });
        return;
      }
      res.json({ product, transactions: await listProductTxns(tid, req.params.id) });
    })
  );

  api.patch(
    "/products/:id",
    requireAuth,
    requirePermission("inventory.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Parameters<typeof updateProduct>[2] = {};
      if ("name" in b) patch.name = reqString(b.name, "name");
      if ("sku" in b) patch.sku = optString(b.sku) ?? null;
      if ("priceCents" in b) patch.priceCents = reqInt(b.priceCents, "priceCents", 0);
      if ("costCents" in b) patch.costCents = reqInt(b.costCents, "costCents", 0);
      if ("taxable" in b) patch.taxable = Boolean(b.taxable);
      if ("trackInventory" in b) patch.trackInventory = Boolean(b.trackInventory);
      if ("reorderPoint" in b) patch.reorderPoint = reqInt(b.reorderPoint, "reorderPoint", 0);
      if ("isActive" in b) patch.isActive = Boolean(b.isActive);
      const product = await updateProduct(userOf(req).tenantId, req.params.id, patch);
      if (!product) {
        res.status(404).json({ error: "Product not found." });
        return;
      }
      res.json({ product });
    })
  );

  api.post(
    "/products/:id/adjust",
    requireAuth,
    requirePermission("inventory.manage"),
    wrap(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const kind = reqString(b.kind, "kind");
      if (!ADJUST_KINDS.includes(kind)) throw new ValidationError("kind must be receive, adjust, or count.");
      const qtyDelta = reqInt(b.qtyDelta, "qtyDelta", -100000000);
      res.json({
        product: await adjustStock(userOf(req).tenantId, req.params.id, {
          kind: kind as "receive" | "adjust" | "count",
          qtyDelta,
          note: optString(b.note) ?? null,
        }),
      });
    })
  );

  // Add a catalog product to an order (price/taxable/name resolved server-side).
  api.post(
    "/orders/:id/products",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const productId = optString(b.productId);
      if (!productId) throw new ValidationError("productId is required.");
      const quantity = optInt(b.quantity, "quantity", 1) ?? 1;
      const product = await getProduct(tid, productId);
      if (!product || !product.isActive) throw new ValidationError("That product isn't available.");
      const order = await addLineItem(tid, req.params.id, {
        kind: "product",
        description: product.name,
        quantity,
        unitPriceCents: product.priceCents,
        taxable: product.taxable,
        serviceVariantId: null,
        appointmentId: null,
        productId: product.id,
      });
      res.status(201).json({ order });
    })
  );
}
