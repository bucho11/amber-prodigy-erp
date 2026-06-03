import { useEffect, useState } from "react";
import type { HealthResponse } from "@prodigy/contracts";

export function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: HealthResponse) => setHealth(d))
      .catch((e) => setError(String(e)));
  }, []);

  const db = health?.database;

  return (
    <>
      <header>
        <p className="eyebrow">Prodigy ERP &middot; tenant&nbsp;#1</p>
        <h1>Prodigy Massage and Wellness</h1>
        <p className="sub">The operating system for clinical wellness businesses.</p>
      </header>

      <section className="card">
        <h2>System status</h2>
        {error && <p className="bad">Could not reach the API: {error}</p>}
        {!health && !error && <p className="muted">Checking&hellip;</p>}
        {health && (
          <ul className="status">
            <li><span>Service</span><b>{health.service} v{health.version}</b></li>
            <li><span>Timezone</span><b>{health.timezone}</b></li>
            <li>
              <span>Database</span>
              <b className={db?.connected ? "ok" : "warn"}>
                {!db?.configured ? "not provisioned yet" : db.connected ? "connected" : "configured, not reachable"}
              </b>
            </li>
            {db?.connected && (
              <>
                <li><span>Tenants</span><b>{db.tenants}</b></li>
                <li><span>Staff seeded</span><b>{db.staff}</b></li>
              </>
            )}
            <li><span>Server time (UTC)</span><b>{new Date(health.serverTimeUtc).toLocaleString()}</b></li>
          </ul>
        )}
      </section>

      <footer className="muted">
        Foundation &amp; service menu live. Booking, protocols, clinical notes, payments, and marketing to follow.
      </footer>
    </>
  );
}
