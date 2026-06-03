import { query, withTransaction } from "./index";
import { getOrder, OrderNotFoundError, OrderClosedError } from "./payments";
import { postGiftCardIssued, postOrderSettlement } from "./ledger";
import type { GiftCard, GiftCardTxn, Order } from "@prodigy/contracts";

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export class GiftCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GiftCardError";
  }
}

// Unambiguous charset (no 0/O/1/I).
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}
async function uniqueCode(tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const rows = await query(`SELECT 1 FROM gift_cards WHERE tenant_id = $1 AND code = $2 LIMIT 1`, [tenantId, code]);
    if (rows.length === 0) return code;
  }
  throw new Error("could not generate a unique gift card code");
}

interface GiftCardRow {
  id: string;
  code: string;
  client_id: string | null;
  client_name: string | null;
  initial_cents: number;
  balance_cents: number;
  status: GiftCard["status"];
  note: string | null;
  created_at: string | Date;
}
function mapCard(r: GiftCardRow): GiftCard {
  return {
    id: r.id,
    code: r.code,
    clientId: r.client_id,
    clientName: r.client_name,
    initialCents: r.initial_cents,
    balanceCents: r.balance_cents,
    status: r.status,
    note: r.note,
    createdAt: iso(r.created_at),
  };
}

const CARD_SELECT = `
  SELECT g.id::text AS id, g.code, g.client_id::text AS client_id, c.display_name AS client_name,
         g.initial_cents, g.balance_cents, g.status, g.note, g.created_at
  FROM gift_cards g
  LEFT JOIN clients c ON c.id = g.client_id`;

export async function issueGiftCard(
  tenantId: string,
  input: { amountCents: number; clientId: string | null; note: string | null }
): Promise<GiftCard> {
  const code = await uniqueCode(tenantId);
  let id = "";
  await withTransaction(async (q) => {
    const rows = await q<{ id: string }>(
      `INSERT INTO gift_cards (tenant_id, code, client_id, initial_cents, balance_cents, status, note)
       VALUES ($1, $2, $3::bigint, $4, $4, 'active', $5) RETURNING id::text AS id`,
      [tenantId, code, input.clientId, input.amountCents, input.note]
    );
    id = rows[0].id;
    await q(
      `INSERT INTO gift_card_txns (tenant_id, gift_card_id, kind, amount_cents) VALUES ($1, $2::bigint, 'issue', $3)`,
      [tenantId, id, input.amountCents]
    );
  });
  const card = await getGiftCard(tenantId, id);
  if (!card) throw new Error("failed to load issued gift card");
  try {
    await postGiftCardIssued(tenantId, { id: card.id, code: card.code, initialCents: card.initialCents });
  } catch (e) {
    console.error("[ledger] gift card post failed", e);
  }
  return card;
}

export async function listGiftCards(tenantId: string, opts: { clientId?: string; q?: string } = {}): Promise<GiftCard[]> {
  const rows = await query<GiftCardRow>(
    `${CARD_SELECT}
     WHERE g.tenant_id = $1
       AND ($2::bigint IS NULL OR g.client_id = $2)
       AND ($3::text IS NULL OR g.code ILIKE '%' || $3 || '%')
     ORDER BY g.created_at DESC LIMIT 200`,
    [tenantId, opts.clientId ?? null, opts.q ?? null]
  );
  return rows.map(mapCard);
}

export async function getGiftCard(tenantId: string, id: string): Promise<GiftCard | null> {
  const rows = await query<GiftCardRow>(`${CARD_SELECT} WHERE g.tenant_id = $1 AND g.id = $2 LIMIT 1`, [tenantId, id]);
  return rows[0] ? mapCard(rows[0]) : null;
}

export async function getGiftCardByCode(tenantId: string, code: string): Promise<GiftCard | null> {
  const rows = await query<GiftCardRow>(`${CARD_SELECT} WHERE g.tenant_id = $1 AND g.code = $2 LIMIT 1`, [tenantId, code.trim()]);
  return rows[0] ? mapCard(rows[0]) : null;
}

