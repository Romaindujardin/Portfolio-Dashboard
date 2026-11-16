// Tests de non-régression des correctifs P0 de l'audit :
// - E-1 : configuration Enable Banking réservée à l'administrateur ;
// - E-2 : synchronisation crypto fail-closed et écriture atomique ;
// - E-3 : transfert des comptes partagés, tables optionnelles, rétention ;
// - E-4 : conversion FX synchrone dans getOverview + préchargement ;
// - M-1 : CSP Report-Only, Permissions-Policy, COOP/CORP, collecte ;
// - M-2 : corps d'authentification borné, limite IP globale, no-store ;
// - L-1 : journalisation structurée des erreurs de synchronisation.
import "./shims";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import {
  CryptoFetchError,
  fetchBinanceHoldings,
  syncCryptoAccount,
} from "../server/services/cryptoService.js";
import { deleteUserData } from "../server/services/userDataService.js";
import {
  MarketDataService,
  getFxRateToEur,
} from "../server/services/marketData.js";
import { pruneBackups } from "../scripts/backup-retention.js";
import { createPortfolioRouter } from "../server/routes/portfolio.js";
import {
  buildContentSecurityPolicy,
  resolveCspMode,
} from "../server/lib/securityHeaders.js";
import { api, apiAs, apiWithoutSession } from "./helpers";
import { ensureTestSession } from "./shims";

const createMemoryDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializePortfolioSchema(db);
  // Tables historiques créées par DatabaseManager mais absentes du schéma
  // patrimoine. On recrée le minimum nécessaire à deleteUserData.
  db.exec(`
    CREATE TABLE wallets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE wallet_assets (id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL);
    CREATE TABLE wallet_nfts (id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL);
    CREATE TABLE bank_csv_uploads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE tricount_expenses (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE tricount_incomes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE tricount_configs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE savings_strategies (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE savings_monthly_strategies (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE user_settings (user_id TEXT PRIMARY KEY);
  `);
  return db;
};

const listen = (server: Server) =>
  new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

const close = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

