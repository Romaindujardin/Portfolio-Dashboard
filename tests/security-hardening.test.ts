// Tests de non-régression des correctifs de sécurité :
// - session serveur obligatoire sur /api (hors routes publiques) ;
// - cloisonnement strict entre profils (IDOR) ;
// - secrets chiffrés au repos et jamais renvoyés en clair ;
// - suppression complète d'un profil et invalidation de sa session ;
// - mot de passe minimum de 8 caractères ;
// - le client Gemini ne transporte plus jamais de clé API.
import "./shims";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  apiAs,
  apiJson,
  apiWithoutSession,
  postJson,
} from "./helpers";
import { TEST_SERVER, ensureTestSession } from "./shims";
import { getAdvisorApiUrl } from "../src/utils/geminiAI";
import { getUserSettings, saveUserSettings } from "../src/utils/userSettings";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import { publicSyncResult } from "../server/routes/portfolio.js";
import { encryptJson } from "../server/lib/secrets.js";
import {
  getUserSecret,
  migrateLegacyBinanceCredentials,
} from "../server/services/userSecretsService.js";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userA = `SecA_${suffix}`;
const userB = `SecB_${suffix}`;
const userSecrets = `SecVault_${suffix}`;
const userLegacy = `SecLegacy_${suffix}`;
const userDelete = `SecDelete_${suffix}`;
const userLocal = `SecLocal_${suffix}`;

const jsonInit = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const setupHeaders = { "X-Setup-Token": TEST_SERVER.setupToken };
const setupInit = (payload: unknown): RequestInit => ({
  ...jsonInit("POST", payload),
  headers: { "Content-Type": "application/json", ...setupHeaders },
});

const openTestDb = () =>
  new Database(TEST_SERVER.dbPath, { readonly: true, fileMustExist: true });

describe("sessions serveur", () => {
  it("refuse les routes /api protégées sans cookie de session", async () => {
    const wallets = await apiWithoutSession(
      `/database/wallets?user_id=${userA}`,
    );
    expect(wallets.status).toBe(401);
    const payload = await wallets.json();
    expect(payload.code).toBe("AUTH_REQUIRED");

    const overview = await apiWithoutSession("/portfolio/overview");
    expect(overview.status).toBe(401);

    const changePassword = await apiWithoutSession(
      "/portfolio/auth/change-password",
      jsonInit("POST", {
        username: userA,
        currentPassword: "not-the-password",
        newPassword: "not-the-new-password",
      }),
    );
    expect(changePassword.status).toBe(401);

    const health = await apiWithoutSession("/health");
    expect(health.status).toBe(200);
  });

  it("refuse la création d'un profil sans code d'initialisation", async () => {
    const user = `SecSetup_${suffix}`;
    const payload = { username: user, password: "SetupPassword123!" };

    const missing = await apiWithoutSession(
      "/portfolio/auth/setup",
      jsonInit("POST", payload),
    );
    expect(missing.status).toBe(403);
    expect((await missing.json()).code).toBe("SETUP_TOKEN_REQUIRED");

    const wrong = await apiWithoutSession("/portfolio/auth/setup", {
      ...jsonInit("POST", payload),
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": "mauvais-jeton-d-initialisation",
      },
    });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).code).toBe("SETUP_TOKEN_INVALID");

    const status = await apiWithoutSession(
      `/portfolio/auth/status?username=${encodeURIComponent(user)}`,
    );
    const statusBody = await status.json();
    expect(statusBody.hasPassword).toBe(false);
    expect(statusBody.setup).toEqual({
      enabled: true,
      tokenRequired: true,
    });

    const accepted = await apiWithoutSession(
      "/portfolio/auth/setup",
      setupInit(payload),
    );
    expect(accepted.status).toBe(201);
  });

  it("émet un cookie HttpOnly, SameSite=Lax et expose /auth/me", async () => {
    await ensureTestSession(userA);
    const me = await apiAs(userA, "/portfolio/auth/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      authenticated: true,
      username: userA,
    });

    const verify = await apiWithoutSession("/portfolio/auth/verify", {
      ...jsonInit("POST", {
        username: userA,
        password: `Test-${userA}-Password-123!`,
      }),
    });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers.get("set-cookie") || "";
    expect(setCookie).toContain("portfolio_session=");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("invalide les anciens jetons après un changement de mot de passe", async () => {
    const user = `SecRotate_${suffix}`;
    const oldPassword = `Old-${user}-Password-123!`;
    const newPassword = `New-${user}-Password-456!`;

    const setup = await apiWithoutSession(
      "/portfolio/auth/setup",
      setupInit({ username: user, password: oldPassword }),
    );
    expect(setup.status).toBe(201);
    const oldCookie = (setup.headers.get("set-cookie") || "").split(";")[0];
    expect(oldCookie).toContain("portfolio_session=");

    const withCookie = (pathname: string, cookie: string, init?: RequestInit) =>
      fetch(`${TEST_SERVER.baseUrl}/api${pathname}`, {
        ...init,
        headers: { ...(init?.headers || {}), Cookie: cookie },
      });

    const changed = await withCookie(
      "/portfolio/auth/change-password",
      oldCookie,
      jsonInit("POST", {
        username: user,
        currentPassword: oldPassword,
        newPassword,
      }),
    );
    expect(changed.status).toBe(200);
    const newCookie = (changed.headers.get("set-cookie") || "").split(";")[0];
    expect(newCookie).toContain("portfolio_session=");
    expect(newCookie).not.toBe(oldCookie);

    const oldSession = await withCookie("/portfolio/auth/me", oldCookie);
    expect(await oldSession.json()).toEqual({
      authenticated: false,
      username: null,
    });
    const oldProtected = await withCookie(
      `/database/wallets?user_id=${encodeURIComponent(user)}`,
      oldCookie,
    );
    expect(oldProtected.status).toBe(401);

    const newSession = await withCookie("/portfolio/auth/me", newCookie);
    expect(await newSession.json()).toEqual({
      authenticated: true,
      username: user,
    });
  });

  it("rejette un user_id différent de la session avec 403", async () => {
    await ensureTestSession(userB);
    const response = await apiAs(
      userB,
      `/portfolio/overview?user_id=${encodeURIComponent(userA)}`,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("USER_MISMATCH");
  });
});

