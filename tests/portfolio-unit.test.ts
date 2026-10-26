// Tests unitaires de la couche patrimoine (phase 1/2) : JWT Enable Banking,
// normalisation des comptes et transactions, amortissement des prêts, parts de
// propriété, corrections immobilières et résolution de tickers. Aucun appel
// réseau n'est effectué.
import "./shims";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";

import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";

import {
  buildInstitutionId,
  createJwt,
  detectAccountType,
  extractSessionAccounts,
  externalIdForAccount,
  mapInstitutions,
  parseInstitutionId,
  pickBalance,
  resolvePsuType,
} from "../server/connectors/enableBanking.js";
import {
  addMonths,
  buildAmortizationSchedule,
  computeMonthlyPayment,
  monthsBetween,
  parseDate,
  LoanError,
} from "../server/services/loans.js";
import {
  distributeValue,
  normalizeShares,
  OwnershipError,
} from "../server/services/ownership.js";
import {
  applyPropertyAdjustments,
  applyTransformToBound,
  computeReindexRatio,
  confidenceFor,
  departmentCode,
  isCoveredDepartment,
} from "../server/services/realEstate.js";
import {
  isIsin,
  normalizeTicker,
  pickFigiCandidates,
  MarketDataError,
} from "../server/services/marketData.js";
import {
  computeWindowStart,
  mapEnableBankingTransaction,
  selectNewTransactions,
  transactionDedupKey,
  transactionFingerprint,
} from "../server/services/transactions.js";
import {
  decryptJson,
  encryptJson,
  isEncryptionAvailable,
  maskSecret,
} from "../server/lib/secrets.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("Chiffrement des secrets", () => {
  it("chiffre en AES-256-GCM et déchiffre sans exposer le clair", () => {
    expect(isEncryptionAvailable()).toBe(true);
    const plaintext = {
      applicationId: "app-123",
      privateKey: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    };
    const encrypted = encryptJson(plaintext);
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain("BEGIN PRIVATE KEY");
    expect(encrypted).not.toContain("app-123");
    expect(decryptJson(encrypted)).toEqual(plaintext);
    expect(() => decryptJson("v1:invalide")).toThrow(/incomplet/i);
    expect(() => decryptJson("non-chiffré")).toThrow(/format/i);
  });

  it("masque les valeurs sensibles", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("abc")).toBe("•••");
    expect(maskSecret("abcdefghij")).toMatch(/^•{6}ghij$/);
  });
});

describe("Enable Banking — JWT RS256", () => {
  it("signe un JWT vérifiable avec les bonnes claims", () => {
    const now = 1_760_000_000;
    const token = createJwt({
      applicationId: "app-id",
      privateKey,
      now,
      ttlSeconds: 3600,
    });
    const [encodedHeader, encodedPayload, signature] = token.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString());
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());

    expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: "app-id" });
    expect(payload).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now,
      exp: now + 3600,
    });
    expect(
      crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("borne la durée de vie et refuse une clé absente", () => {
    const token = createJwt({
      applicationId: "app",
      privateKey,
      now: 1000,
      ttlSeconds: 999_999,
    });
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    expect(payload.exp - payload.iat).toBe(86_400);

    expect(() =>
      createJwt({ applicationId: "app", privateKey: "" }),
    ).toThrow(/incomplète/i);
  });
});

