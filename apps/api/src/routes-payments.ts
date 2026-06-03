import type { Router } from "express";
import {
  createOrder,
  getOrder,
  listOrders,
  addLineItem,
  removeLineItem,
  updateAdjustments,
  addPayment,
  voidOrder,
  refundOrder,
  markPaymentSucceeded,
  getTenantBilling,
  setTenantTaxRate,
  setTenantStripeAccount,
  setTenantStripeChargesEnabled,
  clientExists,
  getVariantForBooking,
  payOrderWithGiftCard,
} from "@prodigy/db";
import type { LineKind, PaymentMethod } from "@prodigy/contracts";
import { ValidationError, reqString, optString, reqInt, optBool, wrap } from "./http";
import { requireAuth, requirePermission, userOf, tenantOf } from "./security";
import {
  isStripePlatformConfigured,
  createConnectedAccount,
  createAccountLink,
  createPaymentIntent,
  accountChargesEnabled,
  verifyWebhook,
} from "./stripe-connect";

export function registerPaymentRoutes(api: Router): void {
  // ---- config + settings ----
  api.get(
    "/payments/config",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const billing = await getTenantBilling(tid);
      const platform = isStripePlatformConfigured();
      const connected = platform && !!billing.stripeAccountId && billing.stripeChargesEnabled;
      const methods: PaymentMethod[] = ["cash", "external_card", "gift_card", "other"];
      if (connected) methods.push("stripe_card");
      res.json({
        stripePlatformConfigured: platform,
        stripeConnected: connected,
        taxRateBps: billing.taxRateBps,
        methods,
      });
    })
  );

  api.post(
    "/settings/tax",
    requireAuth,
    requirePermission("settings.manage"),
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const taxRateBps = reqInt(body.taxRateBps, "taxRateBps", 0);
      if (taxRateBps > 100000) throw new ValidationError("That tax rate looks too high.");
      await setTenantTaxRate(userOf(req).tenantId, taxRateBps);
      res.json({ taxRateBps });
    })
  );

  // ---- Stripe Connect (guarded; lights up when keys + a connected account exist) ----
  api.post(
    "/payments/stripe/connect",
    requireAuth,
    requirePermission("settings.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      if (!isStripePlatformConfigured()) {
        res.status(503).json({ error: "Stripe isn't set up on the server yet.", comingSoon: true });
        return;
      }
      const billing = await getTenantBilling(tid);
      let accountId = billing.stripeAccountId;
      if (!accountId) {
        accountId = await createConnectedAccount();
        await setTenantStripeAccount(tid, accountId);
      }
      const base = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      const url = await createAccountLink(accountId, `${base}/?stripe=return`, `${base}/?stripe=refresh`);
      res.json({ url });
    })
  );

  api.post(
    "/payments/stripe/refresh",
    requireAuth,
    requirePermission("settings.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      if (!isStripePlatformConfigured()) {
        res.status(503).json({ error: "Stripe isn't set up on the server yet.", comingSoon: true });
        return;
      }
      const billing = await getTenantBilling(tid);
      if (!billing.stripeAccountId) {
        res.json({ stripeConnected: false });
        return;
      }
      const enabled = await accountChargesEnabled(billing.stripeAccountId);
      await setTenantStripeChargesEnabled(tid, enabled);
      res.json({ stripeConnected: enabled });
    })
  );

  // Stripe calls this; no auth, secured by signature. rawBody captured globally.
  api.post(
    "/webhooks/stripe",
    wrap(async (req, res) => {
      if (!isStripePlatformConfigured()) {
        res.status(503).json({ error: "Stripe not configured.", comingSoon: true });
        return;
      }
      const sig = req.get("stripe-signature") || "";
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (!raw) {
        res.status(400).json({ error: "Missing request body." });
        return;
      }
      let event;
      try {
        event = verifyWebhook(raw, sig);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
      const tid = tenantOf(req).id;
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as { id?: string };
        if (pi.id) await markPaymentSucceeded(tid, pi.id);
      } else if (event.type === "account.updated") {
        const acct = event.data.object as { charges_enabled?: boolean };
        await setTenantStripeChargesEnabled(tid, acct.charges_enabled === true);
      }
      res.json({ received: true });
    })
  );

  // ---- orders ----
  api.post(
    "/orders",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const clientId = optString(body.clientId) ?? null;
      if (clientId && !(await clientExists(tid, clientId))) throw new ValidationError("That client doesn't exist.");
      res.status(201).json({ order: await createOrder(tid, { clientId }) });
    })
  );

  api.get(
    "/orders",
    requireAuth,
    requirePermission("financials.view"),
    wrap(async (req, res) => {
      const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
      const clientId = typeof req.query.clientId === "string" && req.query.clientId ? req.query.clientId : undefined;
      res.json({ orders: await listOrders(userOf(req).tenantId, { status, clientId }) });
    })
  );

  api.get(
    "/orders/:id",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const o = await getOrder(userOf(req).tenantId, req.params.id);
      if (!o) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      res.json({ order: o });
    })
  );

  api.post(
    "/orders/:id/line-items",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const kind = (optString(body.kind) ?? "custom") as LineKind;
      if (!["service", "product", "custom"].includes(kind)) throw new ValidationError("Invalid line item type.");
      const description = reqString(body.description, "description");
      const quantity = reqInt(body.quantity, "quantity", 1);
      const unitPriceCents = reqInt(body.unitPriceCents, "unitPriceCents", 0);
      const taxable = optBool(body.taxable) ?? kind === "product";
      const serviceVariantId = optString(body.serviceVariantId) ?? null;
      if (serviceVariantId && !(await getVariantForBooking(tid, serviceVariantId)))
        throw new ValidationError("That service isn't available.");
      const appointmentId = optString(body.appointmentId) ?? null;
      const order = await addLineItem(tid, req.params.id, {
        kind,
        description,
        quantity,
        unitPriceCents,
        taxable,
        serviceVariantId,
        appointmentId,
      });
      res.status(201).json({ order });
    })
  );

  api.delete(
    "/orders/:id/line-items/:lineId",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      res.json({ order: await removeLineItem(userOf(req).tenantId, req.params.id, req.params.lineId) });
    })
  );

  api.patch(
    "/orders/:id",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: { discountCents?: number; tipCents?: number } = {};
      if ("discountCents" in body) patch.discountCents = reqInt(body.discountCents, "discountCents", 0);
      if ("tipCents" in body) patch.tipCents = reqInt(body.tipCents, "tipCents", 0);
      res.json({ order: await updateAdjustments(userOf(req).tenantId, req.params.id, patch) });
    })
  );

  api.post(
    "/orders/:id/payments",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const method = optString(body.method) as PaymentMethod | undefined;
      if (!method || !["cash", "external_card", "stripe_card", "gift_card", "other"].includes(method))
        throw new ValidationError("Choose a payment method.");
      const amountCents = reqInt(body.amountCents, "amountCents", 1);

      if (method === "gift_card") {
        const code = optString(body.code);
        if (!code) throw new ValidationError("Enter the gift card code.");
        const { order } = await payOrderWithGiftCard(tid, req.params.id, code, amountCents);
        res.status(201).json({ order });
        return;
      }

      if (method === "stripe_card") {
        const billing = await getTenantBilling(tid);
        const connected = isStripePlatformConfigured() && !!billing.stripeAccountId && billing.stripeChargesEnabled;
        if (!connected)
          throw new ValidationError(
            "Card payments via Stripe aren't set up yet. Connect Stripe in Settings, or take this as cash or external card."
          );
        const intent = await createPaymentIntent(billing.stripeAccountId as string, amountCents, req.params.id);
        const order = await addPayment(tid, req.params.id, {
          method,
          amountCents,
          status: "pending",
          processorRef: intent.id,
        });
        res.status(201).json({ order, stripe: { clientSecret: intent.clientSecret } });
        return;
      }

      const order = await addPayment(tid, req.params.id, { method, amountCents });
      res.status(201).json({ order });
    })
  );

  api.post(
    "/orders/:id/void",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      res.json({ order: await voidOrder(userOf(req).tenantId, req.params.id) });
    })
  );

  api.post(
    "/orders/:id/refund",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const o = await refundOrder(userOf(req).tenantId, req.params.id);
      if (!o) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      res.json({ order: o });
    })
  );
}
