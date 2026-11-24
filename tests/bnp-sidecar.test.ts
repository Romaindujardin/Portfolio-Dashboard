import "./shims";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import { PROVIDERS } from "../server/connectors/types.js";
import {
  BNP_PROVIDER,
  applyBnpExport,
  deleteBnpCredentials,
  getBnpSavedCredentials,
  getBnpStatus,
  mapBnpAccountType,
  mapBnpTransaction,
  saveBnpCustomerId,
} from "../server/services/bnpSidecarService.js";
import { getUserSecret } from "../server/services/userSecretsService.js";

const USER = "TestBnpSidecar";

const bnpExport = () => ({
  schema: "bnp-sidecar/export/v1",
  source: "direct",
  status: "ok",
  accounts: [
    {
      uid: "checking-1",
      externalId: "bnp_checking-1",
      name: "Compte de chèques",
      product: "Compte courant",
      kind: "banking",
      currency: "EUR",
      balance: 1520.5,
      availableBalance: 1500,
      iban: "FR7630006000011234567890189",
      transactions: [
        {
          id: "tx-1",
          dedupKey: "bnp:checking-1:tx-1",
          bookingDate: "2026-02-01",
          valueDate: "2026-02-01",
          amount: -12.5,
          currency: "EUR",
          description: "CARTE &amp; CO",
        },
      ],
    },
    {
      uid: "savings-1",
      externalId: "bnp_savings-1",
      name: "Livret A",
      product: "Livret A",
      kind: "savings",
      currency: "EUR",
      balance: 4200,
      transactions: [
        {
          id: "tx-2",
          dedupKey: "bnp:savings-1:tx-2",
          bookingDate: "2026-01-15",
          amount: 200,
          currency: "EUR",
          description: "Virement épargne",
        },
      ],
    },
    {
      uid: "pea-1",
      externalId: "bnp_pea-1",
      name: "PEA BNP",
      product: "PEA",
      kind: "trading",
      currency: "EUR",
      balance: 12500,
      transactions: [],
    },
  ],
  errors: [],
});

describe("BNP Sidecar Service", () => {
  let db: any;
  let repository: any;

  beforeEach(() => {
    db = new Database(":memory:");
    initializePortfolioSchema(db);
    repository = new PortfolioRepository(db);
  });

  it("classe les comptes BNP courants, épargne et PEA", () => {
    expect(mapBnpAccountType({ kind: "banking" })).toBe("CHECKING");
    expect(mapBnpAccountType({ kind: "savings" })).toBe("SAVINGS");
    expect(mapBnpAccountType({ kind: "trading", name: "PEA" })).toBe("PEA");
    expect(mapBnpAccountType({ kind: "trading", name: "Compte-titres" })).toBe(
      "SECURITIES",
    );
    expect(mapBnpAccountType({ kind: "insurance" })).toBe("SECURITIES");
    expect(mapBnpAccountType({ kind: "loan" })).toBe("LOAN");
  });

  it("mappe une transaction BNP avec dédoublonnage et décodage HTML", () => {
    const transaction = mapBnpTransaction(
      {
        id: "tx-1",
        dedupKey: "bnp:checking-1:tx-1",
        bookingDate: "2026-02-01",
        amount: -12.5,
        description: "CARTE &amp; CO",
      },
      "checking-1",
    );
    expect(transaction).toMatchObject({
      externalId: "tx-1",
      dedupKey: "bnp:checking-1:tx-1",
      date: "2026-02-01",
      amount: -12.5,
      label: "CARTE & CO",
    });
  });

  it("importe tous les comptes et transactions puis archive Enable Banking", () => {
    const ebConnection = repository.createConnector(USER, {
      provider: PROVIDERS.ENABLE_BANKING,
      label: "BNP Paribas",
      status: "active",
      aspspName: "BNP Paribas",
      sessionId: "eb-session",
    });
    const ebAccount = repository.upsertSyncedAccount(USER, {
      provider: PROVIDERS.ENABLE_BANKING,
      externalId: "eb-checking-1",
      connectionId: ebConnection.id,
      name: "Compte BNP (DSP2)",
      type: "CHECKING",
      currency: "EUR",
      balance: 100,
    });
    const connection = repository.createConnector(USER, {
      provider: BNP_PROVIDER,
      label: "BNP Paribas (Sidecar)",
      status: "active",
      aspspName: "BNP Paribas",
    });

    const result = applyBnpExport({
      repository,
      userId: USER,
      connection,
      payload: bnpExport(),
    });

    expect(result.accountsSynced).toBe(3);
    expect(result.transactionsImported).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.archivedAccounts).toBe(1);

    const accounts = repository.listAccounts(USER);
    expect(accounts).toHaveLength(3);
    const checking = accounts.find((entry: any) => entry.name === "Compte de chèques");
    const savings = accounts.find((entry: any) => entry.name === "Livret A");
    const pea = accounts.find((entry: any) => entry.name === "PEA BNP");
    expect(checking?.type).toBe("CHECKING");
    expect(savings?.type).toBe("SAVINGS");
    expect(pea?.type).toBe("PEA");
    expect(repository.listTransactions(checking.id, USER)).toHaveLength(1);
    expect(repository.listTransactions(savings.id, USER)).toHaveLength(1);

    const archived = repository.getAccount(ebAccount.id, USER);
    expect(archived.isArchived).toBe(true);
    const linked = repository.getConnector(ebConnection.id, USER);
    expect(linked.metadata.sidecarLinked).toBe(true);
    expect(linked.metadata.sidecarProvider).toBe(BNP_PROVIDER);
  });

  it("mémorise le numéro client mais jamais le code secret", () => {
    saveBnpCustomerId(repository, USER, "12345678");
    expect(getBnpSavedCredentials(repository, USER)).toEqual({
      customerId: "12345678",
    });
    expect(getBnpStatus(repository, USER)).toMatchObject({
      configured: true,
      customerIdSaved: true,
      passwordRequired: true,
      mfa: "file-broker",
    });
    expect(getUserSecret(db, USER, "bnpPassword")).toBeNull();

    expect(deleteBnpCredentials(repository, USER)).toBe(true);
    expect(getBnpSavedCredentials(repository, USER)).toBeNull();
  });

  it("refuse un numéro client BNP invalide", () => {
    expect(() => saveBnpCustomerId(repository, USER, "123")).toThrow(
      /7 à 10 chiffres/,
    );
    expect(getBnpSavedCredentials(repository, USER)).toBeNull();
  });
});
