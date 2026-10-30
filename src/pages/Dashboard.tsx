import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Landmark,
  Coins,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  AccountSectionKind,
} from "../types";
import { Link } from "react-router-dom";
import type {
  PortfolioAccount,
  Overview,
  Holding,
} from "../types/portfolio";
import {
  getOverview,
  getAllHoldings,
  getAllTransactions,
} from "../services/portfolioApi";
import MarketClock from "../components/MarketClock";
import CashflowSpaghetti from "../components/CashflowSpaghetti";
import { useUser } from "../contexts/UserContext";
import { useCurrency } from "../contexts/CurrencyContext";
import {
  TimeGranularity,
  buildCashflowSeries,
  getTimeBucketKey,
} from "../utils/csvAnalytics";
import {
  WealthPeriod,
  WealthSnapshot,
  buildWealthChartSeries,
  getWealthHistory,
  recordWealthSnapshot,
} from "../utils/wealthHistory";

const PIE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#22c55e",
  "#eab308",
  "#a855f7",
];

export interface UnifiedHolding {
  id: string;
  name: string;
  symbol: string;
  envelopeId: string;
  envelopeLabel: string;
  type: "stock" | "etf" | "fund" | "crypto" | "bond" | "cash" | "other";
  quantity: number;
  buyingPrice: number;
  lastPrice: number;
  totalValue: number;
  investedValue: number;
  pnl: number;
  pnlPercent: number;
  allocationPercent: number;
  source: string;
}

type AccountSectionSummary = {
  id: string;
  label: string;
  kind: AccountSectionKind;
  balance: number | null;
  income?: number;
  expenses?: number;
  net?: number;
  pnl?: number | null;
  purchaseValue?: number | null;
  currentValue?: number | null;
};

