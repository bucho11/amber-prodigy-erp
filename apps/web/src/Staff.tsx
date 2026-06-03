import { useEffect, useState } from "react";
import type { LinkableUser, StaffMember } from "@prodigy/contracts";
import { api } from "./api";
import { ProviderAvailability } from "./Availability";

const PALETTE = ["#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#6366F1", "#14B8A6"];

export function ProvidersAdmin() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [editor, setEditor] = useState<{ mode: "new" } | { mode: "edit"; staff: StaffMember } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ staff: StaffMember[] }>("/staff?includeInactive=1");
      setStaff(r.staff);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (s: StaffMember) => {
    try {
      await api(`/staff/${s.id}`, "PATCH", { isActive: !s.isActive });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (editor) {
    return (
      <ProviderEditor
        editing={editor.mode === "edit" ? editor.staff : undefined}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          setEditor(null);
          await load();
        }}
      />
    );
  }

  return (
    <section className="card">
      <div className="row-actions">
        <button className="btn primary" onClick={() => setEditor({ mode: "new" })}>
          + Add provider
        </button>
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>
        Providers are the bookable people on your calendar. They appear in the booking form and protocol scheduler.
      </p>
      {error && <p className="bad small">{error}</p>}
      {!staff && <p className="muted">Loading&hellip;</p>}
      {staff && staff.length === 0 && <p className="muted small">No providers yet. Add your first team member.</p>}
      <ul className="plain-list">
        {staff?.map((s) => (
          <li key={s.id} className={`list-row${s.isActive ? "" : " inactive"}`}>
            <div className="provider-id">
              <span className="swatch" style={{ background: s.color || "var(--line)" }} />
              <div>
                <div className="list-title">
                  {s.displayName}
                  {!s.isActive && <span className="status-badge s-cancelled">Inactive</span>}
                </div>
                <div className="muted small">
                  {[s.title, s.userEmail ? `login: ${s.userEmail}` : null].filter(Boolean).join(" · ") || "\u2014"}
                </div>
              </div>
            </div>
            <div className="list-row-actions">
              <button className="link-btn" onClick={() => setEditor({ mode: "edit", staff: s })}>
                Edit
              </button>
              <button className="link-btn muted" onClick={() => void toggleActive(s)}>
                {s.isActive ? "Deactivate" : "Activate"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProviderEditor({
  editing,
  onClose,
  onSaved,
}: {
  editing?: StaffMember;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(editing?.displayName ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [color, setColor] = useState(editing?.color ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [bio, setBio] = useState(editing?.bio ?? "");
  const [userId, setUserId] = useState(editing?.userId ?? "");
  const [linkable, setLinkable] = useState<LinkableUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = editing ? `?staffId=${editing.id}` : "";
    api<{ users: LinkableUser[] }>(`/staff/linkable-users${q}`)
      .then((r) => setLinkable(r.users))
      .catch(() => {});
  }, [editing]);

  const save = async () => {
    setErr(null);
    if (!displayName.trim()) return setErr("Enter a name.");
    const body = {
      displayName: displayName.trim(),
      title: title.trim() || null,
      color: color || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      bio: bio.trim() || null,
      userId: userId || null,
    };
    setBusy(true);
    try {
      if (editing) await api(`/staff/${editing.id}`, "PATCH", body);
      else await api("/staff", "POST", body);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
    <section className="card">
      <button className="link-btn" onClick={onClose}>
        ‹ Back to providers
      </button>
      <h2>{editing ? "Edit provider" : "Add provider"}</h2>

      <label className="field">
        <span>Name</span>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Full name" />
      </label>
      <label className="field">
        <span>Title (optional)</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Massage Therapist" />
      </label>

      <div className="field">
        <span>Calendar color (optional)</span>
        <div className="swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch-btn${color === c ? " sel" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(color === c ? "" : c)}
              aria-label={`color ${c}`}
            />
          ))}
          {color && (
            <button type="button" className="link-btn muted" onClick={() => setColor("")}>
              clear
            </button>
          )}
        </div>
      </div>

      <div className="form-row">
        <label className="field" style={{ flex: 1 }}>
          <span>Email (optional)</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Phone (optional)</span>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span>Bio (optional)</span>
        <textarea className="input" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short description for future client-facing profiles" />
      </label>

      <label className="field">
        <span>Linked login (optional)</span>
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— Not linked —</option>
          {linkable.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.email})
            </option>
          ))}
        </select>
        <span className="muted small">Connect this provider to a staff login so the same person isn&rsquo;t listed twice.</span>
      </label>

      {err && <p className="bad small">{err}</p>}
      <div className="editor-actions">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving\u2026" : editing ? "Save provider" : "Add provider"}
        </button>
        <button className="btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
    {editing && <ProviderAvailability providerId={editing.id} />}
    </>
  );
}
