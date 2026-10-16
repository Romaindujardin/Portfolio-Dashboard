import {
  TricountExpense,
  TricountIncome,
  TricountBeneficiary,
  TricountSplitMethod,
  TricountPayer,
  TricountOperationNature,
  MonthlyTricountConfig,
  TricountBalanceSummary,
  MonthlyPocketComparison,
  MonthlyBudgetSummary,
  SavingsStrategy,
  HouseholdConfig,
  PocketCategory,
} from "../types";
import {
  getPocketMonthlyAmount,
  getTotalMonthlyIncome,
  calculateHouseholdSummary,
} from "./savingsStorage";

export type {
  TricountExpense,
  TricountIncome,
  TricountBeneficiary,
  TricountSplitMethod,
  TricountPayer,
  TricountOperationNature,
  MonthlyTricountConfig,
  TricountBalanceSummary,
  MonthlyPocketComparison,
  MonthlyBudgetSummary,
};

export const isPlacementPocket = (
  pocket?: {
    category?: PocketCategory | "other";
    pocketType?: "expense" | "placement";
  } | null,
): boolean => {
  if (!pocket) return false;
  if (pocket.pocketType === "expense") return false;
  if (pocket.pocketType === "placement") return true;
  // Sont considérées comme Dépenses Fixes (Section 2) EXCLUSIVEMENT les poches catégorisées "fixed_expense".
  // Toutes les autres catégories (leisure / plaisir perso, voyage, projets, épargne, PEA...) relèvent de la Section 3.
  return pocket.category !== "fixed_expense";
};

const STORAGE_KEY_EXPENSES = "portfolio_tricount_expenses";
const STORAGE_KEY_INCOMES = "portfolio_tricount_incomes";
const STORAGE_KEY_CONFIGS = "portfolio_tricount_monthly_configs";
const API_BASE = "http://localhost:3001/api/database/tricount";

export const fetchTricountFromDatabase = async (userId: string = "Romain") => {
  try {
    const res = await fetch(
      `${API_BASE}/data?user_id=${encodeURIComponent(userId)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data as {
      expenses: TricountExpense[];
      incomes: TricountIncome[];
      configs: Record<string, MonthlyTricountConfig>;
    };
  } catch (e) {
    console.warn("Could not fetch tricount data from server:", e);
    return null;
  }
};

export const pushTricountToDatabase = async (userId: string = "Romain") => {
  try {
    const expenses = getStoredExpenses();
    const incomes = getStoredIncomes();
    const configs = getStoredConfigs();
    const res = await fetch(`${API_BASE}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expenses, incomes, configs, userId }),
    });
    return res.ok;
  } catch (e) {
    console.warn("Could not push tricount data to server:", e);
    return false;
  }
};

export const syncTricountWithDatabase = async (userId: string = "Romain") => {
  try {
    const serverData = await fetchTricountFromDatabase(userId);
    const localExpenses = getStoredExpenses();
    const localIncomes = getStoredIncomes();
    const localConfigs = getStoredConfigs();

    // Si le client a des données locales, on les envoie toujours vers le serveur pour les sauvegarder
    if (localExpenses.length > 0 || localIncomes.length > 0) {
      pushTricountToDatabase(userId);
    }

    if (!serverData) return;

    const serverExpenses = serverData.expenses || [];
    const serverIncomes = serverData.incomes || [];

    let changed = false;

    // Si le local est vide mais que le serveur a des données, restaurer depuis le serveur
    if (localExpenses.length === 0 && serverExpenses.length > 0) {
      localStorage.setItem(
        STORAGE_KEY_EXPENSES,
        JSON.stringify(serverExpenses),
      );
      changed = true;
    } else if (localExpenses.length > 0 && serverExpenses.length > 0) {
      // Fusionner sans jamais écraser les dépenses locales existantes
      const existingIds = new Set(localExpenses.map((e) => e.id));
      const newFromServer = serverExpenses.filter((e) => !existingIds.has(e.id));
      if (newFromServer.length > 0) {
        const merged = [...localExpenses, ...newFromServer];
        localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(merged));
        changed = true;
      }
    }

    if (localIncomes.length === 0 && serverIncomes.length > 0) {
      localStorage.setItem(
        STORAGE_KEY_INCOMES,
        JSON.stringify(serverIncomes),
      );
      changed = true;
    } else if (localIncomes.length > 0 && serverIncomes.length > 0) {
      const existingIds = new Set(localIncomes.map((i) => i.id));
      const newFromServer = serverIncomes.filter((i) => !existingIds.has(i.id));
      if (newFromServer.length > 0) {
        const merged = [...localIncomes, ...newFromServer];
        localStorage.setItem(STORAGE_KEY_INCOMES, JSON.stringify(merged));
        changed = true;
      }
    }

    if (serverData.configs && Object.keys(serverData.configs).length > 0) {
      const mergedConfigs = { ...serverData.configs, ...localConfigs };
      localStorage.setItem(
        STORAGE_KEY_CONFIGS,
        JSON.stringify(mergedConfigs),
      );
      changed = true;
    }

    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new Event("tricount_data_updated"));
    }
  } catch (e) {
    console.error("Erreur lors de la synchronisation Tricount:", e);
  }
};



