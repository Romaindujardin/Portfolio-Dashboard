import {
  IncomeSource,
  SavingsPocket,
  SavingsStrategy,
  HouseholdConfig,
  PocketOwnership,
  SplitMode,
} from "../types";
import { getAccentColorDef, getUserAccentColor } from "./theme";

export const getToolUsers = (): string[] => {
  if (typeof window === "undefined") return ["Romain"];
  try {
    const raw = localStorage.getItem("portfolio_users");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 2);
    }
  } catch (e) {
    console.error("Erreur lors de la lecture des utilisateurs pour la stratégie:", e);
  }
  return ["Romain", "Sophie"];
};

export const DEFAULT_HOUSEHOLD_CONFIG: HouseholdConfig = {
  enabled: true,
  person1: { id: "person1", name: "Romain", color: "#3b82f6" },
  person2: { id: "person2", name: "Sophie", color: "#10b981" },
  splitMode: "proportional", // "proportional" (au prorata) ou "50_50"
};

export const DEFAULT_SAVINGS_STRATEGY: SavingsStrategy = {
  household: DEFAULT_HOUSEHOLD_CONFIG,
  incomes: [
    {
      id: "inc-1789326874108",
      name: "Chomage",
      amount: 773,
      frequency: "monthly",
      personId: "person1",
    },
    {
      id: "inc-1791217452050",
      name: "Salaire",
      amount: 1950,
      frequency: "monthly",
      personId: "person2",
    },
  ],
  pockets: [
    {
      id: "poc-1",
      name: "Loyer & charges fixes",
      category: "fixed_expense",
      allocationType: "fixed",
      allocationValue: 860,
      currentAmount: 0,
      color: "#6366f1",
      notes: "Loyer, électricité, box internet, assurances",
      expectedReturnRate: 0,
      ownership: "shared",
      splitMethod: "50_50",
      subItems: [
        {
          id: "sub-1791282788202",
          name: "Loyer",
          amount: 670,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791282833260",
          name: "Electrcité",
          amount: 70,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791282845715",
          name: "Eau",
          amount: 30,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791283696068",
          name: "Essence",
          amount: 90,
          expectedReturnRate: 0,
        },
      ],
    },
    {
      id: "poc-2",
      name: "Alimentation & quotidien",
      category: "fixed_expense",
      allocationType: "fixed",
      allocationValue: 500,
      currentAmount: 0,
      color: "#06b6d4",
      notes: "Courses, transports, santé",
      expectedReturnRate: 0,
      ownership: "shared",
      splitMethod: "50_50",
      subItems: [
        {
          id: "sub-1791282904431",
          name: "Course",
          amount: 300,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791282915821",
          name: "Repas plaisir",
          amount: 100,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791571436174",
          name: "Autre",
          amount: 100,
          expectedReturnRate: 0,
        },
      ],
    },
    {
      id: "poc-3",
      name: "Investissements (PEA / ETF)",
      category: "investment",
      allocationType: "percent",
      allocationValue: 15,
      currentAmount: 58091.2,
      targetAmount: 800000,
      expectedReturnRate: 7,
      color: "#10b981",
      notes: "ETF MSCI World & S&P 500 à long terme",
      ownership: "dossier",
      splitMethod: "proportional",
      subItems: [
        {
          id: "sub-1791283084532",
          name: "PEA Romain",
          amount: 115.95,
          personId: "person1",
          currentAmount: 791.2,
          targetAmount: 150000,
          expectedReturnRate: 7,
        },
        {
          id: "sub-1791283097844",
          name: "PEA Sophie",
          amount: 292.5,
          personId: "person2",
          currentAmount: 1000,
          targetAmount: 150000,
          expectedReturnRate: 7,
        },
        {
          id: "sub-1791561118844",
          name: "Assurance vie",
          amount: 0,
          personId: "person1",
          currentAmount: 56300,
          targetAmount: 500000,
          expectedReturnRate: 2,
        },
      ],
      person1Amount: 115.95,
      person2Amount: 292.5,
      person1Current: 791.2,
      person2Current: 1000,
      person1Target: 150000,
      person2Target: 150000,
    },
    {
      id: "poc-5",
      name: "Épargne de précaution",
      category: "emergency",
      allocationType: "percent",
      allocationValue: 10,
      currentAmount: 0,
      targetAmount: 20000,
      expectedReturnRate: 1.7,
      color: "#f59e0b",
      notes: "Fonds de secours en cas d'imprévu (3 à 6 mois de dépenses)",
      ownership: "dossier",
      splitMethod: "proportional",
      subItems: [
        {
          id: "sub-1791284041751",
          name: "Livret A Romain",
          amount: 77.3,
          personId: "person1",
          currentAmount: 0,
          targetAmount: 10000,
          expectedReturnRate: 1.7,
        },
        {
          id: "sub-1791284057982",
          name: "Livret A Sophie",
          amount: 195,
          personId: "person2",
          currentAmount: 0,
          targetAmount: 10000,
          expectedReturnRate: 1.7,
        },
      ],
      person1Amount: 77.3,
      person2Amount: 195,
      person1Current: 0,
      person2Current: 0,
      person1Target: 10000,
      person2Target: 10000,
    },
    {
      id: "poc-1789327263082",
      name: "Plaisir perso",
      category: "leisure",
      allocationType: "percent",
      allocationValue: 10,
      currentAmount: 0,
      expectedReturnRate: 0,
      color: "#8b5cf6",
      notes: "",
      ownership: "shared",
      splitMethod: "proportional",
      subItems: [],
    },
    {
      id: "poc-1791282725473",
      name: "Abonnement & Assurance",
      category: "fixed_expense",
      ownership: "dossier",
      splitMethod: "custom",
      allocationType: "fixed",
      allocationValue: 7.97,
      currentAmount: 0,
      expectedReturnRate: 0,
      color: "#8b5cf6",
      notes: "",
      subItems: [
        {
          id: "sub-1791282694396",
          name: "Icloud",
          amount: 0.99,
          personId: "person1",
          currentAmount: 0,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791282717721",
          name: "Apple music",
          amount: 5.99,
          personId: "person1",
          currentAmount: 0,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791308800915",
          name: "abonnement iCloud",
          amount: 0.99,
          personId: "person2",
          currentAmount: 0,
          expectedReturnRate: 0,
        },
      ],
      person1Amount: 6.98,
      person2Amount: 0.99,
      person1Current: 0,
      person2Current: 0,
    },
    {
      id: "poc-1791284416249",
      name: "Projet Voyage",
      category: "leisure",
      ownership: "shared",
      splitMethod: "50_50",
      allocationType: "percent",
      allocationValue: 10,
      currentAmount: 0,
      targetAmount: 5000,
      expectedReturnRate: 0,
      color: "#f43f5e",
      notes: "",
      subItems: [],
    },
    {
      id: "poc-1791655715244",
      name: "Dépense Perso",
      category: "fixed_expense",
      ownership: "dossier",
      splitMethod: "custom",
      allocationType: "fixed",
      allocationValue: 200,
      currentAmount: 0,
      expectedReturnRate: 0,
      color: "#14b8a6",
      notes: "",
      subItems: [
        {
          id: "sub-1791655705641",
          name: "Romain",
          amount: 100,
          personId: "person1",
          currentAmount: 0,
          expectedReturnRate: 0,
        },
        {
          id: "sub-1791655712558",
          name: "Sophie",
          amount: 100,
          personId: "person1",
          currentAmount: 0,
          expectedReturnRate: 0,
        },
      ],
      person1Amount: 200,
      person2Amount: 0,
      person1Current: 0,
      person2Current: 0,
    },
  ],
  horizonYears: 20,
};

