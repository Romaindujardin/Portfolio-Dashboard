// Tests des flux front bout-en-bout : modules de stockage (localStorage shimé)
// synchronisés avec le serveur API de test. Couvre tricount, épargne,
// paramètres utilisateur et la couche wallets (storage.ts → databaseService).
import "./shims";
import { describe, it, expect } from "vitest";
import { api, randomAddress, waitFor } from "./helpers";
import {
  addOrUpdateExpense,
  addOrUpdateIncome,
  getStoredExpenses,
  getExpensesForMonth,
  getIncomesForMonth,
  saveMonthlyConfig,
  getStoredConfigs,
  deleteExpense,
  deleteIncome,
  pushTricountToDatabase,
  fetchTricountFromDatabase,
  formatMonthLabel,
  getCurrentMonthKey,
  isPlacementPocket,
  calculateTricountBalance,
  calculateMonthlyBudgetSummary,
} from "../src/utils/tricountStorage";
import {
  getSavingsStrategy,
  saveSavingsStrategy,
  saveSavingsStrategyForMonth,
  getSavingsStrategyForMonth,
  hasCustomStrategyForMonth,
  getTotalMonthlyIncome,
  getIncomeByPerson,
  calculateHouseholdSummary,
  roundCents,
  snapZero,
  pushSavingsStrategyToDatabase,
  fetchSavingsStrategyFromDatabase,
  pushMonthlyStrategiesToDatabase,
  fetchMonthlyStrategiesFromDatabase,
} from "../src/utils/savingsStorage";
import {
  getUserSettings,
  saveUserSettings,
  getSetting,
  setSetting,
  pushUserSettingsToDatabase,
  fetchUserSettingsFromDatabase,
} from "../src/utils/userSettings";
import {
  addWallet,
  getStoredWallets,
  updateWallet,
  deleteWallet,
  updateWalletAssetVisibility,
  updateWalletNFTVisibility,
} from "../src/utils/storage";
import type { SavingsStrategy, Wallet } from "../src/types";

const USER = "TestStoreUser";

const buildExpense = (over: Record<string, unknown> = {}) => ({
  id: "store-exp-1",
  month: "2026-10",
  date: "2026-10-05",
  label: "Courses",
  amount: 42.5,
  payerPersonId: "person1",
  pocketId: "poc-2",
  pocketName: "Alimentation",
  splitMethod: "50_50",
  nature: "expense",
  source: "manual",
  ...over,
});

// Le localStorage est vidé avant chaque test : re-semer les données nécessaires.
const seedLocalTricount = () => {
  addOrUpdateExpense(buildExpense());
  addOrUpdateExpense(
    buildExpense({ id: "store-exp-2", month: "2026-11", label: "Novembre" }),
  );
  addOrUpdateIncome({
    id: "store-inc-1",
    month: "2026-10",
    date: "2026-10-01",
    label: "Salaire",
    amount: 2000,
    beneficiaryPersonId: "person1",
  });
  saveMonthlyConfig({
    month: "2026-10",
    p1Income: 2000,
    p2Income: 1000,
    isStrategyApplied: false,
  } as any);
};

