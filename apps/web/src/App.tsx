import { useState } from "react";
import { Dashboard } from "./Dashboard";
import { ServicesAdmin } from "./Services";

type Tab = "dashboard" | "services";

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <div className="page">
      <div className="topbar">
        <nav className="topnav">
          <div className="brand">Prodigy ERP</div>
          <div className="tabs">
            <button className={tab === "dashboard" ? "tab active" : "tab"} onClick={() => setTab("dashboard")}>
              Dashboard
            </button>
            <button className={tab === "services" ? "tab active" : "tab"} onClick={() => setTab("services")}>
              Services &amp; Rooms
            </button>
          </div>
        </nav>
      </div>
      <main className="shell">{tab === "dashboard" ? <Dashboard /> : <ServicesAdmin />}</main>
    </div>
  );
}