if (typeof window !== "undefined") {
  // Synchronisation initiale automatique avec la base de données
  setTimeout(() => {
    syncTricountWithDatabase();
  }, 50);
}

export const getCurrentMonthKey = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export const formatMonthLabel = (monthKey: string): string => {
  if (!monthKey || !monthKey.includes("-")) return monthKey;
  const [yearStr, monthStr] = monthKey.split("-");
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const date = new Date(year, monthIndex, 1);
  const formatted = date.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

export const getStoredExpenses = (): TricountExpense[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXPENSES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Nettoyer définitivement les transactions de test ou importées par erreur
      const cleaned = parsed.filter(
        (e) => !e.id || (!e.id.startsWith("exp-bank-") && e.id !== "exp-1" && e.id !== "exp-2")
      );
      if (cleaned.length !== parsed.length) {
        localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(cleaned));
      }
      return cleaned;
    }
  } catch (e) {
    console.error("Erreur lors de la lecture des dépenses Tricount:", e);
  }
  return [];
};

export const saveStoredExpenses = (expenses: TricountExpense[]): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(expenses));
    window.dispatchEvent(new Event("tricount_data_updated"));
    pushTricountToDatabase();
  } catch (e) {
    console.error("Erreur lors de la sauvegarde des dépenses Tricount:", e);
  }
};

export const getExpensesForMonth = (monthKey: string): TricountExpense[] => {
  const all = getStoredExpenses();
  return all
    .filter((e) => e.month === monthKey)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
};

export const addOrUpdateExpense = (expense: TricountExpense): void => {
  const all = getStoredExpenses();
  const existingIdx = all.findIndex((e) => e.id === expense.id);
  if (existingIdx >= 0) {
    all[existingIdx] = expense;
  } else {
    all.push(expense);
  }
  saveStoredExpenses(all);
};

export const deleteExpense = (id: string, userId: string = "Romain"): void => {
  const all = getStoredExpenses();
  const filtered = all.filter((e) => e.id !== id);
  saveStoredExpenses(filtered);
  try {
    fetch(`${API_BASE}/expenses/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }).catch(() => {});
  } catch {
    // ignore
  }
};

export const getStoredIncomes = (): TricountIncome[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INCOMES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error("Erreur lors de la lecture des revenus:", e);
  }
  return [];
};

export const saveStoredIncomes = (incomes: TricountIncome[]): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_INCOMES, JSON.stringify(incomes));
    window.dispatchEvent(new Event("tricount_data_updated"));
    pushTricountToDatabase();
  } catch (e) {
    console.error("Erreur lors de la sauvegarde des revenus:", e);
  }
};

export const getIncomesForMonth = (monthKey: string): TricountIncome[] => {
  const all = getStoredIncomes();
  return all
    .filter((i) => i.month === monthKey)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
};

export const addOrUpdateIncome = (income: TricountIncome): void => {
  const all = getStoredIncomes();
  const existingIdx = all.findIndex((i) => i.id === income.id);
  if (existingIdx >= 0) {
    all[existingIdx] = income;
  } else {
    all.push(income);
  }
  saveStoredIncomes(all);
};

export const deleteIncome = (id: string, userId: string = "Romain"): void => {
  const all = getStoredIncomes();
  const filtered = all.filter((i) => i.id !== id);
  saveStoredIncomes(filtered);
  try {
    fetch(`${API_BASE}/incomes/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }).catch(() => {});
  } catch {
    // ignore
  }
};

const isNumericIndexSuffix = (suffix: string): boolean => /^\d+$/.test(suffix);

/**
 * After a CSV row is deleted, index-based bankRowId values would otherwise
 * point to the next transaction. Shift or drop those bindings.
 */
