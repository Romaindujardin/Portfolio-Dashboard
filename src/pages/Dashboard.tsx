import React, { useState, useEffect, useRef } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart as PieChartIcon,
  Plus,
  BarChart,
  BarChart3,
  Activity,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Investment, PortfolioStats, Wallet } from "../types";
import {
  getStoredInvestments,
  calculatePortfolioStats,
  getStoredWallets,
  getStoredBankCsvUploads,
  getBankCsvUploadById,
} from "../utils/storage";
import PriceRefreshButton from "../components/PriceRefreshButton";
import { Link } from "react-router-dom";
import PortfolioChart from "../components/PortfolioChart";
import PriceChart from "../components/PriceChart";
import MarketClock from "../components/MarketClock";
import CashflowSpaghetti from "../components/CashflowSpaghetti";
import { useUser } from "../contexts/UserContext";
import {
  TimeGranularity,
  parseBankCsvTransactions,
  buildCashflowSeries,
  aggregateByCategory,
  latestBalance,
  parsePeaCsvHoldings,
  getTimeBucketKey,
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

const Dashboard: React.FC = () => {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "performance" | "analysis"
  >("overview");
  const [showBlockchainDetails, setShowBlockchainDetails] = useState(false);
  const [showWalletsDetail, setShowWalletsDetail] = useState(false);
  const [showCryptoDetail, setShowCryptoDetail] = useState(false);
  const [showTradfiDetail, setShowTradfiDetail] = useState(false);
  const [showNFTsDetail, setShowNFTsDetail] = useState(false);
  const [showAccountsInfo, setShowAccountsInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useUser();

  // ===== CSV Comptes (bank/PEA/PEE) =====
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string>("");
  const [cashGranularity, setCashGranularity] =
    useState<TimeGranularity>("month");
  const [bankSeries, setBankSeries] = useState<any[]>([]);
  const [bankCategoryRows, setBankCategoryRows] = useState<any[]>([]);
  const [bankTxs, setBankTxs] = useState<any[]>([]);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string>("");
  const [focusedCategory, setFocusedCategory] = useState<string | null>(null);
  const [focusedSubCategory, setFocusedSubCategory] = useState<string | null>(
    null
  );
  const [bankSummary, setBankSummary] = useState<{
    bankBalance: number | null;
    peaBalance: number | null;
    peeBalance: number | null;
    peaPnl: number | null;
    peePnl: number | null;
    peaPurchaseValue: number | null;
    peePurchaseValue: number | null;
    peaCurrentValue: number | null;
    peeCurrentValue: number | null;
    peaPeePurchaseValue: number;
    peaPeePnl: number;
    income: number;
    expenses: number;
    net: number;
  }>({
    bankBalance: null,
    peaBalance: null,
    peeBalance: null,
    peaPnl: null,
    peePnl: null,
    peaPurchaseValue: null,
    peePurchaseValue: null,
    peaCurrentValue: null,
    peeCurrentValue: null,
    peaPeePurchaseValue: 0,
    peaPeePnl: 0,
    income: 0,
    expenses: 0,
    net: 0,
  });

  // Hover animation (same spirit as MarketClock: fade/translate, swap value, fade in)
  const [peaShowCurrent, setPeaShowCurrent] = useState(false);
  const [peeShowCurrent, setPeeShowCurrent] = useState(false);
  const [peaAnimating, setPeaAnimating] = useState(false);
  const [peeAnimating, setPeeAnimating] = useState(false);
  const peaHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peeHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateToggleValue = (
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    setAnimating: (v: boolean) => void,
    setShowCurrent: (v: boolean) => void,
    next: boolean
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimating(true);
    timerRef.current = setTimeout(() => {
      setShowCurrent(next);
      setAnimating(false);
      timerRef.current = null;
    }, 220);
  };

  const loadInvestments = async () => {
    try {
      const data = await getStoredInvestments(currentUser);
      setInvestments(data);
    } catch (error) {
      console.error("❌ Erreur lors du chargement des investissements:", error);
      setInvestments([]);
    }
  };

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
      await Promise.all([loadInvestments(), loadWallets()]);
      setLoading(false);
    };

    loadData();

    // Écouter les mises à jour de prix et wallets
    const handlePriceUpdate = async () => {
      console.log("🔄 Rechargement du dashboard après mise à jour des prix");
      await loadInvestments();
      await loadWallets();
    };

    const handleWalletUpdate = async () => {
      console.log("🔄 Rechargement du dashboard après mise à jour des wallets");
      await loadWallets();
    };

    const handleInvestmentUpdate = async () => {
      console.log(
        "🔄 Rechargement du dashboard après mise à jour des investissements"
      );
      await loadInvestments();
    };

    // Ajouter un écouteur pour déboguer l'événement
    const handlePriceUpdateDebug = (event: any) => {
      console.log(
        "📡 Événement investmentPricesUpdated reçu dans Dashboard:",
        event.detail
      );
    };

    window.addEventListener("investmentPricesUpdated", handlePriceUpdate);
    window.addEventListener("investmentPricesUpdated", handlePriceUpdateDebug);
    window.addEventListener("walletsUpdated", handleWalletUpdate);
    window.addEventListener("investmentsUpdated", handleInvestmentUpdate);

    return () => {
      window.removeEventListener("investmentPricesUpdated", handlePriceUpdate);
      window.removeEventListener(
        "investmentPricesUpdated",
        handlePriceUpdateDebug
      );
      window.removeEventListener("walletsUpdated", handleWalletUpdate);
      window.removeEventListener("investmentsUpdated", handleInvestmentUpdate);
    };
  }, [currentUser]);

  useEffect(() => {
    const loadAccountCsv = async () => {
      setAccountsLoading(true);
      setAccountsError("");
      try {
        // Bank: load all uploads (for cashflow + balance chart)
        const bankMetas = await getStoredBankCsvUploads(currentUser, "bank");
        const bankContents = await Promise.all(
          bankMetas.map(async (m) => {
            const u = await getBankCsvUploadById(m.id, currentUser);
            return u?.content || "";
          })
        );
        const bankTxs = bankContents.flatMap((c) =>
          parseBankCsvTransactions(c)
        );

        const series = buildCashflowSeries(bankTxs, cashGranularity);
        const categories = aggregateByCategory(bankTxs);
        const bal = latestBalance(bankTxs);

        const income = bankTxs
          .filter((t) => t.amount >= 0)
          .reduce((s, t) => s + t.amount, 0);
        const expenses = bankTxs
          .filter((t) => t.amount < 0)
          .reduce((s, t) => s + Math.abs(t.amount), 0);
        const net = income - expenses;

        // PEA/PEE: best-effort balance = last accountbalance if present in those CSVs
        const peaMetas = await getStoredBankCsvUploads(currentUser, "pea");
        const peaContents = await Promise.all(
          peaMetas.map(async (m) => {
            const u = await getBankCsvUploadById(m.id, currentUser);
            return u?.content || "";
          })
        );
        const peaHoldings = peaContents.flatMap((c) => parsePeaCsvHoldings(c));
        const peaBal =
          peaHoldings.length > 0
            ? peaHoldings.reduce((s, h) => s + (h.amount || 0), 0)
            : null;
        const peaPnl =
          peaHoldings.length > 0
            ? peaHoldings.reduce((sum, h) => {
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
        const peaPurchaseValue =
          peaHoldings.length > 0
            ? peaHoldings.reduce((sum, h) => {
                if (h.buyingPrice == null || !Number.isFinite(h.buyingPrice))
                  return sum;
                const q = Number(h.quantity || 0);
                if (!Number.isFinite(q) || q === 0) return sum;
                return sum + h.buyingPrice * q;
              }, 0)
            : 0;
        const peaCurrentValue =
          peaHoldings.length > 0
            ? (() => {
                let sum = 0;
                let used = 0;
                for (const h of peaHoldings) {
                  if (h.lastPrice == null || !Number.isFinite(h.lastPrice))
                    continue;
                  const q = Number(h.quantity || 0);
                  if (!Number.isFinite(q) || q === 0) continue;
                  sum += h.lastPrice * q;
                  used++;
                }
                return used > 0 ? sum : null;
              })()
            : null;

        const peeMetas = await getStoredBankCsvUploads(currentUser, "pee");
        const peeContents = await Promise.all(
          peeMetas.map(async (m) => {
            const u = await getBankCsvUploadById(m.id, currentUser);
            return u?.content || "";
          })
        );
        const peeHoldings = peeContents.flatMap((c) => parsePeaCsvHoldings(c));
        const peeBal =
          peeHoldings.length > 0
            ? peeHoldings.reduce((s, h) => s + (h.amount || 0), 0)
            : (() => {
                // Backward compatibility: if the user previously used PEE as a transactions CSV
                const peeTxs = peeContents.flatMap((c) =>
                  c ? parseBankCsvTransactions(c) : []
                );
                return latestBalance(peeTxs);
              })();
        const peePnl =
          peeHoldings.length > 0
            ? peeHoldings.reduce((sum, h) => {
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
        const peePurchaseValue =
          peeHoldings.length > 0
            ? peeHoldings.reduce((sum, h) => {
                if (h.buyingPrice == null || !Number.isFinite(h.buyingPrice))
                  return sum;
                const q = Number(h.quantity || 0);
                if (!Number.isFinite(q) || q === 0) return sum;
                return sum + h.buyingPrice * q;
              }, 0)
            : 0;
        const peeCurrentValue =
          peeHoldings.length > 0
            ? (() => {
                let sum = 0;
                let used = 0;
                for (const h of peeHoldings) {
                  if (h.lastPrice == null || !Number.isFinite(h.lastPrice))
                    continue;
                  const q = Number(h.quantity || 0);
                  if (!Number.isFinite(q) || q === 0) continue;
                  sum += h.lastPrice * q;
                  used++;
                }
                return used > 0 ? sum : null;
              })()
            : null;

        const peaPeePurchaseValue = peaPurchaseValue + peePurchaseValue;
        const peaPeePnl = (peaPnl || 0) + (peePnl || 0);

        setBankSeries(
          series.map((p) => ({
            key: p.key,
            income: p.income,
            expenses: p.expenses,
            net: p.net,
            balance: p.endingBalance ?? null,
          }))
        );
        setBankCategoryRows(categories);
        setBankTxs(bankTxs);
        setBankSummary({
          bankBalance: bal,
          peaBalance: peaBal,
          peeBalance: peeBal,
          peaPnl,
          peePnl,
          peaPurchaseValue: peaPurchaseValue > 0 ? peaPurchaseValue : null,
          peePurchaseValue: peePurchaseValue > 0 ? peePurchaseValue : null,
          peaCurrentValue,
          peeCurrentValue,
          peaPeePurchaseValue,
          peaPeePnl,
          income,
          expenses,
          net,
        });
      } catch (e: any) {
        setAccountsError(e?.message || "Erreur lors du chargement des CSV");
      } finally {
        setAccountsLoading(false);
      }
    };

    loadAccountCsv();
  }, [currentUser, cashGranularity]);

  useEffect(() => {
    // Default bucket = latest
    if (!bankSeries.length) {
      setSelectedBucketKey("");
      setFocusedCategory(null);
      setFocusedSubCategory(null);
      return;
    }
    setSelectedBucketKey(
      (prev) => prev || bankSeries[bankSeries.length - 1].key
    );
    // keep last focused category (memory)
    setFocusedSubCategory(null);
  }, [bankSeries]);

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

  const incomeColorMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    incomeByCategoryForBucket.forEach((c: any, idx: number) => {
      map[String(c.name)] = PIE_COLORS[(idx + 2) % PIE_COLORS.length];
    });
    return map;
  }, [incomeByCategoryForBucket]);

  const cashflowSpaghettiColorMap = React.useMemo(() => {
    return { ...incomeColorMap, ...categoryColorMap };
  }, [incomeColorMap, categoryColorMap]);

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

  useEffect(() => {
    if (investments.length > 0) {
      // setStats(calculatePortfolioStats(investments));
    }
  }, [investments]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">
                Chargement des données...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const portfolioData = investments.map((inv) => ({
    name: inv.name,
    value: inv.quantity * (inv.currentPrice ?? 0),
    type: inv.type,
  }));

  const COLORS = [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
  ];

  const performanceData = [
    {
      date: "1W ago",
      value:
        (investments.reduce(
          (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
          0
        ) +
          wallets.reduce(
            (sum, wallet) =>
              sum +
              wallet.assets
                .filter((asset) => !asset.isHidden)
                .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
              (wallet.nfts || []).reduce(
                (nftSum, nft) => nftSum + (nft.value || 0),
                0
              ),
            0
          )) *
        0.95,
    },
    {
      date: "5D ago",
      value:
        (investments.reduce(
          (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
          0
        ) +
          wallets.reduce(
            (sum, wallet) =>
              sum +
              wallet.assets
                .filter((asset) => !asset.isHidden)
                .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
              (wallet.nfts || []).reduce(
                (nftSum, nft) => nftSum + (nft.value || 0),
                0
              ),
            0
          )) *
        0.97,
    },
    {
      date: "3D ago",
      value:
        (investments.reduce(
          (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
          0
        ) +
          wallets.reduce(
            (sum, wallet) =>
              sum +
              wallet.assets
                .filter((asset) => !asset.isHidden)
                .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
              (wallet.nfts || []).reduce(
                (nftSum, nft) => nftSum + (nft.value || 0),
                0
              ),
            0
          )) *
        0.99,
    },
    {
      date: "Yesterday",
      value:
        (investments.reduce(
          (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
          0
        ) +
          wallets.reduce(
            (sum, wallet) =>
              sum +
              wallet.assets
                .filter((asset) => !asset.isHidden)
                .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
              (wallet.nfts || []).reduce(
                (nftSum, nft) => nftSum + (nft.value || 0),
                0
              ),
            0
          )) *
        0.98,
    },
    {
      date: "Today",
      value:
        investments.reduce(
          (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
          0
        ) +
        wallets.reduce(
          (sum, wallet) =>
            sum +
            wallet.assets
              .filter((asset) => !asset.isHidden)
              .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
            (wallet.nfts || []).reduce(
              (nftSum, nft) => nftSum + (nft.value || 0),
              0
            ),
          0
        ),
    },
  ];

  // Calculs des statistiques
  const investmentsTotalValue = investments.reduce((sum, inv) => {
    const currentPrice = inv.currentPrice ?? 0;
    return sum + inv.quantity * currentPrice;
  }, 0);

  // Séparer les wallets Binance des autres wallets
  const binanceWallets = wallets.filter(
    (wallet) => wallet.walletType === "binance"
  );
  const blockchainWallets = wallets.filter(
    (wallet) => wallet.walletType !== "binance"
  );

  const walletsTotalValue = blockchainWallets.reduce((sum, wallet) => {
    return (
      sum +
      wallet.assets
        .filter((asset) => !asset.isHidden)
        .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0)
    );
  }, 0);

  const binanceWalletsTotalValue = binanceWallets.reduce((sum, wallet) => {
    return (
      sum +
      wallet.assets
        .filter((asset) => !asset.isHidden)
        .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0)
    );
  }, 0);

  // Calculer la valeur totale des NFTs
  const nftsTotalValue = wallets.reduce((sum, wallet) => {
    return (
      sum +
      (wallet.nfts || []).reduce((nftSum, nft) => nftSum + (nft.value || 0), 0)
    );
  }, 0);

  const totalValue =
    investmentsTotalValue +
    walletsTotalValue +
    binanceWalletsTotalValue +
    nftsTotalValue;

  const totalPurchaseValue = investments.reduce(
    (sum, inv) => sum + inv.quantity * inv.purchasePrice,
    0
  );

  // PEA + PEE uniquement: somme de (lastPrice - buyingPrice) * quantity
  const totalGainLoss = bankSummary.peaPeePnl || 0;
  const totalGainLossPercent =
    bankSummary.peaPeePurchaseValue > 0
      ? (totalGainLoss / bankSummary.peaPeePurchaseValue) * 100
      : 0;

  // Répartition par type
  const typeDistribution = investments.reduce((acc, inv) => {
    const currentPrice = inv.currentPrice ?? 0;
    const value = inv.quantity * currentPrice;
    acc[inv.type] = (acc[inv.type] || 0) + value;
    return acc;
  }, {} as Record<string, number>);

  // Ajouter les wallets à la répartition par type
  wallets.forEach((wallet) => {
    wallet.assets
      .filter((asset) => !asset.isHidden && asset.value && asset.value > 0)
      .forEach((asset) => {
        typeDistribution.crypto =
          (typeDistribution.crypto || 0) + (asset.value || 0);
      });
  });

  // Top 5 investissements par valeur
  const topInvestments = investments
    .map((inv) => ({
      ...inv,
      currentValue: inv.quantity * (inv.currentPrice ?? 0),
      gainLoss:
        inv.quantity * (inv.currentPrice ?? 0) -
        inv.quantity * inv.purchasePrice,
    }))
    .sort((a, b) => b.currentValue - a.currentValue)
    .slice(0, 5);

  const tabs = [
    {
      id: "overview",
      name: "Vue d'ensemble",
      icon: PieChart,
      description: "Répartition et distribution du portfolio",
    },
    {
      id: "performance",
      name: "Performance",
      icon: TrendingUp,
      description: "Évolution temporelle et comparaisons",
    },
    {
      id: "analysis",
      name: "Analyse",
      icon: Activity,
      description: "Analyses détaillées par actifs",
    },
  ];

  const EmptyState = () => (
    <div className="col-span-full">
      <div className="text-center py-16">
        <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <BarChart3 size={32} className="text-gray-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
          Aucun investissement trouvé
        </h3>
        <p className="text-gray-600 dark:text-white mb-6 max-w-md mx-auto">
          Ajoutez des investissements à votre portfolio pour visualiser les
          graphiques et analyses.
        </p>
        <Link to="/investments" className="btn-primary">
          Ajouter des investissements
        </Link>
      </div>
    </div>
  );

  // ===== Totaux incluant CSV (banque / PEA / PEE) =====
  const bankCash = bankSummary.bankBalance ?? 0;
  const peaValue = bankSummary.peaBalance ?? 0;
  const peeValue = bankSummary.peeBalance ?? 0;
  const totalWealthAll = totalValue + bankCash + peaValue + peeValue;
  const totalInvestmentsAll = totalValue + peaValue + peeValue; // sans la banque

  // ===== Crypto total (investissements crypto + wallets/nfts) =====
  const cryptoInvestmentsValue = investments
    .filter((inv) => inv.type === "crypto")
    .reduce((sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0), 0);
  const cryptoWalletsValue = wallets.reduce((sum, wallet) => {
    const assetsValue = (wallet.assets || [])
      .filter((a) => !a.isHidden)
      .reduce((s, a) => s + (a.value || 0), 0);
    const nftsValue = (wallet.nfts || [])
      .filter((n) => !n.isHidden)
      .reduce((s, n) => s + (n.value || 0), 0);
    return sum + assetsValue + nftsValue;
  }, 0);
  const cryptoTotalValue = cryptoInvestmentsValue + cryptoWalletsValue;

  return (
    <div className="space-y-6">
      {/* Horloge des bourses */}
      <div className="flex justify-center">
        <MarketClock />
      </div>

      {/* Statistiques principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-gray-600 dark:text-white">
            Valeur Totale
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {totalWealthAll.toLocaleString()}€
          </p>
        </div>
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-gray-600 dark:text-white">
            Investissements
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {totalInvestmentsAll.toLocaleString()}€
          </p>
        </div>
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-gray-600 dark:text-white">
            Gain/Perte (PEA+PEE)
          </p>
          <p
            className={`text-2xl font-bold ${
              totalGainLoss >= 0
                ? "text-success-600 dark:text-success-400"
                : "text-danger-600 dark:text-danger-400"
            }`}
          >
            {totalGainLoss.toLocaleString()}€
          </p>
        </div>
        <div className="card flex flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-gray-600 dark:text-white">
            Rendement (PEA+PEE)
          </p>
          <p
            className={`text-2xl font-bold ${
              totalGainLossPercent >= 0
                ? "text-success-600 dark:text-success-400"
                : "text-danger-600 dark:text-danger-400"
            }`}
          >
            {totalGainLossPercent.toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Détails (repliable) */}
      <div
        className={`transition-all duration-200 ${
          showAccountsInfo
            ? "opacity-100 max-h-[800px]"
            : "opacity-0 max-h-0 overflow-hidden"
        }`}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="card flex flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-gray-600 dark:text-white">
              Compte bancaire (CSV)
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {bankSummary.bankBalance != null
                ? bankSummary.bankBalance.toLocaleString("fr-FR")
                : "—"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-2">
              Entrées:{" "}
              <span className="font-semibold text-success-600 dark:text-success-400">
                {bankSummary.income.toLocaleString("fr-FR")}
              </span>{" "}
              • Sorties:{" "}
              <span className="font-semibold text-danger-600 dark:text-danger-400">
                {bankSummary.expenses.toLocaleString("fr-FR")}
              </span>
            </p>
          </div>
          <div
            className="card flex flex-col items-center justify-center text-center"
            onMouseEnter={() => {
              // only switch if we can compute current value
              if (bankSummary.peaCurrentValue == null) return;
              animateToggleValue(
                peaHoverTimerRef,
                setPeaAnimating,
                setPeaShowCurrent,
                true
              );
            }}
            onMouseLeave={() => {
              animateToggleValue(
                peaHoverTimerRef,
                setPeaAnimating,
                setPeaShowCurrent,
                false
              );
            }}
          >
            <p className="text-sm font-medium text-gray-600 dark:text-white">
              PEA
            </p>
            <p
              className={`text-2xl font-bold transition-all duration-300 ${
                peaAnimating
                  ? "transform -translate-y-4 opacity-0"
                  : "transform translate-y-0 opacity-100"
              } ${
                peaShowCurrent &&
                bankSummary.peaCurrentValue != null &&
                bankSummary.peaPurchaseValue != null
                  ? bankSummary.peaCurrentValue >= bankSummary.peaPurchaseValue
                    ? "text-success-600 dark:text-success-400"
                    : "text-danger-600 dark:text-danger-400"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              {(peaShowCurrent
                ? bankSummary.peaCurrentValue
                : bankSummary.peaPurchaseValue) != null
                ? (peaShowCurrent
                    ? bankSummary.peaCurrentValue
                    : bankSummary.peaPurchaseValue)!.toLocaleString("fr-FR")
                : "—"}
              €
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-2">
              {peaShowCurrent ? "Valeur actuelle" : "Investissement initial"}
            </p>
          </div>
          <div
            className="card flex flex-col items-center justify-center text-center"
            onMouseEnter={() => {
              if (bankSummary.peeCurrentValue == null) return;
              animateToggleValue(
                peeHoverTimerRef,
                setPeeAnimating,
                setPeeShowCurrent,
                true
              );
            }}
            onMouseLeave={() => {
              animateToggleValue(
                peeHoverTimerRef,
                setPeeAnimating,
                setPeeShowCurrent,
                false
              );
            }}
          >
            <p className="text-sm font-medium text-gray-600 dark:text-white">
              PEE
            </p>
            <p
              className={`text-2xl font-bold transition-all duration-300 ${
                peeAnimating
                  ? "transform -translate-y-4 opacity-0"
                  : "transform translate-y-0 opacity-100"
              } ${
                peeShowCurrent &&
                bankSummary.peeCurrentValue != null &&
                bankSummary.peePurchaseValue != null
                  ? bankSummary.peeCurrentValue >= bankSummary.peePurchaseValue
                    ? "text-success-600 dark:text-success-400"
                    : "text-danger-600 dark:text-danger-400"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              {(peeShowCurrent
                ? bankSummary.peeCurrentValue
                : bankSummary.peePurchaseValue) != null
                ? (peeShowCurrent
                    ? bankSummary.peeCurrentValue
                    : bankSummary.peePurchaseValue)!.toLocaleString("fr-FR")
                : "—"}
              €
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-2">
              {peeShowCurrent ? "Valeur actuelle" : "Investissement initial"}
            </p>
          </div>
          <div className="card flex flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-gray-600 dark:text-white">
              Crypto
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {cryptoTotalValue.toLocaleString()}€
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-2">
              Investissements crypto + wallets/nfts
            </p>
          </div>
        </div>
      </div>

      {/* Toggle sous la/les ligne(s) (ne crée pas d'écart entre les 2 rangées) */}
      <div className="flex justify-center -mt-2">
        <button
          type="button"
          onClick={() => setShowAccountsInfo((v) => !v)}
          className="p-2 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          aria-expanded={showAccountsInfo}
          aria-label={
            showAccountsInfo ? "Masquer les détails" : "Afficher les détails"
          }
          title={showAccountsInfo ? "Masquer" : "Afficher"}
        >
          {showAccountsInfo ? (
            <ChevronUp size={22} />
          ) : (
            <ChevronDown size={22} />
          )}
        </button>
      </div>

      {/* ===== Comptes (CSV) ===== */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Comptes (CSV)
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Compte bancaire / PEA / PEE + cashflow & catégories (données
              issues de tes imports).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-300">
              Période:
            </span>
            <select
              className="input-field py-2 px-3 w-auto"
              value={cashGranularity}
              onChange={(e) => setCashGranularity(e.target.value as any)}
            >
              <option value="day">Jour</option>
              <option value="week">Semaine</option>
              <option value="month">Mois</option>
              <option value="year">Année</option>
            </select>
            <span className="text-sm text-gray-500 dark:text-gray-300 ml-2">
              Bucket:
            </span>
            <select
              className="input-field py-2 px-3 w-auto"
              value={selectedBucketKey}
              onChange={(e) => {
                setSelectedBucketKey(e.target.value);
                setFocusedCategory(null);
                setFocusedSubCategory(null);
              }}
            >
              {bankSeries.map((b: any) => (
                <option key={b.key} value={b.key}>
                  {b.key}
                </option>
              ))}
            </select>
          </div>
        </div>

        {accountsError && (
          <div className="mb-4 text-sm text-danger-600 dark:text-danger-400">
            {accountsError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Cashflow “spaghetti” (catégories IA) — {cashGranularity}
            </div>
            <div className="h-64">
              <CashflowSpaghetti
                incomeByCategory={incomeByCategoryForBucket}
                expenseByCategory={expenseByCategoryForBucket}
                colorsByCategory={cashflowSpaghettiColorMap}
                height={256}
              />
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-300">
              Entrées à gauche, sorties à droite. Survole les liens pour voir
              les montants (répartition proportionnelle à l’intérieur du
              bucket).
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Évolution du solde (accountbalance)
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={bankSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="balance"
                    stroke="#8b5cf6"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            Dépenses — {selectedBucketKey || "—"}
          </div>

          {(!selectedBucketKey || bankTxs.length === 0) && !accountsLoading ? (
            <div className="text-sm text-gray-500 dark:text-gray-300">
              Aucun CSV bancaire importé (ou colonnes amount/dateVal
              manquantes).
            </div>
          ) : (
            <div
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
              onMouseLeave={() => {
                // keep memory; do not reset
              }}
            >
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                  Catégories (hover = drilldown)
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expenseByCategoryForBucket}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={70}
                        outerRadius={110}
                        paddingAngle={2}
                        onMouseEnter={(_: any, idx: number) => {
                          const name = expenseByCategoryForBucket[idx]?.name;
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
                          )
                        )}
                      </Pie>
                      <Tooltip
                        formatter={(value: any, name: any) => {
                          const total = expenseByCategoryForBucket.reduce(
                            (s: number, r: any) => s + (r.value || 0),
                            0
                          );
                          const v = Number(value || 0);
                          const pct = total > 0 ? (v / total) * 100 : 0;
                          return [
                            `${v.toLocaleString("fr-FR")} (${pct.toFixed(1)}%)`,
                            name,
                          ];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Survole une catégorie pour voir ses sous-catégories et ses
                  plus grosses transactions.
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                {!focusedCategory ? (
                  <>
                    <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                      Survole une catégorie…
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-300">
                      Le détail des sous-catégories et les plus grosses lignes
                      apparaîtront ici.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                      {focusedCategory} — sous-catégories
                    </div>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={expenseBySubCategoryForBucket}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={2}
                            onMouseEnter={(_: any, idx: number) => {
                              const name =
                                expenseBySubCategoryForBucket[idx]?.name;
                              if (name) setFocusedSubCategory(String(name));
                            }}
                            // keep last hovered subcategory (memory)
                          >
                            {expenseBySubCategoryForBucket.map(
                              (_: any, idx: number) => (
                                <Cell
                                  key={`subcell-${idx}`}
                                  fill={shadeFromBase(
                                    categoryColorMap[focusedCategory] ||
                                      PIE_COLORS[0],
                                    idx,
                                    expenseBySubCategoryForBucket.length
                                  )}
                                />
                              )
                            )}
                          </Pie>
                          <Tooltip
                            formatter={(value: any, name: any) => {
                              const total =
                                expenseBySubCategoryForBucket.reduce(
                                  (s: number, r: any) => s + (r.value || 0),
                                  0
                                );
                              const v = Number(value || 0);
                              const pct = total > 0 ? (v / total) * 100 : 0;
                              return [
                                `${v.toLocaleString("fr-FR")} (${pct.toFixed(
                                  1
                                )}%)`,
                                name,
                              ];
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="mt-3">
                      <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                        {focusedSubCategory
                          ? `Top lignes — ${focusedSubCategory}`
                          : "Top lignes (hover une sous-catégorie)"}
                      </div>
                      <div className="space-y-2 max-h-36 overflow-auto pr-1">
                        {topTransactionsForHover.map((t: any, idx: number) => (
                          <div
                            key={`${t.label || t.supplierFound || "tx"}-${idx}`}
                            className="flex items-start justify-between text-sm gap-3"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-gray-900 dark:text-gray-100">
                                {t.supplierFound || t.label || "Transaction"}
                              </div>
                              <div className="text-xs text-gray-500 truncate">
                                {t.subCategory} •{" "}
                                {t.date
                                  ? new Date(t.date).toLocaleDateString("fr-FR")
                                  : ""}
                              </div>
                            </div>
                            <div className="text-gray-900 dark:text-gray-100 whitespace-nowrap">
                              {Math.abs(Number(t.amount || 0)).toLocaleString(
                                "fr-FR"
                              )}
                            </div>
                          </div>
                        ))}
                        {topTransactionsForHover.length === 0 && (
                          <div className="text-sm text-gray-500 dark:text-gray-300">
                            Aucune dépense sur ce filtre.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Répartition Portfolio */}
      {(investments.length > 0 || wallets.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Répartition du Portfolio
            </h3>
            <div className="space-y-4">
              {/* Wallets Blockchain */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-4 h-4 bg-purple-500 rounded"></div>
                  <span className="text-gray-700 dark:text-white">
                    Wallets Blockchain
                  </span>
                  <button
                    onClick={() => setShowWalletsDetail((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={
                      showWalletsDetail
                        ? "Masquer le détail"
                        : "Afficher le détail"
                    }
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        showWalletsDetail ? "rotate-90" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                <div className="text-right">
                  <p className="font-semibold dark:text-white">
                    ${walletsTotalValue.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-white">
                    {totalValue > 0
                      ? ((walletsTotalValue / totalValue) * 100).toFixed(1)
                      : 0}
                    %
                  </p>
                </div>
              </div>
              {showWalletsDetail && (
                <div className="pl-6 space-y-1">
                  {blockchainWallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className="flex justify-between text-sm text-gray-600"
                    >
                      <span className="text-gray-600 dark:text-white">
                        {wallet.name}
                      </span>
                      <span>
                        $
                        {wallet.assets
                          .filter((asset) => !asset.isHidden)
                          .reduce((sum, asset) => sum + (asset.value || 0), 0)
                          .toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Investissements sur DEX/CEX */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-4 h-4 bg-orange-500 rounded"></div>
                  <span className="text-gray-700 dark:text-white">
                    Investissements sur DEX/CEX
                  </span>
                  <button
                    onClick={() => setShowCryptoDetail((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={
                      showCryptoDetail
                        ? "Masquer le détail"
                        : "Afficher le détail"
                    }
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        showCryptoDetail ? "rotate-90" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                <div className="text-right">
                  <p className="font-semibold dark:text-white">
                    $
                    {(
                      investments
                        .filter((inv) => inv.type === "crypto")
                        .reduce(
                          (sum, inv) =>
                            sum + inv.quantity * (inv.currentPrice ?? 0),
                          0
                        ) + binanceWalletsTotalValue
                    ).toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-white">
                    {totalValue > 0
                      ? (
                          ((investments
                            .filter((inv) => inv.type === "crypto")
                            .reduce(
                              (sum, inv) =>
                                sum + inv.quantity * (inv.currentPrice ?? 0),
                              0
                            ) +
                            binanceWalletsTotalValue) /
                            totalValue) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </p>
                </div>
              </div>
              {showCryptoDetail && (
                <div className="pl-6 space-y-1">
                  {/* Wallets Binance */}
                  {binanceWallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className="flex justify-between text-sm text-gray-600 dark:text-white"
                    >
                      <span className="dark:text-white">{wallet.name}</span>
                      <span className="dark:text-white">
                        $
                        {wallet.assets
                          .filter((asset) => !asset.isHidden)
                          .reduce((sum, asset) => sum + (asset.value || 0), 0)
                          .toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {/* Investissements crypto */}
                  {investments
                    .filter((inv) => inv.type === "crypto")
                    .map((inv) => (
                      <div
                        key={inv.id}
                        className="flex justify-between text-sm text-gray-600 dark:text-white"
                      >
                        <span className="dark:text-white">
                          {inv.name} ({inv.symbol})
                        </span>
                        <span className="dark:text-white">
                          $
                          {(
                            inv.quantity * (inv.currentPrice ?? 0)
                          ).toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              )}
              {/* NFTs */}
              {nftsTotalValue > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-4 h-4 bg-pink-500 rounded"></div>
                    <span className="text-gray-700 dark:text-white">NFTs</span>
                    <button
                      onClick={() => setShowNFTsDetail((v) => !v)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      title={
                        showNFTsDetail
                          ? "Masquer le détail"
                          : "Afficher le détail"
                      }
                    >
                      <svg
                        className={`w-4 h-4 transform transition-transform ${
                          showNFTsDetail ? "rotate-90" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold dark:text-white">
                      ${nftsTotalValue.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-white">
                      {totalValue > 0
                        ? ((nftsTotalValue / totalValue) * 100).toFixed(1)
                        : 0}
                      %
                    </p>
                  </div>
                </div>
              )}
              {showNFTsDetail && nftsTotalValue > 0 && (
                <div className="pl-6 space-y-1">
                  {wallets
                    .filter((wallet) => wallet.nfts && wallet.nfts.length > 0)
                    .map((wallet) => (
                      <div
                        key={wallet.id}
                        className="flex justify-between text-sm text-gray-600 dark:text-white"
                      >
                        <span className="dark:text-white">{wallet.name}</span>
                        <span className="dark:text-white">
                          $
                          {(wallet.nfts || [])
                            .reduce((sum, nft) => sum + (nft.value || 0), 0)
                            .toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              )}
              {/* Investissements TradFi */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-4 h-4 bg-blue-500 rounded"></div>
                  <span className="text-gray-700 dark:text-white">
                    Investissements TradFi
                  </span>
                  <button
                    onClick={() => setShowTradfiDetail((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={
                      showTradfiDetail
                        ? "Masquer le détail"
                        : "Afficher le détail"
                    }
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        showTradfiDetail ? "rotate-90" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                <div className="text-right">
                  <p className="font-semibold dark:text-white">
                    $
                    {investments
                      .filter((inv) => inv.type !== "crypto")
                      .reduce(
                        (sum, inv) =>
                          sum + inv.quantity * (inv.currentPrice ?? 0),
                        0
                      )
                      .toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-white">
                    {totalValue > 0
                      ? (
                          (investments
                            .filter((inv) => inv.type !== "crypto")
                            .reduce(
                              (sum, inv) =>
                                sum + inv.quantity * (inv.currentPrice ?? 0),
                              0
                            ) /
                            totalValue) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </p>
                </div>
              </div>
              {showTradfiDetail && (
                <div className="pl-6 space-y-1">
                  {investments
                    .filter((inv) => inv.type !== "crypto")
                    .map((inv) => (
                      <div
                        key={inv.id}
                        className="flex justify-between text-sm text-gray-600 dark:text-white"
                      >
                        <span className="dark:text-white">
                          {inv.name} ({inv.symbol})
                        </span>
                        <span className="dark:text-white">
                          $
                          {(
                            inv.quantity * (inv.currentPrice ?? 0)
                          ).toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              )}
              <div className="pt-3 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    Total
                  </span>
                  <span className="font-bold text-lg dark:text-white">
                    ${totalValue.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Détail des Assets
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-white">
                  📈 {investments.length} Investissements
                </span>
                <span className="font-semibold dark:text-white">
                  ${investmentsTotalValue.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-white">
                  👛 {wallets.length} Wallets
                </span>
                <span className="font-semibold dark:text-white">
                  ${walletsTotalValue.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-white">
                  🔗{" "}
                  {wallets.reduce(
                    (sum, wallet) =>
                      sum +
                      wallet.assets.filter((asset) => !asset.isHidden).length,
                    0
                  )}{" "}
                  Assets Blockchain
                </span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500 dark:text-white">
                    {(() => {
                      // Créer un Set pour compter les blockchains uniques
                      const uniqueBlockchains = new Set<string>();
                      wallets.forEach((wallet) => {
                        wallet.assets
                          .filter(
                            (asset) => !asset.isHidden && asset.blockchain
                          )
                          .forEach((asset) => {
                            uniqueBlockchains.add(asset.blockchain);
                          });
                      });
                      return `${uniqueBlockchains.size} Blockchains`;
                    })()}
                  </span>
                  <button
                    onClick={() =>
                      setShowBlockchainDetails(!showBlockchainDetails)
                    }
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        showBlockchainDetails ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              {/* Afficher les blockchains individuelles */}
              {showBlockchainDetails &&
                (() => {
                  const blockchainStats = new Map<
                    string,
                    { count: number; value: number }
                  >();
                  wallets.forEach((wallet) => {
                    wallet.assets
                      .filter((asset) => !asset.isHidden && asset.blockchain)
                      .forEach((asset) => {
                        const blockchain = asset.blockchain;
                        const current = blockchainStats.get(blockchain) || {
                          count: 0,
                          value: 0,
                        };
                        current.count += 1;
                        current.value += asset.value || 0;
                        blockchainStats.set(blockchain, current);
                      });
                  });

                  return Array.from(blockchainStats.entries())
                    .sort((a, b) => b[1].value - a[1].value)
                    .map(([blockchain, stats]) => (
                      <div
                        key={blockchain}
                        className="flex justify-between items-center pl-4 border-l-2 border-gray-200"
                      >
                        <span className="text-sm text-gray-500 dark:text-white">
                          {blockchain}
                        </span>
                        <div className="text-right">
                          <span className="text-sm font-medium dark:text-white">
                            {stats.count} assets
                          </span>
                          <span className="text-xs text-gray-400 dark:text-white ml-2">
                            ${stats.value.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ));
                })()}
            </div>
          </div>
        </div>
      )}

      {/* Onglets de navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`
                  group inline-flex items-center py-4 px-1 border-b-2 font-medium text-sm
                  ${
                    activeTab === tab.id
                      ? "border-primary-500 text-primary-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }
                `}
              >
                <Icon
                  className={`
                    -ml-0.5 mr-2 h-5 w-5
                    ${
                      activeTab === tab.id
                        ? "text-primary-500"
                        : "text-gray-400 group-hover:text-gray-500"
                    }
                  `}
                />
                <div className="text-left">
                  <div>{tab.name}</div>
                  <div className="text-xs text-gray-400 dark:text-white font-normal">
                    {tab.description}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Contenu des onglets */}
      {investments.length === 0 && wallets.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {/* Vue d'ensemble */}
          {activeTab === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PortfolioChart
                investments={investments}
                wallets={wallets}
                chartType="pie"
                title="Répartition par Type d'Actif"
                subtitle={`Répartition de votre portfolio de $${totalValue.toLocaleString()}`}
                height={400}
              />
              <PortfolioChart
                investments={investments}
                wallets={wallets}
                chartType="area"
                title="Distribution Empilée"
                subtitle="Vue cumulative des types d'investissements"
                height={400}
              />
            </div>
          )}

          {/* Performance */}
          {activeTab === "performance" && (
            <div className="space-y-6">
              <PortfolioChart
                investments={investments}
                wallets={wallets}
                chartType="line"
                title="Évolution du Portfolio (30 jours)"
                subtitle="Performance historique simulée de votre portfolio"
                height={500}
              />
              <div className="grid grid-cols-1 gap-6">
                <PortfolioChart
                  investments={investments}
                  wallets={wallets}
                  chartType="column"
                  title="Comparaison des Investissements"
                  subtitle="Valeur actuelle vs Gain/Perte pour chaque investissement"
                  height={400}
                />
              </div>
            </div>
          )}

          {/* Analyse */}
          {activeTab === "analysis" && (
            <div className="space-y-6">
              {/* Statistiques rapides */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="card text-center">
                  <h4 className="text-sm font-medium text-gray-600 dark:text-white mb-2">
                    Investissements
                  </h4>
                  <p className="text-2xl font-bold text-primary-600 dark:text-white">
                    {investments.length}
                  </p>
                </div>
                <div className="card text-center">
                  <h4 className="text-sm font-medium text-gray-600 dark:text-white mb-2">
                    Wallets
                  </h4>
                  <p className="text-2xl font-bold text-primary-600 dark:text-white">
                    {wallets.length}
                  </p>
                </div>
                <div className="card text-center">
                  <h4 className="text-sm font-medium text-gray-600 dark:text-white mb-2">
                    Assets Blockchain
                  </h4>
                  <p className="text-2xl font-bold text-primary-600 dark:text-white">
                    {wallets.reduce(
                      (sum, wallet) =>
                        sum +
                        wallet.assets.filter((asset) => !asset.isHidden).length,
                      0
                    )}
                  </p>
                </div>
                <div className="card text-center">
                  <h4 className="text-sm font-medium text-gray-600 dark:text-white mb-2">
                    Valeur Totale
                  </h4>
                  <p className="text-2xl font-bold text-primary-600 dark:text-white">
                    ${totalValue.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Graphiques d'analyse */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PortfolioChart
                  investments={investments}
                  wallets={wallets}
                  chartType="column"
                  title="Top 10 par Valeur"
                  subtitle="Classement de vos plus gros investissements"
                  height={400}
                />
                <PortfolioChart
                  investments={investments}
                  wallets={wallets}
                  chartType="pie"
                  title="Répartition Détaillée"
                  subtitle="Distribution précise avec pourcentages"
                  height={400}
                />
              </div>

              {/* Tableau d'analyse détaillé */}
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Analyse Détaillée des Investissements et Assets
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-transparent">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                          Asset
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                          Type
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                          Source
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                          Valeur Actuelle
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                          % du Portfolio
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                          Gain/Perte
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                          % Rendement
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-[#111111]">
                      {(() => {
                        // Créer un Map pour regrouper les assets par symbole
                        const assetsMap = new Map<
                          string,
                          {
                            id: string;
                            name: string;
                            symbol: string;
                            currentValue: number;
                            gainLoss: number;
                            gainLossPercent: number;
                            portfolioPercent: number;
                            source: string;
                            type: string;
                            quantity?: number;
                          }
                        >();

                        // Ajouter les investissements
                        investments.forEach((inv) => {
                          const currentValue =
                            inv.quantity * (inv.currentPrice ?? 0);
                          const purchaseValue =
                            inv.quantity * inv.purchasePrice;
                          const gainLoss = currentValue - purchaseValue;
                          const gainLossPercent =
                            purchaseValue > 0
                              ? (gainLoss / purchaseValue) * 100
                              : 0;
                          const portfolioPercent =
                            totalValue > 0
                              ? (currentValue / totalValue) * 100
                              : 0;

                          const key = inv.symbol.toUpperCase();
                          if (assetsMap.has(key)) {
                            // Si l'asset existe déjà, ajouter les valeurs
                            const existing = assetsMap.get(key)!;
                            existing.currentValue += currentValue;
                            existing.gainLoss += gainLoss;
                            existing.portfolioPercent =
                              totalValue > 0
                                ? (existing.currentValue / totalValue) * 100
                                : 0;
                            if (existing.quantity) {
                              existing.quantity += inv.quantity;
                            } else {
                              existing.quantity = inv.quantity;
                            }
                          } else {
                            // Nouvel asset
                            assetsMap.set(key, {
                              id: inv.id,
                              name: inv.name,
                              symbol: inv.symbol,
                              currentValue,
                              gainLoss,
                              gainLossPercent,
                              portfolioPercent,
                              source: "Investissement",
                              type: inv.type,
                              quantity: inv.quantity,
                            });
                          }
                        });

                        // Ajouter les assets des wallets
                        wallets.forEach((wallet) => {
                          wallet.assets
                            .filter(
                              (asset) =>
                                !asset.isHidden &&
                                asset.value &&
                                asset.value > 0
                            )
                            .forEach((asset) => {
                              const currentValue = asset.value || 0;
                              const key = asset.symbol.toUpperCase();

                              if (assetsMap.has(key)) {
                                // Si l'asset existe déjà, ajouter la valeur
                                const existing = assetsMap.get(key)!;
                                existing.currentValue += currentValue;
                                existing.portfolioPercent =
                                  totalValue > 0
                                    ? (existing.currentValue / totalValue) * 100
                                    : 0;
                                if (existing.quantity) {
                                  existing.quantity += asset.balance;
                                } else {
                                  existing.quantity = asset.balance;
                                }
                                // Mettre à jour le type si c'est un crypto
                                if (asset.blockchain) {
                                  existing.type = "crypto";
                                }
                              } else {
                                // Nouvel asset
                                assetsMap.set(key, {
                                  id: `${wallet.id}-${asset.symbol}`,
                                  name: asset.name,
                                  symbol: asset.symbol,
                                  currentValue,
                                  gainLoss: 0, // Pas de données de gain/perte pour les wallets
                                  gainLossPercent: 0,
                                  portfolioPercent:
                                    totalValue > 0
                                      ? (currentValue / totalValue) * 100
                                      : 0,
                                  source: `Wallet ${wallet.name}`,
                                  type: "crypto",
                                  quantity: asset.balance,
                                });
                              }
                            });
                        });

                        return Array.from(assetsMap.values())
                          .sort((a, b) => b.currentValue - a.currentValue)
                          .map((item, idx) => (
                            <tr
                              key={item.id}
                              className={` ${
                                idx % 2 === 0
                                  ? "bg-gray-50 dark:bg-[#1a1a1a]"
                                  : "bg-white dark:bg-[#111111]"
                              } `}
                            >
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div>
                                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                                    {item.name}
                                  </div>
                                  <div className="text-sm text-gray-500 dark:text-white">
                                    {item.symbol}
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full
                                  ${
                                    item.type === "stock"
                                      ? "bg-blue-100 text-blue-800"
                                      : item.type === "crypto"
                                      ? "bg-orange-100 text-orange-800"
                                      : item.type === "etf"
                                      ? "bg-green-100 text-green-800"
                                      : item.type === "bond"
                                      ? "bg-purple-100 text-purple-800"
                                      : "bg-gray-100 text-gray-800"
                                  }`}
                                >
                                  {item.type.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                {item.source}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                ${item.currentValue.toLocaleString()}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                {item.portfolioPercent.toFixed(1)}%
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                {item.gainLoss !== 0 ? (
                                  <span
                                    className={
                                      item.gainLoss >= 0
                                        ? "text-success-600"
                                        : "text-danger-600"
                                    }
                                  >
                                    {item.gainLoss >= 0 ? "+" : ""}$
                                    {item.gainLoss.toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="text-gray-500 dark:text-white">
                                    N/A
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                {item.gainLossPercent !== 0 ? (
                                  <span
                                    className={
                                      item.gainLossPercent >= 0
                                        ? "text-success-600"
                                        : "text-danger-600"
                                    }
                                  >
                                    {item.gainLossPercent >= 0 ? "+" : ""}
                                    {item.gainLossPercent.toFixed(2)}%
                                  </span>
                                ) : (
                                  <span className="text-gray-500 dark:text-white">
                                    N/A
                                  </span>
                                )}
                              </td>
                            </tr>
                          ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