export const getSavingsStrategy = (userId: string = "Romain"): SavingsStrategy => {
  try {
    let raw = localStorage.getItem(`savings_strategy_${userId}`);
    // Si pas de données pour cet utilisateur, vérifier si le partenaire ou un autre profil a déjà un plan couple
    if (!raw) {
      const toolUsers = getToolUsers();
      for (const other of toolUsers) {
        if (other !== userId) {
          const otherRaw = localStorage.getItem(`savings_strategy_${other}`);
          if (otherRaw) {
            raw = otherRaw;
            break;
          }
        }
      }
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      return normalizeSavingsStrategy(parsed, userId);
    }
  } catch (error) {
    console.error("Erreur lors de la lecture de savings_strategy:", error);
  }
  return DEFAULT_SAVINGS_STRATEGY;
};

export const normalizeSavingsStrategy = (
  parsed: any,
  userId: string = "Romain"
): SavingsStrategy => {
  if (!parsed || !Array.isArray(parsed.incomes) || !Array.isArray(parsed.pockets)) {
    return DEFAULT_SAVINGS_STRATEGY;
  }
  try {
    // Conserver précieusement les poches et revenus personnalisés de l'utilisateur
    if (!parsed.pockets || parsed.pockets.length === 0) {
      parsed.pockets = DEFAULT_SAVINGS_STRATEGY.pockets;
    }
    if (!parsed.incomes || parsed.incomes.length === 0) {
      parsed.incomes = DEFAULT_SAVINGS_STRATEGY.incomes;
    }

    // Détecter automatiquement Personne 1 et Personne 2 depuis les profils de l'outil
    const toolUsers = getToolUsers();
    let p1Name = parsed.household?.person1?.name;
    if (!p1Name || !toolUsers.includes(p1Name)) {
      p1Name = toolUsers.includes(userId) ? userId : toolUsers[0] || "Romain";
    }

    let p2Name = parsed.household?.person2?.name;
    const otherToolUsers = toolUsers.filter((u) => u !== p1Name);
    if (!p2Name || p2Name === "Ma copine" || !toolUsers.includes(p2Name)) {
      p2Name = otherToolUsers.length > 0 ? otherToolUsers[0] : "Sophie";
    }

    const p1Color = getAccentColorDef(getUserAccentColor(p1Name)).hex;
    const p2Color = getAccentColorDef(getUserAccentColor(p2Name)).hex;
    const hasTwoUsers = toolUsers.length >= 2;

    const household: HouseholdConfig = {
      enabled: hasTwoUsers ? (parsed.household?.enabled ?? true) : false,
      person1: {
        id: "person1",
        name: p1Name,
        color: p1Color,
      },
      person2: {
        id: "person2",
        name: p2Name,
        color: p2Color,
      },
      splitMode: parsed.household?.splitMode || "proportional",
    };

    const migratedIncomes: IncomeSource[] = parsed.incomes.map(
      (inc: any, idx: number) => ({
        ...inc,
        personId: inc.personId || (idx === 0 ? "person1" : "person2"),
      })
    );

    const migratedPockets: SavingsPocket[] = parsed.pockets.map(
      (poc: any) => {
        const ownership = poc.ownership || "shared";
        const isDossier = ownership === "dossier";

        let p1Amt = poc.person1Amount != null ? Number(poc.person1Amount) : undefined;
        let p2Amt = poc.person2Amount != null ? Number(poc.person2Amount) : undefined;

        if (isDossier && Array.isArray(poc.subItems) && poc.subItems.length > 0) {
          const p1Sub = poc.subItems
            .filter((s: any) => s.personId === "person1")
            .reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);
          const p2Sub = poc.subItems
            .filter((s: any) => s.personId === "person2")
            .reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);
          if (p1Amt == null && p1Sub > 0) p1Amt = p1Sub;
          if (p2Amt == null && p2Sub > 0) p2Amt = p2Sub;
        }

        const totalAmt = (p1Amt || 0) + (p2Amt || 0);
        const r1 = totalAmt > 0 ? (p1Amt || 0) / totalAmt : 0.5;

        let p1Tgt = poc.person1Target != null ? Number(poc.person1Target) : undefined;
        let p2Tgt = poc.person2Target != null ? Number(poc.person2Target) : undefined;
        if (
          isDossier &&
          p1Tgt == null &&
          p2Tgt == null &&
          poc.targetAmount != null &&
          Number(poc.targetAmount) > 0
        ) {
          const globalTgt = Number(poc.targetAmount);
          p1Tgt = Math.round(globalTgt * r1);
          p2Tgt = globalTgt - p1Tgt;
        }

        let p1Cur = poc.person1Current != null ? Number(poc.person1Current) : undefined;
        let p2Cur = poc.person2Current != null ? Number(poc.person2Current) : undefined;
        if (
          isDossier &&
          p1Cur == null &&
          p2Cur == null &&
          poc.currentAmount != null &&
          Number(poc.currentAmount) > 0
        ) {
          const globalCur = Number(poc.currentAmount);
          p1Cur = Math.round(globalCur * r1);
          p2Cur = globalCur - p1Cur;
        }

        const subItems = Array.isArray(poc.subItems)
          ? poc.subItems.map((sub: any) => {
              const isPerson1 = sub.personId === "person1";
              const isPerson2 = sub.personId === "person2";
              return {
                ...sub,
                amount: Number(sub.amount) || 0,
                currentAmount:
                  sub.currentAmount != null
                    ? Number(sub.currentAmount) || 0
                    : isPerson1
                      ? p1Cur
                      : isPerson2
                        ? p2Cur
                        : undefined,
                targetAmount:
                  sub.targetAmount != null
                    ? Number(sub.targetAmount) || 0
                    : isPerson1
                      ? p1Tgt
                      : isPerson2
                        ? p2Tgt
                        : undefined,
                expectedReturnRate:
                  sub.expectedReturnRate != null
                    ? Number(sub.expectedReturnRate) || 0
                    : poc.expectedReturnRate != null
                      ? Number(poc.expectedReturnRate) || 0
                      : undefined,
              };
            })
          : [];

        return {
          ...poc,
          ownership,
          splitMethod:
            poc.splitMethod ||
            (poc.category === "fixed_expense" ? "50_50" : "proportional"),
          subItems,
          person1Amount: p1Amt,
          person2Amount: p2Amt,
          person1Current: p1Cur,
          person2Current: p2Cur,
          person1Target: p1Tgt,
          person2Target: p2Tgt,
        };
      }
    );

    return {
      household,
      incomes: migratedIncomes,
      pockets: migratedPockets,
      horizonYears: parsed.horizonYears || 5,
    };
  } catch (e) {
    console.error("Erreur normalisation de stratégie:", e);
    return DEFAULT_SAVINGS_STRATEGY;
  }
};

