import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe isn't configured on this server yet.");
    this.name = "StripeNotConfiguredError";
  }
}

/** Is the platform-level Stripe secret key present? (Connect onboarding/charging needs it.) */
export function isStripePlatformConfigured(): boolean {
  return !!SECRET;
}

function formEncode(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

interface StripeResponse {
  id?: string;
  url?: string;
  client_secret?: string;
  charges_enabled?: boolean;
  error?: { message?: string };
  [k: string]: unknown;
}

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number> = {},
  stripeAccount?: string
): Promise<StripeResponse> {
  if (!SECRET) throw new StripeNotConfiguredError();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: method === "POST" ? formEncode(params) : undefined,
  });
  const data = (await res.json()) as StripeResponse;
  if (!res.ok) throw new Error(data?.error?.message || "Stripe request failed.");
  return data;
}

/** Connected account onboarding (Standard Connect). */
export async function createConnectedAccount(): Promise<string> {
  const acct = await stripeRequest("POST", "accounts", { type: "standard" });
  if (!acct.id) throw new Error("Stripe did not return an account id.");
  return acct.id;
}

export async function createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
  const link = await stripeRequest("POST", "account_links", {
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  if (!link.url) throw new Error("Stripe did not return an onboarding URL.");
  return link.url;
}

export async function accountChargesEnabled(accountId: string): Promise<boolean> {
  const acct = await stripeRequest("GET", `accounts/${accountId}`);
  return acct.charges_enabled === true;
}

/** Create a PaymentIntent on the connected account; returns the client secret for the browser to confirm. */
export async function createPaymentIntent(
  accountId: string,
  amountCents: number,
  orderId: string
): Promise<{ id: string; clientSecret: string }> {
  const pi = await stripeRequest(
    "POST",
    "payment_intents",
    {
      amount: amountCents,
      currency: "usd",
      "automatic_payment_methods[enabled]": "true",
      "metadata[order_id]": orderId,
    },
    accountId
  );
  if (!pi.id || !pi.client_secret) throw new Error("Stripe did not return a PaymentIntent.");
  return { id: pi.id, clientSecret: pi.client_secret };
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

/** Verify a Stripe webhook signature (HMAC-SHA256 over `${t}.${payload}`) and parse the event. */
export function verifyWebhook(rawBody: Buffer, signatureHeader: string): StripeEvent {
  if (!WEBHOOK_SECRET) throw new StripeNotConfiguredError();
  const parts = Object.fromEntries(signatureHeader.split(",").map((kv) => kv.split("=")));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) throw new Error("Malformed Stripe-Signature header.");
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody.toString("utf8")}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Stripe signature verification failed.");
  return JSON.parse(rawBody.toString("utf8")) as StripeEvent;
}