export async function voidGiftCard(tenantId: string, id: string): Promise<GiftCard | null> {
  const existing = await getGiftCard(tenantId, id);
  if (!existing) return null;
  if (existing.status === "void") return existing;
  await withTransaction(async (q) => {
    await q(`UPDATE gift_cards SET status = 'void' WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    await q(`INSERT INTO gift_card_txns (tenant_id, gift_card_id, kind, amount_cents) VALUES ($1, $2::bigint, 'void', $3)`, [
      tenantId,
      id,
      -existing.balanceCents,
    ]);
  });
  return getGiftCard(tenantId, id);
}

export async function listGiftCardTxns(tenantId: string, cardId: string): Promise<GiftCardTxn[]> {
  const rows = await query<{ id: string; kind: string; amount_cents: number; order_id: string | null; created_at: string | Date }>(
    `SELECT id::text AS id, kind, amount_cents, order_id::text AS order_id, created_at
     FROM gift_card_txns WHERE tenant_id = $1 AND gift_card_id = $2 ORDER BY id DESC`,
    [tenantId, cardId]
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amount_cents, orderId: r.order_id, createdAt: iso(r.created_at) }));
}

/** Atomically redeem a gift card against an order: locks both, records the payment,
 *  deducts the balance, writes the ledger entry, and settles the order if covered. */
export async function payOrderWithGiftCard(
  tenantId: string,
  orderId: string,
  code: string,
  amountCents: number
): Promise<{ order: Order; giftCard: GiftCard }> {
  await withTransaction(async (q) => {
    const ord = await q<{ status: string; total_cents: number }>(
      `SELECT status, total_cents FROM orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, orderId]
    );
    if (!ord[0]) throw new OrderNotFoundError();
    if (ord[0].status !== "open") throw new OrderClosedError();

    const cardRows = await q<{ id: string; balance_cents: number; status: string }>(
      `SELECT id, balance_cents, status FROM gift_cards WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
      [tenantId, code.trim()]
    );
    const card = cardRows[0];
    if (!card) throw new GiftCardError("No gift card found with that code.");
    if (card.status !== "active") throw new GiftCardError("That gift card isn't active.");
    if (amountCents > card.balance_cents) throw new GiftCardError("The gift card balance is lower than that amount.");

    await q(
      `INSERT INTO payments (tenant_id, order_id, method, amount_cents, status, processor_ref)
       VALUES ($1, $2::bigint, 'gift_card', $3, 'recorded', $4)`,
      [tenantId, orderId, amountCents, code.trim()]
    );
    await q(`UPDATE gift_cards SET balance_cents = balance_cents - $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, card.id, amountCents]);
    await q(
      `INSERT INTO gift_card_txns (tenant_id, gift_card_id, kind, amount_cents, order_id) VALUES ($1, $2, 'redeem', $3, $4::bigint)`,
      [tenantId, card.id, -amountCents, orderId]
    );

    const paid = await q<{ paid: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0)::text AS paid FROM payments
       WHERE tenant_id = $1 AND order_id = $2 AND status IN ('recorded', 'succeeded')`,
      [tenantId, orderId]
    );
    if (ord[0].total_cents > 0 && Number(paid[0].paid) >= ord[0].total_cents) {
      await q(`UPDATE orders SET status = 'paid', closed_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, orderId]);
    }
  });

  const order = await getOrder(tenantId, orderId);
  const giftCard = await getGiftCardByCode(tenantId, code);
  if (!order || !giftCard) throw new Error("failed to load order/gift card after redemption");
  if (order.status === "paid") {
    try {
      await postOrderSettlement(tenantId, order);
    } catch (e) {
      console.error("[ledger] gift settlement post failed", e);
    }
  }
  return { order, giftCard };
}
