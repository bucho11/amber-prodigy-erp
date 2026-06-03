import type { Router } from "express";
import { issueGiftCard, listGiftCards, getGiftCard, getGiftCardByCode, voidGiftCard, listGiftCardTxns, clientExists } from "@prodigy/db";
import { ValidationError, reqInt, optString, wrap } from "./http";
import { requireAuth, requirePermission, userOf } from "./security";

export function registerGiftCardRoutes(api: Router): void {
  api.post(
    "/gift-cards",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const amountCents = reqInt(b.amountCents, "amountCents", 1);
      const clientId = optString(b.clientId) ?? null;
      if (clientId && !(await clientExists(tid, clientId))) throw new ValidationError("That client doesn't exist.");
      res.status(201).json({ giftCard: await issueGiftCard(tid, { amountCents, clientId, note: optString(b.note) ?? null }) });
    })
  );

  api.get(
    "/gift-cards",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const clientId = typeof req.query.clientId === "string" && req.query.clientId ? req.query.clientId : undefined;
      const q = typeof req.query.q === "string" && req.query.q ? req.query.q : undefined;
      res.json({ giftCards: await listGiftCards(userOf(req).tenantId, { clientId, q }) });
    })
  );

  // Lookup by code for redemption — must precede "/gift-cards/:id".
  api.get(
    "/gift-cards/lookup",
    requireAuth,
    requirePermission("pos.operate"),
    wrap(async (req, res) => {
      const code = optString(req.query.code);
      if (!code) throw new ValidationError("A gift card code is required.");
      const card = await getGiftCardByCode(userOf(req).tenantId, code);
      if (!card) {
        res.status(404).json({ error: "No gift card found with that code." });
        return;
      }
      res.json({ giftCard: card });
    })
  );

  api.get(
    "/gift-cards/:id",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const tid = userOf(req).tenantId;
      const card = await getGiftCard(tid, req.params.id);
      if (!card) {
        res.status(404).json({ error: "Gift card not found." });
        return;
      }
      res.json({ giftCard: card, transactions: await listGiftCardTxns(tid, req.params.id) });
    })
  );

  api.post(
    "/gift-cards/:id/void",
    requireAuth,
    requirePermission("sales.manage"),
    wrap(async (req, res) => {
      const card = await voidGiftCard(userOf(req).tenantId, req.params.id);
      if (!card) {
        res.status(404).json({ error: "Gift card not found." });
        return;
      }
      res.json({ giftCard: card });
    })
  );
}
