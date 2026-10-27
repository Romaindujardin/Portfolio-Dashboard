import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Building2,
  Coins,
  Flame,
  Globe,
  Layers,
  PieChart as PieIcon,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useUser } from "../contexts/UserContext";
import { useCurrency } from "../contexts/CurrencyContext";
import type {
  EtfProfile,
  PortfolioEtfBreakdown,
  Quote,
} from "../types/portfolio";
import {
  getEtfBreakdown,
  getEtfCatalog,
  getEtfProfile,
  getMarketIndices,
  getQuote,
  refreshPrices,
  searchSymbols,
} from "../services/portfolioApi";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  Spinner,
  SuccessBanner,
  cn,
  formatDate,
  formatEur,
  formatPercent,
} from "../components/patrimoine/shared";

// Catégories des instruments de référence
const INDEX_CATEGORIES: Record<
  string,
  { label: string; icon: React.ReactNode; tone: "blue" | "gold" | "green" | "gray" }
> = {
  "^FCHI": { label: "Indice Paris", icon: <Globe className="h-3 w-3" />, tone: "blue" },
  "^GSPC": { label: "Indice US", icon: <Globe className="h-3 w-3" />, tone: "blue" },
  "^IXIC": { label: "Tech US", icon: <Globe className="h-3 w-3" />, tone: "blue" },
  "^STOXX50E": { label: "Zone Euro", icon: <Globe className="h-3 w-3" />, tone: "blue" },
  "BTC-EUR": { label: "Crypto", icon: <Coins className="h-3 w-3" />, tone: "gold" },
  "ETH-EUR": { label: "Crypto", icon: <Coins className="h-3 w-3" />, tone: "gold" },
  "GC=F": { label: "Matière 1ère", icon: <Flame className="h-3 w-3" />, tone: "gold" },
  "BZ=F": { label: "Énergie", icon: <Flame className="h-3 w-3" />, tone: "gray" },
};

// Raccourcis populaires pour recherche rapide
const POPULAR_TICKERS = [
  { ticker: "CW8.PA", name: "Amundi MSCI World" },
  { ticker: "PE500.PA", name: "Amundi S&P 500 PEA" },
  { ticker: "ESE.PA", name: "BNP Easy S&P 500" },
  { ticker: "UST.PA", name: "Amundi Nasdaq 100" },
  { ticker: "MC.PA", name: "LVMH" },
  { ticker: "TTE.PA", name: "TotalEnergies" },
  { ticker: "AI.PA", name: "Air Liquide" },
  { ticker: "AAPL", name: "Apple" },
  { ticker: "NVDA", name: "Nvidia" },
  { ticker: "MSFT", name: "Microsoft" },
];

type MainTab = "etf-lookthrough" | "indices" | "search";

