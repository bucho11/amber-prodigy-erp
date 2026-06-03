import { useCallback, useEffect, useState } from "react";
import type { Catalog, Service, ServiceCategory, ServiceVariant, Room } from "@prodigy/contracts";
import { api } from "./api";

const formatPrice = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function ServicesAdmin() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setCatalog(await api<Catalog>("/catalog", "GET"));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loadError) {
    return (
      <div className="card">
        <p className="bad">Couldn&rsquo;t load your menu: {loadError}</p>
        <button className="btn" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!catalog) return <p className="muted">Loading your menu&hellip;</p>;

  const activeCategories = catalog.categories.filter((c) => c.isActive);
  const activeServices = catalog.services.filter((s) => s.isActive);

  const groups: { category: ServiceCategory | null; services: Service[] }[] = activeCategories.map((cat) => ({
    category: cat,
    services: activeServices.filter((s) => s.categoryId === cat.id),
  }));
  const uncategorized = activeServices.filter(
    (s) => !s.categoryId || !activeCategories.some((c) => c.id === s.categoryId)
  );
  if (uncategorized.length > 0) groups.push({ category: null, services: uncategorized });

  return (
    <>
      <header>
        <p className="eyebrow">Setup</p>
        <h1>Services &amp; Rooms</h1>
        <p className="sub">Add and edit everything Prodigy offers. Changes save instantly.</p>
      </header>

      <AddServiceForm categories={activeCategories} onDone={reload} />

      {groups.map((g) => (
        <section className="card" key={g.category ? g.category.id : "uncategorized"}>
          <h2>{g.category ? g.category.name : "Uncategorized"}</h2>
          {g.services.length === 0 && <p className="muted small">No services here yet.</p>}
          {g.services.map((s) => (
            <ServiceCard key={s.id} service={s} onChange={reload} />
          ))}
        </section>
      ))}

      <AddCategoryForm onDone={reload} />
      <RoomsPanel rooms={catalog.rooms.filter((r) => r.isActive)} onChange={reload} />
    </>
  );
}

function AddServiceForm({ categories, onDone }: { categories: ServiceCategory[]; onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setErr("Please enter a service name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api<Service>("/services", "POST", {
        name: name.trim(),
        categoryId: categoryId || null,
        description: description.trim() || null,
      });
      setName("");
      setCategoryId("");
      setDescription("");
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Add a service</h2>
      <div className="form-row">
        <input
          className="input"
          placeholder="Service name (e.g. Deep Tissue Massage)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="input"
        placeholder="Short description (optional)"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {err && <p className="bad small">{err}</p>}
      <button className="btn primary" disabled={busy} onClick={() => void submit()}>
        {busy ? "Adding\u2026" : "Add service"}
      </button>
    </section>
  );
}

