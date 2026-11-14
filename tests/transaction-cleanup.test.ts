// Non-régression P0 : les GET ne doivent jamais modifier les transactions.
// Le nettoyage des doublons d'autorisations est une écriture explicite,
// limitée au profil propriétaire.

import "./shims";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { apiAs } from "./helpers";
import { TEST_SERVER, ensureTestSession } from "./shims";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const jsonInit = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const insertTricountExpense = (
  db: Database.Database,
  { id, userId, bankRowId, bankReference }: {
    id: string;
    userId: string;
    bankRowId: string;
    bankReference: string;
  },
) => {
  db.prepare(
    `INSERT INTO tricount_expenses (
      id, user_id, month, date, label, amount, payer_person_id, pocket_id,
      split_method, nature, source, bank_reference, bank_row_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'person1', 'unallocated', '50_50', 'expense', 'manual', ?, ?, ?)`,
  ).run(
    id,
    userId,
    "2026-02",
    "2026-02-10",
    "CARREFOUR",
    -42.5,
    bankReference,
    bankRowId,
    Date.now(),
  );
};

describe("nettoyage des doublons d'autorisations", () => {
  it("ne modifie rien sur un GET et ne réassigne que les liens du profil", async () => {
    const user = `SecCleanup_${suffix}`;
    const otherUser = `SecCleanupOther_${suffix}`;
    await ensureTestSession(user);

    const created = await apiAs(
      user,
      "/portfolio/accounts",
      jsonInit("POST", {
        user_id: user,
        name: "Compte cleanup",
        type: "CHECKING",
        balance: 0,
      }),
    );
    expect(created.status).toBe(201);
    const accountId = (await created.json()).account.id as string;

    const pendingRef = `pending-${suffix}`;
    const settledRef = `settled-${suffix}`;
    const pendingExpenseId = randomUUID();
    const otherExpenseId = randomUUID();

    const db = new Database(TEST_SERVER.dbPath);
    db.pragma("busy_timeout = 5000");
    const repository = new PortfolioRepository(db);
    const inserted = repository.insertTransactions(user, accountId, "manual", [
      {
        externalId: pendingRef,
        dedupKey: `dedup-${pendingRef}`,
        date: "2026-02-10",
        amount: -42.5,
        label: "CARREFOUR",
        pending: true,
      },
      {
        externalId: settledRef,
        dedupKey: `dedup-${settledRef}`,
        date: "2026-02-11",
        amount: -42.5,
        label: "CARREFOUR",
        pending: false,
      },
    ]);
    expect(inserted).toBe(2);

    const pendingRow = db
      .prepare("SELECT id FROM transactions WHERE account_id = ? AND external_id = ?")
      .get(accountId, pendingRef) as { id: string };
    const settledRow = db
      .prepare("SELECT id FROM transactions WHERE account_id = ? AND external_id = ?")
      .get(accountId, settledRef) as { id: string };

    insertTricountExpense(db, {
      id: pendingExpenseId,
      userId: user,
      bankRowId: pendingRow.id,
      bankReference: pendingRef,
    });
    insertTricountExpense(db, {
      id: otherExpenseId,
      userId: otherUser,
      bankRowId: pendingRow.id,
      bankReference: pendingRef,
    });
    db.close();

    // Un GET ne doit rien supprimer ni réassocier.
    const before = await apiAs(
      user,
      `/portfolio/transactions?user_id=${encodeURIComponent(user)}&account_id=${encodeURIComponent(accountId)}`,
    );
    expect(before.status).toBe(200);
    expect((await before.json()).transactions).toHaveLength(2);

    const readLinks = () => {
      const readonly = new Database(TEST_SERVER.dbPath, {
        readonly: true,
        fileMustExist: true,
      });
      const rows = readonly
        .prepare(
          "SELECT id, user_id, bank_row_id FROM tricount_expenses WHERE id IN (?, ?)",
        )
        .all(pendingExpenseId, otherExpenseId) as Array<{
        id: string;
        user_id: string;
        bank_row_id: string;
      }>;
      readonly.close();
      return new Map(rows.map((row) => [row.id, row]));
    };

    let links = readLinks();
    expect(links.get(pendingExpenseId)?.bank_row_id).toBe(pendingRow.id);
    expect(links.get(otherExpenseId)?.bank_row_id).toBe(pendingRow.id);

    // Le nettoyage explicite réassigne le lien du profil propriétaire.
    const cleanup = await apiAs(
      user,
      "/portfolio/transactions/cleanup-duplicates",
      jsonInit("POST", { user_id: user, account_id: accountId }),
    );
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toEqual({ cleaned: 1 });

    const after = await apiAs(
      user,
      `/portfolio/transactions?user_id=${encodeURIComponent(user)}&account_id=${encodeURIComponent(accountId)}`,
    );
    expect(after.status).toBe(200);
    const remaining = (await after.json()).transactions;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].externalId).toBe(settledRef);

    links = readLinks();
    expect(links.get(pendingExpenseId)?.bank_row_id).toBe(settledRow.id);
    // Le profil étranger n'est jamais touché, même avec le même identifiant.
    expect(links.get(otherExpenseId)?.bank_row_id).toBe(pendingRow.id);
  });
});
