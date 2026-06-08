import { useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import { Login } from "./Login";
import { AcceptInvite } from "./AcceptInvite";
import { Dashboard } from "./Dashboard";
import { ServicesAdmin } from "./Services";
import { Team } from "./Team";
import { ClientsAdmin } from "./Clients";
import { ScheduleAdmin } from "./Schedule";
import { WaitlistPage } from "./Waitlist";
import { ProtocolsAdmin } from "./Protocols";
import { CheckoutPage } from "./Checkout";
import { BooksPage } from "./Books";
import { InventoryPage } from "./Inventory";
import { ReportsPage } from "./Reports";
import { MembershipsPage } from "./Memberships";
import { PublicBooking } from "./PublicBooking";
import { PublicManageBooking } from "./PublicManageBooking";
import { AuditPage } from "./Audit";
import { Assistant } from "./Assistant";

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
    return (
      <main className="public-main">
        <PublicManageBooking />
      </main>
    );
  }
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/book")) {
    return (
      <main className="public-main">
        <PublicBooking />
      </main>
    );
  }
  if (loading) {
    return (
      <main className="centered">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }
  if (!user)
    return (
      <main className="auth-main">
        <Login />
      </main>
    );
  return <Shell />;
}

type Tab =
  | "dashboard"
  | "assistant"
  | "schedule"
  | "waitlist"
  | "protocols"
  | "clients"
  | "checkout"
  | "memberships"
  | "books"
  | "inventory"
  | "reports"
  | "services"
  | "team"
  | "audit";

type NavGroup = "Front desk" | "Back office" | "Setup";

function Shell() {
  const { user, logout, hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  if (!user) return null; // Shell only renders when authenticated; this narrows the type.

  const can: Record<Tab, boolean> = {
    dashboard: true,
    assistant: true,
    schedule: hasPermission("scheduling.view"),
    waitlist: hasPermission("scheduling.view"),
    protocols: hasPermission("scheduling.view"),
    clients: hasPermission("clients.view"),
    checkout: hasPermission("pos.operate") || hasPermission("financials.view") || hasPermission("settings.manage"),
    books: hasPermission("financials.view") || hasPermission("books.manage"),
    inventory: hasPermission("inventory.view") || hasPermission("inventory.manage"),
    reports: hasPermission("reports.view"),
    memberships: hasPermission("sales.manage"),
    services: hasPermission("catalog.manage"),
    team: hasPermission("staff.manage") || hasPermission("roles.manage"),
    audit: hasPermission("settings.manage"),
  };

  // Never render a tab the user can't access (e.g. after a permission change).
  const effectiveTab: Tab = can[tab] ? tab : "dashboard";

  const NAV: { tab: Tab; label: string; group: NavGroup }[] = [
    { tab: "dashboard", label: "Dashboard", group: "Front desk" },
    { tab: "assistant", label: "Assistant", group: "Front desk" },
    { tab: "schedule", label: "Calendar", group: "Front desk" },
    { tab: "waitlist", label: "Waitlist", group: "Front desk" },
    { tab: "protocols", label: "Protocols", group: "Front desk" },
    { tab: "clients", label: "Clients", group: "Front desk" },
    { tab: "checkout", label: "Checkout", group: "Front desk" },
    { tab: "books", label: "Books", group: "Back office" },
    { tab: "inventory", label: "Inventory", group: "Back office" },
    { tab: "reports", label: "Reports", group: "Back office" },
    { tab: "memberships", label: "Memberships", group: "Back office" },
    { tab: "services", label: "Services & Rooms", group: "Setup" },
    { tab: "team", label: "Team & Roles", group: "Setup" },
    { tab: "audit", label: "Audit", group: "Setup" },
  ];
  const groups: NavGroup[] = ["Front desk", "Back office", "Setup"];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h1 className="brand">Prodigy ERP</h1>
        <nav className="sidebar-nav" aria-label="Primary">
          {groups.map((g) => {
            const items = NAV.filter((n) => n.group === g && can[n.tab]);
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={g}>
                <div className="nav-group-label">{g}</div>
                {items.map((n) => (
                  <button
                    key={n.tab}
                    className={effectiveTab === n.tab ? "nav-item active" : "nav-item"}
                    aria-current={effectiveTab === n.tab ? "page" : undefined}
                    onClick={() => setTab(n.tab)}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <span className="user-name">
            {user.displayName}
            {user.role && <span className="user-role">{user.role.name}</span>}
          </span>
          <button className="link-btn muted" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {effectiveTab === "dashboard" && <Dashboard />}
        {effectiveTab === "assistant" && <Assistant />}
        {effectiveTab === "schedule" && <ScheduleAdmin />}
        {effectiveTab === "waitlist" && <WaitlistPage />}
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
