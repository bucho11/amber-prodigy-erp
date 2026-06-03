import { useCallback, useEffect, useState } from "react";
import type { Client, ClientListItem, Tag } from "@prodigy/contracts";
import { api } from "./api";
import { useAuth } from "./auth";

type View = { mode: "list" } | { mode: "edit"; id: string } | { mode: "new" };

export function ClientsAdmin() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("clients.manage");
  const [view, setView] = useState<View>({ mode: "list" });

  if (view.mode === "new") {
    return <ClientEditor canManage={canManage} onClose={() => setView({ mode: "list" })} onCreated={(id) => setView({ mode: "edit", id })} />;
  }
  if (view.mode === "edit") {
    return <ClientEditor canManage={canManage} clientId={view.id} onClose={() => setView({ mode: "list" })} />;
  }
  return <ClientList canManage={canManage} onOpen={(id) => setView({ mode: "edit", id })} onAdd={() => setView({ mode: "new" })} />;
}

function ClientList({
  canManage,
  onOpen,
  onAdd,
}: {
  canManage: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (showArchived) params.set("includeArchived", "true");
      const res = await api<{ clients: ClientListItem[] }>(`/clients?${params.toString()}`);
      setClients(res.clients);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, showArchived]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <header>
        <p className="eyebrow">CRM</p>
        <h1>Clients</h1>
        <p className="sub">Everyone Prodigy sees. Search, open a profile, and keep their details and preferences current.</p>
      </header>

      <section className="card">
        <div className="form-row">
          <input
            className="input"
            placeholder="Search by name, email, or phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {canManage && (
            <button className="btn primary" onClick={onAdd}>
              + Add client
            </button>
          )}
        </div>
        <label className="checkline">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span className="small muted">Show archived</span>
        </label>

        {error && <p className="bad small">{error}</p>}
        {!clients && !error && <p className="muted">Loading&hellip;</p>}
        {clients && clients.length === 0 && (
          <p className="muted small">{q.trim() ? "No clients match that search." : "No clients yet. Add your first client above."}</p>
        )}

        <ul className="client-list">
          {clients?.map((c) => (
            <li key={c.id} className="client-row" onClick={() => onOpen(c.id)}>
              <div className="client-row-main">
                <div className="client-row-name">
                  {c.displayName}
                  {c.status === "archived" && <span className="tag muted-tag">archived</span>}
                </div>
                <div className="muted small">
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                </div>
              </div>
              <div className="client-row-side">
                {c.tags.map((t) => (
                  <span className="chip" key={t.id}>
                    {t.name}
                  </span>
                ))}
                <span className="chev">›</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  pronouns: string;
  referralSource: string;
  addressLine1: string;
  addressCity: string;
  addressState: string;
  addressPostal: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  marketingOptIn: boolean;
  smsOptIn: boolean;
  notes: string;
}

const BLANK: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  pronouns: "",
  referralSource: "",
  addressLine1: "",
  addressCity: "",
  addressState: "",
  addressPostal: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  marketingOptIn: false,
  smsOptIn: false,
  notes: "",
};

function fromClient(c: Client): FormState {
  return {
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    dateOfBirth: c.dateOfBirth ?? "",
    pronouns: c.pronouns ?? "",
    referralSource: c.referralSource ?? "",
    addressLine1: c.addressLine1 ?? "",
    addressCity: c.addressCity ?? "",
    addressState: c.addressState ?? "",
    addressPostal: c.addressPostal ?? "",
    emergencyContactName: c.emergencyContactName ?? "",
    emergencyContactPhone: c.emergencyContactPhone ?? "",
    marketingOptIn: c.marketingOptIn,
    smsOptIn: c.smsOptIn,
    notes: c.notes ?? "",
  };
}

function ClientEditor({
  canManage,
  clientId,
  onClose,
  onCreated,
}: {
  canManage: boolean;
  clientId?: string;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const isNew = !clientId;
  const [form, setForm] = useState<FormState>(BLANK);
  const [tags, setTags] = useState<Tag[]>([]);
  const [status, setStatus] = useState("active");
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (isNew) return;
    api<{ client: Client }>(`/clients/${clientId}`)
      .then(({ client }) => {
        setForm(fromClient(client));
        setTags(client.tags);
        setStatus(client.status);
        setCreatedAt(client.createdAt);
        setLoading(false);
      })
      .catch((e) => {
        setErr((e as Error).message);
        setLoading(false);
      });
  }, [clientId, isNew]);

  const ro = !canManage;
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setChk = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.checked }));

  const save = async () => {
    if (!form.firstName.trim()) {
      setErr("A first name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = { ...form, displayName: `${form.firstName} ${form.lastName}`.trim() };
    try {
      if (isNew) {
        const { client } = await api<{ client: Client }>("/clients", "POST", payload);
        onCreated?.(client.id);
      } else {
        await api(`/clients/${clientId}`, "PATCH", payload);
        onClose();
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const addTag = async () => {
    const name = tagInput.trim();
    if (!name || !clientId) return;
    try {
      const { tags: next } = await api<{ tags: Tag[] }>(`/clients/${clientId}/tags`, "POST", { name });
      setTags(next);
      setTagInput("");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const removeTag = async (tagId: string) => {
    if (!clientId) return;
    try {
      const { tags: next } = await api<{ tags: Tag[] }>(`/clients/${clientId}/tags/${tagId}`, "DELETE");
      setTags(next);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const toggleArchive = async () => {
    if (!clientId) return;
    const next = status === "archived" ? "active" : "archived";
    setBusy(true);
    try {
      await api(`/clients/${clientId}`, "PATCH", { status: next });
      setStatus(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="muted">Loading client&hellip;</p>;

  const displayName = `${form.firstName} ${form.lastName}`.trim();

  return (
    <>
      <header>
        <button className="link-btn" onClick={onClose}>
          ‹ Back to clients
        </button>
        <h1>{isNew ? "New client" : displayName || "Client"}</h1>
        {!isNew && status === "archived" && <p className="sub bad">This client is archived.</p>}
      </header>

      <section className="card">
        <h2>Name</h2>
        <div className="form-row">
          <input className="input" placeholder="First name" value={form.firstName} onChange={set("firstName")} disabled={ro} />
          <input className="input" placeholder="Last name" value={form.lastName} onChange={set("lastName")} disabled={ro} />
        </div>
        <div className="form-row">
          <input className="input" placeholder="Pronouns (optional)" value={form.pronouns} onChange={set("pronouns")} disabled={ro} />
          <input className="input" type="date" placeholder="Date of birth" value={form.dateOfBirth} onChange={set("dateOfBirth")} disabled={ro} />
        </div>
      </section>

      <section className="card">
        <h2>Contact</h2>
        <div className="form-row">
          <input className="input" type="email" placeholder="Email" value={form.email} onChange={set("email")} disabled={ro} />
          <input className="input" placeholder="Phone" value={form.phone} onChange={set("phone")} disabled={ro} />
        </div>
        <input className="input" placeholder="Street address" value={form.addressLine1} onChange={set("addressLine1")} disabled={ro} style={{ marginBottom: 10 }} />
        <div className="form-row">
          <input className="input" placeholder="City" value={form.addressCity} onChange={set("addressCity")} disabled={ro} />
          <input className="input" placeholder="State" value={form.addressState} onChange={set("addressState")} disabled={ro} />
          <input className="input" placeholder="ZIP" value={form.addressPostal} onChange={set("addressPostal")} disabled={ro} />
        </div>
      </section>

      {!isNew && (
        <section className="card">
          <h2>Tags</h2>
          <div className="chip-row">
            {tags.length === 0 && <span className="muted small">No tags yet.</span>}
            {tags.map((t) => (
              <span className="chip" key={t.id}>
                {t.name}
                {!ro && (
                  <button className="chip-x" onClick={() => void removeTag(t.id)} aria-label={`Remove ${t.name}`}>
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {!ro && (
            <div className="form-row" style={{ marginTop: 12 }}>
              <input
                className="input"
                placeholder="Add a tag (e.g. VIP, Prenatal)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addTag();
                }}
              />
              <button className="btn" onClick={() => void addTag()}>
                Add tag
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Emergency contact</h2>
        <div className="form-row">
          <input className="input" placeholder="Name" value={form.emergencyContactName} onChange={set("emergencyContactName")} disabled={ro} />
          <input className="input" placeholder="Phone" value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} disabled={ro} />
        </div>
      </section>

      <section className="card">
        <h2>Marketing &amp; notes</h2>
        <input className="input" placeholder="How did they hear about you? (referral source)" value={form.referralSource} onChange={set("referralSource")} disabled={ro} style={{ marginBottom: 12 }} />
        <label className="checkline">
          <input type="checkbox" checked={form.marketingOptIn} onChange={setChk("marketingOptIn")} disabled={ro} />
          <span className="small">Email marketing OK</span>
        </label>
        <label className="checkline">
          <input type="checkbox" checked={form.smsOptIn} onChange={setChk("smsOptIn")} disabled={ro} />
          <span className="small">Text message (SMS) OK</span>
        </label>
        <textarea
          className="input"
          rows={3}
          placeholder="Notes & preferences (not clinical) — e.g. prefers a warmer room, books with Keshia"
          value={form.notes}
          onChange={set("notes")}
          disabled={ro}
          style={{ marginTop: 4 }}
        />
      </section>

      {err && <p className="bad small">{err}</p>}

      {!ro && (
        <div className="editor-actions">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving\u2026" : isNew ? "Create client" : "Save changes"}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {!isNew && (
            <button className="link-btn muted archive-btn" disabled={busy} onClick={() => void toggleArchive()}>
              {status === "archived" ? "Restore client" : "Archive client"}
            </button>
          )}
        </div>
      )}

      {!isNew && createdAt && (
        <p className="muted small footer-note">
          Client since {new Date(createdAt).toLocaleDateString()}. Appointments and purchases will appear here once
          booking and checkout are live.
        </p>
      )}
    </>
  );
}