function ServiceCard({ service, onChange }: { service: Service; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const activeVariants = service.variants.filter((v) => v.isActive);

  const archive = async () => {
    if (!window.confirm(`Archive "${service.name}"? It will be hidden from your menu.`)) return;
    setBusy(true);
    try {
      await api(`/services/${service.id}`, "PATCH", { isActive: false });
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="service">
      <div className="service-head">
        <div>
          <div className="service-name">{service.name}</div>
          {service.description && <div className="muted small">{service.description}</div>}
        </div>
        <button className="link-btn muted" disabled={busy} onClick={() => void archive()}>
          Archive
        </button>
      </div>
      <div className="variants">
        {activeVariants.length === 0 && <div className="muted small">No durations/prices yet &mdash; add one below.</div>}
        {activeVariants.map((v) => (
          <VariantRow key={v.id} variant={v} onChange={onChange} />
        ))}
      </div>
      <AddVariantForm serviceId={service.id} onDone={onChange} />
    </div>
  );
}

function VariantRow({ variant, onChange }: { variant: ServiceVariant; onChange: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((variant.priceCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const cents = dollarsToCents(draft);
    if (cents === null) {
      setErr("Enter a valid price.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/variants/${variant.id}`, "PATCH", { priceCents: cents });
      setEditing(false);
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/variants/${variant.id}`, "PATCH", { isActive: false });
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="variant">
      <span className="variant-name">
        {variant.name} &middot; {variant.durationMinutes} min
      </span>
      {editing ? (
        <span className="variant-edit">
          <span className="dollar">$</span>
          <input
            className="input price"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <button className="link-btn" disabled={busy} onClick={() => void save()}>
            Save
          </button>
          <button
            className="link-btn muted"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setDraft((variant.priceCents / 100).toFixed(2));
              setErr(null);
            }}
          >
            Cancel
          </button>
          {err && <span className="bad small">{err}</span>}
        </span>
      ) : (
        <span className="variant-price">
          <b>{formatPrice(variant.priceCents)}</b>
          <button className="link-btn" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="link-btn muted" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        </span>
      )}
    </div>
  );
}

function AddVariantForm({ serviceId, onDone }: { serviceId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const mins = Number(minutes);
    const cents = dollarsToCents(price);
    if (!name.trim()) {
      setErr("Name the option (e.g. 60 min).");
      return;
    }
    if (!Number.isInteger(mins) || mins < 1) {
      setErr("Enter minutes as a whole number.");
      return;
    }
    if (cents === null) {
      setErr("Enter a valid price.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/services/${serviceId}/variants`, "POST", {
        name: name.trim(),
        durationMinutes: mins,
        priceCents: cents,
      });
      setName("");
      setMinutes("");
      setPrice("");
      setOpen(false);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="link-btn add" onClick={() => setOpen(true)}>
        + Add duration / price
      </button>
    );
  }

  return (
    <div className="add-variant">
      <input
        className="input sm"
        placeholder="Label (e.g. 60 min)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input sm"
        placeholder="Minutes"
        inputMode="numeric"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
      />
      <span className="price-input">
        <span className="dollar">$</span>
        <input
          className="input sm price"
          placeholder="0.00"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </span>
      <button className="btn sm" disabled={busy} onClick={() => void submit()}>
        {busy ? "\u2026" : "Add"}
      </button>
      <button
        className="link-btn muted"
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setErr(null);
        }}
      >
        Cancel
      </button>
      {err && <span className="bad small">{err}</span>}
    </div>
  );
}

function AddCategoryForm({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setErr("Enter a category name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api<ServiceCategory>("/categories", "POST", { name: name.trim() });
      setName("");
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Add a category</h2>
      <div className="form-row">
        <input
          className="input"
          placeholder="Category name (e.g. Facials)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" disabled={busy} onClick={() => void submit()}>
          {busy ? "Adding\u2026" : "Add"}
        </button>
      </div>
      {err && <p className="bad small">{err}</p>}
    </section>
  );
}

function RoomsPanel({ rooms, onChange }: { rooms: Room[]; onChange: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) {
      setErr("Enter a room name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api<Room>("/rooms", "POST", { name: name.trim() });
      setName("");
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (room: Room) => {
    if (!window.confirm(`Remove room "${room.name}"?`)) return;
    await api(`/rooms/${room.id}`, "PATCH", { isActive: false });
    await onChange();
  };

  return (
    <section className="card">
      <h2>Rooms</h2>
      {rooms.length === 0 && <p className="muted small">No rooms yet. Add your treatment rooms below.</p>}
      <ul className="rooms">
        {rooms.map((r) => (
          <li key={r.id}>
            <span>{r.name}</span>
            <button className="link-btn muted" onClick={() => void remove(r)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="form-row">
        <input
          className="input"
          placeholder="Room name (e.g. Room 1)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" disabled={busy} onClick={() => void add()}>
          {busy ? "Adding\u2026" : "Add room"}
        </button>
      </div>
      {err && <p className="bad small">{err}</p>}
    </section>
  );
}