describe("tricountStorage (local + synchronisation serveur)", () => {
  it("helpers : mois et poches", () => {
    expect(getCurrentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
    expect(formatMonthLabel("2026-10")).toBe("Octobre 2026");
    expect(isPlacementPocket(null)).toBe(false);
    expect(isPlacementPocket({ category: "fixed_expense" })).toBe(false);
    expect(isPlacementPocket({ category: "leisure" })).toBe(true);
    expect(isPlacementPocket({ pocketType: "placement" })).toBe(true);
    expect(isPlacementPocket({ pocketType: "expense" })).toBe(false);
  });

  it("stocke et relit dépenses/revenus, avec filtres par mois", () => {
    seedLocalTricount();
    expect(getStoredExpenses()).toHaveLength(2);
    expect(getExpensesForMonth("2026-10")).toHaveLength(1);
    expect(getExpensesForMonth("2026-10")[0].label).toBe("Courses");
    expect(getIncomesForMonth("2026-10")).toHaveLength(1);
    expect(getStoredConfigs()["2026-10"].p1Income).toBe(2000);
  });

  it("synchronise vers le serveur puis relit", async () => {
    seedLocalTricount();
    expect(await pushTricountToDatabase(USER)).toBe(true);
    const server = await fetchTricountFromDatabase(USER);
    expect(server).toBeTruthy();
    const ids = server!.expenses.map((e: any) => e.id);
    expect(ids).toContain("store-exp-1");
    expect(ids).toContain("store-exp-2");
    expect(server!.incomes.some((i: any) => i.id === "store-inc-1")).toBe(true);
    expect(server!.configs["2026-10"]).toBeTruthy();
  });

  it("supprime localement et sur le serveur", async () => {
    seedLocalTricount();
    expect(await pushTricountToDatabase(USER)).toBe(true);

    deleteExpense("store-exp-1", USER);
    expect(getStoredExpenses().some((e) => e.id === "store-exp-1")).toBe(false);
    const expenseGone = await waitFor(async () => {
      const server = await fetchTricountFromDatabase(USER);
      return !server?.expenses.some((e: any) => e.id === "store-exp-1");
    });
    expect(expenseGone).toBe(true);

    deleteIncome("store-inc-1", USER);
    const incomeGone = await waitFor(async () => {
      const server = await fetchTricountFromDatabase(USER);
      return !server?.incomes.some((i: any) => i.id === "store-inc-1");
    });
    expect(incomeGone).toBe(true);
  });
});

describe("savingsStorage (calculs foyer + synchronisation)", () => {
  const customStrategy = {
    household: {
      enabled: true,
      splitMode: "proportional",
      person1: { id: "person1", name: "Romain", color: "#3b82f6" },
      person2: { id: "person2", name: "Sophie", color: "#10b981" },
    },
    incomes: [
      {
        id: "si-1",
        name: "Salaire 1",
        amount: 3000,
        frequency: "monthly",
        personId: "person1",
      },
      {
        id: "si-2",
        name: "Prime annuelle",
        amount: 12000,
        frequency: "yearly",
        personId: "person2",
      },
    ],
    pockets: [],
  } as unknown as SavingsStrategy;

  it("revenus mensuels (mensuel + annuel ramené au mois)", () => {
    expect(getTotalMonthlyIncome(customStrategy.incomes)).toBe(4000);
    expect(getIncomeByPerson(customStrategy.incomes, "person1")).toBe(3000);
    expect(getIncomeByPerson(customStrategy.incomes, "person2")).toBe(1000);
    expect(getIncomeByPerson(customStrategy.incomes, "shared")).toBe(0);
  });

  it("arrondis monétaires", () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(snapZero(0.001)).toBe(0);
    expect(snapZero(-0.003)).toBe(0);
    expect(snapZero(12.5)).toBe(12.5);
  });

  it("répartition proportionnelle du foyer (75/25)", () => {
    const summary = calculateHouseholdSummary(customStrategy);
    expect(summary.enabled).toBe(true);
    expect(summary.totalMonthlyIncome).toBe(4000);
    expect(summary.splitRatioP1).toBeCloseTo(0.75, 5);
    expect(summary.splitRatioP2).toBeCloseTo(0.25, 5);
    expect(summary.p1.monthlyIncome).toBe(3000);
    expect(summary.p2.monthlyIncome).toBe(1000);
    expect(summary.totalAllocatedEur).toBe(0);
    expect(summary.totalRemainingEur).toBe(4000);
  });

  it("mode 50/50 puis foyer désactivé (solo)", () => {
    const fifty = calculateHouseholdSummary({
      ...customStrategy,
      household: { ...customStrategy.household, splitMode: "50_50" },
    } as SavingsStrategy);
    expect(fifty.splitRatioP1).toBe(0.5);
    expect(fifty.splitRatioP2).toBe(0.5);

    const solo = calculateHouseholdSummary({
      ...customStrategy,
      household: { ...customStrategy.household, enabled: false },
    } as SavingsStrategy);
    expect(solo.enabled).toBe(false);
    expect(solo.totalMonthlyIncome).toBe(3000);
    expect(solo.p2.monthlyIncome).toBe(0);
  });

  it("stratégies mensuelles : personnalisation + héritage du mois précédent", () => {
    saveSavingsStrategyForMonth("2026-10", customStrategy, USER);
    expect(hasCustomStrategyForMonth("2026-10")).toBe(true);
    expect(hasCustomStrategyForMonth("2026-12")).toBe(false);

    const october = getSavingsStrategyForMonth("2026-10", USER);
    expect(october.incomes[0].amount).toBe(3000);

    const inherited = getSavingsStrategyForMonth("2026-11", USER);
    expect(inherited.incomes).toHaveLength(2);
    expect(inherited.incomes[0].amount).toBe(3000);
  });

  it("repli sur la stratégie générale", () => {
    saveSavingsStrategy(USER, customStrategy);
    const strategy = getSavingsStrategy(USER);
    expect(strategy.incomes[0].amount).toBe(3000);
  });

  it("synchronise stratégie + mensuels vers le serveur", async () => {
    saveSavingsStrategyForMonth("2026-10", customStrategy, USER);
    expect(await pushSavingsStrategyToDatabase(USER)).toBe(true);
    const dbStrategy = await fetchSavingsStrategyFromDatabase(USER);
    expect(dbStrategy?.incomes?.[0]?.amount).toBe(3000);

    expect(await pushMonthlyStrategiesToDatabase(USER)).toBe(true);
    const monthly = await fetchMonthlyStrategiesFromDatabase(USER);
    expect(monthly?.["2026-10"]).toBeTruthy();
    expect(monthly?.["2026-10"].incomes[0].amount).toBe(3000);
  });
});

