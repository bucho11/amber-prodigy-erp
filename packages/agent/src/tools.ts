import {
  trialBalance,
  listAccounts,
  listOrders,
  listGiftCards,
  issueGiftCard,
  createClient,
  listClients,
  listAppointments,
  salesSummary,
  incomeSummary,
  inventorySnapshot,
  createSoapNote,
  bookAppointmentChecked,
  type ClientInput,
} from "@prodigy/db";
import type { AgentActor, AgentTool, ToolDefinition } from "./types";

// ---- tiny input validators (throw on bad input; the message is surfaced to the caller) ----
class ToolInputError extends Error {}
function reqStr(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new ToolInputError(`'${field}' is required.`);
  return v.trim();
}
function optStr(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ToolInputError("Expected a string.");
  return v.trim();
}
function reqInt(v: unknown, field: string, min = Number.MIN_SAFE_INTEGER): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min) throw new ToolInputError(`'${field}' must be an integer ≥ ${min}.`);
  return n;
}
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
function optDate(v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolInputError("Dates must be YYYY-MM-DD.");
  return v;
}
function reqDate(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolInputError(`'${field}' must be a date (YYYY-MM-DD).`);
  return v;
}
function monthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return isoDay(new Date());
}
function tomorrow(): string {
  return isoDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

/**
 * Initial tool registry — read tools auto-execute (RBAC-gated); write tools require approval.
 * Spans books, POS, gift cards, and CRM so the gate is exercised across domains. The agent calls
 * the SAME db functions the human UI does, so tenant-scoping, money math, and ledgers are reused.
 */
const TOOLS: AgentTool[] = [
  {
    name: "get_trial_balance",
    description:
      "Get the current accounting trial balance — every account's net balance plus equal debit/credit totals. Call this when asked about the books, account balances, or whether the ledger balances.",
    permission: "financials.view",
    risk: "auto",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parse: () => ({}),
    handler: ({ actor }) => trialBalance(actor.tenantId),
  },
  {
    name: "list_accounts",
    description:
      "List the chart of accounts (code, name, type). Call this to look up an account code or see what accounts exist.",
    permission: "financials.view",
    risk: "auto",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parse: () => ({}),
    handler: ({ actor }) => listAccounts(actor.tenantId, {}),
  },
  {
    name: "list_recent_sales",
    description:
      "List recent point-of-sale orders, most recent first. Call this when asked about recent sales, tickets, or checkout activity. Optional status filter: open | paid | void | refunded.",
    permission: "financials.view",
    risk: "auto",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "paid", "void", "refunded"] } },
      additionalProperties: false,
    },
    parse: (input) => ({ status: optStr((input as { status?: unknown })?.status) ?? undefined }),
    handler: ({ actor }, input) => listOrders(actor.tenantId, input as { status?: string }),
  },
  {
    name: "list_gift_cards",
    description:
      "List the business's gift cards with balances and status. Call this when asked about gift cards, stored value, or a card balance.",
    permission: "sales.manage",
    risk: "auto",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parse: () => ({}),
    handler: ({ actor }) => listGiftCards(actor.tenantId, {}),
  },
  {
    name: "find_client",
    description:
      "Search clients by name, email, or phone. Call this to look someone up before answering about a specific client. Returns up to 20 matches.",
    permission: "clients.view",
    risk: "auto",
    inputSchema: {
      type: "object",
      properties: { search: { type: "string", description: "Name, email, or phone fragment" } },
      required: ["search"],
      additionalProperties: false,
    },
    parse: (input) => ({ search: reqStr((input as { search?: unknown })?.search, "search") }),
    handler: ({ actor }, input) => listClients(actor.tenantId, { search: (input as { search: string }).search, limit: 20 }),
  },
  {
    name: "list_appointments",
    description:
      "List appointments in a date range (defaults to today). Call this for schedule/calendar questions like what's booked today or this week. Dates are YYYY-MM-DD.",
    permission: "scheduling.view",
    risk: "auto",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      return { from: optDate(i.from, today()), to: optDate(i.to, tomorrow()) };
    },
    handler: ({ actor }, input) => listAppointments(actor.tenantId, input as { from: string; to: string }),
  },
  {
    name: "sales_summary",
    description:
      "Sales summary for a date range (defaults to the current month): net sales, tax, tips, discounts, payments by method, refunds. Call this for revenue/sales questions. Dates are YYYY-MM-DD.",
    permission: "reports.view",
    risk: "auto",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      return { from: optDate(i.from, monthStart()), to: optDate(i.to, today()) };
    },
    handler: ({ actor }, input) => salesSummary(actor.tenantId, (input as { from: string }).from, (input as { to: string }).to),
  },
  {
    name: "income_summary",
    description:
      "Income (P&L) summary from the ledger for a date range (defaults to the current month): revenue, expenses, and net income by account. Call this for profit/expense questions. Dates are YYYY-MM-DD.",
    permission: "reports.view",
    risk: "auto",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      return { from: optDate(i.from, monthStart()), to: optDate(i.to, today()) };
    },
    handler: ({ actor }, input) => incomeSummary(actor.tenantId, (input as { from: string }).from, (input as { to: string }).to),
  },
  {
    name: "inventory_snapshot",
    description:
      "Current inventory snapshot: stock value at cost and retail, out-of-stock count, and the low-stock list. Call this for stock/inventory questions.",
    permission: "inventory.view",
    risk: "auto",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parse: () => ({}),
    handler: ({ actor }) => inventorySnapshot(actor.tenantId),
  },
  {
    name: "create_client",
    description:
      "Create a new client record. This WRITES data, so it pauses for human approval before it runs. Provide at least a display name.",
    permission: "clients.manage",
    risk: "approval",
    inputSchema: {
      type: "object",
      properties: { displayName: { type: "string" }, email: { type: "string" }, phone: { type: "string" } },
      required: ["displayName"],
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      return { displayName: reqStr(i.displayName, "displayName"), email: optStr(i.email), phone: optStr(i.phone) };
    },
    handler: ({ actor }, input) => createClient(actor.tenantId, input as ClientInput),
  },
  {
    name: "book_appointment",
    description:
      "Book an appointment for a client with a provider at a specific time. This WRITES to the calendar and is double-booking-guarded, so it requires human approval before it runs. Needs clientId, providerId, serviceVariantId, and startsAt (ISO 8601, e.g. 2026-09-01T17:00:00Z). Optional roomId and notes.",
    permission: "scheduling.manage",
    risk: "approval",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        providerId: { type: "string" },
        serviceVariantId: { type: "string" },
        startsAt: { type: "string", description: "ISO 8601 start time" },
        roomId: { type: "string" },
        notes: { type: "string" },
      },
      required: ["clientId", "providerId", "serviceVariantId", "startsAt"],
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      return {
        clientId: reqStr(i.clientId, "clientId"),
        providerId: reqStr(i.providerId, "providerId"),
        serviceVariantId: reqStr(i.serviceVariantId, "serviceVariantId"),
        startsAt: reqStr(i.startsAt, "startsAt"),
        roomId: optStr(i.roomId),
        notes: optStr(i.notes),
      };
    },
    handler: ({ actor }, input) =>
      bookAppointmentChecked(actor.tenantId, input as {
        clientId: string;
        providerId: string;
        serviceVariantId: string;
        startsAt: string;
        roomId: string | null;
        notes: string | null;
      }),
  },
  {
    name: "add_soap_note",
    description:
      "Add a SOAP clinical note (Subjective / Objective / Assessment / Plan) to a client's chart. This WRITES clinical records, so it requires human approval before it runs. Needs a clientId and a date (YYYY-MM-DD); the S/O/A/P fields are optional text.",
    permission: "clinical.manage",
    risk: "approval",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        subjective: { type: "string" },
        objective: { type: "string" },
        assessment: { type: "string" },
        plan: { type: "string" },
      },
      required: ["clientId", "date"],
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      return {
        clientId: reqStr(i.clientId, "clientId"),
        date: reqDate(i.date, "date"),
        appointmentId: null,
        providerId: null,
        subjective: optStr(i.subjective),
        objective: optStr(i.objective),
        assessment: optStr(i.assessment),
        plan: optStr(i.plan),
      };
    },
    handler: ({ actor }, input) =>
      createSoapNote(actor.tenantId, input as {
        clientId: string;
        date: string;
        appointmentId: string | null;
        providerId: string | null;
        subjective: string | null;
        objective: string | null;
        assessment: string | null;
        plan: string | null;
      }),
  },
  {
    name: "issue_gift_card",
    description:
      "Issue a new prepaid gift card for a given amount (in cents). This MOVES stored value and posts to the books, so it requires human approval before it runs. Optionally tie it to a client.",
    permission: "sales.manage",
    risk: "approval",
    inputSchema: {
      type: "object",
      properties: { amountCents: { type: "integer" }, clientId: { type: "string" }, note: { type: "string" } },
      required: ["amountCents"],
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      return { amountCents: reqInt(i.amountCents, "amountCents", 1), clientId: optStr(i.clientId), note: optStr(i.note) };
    },
    handler: ({ actor }, input) =>
      issueGiftCard(actor.tenantId, input as { amountCents: number; clientId: string | null; note: string | null }),
  },
];

const BY_NAME = new Map<string, AgentTool>(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

export function allTools(): readonly AgentTool[] {
  return TOOLS;
}

export function actorCan(actor: AgentActor, permission: string): boolean {
  return actor.isOwner || actor.permissions.includes(permission);
}

/** Tool catalog filtered with an `allowed` flag for the given actor (safe to expose — no handlers). */
export function toolDefinitions(actor: AgentActor): ToolDefinition[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    permission: t.permission,
    risk: t.risk,
    inputSchema: t.inputSchema,
    allowed: actorCan(actor, t.permission),
  }));
}
