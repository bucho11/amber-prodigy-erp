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
