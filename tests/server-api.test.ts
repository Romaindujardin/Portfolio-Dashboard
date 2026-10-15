// Tests d'intégration de l'API serveur : chaque route est exercée contre un
// serveur isolé (port + base SQLite temporaires), y compris les régressions
// de sécurité (traversée de chemin, CORS) et les vestiges supprimés (404).
import "./shims";
import { describe, it, expect } from "vitest";
import { api, apiJson, postJson, putJson } from "./helpers";
import { TEST_SERVER } from "./shims";

const USER = "TestApiUser";
const TRAVERSAL = "../../package";

const buildWalletPayload = () => ({
  user_id: USER,
  name: "Wallet Audit",
  address: "0xauditwallet01",
  wallet_type: "metamask",
  blockchains: JSON.stringify(["ethereum"]),
  total_value: 1234.56,
  last_updated: new Date().toISOString(),
  assets: [
    {
      symbol: "ETH",
      name: "Ethereum",
      balance: 1.5,
      decimals: 18,
      blockchain: "ethereum",
      price: 2000,
      value: 3000,
    },
  ],
  nfts: [
    {
      token_id: "42",
      name: "NFT Audit",
      collection: "Collection Audit",
      symbol: "NAUDIT",
      blockchain: "ethereum",
      contract_address: "0xcontractaudit",
      price: 1,
      value: 2,
    },
  ],
});

describe("santé du serveur", () => {
  it("GET /api/test répond (et n'est plus un proxy Yahoo)", async () => {
    const { status, body } = await apiJson<{ message: string; database: string }>(
      "/test",
    );
    expect(status).toBe(200);
    expect(body.message).toContain("Portfolio Dashboard");
    expect(body.message.toLowerCase()).not.toContain("yahoo");
    expect(body.database).toBe("SQLite initialized");
  });
});

