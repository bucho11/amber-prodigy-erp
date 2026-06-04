import { randomBytes } from "node:crypto";
import { query } from "./index";
import { findConflict, getVariantForBooking, createAppointment } from "./scheduling";
import { computeAvailability } from "./availability";
import { zonedWallTimeToUtc, utcToZonedParts } from "./time";

const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingError";
  }
}

export interface PublicService {
  variantId: string;
  serviceName: string;
  variantName: string;
  durationMinutes: number;
  priceCents: number;
}
export interface PublicProvider {
  id: string;
  name: string;
}
export interface PublicSlot {
  startsAt: string; // ISO UTC
  label: string; // wall-clock HH:MM in the business timezone
}
export interface BookingConfirmation {
  startsAt: string;
  endsAt: string;
  serviceName: string;
  providerName: string;
  manageToken: string;
}

export interface ManagedBooking {
  startsAt: string;
  endsAt: string;
  status: string;
  serviceName: string;
  providerName: string;
  canModify: boolean;
}

export interface PublicBookInput {
  serviceVariantId: string;
  providerId: string;
  startsAt: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/** Active variants of active services — the only catalog data the public page sees. */
export async function listBookableServices(tenantId: string): Promise<PublicService[]> {
  const rows = await query<{ variant_id: string; service_name: string; variant_name: string; duration_minutes: number; price_cents: number }>(
    `SELECT sv.id::text AS variant_id, s.name AS service_name, sv.name AS variant_name, sv.duration_minutes, sv.price_cents
     FROM service_variants sv JOIN services s ON s.id = sv.service_id
     WHERE sv.tenant_id = $1 AND sv.is_active = true AND s.is_active = true
     ORDER BY s.name, sv.duration_minutes`,
    [tenantId]
  );
  return rows.map((r) => ({
    variantId: r.variant_id,
    serviceName: r.service_name,
    variantName: r.variant_name,
    durationMinutes: r.duration_minutes,
    priceCents: r.price_cents,
  }));
}

export async function listBookableProviders(tenantId: string): Promise<PublicProvider[]> {
  const rows = await query<{ id: string; name: string }>(
    `SELECT id::text AS id, display_name AS name FROM staff_profiles WHERE tenant_id = $1 AND is_active = true ORDER BY display_name`,
    [tenantId]
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

async function providerName(tenantId: string, providerId: string): Promise<string | null> {
  const r = await query<{ name: string }>(
    `SELECT display_name AS name FROM staff_profiles WHERE tenant_id = $1 AND id = $2 AND is_active = true LIMIT 1`,
    [tenantId, providerId]
  );
  return r[0]?.name ?? null;
}

export async function publicSlots(
  tenantId: string,
  timeZone: string,
  input: { serviceVariantId: string; providerId: string; date: string }
): Promise<PublicSlot[]> {
  const variant = await getVariantForBooking(tenantId, input.serviceVariantId);
  if (!variant) throw new BookingError("That service isn't available.");
  if (!(await providerName(tenantId, input.providerId))) throw new BookingError("That provider isn't available.");
  const avail = await computeAvailability(tenantId, input.providerId, input.date, variant.durationMinutes, timeZone);
  return avail.openSlots.map((t) => ({ startsAt: zonedWallTimeToUtc(input.date, t, timeZone), label: t }));
}

export async function publicBook(tenantId: string, timeZone: string, input: PublicBookInput): Promise<BookingConfirmation> {
  const variant = await getVariantForBooking(tenantId, input.serviceVariantId);
  if (!variant) throw new BookingError("That service isn't available.");
  const pname = await providerName(tenantId, input.providerId);
  if (!pname) throw new BookingError("That provider isn't available.");

  const start = new Date(input.startsAt);
  if (isNaN(start.getTime())) throw new BookingError("That time is invalid.");
  const startsAt = start.toISOString();
  const endsAt = new Date(start.getTime() + variant.durationMinutes * 60000).toISOString();

  // The requested time must still be a genuine open slot (covers working hours, time off, and existing bookings).
  const parts = utcToZonedParts(startsAt, timeZone);
  const avail = await computeAvailability(tenantId, input.providerId, parts.date, variant.durationMinutes, timeZone);
  if (!avail.openSlots.includes(hhmm(parts.minutes))) {
    throw new BookingError("That time isn't available anymore. Please pick another.");
  }
  // Defense-in-depth double-booking guard (same one the internal calendar uses).
  const conflict = await findConflict(tenantId, { providerId: input.providerId, roomId: null, startsAt, endsAt });
  if (conflict) throw new BookingError("That time was just taken. Please pick another.");

  const clientId = await matchOrCreateClient(tenantId, input);
  const appt = await createAppointment(tenantId, {
    clientId,
    providerId: input.providerId,
    roomId: null,
    serviceVariantId: variant.id,
    startsAt,
    endsAt,
    priceCents: variant.priceCents,
    notes: "Booked online",
    protocolInstanceId: null,
  });
  const manageToken = randomBytes(24).toString("base64url");
  await query(`UPDATE appointments SET manage_token = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, appt.id, manageToken]);
  return {
    startsAt: appt.startsAt,
    endsAt: appt.endsAt,
    serviceName: `${variant.serviceName} — ${variant.variantName}`,
    providerName: pname,
    manageToken,
  };
}

// ---------- self-serve manage / cancel / reschedule (token-based) ----------
interface TokenRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  service_variant_id: string;
  provider_id: string;
  service_name: string;
  variant_name: string;
  provider_name: string | null;
  duration_minutes: number;
}

async function loadByToken(tenantId: string, token: string): Promise<TokenRow | null> {
  if (!token) return null;
  const rows = await query<TokenRow>(
    `SELECT a.id::text AS id, a.starts_at, a.ends_at, a.status,
            a.service_variant_id::text AS service_variant_id, a.provider_id::text AS provider_id,
            s.name AS service_name, sv.name AS variant_name, sv.duration_minutes AS duration_minutes,
            sp.display_name AS provider_name
     FROM appointments a
     JOIN service_variants sv ON sv.id = a.service_variant_id
     JOIN services s ON s.id = sv.service_id
     LEFT JOIN staff_profiles sp ON sp.id = a.provider_id
     WHERE a.tenant_id = $1 AND a.manage_token = $2 LIMIT 1`,
    [tenantId, token]
  );
  return rows[0] ?? null;
}

function viewOf(r: TokenRow): ManagedBooking {
  const startsAt = new Date(r.starts_at).toISOString();
  return {
    startsAt,
    endsAt: new Date(r.ends_at).toISOString(),
    status: r.status,
    serviceName: `${r.service_name} — ${r.variant_name}`,
    providerName: r.provider_name ?? "",
    canModify: r.status === "booked" && new Date(startsAt).getTime() > Date.now(),
  };
}

export async function getBookingByToken(tenantId: string, token: string): Promise<ManagedBooking> {
  const r = await loadByToken(tenantId, token);
  if (!r) throw new BookingError("We couldn't find that booking.");
  return viewOf(r);
}

export async function cancelBooking(tenantId: string, token: string): Promise<ManagedBooking> {
  const r = await loadByToken(tenantId, token);
  if (!r) throw new BookingError("We couldn't find that booking.");
  if (r.status !== "booked") throw new BookingError("This booking can't be cancelled.");
  if (new Date(r.starts_at).getTime() <= Date.now()) throw new BookingError("This appointment has passed — please call us.");
  await query(`UPDATE appointments SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2`, [tenantId, r.id]);
  const updated = await loadByToken(tenantId, token);
  return viewOf(updated!);
}

export async function rescheduleSlots(tenantId: string, timeZone: string, token: string, date: string): Promise<PublicSlot[]> {
  const r = await loadByToken(tenantId, token);
  if (!r) throw new BookingError("We couldn't find that booking.");
  const avail = await computeAvailability(tenantId, r.provider_id, date, r.duration_minutes, timeZone, 15, r.id);
  return avail.openSlots.map((t) => ({ startsAt: zonedWallTimeToUtc(date, t, timeZone), label: t }));
}

export async function rescheduleBooking(tenantId: string, timeZone: string, token: string, newStartsAt: string): Promise<ManagedBooking> {
  const r = await loadByToken(tenantId, token);
  if (!r) throw new BookingError("We couldn't find that booking.");
  if (r.status !== "booked") throw new BookingError("This booking can't be changed.");
  if (new Date(r.starts_at).getTime() <= Date.now()) throw new BookingError("This appointment has passed — please call us.");
  const start = new Date(newStartsAt);
  if (isNaN(start.getTime())) throw new BookingError("That time is invalid.");
  const startsAt = start.toISOString();
  const endsAt = new Date(start.getTime() + r.duration_minutes * 60000).toISOString();
  const parts = utcToZonedParts(startsAt, timeZone);
  const avail = await computeAvailability(tenantId, r.provider_id, parts.date, r.duration_minutes, timeZone, 15, r.id);
  if (!avail.openSlots.includes(hhmm(parts.minutes))) throw new BookingError("That time isn't available anymore. Please pick another.");
  const conflict = await findConflict(tenantId, { providerId: r.provider_id, roomId: null, startsAt, endsAt, excludeId: r.id });
  if (conflict) throw new BookingError("That time was just taken. Please pick another.");
  await query(`UPDATE appointments SET starts_at = $3, ends_at = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, r.id, startsAt, endsAt]);
  const updated = await loadByToken(tenantId, token);
  return viewOf(updated!);
}

/** Match an existing client by email, or create a new one. Never reveals whether the client existed. */
async function matchOrCreateClient(tenantId: string, input: PublicBookInput): Promise<string> {
  const email = input.email.trim();
  const existing = await query<{ id: string }>(
    `SELECT id::text AS id FROM clients WHERE tenant_id = $1 AND email IS NOT NULL AND lower(email) = lower($2) ORDER BY id LIMIT 1`,
    [tenantId, email]
  );
  if (existing[0]) return existing[0].id;
  const display = `${input.firstName} ${input.lastName}`.trim() || email;
  const created = await query<{ id: string }>(
    `INSERT INTO clients (tenant_id, first_name, last_name, display_name, email, phone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
    [tenantId, input.firstName, input.lastName, display, email, input.phone]
  );
  return created[0].id;
}
