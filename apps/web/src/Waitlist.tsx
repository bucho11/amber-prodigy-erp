import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { ClientListItem, WaitlistEntry } from "@prodigy/contracts";

export function WaitlistPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("scheduling.manage");
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-form state
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ClientListItem[]>([]);
  const [client, setClient] = useState<ClientListItem | null>(null);
  const [preferredWindow, setPreferredWindow] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<{ waitlist: WaitlistEntry[] }>("/waitlist?status=waiting")
      .then((r) => setEntries(r.waitlist))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api<{ clients: ClientListItem[] }>(`/clients?search=${encodeURIComponent(search.trim())}`)
        .then((r) => live && setResults(r.clients.slice(0, 6)))
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search]);

  const add = async () => {
    setError(null);
    if (!client) return setError("Choose a client.");
    setSaving(true);
    try {
      await api("/waitlist", "POST", {
        clientId: client.id,
        preferredWindow: preferredWindow.trim() || null,
        notes: notes.trim() || null,
      });
      setAdding(false);
      setClient(null);
      setSearch("");
      setResults([]);
      setPreferredWindow("");
      setNotes("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: "placed" | "cancelled") => {
    setError(null);
    try {
      await api(`/waitlist/${id}/status`, "POST", { status });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {canWrite && (
        <section className="card">
          {!adding ? (
            <button className="btn primary" onClick={() => setAdding(true)}>
              Add to waitlist
            </button>
          ) : (
            <>
              <h2>Add to waitlist</h2>
              {!client ? (
                <label className="field">
                  <span>Client</span>
                  <input className="input" placeholder="Search by name, email, or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
                  {results.length > 0 && (
                    <ul className="plain-list" style={{ marginTop: 6 }}>
                      {results.map((c) => (
                        <li key={c.id} className="list-row clickable" onClick={() => setClient(c)}>
                          <span className="list-title">{c.displayName}</span>
                          {c.email && <span className="muted small">{c.email}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </label>
              ) : (
                <p>
                  Client: <strong>{client.displayName}</strong>{" "}
                  <button className="link-btn" onClick={() => setClient(null)}>
                    change
                  </button>
                </p>
              )}
              <div className="form-row">
                <label className="field">
                  <span>Preferred timeframe</span>
                  <input className="input" placeholder="e.g. weekday mornings" value={preferredWindow} onChange={(e) => setPreferredWindow(e.target.value)} />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <input className="input" placeholder="Service, provider, or other preferences" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>
              {error && <p className="bad small">{error}</p>}
              <div className="editor-actions">
                <button className="btn" onClick={() => { setAdding(false); setError(null); }}>
                  Cancel
                </button>
                <button className="btn primary" disabled={saving} onClick={() => void add()}>
                  {saving ? "Saving…" : "Add to waitlist"}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Waitlist</h2>
        <p className="muted small">Clients waiting for an opening. When a slot frees up, reach out to a match and mark them placed.</p>
        {error && !adding && <p className="bad small">{error}</p>}
        {!entries && <p className="muted">Loading&hellip;</p>}
        {entries && entries.length === 0 && <p className="muted small">No one is waiting right now.</p>}
        {entries && entries.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Preferred timeframe</th>
                <th>Notes</th>
                <th>Waiting since</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.clientName}</td>
                  <td>{e.preferredWindow || <span className="muted small">—</span>}</td>
                  <td>{e.serviceName ? `${e.serviceName}. ` : ""}{e.notes || (e.serviceName ? "" : <span className="muted small">—</span>)}</td>
                  <td className="muted small">{new Date(e.createdAt).toLocaleDateString()}</td>
                  {canWrite && (
                    <td className="num">
                      <button className="link-btn" onClick={() => void setStatus(e.id, "placed")}>
                        Placed
                      </button>
                      <button className="link-btn muted" onClick={() => void setStatus(e.id, "cancelled")} style={{ marginLeft: 10 }}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