describe("userSettings (défauts EUR + synchronisation)", () => {
  it("valeurs par défaut : EUR, fr, thème auto, accent blue", () => {
    const settings = getUserSettings(USER);
    expect(settings.currency).toBe("EUR");
    expect(settings.language).toBe("fr");
    expect(settings.theme).toBe("auto");
    expect(settings.accentColor).toBe("blue");
  });

  it("sauvegarde locale + serveur, puis relit depuis le serveur", async () => {
    const settings = getUserSettings(USER);
    settings.currency = "USD";
    settings.theme = "dark";
    settings.geminiApiKey = "cle-de-test";
    saveUserSettings(USER, settings);
    expect(getUserSettings(USER).currency).toBe("USD");

    expect(await pushUserSettingsToDatabase(USER)).toBe(true);
    const fromDb = await fetchUserSettingsFromDatabase(USER);
    expect(fromDb?.currency).toBe("USD");
    expect(fromDb?.theme).toBe("dark");
    expect(fromDb?.geminiApiKey).toBe("cle-de-test");
  });

  it("getSetting / setSetting", () => {
    setSetting(USER, "currency", "GBP");
    expect(getSetting(USER, "currency")).toBe("GBP");
  });
});

describe("storage wallets (mapping API + visibilités)", () => {
  const buildWallet = (over: Partial<Wallet> = {}): Wallet =>
    ({
      id: "",
      name: "Portefeuille Test",
      address: randomAddress(),
      walletType: "metamask",
      blockchains: ["ethereum"],
      assets: [
        {
          symbol: "ETH",
          name: "Ethereum",
          balance: 1.25,
          decimals: 18,
          blockchain: "ethereum",
          price: 2000,
          value: 2500,
        },
      ],
      nfts: [],
      totalValue: 2500,
      lastUpdated: new Date().toISOString(),
      addedAt: new Date().toISOString(),
      ...over,
    }) as unknown as Wallet;

  it("ajoute puis relit un wallet (assets inclus)", async () => {
    await addWallet(buildWallet(), USER);
    const wallets = await getStoredWallets(USER);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].name).toBe("Portefeuille Test");
    expect(wallets[0].walletType).toBe("metamask");
    expect(wallets[0].blockchains).toEqual(["ethereum"]);
    expect(wallets[0].assets).toHaveLength(1);
    expect(wallets[0].assets[0].symbol).toBe("ETH");
    expect(wallets[0].assets[0].balance).toBe(1.25);
    expect(wallets[0].nfts).toEqual([]);
  });

  it("met à jour le wallet", async () => {
    const [wallet] = await getStoredWallets(USER);
    await updateWallet(
      { ...wallet, name: "Portefeuille Renommé", totalValue: 999 },
      USER,
    );
    const [updated] = await getStoredWallets(USER);
    expect(updated.name).toBe("Portefeuille Renommé");
    expect(updated.totalValue).toBe(999);
  });

  it("met à jour la visibilité d'un asset", async () => {
    const [wallet] = await getStoredWallets(USER);
    await updateWalletAssetVisibility(wallet.id, 0, true, USER);
    const [updated] = await getStoredWallets(USER);
    expect(Boolean(updated.assets[0].isHidden)).toBe(true);
  });

  it("gère la visibilité d'un NFT (via l'API puis mapping)", async () => {
    const res = await api("/database/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: USER,
        name: "Wallet NFT",
        address: randomAddress("0xnft"),
        wallet_type: "metamask",
        blockchains: JSON.stringify(["ethereum"]),
        total_value: 5,
        assets: [],
        nfts: [
          {
            token_id: "777",
            name: "NFT Stocké",
            collection: "Coll",
            symbol: "NFTX",
            blockchain: "ethereum",
            contract_address: "0xabc",
            price: 1,
            value: 5,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const wallets = await getStoredWallets(USER);
    const nftWallet = wallets.find((w) => w.name === "Wallet NFT");
    expect(nftWallet).toBeTruthy();
    expect(nftWallet!.nfts).toHaveLength(1);
    expect(nftWallet!.nfts[0].tokenId).toBe("777");
    expect((nftWallet!.nfts[0].nftData as any)?.collection).toBe("Coll");

    await updateWalletNFTVisibility(nftWallet!.id, 0, true);
    const raw = (await (await api(`/database/wallets?user_id=${USER}`)).json()) as any[];
    const rawWallet = raw.find((w) => w.name === "Wallet NFT");
    expect(Boolean(rawWallet.nfts[0].is_hidden)).toBe(true);
  });

  it("parse les blockchains multi-encodées (régression)", async () => {
    const doublyEncoded = JSON.stringify(JSON.stringify(["ethereum", "polygon"]));
    const res = await api("/database/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: USER,
        name: "Wallet Multi-Encodé",
        address: randomAddress("0xmulti"),
        wallet_type: "metamask",
        blockchains: doublyEncoded,
        total_value: 0,
        assets: [],
        nfts: [],
      }),
    });
    expect(res.status).toBe(200);

    const wallets = await getStoredWallets(USER);
    const multi = wallets.find((w) => w.name === "Wallet Multi-Encodé");
    expect(multi).toBeTruthy();
    expect(multi!.blockchains).toEqual(["ethereum", "polygon"]);
  });

  it("supprime tous les wallets de test", async () => {
    const wallets = await getStoredWallets(USER);
    expect(wallets.length).toBeGreaterThanOrEqual(3);
    for (const wallet of wallets) {
      await deleteWallet(wallet.id, USER);
    }
    expect(await getStoredWallets(USER)).toHaveLength(0);
  });
});