export const saveSavingsStrategy = (
  userId: string = "Romain",
  strategy: SavingsStrategy
): void => {
  try {
    localStorage.setItem(`savings_strategy_${userId}`, JSON.stringify(strategy));
    // Si le mode couple est actif, synchroniser automatiquement avec le profil du partenaire
    if (strategy.household?.enabled) {
      const p1 = strategy.household.person1?.name;
      const p2 = strategy.household.person2?.name;
      if (p1 && p1 !== userId) {
        localStorage.setItem(`savings_strategy_${p1}`, JSON.stringify(strategy));
      }
      if (p2 && p2 !== userId) {
        localStorage.setItem(`savings_strategy_${p2}`, JSON.stringify(strategy));
      }
    }
    // Sauvegarder immédiatement sur la base de données SQLite et disque
    pushSavingsStrategyToDatabase(userId, strategy);
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de savings_strategy:", error);
  }
};

export const getCurrentMonthKey = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export const STORAGE_KEY_MONTHLY_STRATEGIES = "portfolio_monthly_savings_strategies";

export const getStoredMonthlyStrategies = (): Record<string, SavingsStrategy> => {
  const currentMonth = getCurrentMonthKey();
  if (typeof window === "undefined") {
    return {
      [currentMonth]: DEFAULT_SAVINGS_STRATEGY,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MONTHLY_STRATEGIES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed["2026-09"]) {
          delete parsed["2026-09"];
          try {
            localStorage.setItem(STORAGE_KEY_MONTHLY_STRATEGIES, JSON.stringify(parsed));
          } catch {
            // ignore
          }
        }
        return parsed;
      }
    }
  } catch (e) {
    console.error("Erreur lors de la lecture des stratégies mensuelles:", e);
  }
  return {
    [currentMonth]: DEFAULT_SAVINGS_STRATEGY,
  };
};

export const saveStoredMonthlyStrategies = (
  strategies: Record<string, SavingsStrategy>
): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY_MONTHLY_STRATEGIES,
      JSON.stringify(strategies)
    );
    // Sauvegarder immédiatement sur la base de données SQLite et disque
    pushMonthlyStrategiesToDatabase("Romain", strategies);
  } catch (e) {
    console.error("Erreur lors de la sauvegarde des stratégies mensuelles:", e);
  }
};

// ===== SYNCHRONISATION SERVEUR & BASE DE DONNÉES (PERSISTANCE ROBUSTE) =====
const SAVINGS_API_BASE = "http://localhost:3001/api/database/savings";

export const fetchSavingsStrategyFromDatabase = async (
  userId: string = "Romain"
): Promise<SavingsStrategy | null> => {
  try {
    const res = await fetch(
      `${SAVINGS_API_BASE}/strategy?user_id=${encodeURIComponent(userId)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.strategy || null;
  } catch (e) {
    console.warn("Impossible de récupérer la stratégie depuis le serveur:", e);
    return null;
  }
};

export const pushSavingsStrategyToDatabase = async (
  userId: string = "Romain",
  strategy?: SavingsStrategy
): Promise<boolean> => {
  try {
    const strat = strategy || getSavingsStrategy(userId);
    const res = await fetch(`${SAVINGS_API_BASE}/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy: strat, userId }),
    });
    return res.ok;
  } catch (e) {
    console.warn("Impossible de pousser la stratégie vers le serveur:", e);
    return false;
  }
};

export const fetchMonthlyStrategiesFromDatabase = async (
  userId: string = "Romain"
): Promise<Record<string, SavingsStrategy> | null> => {
  try {
    const res = await fetch(
      `${SAVINGS_API_BASE}/monthly?user_id=${encodeURIComponent(userId)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.strategies || null;
  } catch (e) {
    console.warn("Impossible de récupérer les stratégies mensuelles depuis le serveur:", e);
    return null;
  }
};

export const pushMonthlyStrategiesToDatabase = async (
  userId: string = "Romain",
  strategies?: Record<string, SavingsStrategy>
): Promise<boolean> => {
  try {
    const strats = strategies || getStoredMonthlyStrategies();
    const res = await fetch(`${SAVINGS_API_BASE}/monthly/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategies: strats, userId }),
    });
    return res.ok;
  } catch (e) {
    console.warn("Impossible de pousser les stratégies mensuelles vers le serveur:", e);
    return false;
  }
};

export const syncSavingsWithDatabase = async (
  userId: string = "Romain"
): Promise<void> => {
  try {
    // 1. Synchroniser la stratégie générale
    const serverStrat = await fetchSavingsStrategyFromDatabase(userId);
    const localStratRaw =
      typeof window !== "undefined"
        ? localStorage.getItem(`savings_strategy_${userId}`)
        : null;

    if (localStratRaw) {
      pushSavingsStrategyToDatabase(userId);
    } else if (serverStrat) {
      localStorage.setItem(
        `savings_strategy_${userId}`,
        JSON.stringify(serverStrat)
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("savings_strategy_updated"));
      }
    }

    // 2. Synchroniser les stratégies mensuelles
    const serverMonthly = await fetchMonthlyStrategiesFromDatabase(userId);
    const localMonthlyRaw =
      typeof window !== "undefined"
        ? localStorage.getItem(STORAGE_KEY_MONTHLY_STRATEGIES)
        : null;

    if (localMonthlyRaw) {
      pushMonthlyStrategiesToDatabase(userId);
    } else if (serverMonthly && Object.keys(serverMonthly).length > 0) {
      localStorage.setItem(
        STORAGE_KEY_MONTHLY_STRATEGIES,
        JSON.stringify(serverMonthly)
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("savings_strategy_updated"));
      }
    }
  } catch (e) {
    console.error("Erreur lors de la synchronisation de l'épargne avec le serveur:", e);
  }
};