export const rebindBankRowIdsAfterCsvRowDelete = (
  uploadId: string,
  deletedIndex: number,
  deletedReference?: string,
): void => {
  if (!uploadId || !Number.isFinite(deletedIndex)) return;
  const prefix = `${uploadId}:`;
  const deletedRef = (deletedReference || "").trim();

  const patch = <T extends { bankRowId?: string; bankReference?: string }>(
    items: T[],
  ): T[] => {
    let changed = false;
    const next = items.map((item) => {
      let bankRowId = item.bankRowId;
      let nextItem = item;

      if (deletedRef && item.bankReference === deletedRef && bankRowId) {
        changed = true;
        nextItem = { ...nextItem, bankRowId: undefined };
        bankRowId = undefined;
      }

      if (bankRowId && bankRowId.startsWith(prefix)) {
        const suffix = bankRowId.slice(prefix.length);
        if (isNumericIndexSuffix(suffix)) {
          const idx = Number(suffix);
          if (idx === deletedIndex) {
            changed = true;
            return { ...nextItem, bankRowId: undefined };
          }
          if (idx > deletedIndex) {
            changed = true;
            return { ...nextItem, bankRowId: `${prefix}${idx - 1}` };
          }
        } else if (deletedRef && suffix === `ref:${deletedRef}`) {
          changed = true;
          return { ...nextItem, bankRowId: undefined };
        }
      }
      return nextItem;
    });
    return changed ? next : items;
  };

  const originalExpenses = getStoredExpenses();
  const nextExpenses = patch(originalExpenses);
  if (nextExpenses !== originalExpenses) saveStoredExpenses(nextExpenses);

  const originalIncomes = getStoredIncomes();
  const nextIncomes = patch(originalIncomes);
  if (nextIncomes !== originalIncomes) saveStoredIncomes(nextIncomes);
};

export const getStoredConfigs = (): Record<string, MonthlyTricountConfig> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIGS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch (e) {
    console.error("Erreur lors de la lecture des configurations Tricount:", e);
  }
  return {};
};

export const saveMonthlyConfig = (config: MonthlyTricountConfig): void => {
  if (typeof window === "undefined") return;
  try {
    const configs = getStoredConfigs();
    configs[config.month] = config;
    localStorage.setItem(STORAGE_KEY_CONFIGS, JSON.stringify(configs));
    window.dispatchEvent(new Event("tricount_data_updated"));
    pushTricountToDatabase();
  } catch (e) {
    console.error("Erreur lors de la sauvegarde de la config Tricount:", e);
  }
};

export const getMonthlyConfig = (
  monthKey: string,
  strategy?: SavingsStrategy,
): MonthlyTricountConfig => {
  const configs = getStoredConfigs();
  const cfg = configs[monthKey];
  // Si la config existante a encore les anciens montants factices (3200 / 2300) et qu'on a la vraie stratégie
  if (cfg && cfg.p1Income === 3200 && cfg.p2Income === 2300 && strategy) {
    return applyStrategyToMonth(monthKey, strategy);
  }
  if (cfg) {
    return cfg;
  }

  if (strategy) {
    return applyStrategyToMonth(monthKey, strategy);
  }

  return {
    month: monthKey,
    p1Income: 0,
    p2Income: 0,
    isStrategyApplied: false,
  };
};

export const applyStrategyToMonth = (
  monthKey: string,
  strategy: SavingsStrategy,
): MonthlyTricountConfig => {
  const isSolo = strategy.household?.enabled === false;
  const p1Inc = strategy.incomes
    .filter(
      (i) =>
        isSolo ||
        (i.personId || "person1") === "person1" ||
        i.personId === "shared",
    )
    .reduce(
      (sum, i) => sum + (i.frequency === "yearly" ? i.amount / 12 : i.amount),
      0,
    );
  const p2Inc = isSolo
    ? 0
    : strategy.incomes
        .filter((i) => i.personId === "person2")
        .reduce(
          (sum, i) =>
            sum + (i.frequency === "yearly" ? i.amount / 12 : i.amount),
          0,
        );

  const totalInc = p1Inc + p2Inc;
  const targetSavingsRate =
    totalInc > 0
      ? Math.round(
          (strategy.pockets
            .filter((p) => isPlacementPocket(p))
            .reduce((sum, p) => sum + getPocketMonthlyAmount(p, totalInc), 0) /
            totalInc) *
            1000,
        ) / 10
      : 0;

  const newConfig: MonthlyTricountConfig = {
    month: monthKey,
    p1Income: Math.round(p1Inc * 100) / 100,
    p2Income: Math.round(p2Inc * 100) / 100,
    isStrategyApplied: true,
    appliedStrategyDate: new Date().toISOString(),
    targetSavingsRate,
  };

  // Ne ré-écrire que si la config stockée diffère réellement : sans ce
  // garde-fou, un appel effectué pendant le rendu (via getMonthlyConfig)
  // peut boucler lecture → recalcul → écriture → event → re-rendu → relecture.
  const existing = getStoredConfigs()[monthKey];
  const unchanged =
    !!existing &&
    existing.p1Income === newConfig.p1Income &&
    existing.p2Income === newConfig.p2Income &&
    existing.isStrategyApplied === newConfig.isStrategyApplied &&
    existing.targetSavingsRate === newConfig.targetSavingsRate;

  if (!unchanged) saveMonthlyConfig(newConfig);
  return newConfig;
};