const Dashboard: React.FC = () => {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [allHoldings, setAllHoldings] = useState<Holding[]>([]);
  const [cryptoAccounts, setCryptoAccounts] = useState<PortfolioAccount[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>("all");
  const [showEnvelopeDetails, setShowEnvelopeDetails] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Ouvre la section « Détails par enveloppe », sélectionne l'enveloppe et y défile
  const openEnvelopeDetails = (envelopeId: string) => {
    setSelectedPortfolio(envelopeId);
    setShowEnvelopeDetails(true);
    window.setTimeout(() => {
      const target =
        document.getElementById(`envelope-${envelopeId}`) ||
        document.getElementById("details-enveloppes");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  // Replie / déplie les onglets d'enveloppes (PEA, PEE, Banque, Crypto…)
  const toggleEnvelopeDetails = () => {
    const next = !showEnvelopeDetails;
    if (
      next &&
      !portfolioEnvelopes.some((envelope) => envelope.id === selectedPortfolio)
    ) {
      setSelectedPortfolio(portfolioEnvelopes[0]?.id ?? "all");
    }
    setShowEnvelopeDetails(next);
  };
  const [selectedAssetTypeFilter, setSelectedAssetTypeFilter] =
    useState<string>("all");
  const [loading, setLoading] = useState(true);
  const { currentUser } = useUser();

  // ===== CSV Comptes (bank/PEA/PEE) =====
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string>("");
  const [cashGranularity, setCashGranularity] =
    useState<TimeGranularity>("month");
  const [bankSeries, setBankSeries] = useState<any[]>([]);
  const [bankTxs, setBankTxs] = useState<any[]>([]);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string>("");
  const [focusedCategory, setFocusedCategory] = useState<string | null>(null);
  const [focusedSubCategory, setFocusedSubCategory] = useState<string | null>(
    null,
  );
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return document.documentElement.classList.contains("dark");
  });
  const [finaryPeriod, setFinaryPeriod] = useState<WealthPeriod>("1M");
  const [wealthHistory, setWealthHistory] = useState<WealthSnapshot[]>(() =>
    getWealthHistory(currentUser),
  );
  const [accountSummaries, setAccountSummaries] = useState<
    AccountSectionSummary[]
  >([]);

  useEffect(() => {
    const handleTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    window.addEventListener("themeChanged", handleTheme);
    return () => window.removeEventListener("themeChanged", handleTheme);
  }, []);
  const [cashSummary, setCashSummary] = useState({
    balance: null as number | null,
    income: 0,
    expenses: 0,
    net: 0,
  });
  const [investmentSummary, setInvestmentSummary] = useState({
    balance: 0,
    pnl: 0,
    purchaseValue: 0,
    currentValue: 0,
  });

  const {
    isMasked: isAnonymous,
    formatMoney,
    maskDigits,
    convertAmount,
  } = useCurrency();

  const formatCurrency = (value: number) =>
    formatMoney(value);
  const formatNumber = (value: number, locale: string = "fr-FR") =>
    maskDigits(Number(convertAmount(value) || 0).toLocaleString(locale, { maximumFractionDigits: 2 }));
  const formatPercent = (value: number, digits: number = 2) =>
    `${maskDigits(Number(value || 0).toFixed(digits).replace(".", ","))}%`;




  const loadPortfolioData = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError("");
    try {
      const [overviewData, holdingsData, txsData] = await Promise.all([
        getOverview(currentUser).catch(() => null),
        getAllHoldings(currentUser).catch(() => []),
        getAllTransactions(currentUser, { limit: 2000 }).catch(() => []),
      ]);

      if (overviewData) {
        setOverview(overviewData);
        const cryptoAccs = (overviewData.accounts || []).filter((a) => a.type === "CRYPTO");
        setCryptoAccounts(cryptoAccs);
      }
      setAllHoldings(holdingsData || []);

      const accounts = overviewData?.accounts || [];
      const holdingsByAcc = new Map<string, Holding[]>();
      for (const h of holdingsData || []) {
        if (!holdingsByAcc.has(h.accountId)) holdingsByAcc.set(h.accountId, []);
        holdingsByAcc.get(h.accountId)!.push(h);
      }

      // Convertir les transactions réelles en flux bancaires
      const bankTxsFormatted = (txsData || []).map((t) => ({
        date: new Date(t.date),
        amount: Number(t.amount) || 0,
        label: t.label || "",
        category: t.category || "Autre",
        subCategory: t.category || "",
        supplierFound: t.counterparty || t.label || "",
      }));
      setBankTxs(bankTxsFormatted);

      const series = buildCashflowSeries(bankTxsFormatted, cashGranularity);
      setBankSeries(
        series.map((p) => ({
          key: p.key,
          date: p.date,
          income: p.income,
          expenses: p.expenses,
          net: p.net,
          balance: p.endingBalance ?? null,
        })),
      );

      const totalIncome = bankTxsFormatted
        .filter((t) => t.amount >= 0)
        .reduce((s, t) => s + t.amount, 0);
      const totalExpenses = bankTxsFormatted
        .filter((t) => t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);

      const summaries: AccountSectionSummary[] = [];

      // Liquidités / Banques (Courants + livrets sans titres)
      const checkingAccounts = accounts.filter(
        (a) =>
          a.type === "CHECKING" ||
          (a.type === "SAVINGS" && (holdingsByAcc.get(a.id)?.length || 0) === 0),
      );
      const totalCash = checkingAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

      checkingAccounts.forEach((acc) => {
        summaries.push({
          id: acc.id,
          label: acc.name,
          kind: "bank",
          balance: acc.balance,
          income: 0,
          expenses: 0,
          net: 0,
        });
      });

      // Investissements (PEA, PEE, Titres, et contrats avec titres comme Gresham)
      const investmentAccounts = accounts.filter(
        (a) =>
          ["PEA", "SECURITIES", "EMPLOYEE_SAVINGS"].includes(a.type) ||
          (a.type === "SAVINGS" && (holdingsByAcc.get(a.id)?.length || 0) > 0),
      );

      let totalInvBalance = 0;
      let totalInvPnl = 0;
      let totalInvCost = 0;

      investmentAccounts.forEach((acc) => {
        const accHoldings = holdingsByAcc.get(acc.id) || [];
        const hVal = accHoldings.reduce((s, h) => s + (h.quantity || 0) * (h.price || 0), 0);
        const hCost = accHoldings.reduce(
          (s, h) => s + (h.costBasis ?? (h.quantity || 0) * (h.price || 0)),
          0,
        );
        const bal = Math.max(acc.balance, hVal);
        const pnl = hVal > 0 ? hVal - hCost : 0;

        totalInvBalance += bal;
        totalInvPnl += pnl;
        totalInvCost += bal - pnl;

        summaries.push({
          id: acc.id,
          label: acc.name,
          kind: "investment",
          balance: bal,
          currentValue: bal,
          purchaseValue: bal - pnl,
          pnl,
        });
      });

      setAccountSummaries(summaries);
      setCashSummary({
        balance: totalCash,
        income: totalIncome,
        expenses: totalExpenses,
        net: totalIncome - totalExpenses,
      });
      setInvestmentSummary({
        balance: totalInvBalance,
        currentValue: totalInvBalance,
        purchaseValue: totalInvCost,
        pnl: totalInvPnl,
      });
    } catch (err: any) {
      setAccountsError(err?.message || "Erreur de chargement du patrimoine");
    } finally {
      setAccountsLoading(false);
      setLoading(false);
    }
  }, [currentUser, cashGranularity]);

  useEffect(() => {
    void loadPortfolioData();

    const handleUpdate = () => {
      void loadPortfolioData();
    };

    window.addEventListener("portfolioUpdated", handleUpdate);
    window.addEventListener("walletsUpdated", handleUpdate);
    window.addEventListener("cryptoUpdated", handleUpdate);
    window.addEventListener("userSettingsUpdated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("portfolioUpdated", handleUpdate);
      window.removeEventListener("walletsUpdated", handleUpdate);
      window.removeEventListener("cryptoUpdated", handleUpdate);
      window.removeEventListener("userSettingsUpdated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [loadPortfolioData]);

  // Trier les séries par ordre décroissant (plus récentes en premier)
  const sortedBankSeries = React.useMemo(() => {
    return [...bankSeries].sort((a, b) => {
      // Comparer les dates pour trier par ordre décroissant
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA; // Ordre décroissant
    });
  }, [bankSeries]);

  // Courbe « Patrimoine net » : relevés historiques filtrés selon la période sélectionnée
  const wealthChartData = React.useMemo(
    () => buildWealthChartSeries(wealthHistory, finaryPeriod),
    [wealthHistory, finaryPeriod],
  );

  useEffect(() => {
    // Default bucket = latest (première dans la liste triée)
    if (!sortedBankSeries.length) {
      setSelectedBucketKey("");
      setFocusedCategory(null);
      setFocusedSubCategory(null);
      return;
    }
    setSelectedBucketKey((prev) => prev || sortedBankSeries[0].key);
    // keep last focused category (memory)
    setFocusedSubCategory(null);
  }, [sortedBankSeries]);

  // Agréger les transactions selon la granularité (pour le graphique cashflow)
  // Utilise toutes les transactions de toutes les périodes selon la granularité (comme le graphique évolution du solde)
  // Le graphique se met à jour quand la granularité change car bankTxs est recalculé dans le useEffect
  const expenseByCategoryForPeriod = React.useMemo(() => {
    if (!bankTxs.length) return [];
    const map = new Map<string, number>();
    // Prendre toutes les transactions de toutes les périodes selon la granularité
    // bankTxs est recalculé quand cashGranularity change via le useEffect
    for (const t of bankTxs) {
      if (t.amount >= 0) continue;
      const cat = (t.category || "Non catégorisé").toString();
      map.set(cat, (map.get(cat) || 0) + Math.abs(t.amount));
    }
    const result = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    // Force le re-render en créant un nouveau tableau à chaque fois
    return result;
  }, [bankTxs, cashGranularity]);

  const incomeByCategoryForPeriod = React.useMemo(() => {
    if (!bankTxs.length) return [];
    const map = new Map<string, number>();
    // Prendre toutes les transactions de toutes les périodes selon la granularité
    // bankTxs est recalculé quand cashGranularity change via le useEffect
    for (const t of bankTxs) {
      if (t.amount <= 0) continue;
      const cat = (t.category || "Non catégorisé").toString();
      map.set(cat, (map.get(cat) || 0) + Number(t.amount || 0));
    }
    const result = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    // Force le re-render en créant un nouveau tableau à chaque fois
    return result;
  }, [bankTxs, cashGranularity]);

  // Pour le détail par bucket (utilisé pour les autres graphiques)
  const expenseByCategoryForBucket = React.useMemo(() => {
    if (!selectedBucketKey) return [];
    const map = new Map<string, number>();
    for (const t of bankTxs) {
      const k = getTimeBucketKey(t.date, cashGranularity);
      if (k !== selectedBucketKey) continue;
      if (t.amount >= 0) continue;
      const cat = (t.category || "Non catégorisé").toString();
      map.set(cat, (map.get(cat) || 0) + Math.abs(t.amount));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [bankTxs, selectedBucketKey, cashGranularity]);

  const incomeByCategoryForBucket = React.useMemo(() => {
    if (!selectedBucketKey) return [];
    const map = new Map<string, number>();
    for (const t of bankTxs) {
      const k = getTimeBucketKey(t.date, cashGranularity);
      if (k !== selectedBucketKey) continue;
      if (t.amount <= 0) continue;
      const cat = (t.category || "Non catégorisé").toString();
      map.set(cat, (map.get(cat) || 0) + Number(t.amount || 0));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [bankTxs, selectedBucketKey, cashGranularity]);

  const topTransactionsForHover = React.useMemo(() => {
    if (!selectedBucketKey || !focusedCategory) return [];
    const filtered = bankTxs.filter((t: any) => {
      const k = getTimeBucketKey(t.date, cashGranularity);
      if (k !== selectedBucketKey) return false;
      if (t.amount >= 0) return false;
      const cat = (t.category || "Non catégorisé").toString();
      if (cat !== focusedCategory) return false;
      if (focusedSubCategory) {
        const sub = (t.subCategory || "Non catégorisé").toString();
        if (sub !== focusedSubCategory) return false;
      }
      return true;
    });

    return filtered
      .slice()
      .sort((a: any, b: any) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 10);
  }, [
    bankTxs,
    selectedBucketKey,
    focusedCategory,
    focusedSubCategory,
    cashGranularity,
  ]);

  const categoryColorMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    expenseByCategoryForBucket.forEach((c: any, idx: number) => {
      map[String(c.name)] = PIE_COLORS[idx % PIE_COLORS.length];
    });
    return map;
  }, [expenseByCategoryForBucket]);

  // Couleurs pour le graphique cashflow (basé sur le bucket sélectionné ou toutes les périodes)
  const incomeColorMapForCashflow = React.useMemo(() => {
    const data = selectedBucketKey
      ? incomeByCategoryForBucket
      : incomeByCategoryForPeriod;
    const map: Record<string, string> = {};
    data.forEach((c: any, idx: number) => {
      map[String(c.name)] = PIE_COLORS[(idx + 2) % PIE_COLORS.length];
    });
    return map;
  }, [selectedBucketKey, incomeByCategoryForBucket, incomeByCategoryForPeriod]);

  const categoryColorMapForCashflow = React.useMemo(() => {
    const data = selectedBucketKey
      ? expenseByCategoryForBucket
      : expenseByCategoryForPeriod;
    const map: Record<string, string> = {};
    data.forEach((c: any, idx: number) => {
      map[String(c.name)] = PIE_COLORS[idx % PIE_COLORS.length];
    });
    return map;
  }, [
    selectedBucketKey,
    expenseByCategoryForBucket,
    expenseByCategoryForPeriod,
  ]);

  const cashflowSpaghettiColorMap = React.useMemo(() => {
    return { ...incomeColorMapForCashflow, ...categoryColorMapForCashflow };
  }, [incomeColorMapForCashflow, categoryColorMapForCashflow]);

  // Ensure we always display something (memory): if no focusedCategory, use top category
  useEffect(() => {
    if (!selectedBucketKey) return;
    if (!expenseByCategoryForBucket.length) return;
    if (focusedCategory && categoryColorMap[focusedCategory]) return;
    setFocusedCategory(expenseByCategoryForBucket[0].name);
    setFocusedSubCategory(null);
  }, [
    selectedBucketKey,
    expenseByCategoryForBucket,
    focusedCategory,
    categoryColorMap,
  ]);


  // ===== Crypto total (comptes patrimoine crypto) =====
  const cryptoTotalValue = cryptoAccounts.reduce(
    (sum, acc) => sum + (acc.balance || 0),
    0,
  );

  // ===== Totaux consolidés du patrimoine connecté =====
  const bankCash = cashSummary.balance ?? 0;
  const investmentValue = investmentSummary.balance ?? 0;
  const hasOwnershipSplit = (overview?.accounts || []).some(
    (a) => (a.ownerships || []).length > 0,
  );
  const userNetWorth = overview?.perOwner?.[currentUser] ?? overview?.totals?.netWorth ?? null;
  const totalWealthAll =
    userNetWorth != null && (overview?.accounts || []).length > 0
      ? userNetWorth
      : bankCash + investmentValue + cryptoTotalValue;
  const totalInvestmentsAll = investmentValue;

  const totalInvestedInitial = investmentSummary.purchaseValue || 0;
  const totalCurrentInvestments =
    (investmentSummary.currentValue ?? investmentSummary.balance ?? 0) +
    cryptoTotalValue;
  const totalGainLoss = totalCurrentInvestments - totalInvestedInitial;
  const totalGainLossPercent =
    totalInvestedInitial > 0 ? (totalGainLoss / totalInvestedInitial) * 100 : 0;

  // ===== Historique du patrimoine net (courbe « Patrimoine net ») =====
  // Recharge les relevés quand l'utilisateur change.
  useEffect(() => {
    setWealthHistory(getWealthHistory(currentUser));
  }, [currentUser]);

  // Enregistre le patrimoine net du jour (un seul relevé par jour, mis à jour).
  useEffect(() => {
    if (!currentUser || totalWealthAll <= 0) return;
    setWealthHistory(recordWealthSnapshot(currentUser, totalWealthAll));
  }, [currentUser, totalWealthAll]);

  // ===== Positions Unifiées (Holdings) =====
  const unifiedHoldings = useMemo<UnifiedHolding[]>(() => {
    const accountsMap = new Map<string, PortfolioAccount>();
    (overview?.accounts || []).forEach((a) => accountsMap.set(a.id, a));

    const list: UnifiedHolding[] = allHoldings.map((h, idx) => {
      const account = accountsMap.get(h.accountId);
      const isCrypto =
        account?.type === "CRYPTO" ||
        h.ticker?.toUpperCase() === "BTC" ||
        h.ticker?.toUpperCase() === "ETH";
      const n = (h.name || h.ticker || "").toUpperCase();
      const isEtf =
        n.includes("ETF") ||
        n.includes("MSCI") ||
        n.includes("CW8") ||
        n.includes("SP500") ||
        n.includes("S&P") ||
        n.includes("ISHARES") ||
        n.includes("AMUNDI") ||
        n.includes("VANGUARD") ||
        n.includes("LYXOR");
      const isFund =
        n.includes("SICAV") ||
        n.includes("FCP") ||
        n.includes("OPCVM") ||
        n.includes("FONDS") ||
        n.includes("PART") ||
        n.includes("TRESORERIE") ||
        n.includes("SELECTION") ||
        n.includes("QUADRIGE") ||
        n.includes("SCHRODER") ||
        n.includes("STRATEGIE");

      const type: UnifiedHolding["type"] = isCrypto
        ? "crypto"
        : isEtf
        ? "etf"
        : isFund
        ? "fund"
        : "stock";

      const qty = Number(h.quantity || 0);
      const lastPrice = Number(h.price || 0);
      const totalVal = qty * lastPrice;
      const investedVal = h.costBasis != null ? Number(h.costBasis) : totalVal;
      const pnl = totalVal - investedVal;
      const pnlPercent = investedVal > 0 ? (pnl / investedVal) * 100 : 0;

      const envelopeLabel =
        account?.name || (isCrypto ? "Crypto & Web3" : "Investissement");
      const envelopeId = isCrypto ? "crypto" : h.accountId;

      return {
        id: h.id || `${h.accountId}-${h.ticker || h.name}-${idx}`,
        name: h.name || h.ticker || "Position",
        symbol: h.ticker || h.isin || h.name || "",
        envelopeId,
        envelopeLabel,
        type,
        quantity: qty,
        buyingPrice: qty > 0 && h.costBasis != null ? h.costBasis / qty : lastPrice,
        lastPrice,
        totalValue: totalVal,
        investedValue: investedVal,
        pnl,
        pnlPercent,
        allocationPercent: 0,
        source: account?.name || "Patrimoine",
      };
    });

    const total = list.reduce((s, h) => s + h.totalValue, 0);
    if (total > 0) {
      list.forEach((h) => {
        h.allocationPercent = (h.totalValue / total) * 100;
      });
    }

    return list;
  }, [allHoldings, overview]);

  // ===== Enveloppes de portefeuilles disponibles =====
  const portfolioEnvelopes = useMemo(() => {
    const list: Array<{
      id: string;
      label: string;
      kind: "all" | "investment" | "bank" | "crypto";
      totalValue: number;
      investedValue: number;
      pnl: number;
      pnlPercent: number;
      positionsCount: number;
      color: string;
      description: string;
    }> = [];

    const colors = [
      "#3b82f6",
      "#10b981",
      "#f59e0b",
      "#8b5cf6",
      "#ec4899",
      "#06b6d4",
      "#f97316",
      "#14b8a6",
    ];

    const accounts = overview?.accounts || [];
    const holdingsByAcc = new Map<string, Holding[]>();
    for (const h of allHoldings) {
      if (!holdingsByAcc.has(h.accountId)) holdingsByAcc.set(h.accountId, []);
      holdingsByAcc.get(h.accountId)!.push(h);
    }

    // 1. Enveloppes d'investissement (PEA, CTO, PEE, Assurance-vie comme Gresham)
    const investmentAccounts = accounts.filter(
      (a) =>
        ["PEA", "SECURITIES", "EMPLOYEE_SAVINGS"].includes(a.type) ||
        (a.type === "SAVINGS" && (holdingsByAcc.get(a.id)?.length || 0) > 0),
    );

    investmentAccounts.forEach((acc, idx) => {
      const accHoldings = holdingsByAcc.get(acc.id) || [];
      const holdingsTotal = accHoldings.reduce(
        (s, h) => s + (h.quantity || 0) * (h.price || 0),
        0,
      );
      const holdingsCost = accHoldings.reduce(
        (s, h) => s + (h.costBasis ?? (h.quantity || 0) * (h.price || 0)),
        0,
      );
      const totalVal = Math.max(acc.balance, holdingsTotal);
      const pnl = holdingsTotal > 0 ? holdingsTotal - holdingsCost : 0;
      const investedVal = totalVal - pnl;
      const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;

      const upper = acc.name.toUpperCase();
      list.push({
        id: acc.id,
        label: acc.name,
        kind: "investment",
        totalValue: totalVal,
        investedValue: investedVal,
        pnl,
        pnlPercent: pnlPct,
        positionsCount: accHoldings.length,
        color: colors[idx % colors.length],
        description: upper.includes("PEA")
          ? "Plan d'Épargne en Actions"
          : upper.includes("PER")
          ? "Plan d'Épargne Retraite"
          : upper.includes("ENTREPRISE") || upper.includes("PEE")
          ? "Plan d'Épargne Entreprise"
          : upper.includes("GRESHAM") || upper.includes("ASSURANCE") || upper.includes("VIE")
          ? "Contrat d'Assurance-Vie / Capitalisation"
          : "Compte Titres / Investissement",
      });
    });

    // 2. Liquidités & Banque (BoursoBank checking, livrets épargne sans titres)
    const bankAccounts = accounts.filter(
      (a) =>
        a.type === "CHECKING" ||
        (a.type === "SAVINGS" && (holdingsByAcc.get(a.id)?.length || 0) === 0),
    );
    const bankTotal = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    list.push({
      id: "bank",
      label: "Banque & Liquidités",
      kind: "bank",
      totalValue: bankTotal,
      investedValue: bankTotal,
      pnl: 0,
      pnlPercent: 0,
      positionsCount: bankAccounts.length,
      color: "#06b6d4",
      description: "Comptes courants et livrets bancaires",
    });

    // 3. Crypto & Web3
    const cryptoAccs = accounts.filter((a) => a.type === "CRYPTO");
    const cryptoHoldings = allHoldings.filter((h) => {
      const a = accounts.find((acc) => acc.id === h.accountId);
      return a?.type === "CRYPTO";
    });
    const cryptoTotal = cryptoAccs.reduce((sum, a) => sum + (a.balance || 0), 0);
    const cryptoCost = cryptoHoldings.reduce(
      (s, h) => s + (h.costBasis ?? (h.quantity || 0) * (h.price || 0)),
      0,
    );
    const cryptoPnl = cryptoTotal > 0 && cryptoCost > 0 ? cryptoTotal - cryptoCost : 0;
    const cryptoPnlPct = cryptoCost > 0 ? (cryptoPnl / cryptoCost) * 100 : 0;
    list.push({
      id: "crypto",
      label: "Crypto & Web3",
      kind: "crypto",
      totalValue: cryptoTotal,
      investedValue: cryptoCost || cryptoTotal,
      pnl: cryptoPnl,
      pnlPercent: cryptoPnlPct,
      positionsCount: cryptoHoldings.length,
      color: "#f97316",
      description: "Exchanges et wallets blockchain",
    });

    // Ordonner naturellement : PEA, PEE, Assurance vie, PER, Banque, Crypto, puis autres
    const orderScore = (id: string, label: string) => {
      const u = (label || id || "").toUpperCase();
      if (u.includes("PEA")) return 1;
      if (u.includes("ENTREPRISE") || u.includes("PEE")) return 2;
      if (u.includes("GRESHAM") || u.includes("ASSURANCE") || u.includes("VIE")) return 3;
      if (u.includes("PER") || u.includes("RETRAITE")) return 4;
      if (id === "bank" || u.includes("BANQUE")) return 5;
      if (id === "crypto" || u.includes("CRYPTO")) return 6;
      return 7;
    };
    list.sort((a, b) => orderScore(a.id, a.label) - orderScore(b.id, b.label));

    return list;
  }, [overview, allHoldings]);

  // Onglets des enveloppes (hors « Vue Globale », désormais toujours affichée)
  const navigationTabs = useMemo(() => {
    return portfolioEnvelopes.map((env) => ({
      id: env.id,
      label: env.label,
      kind: env.kind,
      description: env.description,
      totalValue: env.totalValue,
      color: env.color,
    }));
  }, [portfolioEnvelopes]);

  const selectedEnvelope = useMemo(() => {
    if (selectedPortfolio === "all") return null;
    return portfolioEnvelopes.find((p) => p.id === selectedPortfolio) || null;
  }, [selectedPortfolio, portfolioEnvelopes]);

  const accountDistributionItems = useMemo(() => {
    return portfolioEnvelopes
      .filter((env) => env.totalValue > 0)
      .map((env) => {
        const share =
          totalWealthAll > 0 ? (env.totalValue / totalWealthAll) * 100 : 0;
        let displayName = env.label;
        if (env.id === "bank") displayName = "Compte bancaire";
        else if (env.id === "crypto") displayName = "Crypto";

        return {
          id: env.id,
          name: displayName,
          value: env.totalValue,
          share,
          color: env.color,
          kind: env.kind,
        };
      });
  }, [portfolioEnvelopes, totalWealthAll]);

  // Filtres utilisateur (recherche + type d'actif), appliqués à la vue globale et aux enveloppes
  const filterHoldings = useCallback(
    (list: UnifiedHolding[]) => {
      let out = list;
      if (selectedAssetTypeFilter !== "all") {
        out = out.filter((h) => h.type === selectedAssetTypeFilter);
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        out = out.filter(
          (h) =>
            (h.name || "").toLowerCase().includes(q) ||
            (h.symbol || "").toLowerCase().includes(q) ||
            (h.envelopeLabel || "").toLowerCase().includes(q),
        );
      }
      return out;
    },
    [selectedAssetTypeFilter, searchQuery],
  );

  const globalFilteredHoldings = useMemo(
    () => filterHoldings(unifiedHoldings),
    [filterHoldings, unifiedHoldings],
  );

  // Répartition par type (à partir des comptes crypto)
  const typeDistribution: Record<string, number> = {};
  typeDistribution.crypto = cryptoTotalValue;


  const EmptyState = () => (
    <div className="col-span-full">
      <div className="text-center py-16">
        <div className="bg-[#1a1a1a] rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <BarChart3 size={32} className="text-[#555555]" />
        </div>
        <h3 className="text-xl font-semibold text-[#f5f5f5]">
          Aucun actif trouvé
        </h3>
        <p className="text-[#8a8a8a] mb-6 max-w-md mx-auto">
          Importez un relevé CSV (PEA, PEE, Banque) ou ajoutez un investissement
          pour visualiser les graphiques et analyses.
        </p>
        <Link to="/patrimoine" className="btn-primary">
          Gérer les comptes et patrimoines
        </Link>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto mb-4"></div>
              <p className="text-[#8a8a8a]">
                Chargement des données...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Erreur / chargement des comptes CSV */}
      {accountsError && (
        <div className="card border border-red-500/30 bg-red-500/10 text-red-300 text-sm px-4 py-3">
          Erreur lors du chargement des comptes : {accountsError}
        </div>
      )}
      {accountsLoading && (
        <div className="text-xs text-[#8a8a8a]">Chargement des comptes...</div>
      )}

      {/* Horloge des bourses */}
      <div className="flex justify-center">
        <MarketClock />
      </div>

      {/* ===== FINARY HERO SECTION ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patrimoine Net Card (Span 2) */}
        <div className="lg:col-span-2 card flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-[#f5f5f5]">Patrimoine net</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[#8a8a8a]">
                  Temps réel
                </span>
              </div>
              <div className="pill-tabs self-start sm:self-auto">
                {(["1J", "7J", "1M", "1A", "YTD", "ALL"] as const).map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setFinaryPeriod(period)}
                    className={`pill-tab ${finaryPeriod === period ? "active" : ""}`}
                  >
                    {period}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#f5f5f5] stat-value">
                {formatCurrency(totalWealthAll)}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    totalGainLoss >= 0 ? "badge-green" : "badge-red"
                  }`}
                >
                  {totalGainLoss >= 0 ? "+" : "-"}
                  {formatCurrency(Math.abs(totalGainLoss))} (
                  {totalGainLossPercent >= 0 ? "+" : "-"}
                  {formatPercent(Math.abs(totalGainLossPercent), 2)})
                </span>
                <span className="text-xs text-[#555555]">performance globale</span>
                {hasOwnershipSplit && (
                  <span className="text-xs text-[#8a8a8a] bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded-full border border-[rgba(255,255,255,0.08)]">
                    Part nette ({currentUser})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Glowing Area Chart */}
          <div className="h-48 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={wealthChartData}>
                <defs>
                  <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c8a55e" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#c8a55e" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis dataKey="dateLabel" stroke="#555555" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis hide domain={["dataMin - 100", "dataMax + 100"]} />
                <Tooltip
                  formatter={(val: any) => [formatCurrency(Number(val || 0)), "Patrimoine Net"]}
                  contentStyle={{
                    backgroundColor: isDark ? "#161616" : "#ffffff",
                    borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                    borderRadius: 10,
                    color: isDark ? "#f5f5f5" : "#0f172a",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                  }}
                  itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                  labelStyle={{ color: isDark ? "#8a8a8a" : "#64748b" }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#c8a55e"
                  strokeWidth={2.5}
                  fill="url(#goldGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {wealthHistory.length > 0 && wealthHistory.length < 10 && (
            <p className="text-[10px] text-[#555555] mt-1.5 text-right">
              Suivi depuis le{" "}
              {new Date(wealthHistory[0].t).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}{" "}
              · {wealthHistory.length}{" "}
              {wealthHistory.length > 1 ? "relevés" : "relevé"}
            </p>
          )}
        </div>

        {/* Allocation Card (Span 1) */}
        <div className="card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-semibold text-[#f5f5f5]">Allocation</h3>
            <Link to="/patrimoine" className="text-xs text-[#c8a55e] hover:underline">
              Voir tout
            </Link>
          </div>

          {/* Donut Chart with Center Total */}
          <div className="relative h-44 flex items-center justify-center my-2">
            {(() => {
              const rawItems = [
                { name: "Liquidités", value: Math.max(bankCash, 0), color: "#60a5fa" },
                { name: "Investissements", value: Math.max(totalInvestmentsAll, 0), color: "#c8a55e" },
                { name: "Crypto", value: Math.max(cryptoTotalValue, 0), color: "#a78bfa" },
              ].filter((d) => d.value > 0);
              const items =
                rawItems.length > 0
                  ? rawItems
                  : [{ name: "Aucun actif", value: 1, color: isDark ? "#262626" : "#e5e7eb" }];
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={items}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={72}
                      paddingAngle={rawItems.length > 1 ? 3 : 0}
                      stroke="none"
                    >
                      {items.map((entry, idx) => (
                        <Cell key={`hero-cell-${idx}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any, name: any) => {
                        const num = Number(val || 0);
                        const pct =
                          totalWealthAll > 0
                            ? ` (${((num / totalWealthAll) * 100).toFixed(1)}%)`
                            : "";
                        return [`${formatCurrency(num)}${pct}`, name || "Valeur"];
                      }}
                      contentStyle={{
                        backgroundColor: isDark ? "#161616" : "#ffffff",
                        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                        borderRadius: 10,
                        color: isDark ? "#f5f5f5" : "#0f172a",
                        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                      }}
                      itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                      labelStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              );
            })()}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-sm font-bold text-[#f5f5f5]">
                {formatCurrency(totalWealthAll)}
              </span>
              <span className="text-[10px] text-[#8a8a8a]">Total</span>
            </div>
          </div>

          {/* Breakdown bars */}
          <div className="space-y-2 pt-2 border-t border-[rgba(255,255,255,0.06)] text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[#8a8a8a]">
                <span className="w-2 h-2 rounded-full bg-[#60a5fa]"></span>
                Liquidités
              </span>
              <span className="font-medium text-[#f5f5f5]">
                {totalWealthAll > 0 ? formatPercent((bankCash / totalWealthAll) * 100, 1) : "0%"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[#8a8a8a]">
                <span className="w-2 h-2 rounded-full bg-[#c8a55e]"></span>
                Investissements
              </span>
              <span className="font-medium text-[#f5f5f5]">
                {totalWealthAll > 0 ? formatPercent((totalInvestmentsAll / totalWealthAll) * 100, 1) : "0%"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[#8a8a8a]">
                <span className="w-2 h-2 rounded-full bg-[#a78bfa]"></span>
                Crypto & Wallets
              </span>
              <span className="font-medium text-[#f5f5f5]">
                {totalWealthAll > 0 ? formatPercent((cryptoTotalValue / totalWealthAll) * 100, 1) : "0%"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section Répartition (largeur égale aux 2 petites modales réunies) & Métriques de Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Répartition par compte (50% de la largeur totale, équivalent aux 2 petites modales réunies) */}
        <div className="lg:col-span-6 card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-[#f5f5f5]">
                Répartition
              </h3>
              <p className="text-xs text-[#8a8a8a]">
                Poids et valorisation de chaque compte
              </p>
            </div>
            <span className="text-xs text-[#8a8a8a] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.04)]">
              {accountDistributionItems.length} comptes
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center my-auto">
            {/* Donut Chart with Center Total (identique à Allocation) */}
            <div className="sm:col-span-5 relative h-40 sm:h-44 flex items-center justify-center">
              {(() => {
                const rawItems = accountDistributionItems.filter(
                  (d) => d.value > 0,
                );
                const pieData =
                  rawItems.length > 0
                    ? rawItems
                    : [
                        {
                          id: "none",
                          name: "Aucun compte",
                          value: 1,
                          share: 100,
                          color: isDark ? "#262626" : "#e5e7eb",
                          kind: "all",
                        },
                      ];
                return (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={46}
                          outerRadius={66}
                          paddingAngle={rawItems.length > 1 ? 3 : 0}
                          stroke="none"
                        >
                          {pieData.map((entry, idx) => (
                            <Cell key={`repart-cell-${idx}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any, name: any) => {
                            const num = Number(val || 0);
                            const pct =
                              totalWealthAll > 0
                                ? ` (${((num / totalWealthAll) * 100).toFixed(1)}%)`
                                : "";
                            return [
                              `${formatCurrency(num)}${pct}`,
                              name || "Valeur",
                            ];
                          }}
                          contentStyle={{
                            backgroundColor: isDark ? "#161616" : "#ffffff",
                            borderColor: isDark
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.08)",
                            borderRadius: 10,
                            color: isDark ? "#f5f5f5" : "#0f172a",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                          }}
                          itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                          labelStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xs font-bold text-[#f5f5f5]">
                        {formatCurrency(totalWealthAll)}
                      </span>
                      <span className="text-[9px] text-[#8a8a8a]">Total</span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Breakdown bars / rows */}
            <div className="sm:col-span-7 space-y-1.5 pt-2 sm:pt-0 sm:border-l sm:border-[rgba(255,255,255,0.06)] sm:pl-4 text-xs">
              {accountDistributionItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => openEnvelopeDetails(item.id)}
                  className="group p-1.5 -mx-1 rounded-lg hover:bg-[rgba(255,255,255,0.03)] cursor-pointer transition-all"
                  title={`Voir le détail : ${item.name}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5 text-[#8a8a8a] group-hover:text-[#f5f5f5] transition-colors font-medium">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="truncate max-w-[110px] sm:max-w-[130px]">
                        {item.name}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#f5f5f5]">
                        {formatCurrency(item.value)}
                      </span>
                      <span className="text-[#8a8a8a] text-[11px] w-10 text-right">
                        {formatPercent(item.share, 1)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1 w-full bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(Math.max(item.share, 1), 100)}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Colonne droite : 4 petites cartes (Gain/Perte, Rendement, Portefeuilles Actifs, Taux d'Investissement) */}
        <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-2 gap-6 items-stretch">
          {/* Petite carte : Gain/Perte */}
          <div className="card flex flex-col justify-center text-center">
            <span className="text-xs text-[#8a8a8a] block mb-1">
              Gain / Perte
            </span>
            <span
              className={`text-2xl font-bold ${
                totalGainLoss >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
              }`}
            >
              {totalGainLoss >= 0 ? "+" : "-"}
              {formatCurrency(Math.abs(totalGainLoss))}
            </span>
            <span className="text-[11px] text-[#555555] block mt-0.5">
              {totalGainLossPercent >= 0 ? "+" : "-"}
              {formatPercent(Math.abs(totalGainLossPercent), 2)} · plus ou
              moins-value latente
            </span>
            <span className="text-[11px] text-[#555555] block mt-0.5">
              Investi initial {formatCurrency(totalInvestedInitial)}
            </span>
          </div>

          {/* Petite carte : Rendement */}
          <div className="card flex flex-col justify-center text-center">
            <span className="text-xs text-[#8a8a8a] block mb-1">Rendement</span>
            <span
              className={`text-2xl font-bold ${
                totalGainLossPercent >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
              }`}
            >
              {totalGainLossPercent >= 0 ? "+" : "-"}
              {formatPercent(Math.abs(totalGainLossPercent), 2)}
            </span>
            <span className="text-[11px] text-[#555555] block mt-0.5">
              Performance globale
            </span>
            <span className="text-[11px] text-[#555555] block mt-0.5">
              Investissements {formatCurrency(totalInvestmentsAll)}
            </span>
          </div>

          {/* Petite carte : Portefeuilles Actifs */}
          <div className="card flex flex-col justify-center text-center">
            <span className="text-xs text-[#8a8a8a] block mb-1">
              Portefeuilles Actifs
            </span>
            <span className="text-2xl font-bold text-[#c8a55e]">
              {portfolioEnvelopes.length}
            </span>
            <span className="text-[11px] text-[#555555] block mt-0.5">
              PEA, PEE, Banque, Crypto
            </span>
          </div>

          {/* Petite carte : Taux d'Investissement */}
          <div className="card flex flex-col justify-center text-center">
            <span className="text-xs text-[#8a8a8a] block mb-1">
              Taux d'Investissement
            </span>
            <span className="text-2xl font-bold text-[#f5f5f5]">
              {totalWealthAll > 0
                ? formatPercent(
                    ((totalWealthAll - bankCash) / totalWealthAll) * 100,
                    1,
                  )
                : "0%"}
            </span>
            <span className="text-[11px] text-[#555555] block mt-0.5">
              hors liquidités bancaires
            </span>
          </div>
        </div>
      </div>

      {/* ===== CONTENU PRINCIPAL PAR PORTEFEUILLE (BENTO GRID) ===== */}
      {unifiedHoldings.length === 0 &&
      bankCash === 0 &&
      cryptoTotalValue === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {/* ======================================================== */}
          {/* 1. VUE GLOBALE (PATRIMOINE CONSOLIDÉ) — toujours affichée */}
          {/* ======================================================== */}
          {/* Bento Row 1: KPI Cards & Répartition par Classe d'Actifs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card text-center flex flex-col justify-center">
                  <span className="text-xs text-[#8a8a8a] block mb-1">
                    Total des Actifs
                  </span>
                  <span className="text-2xl font-bold text-[#f5f5f5]">
                    {unifiedHoldings.length}
                  </span>
                  <span className="text-[11px] text-[#555555] block mt-0.5">
                    positions réparties
                  </span>
                </div>
                <div className="card text-center flex flex-col justify-center">
                  <span className="text-xs text-[#8a8a8a] block mb-1">
                    Plus Forte Ligne
                  </span>
                  <span className="text-2xl font-bold text-[#f5f5f5]">
                    {(() => {
                      const max = unifiedHoldings.reduce(
                        (m, h) => (h.totalValue > m ? h.totalValue : m),
                        0,
                      );
                      return totalWealthAll > 0
                        ? formatPercent((max / totalWealthAll) * 100, 1)
                        : "0%";
                    })()}
                  </span>
                  <span className="text-[11px] text-[#555555] block mt-0.5 truncate">
                    {(() => {
                      const topH = unifiedHoldings
                        .slice()
                        .sort((a, b) => b.totalValue - a.totalValue)[0];
                      return topH?.name || "Aucun";
                    })()}
                  </span>
                </div>
                {/* Répartition par Classe d'Actifs */}
                <div className="card md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-base font-semibold text-[#f5f5f5]">
                        Répartition par Classe d'Actifs
                      </h4>
                      <p className="text-xs text-[#8a8a8a]">
                        Actions, ETF, Crypto, Liquidités & autres
                      </p>
                    </div>
                  </div>

                  <div className="relative h-44 flex items-center justify-center">
                    {(() => {
                      const typeShares = unifiedHoldings.reduce((acc, h) => {
                        const t = h.type || "other";
                        acc[t] = (acc[t] || 0) + h.totalValue;
                        return acc;
                      }, {} as Record<string, number>);

                      const rawAssetData = [
                        {
                          name: "Actions",
                          value: typeShares["stock"] || 0,
                          color: "#3b82f6",
                        },
                        {
                          name: "ETF & Fonds",
                          value:
                            (typeShares["etf"] || 0) +
                            (typeShares["fund"] || 0),
                          color: "#10b981",
                        },
                        {
                          name: "Crypto",
                          value:
                            cryptoTotalValue || (typeShares["crypto"] || 0),
                          color: "#f97316",
                        },
                        {
                          name: "Liquidités",
                          value: bankCash || (typeShares["cash"] || 0),
                          color: "#06b6d4",
                        },
                        {
                          name: "Obligations / Autres",
                          value:
                            (typeShares["bond"] || 0) +
                            (typeShares["other"] || 0) +
                            (typeShares["real_estate"] || 0),
                          color: "#8b5cf6",
                        },
                      ].filter((d) => d.value > 0);

                      const assetData =
                        rawAssetData.length > 0
                          ? rawAssetData
                          : [
                              {
                                name: "Aucun actif",
                                value: 1,
                                color: isDark ? "#262626" : "#e5e7eb",
                              },
                            ];

                      return (
                        <>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={assetData}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={46}
                                outerRadius={66}
                                paddingAngle={rawAssetData.length > 1 ? 3 : 0}
                                stroke="none"
                              >
                                {assetData.map((d, idx) => (
                                  <Cell key={`asset-${idx}`} fill={d.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(val: any, name: any) => {
                                  const num = Number(val || 0);
                                  const pct =
                                    totalWealthAll > 0
                                      ? ` (${((num / totalWealthAll) * 100).toFixed(1)}%)`
                                      : "";
                                  return [`${formatCurrency(num)}${pct}`, name || "Valeur"];
                                }}
                                contentStyle={{
                                  backgroundColor: isDark
                                    ? "#161616"
                                    : "#ffffff",
                                  borderColor: isDark
                                    ? "rgba(255,255,255,0.08)"
                                    : "rgba(0,0,0,0.08)",
                                  borderRadius: 10,
                                  color: isDark ? "#f5f5f5" : "#0f172a",
                                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                                }}
                                itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                                labelStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-sm font-bold text-[#f5f5f5]">
                              {formatCurrency(totalWealthAll)}
                            </span>
                            <span className="text-[11px] text-[#8a8a8a]">
                              Actifs
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Légende classes d'actifs */}
                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                    {[
                      {
                        name: "Actions",
                        color: "#3b82f6",
                        val: unifiedHoldings
                          .filter((h) => h.type === "stock")
                          .reduce((s, h) => s + h.totalValue, 0),
                      },
                      {
                        name: "ETF & Fonds",
                        color: "#10b981",
                        val: unifiedHoldings
                          .filter((h) => h.type === "etf" || h.type === "fund")
                          .reduce((s, h) => s + h.totalValue, 0),
                      },
                      {
                        name: "Crypto",
                        color: "#f97316",
                        val: cryptoTotalValue,
                      },
                      {
                        name: "Liquidités",
                        color: "#06b6d4",
                        val: bankCash,
                      },
                    ].map((item) => {
                      const share =
                        totalWealthAll > 0
                          ? (item.val / totalWealthAll) * 100
                          : 0;
                      return (
                        <div
                          key={item.name}
                          className="flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-1.5 truncate pr-1">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="text-[#8a8a8a] truncate">
                              {item.name}
                            </span>
                          </div>
                          <span className="font-semibold text-[#f5f5f5] shrink-0">
                            {formatPercent(share, 1)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Bento Row 4: BarChart PnL Portefeuilles & Podiums Gagnants/Perdants */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* BarChart Comparatif PnL */}
                <div className="card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-base font-semibold text-[#f5f5f5]">
                        Comparaison des Plus/Moins-Values par Portefeuille
                      </h4>
                      <p className="text-xs text-[#8a8a8a]">
                        Gains et pertes nets générés par chaque compte
                      </p>
                    </div>
                  </div>

                  <div className="h-64">
                    {(() => {
                      const envGainData = portfolioEnvelopes
                        .filter((e) => e.kind === "investment" || e.pnl !== 0)
                        .map((e) => ({
                          name: e.label,
                          gain: e.pnl,
                          color: e.color,
                        }));
                      if (envGainData.length === 0) {
                        return (
                          <div className="h-full flex items-center justify-center text-sm text-[#8a8a8a]">
                            Aucune enveloppe d'investissement enregistrée.
                          </div>
                        );
                      }
                      return (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={envGainData}
                            margin={{ top: 20, right: 20, left: 10, bottom: 10 }}
                          >
                            <CartesianGrid
                              stroke="rgba(255,255,255,0.03)"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="name"
                              stroke="#555555"
                              fontSize={12}
                              tickLine={false}
                            />
                            <YAxis
                              stroke="#555555"
                              fontSize={11}
                              tickFormatter={(v) => `${v}€`}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              formatter={(val: any) => [
                                formatCurrency(Number(val || 0)),
                                "Plus/Moins-value",
                              ]}
                              contentStyle={{
                                backgroundColor: isDark ? "#161616" : "#ffffff",
                                borderColor: isDark
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(0,0,0,0.08)",
                                borderRadius: 10,
                                color: isDark ? "#f5f5f5" : "#0f172a",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                              }}
                              itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                              labelStyle={{ color: isDark ? "#8a8a8a" : "#64748b" }}
                            />
                            <Bar dataKey="gain" radius={[6, 6, 0, 0]}>
                              {envGainData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.gain >= 0 ? "#22c55e" : "#ef4444"}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </div>
                </div>

                {/* Podiums Top Gagnants & Top Perdants */}
                <div className="card flex flex-col justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-[#f5f5f5] mb-3">
                      Podium des Performances
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Gagnants */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#22c55e]">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          <span>Top Plus-Values</span>
                        </div>
                        <div className="space-y-1.5">
                          {unifiedHoldings
                            .filter((h) => h.pnl > 0)
                            .sort((a, b) => b.pnlPercent - a.pnlPercent)
                            .slice(0, 3)
                            .map((h) => (
                              <div
                                key={h.id}
                                className="p-2 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] text-xs"
                              >
                                <div className="font-semibold text-[#f5f5f5] truncate">
                                  {h.name}
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-[#22c55e] font-medium mt-0.5">
                                  <span>+{formatCurrency(h.pnl)}</span>
                                  <span>+{formatPercent(h.pnlPercent, 1)}</span>
                                </div>
                              </div>
                            ))}
                          {unifiedHoldings.filter((h) => h.pnl > 0).length ===
                            0 && (
                            <div className="text-xs text-[#8a8a8a] py-3 text-center">
                              Aucun gain latent
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Perdants */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#ef4444]">
                          <ArrowDownRight className="h-3.5 w-3.5" />
                          <span>Top Moins-Values</span>
                        </div>
                        <div className="space-y-1.5">
                          {unifiedHoldings
                            .filter((h) => h.pnl < 0)
                            .sort((a, b) => a.pnlPercent - b.pnlPercent)
                            .slice(0, 3)
                            .map((h) => (
                              <div
                                key={h.id}
                                className="p-2 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] text-xs"
                              >
                                <div className="font-semibold text-[#f5f5f5] truncate">
                                  {h.name}
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-[#ef4444] font-medium mt-0.5">
                                  <span>{formatCurrency(h.pnl)}</span>
                                  <span>{formatPercent(h.pnlPercent, 1)}</span>
                                </div>
                              </div>
                            ))}
                          {unifiedHoldings.filter((h) => h.pnl < 0).length ===
                            0 && (
                            <div className="text-xs text-[#8a8a8a] py-3 text-center">
                              Aucune perte latente
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a] text-center">
                    Surveillez la pondération pour optimiser votre diversification.
                  </div>
                </div>
              </div>

              {/* Bento Row 5: Tableau Comparatif des Performances par Enveloppe */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-base font-semibold text-[#f5f5f5]">
                      Tableau Comparatif des Performances par Enveloppe
                    </h4>
                    <p className="text-xs text-[#8a8a8a]">
                      Synthèse financière consolidée par portefeuille
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a]">
                        <th className="py-3 px-3 font-medium">Portefeuille</th>
                        <th className="py-3 px-3 font-medium text-right">
                          Capital Investi
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Valeur Actuelle
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Plus/Moins-Value
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Rendement (%)
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Part Patrimoine
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
                      {portfolioEnvelopes.map((env) => {
                        const share =
                          totalWealthAll > 0
                            ? (env.totalValue / totalWealthAll) * 100
                            : 0;
                        const isPositive = env.pnl >= 0;
                        return (
                          <tr
                            key={env.id}
                            className="hover:bg-[rgba(255,255,255,0.02)] transition-colors cursor-pointer"
                            onClick={() => openEnvelopeDetails(env.id)}
                          >
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: env.color }}
                                />
                                <span className="font-semibold text-[#f5f5f5]">
                                  {env.label}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#8a8a8a]">
                              {env.investedValue > 0
                                ? formatCurrency(env.investedValue)
                                : "—"}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5] font-bold">
                              {formatCurrency(env.totalValue)}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              {env.kind === "investment" &&
                              env.investedValue > 0 ? (
                                <span
                                  className={`font-semibold ${
                                    isPositive
                                      ? "text-[#22c55e]"
                                      : "text-[#ef4444]"
                                  }`}
                                >
                                  {isPositive ? "+" : ""}
                                  {formatCurrency(env.pnl)}
                                </span>
                              ) : (
                                <span className="text-[#555555]">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              {env.kind === "investment" &&
                              env.investedValue > 0 ? (
                                <span
                                  className={`font-bold ${
                                    isPositive
                                      ? "text-[#22c55e]"
                                      : "text-[#ef4444]"
                                  }`}
                                >
                                  {isPositive ? "+" : ""}
                                  {formatPercent(env.pnlPercent, 2)}
                                </span>
                              ) : (
                                <span className="text-[#555555]">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#8a8a8a] font-medium">
                              {formatPercent(share, 1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bento Row 6: Tableau Consolidé de Toutes les Positions */}
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div>
                    <h4 className="text-base font-semibold text-[#f5f5f5]">
                      Toutes les Positions Détenues (Patrimoine Consolidé)
                    </h4>
                    <p className="text-xs text-[#8a8a8a]">
                      Vue transverse de vos {unifiedHoldings.length} actifs
                    </p>
                  </div>

                  {/* Recherche et Filtres */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#555555]" />
                      <input
                        type="text"
                        placeholder="Rechercher un actif..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input-field !py-1 !pl-8 !pr-3 text-xs w-44"
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      {[
                        { id: "all", label: "Tous" },
                        { id: "stock", label: "Actions" },
                        { id: "etf", label: "ETF" },
                        { id: "crypto", label: "Crypto" },
                      ].map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setSelectedAssetTypeFilter(f.id)}
                          className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                            selectedAssetTypeFilter === f.id
                              ? "bg-[#c8a55e] text-black font-semibold"
                              : "bg-[rgba(255,255,255,0.03)] text-[#8a8a8a] hover:text-[#f5f5f5]"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a]">
                        <th className="py-3 px-3 font-medium">Actif</th>
                        <th className="py-3 px-3 font-medium">Portefeuille</th>
                        <th className="py-3 px-3 font-medium text-right">
                          Quantité
                        </th>
                        <th className="py-3 px-3 font-medium text-right">PRU</th>
                        <th className="py-3 px-3 font-medium text-right">
                          Cours
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Valeur
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Poids
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Plus/Moins-value
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
                      {globalFilteredHoldings.map((h) => {
                        const weight =
                          totalWealthAll > 0
                            ? (h.totalValue / totalWealthAll) * 100
                            : 0;
                        const isPositive = h.pnl >= 0;
                        return (
                          <tr
                            key={h.id}
                            className="hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                          >
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="font-semibold text-[#f5f5f5]">
                                {h.name}
                              </div>
                              <div className="text-xs text-[#555555]">
                                {h.symbol}
                              </div>
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.04)] text-[#8a8a8a] border border-[rgba(255,255,255,0.06)]">
                                {h.envelopeLabel}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5]">
                              {formatNumber(h.quantity)}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#8a8a8a]">
                              {h.buyingPrice > 0
                                ? formatCurrency(h.buyingPrice)
                                : "—"}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5] font-medium">
                              {h.lastPrice > 0
                                ? formatCurrency(h.lastPrice)
                                : "—"}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5] font-bold">
                              {formatCurrency(h.totalValue)}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap text-[#8a8a8a]">
                              {formatPercent(weight, 1)}
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              {h.investedValue > 0 && h.pnl !== 0 ? (
                                <div
                                  className={`font-semibold ${
                                    isPositive
                                      ? "text-[#22c55e]"
                                      : "text-[#ef4444]"
                                  }`}
                                >
                                  {isPositive ? "+" : ""}
                                  {formatCurrency(h.pnl)}
                                  <div className="text-[11px] font-normal">
                                    ({isPositive ? "+" : ""}
                                    {formatPercent(h.pnlPercent, 2)})
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[#555555]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

          {/* ======================================================== */}
          {/* 2. DÉTAILS PAR ENVELOPPE (repliable) — PEA, PEE, Banque, Crypto… */}
          {/* ======================================================== */}
          <div id="details-enveloppes" className="scroll-mt-24">
            {/* Simple flèche : déplie les onglets d'enveloppes et leur contenu */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={toggleEnvelopeDetails}
                className="p-2 text-[#8a8a8a] hover:text-[#c8a55e] transition-colors"
                aria-expanded={showEnvelopeDetails}
                aria-label={
                  showEnvelopeDetails
                    ? "Masquer les détails par enveloppe"
                    : "Afficher les détails par enveloppe"
                }
                title={showEnvelopeDetails ? "Masquer" : "Afficher"}
              >
                {showEnvelopeDetails ? (
                  <ChevronUp size={22} />
                ) : (
                  <ChevronDown size={22} />
                )}
              </button>
            </div>

            {showEnvelopeDetails && (
              <div className="mt-6">
                {/* Onglets par enveloppe (PEA, PEE, Banque, Crypto…) */}
                <div className="border-b border-[rgba(255,255,255,0.06)]">
                  <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto scrollbar-none">
                    {navigationTabs.map((tab) => {
                      const isActive = selectedPortfolio === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSelectedPortfolio(tab.id)}
                          className={`group inline-flex items-center gap-3 py-3.5 border-b-2 font-medium text-sm transition-all whitespace-nowrap ${
                            isActive
                              ? "border-[#c8a55e] text-[#c8a55e]"
                              : "border-transparent text-[#8a8a8a] hover:text-[#f5f5f5] hover:border-[rgba(255,255,255,0.1)]"
                          }`}
                        >
                          <div className="text-left">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm">
                                {tab.label}
                              </span>
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                  isActive
                                    ? "bg-[#c8a55e]/15 text-[#c8a55e]"
                                    : "bg-[rgba(255,255,255,0.06)] text-[#8a8a8a]"
                                }`}
                              >
                                {formatCurrency(tab.totalValue)}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#555555] font-normal hidden sm:block">
                              {tab.description}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </nav>
                </div>

                <div className="space-y-6 mt-6">
                  {selectedEnvelope &&
                    selectedEnvelope.kind === "investment" &&
                    (() => {
                      const envelope = selectedEnvelope;
                      const holdings = filterHoldings(
                        unifiedHoldings.filter(
                          (h) => h.envelopeId === envelope.id,
                        ),
                      );
                      return (
                        <div
                          id={`envelope-${envelope.id}`}
                          className="space-y-6 scroll-mt-24"
                        >
              {/* Hero Enveloppe */}
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: envelope.color }}
                      />
                      <h3 className="text-xl font-bold text-[#f5f5f5]">
                        {envelope.label}
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[#8a8a8a]">
                        {envelope.description}
                      </span>
                    </div>
                    <p className="text-xs text-[#8a8a8a]">
                      Vue détaillée et positions de votre portefeuille{" "}
                      {envelope.label}
                    </p>
                  </div>
                </div>

                {/* 4 Bento KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Valeur Actuelle
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {formatCurrency(envelope.totalValue)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Montant Investi (PRU)
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {formatCurrency(envelope.investedValue)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Plus/Moins-value
                    </span>
                    <span
                      className={`text-2xl font-bold ${
                        envelope.pnl >= 0
                          ? "text-[#22c55e]"
                          : "text-[#ef4444]"
                      }`}
                    >
                      {envelope.pnl >= 0 ? "+" : ""}
                      {formatCurrency(envelope.pnl)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Rendement Global
                    </span>
                    <span
                      className={`text-2xl font-bold ${
                        envelope.pnlPercent >= 0
                          ? "text-[#22c55e]"
                          : "text-[#ef4444]"
                      }`}
                    >
                      {envelope.pnlPercent >= 0 ? "+" : ""}
                      {formatPercent(envelope.pnlPercent, 2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Indicateurs de diversification et risque (Bento row) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="card text-center">
                  <span className="text-xs text-[#8a8a8a] block mb-1">
                    Poids 1ère Position
                  </span>
                  <span className="text-xl font-bold text-[#f5f5f5]">
                    {(() => {
                      const max = holdings.reduce(
                        (m, h) => (h.totalValue > m ? h.totalValue : m),
                        0,
                      );
                      return envelope.totalValue > 0
                        ? formatPercent(
                            (max / envelope.totalValue) * 100,
                            1,
                          )
                        : "0%";
                    })()}
                  </span>
                  <span className="text-[11px] text-[#555555] block mt-0.5">
                    Niveau de concentration
                  </span>
                </div>
                <div className="card text-center">
                  <span className="text-xs text-[#8a8a8a] block mb-1">
                    Poids Top 3 Positions
                  </span>
                  <span className="text-xl font-bold text-[#f5f5f5]">
                    {(() => {
                      const top3 = holdings
                        .slice()
                        .sort((a, b) => b.totalValue - a.totalValue)
                        .slice(0, 3)
                        .reduce((s, h) => s + h.totalValue, 0);
                      return envelope.totalValue > 0
                        ? formatPercent(
                            (top3 / envelope.totalValue) * 100,
                            1,
                          )
                        : "0%";
                    })()}
                  </span>
                  <span className="text-[11px] text-[#555555] block mt-0.5">
                    Part des 3 plus gros actifs
                  </span>
                </div>
                <div className="card text-center">
                  <span className="text-xs text-[#8a8a8a] block mb-1">
                    Lignes en Plus-Value
                  </span>
                  <span className="text-xl font-bold text-[#22c55e]">
                    {holdings.filter((h) => h.pnl > 0).length} /{" "}
                    {holdings.length}
                  </span>
                  <span className="text-[11px] text-[#555555] block mt-0.5">
                    Positions gagnantes
                  </span>
                </div>
              </div>

              {/* Bento Charts Grid : Donut + BarChart Performance + Top 5 */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Donut des positions de cette enveloppe */}
                <div className="card">
                  <h4 className="text-base font-semibold text-[#f5f5f5] mb-2">
                    Allocation — {envelope.label}
                  </h4>
                  <div className="relative h-64 flex items-center justify-center">
                    {(() => {
                      const rawHoldingsData = holdings
                        .filter((h) => h.totalValue > 0)
                        .map((h, i) => ({
                          name: h.name || "Actif",
                          value: h.totalValue,
                          color: PIE_COLORS[i % PIE_COLORS.length],
                        }));
                      const holdingsData =
                        rawHoldingsData.length > 0
                          ? rawHoldingsData
                          : [
                              {
                                name: "Aucune position",
                                value: 1,
                                color: isDark ? "#262626" : "#e5e7eb",
                              },
                            ];
                      return (
                        <>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={holdingsData}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={65}
                                outerRadius={95}
                                paddingAngle={
                                  rawHoldingsData.length > 1 ? 3 : 0
                                }
                                stroke="none"
                              >
                                {holdingsData.map((d, idx) => (
                                  <Cell
                                    key={`h-cell-${idx}`}
                                    fill={d.color}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(val: any, name: any) => [
                                  formatCurrency(Number(val || 0)),
                                  name || "Valeur",
                                ]}
                                contentStyle={{
                                  backgroundColor: isDark
                                    ? "#161616"
                                    : "#ffffff",
                                  borderColor: isDark
                                    ? "rgba(255,255,255,0.08)"
                                    : "rgba(0,0,0,0.08)",
                                  borderRadius: 10,
                                  color: isDark ? "#f5f5f5" : "#0f172a",
                                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                                }}
                                itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                                labelStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-base font-bold text-[#f5f5f5]">
                              {formatCurrency(envelope.totalValue)}
                            </span>
                            <span className="text-[11px] text-[#8a8a8a]">
                              {holdings.length} lignes
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* BarChart des plus/moins-values des lignes de cette enveloppe */}
                <div className="card">
                  <h4 className="text-base font-semibold text-[#f5f5f5] mb-2">
                    Performance des Lignes (€)
                  </h4>
                  <div className="h-64">
                    {(() => {
                      const holdingGainData = holdings
                        .filter((h) => h.pnl !== 0)
                        .map((h) => {
                          const rawName = h.name || "Actif";
                          return {
                            name:
                              rawName.length > 12
                                ? rawName.slice(0, 12) + "…"
                                : rawName,
                            pnl: h.pnl,
                          };
                        });
                      if (holdingGainData.length === 0) {
                        return (
                          <div className="h-full flex items-center justify-center text-sm text-[#8a8a8a]">
                            Aucune position avec plus ou moins-value.
                          </div>
                        );
                      }
                      return (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={holdingGainData}
                            margin={{ top: 15, right: 10, left: 0, bottom: 10 }}
                          >
                            <CartesianGrid
                              stroke="rgba(255,255,255,0.03)"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="name"
                              stroke="#555555"
                              fontSize={11}
                              tickLine={false}
                            />
                            <YAxis
                              stroke="#555555"
                              fontSize={10}
                              tickFormatter={(v) => `${v}€`}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              formatter={(val: any) => [
                                formatCurrency(Number(val || 0)),
                                "Plus/Moins-value",
                              ]}
                              contentStyle={{
                                backgroundColor: isDark
                                  ? "#161616"
                                  : "#ffffff",
                                borderColor: isDark
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(0,0,0,0.08)",
                                borderRadius: 10,
                                color: isDark ? "#f5f5f5" : "#0f172a",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                              }}
                              itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                              labelStyle={{ color: isDark ? "#8a8a8a" : "#64748b" }}
                            />
                            <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                              {holdingGainData.map((entry, index) => (
                                <Cell
                                  key={`hold-bar-${index}`}
                                  fill={
                                    entry.pnl >= 0 ? "#22c55e" : "#ef4444"
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </div>
                </div>

                {/* Top 5 pondérations du portefeuille */}
                <div className="card">
                  <h4 className="text-base font-semibold text-[#f5f5f5] mb-3">
                    Top 5 Plus Fortes Pondérations
                  </h4>
                  <div className="space-y-3">
                    {holdings.length === 0 ? (
                      <div className="text-xs text-[#8a8a8a] text-center py-8">
                        Aucune ligne détenue dans ce portefeuille.
                      </div>
                    ) : (
                      holdings
                        .slice()
                        .sort((a, b) => b.totalValue - a.totalValue)
                        .slice(0, 5)
                        .map((h, idx) => {
                          const pct =
                            envelope.totalValue > 0
                              ? (h.totalValue / envelope.totalValue) *
                                100
                              : 0;
                          return (
                            <div key={h.id} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-[#f5f5f5] truncate pr-2">
                                  {idx + 1}. {h.name}
                                </span>
                                <span className="text-[#8a8a8a] shrink-0">
                                  {formatCurrency(h.totalValue)} (
                                  {formatPercent(pct, 1)})
                                </span>
                              </div>
                              <div className="w-full bg-[rgba(255,255,255,0.06)] h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#c8a55e] rounded-full"
                                  style={{
                                    width: `${Math.min(100, pct)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>

              {/* Tableau des lignes détaillées de ce portefeuille */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-base font-semibold text-[#f5f5f5]">
                      Lignes Détenues — {envelope.label}
                    </h4>
                    <p className="text-xs text-[#8a8a8a]">
                      Détail complet des positions de ce compte
                    </p>
                  </div>
                  <span className="text-xs text-[#8a8a8a]">
                    {holdings.length} actifs
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a]">
                        <th className="py-3 px-3 font-medium">Position</th>
                        <th className="py-3 px-3 font-medium">Code ISIN</th>
                        <th className="py-3 px-3 font-medium text-right">
                          Quantité
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          PRU
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Cours Actuel
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Valeur Totale
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Poids
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Plus/Moins-value
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
                      {holdings.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-10 text-center text-sm text-[#8a8a8a]"
                          >
                            Aucune position enregistrée dans ce portefeuille.
                            <div className="mt-3">
                              <Link
                                to="/patrimoine"
                                className="btn-secondary !py-1.5 !px-3 text-xs inline-flex items-center gap-1.5"
                              >
                                <Landmark className="h-3.5 w-3.5 text-[#c8a55e]" />
                                <span>Gérer le patrimoine et imports CSV</span>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        holdings.map((h) => {
                          const weight =
                            envelope.totalValue > 0
                              ? (h.totalValue / envelope.totalValue) *
                                100
                              : 0;
                          const isPositive = h.pnl >= 0;
                          return (
                            <tr
                              key={h.id}
                              className="hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                            >
                              <td className="py-3 px-3 whitespace-nowrap">
                                <div className="font-semibold text-[#f5f5f5]">
                                  {h.name}
                                </div>
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap text-xs text-[#8a8a8a]">
                                {h.symbol}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5]">
                                {formatNumber(h.quantity)}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#8a8a8a]">
                                {h.buyingPrice > 0
                                  ? formatCurrency(h.buyingPrice)
                                  : "—"}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5] font-semibold">
                                {h.lastPrice > 0
                                  ? formatCurrency(h.lastPrice)
                                  : "—"}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5] font-bold">
                                {formatCurrency(h.totalValue)}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#8a8a8a]">
                                {formatPercent(weight, 1)}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap">
                                {h.investedValue > 0 && h.pnl !== 0 ? (
                                  <div
                                    className={`font-semibold ${
                                      isPositive
                                        ? "text-[#22c55e]"
                                        : "text-[#ef4444]"
                                    }`}
                                  >
                                    {isPositive ? "+" : ""}
                                    {formatCurrency(h.pnl)}
                                    <div className="text-[11px] font-normal">
                                      ({isPositive ? "+" : ""}
                                      {formatPercent(h.pnlPercent, 2)})
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[#555555]">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
                      </div>
                    );
                  })()}

                {selectedPortfolio === "bank" && (
                  <div id="envelope-bank" className="space-y-6 scroll-mt-24">
              {/* Header Hero Banque */}
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-3 rounded-full bg-[#06b6d4]" />
                      <h3 className="text-xl font-bold text-[#f5f5f5]">
                        Liquidités & Comptes Bancaires
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[#8a8a8a]">
                        Comptes courants & livrets
                      </span>
                    </div>
                    <p className="text-xs text-[#8a8a8a]">
                      Cumul de vos comptes courants, livrets d'épargne et flux
                      financiers
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Solde Total
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {formatCurrency(bankCash)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Entrées Cumulées
                    </span>
                    <span className="text-2xl font-bold text-[#22c55e]">
                      +{formatCurrency(cashSummary.income || 0)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Sorties Cumulées
                    </span>
                    <span className="text-2xl font-bold text-[#ef4444]">
                      -{formatCurrency(cashSummary.expenses || 0)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Épargne Nette
                    </span>
                    <span
                      className={`text-2xl font-bold ${
                        (cashSummary.net || 0) >= 0
                          ? "text-[#22c55e]"
                          : "text-[#ef4444]"
                      }`}
                    >
                      {(cashSummary.net || 0) >= 0 ? "+" : ""}
                      {formatCurrency(cashSummary.net || 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bento Grid des Comptes Bancaires Importés */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-base font-semibold text-[#f5f5f5]">
                    Comptes Bancaires Importés
                  </h4>
                  <Link
                    to="/patrimoine"
                    className="text-xs text-[#c8a55e] hover:underline inline-flex items-center gap-1"
                  >
                    <span>Gérer les comptes</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {accountSummaries
                    .filter((s) => s.kind === "bank")
                    .map((acc) => (
                      <div
                        key={acc.id}
                        className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)] flex flex-col justify-between"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-sm text-[#f5f5f5]">
                            {acc.label}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.04)] text-[#06b6d4]">
                            Banque
                          </span>
                        </div>
                        <div className="text-xl font-bold text-[#f5f5f5] mb-2">
                          {acc.balance != null
                            ? formatCurrency(acc.balance)
                            : "—"}
                        </div>
                        <div className="pt-2 border-t border-[rgba(255,255,255,0.05)] flex items-center justify-between text-xs text-[#8a8a8a]">
                          <span className="text-[#22c55e]">
                            +{formatNumber(acc.income || 0)}€
                          </span>
                          <span className="text-[#ef4444]">
                            -{formatNumber(acc.expenses || 0)}€
                          </span>
                        </div>
                      </div>
                    ))}
                  {accountSummaries.filter((s) => s.kind === "bank").length ===
                    0 && (
                    <div className="col-span-full py-6 text-center text-xs text-[#8a8a8a]">
                      Aucun compte bancaire détecté. Importez un relevé bancaire
                      CSV dans la page Banque.
                    </div>
                  )}
                </div>
              </div>

              {/* Bento Row: Cashflow Spaghetti & Dépenses par Catégorie */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cashflow Spaghetti */}
                <div className="card">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div>
                      <h4 className="text-base font-semibold text-[#f5f5f5]">
                        Flux de Trésorerie (Cashflow)
                      </h4>
                      <p className="text-xs text-[#8a8a8a]">
                        Répartition Entrées vs Dépenses par période
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="input-field py-1 px-3 text-xs w-auto"
                        value={cashGranularity}
                        onChange={(e) =>
                          setCashGranularity(e.target.value as any)
                        }
                      >
                        <option value="day">Jour</option>
                        <option value="week">Semaine</option>
                        <option value="month">Mois</option>
                        <option value="year">Année</option>
                      </select>
                      <select
                        className="input-field py-1 px-3 text-xs w-auto"
                        value={selectedBucketKey}
                        onChange={(e) => setSelectedBucketKey(e.target.value)}
                      >
                        {sortedBankSeries.map((b: any) => (
                          <option key={b.key} value={b.key}>
                            {b.key}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="h-72">
                    <CashflowSpaghetti
                      key={`cashflow-${cashGranularity}-${selectedBucketKey || "all"}`}
                      incomeByCategory={
                        selectedBucketKey
                          ? incomeByCategoryForBucket
                          : incomeByCategoryForPeriod
                      }
                      expenseByCategory={
                        selectedBucketKey
                          ? expenseByCategoryForBucket
                          : expenseByCategoryForPeriod
                      }
                      colorsByCategory={cashflowSpaghettiColorMap}
                      height={288}
                      isAnonymous={isAnonymous}
                    />
                  </div>
                </div>

                {/* Analyse des Dépenses par Catégorie */}
                <div className="card">
                  <div className="text-base font-semibold text-[#f5f5f5] mb-1">
                    Dépenses par Catégorie
                  </div>
                  <p className="text-xs text-[#8a8a8a] mb-4">
                    Période : {selectedBucketKey || "Toutes périodes"}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="h-60 flex items-center justify-center">
                      {expenseByCategoryForBucket.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={expenseByCategoryForBucket}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={50}
                              outerRadius={80}
                              paddingAngle={
                                expenseByCategoryForBucket.length > 1 ? 2 : 0
                              }
                              onMouseEnter={(_: any, idx: number) => {
                                const name =
                                  expenseByCategoryForBucket[idx]?.name;
                                if (name) {
                                  setFocusedCategory(String(name));
                                  setFocusedSubCategory(null);
                                }
                              }}
                            >
                              {expenseByCategoryForBucket.map(
                                (_: any, idx: number) => (
                                  <Cell
                                    key={`cell-${idx}`}
                                    fill={PIE_COLORS[idx % PIE_COLORS.length]}
                                  />
                                ),
                              )}
                            </Pie>
                            <Tooltip
                              formatter={(value: any, name: any) => [
                                formatCurrency(Number(value || 0)),
                                name,
                              ]}
                              contentStyle={{
                                backgroundColor: isDark ? "#161616" : "#ffffff",
                                borderColor: isDark
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(0,0,0,0.08)",
                                borderRadius: 10,
                                color: isDark ? "#f5f5f5" : "#0f172a",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                              }}
                              itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                              labelStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-sm text-[#8a8a8a] text-center">
                          Aucune dépense enregistrée sur cette période
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] p-3">
                      <div className="text-xs font-semibold text-[#f5f5f5] mb-2 truncate">
                        {focusedCategory
                          ? `${focusedCategory} — Top Dépenses`
                          : "Top Dépenses"}
                      </div>
                      <div className="space-y-1.5 max-h-52 overflow-auto pr-1">
                        {topTransactionsForHover.map((t: any, idx: number) => (
                          <div
                            key={`${t.label || t.supplierFound || "tx"}-${idx}`}
                            className="flex items-start justify-between text-xs gap-2 p-1.5 rounded bg-[rgba(255,255,255,0.02)]"
                          >
                            <div className="truncate">
                              <div className="text-[#f5f5f5] font-medium truncate">
                                {t.supplierFound || t.label || "Transaction"}
                              </div>
                              <div className="text-[#555555] text-[10px]">
                                {t.subCategory}
                              </div>
                            </div>
                            <div className="text-[#ef4444] font-semibold whitespace-nowrap">
                              -{formatCurrency(Math.abs(Number(t.amount || 0)))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
                  </div>
                )}

                {selectedPortfolio === "crypto" && (
                  <div id="envelope-crypto" className="space-y-6 scroll-mt-24">
              {/* Header Hero Crypto */}
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-3 rounded-full bg-[#f97316]" />
                      <h3 className="text-xl font-bold text-[#f5f5f5]">
                        Portefeuille Crypto & Web3
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[#8a8a8a]">
                        Binance & Wallets décentralisés
                      </span>
                    </div>
                    <p className="text-xs text-[#8a8a8a]">
                      Actifs crypto sur Binance et wallets on-chain (Ethereum,
                      Solana, Polygon, etc.)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Valeur Totale Crypto
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {formatCurrency(cryptoTotalValue)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Capital Investi
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {"—"}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Comptes & Wallets
                    </span>
                    <span className="text-2xl font-bold text-[#f97316]">
                      {cryptoAccounts.length}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Tokens Détenus
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {
                        unifiedHoldings.filter(
                          (h) => h.envelopeId === "crypto",
                        ).length
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Bento Grid Charts Crypto */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Donut Répartition Crypto */}
                <div className="card">
                  <h4 className="text-base font-semibold text-[#f5f5f5] mb-2">
                    Répartition des Tokens Détenus
                  </h4>
                  <div className="relative h-64 flex items-center justify-center">
                    {(() => {
                      const cryptoHoldings = unifiedHoldings
                        .filter((h) => h.envelopeId === "crypto")
                        .map((h, i) => ({
                          name: h.name || h.symbol || "Token",
                          value: h.totalValue,
                          color: PIE_COLORS[i % PIE_COLORS.length],
                        }));
                      const cData =
                        cryptoHoldings.length > 0
                          ? cryptoHoldings
                          : [
                              {
                                name: "Aucun token",
                                value: 1,
                                color: isDark ? "#262626" : "#e5e7eb",
                              },
                            ];
                      return (
                        <>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={cData}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={65}
                                outerRadius={95}
                                paddingAngle={cryptoHoldings.length > 1 ? 3 : 0}
                                stroke="none"
                              >
                                {cData.map((d, idx) => (
                                  <Cell
                                    key={`c-cell-${idx}`}
                                    fill={d.color}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(val: any, name: any) => [
                                  formatCurrency(Number(val || 0)),
                                  name || "Valeur",
                                ]}
                                contentStyle={{
                                  backgroundColor: isDark
                                    ? "#161616"
                                    : "#ffffff",
                                  borderColor: isDark
                                    ? "rgba(255,255,255,0.08)"
                                    : "rgba(0,0,0,0.08)",
                                  borderRadius: 10,
                                  color: isDark ? "#f5f5f5" : "#0f172a",
                                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                                }}
                                itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                                labelStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-base font-bold text-[#f5f5f5]">
                              {formatCurrency(cryptoTotalValue)}
                            </span>
                            <span className="text-[11px] text-[#8a8a8a]">
                              Total Crypto
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* BarChart Top Tokens par Valorisation */}
                <div className="card">
                  <h4 className="text-base font-semibold text-[#f5f5f5] mb-2">
                    Valorisation par Token (€)
                  </h4>
                  <div className="h-64">
                    {(() => {
                      const cBars = unifiedHoldings
                        .filter((h) => h.envelopeId === "crypto" && h.totalValue > 0)
                        .map((h) => ({
                          name: h.symbol || h.name,
                          value: h.totalValue,
                        }))
                        .slice(0, 8);
                      if (cBars.length === 0) {
                        return (
                          <div className="h-full flex items-center justify-center text-sm text-[#8a8a8a]">
                            Aucun token crypto valorisé.
                          </div>
                        );
                      }
                      return (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={cBars}
                            margin={{ top: 15, right: 10, left: 0, bottom: 10 }}
                          >
                            <CartesianGrid
                              stroke="rgba(255,255,255,0.03)"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="name"
                              stroke="#555555"
                              fontSize={11}
                              tickLine={false}
                            />
                            <YAxis
                              stroke="#555555"
                              fontSize={10}
                              tickFormatter={(v) => `${v}€`}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              formatter={(val: any) => [
                                formatCurrency(Number(val || 0)),
                                "Valeur",
                              ]}
                              contentStyle={{
                                backgroundColor: isDark
                                  ? "#161616"
                                  : "#ffffff",
                                borderColor: isDark
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(0,0,0,0.08)",
                                borderRadius: 10,
                                color: isDark ? "#f5f5f5" : "#0f172a",
                                boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                              }}
                              itemStyle={{ color: isDark ? "#f5f5f5" : "#0f172a" }}
                              labelStyle={{ color: isDark ? "#8a8a8a" : "#64748b" }}
                            />
                            <Bar
                              dataKey="value"
                              fill="#f97316"
                              radius={[6, 6, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Tableau des actifs crypto */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-base font-semibold text-[#f5f5f5]">
                    Tokens et Actifs Crypto
                  </h4>
                  <Link
                    to="/patrimoine?tab=crypto"
                    className="text-xs text-[#c8a55e] hover:underline inline-flex items-center gap-1"
                  >
                    <span>Gérer les wallets & Binance</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a]">
                        <th className="py-3 px-3 font-medium">Token</th>
                        <th className="py-3 px-3 font-medium">Plateforme</th>
                        <th className="py-3 px-3 font-medium text-right">
                          Solde
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Prix
                        </th>
                        <th className="py-3 px-3 font-medium text-right">
                          Valeur
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
                      {unifiedHoldings.filter((h) => h.envelopeId === "crypto")
                        .length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-10 text-center text-sm text-[#8a8a8a]"
                          >
                            Aucun actif crypto synchronisé.
                            <div className="mt-3">
                              <Link
                                to="/patrimoine?tab=crypto"
                                className="btn-secondary !py-1.5 !px-3 text-xs inline-flex items-center gap-1.5"
                              >
                                <Coins className="h-3.5 w-3.5 text-[#f97316]" />
                                <span>Connecter un wallet ou Binance</span>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        unifiedHoldings
                          .filter((h) => h.envelopeId === "crypto")
                          .map((h) => (
                            <tr
                              key={h.id}
                              className="hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                            >
                              <td className="py-3 px-3 whitespace-nowrap">
                                <div className="font-semibold text-[#f5f5f5]">
                                  {h.name}
                                </div>
                                <div className="text-xs text-[#555555]">
                                  {h.symbol}
                                </div>
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap text-xs text-[#8a8a8a]">
                                {h.source}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5]">
                                {formatNumber(h.quantity)}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#8a8a8a]">
                                {formatCurrency(h.lastPrice)}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap text-[#f5f5f5] font-bold">
                                {formatCurrency(h.totalValue)}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default Dashboard;