describe("sécurité", () => {
  it("bloque les user_id suspects (traversée de chemin)", async () => {
    const endpoints = [
      `/database/wallets?user_id=${encodeURIComponent(TRAVERSAL)}`,
      `/database/tricount/data?user_id=${encodeURIComponent(TRAVERSAL)}`,
      `/database/savings/strategy?user_id=${encodeURIComponent(TRAVERSAL)}`,
      `/database/user-settings?user_id=${encodeURIComponent(TRAVERSAL)}`,
      `/database/bank-csv?user_id=${encodeURIComponent(TRAVERSAL)}`,
    ];
    for (const url of endpoints) {
      const { status, body } = await apiJson<{ error: string }>(url);
      expect(status, url).toBe(400);
      expect(body.error).toBe("user_id invalide");
    }
  });

  it("user_id vide → profil par défaut, sans erreur", async () => {
    const { status, body } = await apiJson<unknown[]>("/database/wallets?user_id=");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("CORS : origine locale autorisée, origine externe refusée", async () => {
    const allowed = await fetch(`${TEST_SERVER.baseUrl}/api/test`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );

    const denied = await fetch(`${TEST_SERVER.baseUrl}/api/test`, {
      headers: { Origin: "http://evil.example.com" },
    });
    expect(denied.status).toBe(200); // la requête aboutit mais sans entête CORS
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("préflight OPTIONS autorisé pour une origine locale", async () => {
    const res = await fetch(`${TEST_SERVER.baseUrl}/api/database/stats`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
  });
});

describe("wallets (CRUD complet + visibilités)", () => {
  let walletId = "";

  it("crée un wallet avec assets et NFTs", async () => {
    const res = await postJson("/database/wallets", buildWalletPayload());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    walletId = body.id;
  });

  it("liste le wallet avec ses assets et NFTs", async () => {
    const { status, body } = await apiJson<any[]>(
      `/database/wallets?user_id=${USER}`,
    );
    expect(status).toBe(200);
    const wallet = body.find((w) => w.id === walletId);
    expect(wallet).toBeTruthy();
    expect(wallet.name).toBe("Wallet Audit");
    expect(wallet.assets).toHaveLength(1);
    expect(wallet.assets[0].symbol).toBe("ETH");
    expect(wallet.assets[0].balance).toBe(1.5);
    expect(wallet.nfts).toHaveLength(1);
    expect(wallet.nfts[0].token_id).toBe("42");
    expect(String(wallet.blockchains)).toContain("ethereum");
  });

  it("met à jour le wallet et remplace assets/NFTs", async () => {
    const res = await putJson(`/database/wallets/${walletId}`, {
      name: "Wallet Renommé",
      total_value: 777.77,
      assets: [
        {
          symbol: "BTC",
          name: "Bitcoin",
          balance: 0.01,
          decimals: 8,
          blockchain: "bitcoin",
          price: 60000,
          value: 600,
        },
      ],
      nfts: [],
    });
    expect(res.status).toBe(200);

    const { body } = await apiJson<any[]>(`/database/wallets?user_id=${USER}`);
    const wallet = body.find((w) => w.id === walletId);
    expect(wallet.name).toBe("Wallet Renommé");
    expect(wallet.total_value).toBeCloseTo(777.77, 2);
    expect(wallet.assets).toHaveLength(1);
    expect(wallet.assets[0].symbol).toBe("BTC");
    expect(wallet.nfts).toHaveLength(0);
  });

  it("met à jour la visibilité d'un asset (404 sur index invalide)", async () => {
    const ok = await putJson(`/database/wallets/${walletId}/assets/0/visibility`, {
      isHidden: true,
    });
    expect(ok.status).toBe(200);

    const { body } = await apiJson<any[]>(`/database/wallets?user_id=${USER}`);
    const wallet = body.find((w) => w.id === walletId);
    expect(Boolean(wallet.assets[0].is_hidden)).toBe(true);

    const ko = await putJson(
      `/database/wallets/${walletId}/assets/99/visibility`,
      { isHidden: true },
    );
    expect(ko.status).toBe(404);
  });

  it("gère la visibilité des NFTs (404 sur index invalide)", async () => {
    // Remettre un NFT, puis le masquer.
    await putJson(`/database/wallets/${walletId}`, {
      nfts: [
        {
          token_id: "9",
          name: "NFT 2",
          collection: "Collection 2",
          symbol: "N2",
          blockchain: "ethereum",
        },
      ],
    });

    const ok = await putJson(`/database/wallets/${walletId}/nfts/0/visibility`, {
      isHidden: true,
    });
    expect(ok.status).toBe(200);

    const { body } = await apiJson<any[]>(`/database/wallets?user_id=${USER}`);
    const wallet = body.find((w) => w.id === walletId);
    expect(Boolean(wallet.nfts[0].is_hidden)).toBe(true);

    const ko = await putJson(`/database/wallets/${walletId}/nfts/12/visibility`, {
      isHidden: true,
    });
    expect(ko.status).toBe(404);
  });

  it("404 si le wallet n'existe pas (PUT)", async () => {
    const res = await putJson("/database/wallets/inconnu-xyz", { name: "X" });
    expect(res.status).toBe(404);
  });

  it("supprime le wallet", async () => {
    const res = await api(`/database/wallets/${walletId}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const { body } = await apiJson<any[]>(`/database/wallets?user_id=${USER}`);
    expect(body.find((w) => w.id === walletId)).toBeUndefined();
    walletId = "";
  });
});

describe("imports CSV bancaires", () => {
  let csvId = "";

  it("crée un import CSV", async () => {
    const res = await postJson("/database/bank-csv", {
      user_id: USER,
      filename: "releve-oct.csv",
      content: "Date;Montant\n2026-10-01;-42,50",
      size_bytes: 42,
      section: "bank",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    csvId = body.id;
  });

  it("la liste ne contient pas le contenu complet", async () => {
    const { body } = await apiJson<any[]>(`/database/bank-csv?user_id=${USER}`);
    const item = body.find((u) => u.id === csvId);
    expect(item).toBeTruthy();
    expect(item.filename).toBe("releve-oct.csv");
    expect("content" in item).toBe(false);
    expect(item.size_bytes).toBe(42);
  });

  it("renvoie le contenu complet par identifiant", async () => {
    const { status, body } = await apiJson<any>(
      `/database/bank-csv/${csvId}?user_id=${USER}`,
    );
    expect(status).toBe(200);
    expect(body.content).toContain("-42,50");
  });

  it("met à jour le contenu", async () => {
    const res = await putJson(`/database/bank-csv/${csvId}?user_id=${USER}`, {
      content: "NOUVEAU CONTENU",
    });
    expect(res.status).toBe(200);
    const { body } = await apiJson<any>(
      `/database/bank-csv/${csvId}?user_id=${USER}`,
    );
    expect(body.content).toBe("NOUVEAU CONTENU");
  });

  it("supprime l'import (puis 404)", async () => {
    const res = await api(`/database/bank-csv/${csvId}?user_id=${USER}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const { status } = await apiJson(`/database/bank-csv/${csvId}?user_id=${USER}`);
    expect(status).toBe(404);
  });
});

describe("tricount (budget familial)", () => {
  const EXP_ID = "api-tricount-exp-1";
  const INC_ID = "api-tricount-inc-1";

  it("sauvegarde une dépense, un revenu et une config", async () => {
    const exp = await postJson("/database/tricount/expenses", {
      userId: USER,
      expense: {
        id: EXP_ID,
        month: "2026-10",
        date: "2026-10-03",
        label: "Courses audit",
        amount: 42.5,
        payerPersonId: "person1",
        pocketId: "poc-2",
        pocketName: "Alimentation",
        splitMethod: "50_50",
        nature: "expense",
        source: "manual",
      },
    });
    expect(exp.status).toBe(200);
    expect((await exp.json()).id).toBe(EXP_ID);

    const inc = await postJson("/database/tricount/incomes", {
      userId: USER,
      income: {
        id: INC_ID,
        month: "2026-10",
        date: "2026-10-01",
        label: "Salaire audit",
        amount: 2000,
        beneficiaryPersonId: "person1",
      },
    });
    expect(inc.status).toBe(200);

    const cfg = await postJson("/database/tricount/configs", {
      userId: USER,
      config: {
        month: "2026-10",
        p1Income: 2000,
        p2Income: 1000,
        isStrategyApplied: false,
      },
    });
    expect(cfg.status).toBe(200);
  });

  it("relit l'ensemble via /tricount/data", async () => {
    const { status, body } = await apiJson<any>(
      `/database/tricount/data?user_id=${USER}`,
    );
    expect(status).toBe(200);
    const expense = body.expenses.find((e: any) => e.id === EXP_ID);
    expect(expense).toBeTruthy();
    expect(expense.amount).toBeCloseTo(42.5, 2);
    expect(expense.label).toBe("Courses audit");
    expect(body.incomes.some((i: any) => i.id === INC_ID)).toBe(true);
    expect(body.configs["2026-10"].p1Income).toBe(2000);
  });

  it("synchronise un lot complet", async () => {
    const res = await postJson("/database/tricount/sync", {
      userId: USER,
      expenses: [
        {
          id: "api-sync-exp-1",
          month: "2026-11",
          date: "2026-11-02",
          label: "Sync A",
          amount: 10.5,
        },
        {
          id: "api-sync-exp-2",
          month: "2026-11",
          date: "2026-11-03",
          label: "Sync B",
          amount: 20,
        },
      ],
      incomes: [
        {
          id: "api-sync-inc-1",
          month: "2026-11",
          date: "2026-11-01",
          label: "Sync revenu",
          amount: 500,
        },
      ],
      configs: { "2026-11": { month: "2026-11", p1Income: 10, p2Income: 5 } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.saved.expenses).toBe(2);
    expect(body.saved.incomes).toBe(1);
    expect(body.saved.configs).toBe(1);
  });

  it("supprime une dépense et un revenu", async () => {
    const delExp = await api(
      `/database/tricount/expenses/${EXP_ID}?user_id=${USER}`,
      { method: "DELETE" },
    );
    expect(delExp.status).toBe(200);
    const delInc = await api(
      `/database/tricount/incomes/${INC_ID}?user_id=${USER}`,
      { method: "DELETE" },
    );
    expect(delInc.status).toBe(200);

    const { body } = await apiJson<any>(
      `/database/tricount/data?user_id=${USER}`,
    );
    expect(body.expenses.some((e: any) => e.id === EXP_ID)).toBe(false);
    expect(body.incomes.some((i: any) => i.id === INC_ID)).toBe(false);
  });
});

describe("épargne (stratégie globale + mensuelle)", () => {
  it("stratégie vide au départ, puis sauvegarde/relit", async () => {
    const initial = await apiJson<{ strategy: any }>(
      `/database/savings/strategy?user_id=${USER}`,
    );
    expect(initial.status).toBe(200);
    expect(initial.body.strategy).toBeNull();

    const strategy = {
      totalMonthlyIncome: 4000,
      incomes: [{ id: "i1", amount: 4000 }],
      pockets: [],
    };
    const save = await postJson("/database/savings/strategy", {
      userId: USER,
      strategy,
    });
    expect(save.status).toBe(200);

    const after = await apiJson<{ strategy: any }>(
      `/database/savings/strategy?user_id=${USER}`,
    );
    expect(after.body.strategy.totalMonthlyIncome).toBe(4000);
    expect(after.body.strategy.incomes[0].amount).toBe(4000);
  });

  it("stratégies mensuelles : unitaire puis batch", async () => {
    const one = await postJson("/database/savings/monthly", {
      userId: USER,
      month: "2026-10",
      strategy: { tag: "octobre" },
    });
    expect(one.status).toBe(200);

    const batch = await postJson("/database/savings/monthly/batch", {
      userId: USER,
      strategies: {
        "2026-10": { tag: "octobre" },
        "2026-11": { tag: "novembre" },
      },
    });
    expect(batch.status).toBe(200);

    const { body } = await apiJson<{ strategies: Record<string, any> }>(
      `/database/savings/monthly?user_id=${USER}`,
    );
    expect(body.strategies["2026-10"].tag).toBe("octobre");
    expect(body.strategies["2026-11"].tag).toBe("novembre");
  });

  it("valide les entrées invalides (400)", async () => {
    expect(
      (await postJson("/database/savings/strategy", { userId: USER })).status,
    ).toBe(400);
    expect(
      (
        await postJson("/database/savings/monthly", {
          userId: USER,
          strategy: { a: 1 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postJson("/database/savings/strategy", {
          userId: TRAVERSAL,
          strategy: { a: 1 },
        })
      ).status,
    ).toBe(400);
  });
});

describe("paramètres utilisateur", () => {
  it("vides au départ, puis sauvegarde/relit", async () => {
    const initial = await apiJson<{ settings: any }>(
      `/database/user-settings?user_id=${USER}`,
    );
    expect(initial.status).toBe(200);
    expect(initial.body.settings).toBeNull();

    const save = await postJson("/database/user-settings", {
      userId: USER,
      settings: { currency: "USD", theme: "dark" },
    });
    expect(save.status).toBe(200);

    const after = await apiJson<{ settings: any }>(
      `/database/user-settings?user_id=${USER}`,
    );
    expect(after.body.settings.currency).toBe("USD");
    expect(after.body.settings.theme).toBe("dark");
  });

  it("400 sans settings", async () => {
    expect(
      (await postJson("/database/user-settings", { userId: USER })).status,
    ).toBe(400);
  });
});

describe("routes vestiges supprimées → 404", () => {
  const removedRoutes: Array<[string, string]> = [
    ["GET", "/price"],
    ["GET", "/investments"],
    ["GET", "/watchlist"],
    ["POST", "/database/init"],
    ["POST", "/database/clear"],
    ["GET", "/database/export"],
    ["POST", "/database/import"],
    ["POST", "/database/migrate"],
    ["PUT", "/database/wallets"],
    ["POST", "/database/wallets/test-create-with-nfts"],
    ["POST", "/database/wallets/abc/sync-nfts"],
  ];

  it("toutes les routes supprimées répondent 404", async () => {
    for (const [method, path] of removedRoutes) {
      const res = await api(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe("validations des services externes (sans appel réseau)", () => {
  it("Binance : 400 sans clés API", async () => {
    const { status, body } = await apiJson<{ error: string }>("/binance/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("Missing");
  });

  it("OpenSea : 400 sans clé API (3 routes)", async () => {
    const paths = [
      "/opensea/nfts/0xabc",
      "/opensea/nft/0xabc/1",
      "/opensea/collection/azuki/floor",
    ];
    for (const path of paths) {
      const { status, body } = await apiJson<{ error: string }>(path);
      expect(status, path).toBe(400);
      expect(body.error).toContain("OpenSea");
    }
  });

  it("Bourso : 400 sans identifiants", async () => {
    const accounts = await postJson("/bourso/accounts", {});
    expect(accounts.status).toBe(400);
    const sync = await postJson("/bourso/sync", {});
    expect(sync.status).toBe(400);
  });
});

describe("statistiques et isolation de la base de test", () => {
  it("expose des stats et utilise bien la base temporaire", async () => {
    const { status, body } = await apiJson<any>("/database/stats");
    expect(status).toBe(200);
    expect(typeof body.wallets).toBe("number");
    expect(typeof body.assets).toBe("number");
    expect(typeof body.bankCsvUploads).toBe("number");
    expect(typeof body.lastUpdated).toBe("string");
    expect(body.databasePath).toContain("portfolio-test.db");
  });
});