export const calculateTricountBalance = (
  expenses: TricountExpense[],
  p1Income: number,
  p2Income: number,
  householdConfig?: HouseholdConfig,
): TricountBalanceSummary => {
  const isSolo = householdConfig?.enabled === false;

  let totalSpent = 0;
  let totalP1Paid = 0;
  let totalP2Paid = 0;
  let p1ShouldPay = 0;
  let p2ShouldPay = 0;
  let p1PersonalSpent = 0;
  let p2PersonalSpent = 0;
  let sharedExpensesCount = 0;

  if (isSolo) {
    for (const exp of expenses) {
      const amt = exp.amount || 0;
      totalSpent += amt;
      totalP1Paid += amt;
      p1ShouldPay += amt;
      p1PersonalSpent += amt;
    }

    return {
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalP1Paid: Math.round(totalP1Paid * 100) / 100,
      totalP2Paid: 0,
      p1ShouldPay: Math.round(totalSpent * 100) / 100,
      p2ShouldPay: 0,
      debtor: "none",
      creditor: "none",
      transferAmount: 0,
      sharedExpensesCount: 0,
      p1PersonalSpent: Math.round(totalSpent * 100) / 100,
      p2PersonalSpent: 0,
    };
  }

  const totalIncome = p1Income + p2Income || 1;
  const p1Ratio = p1Income / totalIncome;
  const p2Ratio = p2Income / totalIncome;

  for (const exp of expenses) {
    const amt = exp.amount || 0;
    totalSpent += amt;

    if (exp.payerPersonId === "person1") {
      totalP1Paid += amt;
    } else {
      totalP2Paid += amt;
    }

    if (exp.splitMethod === "100_person1") {
      p1ShouldPay += amt;
      p1PersonalSpent += amt;
    } else if (exp.splitMethod === "100_person2") {
      p2ShouldPay += amt;
      p2PersonalSpent += amt;
    } else if (exp.splitMethod === "proportional") {
      sharedExpensesCount++;
      p1ShouldPay += amt * p1Ratio;
      p2ShouldPay += amt * p2Ratio;
    } else {
      // "50_50" par défaut pour les dépenses partagées
      sharedExpensesCount++;
      p1ShouldPay += amt * 0.5;
      p2ShouldPay += amt * 0.5;
    }
  }

  // Équilibrage : Person 1 net = total payé - part due
  const p1Net = totalP1Paid - p1ShouldPay;

  let debtor: "person1" | "person2" | "none" = "none";
  let creditor: "person1" | "person2" | "none" = "none";
  let transferAmount = 0;

  if (Math.abs(p1Net) > 0.005) {
    if (p1Net > 0) {
      // P1 a trop payé, P2 lui doit
      debtor = "person2";
      creditor = "person1";
      transferAmount = Math.round(p1Net * 100) / 100;
    } else {
      // P2 a trop payé, P1 lui doit
      debtor = "person1";
      creditor = "person2";
      transferAmount = Math.round(Math.abs(p1Net) * 100) / 100;
    }
  }

  return {
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalP1Paid: Math.round(totalP1Paid * 100) / 100,
    totalP2Paid: Math.round(totalP2Paid * 100) / 100,
    p1ShouldPay: Math.round(p1ShouldPay * 100) / 100,
    p2ShouldPay: Math.round(p2ShouldPay * 100) / 100,
    debtor,
    creditor,
    transferAmount,
    sharedExpensesCount,
    p1PersonalSpent: Math.round(p1PersonalSpent * 100) / 100,
    p2PersonalSpent: Math.round(p2PersonalSpent * 100) / 100,
  };
};