const Market: React.FC = () => {
  const { currentUser } = useUser();
  const { formatMoney } = useCurrency();

  const [activeTab, setActiveTab] = useState<MainTab>("etf-lookthrough");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // ─── 1. État du Look-Through ETF ──────────────────────────────────────────
  const [breakdown, setBreakdown] = useState<PortfolioEtfBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(true);
  const [catalog, setCatalog] = useState<EtfProfile[]>([]);
  const [selectedEtfProfile, setSelectedEtfProfile] = useState<EtfProfile | null>(null);
  const [inspectingCatalogLoading, setInspectingCatalogLoading] = useState(false);

  // ─── 2. État des Indices de marché ────────────────────────────────────────
  const [indices, setIndices] = useState<Quote[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(true);
  const [indicesFilter, setIndicesFilter] = useState<"ALL" | "INDICES" | "CRYPTO" | "COMMODITIES">("ALL");

  // ─── 3. Recherche et Fiche détaillée ──────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{ ticker: string; name: string; exchange: string | null }>
  >([]);
  const [inspectedTicker, setInspectedTicker] = useState<string>("^FCHI");
  const [inspectedQuote, setInspectedQuote] = useState<Quote | null>(null);
  const [inspectedLoading, setInspectedLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  const [refreshing, setRefreshing] = useState(false);

  // Chargement du Look-Through ETF
  const loadBreakdown = useCallback(async () => {
    setBreakdownLoading(true);
    try {
      const data = await getEtfBreakdown(currentUser);
      setBreakdown(data);
    } catch {
      // Tolérance si hors ligne
    } finally {
      setBreakdownLoading(false);
    }
  }, [currentUser]);

  // Chargement du catalogue d'ETF de référence
  const loadCatalog = useCallback(async () => {
    try {
      const cat = await getEtfCatalog();
      setCatalog(cat);
      if (cat.length > 0 && !selectedEtfProfile) {
        setSelectedEtfProfile(cat[0]);
      }
    } catch {
      // Tolérance
    }
  }, [selectedEtfProfile]);

  // Chargement des indices
  const loadIndices = useCallback(async (force = false) => {
    setIndicesLoading(true);
    try {
      const data = await getMarketIndices(undefined, force);
      setIndices(data || []);
    } catch {
      // Tolérance
    } finally {
      setIndicesLoading(false);
    }
  }, []);

  // Inspection d'une cotation
  const inspectInstrument = useCallback(async (ticker: string, force = false) => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setInspectedTicker(sym);
    setInspectedLoading(true);
    setQuoteError("");
    try {
      const q = await getQuote(sym, force);
      setInspectedQuote(q);
    } catch (err) {
      setInspectedQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Cotation indisponible.");
    } finally {
      setInspectedLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBreakdown();
    void loadCatalog();
    void loadIndices(false);
    void inspectInstrument("^FCHI", false);
  }, [loadBreakdown, loadCatalog, loadIndices, inspectInstrument]);

  // Recherche de symboles
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const results = await searchSymbols(q);
      setSearchResults(results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Sélection d'un profil ETF du catalogue ou recherche
  const handleSelectEtf = async (identifier: string) => {
    setInspectingCatalogLoading(true);
    try {
      const profile = await getEtfProfile(identifier);
      setSelectedEtfProfile(profile);
    } catch {
      // Tolérance
    } finally {
      setInspectingCatalogLoading(false);
    }
  };

  // Rafraîchissement global des cours
  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      const result = await refreshPrices(currentUser, true);
      await Promise.all([loadBreakdown(), loadIndices(true)]);
      setNotice({
        kind: result.failed.length > 0 ? "error" : "success",
        message: `${result.updated} cours actualisés avec succès${
          result.failed.length ? `, ${result.failed.length} échec(s)` : ""
        }.`,
      });
    } catch (err) {
      setNotice({
        kind: "error",
        message: err instanceof Error ? err.message : "Rafraîchissement impossible.",
      });
    } finally {
      setRefreshing(false);
    }
  };

  // Indices filtrés
  const filteredIndices = useMemo(() => {
    if (indicesFilter === "INDICES") return indices.filter((q) => q.ticker.startsWith("^"));
    if (indicesFilter === "CRYPTO") return indices.filter((q) => q.ticker.includes("BTC") || q.ticker.includes("ETH"));
    if (indicesFilter === "COMMODITIES") return indices.filter((q) => q.ticker.includes("GC=") || q.ticker.includes("BZ="));
    return indices;
  }, [indices, indicesFilter]);

  // Données pour le camembert sectoriel Recharts
  const pieChartData = useMemo(() => {
    if (!breakdown?.sectors) return [];
    return breakdown.sectors.map((s) => ({
      name: s.sector,
      value: s.value,
      color: s.color,
      weight: s.weight,
    }));
  }, [breakdown]);

  return (
    <div className="space-y-6">
      {notice && (
        notice.kind === "success" ? (
          <SuccessBanner message={notice.message} onClose={() => setNotice(null)} />
        ) : (
          <ErrorBanner message={notice.message} onClose={() => setNotice(null)} />
        )
      )}

      {/* ─── En-tête principal de la page ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c8a55e]/15 border border-[#c8a55e]/30 text-[#c8a55e]">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">
                Marchés & Répartition des ETF
              </h1>
              <p className="text-xs text-[#8a8a8a] mt-0.5">
                Décomposition sectorielle & géographique (méthode Picsou), transparence des sous-jacents et cotations mondiales.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleRefreshAll} loading={refreshing}>
            <RefreshCw className="h-3.5 w-3.5" />
            Actualiser les cours
          </Button>
        </div>
      </div>

      {/* ─── Onglets de navigation principale ───────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("etf-lookthrough")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all",
            activeTab === "etf-lookthrough"
              ? "bg-[rgba(200,165,94,0.15)] text-[#d4b56e] border border-[#c8a55e]/30 shadow-sm"
              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-white/5",
          )}
        >
          <PieIcon className="h-4 w-4" />
          <span>Répartition & Look-Through ETF</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("indices")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all",
            activeTab === "indices"
              ? "bg-[rgba(200,165,94,0.15)] text-[#d4b56e] border border-[#c8a55e]/30 shadow-sm"
              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-white/5",
          )}
        >
          <Activity className="h-4 w-4" />
          <span>Baromètres & Grands Indices</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("search")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all",
            activeTab === "search"
              ? "bg-[rgba(200,165,94,0.15)] text-[#d4b56e] border border-[#c8a55e]/30 shadow-sm"
              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-white/5",
          )}
        >
          <Search className="h-4 w-4" />
          <span>Recherche & Fiche Titre</span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ONGLET 1 : RÉPARTITION ET LOOK-THROUGH ETF (MÉTHODE PICSOU)            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "etf-lookthrough" && (
        <div className="space-y-6">
          {/* Bannière explicative Picsou */}
          <div className="p-4 rounded-xl border border-[#c8a55e]/20 bg-[rgba(200,165,94,0.05)] flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-[#c8a55e] flex-shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <span className="font-semibold text-[#f5f5f5] block">
                Analyse par transparence (Look-Through) des ETF et Fonds
              </span>
              <p className="text-[#8a8a8a] leading-relaxed">
                Plutôt que de considérer vos ETF (MSCI World, S&P 500, Talence PME...) comme une simple ligne d'actifs, le moteur Picsou décompose chaque fonds en ses secteurs économiques et zones géographiques réels, et calcule votre exposition directe aux plus grandes entreprises mondiales.
              </p>
            </div>
          </div>

          {/* Cartes KPI du Look-Through */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 flex flex-col justify-between">
              <span className="text-xs text-[#8a8a8a] block mb-1">
                Portefeuille Investi Analysé
              </span>
              <div className="text-xl font-bold text-[#f5f5f5]">
                {breakdownLoading ? (
                  <span className="text-sm text-[#8a8a8a]">Calcul...</span>
                ) : (
                  formatMoney(breakdown?.totalValue ?? 0)
                )}
              </div>
              <span className="text-[11px] text-[#555555] block mt-1">
                {breakdown?.assetCount ?? 0} actif(s) sous surveillance
              </span>
            </Card>

            <Card className="p-4 flex flex-col justify-between">
              <span className="text-xs text-[#8a8a8a] block mb-1">
                Exposition Technologie
              </span>
              <div className="text-xl font-bold text-[#3b82f6]">
                {breakdownLoading ? (
                  <span className="text-sm text-[#8a8a8a]">Calcul...</span>
                ) : (
                  formatPercent(breakdown?.summary?.techWeight ?? 0)
                )}
              </div>
              <span className="text-[11px] text-[#555555] block mt-1">
                1er secteur mondial d'innovation
              </span>
            </Card>

            <Card className="p-4 flex flex-col justify-between">
              <span className="text-xs text-[#8a8a8a] block mb-1">
                Exposition États-Unis
              </span>
              <div className="text-xl font-bold text-[#f5f5f5] flex items-center gap-1.5">
                <span>🇺🇸</span>
                <span>
                  {breakdownLoading ? "..." : formatPercent(breakdown?.summary?.usWeight ?? 0)}
                </span>
              </div>
              <span className="text-[11px] text-[#555555] block mt-1">
                Part de marché US consolidée
              </span>
            </Card>

            <Card className="p-4 flex flex-col justify-between">
              <span className="text-xs text-[#8a8a8a] block mb-1">
                Concentration Top 10
              </span>
              <div className="text-xl font-bold text-[#10b981]">
                {breakdownLoading ? (
                  <span className="text-sm text-[#8a8a8a]">Calcul...</span>
                ) : (
                  formatPercent(breakdown?.summary?.top10Concentration ?? 0)
                )}
              </div>
              <span className="text-[11px] text-[#555555] block mt-1">
                {breakdown?.summary?.uniqueCompaniesCount ?? 0} sociétés sous-jacentes
              </span>
            </Card>
          </div>

          {/* Grille Bento : Répartition Sectorielle & Géographique */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. Répartition Sectorielle */}
            <Card className="p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <PieIcon className="h-4 w-4 text-[#c8a55e]" />
                    <h3 className="text-sm font-semibold text-[#f5f5f5]">
                      Répartition Sectorielle Consolidée
                    </h3>
                  </div>
                  <Badge tone="gray">GICS Standards</Badge>
                </div>

                {breakdownLoading ? (
                  <div className="h-64 flex items-center justify-center">
                    <Spinner label="Analyse de la répartition sectorielle..." />
                  </div>
                ) : breakdown?.sectors.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-xs text-[#8a8a8a]">
                    Aucune ligne d'investissement trouvée.
                  </div>
                ) : (
                  <div>
                    {/* Graphique Donut */}
                    <div className="h-48 w-full flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPieChart>
                          <Pie
                            data={pieChartData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={75}
                            paddingAngle={2}
                          >
                            {pieChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            formatter={(val: number) => formatMoney(val)}
                            contentStyle={{
                              backgroundColor: "#161616",
                              borderColor: "rgba(255,255,255,0.1)",
                              borderRadius: "8px",
                              fontSize: "12px",
                              color: "#f5f5f5",
                            }}
                          />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Liste des secteurs */}
                    <div className="space-y-2 mt-4 max-h-60 overflow-y-auto pr-1">
                      {breakdown?.sectors.map((s) => (
                        <div key={s.sector} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-[#d4d4d4]">
                              <span
                                className="h-2 w-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: s.color }}
                              />
                              <span className="truncate max-w-[180px]">{s.sector}</span>
                            </span>
                            <span className="font-semibold text-[#f5f5f5]">
                              {formatMoney(s.value)} ({formatPercent(s.weight, 1)})
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(s.weight, 100)}%`, backgroundColor: s.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* 2. Répartition Géographique */}
            <Card className="p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-[#3b82f6]" />
                    <h3 className="text-sm font-semibold text-[#f5f5f5]">
                      Exposition Géographique Mondiale
                    </h3>
                  </div>
                  <Badge tone="blue">Pondération par pays</Badge>
                </div>

                {breakdownLoading ? (
                  <div className="h-64 flex items-center justify-center">
                    <Spinner label="Calcul de l'exposition pays..." />
                  </div>
                ) : breakdown?.countries.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-xs text-[#8a8a8a]">
                    Aucune ligne d'investissement trouvée.
                  </div>
                ) : (
                  <div className="space-y-3.5 mt-2 max-h-[380px] overflow-y-auto pr-1">
                    {breakdown?.countries.map((c) => (
                      <div
                        key={c.country}
                        className="p-3 rounded-lg bg-[rgba(255,255,255,0.02)] border border-white/5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2 font-medium text-[#f5f5f5]">
                            <span className="text-base">{c.flag}</span>
                            <span>{c.country}</span>
                          </span>
                          <div className="text-right">
                            <span className="font-semibold text-[#f5f5f5]">
                              {formatMoney(c.value)}
                            </span>
                            <span className="text-[11px] text-[#8a8a8a] ml-1.5">
                              ({formatPercent(c.weight, 1)})
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#c8a55e] transition-all duration-500"
                            style={{ width: `${Math.min(c.weight, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Grille Bento : Top Entreprises sous-jacentes (Look-Through) */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[#f5f5f5] flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-[#10b981]" />
                  <span>Top Sociétés Sous-Jacentes Détenues (Look-Through)</span>
                </h3>
                <p className="text-xs text-[#8a8a8a] mt-0.5">
                  Montant exact investi indirectement dans chaque entreprise à travers l'ensemble de vos ETF et fonds.
                </p>
              </div>
              <Badge tone="green">Transparence totale</Badge>
            </div>

            {breakdownLoading ? (
              <div className="py-12 flex items-center justify-center">
                <Spinner label="Consolidation des sous-jacents..." />
              </div>
            ) : breakdown?.topHoldings.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#8a8a8a]">
                Aucune entreprise sous-jacente identifiée.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-[#8a8a8a]">
                      <th className="py-2.5 px-3 font-medium">Société</th>
                      <th className="py-2.5 px-3 font-medium">Ticker</th>
                      <th className="py-2.5 px-3 font-medium">Secteur</th>
                      <th className="py-2.5 px-3 font-medium text-right">Montant Indirect Détenu</th>
                      <th className="py-2.5 px-3 font-medium text-right">Part du Portefeuille</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {breakdown?.topHoldings.map((comp, idx) => (
                      <tr key={comp.name} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-2.5 px-3 font-medium text-[#f5f5f5] flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/5 text-[10px] text-[#8a8a8a]">
                            {idx + 1}
                          </span>
                          <span>{comp.name}</span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[#c8a55e]">
                          {comp.ticker || "-"}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded bg-white/5 text-[#8a8a8a] text-[11px]">
                            {comp.sector}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-[#f5f5f5]">
                          {formatMoney(comp.value)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#10b981]">
                          {formatPercent(comp.weight, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Grille Bento : Inspecteur & Catalogue de référence des ETF mondiaux */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[#f5f5f5] flex items-center gap-2">
                  <Layers className="h-4 w-4 text-[#c8a55e]" />
                  <span>Inspecteur & Fiche de Décomposition d'un ETF</span>
                </h3>
                <p className="text-xs text-[#8a8a8a] mt-0.5">
                  Visualisez la composition exacte (secteurs, pays, constituants) de n'importe quel ETF majeur.
                </p>
              </div>

              {/* Raccourcis de sélection */}
              <div className="flex flex-wrap items-center gap-1.5">
                {catalog.slice(0, 6).map((etf) => (
                  <button
                    key={etf.id}
                    type="button"
                    onClick={() => handleSelectEtf(etf.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border",
                      selectedEtfProfile?.id === etf.id
                        ? "bg-[rgba(200,165,94,0.18)] text-[#d4b56e] border-[#c8a55e]/40"
                        : "bg-white/5 text-[#8a8a8a] border-white/5 hover:text-[#f5f5f5]",
                    )}
                  >
                    {etf.name.split("(")[0].trim()}
                  </button>
                ))}
              </div>
            </div>

            {inspectingCatalogLoading ? (
              <div className="py-12 flex items-center justify-center">
                <Spinner label="Chargement de la fiche ETF..." />
              </div>
            ) : selectedEtfProfile ? (
              <div className="space-y-4 rounded-xl bg-[rgba(255,255,255,0.02)] border border-white/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/5 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-[#f5f5f5]">
                        {selectedEtfProfile.name}
                      </span>
                      <Badge tone="gold">{selectedEtfProfile.type || "ETF"}</Badge>
                    </div>
                    {selectedEtfProfile.description && (
                      <p className="text-xs text-[#8a8a8a] mt-1 max-w-2xl">
                        {selectedEtfProfile.description}
                      </p>
                    )}
                  </div>
                  {selectedEtfProfile.benchmark && (
                    <div className="text-right text-xs">
                      <span className="text-[#8a8a8a] block">Indice de référence</span>
                      <span className="font-mono text-[#d4d4d4]">{selectedEtfProfile.benchmark}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  {/* Secteurs de l'ETF */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#8a8a8a] block mb-2">
                      Secteurs Clés
                    </span>
                    {Object.entries(selectedEtfProfile.sectors || {})
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([sector, pct]) => (
                        <div key={sector} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#d4d4d4] truncate max-w-[150px]">{sector}</span>
                            <span className="font-mono font-semibold text-[#c8a55e]">
                              {formatPercent(pct, 1)}
                            </span>
                          </div>
                          <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#c8a55e]"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Géographie de l'ETF */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#8a8a8a] block mb-2">
                      Zones Géographiques
                    </span>
                    {Object.entries(selectedEtfProfile.countries || {})
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([country, pct]) => (
                        <div key={country} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#d4d4d4] truncate max-w-[150px]">{country}</span>
                            <span className="font-mono font-semibold text-[#3b82f6]">
                              {formatPercent(pct, 1)}
                            </span>
                          </div>
                          <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#3b82f6]"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Top Constituants */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#8a8a8a] block mb-2">
                      Premières Pondérations
                    </span>
                    {selectedEtfProfile.topHoldings?.slice(0, 5).map((comp, idx) => (
                      <div
                        key={comp.name}
                        className="flex items-center justify-between text-xs py-1 border-b border-white/5 last:border-0"
                      >
                        <span className="flex items-center gap-1.5 text-[#d4d4d4] truncate max-w-[150px]">
                          <span className="text-[10px] text-[#8a8a8a]">{idx + 1}.</span>
                          <span>{comp.name}</span>
                        </span>
                        <span className="font-mono font-semibold text-[#10b981]">
                          {formatPercent(comp.weight, 1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ONGLET 2 : BAROMÈTRES & GRANDS INDICES MONDIAUX                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "indices" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#c8a55e]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d4]">
                Baromètres & Grands Indices Mondiaux
              </h3>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-[#111111] p-0.5 text-xs">
              {(
                [
                  ["ALL", "Tous"],
                  ["INDICES", "Indices"],
                  ["CRYPTO", "Crypto"],
                  ["COMMODITIES", "Matières 1ères"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIndicesFilter(key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    indicesFilter === key
                      ? "bg-[rgba(200,165,94,0.18)] text-[#d4b56e]"
                      : "text-[#8a8a8a] hover:text-[#f5f5f5]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {indicesLoading && indices.length === 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="p-4 animate-pulse">
                  <div className="h-3 w-16 bg-white/5 rounded mb-2" />
                  <div className="h-6 w-24 bg-white/10 rounded mb-1" />
                  <div className="h-3 w-12 bg-white/5 rounded" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {filteredIndices.map((idx) => {
                const meta = INDEX_CATEGORIES[idx.ticker] || {
                  label: "Marché",
                  icon: <BarChart2 className="h-3 w-3" />,
                  tone: "gray",
                };
                const isSelected = inspectedTicker === idx.ticker;
                const isPositive = (idx.changePercent ?? 0) >= 0;

                return (
                  <Card
                    key={idx.ticker}
                    onClick={() => {
                      void inspectInstrument(idx.ticker);
                      setActiveTab("search");
                    }}
                    className={cn(
                      "p-4 cursor-pointer transition-all hover:border-[#c8a55e]/40",
                      isSelected && "border-[#c8a55e] bg-[rgba(200,165,94,0.03)]",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-xs text-[#8a8a8a]">
                        {meta.icon}
                        <span>{idx.name || idx.ticker}</span>
                      </span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="text-lg font-bold text-[#f5f5f5]">
                      {formatMoney(idx.price)}
                    </div>
                    <div
                      className={cn(
                        "flex items-center gap-1 text-xs font-semibold mt-1",
                        isPositive ? "text-[#10b981]" : "text-[#ef4444]",
                      )}
                    >
                      {isPositive ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" />
                      )}
                      <span>{formatPercent(idx.changePercent ?? 0)}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ONGLET 3 : RECHERCHE UNIVERSELLE & FICHE DÉTAILLÉE                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "search" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Colonne gauche : Moteur de recherche et raccourcis */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-[#c8a55e]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d4]">
                  Rechercher un Titre ou ETF
                </h3>
              </div>

              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                  placeholder="Ex : CW8, PE500, LVMH, AAPL, BTC..."
                  className="flex-1 text-xs"
                />
                <Button onClick={handleSearch} loading={searching} className="!px-3">
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Raccourcis populaires */}
              <div>
                <span className="text-[11px] text-[#8a8a8a] block mb-2">
                  Valeurs & ETF populaires :
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_TICKERS.map((t) => (
                    <button
                      key={t.ticker}
                      type="button"
                      onClick={() => void inspectInstrument(t.ticker)}
                      className={cn(
                        "px-2 py-0.5 rounded text-[11px] font-medium border transition-colors",
                        inspectedTicker === t.ticker
                          ? "bg-[rgba(200,165,94,0.2)] text-[#d4b56e] border-[#c8a55e]/40"
                          : "bg-white/5 text-[#8a8a8a] border-white/5 hover:text-[#f5f5f5]",
                      )}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Résultats de recherche dynamique */}
              {searchResults.length > 0 && (
                <div className="pt-2 border-t border-white/5 space-y-1 max-h-60 overflow-y-auto">
                  <span className="text-[11px] text-[#8a8a8a] block mb-1">
                    Résultats ({searchResults.length}) :
                  </span>
                  {searchResults.map((res) => (
                    <div
                      key={res.ticker}
                      onClick={() => void inspectInstrument(res.ticker)}
                      className="p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer flex items-center justify-between text-xs transition-colors"
                    >
                      <div>
                        <span className="font-semibold text-[#f5f5f5] block">
                          {res.ticker}
                        </span>
                        <span className="text-[#8a8a8a] text-[11px] truncate block max-w-[200px]">
                          {res.name}
                        </span>
                      </div>
                      <Badge tone="gray">{res.exchange || "Marché"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Colonne droite : Fiche de cotation détaillée */}
          <div className="lg:col-span-7">
            {inspectedLoading ? (
              <Card className="p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
                <Spinner label={`Interrogation des cours pour ${inspectedTicker}...`} />
              </Card>
            ) : quoteError ? (
              <Card className="p-6">
                <ErrorBanner message={quoteError} />
              </Card>
            ) : inspectedQuote ? (
              <Card className="p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-[#f5f5f5]">
                        {inspectedQuote.name || inspectedQuote.ticker}
                      </span>
                      <Badge tone="gold">{inspectedQuote.ticker}</Badge>
                    </div>
                    <span className="text-xs text-[#8a8a8a] block mt-1">
                      {inspectedQuote.exchange || "Marché international"} • Devise : {inspectedQuote.currency}
                    </span>
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-bold text-[#f5f5f5]">
                      {formatMoney(inspectedQuote.price)}
                    </div>
                    <div
                      className={cn(
                        "flex items-center justify-end gap-1 text-xs font-semibold mt-0.5",
                        (inspectedQuote.changePercent ?? 0) >= 0
                          ? "text-[#10b981]"
                          : "text-[#ef4444]",
                      )}
                    >
                      {(inspectedQuote.changePercent ?? 0) >= 0 ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {formatEur(inspectedQuote.change ?? 0)} ({formatPercent(inspectedQuote.changePercent ?? 0)})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Métriques détaillées */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-white/5">
                    <span className="text-[11px] text-[#8a8a8a] block mb-1">Clôture veille</span>
                    <span className="text-sm font-semibold text-[#f5f5f5]">
                      {inspectedQuote.previousClose ? formatMoney(inspectedQuote.previousClose) : "—"}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-white/5">
                    <span className="text-[11px] text-[#8a8a8a] block mb-1">Plus haut jour</span>
                    <span className="text-sm font-semibold text-[#10b981]">
                      {inspectedQuote.dayHigh ? formatMoney(inspectedQuote.dayHigh) : "—"}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-white/5">
                    <span className="text-[11px] text-[#8a8a8a] block mb-1">Plus bas jour</span>
                    <span className="text-sm font-semibold text-[#ef4444]">
                      {inspectedQuote.dayLow ? formatMoney(inspectedQuote.dayLow) : "—"}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-white/5">
                    <span className="text-[11px] text-[#8a8a8a] block mb-1">Plus haut 52 sem.</span>
                    <span className="text-sm font-semibold text-[#f5f5f5]">
                      {inspectedQuote.fiftyTwoWeekHigh ? formatMoney(inspectedQuote.fiftyTwoWeekHigh) : "—"}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-[#555555] flex items-center justify-between pt-2">
                  <span>Source des données : Yahoo Finance</span>
                  <span>Dernière cotation : {inspectedQuote.fetchedAt ? formatDate(inspectedQuote.fetchedAt) : "Récent"}</span>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default Market;