if (typeof window !== "undefined") {
  setTimeout(() => {
    syncSavingsWithDatabase();
  }, 100);
}

/**
 * Récupère la stratégie d'épargne d'un mois spécifique.
 * Règle de cascade :
 * 1. Si une stratégie explicite existe pour ce mois, on la retourne.
 * 2. Sinon, on recherche le mois antérieur le plus récent configuré (la stratégie du dernier mois s'applique au mois suivant).
 * 3. Sinon, on se rabat sur la stratégie par défaut de l'utilisateur.
 */
export const getSavingsStrategyForMonth = (
  monthKey: string,
  userId: string = "Romain"
): SavingsStrategy => {
  try {
    const monthlyMap = getStoredMonthlyStrategies();
    // 1. Stratégie explicite pour ce mois
    if (monthlyMap[monthKey]) {
      return normalizeSavingsStrategy(monthlyMap[monthKey], userId);
    }

    // 2. Cascade : mois antérieur le plus proche
    const earlierMonths = Object.keys(monthlyMap)
      .filter((m) => m < monthKey)
      .sort();

    if (earlierMonths.length > 0) {
      const mostRecentEarlierMonth = earlierMonths[earlierMonths.length - 1];
      const inherited = monthlyMap[mostRecentEarlierMonth];
      if (inherited) {
        return normalizeSavingsStrategy(inherited, userId);
      }
    }

    // 3. Fallback : stratégie générale active
    return getSavingsStrategy(userId);
  } catch (error) {
    console.error("Erreur lors de la récupération de la stratégie pour le mois:", monthKey, error);
    return getSavingsStrategy(userId);
  }
};

/**
 * Enregistre une stratégie d'épargne dédiée pour un mois donné.
 */
export const saveSavingsStrategyForMonth = (
  monthKey: string,
  strategy: SavingsStrategy,
  userId: string = "Romain"
): void => {
  try {
    const monthlyMap = getStoredMonthlyStrategies();
    monthlyMap[monthKey] = strategy;
    saveStoredMonthlyStrategies(monthlyMap);

    // Mettre également à jour la stratégie globale de référence
    saveSavingsStrategy(userId, strategy);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("savings_strategy_updated", {
          detail: { month: monthKey, strategy },
        })
      );
    }
  } catch (error) {
    console.error("Erreur lors de l'enregistrement de la stratégie pour le mois:", monthKey, error);
  }
};

/**
 * Indique si le mois possède une stratégie expressément personnalisée.
 */
export const hasCustomStrategyForMonth = (monthKey: string): boolean => {
  const map = getStoredMonthlyStrategies();
  return Boolean(map[monthKey]);
};

/**
 * Retourne la provenance de la stratégie pour un mois donné :
 * - Le mois lui-même s'il est personnalisé
 * - Le mois antérieur dont elle hérite
 * - null si elle vient de la configuration générale par défaut
 */
export const getSourceStrategyMonthFor = (monthKey: string): string | null => {
  const map = getStoredMonthlyStrategies();
  if (map[monthKey]) return monthKey;
  const earlier = Object.keys(map)
    .filter((m) => m < monthKey)
    .sort();
  if (earlier.length > 0) return earlier[earlier.length - 1];
  return null;
};

/**
 * Duplique la stratégie d'un mois source vers un mois cible.
 */
export const copySavingsStrategyFromMonth = (
  sourceMonthKey: string,
  targetMonthKey: string,
  userId: string = "Romain"
): SavingsStrategy => {
  const sourceStrategy = getSavingsStrategyForMonth(sourceMonthKey, userId);
  const cloned: SavingsStrategy = JSON.parse(JSON.stringify(sourceStrategy));
  saveSavingsStrategyForMonth(targetMonthKey, cloned, userId);
  return cloned;
};

/**
 * Liste tous les mois pour lesquels une stratégie a été explicitement enregistrée.
 */
export const getAllConfiguredStrategyMonths = (): string[] => {
  const map = getStoredMonthlyStrategies();
  return Object.keys(map).sort();
};

export const roundCents = (v: number): number => {
  return Math.round((v + Number.EPSILON) * 100) / 100;
};

export const snapZero = (v: number): number => {
  return Math.abs(v) < 0.005 ? 0 : v;
};

export const getTotalMonthlyIncome = (incomes: IncomeSource[]): number => {
  return roundCents(
    incomes.reduce((sum, inc) => {
      const val = Number(inc.amount) || 0;
      return sum + (inc.frequency === "yearly" ? val / 12 : val);
    }, 0)
  );
};

export const getIncomeByPerson = (
  incomes: IncomeSource[],
  personId: "person1" | "person2" | "shared"
): number => {
  return roundCents(
    incomes
      .filter((inc) => (inc.personId || "person1") === personId)
      .reduce((sum, inc) => {
        const val = Number(inc.amount) || 0;
        return sum + (inc.frequency === "yearly" ? val / 12 : val);
      }, 0)
  );
};

