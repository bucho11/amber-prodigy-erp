import { useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import { Login } from "./Login";
import { AcceptInvite } from "./AcceptInvite";
import { Dashboard } from "./Dashboard";
import { ServicesAdmin } from "./Services";
import { Team } from "./Team";
import { ClientsAdmin } from "./Clients";
import { ScheduleAdmin } from "./Schedule";
import { ProtocolsAdmin } from "./Protocols";
import { CheckoutPage } from "./Checkout";
import { BooksPage } from "./Books";
import { InventoryPage } from "./Inventory";
import { ReportsPage } from "./Reports";
import { MembershipsPage } from "./Memberships";
import { PublicBooking } from "./PublicBooking";
import { PublicManageBooking } from "./PublicManageBooking";
import { AuditPage } from "./Audit";

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
  // The client-facing booking + self-serve manage pages are fully public.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/book/manage")) {
    return <PublicManageBooking />;
  }
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/book")) {
    return <PublicBooking />;
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

type Tab = "dashboard" | "schedule" | "protocols" | "clients" | "checkout" | "memberships" | "books" | "inventory" | "reports" | "services" | "team" | "audit";

function Shell() {
  const { user, logout, hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  if (!user) return null; // Shell only renders when authenticated; this narrows the type.
  const canSchedule = hasPermission("scheduling.view");
  const canClients = hasPermission("clients.view");
  const canCatalog = hasPermission("catalog.manage");
  const canTeam = hasPermission("staff.manage") || hasPermission("roles.manage");
  const canCheckout = hasPermission("pos.operate") || hasPermission("financials.view") || hasPermission("settings.manage");
  const canBooks = hasPermission("financials.view") || hasPermission("books.manage");
  const canInventory = hasPermission("inventory.view") || hasPermission("inventory.manage");
  const canReports = hasPermission("reports.view");
  const canMemberships = hasPermission("sales.manage");
  const canAudit = hasPermission("settings.manage");

  // Never render a tab the user can't access (e.g. after a permission change).
  const effectiveTab: Tab =
    (tab === "schedule" && !canSchedule) ||
    (tab === "protocols" && !canSchedule) ||
    (tab === "clients" && !canClients) ||
    (tab === "checkout" && !canCheckout) ||
    (tab === "books" && !canBooks) ||
    (tab === "inventory" && !canInventory) ||
    (tab === "reports" && !canReports) ||
    (tab === "memberships" && !canMemberships) ||
    (tab === "services" && !canCatalog) ||
    (tab === "audit" && !canAudit) ||
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
            {canSchedule && (
              <button className={effectiveTab === "schedule" ? "tab active" : "tab"} onClick={() => setTab("schedule")}>
                Calendar
              </button>
            )}
            {canSchedule && (
              <button className={effectiveTab === "protocols" ? "tab active" : "tab"} onClick={() => setTab("protocols")}>
                Protocols
              </button>
            )}
            {canClients && (
              <button className={effectiveTab === "clients" ? "tab active" : "tab"} onClick={() => setTab("clients")}>
                Clients
              </button>
            )}
            {canCheckout && (
              <button className={effectiveTab === "checkout" ? "tab active" : "tab"} onClick={() => setTab("checkout")}>
                Checkout
              </button>
            )}
            {canBooks && (
              <button className={effectiveTab === "books" ? "tab active" : "tab"} onClick={() => setTab("books")}>
                Books
              </button>
            )}
            {canInventory && (
              <button className={effectiveTab === "inventory" ? "tab active" : "tab"} onClick={() => setTab("inventory")}>
                Inventory
              </button>
            )}
            {canReports && (
              <button className={effectiveTab === "reports" ? "tab active" : "tab"} onClick={() => setTab("reports")}>
                Reports
              </button>
            )}
            {canMemberships && (
              <button className={effectiveTab === "memberships" ? "tab active" : "tab"} onClick={() => setTab("memberships")}>
                Memberships
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
            {canAudit && (
              <button className={effectiveTab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
                Audit
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
        {effectiveTab === "schedule" && <ScheduleAdmin />}
        {effectiveTab === "protocols" && <ProtocolsAdmin />}
        {effectiveTab === "clients" && <ClientsAdmin />}
        {effectiveTab === "checkout" && <CheckoutPage />}
        {effectiveTab === "books" && <BooksPage />}
        {effectiveTab === "inventory" && <InventoryPage />}
        {effectiveTab === "reports" && <ReportsPage />}
        {effectiveTab === "memberships" && <MembershipsPage />}
        {effectiveTab === "audit" && <AuditPage />}
        {effectiveTab === "services" && <ServicesAdmin />}
        {effectiveTab === "team" && <Team />}
      </main>
    </div>
  );
}
