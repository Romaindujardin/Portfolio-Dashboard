import "./shims";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import {
  parseAccountsFromOutput,
  parseCsvText,
  extractCsvFromOutput,
  saveBoursoCredentials,
  getBoursoSavedCredentials,
  deleteBoursoCredentials,
  getBoursoStatus,
  BOURSO_PROVIDER,
} from "../server/services/boursoSidecarService.js";

describe("BoursoBank Sidecar Service", () => {
  let db: any;
  let repo: any;

  beforeEach(() => {
    db = new Database(":memory:");
    initializePortfolioSchema(db);
    repo = new PortfolioRepository(db);
  });

  it("parseAccountsFromOutput extrait correctement les comptes Banking, Saving et Trading (PEA, CTO)", () => {
    const sampleOutput = `
Account {
    id: "acc_courant_123",
    name: "Compte de Chèques",
    balance: 1420.50,
    bank_name: "BoursoBank",
    kind: Banking,
}
Account {
    id: "acc_livreta_456",
    name: "Livret A",
    balance: 12000.00,
    bank_name: "BoursoBank",
    kind: Saving,
}
Account {
    id: "acc_pea_789",
    name: "PEA Titres",
    balance: 34500.80,
    bank_name: "BoursoBank",
    kind: Trading,
}
`;
    const accounts = parseAccountsFromOutput(sampleOutput);
    expect(accounts).toHaveLength(3);

    expect(accounts[0]).toEqual({
      id: "acc_courant_123",
      name: "Compte de Chèques",
      balance: 1420.50,
      bankName: "BoursoBank",
      kind: "Banking",
    });

    expect(accounts[1]).toEqual({
      id: "acc_livreta_456",
      name: "Livret A",
      balance: 12000.00,
      bankName: "BoursoBank",
      kind: "Saving",
    });

    expect(accounts[2]).toEqual({
      id: "acc_pea_789",
      name: "PEA Titres",
      balance: 34500.80,
      bankName: "BoursoBank",
      kind: "Trading",
    });
  });

  it("parseCsvText découpe proprement les en-têtes et les lignes", () => {
    const csv = `date;label;amount;currency;category
2026-10-15;Supermarché Carrefour;-45.20;EUR;Alimentation
2026-10-16;Salaire Entreprise;2500.00;EUR;Revenu`;

    const parsed = parseCsvText(csv);
    expect(parsed.headers).toEqual(["date", "label", "amount", "currency", "category"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].label).toBe("Supermarché Carrefour");
    expect(parsed.rows[0].amount).toBe("-45.20");
    expect(parsed.rows[1].amount).toBe("2500.00");
  });

  it("extractCsvFromOutput isole le bloc CSV d'une sortie brute CLI", () => {
    const rawCliOutput = `
[INFO] Welcome to BoursoBank CLI
[INFO] Fetching transactions...
date,date_op,label,amount,currency
2026-10-01,2026-10-01,Restaurant,-32.50,EUR
2026-10-02,2026-10-02,Transport,-4.20,EUR
`;
    const extracted = extractCsvFromOutput(rawCliOutput, "date,");
    expect(extracted.startsWith("date,date_op,label,amount,currency")).toBe(true);
    const parsed = parseCsvText(extracted);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].label).toBe("Restaurant");
  });

  it("sauvegarde, relit et supprime les identifiants chiffrés BoursoBank", () => {
    saveBoursoCredentials(repo, {
      customerId: "user_bourso_123",
      password: "SuperSecretPassword!",
    });

    const status = getBoursoStatus(repo);
    expect(status.configured).toBe(true);
    expect(status.customerId).toBe("user_bourso_123");

    const creds = getBoursoSavedCredentials(repo);
    expect(creds).toEqual({
      customerId: "user_bourso_123",
      password: "SuperSecretPassword!",
    });

    deleteBoursoCredentials(repo);
    const postStatus = getBoursoStatus(repo);
    expect(postStatus.configured).toBe(false);
    expect(postStatus.customerId).toBe(null);
  });

  it("gère l'insertion d'un compte Bourso sidecar dans le portfolio repository", () => {
    const conn = repo.createConnector("Romain", {
      provider: BOURSO_PROVIDER,
      label: "BoursoBank (Sidecar)",
      status: "active",
      aspspName: "BoursoBank",
      aspspCountry: "FR",
    });

    const account = repo.upsertSyncedAccount("Romain", {
      provider: BOURSO_PROVIDER,
      externalId: "bourso-pea-1",
      connectionId: conn.id,
      name: "PEA Boursorama",
      type: "PEA",
      currency: "EUR",
      balance: 15420.75,
      cashBalance: 120.75,
    });

    expect(account.id).toBeDefined();
    expect(account.provider).toBe("bourso-sidecar");
    expect(account.type).toBe("PEA");
    expect(account.balance).toBe(15420.75);

    // Ajout d'une holding sur ce PEA
    repo.upsertHolding("Romain", account.id, {
      isin: "FR0011869353",
      ticker: "CW8",
      name: "Amundi MSCI World",
      quantity: 30,
      costBasis: 12000,
      price: 510,
      value: 15300,
      assetClass: "EQUITY",
    });

    const holdings = repo.listHoldings(account.id, "Romain");
    expect(holdings).toHaveLength(1);
    expect(holdings[0].ticker).toBe("CW8");
    expect(holdings[0].price).toBe(510);
    expect(holdings[0].quantity).toBe(30);
    expect((holdings[0].price ?? 0) * holdings[0].quantity).toBe(15300);

    // Ajout de transactions
    const insertedCount = repo.insertTransactions("Romain", account.id, BOURSO_PROVIDER, [
      {
        externalId: "tx_12345",
        dedupKey: "bourso:tx_12345",
        date: "2026-10-20",
        amount: -510,
        currency: "EUR",
        label: "Achat 1 CW8",
      },
    ]);

    expect(insertedCount).toBe(1);
    const txs = repo.listTransactions(account.id, "Romain");
    expect(txs).toHaveLength(1);
    expect(txs[0].externalId).toBe("tx_12345");
  });
});