export const getSubItemsTotal = (pocket: SavingsPocket): number => {
  if (!pocket.subItems || pocket.subItems.length === 0) return 0;
  return roundCents(pocket.subItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
};

/** Poches qui ont vocation à générer une projection de capital. */
export const isProjectedSavingsPocket = (pocket: SavingsPocket): boolean => {
  if (pocket.category === "investment") return true;
  if (pocket.pocketType === "placement") return true;

  // Les projets, la précaution et les poches plaisir/loisir n'apparaissent que s'ils constituent bien
  // un capital à suivre (objectif, capital existant ou rendement). Cela évite
  // de projeter des abonnements ou dépenses récurrentes sans capital ni objectif.
  return (
    (pocket.category === "savings_goal" ||
      pocket.category === "emergency" ||
      pocket.category === "leisure") &&
    ((Number(pocket.currentAmount) || 0) > 0 ||
      (Number(pocket.targetAmount) || 0) > 0 ||
      (Number(pocket.expectedReturnRate) || 0) > 0 ||
      (pocket.subItems || []).some(
        (subItem) =>
          (Number(subItem.currentAmount) || 0) > 0 ||
          (Number(subItem.targetAmount) || 0) > 0 ||
          (Number(subItem.expectedReturnRate) || 0) > 0,
      ))
  );
};

export const getPocketMonthlyAmount = (
  pocket: SavingsPocket,
  totalMonthlyIncome: number
): number => {
  if (pocket.ownership === "dossier") {
    const method = pocket.splitMethod || "custom";
    if (method === "50_50" || method === "proportional") {
      const val = Number(pocket.allocationValue) || 0;
      if (pocket.allocationType === "percent") {
        return roundCents((totalMonthlyIncome * val) / 100);
      }
      if (val > 0) return roundCents(val);
    }
    return roundCents((Number(pocket.person1Amount) || 0) + (Number(pocket.person2Amount) || 0));
  }
  const val = Number(pocket.allocationValue) || 0;
  if (pocket.allocationType === "percent") {
    return roundCents((totalMonthlyIncome * val) / 100);
  }
  return roundCents(val);
};

export const getPocketPercent = (
  pocket: SavingsPocket,
  totalMonthlyIncome: number
): number => {
  if (pocket.ownership === "dossier") {
    const method = pocket.splitMethod || "custom";
    if (method === "custom") {
      const totalDossier = (Number(pocket.person1Amount) || 0) + (Number(pocket.person2Amount) || 0);
      return totalMonthlyIncome > 0 ? (totalDossier / totalMonthlyIncome) * 100 : 0;
    }
  }
  const val = Number(pocket.allocationValue) || 0;
  if (pocket.allocationType === "percent") {
    return val;
  }
  if (totalMonthlyIncome <= 0) return 0;
  return (val / totalMonthlyIncome) * 100;
};

export interface PersonSummary {
  personId: "person1" | "person2";
  name: string;
  color?: string;
  monthlyIncome: number;
  incomeRatio: number; // Part des revenus totaux (ex: 0.582)
  sharedContributionEur: number; // Part payée pour les charges/poches communes
  personalContributionEur: number; // Montant total des poches personnelles
  totalAllocatedEur: number; // sharedContributionEur + personalContributionEur
  remainingEur: number; // Reste à vivre personnel
  remainingPercent: number; // % du salaire personnel restant
  savingsAmountEur: number; // Épargne personnelle + quote-part d'épargne commune
  savingsRate: number; // Taux d'épargne personnel (%)
}

export interface HouseholdSummary {
  enabled: boolean;
  splitMode: SplitMode;
  totalMonthlyIncome: number;
  totalAllocatedEur: number;
  totalRemainingEur: number;
  remainingPercent: number;
  totalSavingsEur: number;
  savingsRate: number;
  splitRatioP1: number; // Ratio appliqué aux charges communes (0.5 ou au prorata)
  splitRatioP2: number;
  p1: PersonSummary;
  p2: PersonSummary;
  pocketBreakdowns: Record<
    string,
    {
      monthlyAmount: number;
      paidByP1: number;
      paidByP2: number;
      ownership: PocketOwnership;
      splitMethod?: SplitMode;
      subItemsTotal: number;
    }
  >;
}

export const calculateHouseholdSummary = (
  strategy: SavingsStrategy
): HouseholdSummary => {
  const household = strategy.household || DEFAULT_HOUSEHOLD_CONFIG;
  const isEnabled = household.enabled !== false;
  const splitMode = household.splitMode || "proportional";

  // Incomes per person
  let incomeP1 = 0;
  let incomeP2 = 0;
  let incomeShared = 0;

  strategy.incomes.forEach((inc) => {
    const monthlyVal =
      inc.frequency === "yearly"
        ? (Number(inc.amount) || 0) / 12
        : Number(inc.amount) || 0;

    const pid = inc.personId || "person1";
    if (pid === "person1") {
      incomeP1 += monthlyVal;
    } else if (pid === "person2") {
      if (isEnabled) incomeP2 += monthlyVal;
    } else {
      incomeShared += monthlyVal;
    }
  });

  // If there are shared incomes
  if (incomeShared > 0) {
    if (isEnabled) {
      incomeP1 += incomeShared / 2;
      incomeP2 += incomeShared / 2;
    } else {
      incomeP1 += incomeShared;
    }
  }

  incomeP1 = roundCents(incomeP1);
  incomeP2 = isEnabled ? roundCents(incomeP2) : 0;
  const totalMonthlyIncome = isEnabled
    ? roundCents(incomeP1 + incomeP2)
    : incomeP1;

  // Ratios
  const ratioP1 = totalMonthlyIncome > 0 ? incomeP1 / totalMonthlyIncome : 0.5;
  const ratioP2 = totalMonthlyIncome > 0 ? incomeP2 / totalMonthlyIncome : 0.5;

  const splitRatioP1 = splitMode === "50_50" ? 0.5 : ratioP1;
  const splitRatioP2 = splitMode === "50_50" ? 0.5 : ratioP2;

  // Breakdown per pocket
  let sharedContributionP1 = 0;
  let sharedContributionP2 = 0;
  let personalContributionP1 = 0;
  let personalContributionP2 = 0;

  let savingsP1 = 0;
  let savingsP2 = 0;
  let totalSavingsEur = 0;
  let totalAllocatedEur = 0;

  const pocketBreakdowns: Record<
    string,
    {
      monthlyAmount: number;
      paidByP1: number;
      paidByP2: number;
      ownership: PocketOwnership;
      splitMethod?: SplitMode;
      subItemsTotal: number;
    }
  > = {};

  // ÉTAPE 1 : Calcul prioritaire des charges fixes (Loyer, alimentation, charges...)
  let fixedChargesP1 = 0;
  let fixedChargesP2 = 0;

  strategy.pockets.forEach((pocket) => {
    if (pocket.category === "fixed_expense") {
      const monthlyAmt = roundCents(getPocketMonthlyAmount(pocket, totalMonthlyIncome));
      totalAllocatedEur = roundCents(totalAllocatedEur + monthlyAmt);

      const ownership: PocketOwnership = pocket.ownership || "shared";
      const pocketSplitMethod: SplitMode = pocket.splitMethod || "50_50";
      const pocketRatioP1 = pocketSplitMethod === "50_50" ? 0.5 : ratioP1;
      const subItemsTotal = roundCents(getSubItemsTotal(pocket));

      let paidByP1 = 0;
      let paidByP2 = 0;

      if (!isEnabled) {
        paidByP1 = monthlyAmt;
        paidByP2 = 0;
        personalContributionP1 = roundCents(personalContributionP1 + monthlyAmt);
      } else if (ownership === "person1") {
        paidByP1 = monthlyAmt;
        paidByP2 = 0;
        personalContributionP1 = roundCents(personalContributionP1 + monthlyAmt);
      } else if (ownership === "person2") {
        paidByP1 = 0;
        paidByP2 = monthlyAmt;
        personalContributionP2 = roundCents(personalContributionP2 + monthlyAmt);
      } else if (ownership === "dossier") {
        const dossierSplitMode: SplitMode = pocket.splitMethod || "50_50";
        if (dossierSplitMode === "50_50") {
          paidByP1 = roundCents(monthlyAmt * 0.5);
          paidByP2 = roundCents(monthlyAmt - paidByP1);
        } else if (dossierSplitMode === "proportional") {
          paidByP1 = roundCents(monthlyAmt * ratioP1);
          paidByP2 = roundCents(monthlyAmt - paidByP1);
        } else {
          paidByP1 = roundCents(Number(pocket.person1Amount) || 0);
          paidByP2 = roundCents(Number(pocket.person2Amount) || 0);
        }
        personalContributionP1 = roundCents(personalContributionP1 + paidByP1);
        personalContributionP2 = roundCents(personalContributionP2 + paidByP2);
      } else {
        // Shared pocket
        paidByP1 = roundCents(monthlyAmt * pocketRatioP1);
        paidByP2 = roundCents(monthlyAmt - paidByP1);
        sharedContributionP1 = roundCents(sharedContributionP1 + paidByP1);
        sharedContributionP2 = roundCents(sharedContributionP2 + paidByP2);
      }

      fixedChargesP1 = roundCents(fixedChargesP1 + paidByP1);
      fixedChargesP2 = roundCents(fixedChargesP2 + paidByP2);

      pocketBreakdowns[pocket.id] = {
        monthlyAmount: monthlyAmt,
        paidByP1,
        paidByP2,
        ownership,
        splitMethod: pocketSplitMethod,
        subItemsTotal,
      };
    }
  });

  // ÉTAPE 2 : Capacité nette disponible de chacun avant épargne / placements
  const netAvailableP1 = Math.max(0, roundCents(incomeP1 - fixedChargesP1));
  const netAvailableP2 = isEnabled ? Math.max(0, roundCents(incomeP2 - fixedChargesP2)) : 0;
  const totalNetAvailable = roundCents(netAvailableP1 + netAvailableP2);
  const netRatioP1 = totalNetAvailable > 0 ? netAvailableP1 / totalNetAvailable : ratioP1;

  // ÉTAPE 3 : Poches d'épargne, investissements & loisirs (Section 3)
  strategy.pockets.forEach((pocket) => {
    if (pocket.category !== "fixed_expense") {
      const ownership: PocketOwnership = pocket.ownership || "shared";
      const pocketSplitMethod: SplitMode = pocket.splitMethod || "50_50";
      const subItemsTotal = roundCents(getSubItemsTotal(pocket));

      let paidByP1 = 0;
      let paidByP2 = 0;
      let monthlyAmt = 0;

      if (pocket.allocationType === "percent") {
        const pct = Number(pocket.allocationValue) || 0;
        if (!isEnabled) {
          paidByP1 = roundCents((netAvailableP1 * pct) / 100);
          paidByP2 = 0;
          personalContributionP1 = roundCents(personalContributionP1 + paidByP1);
        } else if (ownership === "person1") {
          paidByP1 = roundCents((netAvailableP1 * pct) / 100);
          paidByP2 = 0;
          personalContributionP1 = roundCents(personalContributionP1 + paidByP1);
        } else if (ownership === "person2") {
          paidByP1 = 0;
          paidByP2 = roundCents((netAvailableP2 * pct) / 100);
          personalContributionP2 = roundCents(personalContributionP2 + paidByP2);
        } else {
          // Shared ou Dossier : chacun alloue son % sur son reste net disponible
          paidByP1 = roundCents((netAvailableP1 * pct) / 100);
          paidByP2 = roundCents((netAvailableP2 * pct) / 100);
          if (ownership === "dossier") {
            personalContributionP1 = roundCents(personalContributionP1 + paidByP1);
            personalContributionP2 = roundCents(personalContributionP2 + paidByP2);
          } else {
            sharedContributionP1 = roundCents(sharedContributionP1 + paidByP1);
            sharedContributionP2 = roundCents(sharedContributionP2 + paidByP2);
          }
        }
        monthlyAmt = roundCents(paidByP1 + paidByP2);
      } else {
        // allocationType === "fixed"
        monthlyAmt = roundCents(getPocketMonthlyAmount(pocket, totalMonthlyIncome));

        if (!isEnabled) {
          paidByP1 = monthlyAmt;
          paidByP2 = 0;
          personalContributionP1 = roundCents(personalContributionP1 + monthlyAmt);
        } else if (ownership === "person1") {
          paidByP1 = monthlyAmt;
          paidByP2 = 0;
          personalContributionP1 = roundCents(personalContributionP1 + monthlyAmt);
        } else if (ownership === "person2") {
          paidByP1 = 0;
          paidByP2 = monthlyAmt;
          personalContributionP2 = roundCents(personalContributionP2 + monthlyAmt);
        } else if (ownership === "dossier") {
          const dossierSplitMode: SplitMode = pocket.splitMethod || "50_50";
          if (dossierSplitMode === "50_50") {
            paidByP1 = roundCents(monthlyAmt * 0.5);
            paidByP2 = roundCents(monthlyAmt - paidByP1);
          } else if (dossierSplitMode === "proportional") {
            paidByP1 = roundCents(monthlyAmt * netRatioP1);
            paidByP2 = roundCents(monthlyAmt - paidByP1);
          } else {
            paidByP1 = roundCents(Number(pocket.person1Amount) || 0);
            paidByP2 = roundCents(Number(pocket.person2Amount) || 0);
          }
          personalContributionP1 = roundCents(personalContributionP1 + paidByP1);
          personalContributionP2 = roundCents(personalContributionP2 + paidByP2);
        } else {
          // Shared
          if (pocketSplitMethod === "50_50") {
            paidByP1 = roundCents(monthlyAmt * 0.5);
            paidByP2 = roundCents(monthlyAmt - paidByP1);
          } else {
            paidByP1 = roundCents(monthlyAmt * netRatioP1);
            paidByP2 = roundCents(monthlyAmt - paidByP1);
          }
          sharedContributionP1 = roundCents(sharedContributionP1 + paidByP1);
          sharedContributionP2 = roundCents(sharedContributionP2 + paidByP2);
        }
      }

      totalAllocatedEur = roundCents(totalAllocatedEur + monthlyAmt);
      savingsP1 = roundCents(savingsP1 + paidByP1);
      savingsP2 = roundCents(savingsP2 + paidByP2);
      totalSavingsEur = roundCents(totalSavingsEur + paidByP1 + paidByP2);

      pocketBreakdowns[pocket.id] = {
        monthlyAmount: monthlyAmt,
        paidByP1,
        paidByP2,
        ownership,
        splitMethod: pocketSplitMethod,
        subItemsTotal,
      };
    }
  });

  const totalAllocatedP1 = roundCents(sharedContributionP1 + personalContributionP1);
  const totalAllocatedP2 = roundCents(sharedContributionP2 + personalContributionP2);

  const remainingP1 = snapZero(roundCents(incomeP1 - totalAllocatedP1));
  const remainingP2 = snapZero(roundCents(incomeP2 - totalAllocatedP2));

  const remainingPctP1 = incomeP1 > 0 ? (remainingP1 / incomeP1) * 100 : 0;
  const remainingPctP2 = incomeP2 > 0 ? (remainingP2 / incomeP2) * 100 : 0;

  const savingsRateP1 = incomeP1 > 0 ? (savingsP1 / incomeP1) * 100 : 0;
  const savingsRateP2 = incomeP2 > 0 ? (savingsP2 / incomeP2) * 100 : 0;

  const totalRemainingEur = snapZero(roundCents(totalMonthlyIncome - totalAllocatedEur));
  const remainingPercent =
    totalMonthlyIncome > 0 ? (totalRemainingEur / totalMonthlyIncome) * 100 : 0;
  const globalSavingsRate =
    totalMonthlyIncome > 0 ? (totalSavingsEur / totalMonthlyIncome) * 100 : 0;

  const p1Summary: PersonSummary = {
    personId: "person1",
    name: household.person1?.name || "Personne 1",
    color: household.person1?.color || "#3b82f6",
    monthlyIncome: incomeP1,
    incomeRatio: ratioP1,
    sharedContributionEur: sharedContributionP1,
    personalContributionEur: personalContributionP1,
    totalAllocatedEur: totalAllocatedP1,
    remainingEur: remainingP1,
    remainingPercent: remainingPctP1,
    savingsAmountEur: savingsP1,
    savingsRate: savingsRateP1,
  };

  const p2Summary: PersonSummary = {
    personId: "person2",
    name: household.person2?.name || "Personne 2",
    color: household.person2?.color || "#ec4899",
    monthlyIncome: incomeP2,
    incomeRatio: ratioP2,
    sharedContributionEur: sharedContributionP2,
    personalContributionEur: personalContributionP2,
    totalAllocatedEur: totalAllocatedP2,
    remainingEur: remainingP2,
    remainingPercent: remainingPctP2,
    savingsAmountEur: savingsP2,
    savingsRate: savingsRateP2,
  };

  return {
    enabled: isEnabled,
    splitMode,
    totalMonthlyIncome,
    totalAllocatedEur,
    totalRemainingEur,
    remainingPercent,
    totalSavingsEur,
    savingsRate: globalSavingsRate,
    splitRatioP1,
    splitRatioP2,
    p1: p1Summary,
    p2: p2Summary,
    pocketBreakdowns,
  };
};

export interface ProjectionDataPoint {
  year: number;
  month: number;
  label: string;
  total: number;
  [pocketId: string]: number | string;
}

export interface ProjectionSeries {
  id: string;
  name: string;
  color: string;
  parentPocketId?: string;
}

export interface DossierPersonEstimation {
  personId: "person1" | "person2";
  personName: string;
  subItemName?: string;
  targetAmount: number;
  currentAmount: number;
  monthlySavings: number;
  monthsNeeded: number | null;
  isReached: boolean;
  projectedDate: string | null;
}

export interface GoalEstimation {
  pocketId: string;
  pocketName: string;
  targetAmount: number;
  currentAmount: number;
  monthlySavings: number;
  expectedReturnRate: number;
  monthsNeeded: number | null; // null if never reached
  isReached: boolean;
  projectedDate: string | null;
  ownership?: PocketOwnership;
  personId?: "person1" | "person2" | "shared";
  personName?: string;
  dossierId?: string;
  dossierName?: string;
  isDossier?: boolean;
  dossierDetails?: {
    person1: DossierPersonEstimation;
    person2: DossierPersonEstimation;
  };
}

export const calculateSavingsProjection = (
  strategy: SavingsStrategy,
  years: number = 5
): {
  dataPoints: ProjectionDataPoint[];
  series: ProjectionSeries[];
  goalEstimations: GoalEstimation[];
  totalProjectedAtHorizon: number;
  totalSavingsPocketsAtHorizon: number;
} => {
  const household = calculateHouseholdSummary(strategy);
  const totalIncome = household.totalMonthlyIncome;
  const totalMonths = Math.max(1, Math.round(years * 12));

  const p1Name = strategy.household?.person1?.name || "Romain";
  const p2Name = strategy.household?.person2?.name || "Sophie";
  const isHouseholdEnabled = strategy.household?.enabled ?? true;

  type ProjectionEntry = {
    id: string;
    name: string;
    color: string;
    parentPocketId?: string;
    currentAmount: number;
    monthlyAmount: number;
    expectedReturnRate: number;
  };

  const projectionEntries: ProjectionEntry[] = strategy.pockets
    .filter(isProjectedSavingsPocket)
    .flatMap((pocket): ProjectionEntry[] => {
      const isDossier = isHouseholdEnabled && pocket.ownership === "dossier";
      if (isDossier && (pocket.subItems || []).length > 0) {
        return (pocket.subItems || []).map((subItem) => ({
          id: `${pocket.id}:${subItem.id}`,
          name: subItem.name || pocket.name,
          color: pocket.color,
          parentPocketId: pocket.id,
          currentAmount: Number(subItem.currentAmount) || 0,
          monthlyAmount: Number(subItem.amount) || 0,
          expectedReturnRate:
            subItem.expectedReturnRate != null
              ? Number(subItem.expectedReturnRate) || 0
              : Number(pocket.expectedReturnRate) || 0,
        }));
      }

      return [{
        id: pocket.id,
        name: pocket.name,
        color: pocket.color,
        parentPocketId: undefined,
        currentAmount: Number(pocket.currentAmount) || 0,
        monthlyAmount: getPocketMonthlyAmount(pocket, totalIncome),
        expectedReturnRate: Number(pocket.expectedReturnRate) || 0,
      }];
    });

  const series: ProjectionSeries[] = projectionEntries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    color: entry.color,
    parentPocketId: entry.parentPocketId,
  }));
  const pocketBalances: Record<string, number> = Object.fromEntries(
    projectionEntries.map((entry) => [entry.id, entry.currentAmount]),
  );

  const simulateTarget = (
    target: number,
    current: number,
    monthly: number,
    expectedReturnRate: number
  ): { monthsNeeded: number | null; isReached: boolean; projectedDate: string | null } => {
    const rate = (expectedReturnRate || 0) / 100 / 12;

    if (current >= target) {
      return {
        monthsNeeded: 0,
        isReached: true,
        projectedDate: "Déjà atteint",
      };
    }

    if (monthly <= 0 && rate <= 0) {
      return {
        monthsNeeded: null,
        isReached: false,
        projectedDate: "Non atteignable sans apport",
      };
    }

    let bal = current;
    let m = 0;
    const maxSimulationMonths = 600; // 50 years cap
    while (bal < target && m < maxSimulationMonths) {
      bal = bal * (1 + rate) + monthly;
      m++;
    }

    if (bal >= target) {
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + m);
      const formattedDate = targetDate.toLocaleDateString("fr-FR", {
        month: "short",
        year: "numeric",
      });
      return {
        monthsNeeded: m,
        isReached: false,
        projectedDate: formattedDate,
      };
    }

    return {
      monthsNeeded: null,
      isReached: false,
      projectedDate: "> 50 ans",
    };
  };

  const goalEstimations: GoalEstimation[] = [];

  strategy.pockets.filter(isProjectedSavingsPocket).forEach((p) => {
    const isDossier = isHouseholdEnabled && p.ownership === "dossier";
    const rate = Number(p.expectedReturnRate) || 0;

    if (isDossier) {
      // Un dossier n'a pas d'objectif global : chaque compte garde son échéancier.
      (p.subItems || []).forEach((sub) => {
        const target = Number(sub.targetAmount) || 0;
        const current = Number(sub.currentAmount) || 0;
        const monthly = Number(sub.amount) || 0;
        const expectedReturnRate =
          sub.expectedReturnRate != null
            ? Number(sub.expectedReturnRate) || 0
            : rate;
        const sim =
          target > 0
            ? simulateTarget(target, current, monthly, expectedReturnRate)
            : { monthsNeeded: null, isReached: false, projectedDate: null };
        const personId = sub.personId === "person2" ? "person2" : "person1";
        goalEstimations.push({
          pocketId: `${p.id}:${sub.id}`,
          pocketName: sub.name || p.name,
          targetAmount: target,
          currentAmount: current,
          monthlySavings: monthly,
          expectedReturnRate,
          monthsNeeded: sim.monthsNeeded,
          isReached: sim.isReached,
          projectedDate: sim.projectedDate,
          ownership: "dossier",
          personId,
          personName: personId === "person2" ? p2Name : p1Name,
          dossierId: p.id,
          dossierName: p.name,
        });
      });
    } else if (p.targetAmount && p.targetAmount > 0) {
      // Poche standard (partagée ou individuelle)
      const target = p.targetAmount;
      const current = Number(p.currentAmount) || 0;
      const monthly = getPocketMonthlyAmount(p, totalIncome);
      const sim = simulateTarget(target, current, monthly, rate);

      const ownership = p.ownership || "shared";
      let personId: "person1" | "person2" | "shared" = "shared";
      let personName = "Commun";
      if (ownership === "person1") {
        personId = "person1";
        personName = p1Name;
      } else if (ownership === "person2") {
        personId = "person2";
        personName = p2Name;
      }

      goalEstimations.push({
        pocketId: p.id,
        pocketName: p.name,
        targetAmount: target,
        currentAmount: current,
        monthlySavings: monthly,
        expectedReturnRate: rate,
        monthsNeeded: sim.monthsNeeded,
        isReached: sim.isReached,
        projectedDate: sim.projectedDate,
        ownership: ownership,
        personId: personId,
        personName: personName,
      });
    }
  });

  const dataPoints: ProjectionDataPoint[] = [];

  // Month 0 (initial state)
  const initialPoint: ProjectionDataPoint = {
    year: 0,
    month: 0,
    label: "Aujourd'hui",
    total: 0,
  };
  let initialTotal = 0;
  projectionEntries.forEach((entry) => {
    initialPoint[entry.id] = entry.currentAmount;
    initialTotal += entry.currentAmount;
  });
  initialPoint.total = roundCents(initialTotal);
  dataPoints.push(initialPoint);

  // Month 1 to totalMonths
  for (let m = 1; m <= totalMonths; m++) {
    let monthTotal = 0;

    projectionEntries.forEach((entry) => {
      const monthlyRate = entry.expectedReturnRate / 100 / 12;

      // Compound interest on ongoing balance
      const current = pocketBalances[entry.id] || 0;
      const nextVal = current * (1 + monthlyRate) + entry.monthlyAmount;
      pocketBalances[entry.id] = nextVal;
      monthTotal += nextVal;
    });

    const shouldRecord =
      years <= 2
        ? m % 1 === 0 // every month
        : years <= 5
        ? m % 3 === 0 || m === totalMonths
        : m % 6 === 0 || m === totalMonths;

    if (shouldRecord) {
      const yearFraction = (m / 12).toFixed(1);
      const pointLabel =
        m % 12 === 0
          ? `${m / 12} an${m / 12 > 1 ? "s" : ""}`
          : m < 12
          ? `${m} mois`
          : `${yearFraction} ans`;

      const pt: ProjectionDataPoint = {
        year: Math.floor(m / 12),
        month: m,
        label: pointLabel,
        total: roundCents(monthTotal),
      };

      projectionEntries.forEach((entry) => {
        pt[entry.id] = roundCents(pocketBalances[entry.id] || 0);
      });

      dataPoints.push(pt);
    }
  }

  const finalBalances = pocketBalances;
  let totalProjectedAtHorizon = 0;
  let totalSavingsPocketsAtHorizon = 0;

  projectionEntries.forEach((entry) => {
    const finalVal = finalBalances[entry.id] || 0;
    totalProjectedAtHorizon += finalVal;
    totalSavingsPocketsAtHorizon += finalVal;
  });

  return {
    dataPoints,
    series,
    goalEstimations,
    totalProjectedAtHorizon: roundCents(totalProjectedAtHorizon),
    totalSavingsPocketsAtHorizon: roundCents(totalSavingsPocketsAtHorizon),
  };
};