describe("calculs de budget tricount (fonctions pures)", () => {
  it("calculateTricountBalance : mode solo", () => {
    const expenses = [
      { id: "b1", amount: 100, payerPersonId: "person1", splitMethod: "50_50" },
      { id: "b2", amount: 20, payerPersonId: "person2", splitMethod: "50_50" },
    ] as any;

    const summary = calculateTricountBalance(expenses, 0, 0, {
      enabled: false,
    } as any);
    expect(summary.totalSpent).toBe(120);
    expect(summary.totalP1Paid).toBe(120);
    expect(summary.totalP2Paid).toBe(0);
    expect(summary.p1ShouldPay).toBe(120);
    expect(summary.p2ShouldPay).toBe(0);
    expect(summary.debtor).toBe("none");
    expect(summary.transferAmount).toBe(0);
  });

  it("calculateTricountBalance : couple en répartition proportionnelle (75/25)", () => {
    const expenses = [
      { id: "b1", amount: 100, payerPersonId: "person1", splitMethod: "50_50" },
      {
        id: "b2",
        amount: 60,
        payerPersonId: "person2",
        splitMethod: "proportional",
      },
    ] as any;

    const summary = calculateTricountBalance(expenses, 3000, 1000, {
      enabled: true,
    } as any);
    expect(summary.totalSpent).toBe(160);
    expect(summary.totalP1Paid).toBe(100);
    expect(summary.totalP2Paid).toBe(60);
    expect(summary.p1ShouldPay).toBeCloseTo(95, 2); // 50 + 60 × 3/4
    expect(summary.p2ShouldPay).toBeCloseTo(65, 2); // 50 + 60 × 1/4
    expect(summary.sharedExpensesCount).toBe(2);
    expect(summary.debtor).toBe("person2");
    expect(summary.creditor).toBe("person1");
    expect(summary.transferAmount).toBe(5); // Person 1 a payé 5 € de trop
  });

  it("calculateMonthlyBudgetSummary : revenus réels (partagés) + dépenses non classées", () => {
    addOrUpdateExpense(
      buildExpense({ id: "bud-1", amount: 100, pocketId: "poc-x" }),
    );
    addOrUpdateExpense(
      buildExpense({
        id: "bud-2",
        amount: 30,
        pocketId: undefined,
        pocketName: undefined,
      }),
    );
    addOrUpdateIncome({
      id: "bud-i1",
      month: "2026-10",
      date: "2026-10-01",
      label: "Salaire",
      amount: 2000,
      beneficiaryPersonId: "person1",
    } as any);
    addOrUpdateIncome({
      id: "bud-i2",
      month: "2026-10",
      date: "2026-10-01",
      label: "Prime partagée",
      amount: 500,
      beneficiaryPersonId: "shared",
    } as any);

    const strategy = {
      household: { enabled: true, splitMode: "proportional" },
      incomes: [
        {
          id: "pi1",
          name: "Salaire",
          amount: 2000,
          frequency: "monthly",
          personId: "person1",
        },
        {
          id: "pi2",
          name: "Prime",
          amount: 500,
          frequency: "monthly",
          personId: "person2",
        },
      ],
      pockets: [],
    } as any;

    const summary = calculateMonthlyBudgetSummary("2026-10", strategy);
    expect(summary.month).toBe("2026-10");
    expect(summary.incomesCount).toBe(2);
    expect(summary.p1Income).toBe(2250); // 2000 + moitié de la prime partagée
    expect(summary.p2Income).toBe(250);
    expect(summary.totalIncome).toBe(2500);
    expect(summary.totalExpenses).toBe(130);

    const unallocated = summary.expenseComparisons.find(
      (c: any) => c.pocketId === "unallocated",
    );
    expect(unallocated).toBeTruthy();
    expect(unallocated.realSpent).toBe(130);
  });
});
