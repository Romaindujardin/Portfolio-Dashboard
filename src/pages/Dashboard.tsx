import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  TrendingUp,
  BarChart3,
  Activity,
  ChevronDown,
  ChevronUp,
  Briefcase,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Filter,
  Landmark,
  Wallet as WalletIcon,
  Coins,
  ShieldCheck,
  CheckCircle2,
  PieChart as PieIcon,
  ArrowRight,
  Sparkles,
  Building2,
} from "lucide-react";
import {
  AccountSectionKind,
  BankCsvColumnMapping,
  InvestmentCsvColumnMapping,
  Wallet,
} from "../types";
import {
  getStoredWallets,
  getStoredBankCsvUploads,
  getBankCsvUploadById,
} from "../utils/storage";
import { Link } from "react-router-dom";
import MarketClock from "../components/MarketClock";
import CashflowSpaghetti from "../components/CashflowSpaghetti";
import { useUser } from "../contexts/UserContext";
import { getUserSettings } from "../utils/userSettings";
import {
  TimeGranularity,
  parseBankCsvTransactions,
  buildCashflowSeries,
  latestBalance,
  parsePeaCsvHoldings,
  PeaHolding,
  getTimeBucketKey,
  sumNumericColumn,
} from "../utils/csvAnalytics";

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
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedAssetTypeFilter, setSelectedAssetTypeFilter] =
    useState<string>("all");
  const [sectionHoldings, setSectionHoldings] = useState<
    Record<string, PeaHolding[]>
  >({});
  const [showBlockchainDetails, setShowBlockchainDetails] = useState(false);
  const [showWalletsDetail, setShowWalletsDetail] = useState(false);
  const [showCryptoDetail, setShowCryptoDetail] = useState(false);
  const [showTradfiDetail, setShowTradfiDetail] = useState(false);
  const [showNFTsDetail, setShowNFTsDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dashboardAnonymous") === "1";
  });
  const { currentUser } = useUser();
  const [userSettings, setUserSettings] = useState(() =>
    getUserSettings(currentUser),
  );
  const accountSections = userSettings.accountSections || [];

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
  const [finaryPeriod, setFinaryPeriod] = useState<
    "1J" | "7J" | "1M" | "1A" | "YTD" | "ALL"
  >("1M");
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

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "dashboardAnonymous") return;
      setIsAnonymous(event.newValue === "1");
    };
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as
        | { value?: boolean }
        | undefined;
      if (typeof detail?.value === "boolean") {
        setIsAnonymous(detail.value);
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "dashboardAnonymousChanged",
      handleCustom as EventListener,
    );
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "dashboardAnonymousChanged",
        handleCustom as EventListener,
      );
    };
  }, []);

  const maskDigits = (text: string) =>
    isAnonymous ? text.replace(/[0-9]/g, "*") : text;
  const formatNumber = (value: number, locale: string = "fr-FR") =>
    maskDigits(Number(value || 0).toLocaleString(locale));
  const formatCurrency = (value: number, locale: string = "fr-FR") =>
    `${formatNumber(value, locale)}€`;
  const formatDollar = (value: number, locale: string = "fr-FR") =>
    `$${formatNumber(value, locale)}`;
  const formatPercent = (value: number, digits: number = 2) =>
    `${maskDigits(Number(value || 0).toFixed(digits))}%`;
  const maskText = (text: string) => maskDigits(text);

  const loadWallets = async () => {
    try {
      const data = await getStoredWallets(currentUser);
      setWallets(data);
    } catch (error) {
      console.error("❌ Erreur lors du chargement des wallets:", error);
      setWallets([]);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await loadWallets();
      setLoading(false);
    };

    loadData();

    // Écouter les mises à jour des wallets
    const handleWalletUpdate = async () => {
      await loadWallets();
    };

    window.addEventListener("walletsUpdated", handleWalletUpdate);

    return () => {
      window.removeEventListener("walletsUpdated", handleWalletUpdate);
    };
  }, [currentUser]);

  useEffect(() => {
    setUserSettings(getUserSettings(currentUser));
  }, [currentUser]);

  useEffect(() => {
    const refresh = (event?: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as
        | { username?: string }
        | undefined;
      if (detail?.username && detail.username !== currentUser) return;
      setUserSettings(getUserSettings(currentUser));
    };
    window.addEventListener("userSettingsUpdated", refresh as EventListener);
    window.addEventListener("storage", refresh as EventListener);
    return () => {
      window.removeEventListener(
        "userSettingsUpdated",
        refresh as EventListener,
      );
      window.removeEventListener("storage", refresh as EventListener);
    };
  }, [currentUser]);

  useEffect(() => {
    const loadAccountCsv = async () => {
      setAccountsLoading(true);
      setAccountsError("");
      try {
        const summaries: AccountSectionSummary[] = [];
        const holdingsBySection: Record<string, PeaHolding[]> = {};
        const allBankTxs: any[] = [];
        let totalBankBalance = 0;
        let totalIncome = 0;
        let totalExpenses = 0;
        let totalInvestmentBalance = 0;
        let totalInvestmentPnl = 0;
        let totalInvestmentPurchase = 0;
        let totalInvestmentCurrent = 0;

        const buildHoldingsSummary = (
          holdings: ReturnType<typeof parsePeaCsvHoldings>,
        ) => {
          const getHoldingVal = (h: PeaHolding) =>
            h.amount && h.amount > 0
              ? h.amount
              : h.lastPrice && h.quantity
              ? h.lastPrice * h.quantity
              : 0;

          const balance =
            holdings.length > 0
              ? holdings.reduce((s, h) => s + getHoldingVal(h), 0)
              : null;

          const pnl =
            holdings.length > 0
              ? holdings.reduce((sum, h) => {
                  if (
                    h.amountVariation != null &&
                    Number.isFinite(h.amountVariation)
                  ) {
                    return sum + h.amountVariation;
                  }
                  if (
                    h.buyingPrice == null ||
                    h.lastPrice == null ||
                    !Number.isFinite(h.buyingPrice) ||
                    !Number.isFinite(h.lastPrice)
                  )
                    return sum;
                  const q = Number(h.quantity || 0);
                  if (!Number.isFinite(q) || q === 0) return sum;
                  return sum + (h.lastPrice - h.buyingPrice) * q;
                }, 0)
              : null;

          const purchaseValue =
            holdings.length > 0
              ? holdings.reduce((sum, h) => {
                  if (
                    h.buyingPrice != null &&
                    Number.isFinite(h.buyingPrice) &&
                    h.quantity > 0
                  ) {
                    return sum + h.buyingPrice * h.quantity;
                  }
                  const val = getHoldingVal(h);
                  if (
                    h.amountVariation != null &&
                    Number.isFinite(h.amountVariation)
                  ) {
                    return sum + Math.max(0, val - h.amountVariation);
                  }
                  return sum + val;
                }, 0)
              : 0;

          const currentValue = balance;
          return { balance, pnl, purchaseValue, currentValue };
        };

        const sumFromContents = (
          csvContents: string[],
          column?: string,
          multiplierColumn?: string,
        ): number | null => {
          if (!column) return null;
          let total = 0;
          let used = false;
          for (const content of csvContents) {
            const value = sumNumericColumn(content, column, multiplierColumn);
            if (value == null) continue;
            total += value;
            used = true;
          }
          return used ? total : null;
        };

        for (const section of accountSections) {
          const metas = await getStoredBankCsvUploads(currentUser, section.id);
          const contents = await Promise.all(
            metas.map(async (m) => {
              const u = await getBankCsvUploadById(m.id, currentUser);
              return u?.content || "";
            }),
          );

          const sectionMapping =
            (userSettings.csvColumnMappings?.[section.id] as
              | BankCsvColumnMapping
              | InvestmentCsvColumnMapping
              | undefined) || undefined;

          if (section.kind === "bank") {
            const txs = contents.flatMap((c) =>
              parseBankCsvTransactions(
                c,
                sectionMapping as BankCsvColumnMapping,
              ),
            );
            txs.sort((a, b) => a.date.getTime() - b.date.getTime());
            allBankTxs.push(...txs);
            const balance = latestBalance(txs);
            const income = txs
              .filter((t) => t.amount >= 0)
              .reduce((s, t) => s + t.amount, 0);
            const expenses = txs
              .filter((t) => t.amount < 0)
              .reduce((s, t) => s + Math.abs(t.amount), 0);
            const net = income - expenses;

            if (balance != null) totalBankBalance += balance;
            totalIncome += income;
            totalExpenses += expenses;

            summaries.push({
              id: section.id,
              label: section.label,
              kind: section.kind,
              balance,
              income,
              expenses,
              net,
            });
          } else {
            const holdings = contents.flatMap((c) =>
              parsePeaCsvHoldings(
                c,
                sectionMapping as InvestmentCsvColumnMapping,
              ),
            );
            holdingsBySection[section.id] = holdings;
            const holdingsSummary = buildHoldingsSummary(holdings);

            const investmentMapping =
              (sectionMapping as InvestmentCsvColumnMapping | undefined) ||
              undefined;
            const calcCurrent = sumFromContents(
              contents,
              investmentMapping?.currentValueColumn,
              investmentMapping?.currentValueMultiplierColumn,
            );
            const calcInitial = sumFromContents(
              contents,
              investmentMapping?.initialValueColumn,
              investmentMapping?.initialValueMultiplierColumn,
            );
            const calcPnl = sumFromContents(
              contents,
              investmentMapping?.pnlColumn,
            );
            const derivedPnl =
              calcCurrent != null && calcInitial != null
                ? calcCurrent - calcInitial
                : null;
            const derivedInitial =
              calcCurrent != null && calcPnl != null
                ? calcCurrent - calcPnl
                : null;

            const hasHoldings =
              holdings.length > 0 &&
              holdingsSummary.balance != null &&
              holdingsSummary.balance > 0;

            let balance = hasHoldings
              ? (calcCurrent != null && calcCurrent > holdingsSummary.balance
                  ? calcCurrent
                  : holdingsSummary.balance)
              : (calcCurrent ?? holdingsSummary.balance);

            if (balance == null && contents.length > 0) {
              const fallbackTxs = contents.flatMap((c) =>
                c ? parseBankCsvTransactions(c) : [],
              );
              balance = latestBalance(fallbackTxs);
            }

            const effectiveCurrent =
              balance ?? holdingsSummary.currentValue ?? calcCurrent;

            const effectivePurchase =
              hasHoldings && holdingsSummary.purchaseValue > 0
                ? holdingsSummary.purchaseValue
                : (calcInitial ??
                  derivedInitial ??
                  (holdingsSummary.purchaseValue > 0
                    ? holdingsSummary.purchaseValue
                    : null));

            const effectivePnl =
              hasHoldings && holdingsSummary.pnl != null
                ? holdingsSummary.pnl
                : (calcPnl ?? derivedPnl ?? holdingsSummary.pnl);

            summaries.push({
              id: section.id,
              label: section.label,
              kind: section.kind,
              balance,
              pnl: effectivePnl,
              purchaseValue: effectivePurchase,
              currentValue: effectiveCurrent,
            });

            totalInvestmentBalance += balance ?? 0;
            totalInvestmentPnl += effectivePnl ?? 0;
            totalInvestmentPurchase += effectivePurchase || 0;
            totalInvestmentCurrent += effectiveCurrent || 0;
          }
        }

        const series = buildCashflowSeries(allBankTxs, cashGranularity);
        const net = totalIncome - totalExpenses;
        const hasBankSections = accountSections.some((s) => s.kind === "bank");

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
        setBankTxs(allBankTxs);
        setSectionHoldings(holdingsBySection);
        setAccountSummaries(summaries);
        setCashSummary({
          balance: hasBankSections ? totalBankBalance : null,
          income: totalIncome,
          expenses: totalExpenses,
          net,
        });
        setInvestmentSummary({
          balance: totalInvestmentBalance,
          pnl: totalInvestmentPnl,
          purchaseValue: totalInvestmentPurchase,
          currentValue: totalInvestmentCurrent,
        });
      } catch (e: any) {
        setAccountsError(e?.message || "Erreur lors du chargement des CSV");
      } finally {
        setAccountsLoading(false);
      }
    };

    loadAccountCsv();
  }, [currentUser, cashGranularity, accountSections]);

  // Trier les séries par ordre décroissant (plus récentes en premier)
  const sortedBankSeries = React.useMemo(() => {
    return [...bankSeries].sort((a, b) => {
      // Comparer les dates pour trier par ordre décroissant
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA; // Ordre décroissant
    });
  }, [bankSeries]);

  // Filtrer les transactions pour le graphique "évolution du solde" selon le bucket sélectionné et la période
  // Affiche chaque transaction avec son solde (ACCOUNTBALANCE) pour le bucket sélectionné
  const balanceChartData = React.useMemo(() => {
    if (!bankTxs.length) return [];

    // Si pas de bucket sélectionné, afficher toutes les transactions avec leur solde
    if (!selectedBucketKey) {
      return bankTxs
        .filter((t) => t.accountBalance != null)
        .map((t) => ({
          date: t.date,
          key: getTimeBucketKey(t.date, cashGranularity),
          balance: t.accountBalance!,
          dateLabel: new Date(t.date).toLocaleDateString("fr-FR"),
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    // Filtrer les transactions du bucket sélectionné uniquement
    const filtered = bankTxs
      .filter((t) => {
        const bucketKey = getTimeBucketKey(t.date, cashGranularity);
        return bucketKey === selectedBucketKey && t.accountBalance != null;
      })
      .map((t) => ({
        date: t.date,
        key: getTimeBucketKey(t.date, cashGranularity),
        balance: t.accountBalance!,
        dateLabel: new Date(t.date).toLocaleDateString("fr-FR"),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    return filtered;
  }, [bankTxs, selectedBucketKey, cashGranularity]);

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

  const expenseBySubCategoryForBucket = React.useMemo(() => {
    if (!selectedBucketKey || !focusedCategory) return [];
    const map = new Map<string, number>();
    for (const t of bankTxs) {
      const k = getTimeBucketKey(t.date, cashGranularity);
      if (k !== selectedBucketKey) continue;
      if (t.amount >= 0) continue;
      const cat = (t.category || "Non catégorisé").toString();
      if (cat !== focusedCategory) continue;
      const sub = (t.subCategory || "Non catégorisé").toString();
      map.set(sub, (map.get(sub) || 0) + Math.abs(t.amount));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [bankTxs, selectedBucketKey, focusedCategory, cashGranularity]);

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

  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "").trim();
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }

    return { h, s, l };
  };

  const hslToRgb = (h: number, s: number, l: number) => {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    let r: number, g: number, b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
    };
  };

  const rgbToHex = (r: number, g: number, b: number) =>
    `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;

  const shadeFromBase = (baseHex: string, idx: number, total: number) => {
    // Create shades by varying lightness around base
    const { r, g, b } = hexToRgb(baseHex);
    const hsl = rgbToHsl(r, g, b);
    const span = 0.28; // how much lightness range
    const t = total <= 1 ? 0.5 : idx / (total - 1);
    const l = Math.min(0.92, Math.max(0.18, hsl.l * (1 - span) + span * t));
    const rgb = hslToRgb(hsl.h, Math.min(1, hsl.s * 0.95), l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  };

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


  // Calculs des statistiques
  // ===== Crypto total (wallets + NFTs) =====
  const cryptoWalletsValue = wallets.reduce((sum, wallet) => {
    const assetsValue = (wallet.assets || [])
      .filter((a) => !a.isHidden)
      .reduce((s, a) => s + (a.value || 0), 0);
    const nftsValue = (wallet.nfts || [])
      .filter((n) => !n.isHidden)
      .reduce((s, n) => s + (n.value || 0), 0);
    return sum + assetsValue + nftsValue;
  }, 0);
  const cryptoTotalValue = cryptoWalletsValue;

  // ===== Totaux incluant CSV (banque / investissement) + crypto =====
  const bankCash = cashSummary.balance ?? 0;
  const investmentValue = investmentSummary.balance ?? 0;
  const totalWealthAll = bankCash + investmentValue + cryptoTotalValue;
  const totalInvestmentsAll = investmentValue;

  const totalInvestedInitial = investmentSummary.purchaseValue || 0;
  const totalCurrentInvestments =
    (investmentSummary.currentValue ?? investmentSummary.balance ?? 0) +
    cryptoTotalValue;
  const totalGainLoss = totalCurrentInvestments - totalInvestedInitial;
  const totalGainLossPercent =
    totalInvestedInitial > 0 ? (totalGainLoss / totalInvestedInitial) * 100 : 0;

  // ===== Positions Unifiées (Holdings) =====
  const unifiedHoldings = useMemo<UnifiedHolding[]>(() => {
    const list: UnifiedHolding[] = [];

    // 1. Enveloppes d'investissement CSV (PEA, PEE, etc.)
    accountSections
      .filter((s) => s.kind === "investment")
      .forEach((section) => {
        const holdings = sectionHoldings[section.id] || [];
        holdings.forEach((h, idx) => {
          const n = (h.name || "").toUpperCase();
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
            n.includes("PART");
          const type: UnifiedHolding["type"] = isEtf
            ? "etf"
            : isFund
            ? "fund"
            : "stock";

          const qty = Number(h.quantity || 0);
          const lastPrice =
            h.lastPrice ?? (qty > 0 && h.amount ? h.amount / qty : 0);
          const buyingPrice =
            h.buyingPrice ??
            (qty > 0 && h.amountVariation != null
              ? (h.amount - h.amountVariation) / qty
              : lastPrice);
          const totalVal = h.amount || qty * lastPrice;
          const investedVal =
            h.buyingPrice != null && qty > 0
              ? h.buyingPrice * qty
              : h.amountVariation != null
              ? Math.max(0, totalVal - h.amountVariation)
              : totalVal;
          const pnl =
            h.amountVariation ??
            (totalVal - investedVal);
          const pnlPercent =
            h.variationPercent ??
            (investedVal > 0 ? (pnl / investedVal) * 100 : 0);

          list.push({
            id: `${section.id}-${h.isin || h.name}-${idx}`,
            name: h.name || h.isin || "Position",
            symbol: h.isin || h.name,
            envelopeId: section.id,
            envelopeLabel: section.label,
            type,
            quantity: qty,
            buyingPrice,
            lastPrice,
            totalValue: totalVal,
            investedValue: investedVal,
            pnl,
            pnlPercent,
            allocationPercent: 0,
            source: `Import ${section.label}`,
          });
        });
      });

    // 3. Wallets crypto
    wallets.forEach((wallet) => {
      (wallet.assets || [])
        .filter((a) => !a.isHidden && (a.value || 0) > 0)
        .forEach((asset, idx) => {
          const val = asset.value || 0;
          list.push({
            id: `w-${wallet.id}-${asset.symbol}-${idx}`,
            name: asset.name || asset.symbol,
            symbol: asset.symbol,
            envelopeId: "crypto",
            envelopeLabel: "Crypto & Web3",
            type: "crypto",
            quantity: asset.balance,
            buyingPrice: asset.price || 0,
            lastPrice: asset.price || 0,
            totalValue: val,
            investedValue: val,
            pnl: 0,
            pnlPercent: 0,
            allocationPercent: 0,
            source:
              wallet.walletType === "binance"
                ? "Binance"
                : `Wallet ${wallet.name}`,
          });
        });
    });

    // 4. Calculer l'allocation % par rapport au total
    const total = list.reduce((s, h) => s + h.totalValue, 0);
    if (total > 0) {
      list.forEach((h) => {
        h.allocationPercent = (h.totalValue / total) * 100;
      });
    }

    return list;
  }, [accountSections, sectionHoldings, wallets]);

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
    ];

    // 1. Enveloppes investissement (PEA, PEE, etc.)
    accountSections
      .filter((s) => s.kind === "investment")
      .forEach((s, idx) => {
        const summary = accountSummaries.find((acc) => acc.id === s.id);
        const holdings = unifiedHoldings.filter((h) => h.envelopeId === s.id);
        const totalVal =
          summary?.balance ??
          summary?.currentValue ??
          holdings.reduce((sum, h) => sum + h.totalValue, 0);
        const investedVal =
          summary?.purchaseValue ??
          holdings.reduce((sum, h) => sum + h.investedValue, 0);
        const pnl = summary?.pnl ?? (totalVal - investedVal);
        const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;

        const label = s.label || s.id || "Portefeuille";
        const upper = (label || "").toUpperCase();
        list.push({
          id: s.id,
          label,
          kind: "investment",
          totalValue: totalVal,
          investedValue: investedVal,
          pnl,
          pnlPercent: pnlPct,
          positionsCount: holdings.length,
          color: colors[idx % colors.length],
          description: upper.includes("PEA")
            ? "Plan d'Épargne en Actions"
            : upper.includes("PEE")
            ? "Plan d'Épargne Entreprise"
            : upper.includes("ASSURANCE") || upper.includes("VIE")
            ? "Assurance vie multisupport"
            : upper.includes("PER") || upper.includes("RETRAITE")
            ? "Plan d'Épargne Retraite"
            : "Portefeuille d'investissement",
        });
      });

    // Assurer la présence explicite du PEA si absent des sections
    if (!list.some((e) => e.id === "pea" || (e.label || "").toUpperCase().includes("PEA"))) {
      const peaHoldings = unifiedHoldings.filter((h) => h.envelopeId === "pea");
      const peaSummary = accountSummaries.find((acc) => acc.id === "pea");
      const totalVal =
        peaSummary?.balance ??
        peaSummary?.currentValue ??
        peaHoldings.reduce((sum, h) => sum + h.totalValue, 0);
      const investedVal =
        peaSummary?.purchaseValue ??
        peaHoldings.reduce((sum, h) => sum + h.investedValue, 0);
      const pnl = peaSummary?.pnl ?? (totalVal - investedVal);
      const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;
      list.unshift({
        id: "pea",
        label: "PEA",
        kind: "investment",
        totalValue: totalVal,
        investedValue: investedVal,
        pnl,
        pnlPercent: pnlPct,
        positionsCount: peaHoldings.length,
        color: "#3b82f6",
        description: "Plan d'Épargne en Actions",
      });
    }

    // Assurer la présence explicite du PEE si absent des sections
    if (!list.some((e) => e.id === "pee" || (e.label || "").toUpperCase().includes("PEE"))) {
      const peeHoldings = unifiedHoldings.filter((h) => h.envelopeId === "pee");
      const peeSummary = accountSummaries.find((acc) => acc.id === "pee");
      const totalVal =
        peeSummary?.balance ??
        peeSummary?.currentValue ??
        peeHoldings.reduce((sum, h) => sum + h.totalValue, 0);
      const investedVal =
        peeSummary?.purchaseValue ??
        peeHoldings.reduce((sum, h) => sum + h.investedValue, 0);
      const pnl = peeSummary?.pnl ?? (totalVal - investedVal);
      const pnlPct = investedVal > 0 ? (pnl / investedVal) * 100 : 0;
      list.push({
        id: "pee",
        label: "PEE",
        kind: "investment",
        totalValue: totalVal,
        investedValue: investedVal,
        pnl,
        pnlPercent: pnlPct,
        positionsCount: peeHoldings.length,
        color: "#10b981",
        description: "Plan d'Épargne Entreprise",
      });
    }

    // 2. Liquidités & Banque (toujours présent)
    if (!list.some((e) => e.id === "bank")) {
      const bankSummaries = accountSummaries.filter((s) => s.kind === "bank");
      const bankTotal = bankSummaries.reduce(
        (sum, s) => sum + (s.balance || 0),
        0,
      );
      list.push({
        id: "bank",
        label: "Banque & Liquidités",
        kind: "bank",
        totalValue: bankCash || bankTotal,
        investedValue: bankCash || bankTotal,
        pnl: 0,
        pnlPercent: 0,
        positionsCount: bankSummaries.length,
        color: "#06b6d4",
        description: "Comptes courants et livrets bancaires",
      });
    }

    // 3. Crypto & Web3 (toujours présent)
    if (!list.some((e) => e.id === "crypto")) {
      const cryptoHoldings = unifiedHoldings.filter(
        (h) => h.envelopeId === "crypto",
      );
      list.push({
        id: "crypto",
        label: "Crypto & Web3",
        kind: "crypto",
        totalValue: cryptoTotalValue,
        investedValue: cryptoWalletsValue,
        pnl: cryptoTotalValue - cryptoWalletsValue,
        pnlPercent:
          cryptoWalletsValue > 0
            ? ((cryptoTotalValue - cryptoWalletsValue) / cryptoWalletsValue) *
              100
            : 0,
        positionsCount: cryptoHoldings.length,
        color: "#f97316",
        description: "Exchanges (Binance) et wallets blockchain",
      });
    }

    // Ordonner naturellement : PEA, PEE, Assurance vie, PER, Banque, Crypto, puis autres
    const orderScore = (id: string, label: string) => {
      const u = (label || id || "").toUpperCase();
      if (u.includes("PEA")) return 1;
      if (u.includes("PEE")) return 2;
      if (u.includes("ASSURANCE") || u.includes("VIE")) return 3;
      if (u.includes("PER") || u.includes("RETRAITE")) return 4;
      if (id === "bank" || u.includes("BANQUE")) return 5;
      if (id === "crypto" || u.includes("CRYPTO")) return 6;
      return 7;
    };
    list.sort((a, b) => orderScore(a.id, a.label) - orderScore(b.id, b.label));

    return list;
  }, [
    accountSections,
    accountSummaries,
    unifiedHoldings,
    bankCash,
    cryptoTotalValue,
    cryptoWalletsValue,
    wallets,
  ]);

  const navigationTabs = useMemo(() => {
    return [
      {
        id: "all",
        label: "Vue Globale",
        kind: "all" as const,
        description: "Patrimoine consolidé & répartition",
        totalValue: totalWealthAll,
        icon: Layers,
        color: "#c8a55e",
      },
      ...portfolioEnvelopes.map((env) => {
        let icon = Briefcase;
        const upper = (env.label || "").toUpperCase();
        if (upper.includes("PEA")) icon = TrendingUp;
        else if (upper.includes("PEE")) icon = Building2;
        else if (upper.includes("ASSURANCE") || upper.includes("VIE"))
          icon = ShieldCheck;
        else if (upper.includes("PER") || upper.includes("RETRAITE"))
          icon = WalletIcon;
        else if (env.kind === "bank" || env.id === "bank") icon = Landmark;
        else if (env.kind === "crypto" || env.id === "crypto") icon = Coins;

        return {
          id: env.id,
          label: env.label,
          kind: env.kind,
          description: env.description,
          totalValue: env.totalValue,
          icon,
          color: env.color,
        };
      }),
    ];
  }, [portfolioEnvelopes, totalWealthAll]);

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

  const activeHoldings = useMemo(() => {
    let list =
      selectedPortfolio === "all"
        ? unifiedHoldings
        : selectedPortfolio === "bank"
        ? []
        : unifiedHoldings.filter((h) => h.envelopeId === selectedPortfolio);

    if (selectedAssetTypeFilter !== "all") {
      list = list.filter((h) => h.type === selectedAssetTypeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (h) =>
          (h.name || "").toLowerCase().includes(q) ||
          (h.symbol || "").toLowerCase().includes(q) ||
          (h.envelopeLabel || "").toLowerCase().includes(q),
      );
    }

    return list;
  }, [
    selectedPortfolio,
    unifiedHoldings,
    selectedAssetTypeFilter,
    searchQuery,
  ]);

  // Répartition par type (à partir des wallets crypto)
  const typeDistribution: Record<string, number> = {};

  // Ajouter les wallets à la répartition par type
  wallets.forEach((wallet) => {
    (wallet.assets || [])
      .filter((asset) => !asset.isHidden && asset.value && asset.value > 0)
      .forEach((asset) => {
        typeDistribution.crypto =
          (typeDistribution.crypto || 0) + (asset.value || 0);
      });
  });


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
        <Link to="/banking" className="btn-primary">
          Gérer les comptes et imports CSV
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
              <div className="flex items-center gap-2">
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
              </div>
            </div>
          </div>

          {/* Glowing Area Chart */}
          <div className="h-48 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={
                  balanceChartData.length > 0
                    ? balanceChartData
                    : [
                        { dateLabel: "S-4", balance: totalWealthAll * 0.94 },
                        { dateLabel: "S-3", balance: totalWealthAll * 0.96 },
                        { dateLabel: "S-2", balance: totalWealthAll * 0.95 },
                        { dateLabel: "S-1", balance: totalWealthAll * 0.98 },
                        { dateLabel: "Auj.", balance: totalWealthAll },
                      ]
                }
              >
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
        </div>

        {/* Allocation Card (Span 1) */}
        <div className="card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-semibold text-[#f5f5f5]">Allocation</h3>
            <Link to="/investments" className="text-xs text-[#c8a55e] hover:underline">
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
                  onClick={() => setSelectedPortfolio(item.id)}
                  className="group p-1.5 -mx-1 rounded-lg hover:bg-[rgba(255,255,255,0.03)] cursor-pointer transition-all"
                  title={`Accéder à ${item.name}`}
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

        {/* Les 2 petites modales : Gain/Perte et Rendement (50% de la largeur totale, divisées en 2 cartes) */}
        <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-6 items-stretch">
          {/* Petite modale : Gain/Perte */}
          <div className="card flex flex-col justify-between p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#8a8a8a]">
                Gain / Perte
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  totalGainLoss >= 0 ? "badge-green" : "badge-red"
                }`}
              >
                {totalGainLoss >= 0 ? "+" : ""}
                {formatPercent(totalGainLossPercent, 2)}
              </span>
            </div>

            <div className="my-auto py-3">
              <p
                className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${
                  totalGainLoss >= 0
                    ? "text-[#22c55e]"
                    : "text-[#ef4444]"
                }`}
              >
                {totalGainLoss >= 0 ? "+" : "-"}
                {formatCurrency(Math.abs(totalGainLoss))}
              </p>
              <p className="text-xs text-[#8a8a8a] mt-1">
                Plus ou moins-value latente
              </p>
            </div>

            <div className="pt-3 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between text-xs">
              <span className="text-[#8a8a8a]">Investi initial</span>
              <span className="font-semibold text-[#f5f5f5]">
                {formatCurrency(totalInvestedInitial)}
              </span>
            </div>
          </div>

          {/* Petite modale : Rendement */}
          <div className="card flex flex-col justify-between p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#8a8a8a]">
                Rendement
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  totalGainLossPercent >= 0 ? "badge-green" : "badge-red"
                }`}
              >
                {totalGainLossPercent >= 0 ? "Positif" : "Négatif"}
              </span>
            </div>

            <div className="my-auto py-3">
              <p
                className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${
                  totalGainLossPercent >= 0
                    ? "text-[#22c55e]"
                    : "text-[#ef4444]"
                }`}
              >
                {totalGainLossPercent >= 0 ? "+" : "-"}
                {formatPercent(Math.abs(totalGainLossPercent), 2)}
              </p>
              <p className="text-xs text-[#8a8a8a] mt-1">
                Performance globale
              </p>
            </div>

            <div className="pt-3 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between text-xs">
              <span className="text-[#8a8a8a]">Investissements</span>
              <span className="font-semibold text-[#f5f5f5]">
                {formatCurrency(totalInvestmentsAll)}
              </span>
            </div>
          </div>
        </div>
      </div>


      {/* ===== NAVIGATION PRINCIPALE PAR PORTEFEUILLE (VUE GLOBALE, PEA, PEE, BANQUE, CRYPTO) ===== */}
      <div className="border-b border-[rgba(255,255,255,0.06)] pt-4">
        <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto scrollbar-none">
          {navigationTabs.map((tab) => {
            const Icon = tab.icon;
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
                <div
                  className={`p-1.5 rounded-lg transition-colors ${
                    isActive
                      ? "bg-[#c8a55e]/15 text-[#c8a55e]"
                      : "bg-[rgba(255,255,255,0.03)] text-[#8a8a8a] group-hover:text-[#f5f5f5]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{tab.label}</span>
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

      {/* ===== CONTENU PRINCIPAL PAR PORTEFEUILLE (BENTO GRID) ===== */}
      {unifiedHoldings.length === 0 &&
      bankCash === 0 &&
      cryptoTotalValue === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {/* ======================================================== */}
          {/* 1. PANEL : VUE GLOBALE (PATRIMOINE CONSOLIDÉ) */}
          {/* ======================================================== */}
          {selectedPortfolio === "all" && (
            <>
              {/* Bento Row 1: KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card text-center">
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
                <div className="card text-center">
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
                <div className="card text-center">
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
                <div className="card text-center">
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

              {/* Bento Row 2: Synthèse des Portefeuilles & Enveloppes */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#8a8a8a] uppercase tracking-wider">
                    Synthèse des Portefeuilles & Enveloppes
                  </h3>
                  <span className="text-xs text-[#555555]">
                    Cliquez sur un portefeuille pour voir ses détails
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {portfolioEnvelopes.map((env) => {
                    const share =
                      totalWealthAll > 0
                        ? (env.totalValue / totalWealthAll) * 100
                        : 0;
                    let IconComponent = Briefcase;
                    const upper = (env.label || "").toUpperCase();
                    if (upper.includes("PEA")) IconComponent = TrendingUp;
                    else if (upper.includes("PEE")) IconComponent = Building2;
                    else if (env.kind === "bank" || env.id === "bank")
                      IconComponent = Landmark;
                    else if (env.kind === "crypto" || env.id === "crypto")
                      IconComponent = Coins;

                    return (
                      <div
                        key={env.id}
                        className="card group hover:border-[#c8a55e]/40 transition-all cursor-pointer flex flex-col justify-between"
                        onClick={() => setSelectedPortfolio(env.id)}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded-md flex items-center justify-center text-xs"
                                style={{
                                  backgroundColor: `${env.color}20`,
                                  color: env.color,
                                }}
                              >
                                <IconComponent className="h-3.5 w-3.5" />
                              </div>
                              <h4 className="font-bold text-[#f5f5f5] text-sm group-hover:text-[#c8a55e] transition-colors">
                                {env.label}
                              </h4>
                            </div>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.04)] text-[#8a8a8a] font-medium">
                              {formatPercent(share, 1)}
                            </span>
                          </div>

                          <div className="text-2xl font-bold text-[#f5f5f5] mb-2 tracking-tight">
                            {formatCurrency(env.totalValue)}
                          </div>

                          <p className="text-xs text-[#8a8a8a] line-clamp-1 mb-3">
                            {env.description}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between text-xs">
                          {env.kind === "investment" ? (
                            <>
                              <span className="text-[#8a8a8a]">
                                {env.positionsCount}{" "}
                                {env.positionsCount > 1 ? "lignes" : "ligne"}
                              </span>
                              <span
                                className={`font-semibold ${
                                  env.pnl >= 0
                                    ? "text-[#22c55e]"
                                    : "text-[#ef4444]"
                                }`}
                              >
                                {env.pnl >= 0 ? "+" : ""}
                                {formatCurrency(env.pnl)} (
                                {env.pnlPercent >= 0 ? "+" : ""}
                                {formatPercent(env.pnlPercent, 1)})
                              </span>
                            </>
                          ) : env.kind === "bank" ? (
                            <>
                              <span className="text-[#8a8a8a]">Liquidités</span>
                              <span className="text-[#06b6d4] font-medium">
                                Comptes bancaires
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-[#8a8a8a]">
                                {wallets.length} wallets
                              </span>
                              <span className="text-[#f97316] font-medium">
                                Web3 & Exchanges
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bento Row 3: Graphiques de Répartition (2 Donut Charts) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Donut 1 : Répartition par Enveloppe */}
                <div className="card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-base font-semibold text-[#f5f5f5]">
                        Répartition par Portefeuille / Enveloppe
                      </h4>
                      <p className="text-xs text-[#8a8a8a]">
                        Poids de chaque compte dans le patrimoine global
                      </p>
                    </div>
                  </div>

                  <div className="relative h-64 flex items-center justify-center">
                    {(() => {
                      const envPieData = portfolioEnvelopes
                        .filter((e) => e.totalValue > 0)
                        .map((e) => ({
                          name: e.label,
                          value: e.totalValue,
                          color: e.color,
                        }));
                      const pieData =
                        envPieData.length > 0
                          ? envPieData
                          : [
                              {
                                name: "Aucune donnée",
                                value: 1,
                                color: isDark ? "#262626" : "#e5e7eb",
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
                                innerRadius={65}
                                outerRadius={95}
                                paddingAngle={envPieData.length > 1 ? 3 : 0}
                                stroke="none"
                              >
                                {pieData.map((entry, index) => (
                                  <Cell
                                    key={`cell-env-${index}`}
                                    fill={entry.color}
                                  />
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
                            <span className="text-base font-bold text-[#f5f5f5]">
                              {formatCurrency(totalWealthAll)}
                            </span>
                            <span className="text-[11px] text-[#8a8a8a]">
                              Total Net
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Légende */}
                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                    {portfolioEnvelopes.map((e) => {
                      const share =
                        totalWealthAll > 0
                          ? (e.totalValue / totalWealthAll) * 100
                          : 0;
                      return (
                        <div
                          key={e.id}
                          className="flex items-center justify-between text-xs cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setSelectedPortfolio(e.id)}
                        >
                          <div className="flex items-center gap-1.5 truncate pr-1">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: e.color }}
                            />
                            <span className="text-[#8a8a8a] truncate">
                              {e.label}
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

                {/* Donut 2 : Répartition par Classe d'Actifs */}
                <div className="card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-base font-semibold text-[#f5f5f5]">
                        Répartition par Classe d'Actifs
                      </h4>
                      <p className="text-xs text-[#8a8a8a]">
                        Actions, ETF, Crypto, Liquidités & autres
                      </p>
                    </div>
                  </div>

                  <div className="relative h-64 flex items-center justify-center">
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
                                innerRadius={65}
                                outerRadius={95}
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
                            <span className="text-base font-bold text-[#f5f5f5]">
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
                            onClick={() => setSelectedPortfolio(env.id)}
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
                      {activeHoldings.map((h) => {
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
            </>
          )}

          {/* ======================================================== */}
          {/* 2. PANEL : ENVELOPPE D'INVESTISSEMENT (PEA, PEE, etc.) */}
          {/* ======================================================== */}
          {selectedEnvelope && selectedEnvelope.kind === "investment" && (
            <>
              {/* Hero Enveloppe */}
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: selectedEnvelope.color }}
                      />
                      <h3 className="text-xl font-bold text-[#f5f5f5]">
                        {selectedEnvelope.label}
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[#8a8a8a]">
                        {selectedEnvelope.description}
                      </span>
                    </div>
                    <p className="text-xs text-[#8a8a8a]">
                      Vue détaillée et positions de votre portefeuille{" "}
                      {selectedEnvelope.label}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedPortfolio("all")}
                    className="btn-secondary !py-1.5 !px-3 text-xs self-start sm:self-auto flex items-center gap-1.5"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>Revenir à la vue globale</span>
                  </button>
                </div>

                {/* 4 Bento KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Valeur Actuelle
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {formatCurrency(selectedEnvelope.totalValue)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Montant Investi (PRU)
                    </span>
                    <span className="text-2xl font-bold text-[#f5f5f5]">
                      {formatCurrency(selectedEnvelope.investedValue)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Plus/Moins-value
                    </span>
                    <span
                      className={`text-2xl font-bold ${
                        selectedEnvelope.pnl >= 0
                          ? "text-[#22c55e]"
                          : "text-[#ef4444]"
                      }`}
                    >
                      {selectedEnvelope.pnl >= 0 ? "+" : ""}
                      {formatCurrency(selectedEnvelope.pnl)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <span className="text-xs text-[#8a8a8a] block mb-1">
                      Rendement Global
                    </span>
                    <span
                      className={`text-2xl font-bold ${
                        selectedEnvelope.pnlPercent >= 0
                          ? "text-[#22c55e]"
                          : "text-[#ef4444]"
                      }`}
                    >
                      {selectedEnvelope.pnlPercent >= 0 ? "+" : ""}
                      {formatPercent(selectedEnvelope.pnlPercent, 2)}
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
                      const max = activeHoldings.reduce(
                        (m, h) => (h.totalValue > m ? h.totalValue : m),
                        0,
                      );
                      return selectedEnvelope.totalValue > 0
                        ? formatPercent(
                            (max / selectedEnvelope.totalValue) * 100,
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
                      const top3 = activeHoldings
                        .slice()
                        .sort((a, b) => b.totalValue - a.totalValue)
                        .slice(0, 3)
                        .reduce((s, h) => s + h.totalValue, 0);
                      return selectedEnvelope.totalValue > 0
                        ? formatPercent(
                            (top3 / selectedEnvelope.totalValue) * 100,
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
                    {activeHoldings.filter((h) => h.pnl > 0).length} /{" "}
                    {activeHoldings.length}
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
                    Allocation — {selectedEnvelope.label}
                  </h4>
                  <div className="relative h-64 flex items-center justify-center">
                    {(() => {
                      const rawHoldingsData = activeHoldings
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
                              {formatCurrency(selectedEnvelope.totalValue)}
                            </span>
                            <span className="text-[11px] text-[#8a8a8a]">
                              {activeHoldings.length} lignes
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
                      const holdingGainData = activeHoldings
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
                    {activeHoldings.length === 0 ? (
                      <div className="text-xs text-[#8a8a8a] text-center py-8">
                        Aucune ligne détenue dans ce portefeuille.
                      </div>
                    ) : (
                      activeHoldings
                        .slice()
                        .sort((a, b) => b.totalValue - a.totalValue)
                        .slice(0, 5)
                        .map((h, idx) => {
                          const pct =
                            selectedEnvelope.totalValue > 0
                              ? (h.totalValue / selectedEnvelope.totalValue) *
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
                      Lignes Détenues — {selectedEnvelope.label}
                    </h4>
                    <p className="text-xs text-[#8a8a8a]">
                      Détail complet des positions de ce compte
                    </p>
                  </div>
                  <span className="text-xs text-[#8a8a8a]">
                    {activeHoldings.length} actifs
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
                      {activeHoldings.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-10 text-center text-sm text-[#8a8a8a]"
                          >
                            Aucune position enregistrée dans ce portefeuille.
                            <div className="mt-3">
                              <Link
                                to="/banking"
                                className="btn-secondary !py-1.5 !px-3 text-xs inline-flex items-center gap-1.5"
                              >
                                <Landmark className="h-3.5 w-3.5 text-[#c8a55e]" />
                                <span>Importer un relevé CSV (PEA / PEE)</span>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        activeHoldings.map((h) => {
                          const weight =
                            selectedEnvelope.totalValue > 0
                              ? (h.totalValue / selectedEnvelope.totalValue) *
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
            </>
          )}

          {/* ======================================================== */}
          {/* 3. PANEL : LIQUIDITÉS & BANQUE */}
          {/* ======================================================== */}
          {selectedPortfolio === "bank" && (
            <>
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
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolio("all")}
                    className="btn-secondary !py-1.5 !px-3 text-xs self-start sm:self-auto flex items-center gap-1.5"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>Vue globale</span>
                  </button>
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
                    to="/banking"
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
            </>
          )}

          {/* ======================================================== */}
          {/* 4. PANEL : CRYPTO & WEB3 */}
          {/* ======================================================== */}
          {selectedPortfolio === "crypto" && (
            <>
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
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolio("all")}
                    className="btn-secondary !py-1.5 !px-3 text-xs self-start sm:self-auto flex items-center gap-1.5"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>Vue globale</span>
                  </button>
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
                      Wallets Blockchain
                    </span>
                    <span className="text-2xl font-bold text-[#f97316]">
                      {wallets.length}
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
                    to="/crypto"
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
                                to="/crypto"
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
            </>
          )}
        </div>
      )}
    </div>
  );
};
export default Dashboard;