describe("E-2 — synchronisation crypto fail-closed", () => {
  it("annule la synchronisation EVM en échec sans modifier les positions", async () => {
    const db = createMemoryDb();
    const repository = new PortfolioRepository(db);
    const user = "CryptoFail";
    try {
      const account = repository.createAccount(user, {
        provider: "evm",
        name: "Wallet EVM",
        type: "CRYPTO",
        currency: "EUR",
        balance: 6000,
        metadata: { address: `0x${"1".repeat(40)}` },
      });
      repository.upsertHolding(user, account.id, {
        ticker: "ETH",
        name: "Ethereum",
        quantity: 2,
        price: 3000,
        currency: "EUR",
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error("réseau indisponible");
      }) as typeof fetch;
      try {
        await expect(
          syncCryptoAccount(repository, account.id, user),
        ).rejects.toMatchObject({ code: "CRYPTO_EVM_PARTIAL" });
      } finally {
        globalThis.fetch = originalFetch;
      }

      // Les positions et le solde précédents sont intacts.
      expect(repository.listHoldings(account.id, user)).toHaveLength(1);
      expect(repository.getAccount(account.id, user)?.balance).toBe(6000);
      expect(repository.listSnapshots(account.id, user)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("accepte un portefeuille vide légitime et remplace les positions", async () => {
    const db = createMemoryDb();
    const repository = new PortfolioRepository(db);
    const user = "CryptoEmpty";
    try {
      const account = repository.createAccount(user, {
        provider: "evm",
        name: "Wallet vide",
        type: "CRYPTO",
        currency: "EUR",
        balance: 6000,
        metadata: { address: `0x${"2".repeat(40)}` },
      });
      repository.upsertHolding(user, account.id, {
        ticker: "ETH",
        name: "Ethereum",
        quantity: 2,
        price: 3000,
        currency: "EUR",
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input, init) => {
        // Répond à chaque appel JSON-RPC par un solde nul : la liste doit
        // couvrir tous les ids demandés pour être considérée valide.
        const calls = JSON.parse(String(init?.body || "[]"));
        const results = calls.map((call) => ({
          jsonrpc: "2.0",
          id: call.id,
          result: "0x0",
        }));
        return new Response(JSON.stringify(results), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
      try {
        const result = await syncCryptoAccount(repository, account.id, user);
        expect(result.holdings).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(repository.listHoldings(account.id, user)).toHaveLength(0);
      expect(repository.getAccount(account.id, user)?.balance).toBe(0);
      const snapshots = repository.listSnapshots(account.id, user);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].balance).toBe(0);
    } finally {
      db.close();
    }
  });

  it("expose une erreur typée pour une réponse Binance invalide", async () => {
    expect(new CryptoFetchError("échec", { code: "X" })).toMatchObject({
      name: "CryptoFetchError",
      status: 502,
      code: "X",
    });
  });

  it("enveloppe les erreurs réseau Binance dans CryptoFetchError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("réseau coupé");
    }) as typeof fetch;
    try {
      await expect(
        fetchBinanceHoldings({ apiKey: "key", apiSecret: "secret" }),
      ).rejects.toMatchObject({
        name: "CryptoFetchError",
        code: "CRYPTO_BINANCE_NETWORK",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retire le compte créé si la première synchronisation échoue", async () => {
    const db = createMemoryDb();
    const app = express();
    app.use(express.json());
    app.use(
      "/api/portfolio",
      createPortfolioRouter({ db }),
    );
    const server = createServer(app);
    await listen(server);
    const { port } = server.address() as AddressInfo;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("réseau coupé");
    }) as typeof fetch;
    try {
      const response = await originalFetch(
        `http://127.0.0.1:${port}/api/portfolio/crypto/accounts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: "CryptoCreateFailure",
            name: "Wallet EVM",
            provider: "evm",
            address: `0x${"3".repeat(40)}`,
          }),
        },
      );
      expect(response.status).toBe(502);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe("CRYPTO_EVM_PARTIAL");
      expect(
        new PortfolioRepository(db).listAccounts("CryptoCreateFailure"),
      ).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
      await close(server);
      db.close();
    }
  });
});

describe("E-3 — suppression de profil et rétention", () => {
  it("transfère un compte partagé et réattribue ses données au co-owner", () => {
    const db = createMemoryDb();
    const repository = new PortfolioRepository(db);
    const owner = "DeleteOwner";
    const coowner = "DeleteCoowner";
    try {
      const connector = repository.createConnector(owner, {
        provider: "enable-banking",
        label: "Banque partagée",
        status: "active",
      });
      const account = repository.createAccount(owner, {
        provider: "enable-banking",
        name: "Compte joint",
        type: "CHECKING",
        currency: "EUR",
        balance: 100,
        connectionId: connector.id,
      });
      repository.replaceOwnerships(account.id, owner, [
        { ownerName: owner, sharePercent: 40 },
        { ownerName: coowner, sharePercent: 60 },
      ]);
      repository.insertTransactions(owner, account.id, "enable-banking", [
        {
          dedupKey: "transfer-1",
          date: "2026-01-01",
          amount: 10,
          label: "Virement",
        },
      ]);
      repository.upsertHolding(owner, account.id, {
        ticker: "ETF",
        name: "ETF",
        quantity: 1,
        price: 100,
        currency: "EUR",
      });
      repository.saveSnapshot(owner, account.id, "2026-01-01", 100);

      const result = deleteUserData(db, owner);
      expect(result.counts.accountsTransferred).toBe(1);
      expect(result.backupsNote).toContain("rétention");

      const moved = repository.getAccount(account.id, coowner);
      expect(moved?.userId).toBe(coowner);
      expect(moved?.connectionId).toBeNull();

      for (const table of ["transactions", "holdings", "balance_snapshots"]) {
        const rows = db
          .prepare(`SELECT user_id FROM ${table} WHERE account_id = ?`)
          .all(account.id) as Array<{ user_id: string }>;
        expect(rows.length, `${table} doit conserver ses lignes`).toBe(1);
        expect(rows[0].user_id).toBe(coowner);
      }
      expect(repository.getConnector(connector.id, owner)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("supprime les tables historiques optionnelles quand elles existent", () => {
    const db = createMemoryDb();
    try {
      db.exec(`
        CREATE TABLE investments (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL
        );
        CREATE TABLE watchlist (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT NOT NULL
        );
      `);
      db.prepare(
        "INSERT INTO investments (id, user_id, symbol) VALUES ('i1', 'LegacyUser', 'CW8')",
      ).run();
      db.prepare(
        "INSERT INTO watchlist (id, user_id, symbol) VALUES ('w1', 'LegacyUser', 'AI')",
      ).run();

      const result = deleteUserData(db, "LegacyUser");
      expect(result.counts.investments).toBe(1);
      expect(result.counts.watchlist).toBe(1);
    } finally {
      db.close();
    }
  });

  it("ne échoue pas quand les tables optionnelles sont absentes", () => {
    const db = createMemoryDb();
    try {
      expect(() => deleteUserData(db, "NoLegacyTables")).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("purge immédiatement le profil des sauvegardes accessibles", async () => {
    const db = createMemoryDb();
    const backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "portfolio-backup-scrub-"),
    );
    const backupPath = path.join(backupDir, "portfolio-backup-test.db");
    try {
      const insertAccount = db.prepare(
        `INSERT INTO accounts
           (id, user_id, provider, name, type, currency, balance, created_at, updated_at)
         VALUES (?, ?, 'manual', ?, 'CHECKING', 'EUR', 100, ?, ?)`,
      );
      const now = new Date().toISOString();
      insertAccount.run("acc-delete", "BackupDelete", "Compte supprimé", now, now);
      insertAccount.run("acc-keep", "BackupKeeper", "Compte conservé", now, now);

      await db.backup(backupPath);
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      fs.utimesSync(backupPath, oldDate, oldDate);
      const oldMtime = fs.statSync(backupPath).mtimeMs;

      const result = deleteUserData(db, "BackupDelete", { backupDir });
      expect(result.backups.scrubbed).toEqual(["portfolio-backup-test.db"]);
      expect(result.backupsNote).toContain("rétention");
      // La date d'origine est conservée pour que la rétention s'applique.
      expect(
        Math.abs(fs.statSync(backupPath).mtimeMs - oldMtime),
      ).toBeLessThan(2000);

      const backupDb = new Database(backupPath, { readonly: true });
      try {
        const rows = backupDb
          .prepare("SELECT user_id FROM accounts ORDER BY user_id")
          .all() as Array<{ user_id: string }>;
        expect(rows).toEqual([{ user_id: "BackupKeeper" }]);
      } finally {
        backupDb.close();
      }
    } finally {
      db.close();
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  });

  it("purge les sauvegardes au-delà de la rétention, avec leurs sidecars", () => {
    const backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "portfolio-backup-retention-"),
    );
    const oldFile = path.join(backupDir, "portfolio-backup-old.db");
    const freshFile = path.join(backupDir, "portfolio-backup-fresh.db");
    const otherFile = path.join(backupDir, "notes.txt");
    try {
      fs.writeFileSync(oldFile, "old");
      fs.writeFileSync(`${oldFile}-wal`, "wal");
      fs.writeFileSync(freshFile, "fresh");
      fs.writeFileSync(otherFile, "notes");
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, oldDate, oldDate);

      const result = pruneBackups({ backupDir, retentionDays: 30 });
      expect(result.removed).toEqual(["portfolio-backup-old.db"]);
      expect(result.kept).toEqual(["portfolio-backup-fresh.db"]);
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(`${oldFile}-wal`)).toBe(false);
      expect(fs.existsSync(freshFile)).toBe(true);
      expect(fs.existsSync(otherFile)).toBe(true);

      const dryRun = pruneBackups({
        backupDir,
        retentionDays: 0,
        dryRun: true,
        now: Date.now() + 60_000,
      });
      expect(dryRun.removed).toEqual(["portfolio-backup-fresh.db"]);
      expect(fs.existsSync(freshFile)).toBe(true);
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  });
});

describe("E-1 — administration de la configuration Enable Banking", () => {
  it("réserve la modification et la suppression à un administrateur", async () => {
    const user = `P0NonAdmin_${Date.now()}`;
    await ensureTestSession(user);

    const status = await apiAs(user, "/portfolio/connections/status");
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as {
      status: { canManage?: boolean };
    };
    expect(statusBody.status.canManage).toBe(false);

    const update = await apiAs(user, "/portfolio/connections/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicationId: "not-allowed",
        privateKey: "not-allowed",
        redirectUri: "https://example.test/callback",
      }),
    });
    expect(update.status).toBe(403);

    const remove = await apiAs(user, "/portfolio/connections/settings", {
      method: "DELETE",
    });
    expect(remove.status).toBe(403);
  });

  it("autorise le profil administrateur configuré", async () => {
    const status = await apiAs("Romain", "/portfolio/connections/status");
    expect(status.status).toBe(200);
    const body = (await status.json()) as { status: { canManage?: boolean } };
    expect(body.status.canManage).toBe(true);
  });
});

describe("M-2 — durcissement des routes d'authentification", () => {
  it("rejette un corps supérieur à 64 Ko sur /auth/verify", async () => {
    const payload = JSON.stringify({
      username: "HugeAuthBody",
      password: "x".repeat(70 * 1024),
    });
    const response = await apiWithoutSession("/portfolio/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(response.status).toBe(413);
  });

  it("minimise /auth/status et interdit sa mise en cache", async () => {
    const user = `P0Status_${Date.now()}`;
    const response = await apiWithoutSession(
      `/portfolio/auth/status?username=${encodeURIComponent(user)}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("username");
    expect(body.hasPassword).toBe(false);
    expect(body.setup).toBeTruthy();
  });

  it("applique une limite globale par IP aux tentatives d'authentification", async () => {
    const db = createMemoryDb();
    const app = express();
    app.use(express.json());
    app.use(
      "/api/portfolio",
      createPortfolioRouter({
        db,
        authRateLimits: {
          authWindowMs: 60_000,
          authMax: 100,
          authIpWindowMs: 60_000,
          authIpMax: 2,
        },
      }),
    );
    const server = createServer(app);
    await listen(server);
    const { port } = server.address() as AddressInfo;
    const verify = () =>
      fetch(`http://127.0.0.1:${port}/api/portfolio/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "UnknownUser",
          password: "WrongPassword123!",
        }),
      });
    try {
      expect((await verify()).status).toBe(401);
      expect((await verify()).status).toBe(401);
      const limited = await verify();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
    } finally {
      await close(server);
      db.close();
    }
  });
});

describe("E-4 — conversion FX de la vue d'ensemble", () => {
  it("convertit comptes et positions avec la map préchargée", () => {
    const db = createMemoryDb();
    const repository = new PortfolioRepository(db);
    const user = "FxOverview";
    try {
      repository.createAccount(user, {
        provider: "manual",
        name: "Compte USD",
        type: "CHECKING",
        currency: "USD",
        balance: 100,
      });
      repository.createAccount(user, {
        provider: "manual",
        name: "Épargne CHF",
        type: "SAVINGS",
        currency: "CHF",
        balance: 50,
      });
      const investment = repository.createAccount(user, {
        provider: "manual",
        name: "Titres USD",
        type: "SECURITIES",
        currency: "USD",
        balance: 0,
        cashBalance: 10,
      });
      repository.upsertHolding(user, investment.id, {
        ticker: "AAPL",
        name: "Apple",
        quantity: 2,
        price: 100,
        currency: "USD",
      });

      const overview = repository.getOverview(user, {
        fxRates: { USD: 0.5 },
      });
      // 100 USD × 0,5 + 50 CHF (1:1, taux absent) + (10 × 0,5 + 2 × 100 × 0,5).
      expect(overview.totals.assets).toBe(205);
      expect(overview.totals.netWorth).toBe(205);
      expect(overview.byType.SECURITIES).toBe(105);
      expect(overview.fx).toEqual({
        base: "EUR",
        rates: { EUR: 1, USD: 0.5 },
        missing: ["CHF"],
      });
    } finally {
      db.close();
    }
  });

  it("précharge les taux en parallèle et ignore les devises indisponibles", async () => {
    const market = new MarketDataService();
    market.getFxRateToEur = async (currency: string) => {
      if (currency === "USD") return 0.5;
      throw new Error("taux indisponible");
    };
    const rates = await market.preloadFxRates(["usd", "CHF", "EUR"]);
    expect(rates).toEqual({ EUR: 1, USD: 0.5 });
  });

  it("met en cache négatif une devise indisponible pour éviter les appels répétés", async () => {
    const currency = `Z${Date.now()}`;
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("réseau coupé");
    }) as typeof fetch;
    try {
      await expect(getFxRateToEur(currency)).rejects.toMatchObject({
        code: "FX_UNAVAILABLE",
      });
      await expect(getFxRateToEur(currency)).rejects.toMatchObject({
        code: "FX_UNAVAILABLE",
      });
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("M-1 — en-têtes de sécurité et CSP", () => {
  it("sert une CSP Report-Only et les en-têtes associés", async () => {
    const response = await api("/health");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy-report-only");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(`report-uri /api/csp-report`);
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("collecte les rapports CSP sans session", async () => {
    const response = await apiWithoutSession("/csp-report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": {
          "document-uri": "https://example.test/",
          "violated-directive": "img-src",
        },
      }),
    });
    expect(response.status).toBe(204);
  });

  it("permet de basculer la CSP en mode bloquant", () => {
    expect(resolveCspMode({ CSP_MODE: "enforce" })).toBe("enforce");
    expect(resolveCspMode({ CSP_MODE: "report-only" })).toBe("report-only");
    expect(resolveCspMode({})).toBe("report-only");
    expect(buildContentSecurityPolicy()).toContain("object-src 'none'");
  });
});

describe("L-1 — journalisation des erreurs de synchronisation", () => {
  it("sérialise la liste structurée transmise via errors", () => {
    const db = createMemoryDb();
    const repository = new PortfolioRepository(db);
    const user = "SyncErrors";
    try {
      const runId = repository.startSyncRun(user, null, "enable-banking");
      repository.finishSyncRun(runId, {
        status: "partial",
        accountsSynced: 1,
        transactionsImported: 2,
        errors: [
          { account: "Compte A", error: "boom" },
          { account: "Compte B", error: "bam" },
        ],
      });
      const [run] = repository.listSyncRuns(user);
      expect(run.status).toBe("partial");
      expect(run.accounts_synced).toBe(1);
      expect(run.transactions_imported).toBe(2);
      expect(JSON.parse(run.error)).toEqual(["boom", "bam"]);
    } finally {
      db.close();
    }
  });

  it("conserve la compatibilité avec un message unique", () => {
    const db = createMemoryDb();
    const repository = new PortfolioRepository(db);
    const user = "SyncErrorSingle";
    try {
      const runId = repository.startSyncRun(user, null, "enable-banking");
      repository.finishSyncRun(runId, {
        status: "error",
        error: "connexion refusée",
      });
      const [run] = repository.listSyncRuns(user);
      expect(run.error).toBe("connexion refusée");
    } finally {
      db.close();
    }
  });
});