export const calculateMonthlyBudgetSummary = (
  monthKey: string,
  strategy: SavingsStrategy,
): MonthlyBudgetSummary => {
  const expenses = getExpensesForMonth(monthKey);
  const config = getMonthlyConfig(monthKey, strategy);
  const monthlyIncomes = getIncomesForMonth(monthKey);

  const isSolo = strategy.household?.enabled === false;
  let p1Income = 0;
  let p2Income = 0;

  if (monthlyIncomes.length > 0) {
    if (isSolo) {
      p1Income = monthlyIncomes.reduce((sum, i) => sum + (i.amount || 0), 0);
      p2Income = 0;
    } else {
      const p1Direct = monthlyIncomes
        .filter((i) => (i.beneficiaryPersonId || "person1") === "person1")
        .reduce((sum, i) => sum + (i.amount || 0), 0);
      const p2Direct = monthlyIncomes
        .filter((i) => i.beneficiaryPersonId === "person2")
        .reduce((sum, i) => sum + (i.amount || 0), 0);
      const shared = monthlyIncomes
        .filter((i) => i.beneficiaryPersonId === "shared")
        .reduce((sum, i) => sum + (i.amount || 0), 0);

      p1Income = p1Direct + shared * 0.5;
      p2Income = p2Direct + shared * 0.5;
    }
  } else {
    // Si aucune opération de revenu n'est enregistrée pour ce mois-ci,
    // les revenus réels perçus sont strictement de 0 €
    p1Income = 0;
    p2Income = 0;
  }

  const totalIncome = Math.round((p1Income + p2Income) * 100) / 100;

  // Référence de revenus pour les cibles théoriques de la stratégie (plannedAmount)
  const plannedStrategyIncome = getTotalMonthlyIncome(strategy.incomes || []);
  const referenceIncomeForPlan =
    plannedStrategyIncome > 0
      ? plannedStrategyIncome
      : totalIncome > 0
        ? totalIncome
        : 1;

  const balance = calculateTricountBalance(
    expenses,
    p1Income,
    p2Income,
    strategy.household,
  );

  // 1. Séparer rigoureusement les dépenses réelles de vie des placements/épargne
  const livingExpensesList = expenses.filter((e) => {
    const pocket = strategy.pockets.find((p) => p.id === e.pocketId);
    if (pocket && isPlacementPocket(pocket)) return false;
    if (e.nature === "placement") return false;
    if (e.nature === "expense") return true;
    return !isPlacementPocket(pocket);
  });

  const placementExpensesList = expenses.filter((e) => {
    const pocket = strategy.pockets.find((p) => p.id === e.pocketId);
    if (pocket && isPlacementPocket(pocket)) return true;
    if (e.nature === "placement") return true;
    if (e.nature === "expense") return false;
    return isPlacementPocket(pocket);
  });

  const totalLivingExpenses = livingExpensesList.reduce(
    (sum, e) => sum + (e.amount || 0),
    0,
  );
  const totalPlacements = placementExpensesList.reduce(
    (sum, e) => sum + (e.amount || 0),
    0,
  );

  // 2. Capacité d'épargne réelle dégagée (Revenus réels - Dépenses réelles de vie)
  const realSavingsAmount =
    Math.round((totalIncome - totalLivingExpenses) * 100) / 100;
  const realSavingsRate =
    totalIncome > 0
      ? Math.round((realSavingsAmount / totalIncome) * 1000) / 10
      : 0;

  // 3. Reste non encore placé (Cash libre sur le compte courant)
  const unplacedSavings =
    Math.round((realSavingsAmount - totalPlacements) * 100) / 100;

  // 4. Poches de dépenses de vie
  const expensePockets = strategy.pockets.filter((p) => !isPlacementPocket(p));
  const expenseComparisons: MonthlyPocketComparison[] = expensePockets.map(
    (pocket) => {
      const planned = getPocketMonthlyAmount(pocket, referenceIncomeForPlan);
      const spentInPocket = livingExpensesList
        .filter((e) => e.pocketId === pocket.id)
        .reduce((sum, e) => sum + (e.amount || 0), 0);

      const diff = planned - spentInPocket;
      const status: "under_budget" | "over_budget" | "exact" =
        Math.abs(diff) < 0.5
          ? "exact"
          : diff > 0
            ? "under_budget"
            : "over_budget";

      return {
        pocketId: pocket.id,
        pocketName: pocket.name,
        category: pocket.category,
        pocketType: "expense",
        color: pocket.color,
        ownership: pocket.ownership,
        plannedAmount: Math.round(planned * 100) / 100,
        realSpent: Math.round(spentInPocket * 100) / 100,
        difference: Math.round(diff * 100) / 100,
        status,
      };
    },
  );

  // Dépenses de vie non classées
  const unclassifiedLivingSpent = livingExpensesList
    .filter(
      (e) =>
        !e.pocketId ||
        e.pocketId === "unallocated" ||
        !strategy.pockets.some((p) => p.id === e.pocketId),
    )
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  if (unclassifiedLivingSpent > 0) {
    expenseComparisons.push({
      pocketId: "unallocated",
      pocketName: "Autres dépenses / Non classé",
      category: "other",
      pocketType: "expense",
      color: "#94a3b8",
      plannedAmount: 0,
      realSpent: Math.round(unclassifiedLivingSpent * 100) / 100,
      difference: Math.round(-unclassifiedLivingSpent * 100) / 100,
      status: "over_budget",
    });
  }

  // 5. Poches de placement / épargne (Calcul séquentiel : charges fixes déduites d'abord)
  const placementPockets = strategy.pockets.filter((p) => isPlacementPocket(p));

  // Référence planifiée issue de la Stratégie d'épargne
  const plannedHousehold = calculateHouseholdSummary(strategy);

  // Quote-part des dépenses de vie réelles dues par chaque personne
  let p1LivingDue = 0;
  let p2LivingDue = 0;

  const realIncomeSum = p1Income + p2Income;
  const plannedP1Income = plannedHousehold.p1.monthlyIncome || 0;
  const plannedP2Income = plannedHousehold.p2.monthlyIncome || 0;
  const plannedSum = plannedP1Income + plannedP2Income;
  const fallbackRatio = plannedSum > 0 ? plannedP1Income / plannedSum : 0.5;
  const defaultP1Ratio =
    realIncomeSum > 0 ? p1Income / realIncomeSum : fallbackRatio;

  for (const exp of livingExpensesList) {
    const amt = exp.amount || 0;
    if (isSolo) {
      p1LivingDue += amt;
    } else if (exp.splitMethod === "100_person1") {
      p1LivingDue += amt;
    } else if (exp.splitMethod === "100_person2") {
      p2LivingDue += amt;
    } else if (exp.splitMethod === "proportional") {
      p1LivingDue += amt * defaultP1Ratio;
      p2LivingDue += amt * (1 - defaultP1Ratio);
    } else {
      // 50_50 par défaut pour les charges communes
      p1LivingDue += amt * 0.5;
      p2LivingDue += amt * 0.5;
    }
  }
  p1LivingDue = Math.round(p1LivingDue * 100) / 100;
  p2LivingDue = Math.round(p2LivingDue * 100) / 100;

  // Capacité réelle d'épargne dégagée par personne (Revenus personnels - quote-part des dépenses réelles de vie)
  const p1SavingsAmount = Math.round((p1Income - p1LivingDue) * 100) / 100;
  const p2SavingsAmount = isSolo
    ? 0
    : Math.round((p2Income - p2LivingDue) * 100) / 100;

  // Capacité nette réelle disponible de chacun avant épargne / placements
  const p1RealNet = Math.max(
    0,
    Math.round((p1Income - p1LivingDue) * 100) / 100,
  );
  const p2RealNet = isSolo
    ? 0
    : Math.max(0, Math.round((p2Income - p2LivingDue) * 100) / 100);
  const totalRealNet = Math.round((p1RealNet + p2RealNet) * 100) / 100;

  const placementComparisons: MonthlyPocketComparison[] = placementPockets.map(
    (pocket) => {
      // Référence planifiée de la stratégie
      const planBreakdown = plannedHousehold.pocketBreakdowns[pocket.id];
      const p1Planned = isSolo
        ? (planBreakdown?.monthlyAmount ?? 0)
        : (planBreakdown?.paidByP1 ?? 0);
      const p2Planned = isSolo ? 0 : (planBreakdown?.paidByP2 ?? 0);
      const plannedAmount = Math.round((p1Planned + p2Planned) * 100) / 100;

      let p1Allocated = 0;
      let p2Allocated = 0;
      let splitRuleLabel = "50/50";

      if (isSolo) {
        splitRuleLabel = "Solo";
        if (pocket.allocationType === "percent") {
          const pct = Number(pocket.allocationValue) || 0;
          p1Allocated = Math.round(p1RealNet * (pct / 100) * 100) / 100;
        } else {
          p1Allocated = Math.min(p1RealNet, p1Planned);
        }
        p2Allocated = 0;
      } else {
        if (pocket.allocationType === "percent") {
          const pct = Number(pocket.allocationValue) || 0;
          splitRuleLabel = `${pct}% net`;

          if (pocket.ownership === "person1") {
            p1Allocated = Math.round(p1RealNet * (pct / 100) * 100) / 100;
            p2Allocated = 0;
          } else if (pocket.ownership === "person2") {
            p1Allocated = 0;
            p2Allocated = Math.round(p2RealNet * (pct / 100) * 100) / 100;
          } else {
            // shared ou dossier : chacun alloue son % sur son reste net disponible personnel
            p1Allocated = Math.round(p1RealNet * (pct / 100) * 100) / 100;
            p2Allocated = Math.round(p2RealNet * (pct / 100) * 100) / 100;
          }
        } else {
          // allocationType === "fixed"
          if (pocket.ownership === "person1") {
            splitRuleLabel = strategy.household?.person1?.name || "Personne 1";
            p1Allocated = Math.min(p1RealNet, p1Planned);
            p2Allocated = 0;
          } else if (pocket.ownership === "person2") {
            splitRuleLabel = strategy.household?.person2?.name || "Personne 2";
            p1Allocated = 0;
            p2Allocated = Math.min(p2RealNet, p2Planned);
          } else if (pocket.ownership === "dossier") {
            splitRuleLabel =
              pocket.splitMethod === "50_50"
                ? "50/50"
                : pocket.splitMethod === "proportional"
                  ? "Prorata"
                  : "Dossier";
            p1Allocated = Math.min(p1RealNet, p1Planned);
            p2Allocated = Math.min(p2RealNet, p2Planned);
          } else {
            // shared
            if (pocket.splitMethod === "50_50") {
              splitRuleLabel = "50/50";
              const half = Math.round(plannedAmount * 0.5 * 100) / 100;
              p1Allocated = Math.min(p1RealNet, half);
              p2Allocated = Math.min(p2RealNet, half);
            } else {
              splitRuleLabel = "Prorata";
              const r1 =
                totalRealNet > 0 ? p1RealNet / totalRealNet : defaultP1Ratio;
              p1Allocated = Math.min(
                p1RealNet,
                Math.round(plannedAmount * r1 * 100) / 100,
              );
              p2Allocated = Math.min(
                p2RealNet,
                Math.round(plannedAmount * (1 - r1) * 100) / 100,
              );
            }
          }
        }
      }

      const allocatedFromReal =
        Math.round((p1Allocated + p2Allocated) * 100) / 100;

      // Déjà placé par personne dans cette poche
      const p1Placed = placementExpensesList
        .filter(
          (e) =>
            e.pocketId === pocket.id &&
            (e.payerPersonId === "person1" || (!e.payerPersonId && isSolo)),
        )
        .reduce((sum, e) => sum + (e.amount || 0), 0);
      const p2Placed = isSolo
        ? 0
        : placementExpensesList
            .filter(
              (e) => e.pocketId === pocket.id && e.payerPersonId === "person2",
            )
            .reduce((sum, e) => sum + (e.amount || 0), 0);

      const p1PlacedRound = Math.round(p1Placed * 100) / 100;
      const p2PlacedRound = Math.round(p2Placed * 100) / 100;
      const placedInPocket =
        Math.round((p1PlacedRound + p2PlacedRound) * 100) / 100;

      // Reste à placer par personne
      const p1Remaining = Math.max(
        0,
        Math.round((p1Allocated - p1PlacedRound) * 100) / 100,
      );
      const p2Remaining = isSolo
        ? 0
        : Math.max(0, Math.round((p2Allocated - p2PlacedRound) * 100) / 100);
      const remainingToPlace =
        Math.round((p1Remaining + p2Remaining) * 100) / 100;

      const diff = Math.round((allocatedFromReal - placedInPocket) * 100) / 100;
      const status: "under_budget" | "over_budget" | "exact" =
        Math.abs(diff) < 0.5
          ? "exact"
          : diff > 0
            ? "under_budget"
            : "over_budget";

      return {
        pocketId: pocket.id,
        pocketName: pocket.name,
        category: pocket.category,
        pocketType: "placement",
        color: pocket.color,
        ownership: pocket.ownership,
        plannedAmount,
        allocatedFromReal,
        realSpent: placedInPocket,
        difference: diff,
        remainingToPlace,
        status,
        p1Planned,
        p2Planned,
        p1Allocated,
        p2Allocated,
        p1Placed: p1PlacedRound,
        p2Placed: p2PlacedRound,
        p1Remaining,
        p2Remaining,
        splitRuleLabel,
      };
    },
  );

  const unclassifiedPlaced = placementExpensesList
    .filter(
      (e) =>
        !e.pocketId ||
        e.pocketId === "unallocated" ||
        !strategy.pockets.some((p) => p.id === e.pocketId),
    )
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  if (unclassifiedPlaced > 0) {
    const p1UnclassPlaced = placementExpensesList
      .filter(
        (e) =>
          (!e.pocketId ||
            e.pocketId === "unallocated" ||
            !strategy.pockets.some((p) => p.id === e.pocketId)) &&
          (e.payerPersonId === "person1" || (!e.payerPersonId && isSolo)),
      )
      .reduce((sum, e) => sum + (e.amount || 0), 0);
    const p2UnclassPlaced = isSolo
      ? 0
      : placementExpensesList
          .filter(
            (e) =>
              (!e.pocketId ||
                e.pocketId === "unallocated" ||
                !strategy.pockets.some((p) => p.id === e.pocketId)) &&
              e.payerPersonId === "person2",
          )
          .reduce((sum, e) => sum + (e.amount || 0), 0);

    placementComparisons.push({
      pocketId: "unallocated_placement",
      pocketName: "Placements non classés",
      category: "other",
      pocketType: "placement",
      color: "#94a3b8",
      plannedAmount: 0,
      allocatedFromReal: 0,
      realSpent: Math.round(unclassifiedPlaced * 100) / 100,
      difference: Math.round(-unclassifiedPlaced * 100) / 100,
      remainingToPlace: 0,
      status: "over_budget",
      p1Planned: 0,
      p2Planned: 0,
      p1Allocated: 0,
      p2Allocated: 0,
      p1Placed: Math.round(p1UnclassPlaced * 100) / 100,
      p2Placed: Math.round(p2UnclassPlaced * 100) / 100,
      p1Remaining: 0,
      p2Remaining: 0,
      splitRuleLabel: "Non classé",
    });
  }

  const p1TotalAllocated =
    Math.round(
      placementComparisons.reduce((sum, c) => sum + (c.p1Allocated || 0), 0) *
        100,
    ) / 100;
  const p2TotalAllocated =
    Math.round(
      placementComparisons.reduce((sum, c) => sum + (c.p2Allocated || 0), 0) *
        100,
    ) / 100;
  const p1TotalPlaced =
    Math.round(
      placementComparisons.reduce((sum, c) => sum + (c.p1Placed || 0), 0) * 100,
    ) / 100;
  const p2TotalPlaced =
    Math.round(
      placementComparisons.reduce((sum, c) => sum + (c.p2Placed || 0), 0) * 100,
    ) / 100;
  const p1TotalRemaining =
    Math.round(
      placementComparisons.reduce((sum, c) => sum + (c.p1Remaining || 0), 0) *
        100,
    ) / 100;
  const p2TotalRemaining =
    Math.round(
      placementComparisons.reduce((sum, c) => sum + (c.p2Remaining || 0), 0) *
        100,
    ) / 100;

  const p1UnplacedSavings =
    Math.round((p1SavingsAmount - p1TotalPlaced) * 100) / 100;
  const p2UnplacedSavings = isSolo
    ? 0
    : Math.round((p2SavingsAmount - p2TotalPlaced) * 100) / 100;

  const pocketComparisons = [...expenseComparisons, ...placementComparisons];

  return {
    month: monthKey,
    totalIncome: Math.round(totalIncome * 100) / 100,
    p1Income: Math.round(p1Income * 100) / 100,
    p2Income: Math.round(p2Income * 100) / 100,
    totalExpenses: Math.round(totalLivingExpenses * 100) / 100,
    realSavingsAmount,
    realSavingsRate,
    p1SavingsAmount,
    p2SavingsAmount,
    p1LivingDue,
    p2LivingDue,
    totalPlacements: Math.round(totalPlacements * 100) / 100,
    unplacedSavings,
    p1UnplacedSavings,
    p2UnplacedSavings,
    targetSavingsRate: config.targetSavingsRate,
    balance,
    pocketComparisons,
    expenseComparisons,
    placementComparisons,
    incomesCount: monthlyIncomes.length,
    p1TotalAllocated,
    p2TotalAllocated,
    p1TotalPlaced,
    p2TotalPlaced,
    p1TotalRemaining,
    p2TotalRemaining,
  };
};

export const getAvailableMonths = (): string[] => {
  const current = getCurrentMonthKey();
  const set = new Set<string>();

  // Le mois en cours est toujours inclus
  set.add(current);

  const allExpenses = getStoredExpenses();
  for (const exp of allExpenses) {
    if (exp.month) set.add(exp.month);
  }

  const allIncomes = getStoredIncomes();
  for (const inc of allIncomes) {
    if (inc.month) set.add(inc.month);
  }

  // Règle : un mois sans aucune transaction (ni dépense ni revenu) n'apparaît pas,
  // sauf s'il s'agit du mois courant actif.
  const activeMonths = Array.from(set).filter((m) => {
    if (m === current) return true;
    const hasExpenses = allExpenses.some((e) => e.month === m);
    const hasIncomes = allIncomes.some((i) => i.month === m);
    return hasExpenses || hasIncomes;
  });

  return activeMonths.sort((a, b) => b.localeCompare(a));
};
