import "./shims";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import { PROVIDERS } from "../server/connectors/types.js";
import {
  FORTUNEO_PROVIDER,
  applyFortuneoExport,
  deleteFortuneoCredentials,
  getFortuneoSavedCredentials,
  getFortuneoStatus,
  mapFortuneoAccountType,
  mapFortuneoPosition,
  mapFortuneoTransaction,
  saveFortuneoLogin,
} from "../server/services/fortuneoSidecarService.js";
import { getUserSecret } from "../server/services/userSecretsService.js";

const USER = "TestFortuneoSidecar";

const fortuneoExport = () => ({
  schema: "fortuneo-sidecar/export/v1",
  status: "ok",
  accounts: [
    {
      id: "fortuneo-checking-1",
      label: "Compte de chèques Fortuneo",
      kind: "banking",
      type: "checking",
      typeLabel: "Compte courant",
      balance: 950.25,
      currency: "EUR",
      iban: "FR7612345678901234567890123",
      transactions: [
        {
          id: "ftx-1",
          dedupKey: "fortuneo:fortuneo-checking-1:ftx-1",
          date: "2026-02-03",
          amount: -25.4,
          currency: "EUR",
          label: "Paiement carte",
        },
      ],
      positions: [],
    },
    {
      id: "fortuneo-pea-1",
      label: "PEA Fortuneo",
      kind: "trading",
      type: "pea",
      typeLabel: "PEA",
      balance: 1600,
      currency: "EUR",
      transactions: [],
      positions: [
        {
          label: "Air Liquide",
          code: "FR0000120073",
          codeType: "ISIN",
          stockSymbol: "AI",
          quantity: 10,
          unitPrice: 150,
          unitValue: 160,
          valuation: 1600,
          currency: "EUR",
          assetCategory: "action",
        },
      ],
    },
  ],
  errors: [],
});

describe("Fortuneo Sidecar Service", () => {
  let db: any;
  let repository: any;

  beforeEach(() => {
    db = new Database(":memory:");
    initializePortfolioSchema(db);
    repository = new PortfolioRepository(db);
  });

  it("classe les comptes Fortuneo", () => {
    expect(mapFortuneoAccountType({ kind: "banking" })).toBe("CHECKING");
    expect(mapFortuneoAccountType({ kind: "savings" })).toBe("SAVINGS");
    expect(mapFortuneoAccountType({ kind: "trading", typeLabel: "PEA" })).toBe(
      "PEA",
    );
    expect(
      mapFortuneoAccountType({ kind: "trading", typeLabel: "Compte-titres" }),
    ).toBe("SECURITIES");
    expect(mapFortuneoAccountType({ kind: "loan" })).toBe("LOAN");
  });

  it("mappe transactions et positions Fortuneo", () => {
    expect(
      mapFortuneoTransaction(
        {
          id: "ftx-1",
          dedupKey: "fortuneo:fortuneo-checking-1:ftx-1",
          date: "2026-02-03",
          amount: -25.4,
          label: "Paiement carte",
        },
        "fortuneo-checking-1",
      ),
    ).toMatchObject({
      externalId: "ftx-1",
      date: "2026-02-03",
      amount: -25.4,
      label: "Paiement carte",
    });

    expect(
      mapFortuneoPosition(
        {
          label: "Air Liquide",
          code: "FR0000120073",
          codeType: "ISIN",
          stockSymbol: "AI",
          quantity: 10,
          unitPrice: 150,
          unitValue: 160,
          valuation: 1600,
          currency: "EUR",
          assetCategory: "action",
        },
        { currency: "EUR" },
      ),
    ).toMatchObject({
      isin: "FR0000120073",
      ticker: "AI",
      name: "Air Liquide",
      quantity: 10,
      costBasis: 1500,
      price: 160,
      value: 1600,
      assetClass: "EQUITY",
    });
  });

  it("importe comptes, transactions et positions puis archive Enable Banking", () => {
    const ebConnection = repository.createConnector(USER, {
      provider: PROVIDERS.ENABLE_BANKING,
      label: "Fortuneo",
      status: "active",
      aspspName: "Fortuneo",
      sessionId: "eb-session",
    });
    const ebAccount = repository.upsertSyncedAccount(USER, {
      provider: PROVIDERS.ENABLE_BANKING,
      externalId: "eb-fortuneo-1",
      connectionId: ebConnection.id,
      name: "Compte Fortuneo (DSP2)",
      type: "CHECKING",
      currency: "EUR",
      balance: 100,
    });
    const connection = repository.createConnector(USER, {
      provider: FORTUNEO_PROVIDER,
      label: "Fortuneo (Sidecar)",
      status: "active",
      aspspName: "Fortuneo",
    });

    const result = applyFortuneoExport({
      repository,
      userId: USER,
      connection,
      payload: fortuneoExport(),
    });

    expect(result.accountsSynced).toBe(2);
    expect(result.transactionsImported).toBe(1);
    expect(result.holdingsSynced).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.archivedAccounts).toBe(1);

    const accounts = repository.listAccounts(USER);
    expect(accounts).toHaveLength(2);
    const pea = accounts.find((entry: any) => entry.name === "PEA Fortuneo");
    expect(pea?.type).toBe("PEA");
    const holdings = repository.listHoldings(pea.id, USER);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      isin: "FR0000120073",
      ticker: "AI",
      quantity: 10,
      price: 160,
      costBasis: 1500,
    });

    const archived = repository.getAccount(ebAccount.id, USER);
    expect(archived.isArchived).toBe(true);
    expect(
      repository.getConnector(ebConnection.id, USER).metadata.sidecarLinked,
    ).toBe(true);
  });

  it("mémorise l'identifiant mais jamais le mot de passe", () => {
    saveFortuneoLogin(repository, USER, "mon-identifiant");
    expect(getFortuneoSavedCredentials(repository, USER)).toEqual({
      login: "mon-identifiant",
    });
    expect(getFortuneoStatus(repository, USER)).toMatchObject({
      configured: true,
      loginSaved: true,
      passwordRequired: true,
      otpSupported: true,
    });
    expect(getUserSecret(db, USER, "fortuneoPassword")).toBeNull();

    expect(deleteFortuneoCredentials(repository, USER)).toBe(true);
    expect(getFortuneoSavedCredentials(repository, USER)).toBeNull();
  });
});
