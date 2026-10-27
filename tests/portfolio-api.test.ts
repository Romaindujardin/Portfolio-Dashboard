// Tests d'intégration de l'API patrimoine : comptes, positions, immobilier,
// prêts, parts et chiffrement de la configuration Enable Banking. Chaque test
// utilise un utilisateur isolé ; aucun appel bancaire ou de marché réel n'est
// nécessaire (les cours sont fournis explicitement).
import "./shims";
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { apiJson } from "./helpers";

let sequence = 0;
const testUser = (label: string) =>
  `Patr_${label}_${process.pid}_${(sequence += 1)}`;

const requestJson = (
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> =>
  apiJson(pathname, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });

const postJson = (pathname: string, body: unknown) =>
  requestJson("POST", pathname, body);
const patchJson = (pathname: string, body: unknown) =>
  requestJson("PATCH", pathname, body);
const putJson = (pathname: string, body: unknown) =>
  requestJson("PUT", pathname, body);
const getJson = (pathname: string) => requestJson("GET", pathname);

describe("API patrimoine — comptes et transactions", () => {
  it("crée, modifie, détaille et supprime un compte manuel", async () => {
    const user = testUser("compte");
    const refused = await postJson("/portfolio/accounts", {
      user_id: user,
      name: "Bien brut",
      type: "REAL_ESTATE",
      balance: 100_000,
    });
    expect(refused.status).toBe(400);
    const created = await postJson("/portfolio/accounts", {
      user_id: user,
      name: "Compte courant test",
      type: "CHECKING",
      balance: 1000,
      currency: "EUR",
    });
    expect(created.status).toBe(201);
    const account = (created.body as { account: Record<string, unknown> }).account;
    expect(account).toMatchObject({
      name: "Compte courant test",
      type: "CHECKING",
      balance: 1000,
      currency: "EUR",
      isManual: true,
    });

    const converted = await patchJson(`/portfolio/accounts/${account.id}`, {
      user_id: user,
      type: "LOAN",
    });
    expect(converted.status).toBe(400);

    const refusedHolding = await postJson(
      `/portfolio/accounts/${account.id}/holdings`,
      { user_id: user, ticker: "TEST.PA", quantity: 1, price: 10 },
    );
    expect(refusedHolding.status).toBe(409);

    const patched = await patchJson(`/portfolio/accounts/${account.id}`, {
      user_id: user,
      name: "Compte renommé",
      balance: 1250.555,
    });
    expect(patched.status).toBe(200);
    expect(
      (patched.body as { account: Record<string, unknown> }).account,
    ).toMatchObject({ name: "Compte renommé", balance: 1250.56 });

    const detail = await getJson(
      `/portfolio/accounts/${account.id}?user_id=${user}`,
    );
    expect(detail.status).toBe(200);
    expect(
      (detail.body as { snapshots: unknown[] }).snapshots,
    ).toHaveLength(1);

    const transaction = {
      user_id: user,
      date: "2026-10-01",
      amount: -42.5,
      label: "Boulangerie",
      counterparty: "Boulangerie",
    };
    expect((await postJson(`/portfolio/accounts/${account.id}/transactions`, transaction)).status).toBe(
      201,
    );
    // Même empreinte : l'index unique doit ignorer silencieusement le doublon.
    expect((await postJson(`/portfolio/accounts/${account.id}/transactions`, transaction)).status).toBe(
      201,
    );
    const listed = await getJson(
      `/portfolio/accounts/${account.id}/transactions?user_id=${user}`,
    );
    const transactions = (
      listed.body as { transactions: Array<Record<string, unknown>> }
    ).transactions;
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      amount: -42.5,
      label: "Boulangerie",
      provider: "manual",
    });

    const overview = await getJson(`/portfolio/overview?user_id=${user}`);
    expect(overview.status).toBe(200);
    expect(
      (overview.body as { totals: Record<string, number> }).totals,
    ).toMatchObject({ assets: 1250.56, debts: 0, netWorth: 1250.56 });

    const deleted = await requestJson(
      "DELETE",
      `/portfolio/accounts/${account.id}?user_id=${user}`,
    );
    expect(deleted.status).toBe(200);
    expect(
      (await getJson(`/portfolio/accounts/${account.id}?user_id=${user}`)).status,
    ).toBe(404);
  });

  it("refuse un compte sans nom et un utilisateur invalide", async () => {
    expect(
      (
        await postJson("/portfolio/accounts", {
          user_id: "Valid_User",
          name: "  ",
          type: "CHECKING",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postJson("/portfolio/accounts", {
          user_id: "utilisateur avec espaces",
          name: "Compte",
        })
      ).status,
    ).toBe(400);
  });
});

