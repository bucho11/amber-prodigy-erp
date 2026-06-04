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

// ---- Point of sale / payments ----
export type OrderStatus = "open" | "paid" | "void" | "refunded";
export type LineKind = "service" | "product" | "custom";
export type PaymentMethod = "cash" | "external_card" | "stripe_card" | "gift_card" | "other";
export type PaymentStatus = "recorded" | "pending" | "succeeded" | "failed" | "refunded";

export interface OrderLineItem {
  id: string;
  kind: LineKind;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number; // quantity * unitPriceCents
  taxable: boolean;
  serviceVariantId: string | null;
  appointmentId: string | null;
  packageId: string | null; // set when this line was covered by a package credit
  productId: string | null; // set when this line sold a catalog product
}

export interface OrderPayment {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  status: PaymentStatus;
  processorRef: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  clientId: string | null;
  clientName: string | null;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  lineItems: OrderLineItem[];
  payments: OrderPayment[];
  createdAt: string;
  closedAt: string | null;
}

export interface OrderListItem {
  id: string;
  clientName: string | null;
  status: OrderStatus;
  totalCents: number;
  paidCents: number;
  createdAt: string;
  closedAt: string | null;
}

export interface PaymentsConfig {
  stripePlatformConfigured: boolean; // platform secret key present in the environment
  stripeConnected: boolean; // this tenant has a connected account with charges enabled
  taxRateBps: number;
  methods: PaymentMethod[]; // payment methods currently available to take
}


// ---- Clinical records (intake + SOAP notes) ----
export interface ClientIntake {
  clientId: string;
  reasonForVisit: string | null;
  medicalConditions: string | null;
  medications: string | null;
  allergies: string | null;
  surgeries: string | null;
  injuries: string | null;
  pregnant: boolean | null;
  pressurePreference: string | null;
  areasToAvoid: string | null;
  notes: string | null;
  consentToTreat: boolean;
  signatureName: string | null;
  signedAt: string | null;
  hasIntake: boolean;   // false if no intake has been recorded yet
  updatedAt: string | null;
}

export interface SoapNoteListItem {
  id: string;
  date: string;
  providerName: string | null;
  appointmentId: string | null;
  createdAt: string;
}

export interface SoapNote {
  id: string;
  clientId: string;
  appointmentId: string | null;
  providerId: string | null;
  providerName: string | null;
  date: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  createdAt: string;
  updatedAt: string;
}


// ---- Provider availability (working hours + time off) ----
export interface WorkingHour {
  dayOfWeek: number;   // 0=Sun .. 6=Sat
  startMinute: number; // minutes from local midnight
  endMinute: number;
}

export interface TimeOff {
  id: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD (inclusive)
  allDay: boolean;
  startMinute: number | null; // when !allDay
  endMinute: number | null;
  reason: string | null;
}

export interface BusyBlock {
  start: string; // HH:MM local
  end: string;
  label: string;
}

export interface DayAvailability {
  date: string;
  dayOfWeek: number;
  timezone: string;
  durationMinutes: number;
  workingWindows: { start: string; end: string }[]; // HH:MM
  busy: BusyBlock[];
  openSlots: string[]; // HH:MM start times where the service fits
}


// ---- Gift cards ----
export type GiftCardStatus = "active" | "void";
export interface GiftCard {
  id: string;
  code: string;
  clientId: string | null;
  clientName: string | null;
  initialCents: number;
  balanceCents: number;
  status: GiftCardStatus;
  note: string | null;
  createdAt: string;
}
export interface GiftCardTxn {
  id: string;
  kind: string;        // issue | redeem | void
  amountCents: number; // signed
  orderId: string | null;
  createdAt: string;
}


// ---- Service packages ----
export type PackageStatus = "active" | "void";
export interface ServicePackage {
  id: string;
  clientId: string;
  clientName: string | null;
  serviceVariantId: string;
  serviceName: string | null; // "Service · Variant"
  totalCredits: number;
  remainingCredits: number;
  priceCents: number;
  status: PackageStatus;
  note: string | null;
  createdAt: string;
}
export interface PackageTxn {
  id: string;
  kind: string;        // issue | redeem | restore | void
  credits: number;     // signed
  orderId: string | null;
  createdAt: string;
}


// ---- General ledger ----
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type NormalSide = "debit" | "credit";
export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalSide: NormalSide;
  isActive: boolean;
}
export interface JournalLineInput {
  accountId: string;
  debitCents: number;
  creditCents: number;
}
export interface JournalLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
}
export interface JournalEntry {
  id: string;
  entryDate: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversesEntryId: string | null;
  createdAt: string;
  lines: JournalLine[];
}
export interface JournalEntryListItem {
  id: string;
  entryDate: string;
  memo: string | null;
  sourceType: string | null;
  totalCents: number; // sum of debits
  createdAt: string;
}
export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debitCents: number;
  creditCents: number;
}
export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
}


// ---- Retail products / inventory ----
export interface Product {
  id: string;
  name: string;
  sku: string | null;
  priceCents: number;
  costCents: number;
  taxable: boolean;
  trackInventory: boolean;
  stockQty: number;
  reorderPoint: number;
  belowReorder: boolean;
  isActive: boolean;
  createdAt: string;
}
export interface ProductTxn {
  id: string;
  kind: string;        // receive | adjust | count | sale | return
  qtyDelta: number;    // signed
  orderId: string | null;
  note: string | null;
  createdAt: string;
}


// ---- Reports ----
export interface PaymentMethodTotal {
  method: PaymentMethod | string;
  amountCents: number;
  count: number;
}
export interface SalesSummary {
  from: string;
  to: string;
  paidOrderCount: number;
  subtotalCents: number;     // line totals before discount/tax
  discountCents: number;
  netSalesCents: number;     // subtotal - discount (recognized revenue)
  taxCents: number;
  tipCents: number;
  totalCollectedCents: number; // what customers paid (incl. tax + tip)
  refundCount: number;
  refundedCents: number;
  paymentsByMethod: PaymentMethodTotal[];
}
export interface IncomeLine {
  code: string;
  name: string;
  amountCents: number;
}
export interface IncomeSummary {
  from: string;
  to: string;
  revenueCents: number;
  expenseCents: number;
  netIncomeCents: number;
  revenue: IncomeLine[];
  expenses: IncomeLine[];
}
export interface LowStockItem {
  id: string;
  name: string;
  stockQty: number;
  reorderPoint: number;
}
export interface InventorySnapshot {
  productCount: number;
  trackedProductCount: number;
  inventoryValueCents: number; // stock at cost
  retailValueCents: number;    // stock at price
  outOfStockCount: number;
  lowStock: LowStockItem[];
}