describe("Enable Banking — catalogue et comptes", () => {
  it("construit et relit un identifiant composite", () => {
    const id = buildInstitutionId("BNP Paribas", "FR", "personal");
    expect(id).toBe("BNP Paribas::FR::personal");
    expect(parseInstitutionId(id)).toEqual({
      name: "BNP Paribas",
      country: "FR",
      psuType: "personal",
    });
    expect(parseInstitutionId("Banque Populaire")).toEqual({
      name: "Banque Populaire",
      country: "FR",
      psuType: "personal",
    });
    expect(() => parseInstitutionId("")).toThrow(/invalide/i);
  });

  it("préfère personal et déduplique le catalogue", () => {
    expect(resolvePsuType([])).toBe("personal");
    expect(resolvePsuType(["business"])).toBe("business");
    expect(resolvePsuType(["wealth", "personal", "business"])).toBe("personal");

    const institutions = mapInstitutions(
      [
        {
          name: "BNP Paribas",
          country: "FR",
          psu_types: ["personal"],
          bic: "BNPAFRPP",
          logo: "https://example.test/bnp.png",
          beta: false,
        },
        {
          name: "BNP Paribas",
          country: "FR",
          psu_types: ["personal"],
        },
        {
          name: "Banque de test",
          country: "FR",
          psu_types: ["business"],
          beta: true,
        },
      ],
      "",
      "FR",
    );
    expect(institutions).toHaveLength(2);
    expect(institutions[0]).toMatchObject({
      id: "BNP Paribas::FR::personal",
      name: "BNP Paribas",
      bic: "BNPAFRPP",
      psuType: "personal",
    });
    expect(institutions[1].psuType).toBe("business");
    expect(mapInstitutions(institutions, "bnp")).toHaveLength(1);
  });

  it("choisit le solde le plus pertinent", () => {
    expect(pickBalance([])).toBeNull();
    expect(
      pickBalance([
        { balance_type: "PRCD", balance_amount: { amount: "120", currency: "EUR" } },
        { balance_type: "CLAV", balance_amount: { amount: "150.5", currency: "EUR" } },
        { balance_type: "CLBD", balance_amount: { amount: "140", currency: "EUR" } },
      ]),
    ).toEqual({ amount: 150.5, currency: "EUR", type: "CLAV" });
    expect(pickBalance([{ balance_type: "X", balance_amount: { amount: "n/a" } }])).toBeNull();
  });

  it("extrait les comptes des deux formes de session", () => {
    const fromObjects = extractSessionAccounts({
      accounts: [
        { uid: "uid-1", identification_hash: "hash-1" },
        { uid: "uid-2" },
      ],
      accounts_data: [{ uid: "uid-2", identification_hash: "hash-2" }],
    });
    expect(fromObjects.map((item) => [item.uid, item.identificationHash])).toEqual([
      ["uid-1", "hash-1"],
      ["uid-2", "hash-2"],
    ]);

    const fromStrings = extractSessionAccounts({
      accounts: ["uid-3", "uid-4"],
      accounts_data: [{ uid: "uid-4", identification_hash: "hash-4" }],
    });
    expect(fromStrings.map((item) => [item.uid, item.identificationHash])).toEqual([
      ["uid-3", null],
      ["uid-4", "hash-4"],
    ]);
  });

  it("détecte les enveloppes à partir des métadonnées PSD2", () => {
    expect(detectAccountType({ name: "PEA BoursoBank" })).toBe("PEA");
    expect(detectAccountType({ product: "Compte-titres ordinaire" })).toBe("SECURITIES");
    expect(detectAccountType({ name: "Épargne salariale PEE" })).toBe("EMPLOYEE_SAVINGS");
    expect(detectAccountType({ name: "Livret A" })).toBe("SAVINGS");
    expect(detectAccountType({ cash_account_type: "SVGS" })).toBe("SAVINGS");
    expect(detectAccountType({ cash_account_type: "LOAN" })).toBe("LOAN");
    expect(detectAccountType({ cash_account_type: "CACC" })).toBe("CHECKING");
    expect(detectAccountType({})).toBe("CHECKING");
  });

  it("privilégie identification_hash puis IBAN puis uid", () => {
    expect(externalIdForAccount({ identification_hash: "abc" }, "uid")).toBe("abc");
    const fromIban = externalIdForAccount({ account_id: { iban: "FR761234" } }, "uid");
    expect(fromIban).toMatch(/^iban:[a-f0-9]{24}$/);
    expect(externalIdForAccount({}, "uid-9")).toBe("uid:uid-9");
  });
});

describe("Comptes synchronisés — réactivation", () => {
  it("réactive un compte archivé lors d'une reconnexion", () => {
    const db = new Database(":memory:");
    initializePortfolioSchema(db);
    const repository = new PortfolioRepository(db);

    const first = repository.upsertSyncedAccount("u1", {
      provider: "enable-banking",
      externalId: "hash-1",
      connectionId: "conn-1",
      name: "Compte courant",
      type: "CHECKING",
      currency: "EUR",
      balance: 100,
      isManual: false,
    });
    expect(first.isArchived).toBe(false);

    repository.archiveAccountsByConnection("conn-1", "u1");
    expect(repository.getAccount(first.id, "u1").isArchived).toBe(true);

    const second = repository.upsertSyncedAccount("u1", {
      provider: "enable-banking",
      externalId: "hash-1",
      connectionId: "conn-2",
      name: "Compte courant",
      type: "CHECKING",
      currency: "EUR",
      balance: 250,
      isManual: false,
    });

    expect(second.id).toBe(first.id);
    expect(second.isArchived).toBe(false);
    expect(second.connectionId).toBe("conn-2");
    expect(second.balance).toBe(250);
    db.close();
  });
});

