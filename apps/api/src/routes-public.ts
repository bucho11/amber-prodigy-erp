import type { Router } from "express";
import {
  listBookableServices,
  listBookableProviders,
  publicSlots,
  publicBook,
  getBookingByToken,
  cancelBooking,
  rescheduleSlots,
  rescheduleBooking,
} from "@prodigy/db";
import { ValidationError, reqString, reqEmail, wrap } from "./http";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerPublicRoutes(api: Router): void {
  // Everything here is intentionally UNAUTHENTICATED. Expose only public-safe data.
  api.get(
    "/public/booking-info",
    wrap(async (req, res) => {
      const t = req.tenant!;
      const [services, providers] = await Promise.all([listBookableServices(t.id), listBookableProviders(t.id)]);
      res.json({ businessName: t.name, timezone: t.timezone, services, providers });
    })
  );

  api.get(
    "/public/slots",
    wrap(async (req, res) => {
      const t = req.tenant!;
      const serviceVariantId = typeof req.query.serviceVariantId === "string" ? req.query.serviceVariantId : "";
      const providerId = typeof req.query.providerId === "string" ? req.query.providerId : "";
      const date = typeof req.query.date === "string" ? req.query.date : "";
      if (!serviceVariantId || !providerId) throw new ValidationError("Pick a service and a provider.");
      if (!DATE_RE.test(date)) throw new ValidationError("Pick a date (YYYY-MM-DD).");
      res.json({ slots: await publicSlots(t.id, t.timezone, { serviceVariantId, providerId, date }) });
    })
  );

  api.post(
    "/public/book",
    wrap(async (req, res) => {
      const t = req.tenant!;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const confirmation = await publicBook(t.id, t.timezone, {
        serviceVariantId: reqString(b.serviceVariantId, "serviceVariantId"),
        providerId: reqString(b.providerId, "providerId"),
        startsAt: reqString(b.startsAt, "startsAt"),
        firstName: reqString(b.firstName, "firstName"),
        lastName: reqString(b.lastName, "lastName"),
        email: reqEmail(b.email, "email"),
        phone: reqString(b.phone, "phone"),
      });
      res.status(201).json({ confirmation });
    })
  );

  // ---- self-serve manage / cancel / reschedule (token in the URL) ----
  api.get(
    "/public/booking/:token",
    wrap(async (req, res) => {
      const t = req.tenant!;
      res.json({ booking: await getBookingByToken(t.id, req.params.token) });
    })
  );

  api.post(
    "/public/booking/:token/cancel",
    wrap(async (req, res) => {
      const t = req.tenant!;
      res.json({ booking: await cancelBooking(t.id, req.params.token) });
    })
  );

  api.get(
    "/public/booking/:token/slots",
    wrap(async (req, res) => {
      const t = req.tenant!;
      const date = typeof req.query.date === "string" ? req.query.date : "";
      if (!DATE_RE.test(date)) throw new ValidationError("Pick a date (YYYY-MM-DD).");
      res.json({ slots: await rescheduleSlots(t.id, t.timezone, req.params.token, date) });
    })
  );

  api.post(
    "/public/booking/:token/reschedule",
    wrap(async (req, res) => {
      const t = req.tenant!;
      const b = (req.body ?? {}) as Record<string, unknown>;
      res.json({ booking: await rescheduleBooking(t.id, t.timezone, req.params.token, reqString(b.startsAt, "startsAt")) });
    })
  );
}
