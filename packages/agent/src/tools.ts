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
  balanceSheet,
  payablesSummary,
  listBills,
  inventorySnapshot,
  createSoapNote,
  bookAppointmentChecked,
  recordExpense,
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
const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
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
    summarize: (r) => {
      const tb = r as { rows: unknown[]; totalDebitCents: number; totalCreditCents: number };
      return `Trial balance: ${tb.rows.length} accounts with balances; total debits ${usd(tb.totalDebitCents)} = total credits ${usd(tb.totalCreditCents)} (balanced).`;
    },
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
    summarize: (r) => {
      const os = r as { status: string; totalCents: number; clientName: string | null }[];
      if (os.length === 0) return "No recent sales.";
      const total = os.reduce((s, o) => s + (o.totalCents ?? 0), 0);
      const head = os.slice(0, 3).map((o) => `${o.clientName ?? "walk-in"} ${usd(o.totalCents)} (${o.status})`).join("; ");
      return `${os.length} recent order(s), total ${usd(total)}; latest: ${head}.`;
    },
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
    summarize: (r) => {
      const gs = r as { balanceCents: number }[];
      if (gs.length === 0) return "No gift cards.";
      const total = gs.reduce((s, g) => s + (g.balanceCents ?? 0), 0);
      return `${gs.length} gift card(s); total outstanding balance ${usd(total)}.`;
    },
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
    summarize: (r) => {
      const cs = r as { displayName: string; email: string | null }[];
      if (cs.length === 0) return "No matching clients found.";
      const head = cs.slice(0, 5).map((c) => `${c.displayName}${c.email ? ` (${c.email})` : ""}`).join("; ");
      return `${cs.length} client(s): ${head}${cs.length > 5 ? `, +${cs.length - 5} more` : ""}.`;
    },
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
    summarize: (r) => {
      const as = r as { startsAt: string }[];
      if (as.length === 0) return "No appointments in that range.";
      const first = new Date(as[0].startsAt).toISOString().slice(0, 16).replace("T", " ");
      return `${as.length} appointment(s) in range; first at ${first} UTC.`;
    },
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
    summarize: (r) => {
      const s = r as { from: string; to: string; paidOrderCount: number; netSalesCents: number; taxCents: number; tipCents: number; totalCollectedCents: number; refundCount: number; refundedCents: number };
      return `Sales ${s.from}→${s.to}: ${s.paidOrderCount} paid orders, net sales ${usd(s.netSalesCents)}, tax ${usd(s.taxCents)}, tips ${usd(s.tipCents)}, total collected ${usd(s.totalCollectedCents)}; ${s.refundCount} refund(s) ${usd(s.refundedCents)}.`;
    },
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
    name: "get_balance_sheet",
    description:
      "Balance sheet from the ledger as of a date (defaults to today): assets, liabilities, and equity (with net income to date folded in). Call this for questions about what the business owns/owes, financial position, or net worth. Date is YYYY-MM-DD.",
    permission: "reports.view",
    risk: "auto",
    inputSchema: {
      type: "object",
      properties: { asOf: { type: "string" } },
      additionalProperties: false,
    },
    parse: (input) => ({ asOf: optDate((input as Record<string, unknown> | undefined)?.asOf, today()) }),
    handler: ({ actor }, input) => balanceSheet(actor.tenantId, (input as { asOf: string }).asOf),
    summarize: (r) => {
      const b = r as { totalAssetsCents: number; totalLiabilitiesCents: number; totalEquityCents: number; balanced: boolean };
      return `Balance sheet: assets ${usd(b.totalAssetsCents)} = liabilities ${usd(b.totalLiabilitiesCents)} + equity ${usd(b.totalEquityCents)}${b.balanced ? " (balanced)" : " (OUT OF BALANCE — investigate)"}.`;
    },
  },
  {
    name: "payables_summary",
    description:
      "What the business currently owes vendors: count and total of open (unpaid) bills, and the overdue subset. Call this for 'what do we owe', 'accounts payable', or 'are any bills overdue' questions.",
    permission: "financials.view",
    risk: "auto",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parse: () => ({}),
    handler: ({ actor }) => payablesSummary(actor.tenantId),
    summarize: (r) => {
      const s = r as { openCount: number; openCents: number; overdueCount: number; overdueCents: number };
      return `Payables: ${s.openCount} open bill(s) totaling ${usd(s.openCents)}${s.overdueCount > 0 ? `, of which ${s.overdueCount} (${usd(s.overdueCents)}) are overdue` : " (none overdue)"}.`;
    },
  },
  {
    name: "list_unpaid_bills",
    description:
      "List the open (unpaid) bills owed to vendors — vendor, amount, due date. Call this when asked which bills are outstanding or what's due.",
    permission: "financials.view",
    risk: "auto",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parse: () => ({}),
    handler: ({ actor }) => listBills(actor.tenantId, { status: "open" }),
    summarize: (r) => {
      const bills = r as Array<{ vendorName: string; amountCents: number; dueDate: string }>;
      if (bills.length === 0) return "No open bills — nothing owed to vendors right now.";
      return `${bills.length} open bill(s): ${bills.slice(0, 5).map((b) => `${b.vendorName} ${usd(b.amountCents)} due ${b.dueDate}`).join("; ")}${bills.length > 5 ? "; …" : ""}.`;
    },
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
    summarize: (r) => {
      const s = r as { trackedProductCount: number; inventoryValueCents: number; retailValueCents: number; outOfStockCount: number; lowStock: unknown[] };
      return `Inventory: ${s.trackedProductCount} tracked products; stock value ${usd(s.inventoryValueCents)} at cost / ${usd(s.retailValueCents)} retail; ${s.outOfStockCount} out of stock, ${s.lowStock.length} low.`;
    },
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
    preview: (input) => {
      const i = input as { displayName: string; email: string | null };
      return `Create a new client "${i.displayName}"${i.email ? ` (${i.email})` : ""}.`;
    },
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
    preview: (input) => {
      const i = input as { clientId: string; providerId: string; startsAt: string };
      return `Book an appointment for client #${i.clientId} with provider #${i.providerId} at ${i.startsAt}.`;
    },
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
    preview: (input) => {
      const i = input as { clientId: string; date: string };
      return `Add a SOAP clinical note for client #${i.clientId} dated ${i.date}.`;
    },
  },
  {
    name: "record_expense",
    description:
      "Record an operating expense (money paid out) to the books as a balanced journal entry — debits the expense account, credits Cash. WRITES to the ledger, so it requires human approval. Needs an expense account code (e.g. 6000 Operating Expenses, 6100 Merchant Fees, 6200 Rent & Facilities), an amount in cents, and a memo. Optional date (YYYY-MM-DD, defaults to today).",
    permission: "books.manage",
    risk: "approval",
    inputSchema: {
      type: "object",
      properties: {
        expenseAccountCode: { type: "string", description: "e.g. 6000, 6100, 6200, 6300" },
        amountCents: { type: "integer" },
        memo: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["expenseAccountCode", "amountCents", "memo"],
      additionalProperties: false,
    },
    parse: (input) => {
      const i = (input ?? {}) as Record<string, unknown>;
      const dateRaw = i.date;
      return {
        expenseAccountCode: reqStr(i.expenseAccountCode, "expenseAccountCode"),
        amountCents: reqInt(i.amountCents, "amountCents", 1),
        memo: reqStr(i.memo, "memo"),
        date: dateRaw === undefined || dateRaw === null || dateRaw === "" ? undefined : reqDate(dateRaw, "date"),
      };
    },
    handler: ({ actor }, input) =>
      recordExpense(actor.tenantId, input as { expenseAccountCode: string; amountCents: number; memo: string; date?: string }),
    preview: (input) => {
      const i = input as { expenseAccountCode: string; amountCents: number; memo: string };
      return `Record a ${usd(i.amountCents)} expense to account ${i.expenseAccountCode} — "${i.memo}".`;
    },
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
    preview: (input) => {
      const i = input as { amountCents: number; clientId: string | null };
      return `Issue a ${usd(i.amountCents)} gift card${i.clientId ? ` to client #${i.clientId}` : ""}.`;
    },
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