describe("cloisonnement des wallets (IDOR)", () => {
  it("ne permet ni de lire ni de modifier le wallet d'un autre profil", async () => {
    await ensureTestSession(userA);
    await ensureTestSession(userB);

    const created = await apiAs(
      userA,
      "/database/wallets",
      jsonInit("POST", {
        user_id: userA,
        name: "Wallet privé A",
        address: "0xidor-a",
        wallet_type: "metamask",
        blockchains: JSON.stringify(["ethereum"]),
        total_value: 1,
        last_updated: new Date().toISOString(),
        assets: [],
        nfts: [],
      }),
    );
    expect(created.status).toBe(200);
    const walletId = (await created.json()).id;

    const readOther = await apiAs(
      userB,
      `/database/wallets?user_id=${encodeURIComponent(userA)}`,
    );
    expect(readOther.status).toBe(403);

    // Body user_id = A avec session B : refus global avant la route.
    const spoofedBody = await apiAs(
      userB,
      `/database/wallets/${walletId}`,
      jsonInit("PUT", { user_id: userA, name: "Piraté" }),
    );
    expect(spoofedBody.status).toBe(403);

    // Query = B mais body = A : les deux valeurs doivent être contrôlées.
    const mixedIds = await apiAs(
      userB,
      `/database/wallets/${walletId}?user_id=${encodeURIComponent(userB)}`,
      jsonInit("PUT", { user_id: userA, name: "Piraté" }),
    );
    expect(mixedIds.status).toBe(403);

    // Body user_id = B avec session B : la route ne trouve pas le wallet de A.
    const hiddenWallet = await apiAs(
      userB,
      `/database/wallets/${walletId}`,
      jsonInit("PUT", { user_id: userB, name: "Piraté" }),
    );
    expect(hiddenWallet.status).toBe(404);

    const deleted = await apiAs(
      userA,
      `/database/wallets/${walletId}?user_id=${encodeURIComponent(userA)}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
  });
});

describe("coffre de secrets", () => {
  it("chiffre la clé, ne la renvoie jamais et isole les profils", async () => {
    await ensureTestSession(userSecrets);
    const plaintext = `gemini-secret-${suffix}`;

    const before = await apiAs(userSecrets, "/portfolio/secrets");
    expect(before.status).toBe(200);
    expect((await before.json()).secrets.geminiApiKey.configured).toBe(false);

    const saved = await apiAs(
      userSecrets,
      "/portfolio/secrets/geminiApiKey",
      jsonInit("PUT", { value: plaintext }),
    );
    expect(saved.status).toBe(200);

    const after = await apiAs(userSecrets, "/portfolio/secrets");
    const afterText = await after.text();
    expect(afterText).not.toContain(plaintext);
    expect(JSON.parse(afterText).secrets.geminiApiKey.configured).toBe(true);

    const db = openTestDb();
    try {
      const row = db
        .prepare(
          "SELECT encrypted_json FROM user_secrets WHERE user_id = ? AND key_name = ?",
        )
        .get(userSecrets, "geminiApiKey") as
        | { encrypted_json: string }
        | undefined;
      expect(row).toBeTruthy();
      expect(row!.encrypted_json).toMatch(/^v1:/);
      expect(row!.encrypted_json).not.toContain(plaintext);
    } finally {
      db.close();
    }

    await ensureTestSession(userB);
    const other = await apiAs(userB, "/portfolio/secrets");
    expect((await other.json()).secrets.geminiApiKey.configured).toBe(false);

    const removed = await apiAs(
      userSecrets,
      "/portfolio/secrets/geminiApiKey",
      { method: "DELETE" },
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).deleted).toBe(true);
  });

  it("migre un secret hérité en clair vers le coffre et assainit les paramètres", async () => {
    await ensureTestSession(userLegacy);
    const legacyValue = `legacy-plain-${suffix}`;

    const saved = await apiAs(
      userLegacy,
      "/database/user-settings",
      jsonInit("POST", {
        userId: userLegacy,
        settings: { currency: "EUR", geminiApiKey: legacyValue },
      }),
    );
    expect(saved.status).toBe(200);

    const fetched = await apiAs(
      userLegacy,
      `/database/user-settings?user_id=${encodeURIComponent(userLegacy)}`,
    );
    expect(fetched.status).toBe(200);
    const fetchedText = await fetched.text();
    expect(fetchedText).not.toContain(legacyValue);
    expect(JSON.parse(fetchedText).settings.geminiApiKey).toBeUndefined();

    const statuses = await apiAs(userLegacy, "/portfolio/secrets");
    expect((await statuses.json()).secrets.geminiApiKey.configured).toBe(true);

    const db = openTestDb();
    try {
      const row = db
        .prepare("SELECT settings_json FROM user_settings WHERE user_id = ?")
        .get(userLegacy) as { settings_json: string } | undefined;
      expect(row?.settings_json || "").not.toContain(legacyValue);
    } finally {
      db.close();
    }
  });

  it("isole les identifiants BoursoBank par session", async () => {
    const userA = `SecBoursoA_${suffix}`;
    const userB = `SecBoursoB_${suffix}`;
    await ensureTestSession(userA);
    await ensureTestSession(userB);

    const customerId = `bourso-customer-${suffix}`;
    const password = `bourso-password-${suffix}`;
    const savedCustomer = await apiAs(
      userA,
      "/portfolio/secrets/boursoCustomerId",
      jsonInit("PUT", { value: customerId }),
    );
    expect(savedCustomer.status).toBe(200);
    const savedPassword = await apiAs(
      userA,
      "/portfolio/secrets/boursoPassword",
      jsonInit("PUT", { value: password }),
    );
    expect(savedPassword.status).toBe(200);

    const statusA = await apiAs(userA, "/portfolio/sidecar/bourso/status");
    const bodyA = (await statusA.json()) as Record<string, unknown>;
    expect(bodyA.configured).toBe(true);
    expect(bodyA).not.toHaveProperty("customerId");

    const statusB = await apiAs(userB, "/portfolio/sidecar/bourso/status");
    const bodyB = (await statusB.json()) as Record<string, unknown>;
    expect(bodyB.configured).toBe(false);
    expect(bodyB).not.toHaveProperty("customerId");

    const secretsB = await apiAs(userB, "/portfolio/secrets");
    const secretsBody = (await secretsB.json()) as {
      secrets: Record<string, { configured: boolean }>;
    };
    expect(secretsBody.secrets.boursoCustomerId.configured).toBe(false);
    expect(secretsBody.secrets.boursoPassword.configured).toBe(false);
  });

  it("migre les identifiants Binance historiques et ne les expose jamais", async () => {
    const user = `SecBinance_${suffix}`;
    await ensureTestSession(user);
    const apiKey = `binance-key-${suffix}`;
    const apiSecret = `binance-secret-${suffix}`;

    const db = new Database(TEST_SERVER.dbPath);
    try {
      const repository = new PortfolioRepository(db);
      const account = repository.createAccount(user, {
        provider: "binance",
        name: "Binance historique",
        type: "CRYPTO",
        metadata: {
          credentialsEncrypted: encryptJson({ apiKey, apiSecret }),
          apiKeyMasked: "binance-key...cret",
        },
      });

      // Même avant migration, l'API ne doit renvoyer ni le chiffré ni le masque.
      const listed = await apiAs(
        user,
        `/portfolio/crypto/accounts?user_id=${encodeURIComponent(user)}`,
      );
      expect(listed.status).toBe(200);
      const payload = (await listed.json()) as {
        accounts: Array<{ id: string; metadata: Record<string, unknown> }>;
      };
      const publicAccount = payload.accounts.find((row) => row.id === account.id);
      expect(publicAccount).toBeTruthy();
      expect(publicAccount!.metadata.credentialsEncrypted).toBeUndefined();
      expect(publicAccount!.metadata.apiKeyMasked).toBeUndefined();

      const migrated = migrateLegacyBinanceCredentials(db);
      expect(migrated).toBeGreaterThanOrEqual(1);
      expect(getUserSecret(db, user, "binanceApiKey")).toBe(apiKey);
      expect(getUserSecret(db, user, "binanceSecretKey")).toBe(apiSecret);

      const updated = repository.getAccount(account.id, user);
      expect(updated?.metadata.credentialsEncrypted).toBeUndefined();
      expect(updated?.metadata.apiKeyMasked).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("migre aussi les clés Binance historiques stockées en clair", async () => {
    const user = `SecBinancePlain_${suffix}`;
    await ensureTestSession(user);
    const apiKey = `plain-binance-key-${suffix}`;
    const apiSecret = `plain-binance-secret-${suffix}`;

    const db = new Database(TEST_SERVER.dbPath);
    let accountId = "";
    try {
      const repository = new PortfolioRepository(db);
      const account = repository.createAccount(user, {
        provider: "binance",
        name: "Binance clair",
        type: "CRYPTO",
        metadata: {
          apiKey,
          apiSecret,
          apiKeyMasked: "plain...cret",
        },
      });
      accountId = account.id;

      expect(migrateLegacyBinanceCredentials(db)).toBeGreaterThanOrEqual(1);
      expect(getUserSecret(db, user, "binanceApiKey")).toBe(apiKey);
      expect(getUserSecret(db, user, "binanceSecretKey")).toBe(apiSecret);

      const updated = repository.getAccount(account.id, user);
      expect(updated?.metadata.apiKey).toBeUndefined();
      expect(updated?.metadata.apiSecret).toBeUndefined();
      expect(updated?.metadata.apiKeyMasked).toBeUndefined();
    } finally {
      if (accountId) {
        db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
      }
      db.prepare("DELETE FROM user_secrets WHERE user_id = ?").run(user);
      db.close();
    }
  });
});

describe("cloisonnement Tricount", () => {
  it("refuse d'écraser la dépense d'un autre profil via un identifiant connu", async () => {
    const owner = `TricountOwner_${suffix}`;
    const attacker = `TricountAttacker_${suffix}`;
    await ensureTestSession(owner);
    await ensureTestSession(attacker);

    const expenseId = `expense_${suffix}`;
    const created = await apiAs(
      owner,
      "/database/tricount/expenses",
      jsonInit("POST", {
        userId: owner,
        expense: {
          id: expenseId,
          month: "2026-11",
          date: "2026-11-10",
          label: "Dépense du propriétaire",
          amount: 42,
        },
      }),
    );
    expect(created.status).toBe(200);

    const overwrite = await apiAs(
      attacker,
      "/database/tricount/expenses",
      jsonInit("POST", {
        userId: attacker,
        expense: {
          id: expenseId,
          month: "2026-11",
          date: "2026-11-10",
          label: "Dépense écrasée",
          amount: 1,
        },
      }),
    );
    expect(overwrite.status).not.toBe(200);

    const ownerData = await apiAs(
      owner,
      `/database/tricount/data?user_id=${encodeURIComponent(owner)}`,
    );
    expect(ownerData.status).toBe(200);
    const payload = (await ownerData.json()) as {
      expenses: Array<{ id: string; label: string; amount: number }>;
    };
    const expense = payload.expenses.find((row) => row.id === expenseId);
    expect(expense).toMatchObject({
      label: "Dépense du propriétaire",
      amount: 42,
    });
  });
});

describe("foyer Savings/Tricount", () => {
  it("n'accorde le partage qu'après consentement mutuel des deux stratégies", async () => {
    const owner = `HouseholdOwner_${suffix}`;
    const attacker = `HouseholdAttacker_${suffix}`;
    await ensureTestSession(owner);
    await ensureTestSession(attacker);

    const expenseId = `household_${suffix}`;
    const created = await apiAs(
      owner,
      "/database/tricount/expenses",
      jsonInit("POST", {
        userId: owner,
        expense: {
          id: expenseId,
          month: "2026-11",
          date: "2026-11-12",
          label: "Dépense privée",
          amount: 99,
        },
      }),
    );
    expect(created.status).toBe(200);

    const db = new Database(TEST_SERVER.dbPath);
    const upsertStrategy = db.prepare(
      `INSERT INTO savings_strategies (user_id, strategy_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         strategy_json = excluded.strategy_json,
         updated_at = excluded.updated_at`,
    );
    const household = (person1: string, person2: string) =>
      JSON.stringify({
        household: {
          enabled: true,
          person1: { name: person1 },
          person2: { name: person2 },
        },
      });
    try {
      // L'attaquant se déclare seul membre du foyer avec le propriétaire :
      // sans stratégie du propriétaire, aucun partage ne doit avoir lieu.
      upsertStrategy.run(attacker, household(attacker, owner), new Date().toISOString());
      const isolated = await apiAs(
        attacker,
        `/database/tricount/data?user_id=${encodeURIComponent(attacker)}`,
      );
      expect(isolated.status).toBe(200);
      const isolatedPayload = (await isolated.json()) as {
        expenses: Array<{ id: string }>;
      };
      expect(
        isolatedPayload.expenses.some((row) => row.id === expenseId),
      ).toBe(false);

      // Le propriétaire déclare explicitement le même foyer : consentement
      // mutuel, le partage devient légitime.
      upsertStrategy.run(owner, household(attacker, owner), new Date().toISOString());
      const shared = await apiAs(
        attacker,
        `/database/tricount/data?user_id=${encodeURIComponent(attacker)}`,
      );
      expect(shared.status).toBe(200);
      const sharedPayload = (await shared.json()) as {
        expenses: Array<{ id: string }>;
      };
      expect(sharedPayload.expenses.some((row) => row.id === expenseId)).toBe(
        true,
      );
    } finally {
      db.prepare("DELETE FROM savings_strategies WHERE user_id IN (?, ?)").run(
        attacker,
        owner,
      );
      db.prepare("DELETE FROM tricount_expenses WHERE id = ?").run(expenseId);
      db.close();
    }
  });
});

describe("assainissement des résultats de synchronisation", () => {
  it("assainit les comptes et résultats imbriqués", () => {
    const cleaned = publicSyncResult({
      accounts: [
        { id: "a", metadata: { apiKey: "secret", note: "ok" } },
        { id: "b", metadata: { password: "secret", customerId: "secret" } },
      ],
      results: [
        {
          account: {
            id: "c",
            metadata: { apiSecret: "secret", keep: true },
          },
        },
        {
          sync: {
            account: {
              id: "d",
              metadata: { credentialsEncrypted: "v1:secret" },
            },
          },
        },
      ],
    }) as {
      accounts: Array<{ metadata: Record<string, unknown> }>;
      results: Array<{
        account?: { metadata: Record<string, unknown> };
        sync?: { account: { metadata: Record<string, unknown> } };
      }>;
    };

    expect(cleaned.accounts[0].metadata.apiKey).toBeUndefined();
    expect(cleaned.accounts[0].metadata.note).toBe("ok");
    expect(cleaned.accounts[1].metadata.password).toBeUndefined();
    expect(cleaned.accounts[1].metadata.customerId).toBeUndefined();
    expect(cleaned.results[0].account?.metadata.apiSecret).toBeUndefined();
    expect(cleaned.results[0].account?.metadata.keep).toBe(true);
    expect(
      cleaned.results[1].sync?.account.metadata.credentialsEncrypted,
    ).toBeUndefined();
  });

  it("retire les métadonnées secrètes des comptes imbriqués", async () => {
    const user = `SecSync_${suffix}`;
    await ensureTestSession(user);

    const db = new Database(TEST_SERVER.dbPath);
    let accountId = "";
    try {
      const repository = new PortfolioRepository(db);
      const account = repository.createAccount(user, {
        provider: "manual",
        name: "Crypto historique",
        type: "CRYPTO",
        metadata: {
          apiKey: `legacy-key-${suffix}`,
          apiSecret: `legacy-secret-${suffix}`,
          credentialsEncrypted: "v1:legacy",
          apiKeyMasked: "legacy...cret",
          note: "metadata visible",
        },
      });
      accountId = account.id;

      const direct = await apiAs(
        user,
        `/portfolio/crypto/sync/${account.id}`,
        jsonInit("POST", { user_id: user }),
      );
      expect(direct.status).toBe(200);
      const directBody = (await direct.json()) as {
        account: { metadata: Record<string, unknown> };
      };
      expect(directBody.account.metadata.apiKey).toBeUndefined();
      expect(directBody.account.metadata.apiSecret).toBeUndefined();
      expect(directBody.account.metadata.credentialsEncrypted).toBeUndefined();
      expect(directBody.account.metadata.apiKeyMasked).toBeUndefined();
      expect(directBody.account.metadata.note).toBe("metadata visible");

      const viaAccount = await apiAs(
        user,
        `/portfolio/accounts/${account.id}/sync`,
        jsonInit("POST", { user_id: user }),
      );
      expect(viaAccount.status).toBe(200);
      const viaAccountBody = (await viaAccount.json()) as {
        result: { account: { metadata: Record<string, unknown> } };
        account: { metadata: Record<string, unknown> };
      };
      expect(viaAccountBody.result.account.metadata.apiKey).toBeUndefined();
      expect(viaAccountBody.result.account.metadata.apiSecret).toBeUndefined();
      expect(
        viaAccountBody.result.account.metadata.credentialsEncrypted,
      ).toBeUndefined();
      expect(viaAccountBody.account.metadata.apiKey).toBeUndefined();
    } finally {
      if (accountId) {
        db.prepare("DELETE FROM holdings WHERE account_id = ?").run(accountId);
        db.prepare("DELETE FROM balance_snapshots WHERE account_id = ?").run(
          accountId,
        );
        db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
      }
      db.close();
    }
  });
});

describe("validation du state OAuth", () => {
  it("refuse un state absent, mal formé ou associé à un autre profil", async () => {
    await ensureTestSession(userA);

    const missing = await apiAs(
      userA,
      "/portfolio/connections/enable-banking/complete",
      jsonInit("POST", {
        callback_url: "https://example.test/callback?code=authorization-code",
      }),
    );
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("État OAuth");

    const malformed = await apiAs(
      userA,
      "/portfolio/connections/enable-banking/complete",
      jsonInit("POST", {
        callback_url:
          "https://example.test/callback?code=authorization-code&state=not-a-valid-state",
      }),
    );
    expect(malformed.status).toBe(400);

    const foreign = await apiAs(
      userA,
      "/portfolio/connections/enable-banking/complete",
      jsonInit("POST", {
        callback_url: `https://example.test/callback?code=authorization-code&state=${encodeURIComponent(
          `${userB}.${randomUUID()}`,
        )}`,
      }),
    );
    expect(foreign.status).toBe(403);
  });
});

describe("suppression complète du profil", () => {
  it("purge les données, les secrets, les identifiants et invalide la session", async () => {
    await ensureTestSession(userDelete);

    const wallet = await apiAs(
      userDelete,
      "/database/wallets",
      jsonInit("POST", {
        user_id: userDelete,
        name: "Wallet à supprimer",
        address: "0xdelete",
        wallet_type: "metamask",
        blockchains: JSON.stringify(["ethereum"]),
        total_value: 1,
        last_updated: new Date().toISOString(),
        assets: [],
        nfts: [],
      }),
    );
    expect(wallet.status).toBe(200);

    // Un compte partagé appartenant à B ne doit pas conserver une part de A.
    let sharedAccountId = "";
    const sharedDb = new Database(TEST_SERVER.dbPath);
    try {
      const repository = new PortfolioRepository(sharedDb);
      const shared = repository.createAccount(userB, {
        name: "Compte partagé",
        type: "CHECKING",
        provider: "manual",
        balance: 100,
      });
      sharedAccountId = shared.id;
      repository.replaceOwnerships(shared.id, userB, [
        { ownerName: userB, sharePercent: 50 },
        { ownerName: userDelete, sharePercent: 50 },
      ]);
    } finally {
      sharedDb.close();
    }

    const secret = await apiAs(
      userDelete,
      "/portfolio/secrets/openSeaApiKey",
      jsonInit("PUT", { value: `opensea-${suffix}` }),
    );
    expect(secret.status).toBe(200);

    const settings = await apiAs(
      userDelete,
      "/database/user-settings",
      jsonInit("POST", {
        userId: userDelete,
        settings: { currency: "EUR", theme: "dark" },
      }),
    );
    expect(settings.status).toBe(200);

    const deletion = await apiAs(
      userDelete,
      `/portfolio/users/${encodeURIComponent(userDelete)}`,
      { method: "DELETE" },
    );
    expect(deletion.status).toBe(200);
    expect((await deletion.json()).success).toBe(true);

    // Le jeton signé existe encore, mais le profil n'a plus d'identifiants :
    // la session doit être refusée immédiatement.
    const me = await apiAs(userDelete, "/portfolio/auth/me");
    expect(await me.json()).toEqual({
      authenticated: false,
      username: null,
    });
    const wallets = await apiAs(userDelete, "/database/wallets");
    expect(wallets.status).toBe(401);

    const status = await apiJson<{ hasPassword: boolean }>(
      `/portfolio/auth/status?username=${encodeURIComponent(userDelete)}`,
    );
    expect(status.status).toBe(200);
    expect(status.body.hasPassword).toBe(false);

    const db = openTestDb();
    try {
      for (const [table, column] of [
        ["wallets", "user_id"],
        ["user_settings", "user_id"],
        ["user_secrets", "user_id"],
        ["user_credentials", "username"],
      ]) {
        const row = db
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
          .get(userDelete) as { count: number };
        expect(row.count, `${table} doit être vide`).toBe(0);
      }
      const ownership = db
        .prepare(
          "SELECT COUNT(*) AS count FROM account_ownerships WHERE owner_name = ?",
        )
        .get(userDelete) as { count: number };
      expect(ownership.count).toBe(0);
      const shared = db
        .prepare("SELECT COUNT(*) AS count FROM accounts WHERE id = ?")
        .get(sharedAccountId) as { count: number };
      expect(shared.count).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("mot de passe et client Gemini", () => {
  it("refuse un mot de passe de moins de 8 caractères via l'API", async () => {
    const response = await postJson(
      "/portfolio/auth/setup",
      {
        username: `SecShort_${suffix}`,
        password: "1234567",
      },
      setupHeaders,
    );
    expect(response.status).toBe(400);
  });

  it("n'inclut jamais de clé API dans l'URL Gemini du navigateur", () => {
    const url = getAdvisorApiUrl("Romain", "gemini-2.5-flash");
    expect(url).toContain("/api/portfolio/ai/gemini");
    expect(url).toContain("model=gemini-2.5-flash");
    expect(url).not.toContain("key=");
    expect(url).not.toContain("generativelanguage.googleapis.com");
  });

  it("purge les anciens secrets du localStorage et ne les réécrit pas", () => {
    localStorage.setItem(
      `user_settings_${userLocal}`,
      JSON.stringify({ currency: "USD", geminiApiKey: "plain-local-secret" }),
    );
    const loaded = getUserSettings(userLocal);
    expect((loaded as unknown as Record<string, unknown>).geminiApiKey).toBe(
      undefined,
    );
    expect(localStorage.getItem(`user_settings_${userLocal}`) || "").not.toContain(
      "plain-local-secret",
    );

    saveUserSettings(userLocal, {
      ...loaded,
      geminiApiKey: "another-plain-secret",
    } as typeof loaded);
    expect(localStorage.getItem(`user_settings_${userLocal}`) || "").not.toContain(
      "another-plain-secret",
    );
  });
});