describe("Transactions — fenêtre, dédoublonnage et mapping", () => {
  it("calcule la fenêtre initiale et incrémentale", () => {
    const today = new Date("2026-10-26T12:00:00Z");
    expect(computeWindowStart(null, today)).toBe("2026-07-28");
    expect(computeWindowStart("2026-10-20", today)).toBe("2026-10-13");
    expect(computeWindowStart("2027-01-01", today)).toBe("2026-07-28");
    expect(computeWindowStart("invalide", today)).toBe("2026-07-28");
  });

  it("produit une empreinte stable et priorise l'identifiant fournisseur", () => {
    expect(transactionFingerprint("2026-01-01", 12.5, "Café")).toBe(
      transactionFingerprint("2026-01-01", "12.50", " Café "),
    );
    expect(transactionFingerprint("2026-01-01", 12.5, "Café")).not.toBe(
      transactionFingerprint("2026-01-01", 12.6, "Café"),
    );
    expect(
      transactionDedupKey({ externalId: "entry-1", date: "2026-01-01", amount: 1, label: "X" }),
    ).toBe("entry-1");
    expect(
      transactionDedupKey({ date: "2026-01-01", amount: 1, label: "X" }),
    ).toMatch(/^fp:/);
  });

  it("mappe une écriture comptabilisée et ignore les écritures pendantes", () => {
    const mapped = mapEnableBankingTransaction({
      status: "BOOK",
      booking_date: "2026-10-01",
      value_date: "2026-10-02",
      transaction_amount: { amount: "42,50", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      entry_reference: "ref-42",
      remittance_information: ["CB ", "Boulangerie"],
      creditor: { name: "Boulangerie" },
      bank_transaction_code: { description: "Carte" },
    });
    expect(mapped).toMatchObject({
      externalId: "ref-42",
      date: "2026-10-01",
      valueDate: "2026-10-02",
      amount: -42.5,
      currency: "EUR",
      label: "CB Boulangerie",
      counterparty: "Boulangerie",
      category: "Carte",
      pending: false,
    });
    expect(mapped.dedupKey).toBe("ref-42");

    expect(mapEnableBankingTransaction({ status: "PDNG" })).toBeNull();
    expect(
      mapEnableBankingTransaction({
        status: "BOOK",
        transaction_amount: { amount: 10 },
      }),
    ).toBeNull();

    const credit = mapEnableBankingTransaction({
      booking_date: "2026-10-03",
      transaction_amount: { amount: 100 },
      credit_debit_indicator: "CRDT",
    });
    expect(credit.amount).toBe(100);
    expect(credit.label).toBe("Transaction");
  });

  it("filtre les clés connues et les doublons internes au lot", () => {
    const fetched = [
      { dedupKey: "a", label: "A" },
      { dedupKey: "a", label: "A bis" },
      { dedupKey: "b", label: "B" },
      { dedupKey: "c", label: "C" },
    ];
    expect(selectNewTransactions(new Set(["c"]), fetched).map((item) => item.dedupKey)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("Prêts — amortissement", () => {
  it("calcule la mensualité, y compris à taux zéro", () => {
    expect(computeMonthlyPayment(0, 3, 240)).toBe(0);
    expect(computeMonthlyPayment(1200, 0, 12)).toBe(100);
    expect(computeMonthlyPayment(200_000, 3.5, 240)).toBeCloseTo(1159.92, 2);
  });

  it("gère les fins de mois et les intervalles", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
    expect(monthsBetween(new Date("2026-01-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"))).toBe(
      11,
    );
    expect(parseDate("pas-une-date")).toBeNull();
  });

  it("construit un échéancier à taux zéro et calcule le capital restant", () => {
    const schedule = buildAmortizationSchedule(
      {
        principal: 12_000,
        annualRate: 0,
        startDate: "2026-01-01",
        termMonths: 12,
      },
      new Date("2026-01-15T00:00:00Z"),
    );
    expect(schedule.installments).toHaveLength(12);
    expect(schedule.installments[0]).toMatchObject({
      number: 1,
      date: "2026-01-01",
      capital: 1000,
      interest: 0,
      totalPayment: 1000,
      remainingBalance: 11_000,
    });
    expect(schedule.installments.at(-1)).toMatchObject({
      date: "2026-12-01",
      capital: 1000,
      remainingBalance: 0,
    });
    expect(schedule.summary).toMatchObject({
      monthlyPayment: 1000,
      totalInterest: 0,
      totalCost: 12_000,
      paidInstallments: 1,
      remainingInstallments: 11,
      remainingBalance: 11_000,
      endDate: "2026-12-01",
      nextPaymentDate: "2026-02-01",
    });
  });

  it("absorbe les arrondis sur la dernière échéance", () => {
    const schedule = buildAmortizationSchedule(
      {
        principal: 100_000,
        annualRate: 3,
        startDate: "2025-01-01",
        termMonths: 240,
        insuranceMonthly: 25,
      },
      new Date("2025-01-10T00:00:00Z"),
    );
    const capital = schedule.installments.reduce((sum, item) => sum + item.capital, 0);
    expect(capital).toBeCloseTo(100_000, 2);
    expect(schedule.installments.at(-1).remainingBalance).toBe(0);
    expect(schedule.summary.totalInterest).toBeGreaterThan(0);
    expect(schedule.summary.totalInsurance).toBe(240 * 25);
    expect(schedule.summary.monthlyPayment).toBeCloseTo(
      schedule.summary.basePayment + 25,
      2,
    );
  });

  it("traite la date de fin comme la dernière échéance incluse", () => {
    const schedule = buildAmortizationSchedule(
      {
        principal: 12_000,
        annualRate: 0,
        startDate: "2026-01-01",
        endDate: "2026-12-01",
      },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(schedule.installments).toHaveLength(12);
    expect(schedule.summary.endDate).toBe("2026-12-01");
    expect(() =>
      buildAmortizationSchedule({
        principal: 1000,
        startDate: "2026-12-01",
        endDate: "2026-01-01",
      }),
    ).toThrow(/postérieure/i);
  });

  it("rejette les prêts incomplets", () => {
    expect(() => buildAmortizationSchedule({ principal: 0, termMonths: 12 })).toThrow(LoanError);
    expect(() => buildAmortizationSchedule({ principal: 1000 })).toThrow(/date de début/i);
    expect(() =>
      buildAmortizationSchedule({
        principal: 1000,
        startDate: "2026-01-01",
        termMonths: 601,
      }),
    ).toThrow(/durée/i);
  });
});

describe("Parts de propriété", () => {
  it("normalise, agrège et valide les parts", () => {
    expect(
      normalizeShares([
        { ownerName: "Romain", sharePercent: 60 },
        { ownerName: "Camille", sharePercent: 40 },
      ]),
    ).toEqual([
      { ownerName: "Romain", sharePercent: 60 },
      { ownerName: "Camille", sharePercent: 40 },
    ]);
    expect(
      normalizeShares([
        { ownerName: "Romain", sharePercent: 30 },
        { ownerName: "Romain", sharePercent: 30 },
        { ownerName: "Camille", sharePercent: 0 },
      ]),
    ).toEqual([{ ownerName: "Romain", sharePercent: 60 }]);
  });

  it("rejette les parts invalides", () => {
    expect(() => normalizeShares(null)).toThrow(OwnershipError);
    expect(() => normalizeShares([{ ownerName: "", sharePercent: 50 }])).toThrow(/propriétaire/i);
    expect(() => normalizeShares([{ ownerName: "A", sharePercent: 101 }])).toThrow(/invalide/i);
    expect(() =>
      normalizeShares([
        { ownerName: "A", sharePercent: 60 },
        { ownerName: "B", sharePercent: 50 },
      ]),
    ).toThrow(/dépasser 100/i);
  });

  it("répartit la valeur et attribue le reliquat au propriétaire principal", () => {
    expect(
      distributeValue(1000, [{ ownerName: "A", sharePercent: 50 }], "A"),
    ).toEqual({ A: 1000 });
    expect(
      distributeValue(
        1000,
        [
          { ownerName: "A", sharePercent: 50 },
          { ownerName: "B", sharePercent: 30 },
        ],
        "A",
      ),
    ).toEqual({ A: 700, B: 300 });
    expect(distributeValue(-1000, [{ ownerName: "A", sharePercent: 60 }], "B")).toEqual({
      A: -600,
      B: -400,
    });
  });
});

describe("Immobilier — codes, confiance et corrections", () => {
  it("normalise les codes INSEE et la couverture DVF", () => {
    expect(departmentCode("75056")).toBe("75");
    expect(departmentCode("2A004")).toBe("2A");
    expect(departmentCode("97411")).toBe("974");
    expect(departmentCode("")).toBeNull();
    expect(isCoveredDepartment("75056")).toBe(true);
    expect(isCoveredDepartment("57000")).toBe(false);
    expect(isCoveredDepartment("67000")).toBe(false);
    expect(isCoveredDepartment("97600")).toBe(false);
  });

  it("grade la confiance selon la taille de l'échantillon", () => {
    expect(confidenceFor(5)).toBe("LOW");
    expect(confidenceFor(15)).toBe("MEDIUM");
    expect(confidenceFor(49)).toBe("MEDIUM");
    expect(confidenceFor(50)).toBe("HIGH");
    expect(confidenceFor(1000, true)).toBe("LOW");
  });

  it("applique les corrections déclarées et les équivalents surface", () => {
    const result = applyPropertyAdjustments(
      {
        propertyType: "APARTMENT",
        floorNumber: 0,
        hasGarden: true,
        hasTerrace: true,
        hasBalcony: true,
        bathrooms: 2,
        energyClass: "G",
        garageCount: 1,
        parkingCount: 1,
      },
      200_000,
      4000,
    );
    expect(result.multiplier).toBeCloseTo(0.985, 3);
    expect(result.addedAmount).toBe(76_000);
    expect(result.value).toBe(273_000);
    expect(result.adjustments.map((item) => item.code)).toEqual([
      "GROUND_FLOOR",
      "GARDEN",
      "TERRACE",
      "BALCONY",
      "EXTRA_BATHROOMS",
      "ENERGY_G",
      "GARAGE",
      "PARKING",
    ]);
    expect(result.adjustments.find((item) => item.code === "GARAGE")).toMatchObject({
      sqm: 12,
      amount: 48_000,
    });
  });

  it("n'applique jamais DPE et époque de construction ensemble", () => {
    const withEnergy = applyPropertyAdjustments(
      { propertyType: "HOUSE", energyClass: "C", constructionYear: 1900 },
      100_000,
      null,
    );
    expect(withEnergy.adjustments.map((item) => item.code)).toEqual(["ENERGY_C"]);
    const withEra = applyPropertyAdjustments(
      { propertyType: "HOUSE", constructionYear: 1900 },
      100_000,
      null,
    );
    expect(withEra.adjustments.map((item) => item.code)).toEqual(["ERA_PRE_1949"]);
  });

  it("ré-indexe entre le millésime DVF et le trimestre courant", () => {
    const series = new Map([
      [20244, 100],
      [20263, 110],
    ]);
    expect(
      computeReindexRatio(series, 2024, new Date("2026-08-15T00:00:00Z")),
    ).toBeCloseTo(1.1, 5);
    expect(computeReindexRatio(series, 2026, new Date("2026-08-15T00:00:00Z"))).toBe(1);
    expect(computeReindexRatio(null, 2024)).toBeNull();
    expect(computeReindexRatio(new Map(), 2024)).toBeNull();
    expect(applyTransformToBound(100_000, 1.1, 5000)).toBe(115_000);
    expect(applyTransformToBound(null, 1.1, 5000)).toBeNull();
  });
});

describe("Marché — validation et résolution", () => {
  it("valide les ISIN et normalise les tickers", () => {
    expect(isIsin("FR0000121014")).toBe(true);
    expect(isIsin("fr0000121014")).toBe(true);
    expect(isIsin("FR000012101")).toBe(false);
    expect(isIsin("pas-un-isin")).toBe(false);
    expect(normalizeTicker(" aapl ")).toBe("AAPL");
    expect(normalizeTicker("mc.pa")).toBe("MC.PA");
    expect(() => normalizeTicker("")).toThrow(MarketDataError);
    expect(() => normalizeTicker("ticker invalide")).toThrow(/invalide/i);
  });

  it("classe les candidats OpenFIGI par place et filtre les inconnus", () => {
    const candidates = pickFigiCandidates(
      [
        { ticker: "MC", exchCode: "US", name: "LVMH ADR" },
        { ticker: "MC", exchCode: "FP", name: "LVMH" },
        { ticker: "MC", exchCode: "NA", name: "LVMH Amsterdam" },
        { ticker: "MC", exchCode: "ZZ", name: "Inconnu" },
      ],
      "FR0000121014",
    );
    expect(candidates.map((item) => item.ticker)).toEqual(["MC.PA", "MC.AS", "MC"]);
    expect(candidates[0]).toMatchObject({
      rawTicker: "MC",
      exchange: "FP",
      rank: 0,
    });
    expect(
      pickFigiCandidates(
        [{ ticker: "AAPL", exchCode: "US", name: "Apple" }],
        "US0378331005",
      )[0],
    ).toMatchObject({ ticker: "AAPL", rank: 0 });
  });
});