describe("API patrimoine — positions et valorisation", () => {
  it("crée un compte d'investissement et recalcule sa valeur", async () => {
    const user = testUser("pea");
    const created = await postJson("/portfolio/accounts", {
      user_id: user,
      name: "PEA test",
      type: "PEA",
      balance: 1000,
    });
    expect(created.status).toBe(201);
    const account = (created.body as { account: Record<string, unknown> }).account;
    expect(account).toMatchObject({ type: "PEA", balance: 1000, cashBalance: 0 });

    const holdingResponse = await postJson(
      `/portfolio/accounts/${account.id}/holdings`,
      {
        user_id: user,
        ticker: "TEST.PA",
        name: "Action test",
        quantity: 2,
        cost_basis: 150,
        price: 100,
        cash_balance: 50,
      },
    );
    expect(holdingResponse.status).toBe(201);
    const holdingBody = holdingResponse.body as {
      holding: Record<string, unknown>;
      account: Record<string, unknown>;
    };
    expect(holdingBody.holding).toMatchObject({
      ticker: "TEST.PA",
      quantity: 2,
      price: 100,
      currency: "EUR",
    });
    expect(holdingBody.account.balance).toBe(250);
    expect(holdingBody.account.cashBalance).toBe(50);

    const overview = await getJson(`/portfolio/overview?user_id=${user}`);
    const body = overview.body as {
      totals: Record<string, number>;
      counts: Record<string, number>;
      accounts: Array<{ holdings: unknown[] }>;
    };
    expect(body.totals.assets).toBe(250);
    expect(body.counts.holdings).toBe(1);
    expect(body.accounts[0].holdings).toHaveLength(1);

    const holdings = await getJson(`/portfolio/market/holdings?user_id=${user}`);
    expect(holdings.status).toBe(200);
    const list = (holdings.body as { holdings: Array<Record<string, unknown>> }).holdings;
    expect(list[0]).toMatchObject({
      accountName: "PEA test",
      accountType: "PEA",
      value: 200,
    });

    const downgrade = await patchJson(`/portfolio/accounts/${account.id}`, {
      user_id: user,
      type: "CHECKING",
    });
    expect(downgrade.status).toBe(409);

    const deleted = await requestJson(
      "DELETE",
      `/portfolio/accounts/${account.id}/holdings/${holdingBody.holding.id}?user_id=${user}`,
    );
    expect(deleted.status).toBe(200);
    const after = await getJson(`/portfolio/overview?user_id=${user}`);
    expect((after.body as { totals: Record<string, number> }).totals.assets).toBe(50);
  });
});

