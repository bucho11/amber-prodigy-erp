/**
 * Contract-first shared types for Prodigy ERP.
 * Locked conventions (project brief 7.2):
 *  - Money stored in integer CENTS, never floats.
 *  - Rates stored in BASIS POINTS (bps): 3.5% = 350, 50% = 5000.
 *  - Timestamps are UTC ISO-8601, presented in the tenant timezone.
 *  - Every business entity carries a tenantId.
 */
export const APP_NAME = "amber-prodigy-erp" as const;
export const APP_VERSION = "0.2.0" as const;

export type Role = "owner" | "admin" | "therapist" | "front_desk" | "client";

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  timezone: string;
}

export interface DbStatus {
  configured: boolean;
  connected: boolean;
  tenants: number | null;
  staff: number | null;
  error?: string;
}

export interface HealthResponse {
  status: "ok";
  service: typeof APP_NAME;
  version: typeof APP_VERSION;
  tenantSlug: string;
  timezone: string;
  database: DbStatus;
  serverTimeUtc: string;
}

export interface TenantSummary {
  slug: string;
  name: string;
  timezone: string;
}

// ---- Service catalog & resources ----
export interface ServiceCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
  isActive: boolean;
}

export interface Service {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
  variants: ServiceVariant[];
}

export interface Room {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Catalog {
  categories: ServiceCategory[];
  services: Service[];
  rooms: Room[];
}

// ---- Auth & RBAC ----
export interface PermissionDef {
  key: string;
  group: string;
  label: string;
}

/** The full catalog of capabilities the platform enforces. Owner-configurable per role. */
export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  { key: "scheduling.view", group: "Scheduling", label: "View calendar & appointments" },
  { key: "scheduling.manage", group: "Scheduling", label: "Book, edit & cancel appointments" },
  { key: "clients.view", group: "Clients", label: "View client list & contact info" },
  { key: "clients.manage", group: "Clients", label: "Add & edit clients" },
  { key: "clinical.view", group: "Clinical records", label: "View health intake & SOAP notes" },
  { key: "clinical.manage", group: "Clinical records", label: "Create & edit clinical notes" },
  { key: "catalog.manage", group: "Services & rooms", label: "Edit services, prices & rooms" },
  { key: "pos.operate", group: "Point of sale", label: "Check out clients & take payment" },
  { key: "sales.manage", group: "Gift cards & memberships", label: "Sell & manage gift cards, memberships, packages" },
  { key: "inventory.view", group: "Inventory", label: "View product stock" },
  { key: "inventory.manage", group: "Inventory", label: "Manage products & stock" },
  { key: "financials.view", group: "Financials", label: "View financial reports" },
  { key: "books.manage", group: "Accounting", label: "Manage the books (journal, reconcile, close)" },
  { key: "payroll.view", group: "Payroll", label: "View payroll & commissions" },
  { key: "payroll.run", group: "Payroll", label: "Run payroll" },
  { key: "marketing.manage", group: "Marketing", label: "Manage campaigns & automations" },
  { key: "reports.view", group: "Reports", label: "View business reports" },
  { key: "staff.manage", group: "Team", label: "Invite & manage staff" },
  { key: "roles.manage", group: "Team", label: "Create roles & set permissions" },
  { key: "settings.manage", group: "Settings", label: "Manage business settings" },
];

export const PERMISSION_KEYS: readonly string[] = PERMISSION_CATALOG.map((p) => p.key);

export interface RoleSeed {
  key: string;
  name: string;
  isOwner: boolean;
}

/** Default roles seeded per tenant. The Owner can rename, re-permission, or add to these. */
export const DEFAULT_ROLES: readonly RoleSeed[] = [
  { key: "owner", name: "Owner", isOwner: true },
  { key: "admin", name: "Manager / Admin", isOwner: false },
  { key: "provider", name: "Provider", isOwner: false },
  { key: "front_desk", name: "Front Desk", isOwner: false },
  { key: "accountant", name: "Accountant / Bookkeeper", isOwner: false },
  { key: "client", name: "Client", isOwner: false },
];

