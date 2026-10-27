import React, { useState, useMemo, useEffect } from "react";
import {
  Search,
  ChevronRight,
  Clock,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { useUser } from "../contexts/UserContext";
import { useCurrency, formatMoney } from "../contexts/CurrencyContext";
import {
  SavingsStrategy,
  PocketCategory,
  TricountExpense,
  PocketSubItem,
} from "../types";
import {
  getSavingsStrategyForMonth,
  getAllConfiguredStrategyMonths,
  getStoredMonthlyStrategies,
} from "../utils/savingsStorage";
import {
  getStoredExpenses,
  getStoredIncomes,
  getCurrentMonthKey,
  formatMonthLabel,
  isPlacementPocket,
} from "../utils/tricountStorage";
import { getUserAccentColor } from "../utils/theme";
import SavingsProjectionPanel from "../components/SavingsProjectionPanel";

const formatEur = (val: number | null | undefined): string => {
  return formatMoney(val, { fallback: "0,00 €" });
};

const COLOR_PALETTE = [
  "#10b981", // Emerald
  "#6366f1", // Indigo
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#06b6d4", // Cyan
  "#8b5cf6", // Purple
  "#3b82f6", // Blue
  "#14b8a6", // Teal
  "#f43f5e", // Rose
  "#eab308", // Yellow
];

interface PocketStats {
  id: string;
  name: string;
  category: PocketCategory | "other";
  color: string;
  ownership?: string;
  targetAmount?: number;
  expectedReturnRate?: number;
  initialCapital: number;
  isActiveInLatest: boolean;
  totalRealPlaced: number;
  p1Placed: number;
  p2Placed: number;
  monthlyPlacements: Record<string, number>;
  firstMonthInvested: string | null;
  lastMonthInvested: string | null;
  placementsCount: number;
  lastPlacementDate?: string;
  lastPlacementLabel?: string;
  latestPlannedMonthly?: number;
  subItems?: PocketSubItem[];
}

export const Savings: React.FC = () => {
  const { currentUser, availableUsers } = useUser();
  useCurrency();
  const [refreshKey, setRefreshKey] = useState(0);

  // Filtres d'affichage des poches et du journal
  const [pocketFilter, setPocketFilter] = useState<
    "all" | "active" | "historical"
  >("all");
  const [pocketSearch, setPocketSearch] = useState("");
  const [selectedPocketDetailId, setSelectedPocketDetailId] = useState<
    string | null
  >(null);

  // Filtres du journal de transactions
  const [journalPocketFilter, setJournalPocketFilter] = useState<string>("all");
  const [journalPersonFilter, setJournalPersonFilter] = useState<
    "all" | "person1" | "person2"
  >("all");
  const [journalSearch, setJournalSearch] = useState("");

  // Onglet graphique actif
  const [activeChartTab, setActiveChartTab] = useState<
    "stacked" | "cumulative" | "donut"
  >("stacked");
  const [donutMode, setDonutMode] = useState<"pocket" | "person">("pocket");

  // Recharger lors des événements
  useEffect(() => {
    const handleUpdate = () => setRefreshKey((k) => k + 1);
    window.addEventListener("tricount_data_updated", handleUpdate);
    window.addEventListener("savings_strategy_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("tricount_data_updated", handleUpdate);
      window.removeEventListener("savings_strategy_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const currentMonth = getCurrentMonthKey();
  const latestStrategy = useMemo(
    () => getSavingsStrategyForMonth(currentMonth, currentUser),
    [currentMonth, currentUser, refreshKey],
  );

  const isSoloMode =
    availableUsers.length < 2 || latestStrategy.household?.enabled === false;
  const p1Name =
    latestStrategy.household?.person1?.name || currentUser || "Romain";
  const p2Name = isSoloMode
    ? ""
    : latestStrategy.household?.person2?.name || "Sophie";

  const p1Color = getUserAccentColor(p1Name);
  const p2Color = isSoloMode ? "#94a3b8" : getUserAccentColor(p2Name);

  // 1. Tous les mois ordonnés chronologiquement (croissant)
  const allMonthsChrono = useMemo(() => {
    const set = new Set<string>();
    const exps = getStoredExpenses();
    for (const e of exps) {
      const m = e.month || e.date.slice(0, 7);
      if (m) set.add(m);
    }
    const incs = getStoredIncomes();
    for (const i of incs) {
      if (i.month) set.add(i.month);
    }
    const configuredStratMonths = getAllConfiguredStrategyMonths();
    for (const m of configuredStratMonths) {
      set.add(m);
    }
    set.add(currentMonth);

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [refreshKey, currentMonth]);

  // 2. Extraire toutes les opérations de placements réelles
  const allPlacements = useMemo(() => {
    const exps = getStoredExpenses();
    const list: (TricountExpense & {
      monthKey: string;
      pocketName: string;
      pocketColor: string;
    })[] = [];

    for (const exp of exps) {
      const m = exp.month || exp.date.slice(0, 7);
      const strat = getSavingsStrategyForMonth(m, currentUser);
      const pocket = strat.pockets.find((p) => p.id === exp.pocketId);

      const isPlacement =
        isPlacementPocket(pocket) ||
        exp.nature === "placement";

      if (isPlacement) {
        list.push({
          ...exp,
          monthKey: m,
          pocketName: pocket?.name || exp.pocketId || "Placement non classé",
          pocketColor: pocket?.color || "#10b981",
        });
      }
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [currentUser, refreshKey]);

  // 3. Registre intelligent des poches (Actives vs Historiques)
  const { pocketsList, activePockets, historicalPockets } = useMemo(() => {
      const map = new Map<string, PocketStats>();

      // Initialiser d'abord avec les poches de la stratégie du mois courant
      const activePocketsLatest = latestStrategy.pockets.filter((p) =>
        isPlacementPocket(p),
      );

      activePocketsLatest.forEach((poc, idx) => {
        map.set(poc.id, {
          id: poc.id,
          name: poc.name,
          category: poc.category || "investment",
          color: poc.color || COLOR_PALETTE[idx % COLOR_PALETTE.length],
          ownership: poc.ownership,
          targetAmount: poc.targetAmount,
          expectedReturnRate: poc.expectedReturnRate,
          initialCapital: Number(poc.currentAmount) || 0,
          isActiveInLatest: true,
          totalRealPlaced: 0,
          p1Placed: 0,
          p2Placed: 0,
          monthlyPlacements: {},
          firstMonthInvested: null,
          lastMonthInvested: null,
          placementsCount: 0,
          latestPlannedMonthly:
            poc.allocationType === "fixed"
              ? Number(poc.allocationValue) || 0
              : undefined,
          subItems: poc.subItems || [],
        });
      });

      // Scanner tous les mois historiques pour découvrir des poches qui auraient existé ou reçu des fonds
      const allConfiguredMap = getStoredMonthlyStrategies();
      Object.entries(allConfiguredMap).forEach(([mKey, strat]) => {
        strat.pockets.filter(isPlacementPocket).forEach((poc, idx) => {
          if (!map.has(poc.id)) {
            map.set(poc.id, {
              id: poc.id,
              name: poc.name,
              category: poc.category || "investment",
              color: poc.color || COLOR_PALETTE[idx % COLOR_PALETTE.length],
              ownership: poc.ownership,
              targetAmount: poc.targetAmount,
              expectedReturnRate: poc.expectedReturnRate,
              initialCapital: Number(poc.currentAmount) || 0,
              isActiveInLatest: false, // Plus dans la stratégie actuelle !
              totalRealPlaced: 0,
              p1Placed: 0,
              p2Placed: 0,
              monthlyPlacements: {},
              firstMonthInvested: mKey,
              lastMonthInvested: null,
              placementsCount: 0,
              subItems: poc.subItems || [],
            });
          }
        });
      });

      // Agréger chaque versement réel d'épargne dans sa poche
      allPlacements.forEach((item) => {
        const pid = item.pocketId || "unallocated_placement";
        let stat = map.get(pid);

        if (!stat) {
          // Poche trouvée dans les dépenses mais pas dans les définitions de poches
          stat = {
            id: pid,
            name: item.pocketName || "Autre placement",
            category: "other",
            color: item.pocketColor || "#64748b",
            initialCapital: 0,
            isActiveInLatest: false,
            totalRealPlaced: 0,
            p1Placed: 0,
            p2Placed: 0,
            monthlyPlacements: {},
            firstMonthInvested: item.monthKey,
            lastMonthInvested: item.monthKey,
            placementsCount: 0,
            subItems: [],
          };
          map.set(pid, stat);
        }

        const amt = Number(item.amount) || 0;
        stat.totalRealPlaced =
          Math.round((stat.totalRealPlaced + amt) * 100) / 100;
        stat.placementsCount += 1;

        // Répartition Romain / Sophie
        if (item.payerPersonId === "person2") {
          stat.p2Placed = Math.round((stat.p2Placed + amt) * 100) / 100;
        } else {
          stat.p1Placed = Math.round((stat.p1Placed + amt) * 100) / 100;
        }

        // Suivi mensuel
        const m = item.monthKey;
        stat.monthlyPlacements[m] =
          Math.round(((stat.monthlyPlacements[m] || 0) + amt) * 100) / 100;

        // Historique temporel
        if (!stat.firstMonthInvested || m < stat.firstMonthInvested) {
          stat.firstMonthInvested = m;
        }
        if (!stat.lastMonthInvested || m > stat.lastMonthInvested) {
          stat.lastMonthInvested = m;
        }

        if (!stat.lastPlacementDate || item.date > stat.lastPlacementDate) {
          stat.lastPlacementDate = item.date;
          stat.lastPlacementLabel = item.label;
        }
      });

      const list = Array.from(map.values()).sort((a, b) => {
        // Actives d'abord, puis par montant total décroissant
        if (a.isActiveInLatest && !b.isActiveInLatest) return -1;
        if (!a.isActiveInLatest && b.isActiveInLatest) return 1;
        return b.totalRealPlaced - a.totalRealPlaced;
      });

      const active = list.filter((p) => p.isActiveInLatest);
      const historical = list.filter(
        (p) => !p.isActiveInLatest && p.totalRealPlaced > 0,
      );

      return {
        pocketsMap: map,
        pocketsList: list,
        activePockets: active,
        historicalPockets: historical,
      };
    }, [latestStrategy, allPlacements]);

  // 4. Totaux globaux & KPIs
  const totalAllTimePlaced = useMemo(
    () =>
      Math.round(
        allPlacements.reduce((sum, p) => sum + (p.amount || 0), 0) * 100,
      ) / 100,
    [allPlacements],
  );

  const totalInitialCapital = useMemo(
    () =>
      Math.round(
        pocketsList.reduce((sum, pocket) => sum + pocket.initialCapital, 0) *
          100,
      ) / 100,
    [pocketsList],
  );

  const totalTrackedCapital = totalInitialCapital + totalAllTimePlaced;

  const totalP1Placed = useMemo(
    () =>
      Math.round(
        allPlacements
          .filter(
            (p) =>
              p.payerPersonId === "person1" || !p.payerPersonId,
          )
          .reduce((sum, p) => sum + (p.amount || 0), 0) * 100,
      ) / 100,
    [allPlacements],
  );

  const totalP2Placed = useMemo(
    () =>
      Math.round(
        allPlacements
          .filter(
            (p) => p.payerPersonId === "person2",
          )
          .reduce((sum, p) => sum + (p.amount || 0), 0) * 100,
      ) / 100,
    [allPlacements],
  );

  const activeMonthsWithData = useMemo(() => {
    const set = new Set<string>();
    allPlacements.forEach((p) => set.add(p.monthKey));
    return set.size;
  }, [allPlacements]);

  const monthlyAveragePlaced = useMemo(() => {
    if (activeMonthsWithData <= 0) return 0;
    return Math.round((totalAllTimePlaced / activeMonthsWithData) * 100) / 100;
  }, [totalAllTimePlaced, activeMonthsWithData]);

  // Taux d'épargne réel moyen calculé sur les mois ayant des revenus
  const averageRealSavingsRate = useMemo(() => {
    const allIncs = getStoredIncomes();
    const incomeByMonth: Record<string, number> = {};
    allIncs.forEach((i) => {
      if (i.month) {
        incomeByMonth[i.month] =
          (incomeByMonth[i.month] || 0) + (i.amount || 0);
      }
    });

    let ratesSum = 0;
    let monthsCount = 0;

    Object.entries(incomeByMonth).forEach(([m, inc]) => {
      if (inc > 0) {
        const placed = allPlacements
          .filter((p) => p.monthKey === m)
          .reduce((sum, p) => sum + (p.amount || 0), 0);
        ratesSum += (placed / inc) * 100;
        monthsCount++;
      }
    });

    if (monthsCount === 0) return 0;
    return Math.round((ratesSum / monthsCount) * 10) / 10;
  }, [allPlacements]);

  // 5. Données pour le Graphique Mensuel Empilé (Stacked Bar Chart)
  const stackedBarData = useMemo(() => {
    return allMonthsChrono.map((mKey) => {
      const point: Record<string, any> = {
        month: mKey,
        monthLabel: formatMonthLabel(mKey).split(" ")[0],
        monthFull: formatMonthLabel(mKey),
        total: 0,
      };

      pocketsList.forEach((pocket) => {
        const amt = pocket.monthlyPlacements[mKey] || 0;
        point[pocket.id] = amt;
        point.total = Math.round((point.total + amt) * 100) / 100;
      });

      return point;
    });
  }, [allMonthsChrono, pocketsList]);

  // 6. Données pour la Trajectoire Cumulée (Cumulative Area Chart)
  const cumulativeData = useMemo(() => {
    let runningTotal = totalInitialCapital;
    return allMonthsChrono.map((mKey) => {
      const monthPlacements = allPlacements
        .filter((p) => p.monthKey === mKey)
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      runningTotal = Math.round((runningTotal + monthPlacements) * 100) / 100;

      return {
        month: mKey,
        monthLabel: formatMonthLabel(mKey).split(" ")[0],
        monthFull: formatMonthLabel(mKey),
        monthlyAdded: monthPlacements,
        cumulativeTotal: runningTotal,
      };
    });
  }, [allMonthsChrono, allPlacements, totalInitialCapital]);

  // 7. Données pour le Donut Chart
  const donutPocketsData = useMemo(() => {
    return pocketsList
      .filter((p) => p.initialCapital + p.totalRealPlaced > 0)
      .map((p) => ({
        name: p.name,
        value: p.initialCapital + p.totalRealPlaced,
        color: p.color,
        id: p.id,
      }));
  }, [pocketsList]);

  const donutPersonsData = useMemo(() => {
    const res = [{ name: p1Name, value: totalP1Placed, color: p1Color }];
    if (!isSoloMode && totalP2Placed > 0) {
      res.push({ name: p2Name, value: totalP2Placed, color: p2Color });
    }
    return res;
  }, [
    p1Name,
    p2Name,
    isSoloMode,
    totalP1Placed,
    totalP2Placed,
    p1Color,
    p2Color,
  ]);

  // 8. Filtrage des cartes de poches
  const filteredPocketsList = useMemo(() => {
    return pocketsList.filter((poc) => {
      if (pocketFilter === "active" && !poc.isActiveInLatest) return false;
      if (
        pocketFilter === "historical" &&
        (poc.isActiveInLatest || poc.totalRealPlaced === 0)
      )
        return false;
      if (pocketSearch.trim()) {
        const query = pocketSearch.toLowerCase();
        return (
          poc.name.toLowerCase().includes(query) ||
          (poc.category && poc.category.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [pocketsList, pocketFilter, pocketSearch]);

  // 9. Filtrage du Journal des Placements
  const filteredPlacementsLog = useMemo(() => {
    return allPlacements.filter((item) => {
      if (
        journalPocketFilter !== "all" &&
        item.pocketId !== journalPocketFilter
      ) {
        return false;
      }
      if (journalPersonFilter === "person1") {
        if (item.payerPersonId === "person2") return false;
      } else if (journalPersonFilter === "person2") {
        if (item.payerPersonId !== "person2") return false;
      }
      if (journalSearch.trim()) {
        const query = journalSearch.toLowerCase();
        return (
          item.label.toLowerCase().includes(query) ||
          item.pocketName.toLowerCase().includes(query) ||
          (item.notes && item.notes.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [allPlacements, journalPocketFilter, journalPersonFilter, journalSearch]);

  const projectionStrategy = useMemo<SavingsStrategy>(() => {
    const realByPocket = new Map(
      pocketsList.map((pocket) => [pocket.id, pocket]),
    );
    return {
      ...latestStrategy,
      pockets: latestStrategy.pockets.map((pocket) => {
        const real = realByPocket.get(pocket.id);
        if (!real) return { ...pocket, currentAmount: 0 };
        return {
          ...pocket,
          currentAmount: real.initialCapital + real.totalRealPlaced,
          person1Current: real.p1Placed,
          person2Current: real.p2Placed,
        };
      }),
    };
  }, [latestStrategy, pocketsList]);

  return (
    <div className="space-y-8 pb-16">
      {/* 1. Header & Actions Rapides */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] pb-5">
        <div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-[#f5f5f5]">
              Épargne & Placements Réels
            </h1>
            <p className="text-sm text-[#555555] mt-0.5">
              Suivi concret de vos capitaux placés, historique des poches et
              évolution mois par mois.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Cartes KPIs & Synthèse Globale */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Placé Tout Temps */}
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-[#8a8a8a]">
            Capital suivi
          </p>
          <p className="text-2xl font-bold text-[#f5f5f5]">
            {formatEur(totalTrackedCapital)}
          </p>
          <p className="text-xs text-[#8a8a8a] mt-2">
            Dont {formatEur(totalInitialCapital)} au départ et {allPlacements.length} versement
            {allPlacements.length > 1 ? "s" : ""} enregistré
            {allPlacements.length > 1 ? "s" : ""}
          </p>
        </div>

        {/* Moyenne Mensuelle */}
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-[#8a8a8a]">
            Moyenne Mensuelle
          </p>
          <p className="text-2xl font-bold text-[#f5f5f5]">
            {formatEur(monthlyAveragePlaced)}
            <span className="text-xs font-normal text-[#555555] ml-1">
              / mois
            </span>
          </p>
          <p className="text-xs text-[#8a8a8a] mt-2">
            Sur {activeMonthsWithData} mois actif
            {activeMonthsWithData > 1 ? "s" : ""}
          </p>
        </div>

        {/* Taux d'épargne réel moyen */}
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-[#8a8a8a]">
            Taux d'Épargne Moyen
          </p>
          <p className="text-2xl font-bold text-[#f5f5f5]">
            {averageRealSavingsRate}%
          </p>
          <p className="text-xs text-[#8a8a8a] mt-2">
            Part réelle des revenus consacrée aux placements
          </p>
        </div>

        {/* Répartition Couple / Poches */}
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-[#8a8a8a]">
            {isSoloMode ? "Poches Suivies" : "Répartition du Couple"}
          </p>
          <div className="mt-2 w-full">
            {isSoloMode ? (
              <>
                <div className="text-2xl font-black text-[#f5f5f5]">
                  {activePockets.length} actives
                </div>
                <div className="text-xs text-[#555555] mt-1">
                  {historicalPockets.length} poche
                  {historicalPockets.length > 1 ? "s" : ""} historique
                  {historicalPockets.length > 1 ? "s" : ""}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                  <span style={{ color: p1Color }}>
                    {p1Name} : {formatEur(totalP1Placed)}
                  </span>
                  <span style={{ color: p2Color }}>
                    {p2Name} : {formatEur(totalP2Placed)}
                  </span>
                </div>
                <div className="w-full bg-[#2d2d2d] h-2 rounded-full overflow-hidden flex">
                  <div
                    style={{
                      width: `${totalAllTimePlaced > 0 ? (totalP1Placed / totalAllTimePlaced) * 100 : 50}%`,
                      backgroundColor: p1Color,
                    }}
                    className="h-full"
                  />
                  <div
                    style={{
                      width: `${totalAllTimePlaced > 0 ? (totalP2Placed / totalAllTimePlaced) * 100 : 50}%`,
                      backgroundColor: p2Color,
                    }}
                    className="h-full"
                  />
                </div>
                <div className="text-[11px] text-[#555555] mt-1 text-right">
                  {totalAllTimePlaced > 0
                    ? `${Math.round((totalP1Placed / totalAllTimePlaced) * 100)}% / ${Math.round((totalP2Placed / totalAllTimePlaced) * 100)}%`
                    : "50% / 50%"}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 3. Section Graphiques Interactifs */}
      <div className="bg-[#111111] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-2xl p-5 shadow-xs space-y-4">
        {/* En-tête des graphiques avec onglets */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#f5f5f5]">
              Analyse Graphique des Placements
            </h2>
            <p className="text-xs text-[#555555] mt-0.5">
              Visualisez l'arrivée de chaque nouvelle poche et la trajectoire
              cumulée de votre épargne.
            </p>
          </div>

          <div className="flex items-center gap-1 bg-[#1a1a1a] bg-[#161616]/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveChartTab("stacked")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeChartTab === "stacked"
                  ? "bg-[#111111] dark:bg-[#1a1a1a] text-[#f5f5f5] shadow-xs"
                  : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              }`}
            >
              Évolution par poche
            </button>
            <button
              type="button"
              onClick={() => setActiveChartTab("cumulative")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeChartTab === "cumulative"
                  ? "bg-[#111111] dark:bg-[#1a1a1a] text-[#f5f5f5] shadow-xs"
                  : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              }`}
            >
              Capital cumulé
            </button>
            <button
              type="button"
              onClick={() => setActiveChartTab("donut")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeChartTab === "donut"
                  ? "bg-[#111111] dark:bg-[#1a1a1a] text-[#f5f5f5] shadow-xs"
                  : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              }`}
            >
              Répartition globale
            </button>
          </div>
        </div>

        {/* Contenu du graphique actif */}
        <div className="h-[360px] w-full pt-2">
          {activeChartTab === "stacked" && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stackedBarData}
                margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  opacity={0.15}
                  vertical={false}
                />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fontSize: 11 }}
                  axisLine={{ opacity: 0.2 }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${v} €`}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const totalMonth = payload.reduce(
                        (sum, item) => sum + (Number(item.value) || 0),
                        0,
                      );
                      const monthItem = payload[0].payload;
                      return (
                        <div className="bg-[#111111] dark:bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-xl p-3 shadow-xl text-xs space-y-1.5">
                          <div className="font-bold text-[#f5f5f5] pb-1 border-b border-[rgba(255,255,255,0.06)] flex justify-between gap-4">
                            <span>{monthItem.monthFull}</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-black">
                              Total : {formatEur(totalMonth)}
                            </span>
                          </div>
                          {payload
                            .filter((item) => Number(item.value) > 0)
                            .map((item) => (
                              <div
                                key={item.dataKey}
                                className="flex items-center justify-between gap-4"
                              >
                                <span className="flex items-center gap-1.5 text-[#8a8a8a]">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                  />
                                  <span>{item.name}</span>
                                </span>
                                <span className="font-bold text-[#f5f5f5]">
                                  {formatEur(Number(item.value))}
                                </span>
                              </div>
                            ))}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }}
                  formatter={(value) => {
                    const poc = pocketsList.find((p) => p.id === value);
                    return poc ? poc.name : value;
                  }}
                />
                {pocketsList.map((pocket) => (
                  <Bar
                    key={pocket.id}
                    dataKey={pocket.id}
                    name={pocket.name}
                    stackId="placements"
                    fill={pocket.color}
                    radius={[0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}

          {activeChartTab === "cumulative" && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={cumulativeData}
                margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
              >
                <defs>
                  <linearGradient
                    id="colorCumulative"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  opacity={0.15}
                  vertical={false}
                />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fontSize: 11 }}
                  axisLine={{ opacity: 0.2 }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${v} €`}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-[#111111] dark:bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-xl p-3 shadow-xl text-xs space-y-1">
                          <div className="font-bold text-[#f5f5f5] pb-1 border-b border-[rgba(255,255,255,0.06)]">
                            {data.monthFull}
                          </div>
                          <div className="flex justify-between gap-4 text-[#8a8a8a]">
                            <span>Ajouté ce mois :</span>
                            <span className="font-bold text-[#f5f5f5]">
                              +{formatEur(data.monthlyAdded)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 text-emerald-600 dark:text-emerald-400 font-bold">
                            <span>Capital cumulé :</span>
                            <span>{formatEur(data.cumulativeTotal)}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulativeTotal"
                  name="Capital Placé Cumulé"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorCumulative)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {activeChartTab === "donut" && (
            <div className="flex flex-col md:flex-row items-center justify-around h-full">
              <div className="w-full md:w-1/2 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPieChart>
                    <Pie
                      data={
                        donutMode === "pocket"
                          ? donutPocketsData
                          : donutPersonsData
                      }
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={105}
                      paddingAngle={3}
                    >
                      {(donutMode === "pocket"
                        ? donutPocketsData
                        : donutPersonsData
                      ).map((entry, idx) => (
                        <Cell key={`cell-${idx}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(val: number) => formatEur(val)}
                      contentStyle={{
                        borderRadius: "12px",
                        backgroundColor: "#111111",
                        borderColor: "#333",
                        fontSize: "12px",
                      }}
                    />
                  </RechartsPieChart>
                </ResponsiveContainer>
              </div>

              <div className="w-full md:w-1/2 flex flex-col justify-center space-y-3 px-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-[#555555] font-medium">
                    Répartir par :
                  </span>
                  <div className="inline-flex rounded-lg bg-[#1a1a1a] bg-[#161616] p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setDonutMode("pocket")}
                      className={`px-2.5 py-1 rounded-md font-semibold transition ${
                        donutMode === "pocket"
                          ? "bg-[#111111] bg-[#161616] text-[#f5f5f5] shadow-xs"
                          : "text-[#555555]"
                      }`}
                    >
                      Poches
                    </button>
                    {!isSoloMode && (
                      <button
                        type="button"
                        onClick={() => setDonutMode("person")}
                        className={`px-2.5 py-1 rounded-md font-semibold transition ${
                          donutMode === "person"
                            ? "bg-[#111111] bg-[#161616] text-[#f5f5f5] shadow-xs"
                            : "text-[#555555]"
                        }`}
                      >
                        Bénéficiaires
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-[220px] overflow-y-auto space-y-2 pr-2">
                  {(donutMode === "pocket"
                    ? donutPocketsData
                    : donutPersonsData
                  ).map((item) => {
                    const distributionTotal =
                      donutMode === "pocket"
                        ? totalTrackedCapital
                        : totalAllTimePlaced;
                    const pct =
                      distributionTotal > 0
                        ? (item.value / distributionTotal) * 100
                        : 0;
                    return (
                      <div
                        key={item.name}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-medium text-[#8a8a8a] truncate">
                            {item.name}
                          </span>
                        </div>
                        <div className="font-bold text-[#f5f5f5] whitespace-nowrap ml-2">
                          {formatEur(item.value)}{" "}
                          <span className="text-[#555555] font-normal">
                            ({pct.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Section Grille des Poches d'Épargne & Historique */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#f5f5f5]">
              Détail des Poches d'Épargne ({filteredPocketsList.length})
            </h2>
            <p className="text-xs text-[#555555] mt-0.5">
              Historique complet de chaque poche : montants investis depuis
              l'origine et statut dans la stratégie actuelle.
            </p>
          </div>

          {/* Filtres et Recherche */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]"
              />
              <input
                type="text"
                placeholder="Rechercher une poche..."
                value={pocketSearch}
                onChange={(e) => setPocketSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[#111111] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#f5f5f5] placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div className="flex items-center bg-[#1a1a1a] bg-[#161616]/80 p-0.5 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setPocketFilter("all")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  pocketFilter === "all"
                    ? "bg-[#111111] text-[#f5f5f5] shadow-xs"
                    : "text-[#555555]"
                }`}
              >
                Toutes ({pocketsList.length})
              </button>
              <button
                type="button"
                onClick={() => setPocketFilter("active")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  pocketFilter === "active"
                    ? "bg-[#111111] text-[#f5f5f5] shadow-xs"
                    : "text-[#555555]"
                }`}
              >
                Actives ({activePockets.length})
              </button>
              <button
                type="button"
                onClick={() => setPocketFilter("historical")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  pocketFilter === "historical"
                    ? "bg-[#111111] text-[#f5f5f5] shadow-xs"
                    : "text-[#555555]"
                }`}
              >
                Historiques ({historicalPockets.length})
              </button>
            </div>
          </div>
        </div>

        {/* Grille de cartes */}
        {filteredPocketsList.length === 0 ? (
          <div className="p-8 text-center bg-[#111111] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-2xl text-[#555555] text-sm">
            Aucune poche trouvée pour ce filtre.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPocketsList.map((poc) => {
              const isExpanded = selectedPocketDetailId === poc.id;
              const hasTarget = poc.targetAmount && poc.targetAmount > 0;
              const currentCapital = poc.initialCapital + poc.totalRealPlaced;
              const progressPct = hasTarget
                ? Math.min(
                    100,
                    Math.round((currentCapital / poc.targetAmount!) * 100),
                  )
                : 0;

              return (
                <div
                  key={poc.id}
                  className={`bg-[#111111] border rounded-2xl p-5 shadow-xs transition flex flex-col justify-between ${
                    poc.isActiveInLatest
                      ? "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] hover:border-emerald-500/40"
                      : "border-amber-200/60 dark:border-amber-900/40 bg-amber-500/[0.02]"
                  }`}
                >
                  <div>
                    {/* Header carte */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-xs"
                          style={{ backgroundColor: poc.color }}
                        />
                        <div>
                          <h3 className="font-bold text-[#f5f5f5] text-base">
                            {poc.name}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {poc.firstMonthInvested && (
                              <span className="text-[11px] text-[#555555] flex items-center gap-1">
                                <Clock size={11} /> Investi depuis{" "}
                                {formatMonthLabel(poc.firstMonthInvested)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Statut Badge */}
                      {poc.isActiveInLatest ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 whitespace-nowrap">
                          Active
                        </span>
                      ) : (
                        <span
                          className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 whitespace-nowrap"
                          title="Cette poche a reçu des versements dans le passé mais n'est plus configurée dans la stratégie du dernier mois"
                        >
                          Historique
                        </span>
                      )}
                    </div>

                    {/* Total réel placé */}
                    <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                      <div className="text-xs text-[#555555] uppercase tracking-wider font-semibold">
                        Capital suivi
                      </div>
                      <div className="text-2xl font-black text-[#f5f5f5] mt-1">
                        {formatEur(currentCapital)}
                      </div>
                      {poc.initialCapital > 0 && (
                        <p className="mt-1 text-[11px] text-[#555555]">
                          Dont {formatEur(poc.initialCapital)} de capital initial et {formatEur(poc.totalRealPlaced)} de versements suivis.
                        </p>
                      )}
                    </div>

                    {/* Répartition Romain / Sophie */}
                    {!isSoloMode && poc.totalRealPlaced > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex justify-between text-xs font-medium">
                          <span style={{ color: p1Color }}>
                            {p1Name} : {formatEur(poc.p1Placed)}
                          </span>
                          <span style={{ color: p2Color }}>
                            {p2Name} : {formatEur(poc.p2Placed)}
                          </span>
                        </div>
                        <div className="w-full bg-[#2d2d2d] h-1.5 rounded-full overflow-hidden flex">
                          <div
                            style={{
                              width: `${(poc.p1Placed / poc.totalRealPlaced) * 100}%`,
                              backgroundColor: p1Color,
                            }}
                            className="h-full"
                          />
                          <div
                            style={{
                              width: `${(poc.p2Placed / poc.totalRealPlaced) * 100}%`,
                              backgroundColor: p2Color,
                            }}
                            className="h-full"
                          />
                        </div>
                      </div>
                    )}

                    {/* Objectif / Cible */}
                    {hasTarget && (
                      <div className="mt-3.5 space-y-1">
                        <div className="flex justify-between text-xs text-[#555555]">
                          <span>
                            Progression cible ({formatEur(poc.targetAmount)})
                          </span>
                          <span className="font-bold text-[#f5f5f5]">
                            {progressPct}%
                          </span>
                        </div>
                        <div className="w-full bg-[#2d2d2d] h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${progressPct}%`,
                              backgroundColor: poc.color,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {poc.subItems && poc.subItems.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#555555]">
                          Sous-poches
                        </div>
                        {poc.subItems.map((sub) => {
                          const subPlaced = allPlacements
                            .filter(
                              (item) =>
                                item.pocketId === poc.id &&
                                (item.subPocketId === sub.id ||
                                  item.subPocketName?.toLowerCase() ===
                                    sub.name.toLowerCase()),
                            )
                            .reduce((sum, item) => sum + (item.amount || 0), 0);
                          const subInitialCapital = Number(sub.currentAmount) || 0;
                          const subCapital = subInitialCapital + subPlaced;
                          const subTarget = Number(sub.targetAmount) || 0;
                          const subProgress =
                            subTarget > 0
                              ? Math.min(100, (subCapital / subTarget) * 100)
                              : 0;
                          const subColor =
                            sub.personId === "person2" ? p2Color : p1Color;

                          return (
                            <div key={sub.id} className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-[#8a8a8a] truncate">
                                  {sub.name}
                                </span>
                                <span className="font-semibold text-[#f5f5f5] whitespace-nowrap">
                                  {subTarget > 0
                                    ? `${formatEur(subCapital)} / ${formatEur(subTarget)}`
                                    : `${formatEur(subCapital)} · ${formatEur(sub.amount)} / mois`}
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[#2d2d2d] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${subProgress}%`,
                                    backgroundColor: subColor,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Dernier versement */}
                    {poc.lastPlacementDate && (
                      <div className="mt-3 pt-2 text-[11px] text-[#555555] flex items-center justify-between">
                        <span>Dernier versement :</span>
                        <span className="font-semibold text-[#8a8a8a]">
                          {poc.lastPlacementDate}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions / Déplier l'historique */}
                  <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                    <span className="text-xs text-[#555555]">
                      {poc.placementsCount} versement
                      {poc.placementsCount > 1 ? "s" : ""}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPocketDetailId(isExpanded ? null : poc.id)
                      }
                      className="text-xs font-semibold text-[#c8a55e] text-[#c8a55e] hover:underline flex items-center gap-1"
                    >
                      <span>
                        {isExpanded ? "Masquer" : "Voir les versements"}
                      </span>
                      <ChevronRight
                        size={13}
                        className={`transition-transform duration-200 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      />
                    </button>
                  </div>

                  {/* Accordion versements détaillés */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] space-y-2 animate-in fade-in duration-200">
                      <div className="text-[11px] font-bold text-[#8a8a8a] uppercase tracking-wider">
                        Versements récents :
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                        {allPlacements
                          .filter((item) => item.pocketId === poc.id)
                          .map((item) => (
                            <div
                              key={item.id}
                              className="text-xs p-2 rounded-lg bg-[#0a0a0a] bg-[#161616]/40 flex items-center justify-between"
                            >
                              <div>
                                <div className="font-medium text-[#f5f5f5]  truncate max-w-[150px]">
                                  {item.label}
                                </div>
                                <div className="text-[10px] text-[#555555]">
                                  {item.date}
                                </div>
                              </div>
                              <div className="font-bold text-[#f5f5f5]">
                                {formatEur(item.amount)}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <SavingsProjectionPanel strategy={projectionStrategy} />

      {/* 5. Section Journal Détaillé de Tous les Placements */}
      <div className="bg-[#111111] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#f5f5f5]">
              Journal des Versements d'Épargne ({filteredPlacementsLog.length})
            </h2>
            <p className="text-xs text-[#555555] mt-0.5">
              Historique chronologique complet de chaque virement et placement
              exécuté.
            </p>
          </div>

          {/* Filtres du tableau */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Recherche textuelle */}
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555555]"
              />
              <input
                type="text"
                placeholder="Filtrer par libellé..."
                value={journalSearch}
                onChange={(e) => setJournalSearch(e.target.value)}
                className="pl-8 pr-3 py-1 text-xs rounded-xl bg-[#0a0a0a] bg-[#161616] border border-[rgba(255,255,255,0.06)] text-[#f5f5f5]"
              />
            </div>

            {/* Sélecteur de Poche */}
            <select
              value={journalPocketFilter}
              onChange={(e) => setJournalPocketFilter(e.target.value)}
              className="text-xs font-semibold py-1.5 px-3 rounded-xl bg-[#0a0a0a] bg-[#161616] border border-[rgba(255,255,255,0.06)] text-[#f5f5f5] "
            >
              <option value="all">Toutes les poches</option>
              {pocketsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Sélecteur Bénéficiaire */}
            {!isSoloMode && (
              <select
                value={journalPersonFilter}
                onChange={(e) => setJournalPersonFilter(e.target.value as any)}
                className="text-xs font-semibold py-1.5 px-3 rounded-xl bg-[#0a0a0a] bg-[#161616] border border-[rgba(255,255,255,0.06)] text-[#f5f5f5] "
              >
                <option value="all">Tous bénéficiaires</option>
                <option value="person1">{p1Name}</option>
                <option value="person2">{p2Name}</option>
              </select>
            )}
          </div>
        </div>

        {/* Tableau des transactions */}
        {filteredPlacementsLog.length === 0 ? (
          <div className="p-8 text-center text-[#555555] text-sm">
            Aucun versement ne correspond aux critères de recherche.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)] text-[#555555] font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Libellé</th>
                  <th className="py-2.5 px-3">Poche</th>
                  {!isSoloMode && <th className="py-2.5 px-3">Bénéficiaire</th>}
                  <th className="py-2.5 px-3">Mois</th>
                  <th className="py-2.5 px-3 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium">
                {filteredPlacementsLog.map((item) => {
                  const isP2 = item.payerPersonId === "person2";
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-[rgba(255,255,255,0.04)] transition"
                    >
                      <td className="py-3 px-3 text-[#555555] whitespace-nowrap">
                        {item.date}
                      </td>
                      <td className="py-3 px-3 font-bold text-[#f5f5f5]">
                        {item.label}
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-[#1a1a1a] bg-[#161616]">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: item.pocketColor }}
                          />
                          <span>{item.pocketName}</span>
                        </span>
                      </td>
                      {!isSoloMode && (
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                            style={{
                              backgroundColor: isP2
                                ? `${p2Color}15`
                                : `${p1Color}15`,
                              color: isP2 ? p2Color : p1Color,
                            }}
                          >
                            {isP2 ? p2Name : p1Name}
                          </span>
                        </td>
                      )}
                      <td className="py-3 px-3 text-[#555555] whitespace-nowrap">
                        {formatMonthLabel(item.monthKey)}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm whitespace-nowrap">
                        +{formatEur(item.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] font-bold text-[#f5f5f5] text-xs">
                  <td colSpan={isSoloMode ? 3 : 4} className="py-3 px-3">
                    Total filtré ({filteredPlacementsLog.length} opérations)
                  </td>
                  <td
                    colSpan={2}
                    className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400 text-sm font-black"
                  >
                    {formatEur(
                      filteredPlacementsLog.reduce(
                        (sum, item) => sum + (item.amount || 0),
                        0,
                      ),
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Savings;