describe("API patrimoine — immobilier, parts et prêt", () => {
  it("crée un bien, répartit les parts et suit le prêt lié", async () => {
    const user = testUser("immo");
    const propertyResponse = await postJson("/portfolio/properties", {
      user_id: user,
      name: "Appartement test",
      address: "1 rue de la Paix",
      postal_code: "75002",
      city: "Paris",
      property_type: "APARTMENT",
      surface_m2: 45,
      rooms: 2,
      purchase_price: 300_000,
      current_value: 320_000,
    });
    expect(propertyResponse.status).toBe(201);
    const propertyBody = propertyResponse.body as {
      property: Record<string, unknown>;
      account: Record<string, unknown>;
    };
    expect(propertyBody.property).toMatchObject({
      name: "Appartement test",
      currentValue: 320_000,
      valuationMode: "MANUAL",
      accountId: propertyBody.account.id,
    });
    expect(propertyBody.account).toMatchObject({
      type: "REAL_ESTATE",
      balance: 320_000,
    });

    const shares = await putJson(
      `/portfolio/accounts/${propertyBody.account.id}/ownership`,
      {
        user_id: user,
        shares: [
          { owner_name: user, share_percent: 60 },
          { owner_name: "Camille", share_percent: 40 },
        ],
      },
    );
    expect(shares.status).toBe(200);
    expect((shares.body as { ownerships: unknown[] }).ownerships).toHaveLength(2);

    const loanResponse = await postJson("/portfolio/loans", {
      user_id: user,
      name: "Prêt appartement",
      lender: "Banque test",
      principal: 120_000,
      annual_rate: 3,
      start_date: "2025-01-01",
      term_months: 240,
      insurance_monthly: 20,
      property_id: propertyBody.property.id,
    });
    expect(loanResponse.status).toBe(201);
    const loanBody = loanResponse.body as {
      loan: Record<string, unknown>;
      account: Record<string, unknown>;
      summary: Record<string, unknown>;
    };
    expect(loanBody.loan).toMatchObject({
      name: "Prêt appartement",
      principal: 120_000,
      annualRate: 3,
      termMonths: 240,
      propertyId: propertyBody.property.id,
    });
    expect(loanBody.summary.months).toBe(240);
    expect(Number(loanBody.account.balance)).toBeLessThan(0);

    const schedule = await getJson(
      `/portfolio/loans/${loanBody.loan.id}/schedule?user_id=${user}&as_of=2025-01-01`,
    );
    expect(schedule.status).toBe(200);
    expect(
      (schedule.body as { installments: unknown[] }).installments,
    ).toHaveLength(240);

    const overview = await getJson(`/portfolio/overview?user_id=${user}`);
    const overviewBody = overview.body as {
      totals: { assets: number; debts: number; netWorth: number };
      perOwner: Record<string, number>;
      counts: Record<string, number>;
    };
    expect(overviewBody.totals.assets).toBe(320_000);
    expect(overviewBody.totals.debts).toBeGreaterThan(0);
    expect(overviewBody.totals.netWorth).toBeCloseTo(
      overviewBody.totals.assets - overviewBody.totals.debts,
      2,
    );
    expect(overviewBody.perOwner[user]).toBeCloseTo(
      320_000 * 0.6 - overviewBody.totals.debts,
      2,
    );
    expect(overviewBody.counts).toMatchObject({
      accounts: 2,
      properties: 1,
      loans: 1,
    });

    const guarded = await requestJson(
      "DELETE",
      `/portfolio/accounts/${propertyBody.account.id}?user_id=${user}`,
    );
    expect(guarded.status).toBe(409);
    expect((guarded.body as { error: string }).error).toMatch(/Immobilier/i);

    const guardedPatch = await patchJson(
      `/portfolio/accounts/${propertyBody.account.id}`,
      { user_id: user, balance: 1 },
    );
    expect(guardedPatch.status).toBe(409);
    expect((guardedPatch.body as { error: string }).error).toMatch(/Immobilier/i);

    const guardedHolding = await postJson(
      `/portfolio/accounts/${propertyBody.account.id}/holdings`,
      { user_id: user, ticker: "TEST.PA", quantity: 1, price: 10 },
    );
    expect(guardedHolding.status).toBe(409);

    const patchedProperty = await patchJson(
      `/portfolio/properties/${propertyBody.property.id}`,
      { user_id: user, current_value: 340_000 },
    );
    expect(patchedProperty.status).toBe(200);
    const afterValue = await getJson(
      `/portfolio/accounts/${propertyBody.account.id}?user_id=${user}`,
    );
    expect(
      (afterValue.body as { account: Record<string, unknown> }).account.balance,
    ).toBe(340_000);

    expect(
      (
        await requestJson(
          "DELETE",
          `/portfolio/properties/${propertyBody.property.id}?user_id=${user}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await requestJson(
          "DELETE",
          `/portfolio/loans/${loanBody.loan.id}?user_id=${user}`,
        )
      ).status,
    ).toBe(200);
    const empty = await getJson(`/portfolio/overview?user_id=${user}`);
    expect((empty.body as { counts: Record<string, number> }).counts).toMatchObject({
      accounts: 0,
      properties: 0,
      loans: 0,
      holdings: 0,
    });
  });

  it("valide les parts et les prêts incomplets", async () => {
    const user = testUser("validation");
    const account = await postJson("/portfolio/accounts", {
      user_id: user,
      name: "Compte joint",
      type: "CHECKING",
      balance: 1000,
    });
    const accountId = (account.body as { account: Record<string, unknown> }).account.id;
    const tooMuch = await putJson(`/portfolio/accounts/${accountId}/ownership`, {
      user_id: user,
      shares: [
        { owner_name: "A", share_percent: 60 },
        { owner_name: "B", share_percent: 50 },
      ],
    });
    expect(tooMuch.status).toBe(400);
    expect((tooMuch.body as { code: string }).code).toBe("OWNERSHIP_ERROR");

    expect(
      (
        await postJson("/portfolio/loans", {
          user_id: user,
          name: "Prêt sans durée",
          principal: 100_000,
          start_date: "2026-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postJson("/portfolio/loans", {
          user_id: user,
          name: "Prêt sans date",
          principal: 100_000,
          term_months: 120,
        })
      ).status,
    ).toBe(400);
  });
});

describe("API patrimoine — connexions et marché", () => {
  it("chiffre la configuration Enable Banking et ne la renvoie jamais en clair", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const applicationId = "app-test-patrimoine";
    const redirectUri =
      "http://localhost:3001/api/portfolio/connections/enable-banking/callback";

    const saved = await putJson("/portfolio/connections/settings", {
      applicationId,
      privateKey,
      redirectUri,
    });
    expect(saved.status).toBe(200);
    const status = (saved.body as { status: Record<string, unknown> }).status;
    expect(status.configured).toBe(true);
    expect(status.applicationId).not.toBe(applicationId);
    expect(status.applicationId).toMatch(/…$/);
    expect(JSON.stringify(saved.body)).not.toContain("BEGIN PRIVATE KEY");
    expect(JSON.stringify(saved.body)).not.toContain(privateKey.slice(30, 80));

    const fetched = await getJson("/portfolio/connections/status");
    expect(fetched.status).toBe(200);
    expect(
      (fetched.body as { status: Record<string, unknown> }).status,
    ).toMatchObject({ configured: true, redirectUri });

    expect(
      (
        await requestJson("DELETE", "/portfolio/connections/settings")
      ).status,
    ).toBe(200);
    const deleted = await getJson("/portfolio/connections/status");
    expect(
      (deleted.body as { status: Record<string, unknown> }).status.configured,
    ).toBe(false);
  });

  it("refuse proprement les appels bancaires sans configuration", async () => {
    const countries = await getJson("/portfolio/connections/countries");
    expect(countries.status).toBe(200);
    expect((countries.body as { countries: string[] }).countries).toContain("FR");

    const institutions = await getJson(
      "/portfolio/connections/institutions?country=FR&query=BNP",
    );
    expect(institutions.status).toBe(400);
    expect((institutions.body as { code: string }).code).toBe(
      "CONNECTOR_NOT_CONFIGURED",
    );

    const start = await postJson("/portfolio/connections/enable-banking/start", {
      user_id: "Patr_connections",
      institution_id: "BNP Paribas::FR::personal",
    });
    expect(start.status).toBe(400);
    expect((start.body as { code: string }).code).toBe("CONNECTOR_NOT_CONFIGURED");

    const callback = await getJson(
      "/portfolio/connections/enable-banking/callback?error=access_denied&error_description=Refus%C3%A9&format=json",
    );
    expect(callback.status).toBe(400);
    expect((callback.body as { error: string }).error).toBe("Refusé");
  });

  it("refuse les tickers et ISIN invalides sans appel réseau", async () => {
    const noTicker = await getJson("/portfolio/market/quote");
    expect(noTicker.status).toBe(400);

    const invalidIsin = await getJson("/portfolio/market/resolve-isin?isin=ABC");
    expect(invalidIsin.status).toBe(400);
    expect((invalidIsin.body as { code: string }).code).toBe("INVALID_ISIN");

    const noQuery = await getJson("/portfolio/market/search");
    expect(noQuery.status).toBe(400);
  });

  it("gère les comptes crypto, positions manuelles et synchronisation", async () => {
    const user = testUser("crypto");

    // Créer un compte crypto manuel avec positions
    const created = await postJson("/portfolio/crypto/accounts", {
      user_id: user,
      name: "Cold Storage Ledger",
      provider: "manual",
      holdings: [
        { ticker: "BTC", name: "Bitcoin", quantity: 0.5, price: 60000 },
        { ticker: "ETH", name: "Ethereum", quantity: 2, price: 3000 },
      ],
    });
    expect(created.status).toBe(201);
    const body = created.body as { account: { id: string; balance: number; type: string }; holdings: Array<{ ticker: string; quantity: number }> };
    expect(body.account.type).toBe("CRYPTO");
    expect(body.account.balance).toBeGreaterThan(0);
    expect(body.holdings).toHaveLength(2);

    // Lister les comptes crypto
    const listRes = await getJson(`/portfolio/crypto/accounts?user_id=${user}`);
    expect(listRes.status).toBe(200);
    const listBody = listRes.body as { accounts: Array<{ id: string; name: string; holdings: unknown[] }> };
    expect(listBody.accounts).toHaveLength(1);
    expect(listBody.accounts[0].name).toBe("Cold Storage Ledger");
    expect(listBody.accounts[0].holdings).toHaveLength(2);

    // Synchroniser le compte manuel
    const syncRes = await postJson(`/portfolio/crypto/sync/${body.account.id}`, { user_id: user });
    expect(syncRes.status).toBe(200);

    // Synchroniser tous les comptes crypto
    const syncAllRes = await postJson("/portfolio/crypto/sync-all", { user_id: user });
    expect(syncAllRes.status).toBe(200);
    const syncAllBody = syncAllRes.body as { total: number; synced: number };
    expect(syncAllBody.total).toBe(1);
    expect(syncAllBody.synced).toBe(1);

    // Vérifier l'intégration dans l'overview patrimoine
    const overviewRes = await getJson(`/portfolio/overview?user_id=${user}`);
    expect(overviewRes.status).toBe(200);
    const overviewBody = overviewRes.body as { totals: { assets: number; netWorth: number }; byType: Record<string, number> };
    expect(overviewBody.totals.assets).toBe(overviewBody.byType["CRYPTO"]);
    expect(overviewBody.byType["CRYPTO"]).toBeGreaterThan(0);
  });
});
