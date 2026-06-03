import { useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import { Login } from "./Login";
import { AcceptInvite } from "./AcceptInvite";
import { Dashboard } from "./Dashboard";
import { ServicesAdmin } from "./Services";
import { Team } from "./Team";
import { ClientsAdmin } from "./Clients";

export function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

function Root() {
  const { user, loading } = useAuth();

  // Invite acceptance is reachable without being signed in.
  if (typeof window !== "undefined" && window.location.pathname === "/accept-invite") {
    return <AcceptInvite />;
  }
  if (loading) {
    return (
      <div className="centered">
        <p className="muted">Loading&hellip;</p>
      </div>
    );
  }
  if (!user) return <Login />;
  return <Shell />;
}

type Tab = "dashboard" | "clients" | "services" | "team";

function Shell() {
  const { user, logout, hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  if (!user) return null; // Shell only renders when authenticated; this narrows the type.
  const canClients = hasPermission("clients.view");
  const canCatalog = hasPermission("catalog.manage");
  const canTeam = hasPermission("staff.manage") || hasPermission("roles.manage");

  // Never render a tab the user can't access (e.g. after a permission change).
  const effectiveTab: Tab =
    (tab === "clients" && !canClients) ||
    (tab === "services" && !canCatalog) ||
    (tab === "team" && !canTeam)
      ? "dashboard"
      : tab;

  return (
    <div className="page">
      <div className="topbar">
        <nav className="topnav">
          <div className="brand">Prodigy ERP</div>
          <div className="tabs">
            <button className={effectiveTab === "dashboard" ? "tab active" : "tab"} onClick={() => setTab("dashboard")}>
              Dashboard
            </button>
            {canClients && (
              <button className={effectiveTab === "clients" ? "tab active" : "tab"} onClick={() => setTab("clients")}>
                Clients
              </button>
            )}
            {canCatalog && (
              <button className={effectiveTab === "services" ? "tab active" : "tab"} onClick={() => setTab("services")}>
                Services &amp; Rooms
              </button>
            )}
            {canTeam && (
              <button className={effectiveTab === "team" ? "tab active" : "tab"} onClick={() => setTab("team")}>
                Team &amp; Roles
              </button>
            )}
          </div>
          <div className="user-menu">
            <span className="user-name">
              {user.displayName}
              {user.role && <span className="user-role">{user.role.name}</span>}
            </span>
            <button className="link-btn muted" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </nav>
      </div>
      <main className="shell">
        {effectiveTab === "dashboard" && <Dashboard />}
        {effectiveTab === "clients" && <ClientsAdmin />}
        {effectiveTab === "services" && <ServicesAdmin />}
        {effectiveTab === "team" && <Team />}
      </main>
    </div>
  );
}
