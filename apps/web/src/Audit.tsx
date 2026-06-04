import { useEffect, useState } from "react";
import { api } from "./api";
import { ClientPicker } from "./Schedule";
import type { AuditEntry } from "@prodigy/contracts";

const ACTION_LABEL: Record<string, string> = { view: "Viewed", create: "Created", update: "Updated" };
const RES_LABEL: Record<string, string> = {
  intake: "Intake form",
  soap: "SOAP note",
  soap_list: "Notes list",
  clinical: "Clinical record",
};

interface Integrity {
  intact: boolean;
  count: number;
  brokenAtId?: string;
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setEntries(null);
    const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
    api<{ entries: AuditEntry[] }>(`/audit-log${q}`)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const verify = async () => {
    setChecking(true);
    setError(null);
    try {
      setIntegrity(await api<Integrity>("/audit-log/verify"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <section className="card">
        <div className="ticket-head">
          <h2>Clinical access log</h2>
          <button className="btn" disabled={checking} onClick={() => void verify()}>
            {checking ? "Checking\u2026" : "Verify integrity"}
          </button>
        </div>
        <p className="muted small">A tamper-evident record of who viewed or edited clients&rsquo; clinical records.</p>
        {integrity && (
          <p className={integrity.intact ? "muted small" : "bad small"}>
            {integrity.intact
              ? `\u2713 Verified — ${integrity.count} entries, none altered or removed.`
              : `\u26a0 Integrity check failed — a break was detected near entry ${integrity.brokenAtId}.`}
          </p>
        )}
        <label className="field">
          <span>Filter by client</span>
          <ClientPicker value={clientId} displayName={clientName} onPick={(id, n) => { setClientId(id); setClientName(n); }} />
        </label>
        {clientId && (
          <button className="link-btn" onClick={() => { setClientId(""); setClientName(""); }}>
            Clear filter
          </button>
        )}
      </section>

      <section className="card">
        {error && <p className="bad small">{error}</p>}
        {!entries && !error && <p className="muted">Loading&hellip;</p>}
        {entries && entries.length === 0 && <p className="muted small">No clinical access recorded yet.</p>}
        {entries && entries.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Record</th>
                <th>Client</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="muted small">{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.actorName}</td>
                  <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td>{RES_LABEL[e.resourceType] ?? e.resourceType}</td>
                  <td>{e.clientName ?? "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
