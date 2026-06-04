import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Product, ProductTxn } from "@prodigy/contracts";

const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const dollarsToCents = (s: string): number => Math.round((parseFloat(s) || 0) * 100);

const TXN_LABEL: Record<string, string> = {
  receive: "Received",
  adjust: "Adjusted",
  count: "Count",
  sale: "Sold",
  return: "Returned",
};

export function InventoryPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("inventory.manage");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ products: Product[] }>("/products").then((r) => setProducts(r.products)).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  if (openId) return <ProductDetail id={openId} canManage={canManage} onBack={() => setOpenId(null)} onChange={load} />;

  return (
    <>
      {canManage && <AddProduct onAdded={load} />}
      <section className="card">
        <h2>Products</h2>
        {error && <p className="bad small">{error}</p>}
        {!products && <p className="muted">Loading&hellip;</p>}
        {products && products.length === 0 && <p className="muted small">No products yet.</p>}
        <ul className="plain-list">
          {products?.map((p) => (
            <li key={p.id} className="list-row clickable" onClick={() => setOpenId(p.id)}>
              <div>
                <div className="list-title">
                  {p.name}
                  {!p.isActive && <span className="status-badge s-cancelled">inactive</span>}
                  {p.belowReorder && <span className="status-badge s-warn">low stock</span>}
                </div>
                <div className="muted small">
                  {fmt(p.priceCents)}
                  {p.sku ? ` · ${p.sku}` : ""}
                  {p.trackInventory ? ` · ${p.stockQty} in stock` : " · not tracked"}
                </div>
              </div>
              <span className="chev">›</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function AddProduct({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("0");
  const [reorder, setReorder] = useState("0");
  const [track, setTrack] = useState(true);
  const [taxable, setTaxable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setError(null);
    if (!name.trim()) return setError("Enter a product name.");
    setSaving(true);
    try {
      await api("/products", "POST", {
        name: name.trim(),
        sku: sku.trim() || null,
        priceCents: dollarsToCents(price),
        costCents: dollarsToCents(cost),
        taxable,
        trackInventory: track,
        stockQty: track ? parseInt(stock) || 0 : 0,
        reorderPoint: track ? parseInt(reorder) || 0 : 0,
      });
      setName(""); setSku(""); setPrice(""); setCost(""); setStock("0"); setReorder("0"); setTrack(true); setTaxable(true);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2>Add a product</h2>
      <div className="form-row">
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field" style={{ maxWidth: 160 }}>
          <span>SKU (optional)</span>
          <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} />
        </label>
      </div>
      <div className="form-row">
        <label className="field" style={{ maxWidth: 140 }}>
          <span>Price</span>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span className="dollar">$</span>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </label>
        <label className="field" style={{ maxWidth: 140 }}>
          <span>Cost (optional)</span>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span className="dollar">$</span>
            <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
        </label>
        <label className="field checkbox-field">
          <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> <span>Taxable</span>
        </label>
      </div>
      <label className="field checkbox-field">
        <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} /> <span>Track inventory</span>
      </label>
      {track && (
        <div className="form-row">
          <label className="field" style={{ maxWidth: 150 }}>
            <span>Starting stock</span>
            <input className="input" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
          </label>
          <label className="field" style={{ maxWidth: 150 }}>
            <span>Reorder at</span>
            <input className="input" inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} />
          </label>
        </div>
      )}
      {error && <p className="bad small">{error}</p>}
      <div className="editor-actions">
        <button className="btn primary" disabled={saving} onClick={() => void add()}>
          {saving ? "Saving\u2026" : "Add product"}
        </button>
      </div>
    </section>
  );
}

function ProductDetail({ id, canManage, onBack, onChange }: { id: string; canManage: boolean; onBack: () => void; onChange: () => void }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [txns, setTxns] = useState<ProductTxn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adjKind, setAdjKind] = useState<"receive" | "adjust" | "count">("receive");
  const [adjQty, setAdjQty] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [busy, setBusy] = useState(false);
  // edit fields
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [reorder, setReorder] = useState("");

  const load = () =>
    api<{ product: Product; transactions: ProductTxn[] }>(`/products/${id}`)
      .then((r) => {
        setProduct(r.product);
        setTxns(r.transactions);
        setName(r.product.name);
        setPrice((r.product.priceCents / 100).toFixed(2));
        setReorder(String(r.product.reorderPoint));
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const applyAdjust = async () => {
    const qty = parseInt(adjQty) || 0;
    const delta = adjKind === "adjust" ? qty : Math.abs(qty); // receive/count are positive in this control
    if (delta === 0) return setError("Enter a quantity.");
    setBusy(true);
    setError(null);
    try {
      await api(`/products/${id}/adjust`, "POST", { kind: adjKind, qtyDelta: delta, note: adjNote.trim() || null });
      setAdjQty("");
      setAdjNote("");
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/products/${id}`, "PATCH", { name: name.trim(), priceCents: dollarsToCents(price), reorderPoint: parseInt(reorder) || 0 });
      setEditing(false);
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!product) return;
    try {
      await api(`/products/${id}`, "PATCH", { isActive: !product.isActive });
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!product) return <section className="card">{error ? <p className="bad small">{error}</p> : <p className="muted">Loading&hellip;</p>}</section>;

  return (
    <>
      <section className="card">
        <button className="link-btn" onClick={onBack}>
          ‹ Back to products
        </button>
        <div className="ticket-head">
          <h2>{product.name}</h2>
          {product.belowReorder && <span className="status-badge s-warn">low stock</span>}
          {!product.isActive && <span className="status-badge s-cancelled">inactive</span>}
        </div>
        <div className="totals" style={{ borderTop: "none", paddingTop: 0 }}>
          {product.trackInventory ? (
            <div className="totline grand">
              <span>In stock</span>
              <span>{product.stockQty}</span>
            </div>
          ) : (
            <div className="totline">
              <span className="muted small">Inventory</span>
              <span>Not tracked</span>
            </div>
          )}
          <div className="totline">
            <span className="muted small">Price</span>
            <span>{fmt(product.priceCents)}</span>
          </div>
          {product.costCents > 0 && (
            <div className="totline">
              <span className="muted small">Cost</span>
              <span>{fmt(product.costCents)}</span>
            </div>
          )}
          {product.sku && (
            <div className="totline">
              <span className="muted small">SKU</span>
              <span>{product.sku}</span>
            </div>
          )}
          {product.trackInventory && (
            <div className="totline">
              <span className="muted small">Reorder at</span>
              <span>{product.reorderPoint}</span>
            </div>
          )}
        </div>
        {error && <p className="bad small">{error}</p>}
      </section>

      {canManage && product.trackInventory && (
        <section className="card">
          <h2>Adjust stock</h2>
          <div className="form-row">
            <label className="field" style={{ maxWidth: 170 }}>
              <span>Action</span>
              <select className="input" value={adjKind} onChange={(e) => setAdjKind(e.target.value as "receive" | "adjust" | "count")}>
                <option value="receive">Receive (add)</option>
                <option value="adjust">Adjust (+/-)</option>
                <option value="count">Count correction</option>
              </select>
            </label>
            <label className="field" style={{ maxWidth: 130 }}>
              <span>Quantity</span>
              <input className="input" inputMode="numeric" placeholder={adjKind === "adjust" ? "+/-" : ""} value={adjQty} onChange={(e) => setAdjQty(e.target.value)} />
            </label>
            <label className="field">
              <span>Note (optional)</span>
              <input className="input" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
            </label>
          </div>
          <div className="editor-actions">
            <button className="btn primary" disabled={busy} onClick={() => void applyAdjust()}>
              Apply
            </button>
          </div>
        </section>
      )}

      {canManage && (
        <section className="card">
          {!editing ? (
            <div className="editor-actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn" onClick={() => setEditing(true)}>
                Edit details
              </button>
              <button className="btn" onClick={() => void toggleActive()}>
                {product.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ) : (
            <>
              <h2>Edit product</h2>
              <label className="field">
                <span>Name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="form-row">
                <label className="field" style={{ maxWidth: 140 }}>
                  <span>Price</span>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span className="dollar">$</span>
                    <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
                  </div>
                </label>
                {product.trackInventory && (
                  <label className="field" style={{ maxWidth: 150 }}>
                    <span>Reorder at</span>
                    <input className="input" inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} />
                  </label>
                )}
              </div>
              <div className="editor-actions">
                <button className="btn" onClick={() => { setEditing(false); load(); }}>
                  Cancel
                </button>
                <button className="btn primary" disabled={busy} onClick={() => void saveEdit()}>
                  Save
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Recent movements</h2>
        {txns.length === 0 && <p className="muted small">No movements yet.</p>}
        <div className="pay-list">
          {txns.map((t) => (
            <div key={t.id} className="totline">
              <span className="muted small">
                {TXN_LABEL[t.kind] || t.kind}
                {t.note ? ` · ${t.note}` : ""}
                {t.createdAt ? ` · ${new Date(t.createdAt).toLocaleDateString()}` : ""}
              </span>
              <span>
                {t.qtyDelta >= 0 ? "+" : ""}
                {t.qtyDelta}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