/** Sensible starting permissions per role. Seeded once; the Owner can change them anytime. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  admin: [
    "scheduling.view", "scheduling.manage", "clients.view", "clients.manage", "catalog.manage",
    "pos.operate", "sales.manage", "inventory.view", "inventory.manage", "financials.view",
    "reports.view", "marketing.manage", "staff.manage",
  ],
  provider: ["scheduling.view", "scheduling.manage", "clients.view", "clinical.view", "clinical.manage", "pos.operate"],
  front_desk: ["scheduling.view", "scheduling.manage", "clients.view", "clients.manage", "pos.operate", "sales.manage"],
  accountant: ["financials.view", "books.manage", "payroll.view", "reports.view"],
  client: [],
};

export interface AuthUserRole {
  id: string;
  key: string;
  name: string;
  isOwner: boolean;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: AuthUserRole | null;
  permissions: string[];
}

export interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  status: string;
  role: AuthUserRole | null;
}

export interface RoleWithPermissions {
  id: string;
  key: string;
  name: string;
  isOwner: boolean;
  isSystem: boolean;
  permissions: string[];
}

// ---- Clients / CRM ----
export interface Tag {
  id: string;
  name: string;
}

export interface ClientListItem {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  tags: Tag[];
}

export interface Client {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  pronouns: string | null;
  addressLine1: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostal: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  referralSource: string | null;
  marketingOptIn: boolean;
  smsOptIn: boolean;
  notes: string | null;
  status: string;
  createdAt: string;
  tags: Tag[];
}

// ---- Scheduling ----
export type AppointmentStatus = "booked" | "completed" | "cancelled" | "no_show";

export interface Provider {
  id: string;
  displayName: string;
  title: string | null;
  color: string | null;
}

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  providerId: string;
  providerName: string;
  roomId: string | null;
  roomName: string | null;
  serviceVariantId: string;
  serviceName: string;
  variantName: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  priceCents: number;
  status: AppointmentStatus;
  notes: string | null;
  protocolInstanceId: string | null;
  createdAt: string;
}

// ---- Auto-protocol scheduler ----
export interface ProtocolStep {
  id?: string;
  stepNumber: number;
  dayOffset: number;          // days from the anchor date (e.g. procedure date = 0)
  timeOfDay: string | null;   // 'HH:MM' local; null = use the apply-time default
  serviceVariantId: string;
  serviceName?: string;
  variantName?: string;
  durationMinutes?: number;
  priceCents?: number;
  label: string | null;
}

export interface Protocol {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  steps: ProtocolStep[];
  createdAt: string;
}

export interface ProtocolListItem {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  stepCount: number;
  spanDays: number;           // last dayOffset - first dayOffset
}

export interface ProtocolInstance {
  id: string;
  protocolId: string | null;
  protocolName: string;
  clientId: string;
  clientName: string;
  anchorDate: string;         // YYYY-MM-DD
  providerId: string;
  providerName: string;
  roomId: string | null;
  roomName: string | null;
  status: string;             // active | completed | cancelled
  createdAt: string;
  appointmentCount?: number;
}

export interface ApplyProtocolSkip {
  stepNumber: number;
  dayOffset: number;
  reason: string;
}

export interface ApplyProtocolResult {
  instance: ProtocolInstance;
  created: Appointment[];
  skipped: ApplyProtocolSkip[];
}


// ---- Staff / providers (bookable team) ----
export interface StaffMember {
  id: string;
  displayName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  color: string | null;
  isActive: boolean;
  userId: string | null;    // linked login account, if any
  userEmail: string | null; // that login's email (joined)
  createdAt: string;
}

export interface LinkableUser {
  id: string;
  email: string;
  displayName: string;
}
