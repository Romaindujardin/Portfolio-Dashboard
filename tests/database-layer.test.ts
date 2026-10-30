// Tests directs de la couche SQLite (src/utils/database/database.js) sur une
// base isolée dédiée : CRUD, whitelists anti-injection, visibilités, stats.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TMP_DIR = path.join(process.cwd(), ".test-tmp");
const DB_FILE = path.join(TMP_DIR, "direct-layer.db");

fs.mkdirSync(TMP_DIR, { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${DB_FILE}${suffix}`, { force: true });
}

// La base doit être pointée AVANT l'import du module (singleton).
process.env.DATABASE_PATH = DB_FILE;

const { default: DatabaseManager } = await import(
  "../src/utils/database/database.js"
);

const dbManager = DatabaseManager.getInstance();

beforeAll(() => {
  dbManager.initializeTables();
  dbManager.initializeTables(); // idempotent
});

afterAll(() => {
  try {
    dbManager.closeDatabase();
  } catch {
    // déjà fermée
  }
});

describe("wallets (couche SQLite)", () => {
  let walletId = "";

  it("base neuve : statistiques à zéro et chemin isolé", () => {
    const stats = dbManager.getDatabaseStats();
    expect(stats.wallets).toBe(0);
    expect(stats.assets).toBe(0);
    expect(stats.bankCsvUploads).toBe(0);
    expect(stats.tricountExpenses).toBe(0);
    expect(stats.databasePath).toBe(DB_FILE);
  });

  it("crée un wallet et le relit (scoping par user_id)", () => {
    walletId = dbManager.createWallet({
      user_id: "DbUser",
      name: "W1",
      address: "0x1",
      wallet_type: "metamask",
      blockchains: ["ethereum"],
      total_value: 10,
    });
    expect(walletId).toBeTruthy();
    expect(dbManager.getAllWallets("DbUser")).toHaveLength(1);
    expect(dbManager.getAllWallets("Autre")).toHaveLength(0);
    expect(dbManager.getWalletById(walletId).name).toBe("W1");
  });

  it("updateWallet : whitelist de colonnes (anti-injection SQL)", () => {
    const ok = dbManager.updateWallet(walletId, {
      name: "Robert'); DROP TABLE wallets;--",
      total_value: 55,
      id: "pirate",
      evil_column: 1,
    });
    expect(ok).toBe(true);

    const wallet = dbManager.getWalletById(walletId);
    expect(wallet.name).toBe("Robert'); DROP TABLE wallets;--");
    expect(wallet.total_value).toBe(55);
    expect(wallet.user_id).toBe("DbUser");
    expect(wallet.id).toBe(walletId);
    expect(dbManager.getAllWallets("DbUser")).toHaveLength(1);

    // Aucun champ autorisé → aucun effet
    expect(dbManager.updateWallet(walletId, { evil_column: 1 })).toBe(false);
    // Wallet inexistant → false
    expect(dbManager.updateWallet("id-inexistant", { name: "X" })).toBe(false);
  });

  it("assets : création, visibilité, suppression", () => {
    const assetId = dbManager.createWalletAsset({
      wallet_id: walletId,
      symbol: "BTC",
      name: "Bitcoin",
      balance: 0.5,
      decimals: 8,
      blockchain: "bitcoin",
      price: 60000,
      value: 30000,
    });
    expect(dbManager.getWalletAssets(walletId)).toHaveLength(1);

    expect(dbManager.updateWalletAssetVisibility(assetId, true)).toBe(true);
    expect(dbManager.getWalletAssets(walletId)[0].is_hidden).toBe(1);
    expect(dbManager.updateWalletAssetVisibility("inexistant", true)).toBe(false);

    expect(dbManager.deleteWalletAssets(walletId)).toBe(true);
    expect(dbManager.getWalletAssets(walletId)).toHaveLength(0);
  });

  it("NFTs : création, visibilité booléenne, suppression", () => {
    const nftId = dbManager.createWalletNFT({
      wallet_id: walletId,
      token_id: "77",
      name: "NFT",
      symbol: "N",
      blockchain: "ethereum",
      collection: "Coll",
      contract_address: "0xabc",
    });
    const nfts = dbManager.getWalletNFTs(walletId);
    expect(nfts).toHaveLength(1);
    expect(nfts[0].token_id).toBe("77");

    expect(dbManager.updateWalletNFTVisibility(nftId, true)).toBe(true);
    expect(dbManager.updateWalletNFTVisibility("inexistant", true)).toBe(false);
    expect(dbManager.getWalletNFTs(walletId)[0].is_hidden).toBe(1);

    dbManager.deleteWalletNFTs(walletId);
    expect(dbManager.getWalletNFTs(walletId)).toHaveLength(0);
  });

  it("supprime le wallet", () => {
    expect(dbManager.deleteWallet(walletId)).toBe(true);
    expect(dbManager.deleteWallet(walletId)).toBe(false);
    expect(dbManager.getAllWallets("DbUser")).toHaveLength(0);
  });
});

describe("imports CSV bancaires (couche SQLite)", () => {
  it("crée, relit, liste sans contenu, met à jour puis supprime", () => {
    const csvId = dbManager.createBankCsvUpload({
      user_id: "DbUser",
      filename: "f.csv",
      content: "contenu",
      size_bytes: 7,
    });
    expect(dbManager.getBankCsvUploadById(csvId, "DbUser").content).toBe(
      "contenu",
    );

    const meta = dbManager.getAllBankCsvUploadsMeta("DbUser");
    expect(meta).toHaveLength(1);
    expect("content" in meta[0]).toBe(false);

    expect(
      dbManager.updateBankCsvUpload(csvId, "DbUser", { content: "modifié" }),
    ).toBe(true);
    expect(dbManager.getBankCsvUploadById(csvId, "DbUser").content).toBe(
      "modifié",
    );
    // Colonne non autorisée
    expect(
      dbManager.updateBankCsvUpload(csvId, "DbUser", { user_id: "hack" }),
    ).toBe(false);

    expect(dbManager.deleteBankCsvUpload(csvId, "DbUser")).toBe(true);
    expect(dbManager.deleteBankCsvUpload(csvId, "DbUser")).toBe(false);
    expect(dbManager.getAllBankCsvUploadsMeta("DbUser")).toHaveLength(0);
  });
});

describe("tricount (couche SQLite)", () => {
  it("dépenses : upsert + suppression + valeurs par défaut", () => {
    dbManager.saveTricountExpense(
      { id: "e-1", month: "2026-10", date: "2026-10-01", label: "Courses", amount: 10 },
      "DbUser",
    );
    expect(dbManager.getAllTricountExpenses("DbUser")).toHaveLength(1);

    dbManager.saveTricountExpense(
      { id: "e-1", month: "2026-10", date: "2026-10-01", label: "Courses", amount: 20 },
      "DbUser",
    );
    const list = dbManager.getAllTricountExpenses("DbUser");
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe(20);
    expect(list[0].payerPersonId).toBe("person1");

    expect(dbManager.deleteTricountExpense("e-1", "DbUser")).toBe(true);
    expect(dbManager.deleteTricountExpense("e-1", "DbUser")).toBe(false);
  });

  it("revenus + configs mensuelles", () => {
    dbManager.saveTricountIncome(
      { id: "i-1", month: "2026-10", date: "2026-10-01", label: "Salaire", amount: 1000 },
      "DbUser",
    );
    expect(dbManager.getAllTricountIncomes("DbUser")).toHaveLength(1);

    dbManager.saveTricountConfig(
      { month: "2026-10", p1Income: 100, p2Income: 50 },
      "DbUser",
    );
    const configs = dbManager.getAllTricountConfigs("DbUser");
    expect(configs["2026-10"].p1Income).toBe(100);
    expect(configs["2026-10"].p2Income).toBe(50);
  });
});

describe("épargne et paramètres (couche SQLite)", () => {
  it("stratégie globale et mensuelle (aller-retour JSON)", () => {
    expect(dbManager.getSavingsStrategy("DbUser")).toBeNull();

    expect(
      dbManager.saveSavingsStrategy("DbUser", { totalMonthlyIncome: 4000 }),
    ).toBe(true);
    expect(dbManager.getSavingsStrategy("DbUser")).toEqual({
      totalMonthlyIncome: 4000,
    });

    expect(
      dbManager.saveSavingsStrategyForMonth("DbUser", "2026-10", { m: 1 }),
    ).toBe(true);
    expect(dbManager.getSavingsStrategyForMonth("DbUser", "2026-10")).toEqual({
      m: 1,
    });
    expect(dbManager.getAllSavingsMonthlyStrategies("DbUser")["2026-10"]).toEqual({
      m: 1,
    });

    expect(
      dbManager.saveAllSavingsMonthlyStrategies("DbUser", { "2026-11": { m: 2 } }),
    ).toBe(true);
    expect(dbManager.getAllSavingsMonthlyStrategies("DbUser")["2026-11"]).toEqual({
      m: 2,
    });
  });

  it("paramètres utilisateur", () => {
    expect(dbManager.getUserSettings("DbUser")).toBeNull();
    dbManager.saveUserSettings("DbUser", { currency: "EUR" });
    expect(dbManager.getUserSettings("DbUser")).toEqual({ currency: "EUR" });
  });

  it("statistiques finales cohérentes", () => {
    const stats = dbManager.getDatabaseStats();
    expect(stats.wallets).toBe(0);
    expect(stats.tricountExpenses).toBe(0);
    expect(stats.tricountIncomes).toBe(1);
  });
});

describe("partage multi-compte au sein du foyer (Romain & Sophie)", () => {
  it("les dépenses, revenus, configs et stratégies créés par un partenaire sont partagés avec l'autre", () => {
    // Romain enregistre une dépense commune
    dbManager.saveTricountExpense(
      { id: "e-shared-1", month: "2026-10", date: "2026-10-05", label: "Courses Leclerc", amount: 85 },
      "Romain",
    );
    // Sophie consulte les dépenses et la retrouve
    const sophieExpenses = dbManager.getAllTricountExpenses("Sophie");
    expect(sophieExpenses.some((e) => e.id === "e-shared-1")).toBe(true);
    expect(sophieExpenses.find((e) => e.id === "e-shared-1")?.amount).toBe(85);

    // Sophie enregistre un revenu commun
    dbManager.saveTricountIncome(
      { id: "i-shared-1", month: "2026-10", date: "2026-10-01", label: "Salaire Sophie", amount: 2100 },
      "Sophie",
    );
    // Romain consulte les revenus et le retrouve
    const romainIncomes = dbManager.getAllTricountIncomes("Romain");
    expect(romainIncomes.some((i) => i.id === "i-shared-1")).toBe(true);

    // Sophie modifie une config mensuelle
    dbManager.saveTricountConfig({ month: "2026-10", p1Income: 2000, p2Income: 2100 }, "Sophie");
    const romainConfigs = dbManager.getAllTricountConfigs("Romain");
    expect(romainConfigs["2026-10"].p2Income).toBe(2100);

    // Romain enregistre une stratégie d'épargne
    dbManager.saveSavingsStrategy("Romain", {
      household: { enabled: true, person1: { name: "Romain" }, person2: { name: "Sophie" } },
    });
    const sophieStrat = dbManager.getSavingsStrategy("Sophie");
    expect(sophieStrat?.household?.enabled).toBe(true);

    // Nettoyage
    expect(dbManager.deleteTricountExpense("e-shared-1", "Sophie")).toBe(true);
    expect(dbManager.deleteTricountIncome("i-shared-1", "Romain")).toBe(true);
  });
});

