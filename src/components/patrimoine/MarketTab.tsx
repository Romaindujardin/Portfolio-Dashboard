import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Coins,
  Flame,
  Globe,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type { Holding, PortfolioAccount, Quote } from "../../types/portfolio";
import {
  getMarketIndices,
  getQuote,
  refreshPrices,
  searchSymbols,
} from "../../services/portfolioApi";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  SectionHeader,
  cn,
  formatDate,
  formatEur,
  formatPercent,
} from "./shared";

type Notify = (kind: "success" | "error", message: string) => void;

interface MarketTabProps {
  userId: string;
  holdings: Holding[];
  accounts: PortfolioAccount[];
  onReload: () => Promise<void>;
  notify: Notify;
}

// Catégories des instruments de référence
const INDEX_CATEGORIES: Record<string, { label: string; icon: React.ReactNode; tone: "blue" | "gold" | "green" | "gray" }> = {
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
  { ticker: "MC.PA", name: "LVMH" },
  { ticker: "TTE.PA", name: "TotalEnergies" },
  { ticker: "AI.PA", name: "Air Liquide" },
  { ticker: "CW8.PA", name: "Amundi MSCI World" },
  { ticker: "ESE.PA", name: "BNP Easy S&P 500" },
  { ticker: "AAPL", name: "Apple" },
  { ticker: "NVDA", name: "Nvidia" },
  { ticker: "MSFT", name: "Microsoft" },
  { ticker: "BNP.PA", name: "BNP Paribas" },
];

const MarketTab: React.FC<MarketTabProps> = ({
  userId,
  onReload,
  notify,
}) => {
  // ─── État des indices de marché ───────────────────────────────────────────
  const [indices, setIndices] = useState<Quote[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(true);
  const [indicesFilter, setIndicesFilter] = useState<"ALL" | "INDICES" | "CRYPTO" | "COMMODITIES">("ALL");

  // ─── État du rafraîchissement global du portefeuille ──────────────────────
  const [refreshing, setRefreshing] = useState(false);

  // ─── État de la recherche et fiche détaillée ──────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{ ticker: string; name: string; exchange: string | null }>
  >([]);

  // Instrument inspecté (par défaut CAC 40)
  const [inspectedTicker, setInspectedTicker] = useState<string>("^FCHI");
  const [inspectedQuote, setInspectedQuote] = useState<Quote | null>(null);
  const [inspectedLoading, setInspectedLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  // Chargement initial des grands indices
  const loadIndices = async (force = false) => {
    setIndicesLoading(true);
    try {
      const data = await getMarketIndices(undefined, force);
      setIndices(data || []);
    } catch {
      // Tolérance : ne bloque pas la page si hors-ligne
    } finally {
      setIndicesLoading(false);
    }
  };

  useEffect(() => {
    void loadIndices(false);
  }, []);

  // Chargement de la fiche de cotation détaillée
  const inspectInstrument = async (ticker: string, force = false) => {
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
  };

  useEffect(() => {
    void inspectInstrument("^FCHI", false);
  }, []);

  // Recherche dynamique de symboles
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

  // Rafraîchissement des cours des actifs du portefeuille
  const refreshPortfolio = async () => {
    setRefreshing(true);
    try {
      const result = await refreshPrices(userId, true);
      await onReload();
      await loadIndices(true);
      notify(
        result.failed.length > 0 ? "error" : "success",
        `${result.updated} cours mis à jour${
          result.failed.length ? `, ${result.failed.length} échec(s)` : ""
        }.`,
      );
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Rafraîchissement impossible.");
    } finally {
      setRefreshing(false);
    }
  };

  // Filtrage des indices selon la catégorie
  const filteredIndices = useMemo(() => {
    if (indicesFilter === "INDICES") {
      return indices.filter((q) => q.ticker.startsWith("^"));
    }
    if (indicesFilter === "CRYPTO") {
      return indices.filter((q) => q.ticker.includes("BTC") || q.ticker.includes("ETH"));
    }
    if (indicesFilter === "COMMODITIES") {
      return indices.filter((q) => q.ticker.includes("GC=") || q.ticker.includes("BZ="));
    }
    return indices;
  }, [indices, indicesFilter]);

  return (
    <div className="space-y-6">
      {/* ─── En-tête de la page Marchés ────────────────────────────────────── */}
      <SectionHeader
        title="Marchés Financiers"
        subtitle="Baromètres en temps réel, indices boursiers internationaux, recherche de titres et cours en direct."
        action={
          <Button onClick={refreshPortfolio} loading={refreshing}>
            <RefreshCw className="h-3.5 w-3.5" /> Actualiser les cours
          </Button>
        }
      />

      {/* ─── Section 1 : Baromètres & Grands Indices Mondiaux ───────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#c8a55e]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d4]">
              Baromètres & Grands Indices Mondiaux
            </h3>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-0.5 text-xs">
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
                <button
                  key={idx.ticker}
                  type="button"
                  onClick={() => inspectInstrument(idx.ticker)}
                  className={cn(
                    "rounded-xl border p-3.5 text-left transition-all duration-150 flex flex-col justify-between",
                    isSelected
                      ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] shadow-lg shadow-[#c8a55e]/5"
                      : "border-[rgba(255,255,255,0.07)] bg-[#111111] hover:border-[rgba(255,255,255,0.15)] hover:bg-[#141414]",
                  )}
                >
                  <div className="flex items-center justify-between gap-1 w-full mb-2">
                    <span className="truncate text-xs font-semibold text-[#f5f5f5]">
                      {idx.name || idx.ticker}
                    </span>
                    <Badge tone={meta.tone}>
                      {meta.icon}
                      <span className="ml-1">{meta.label}</span>
                    </Badge>
                  </div>

                  <div>
                    <p className="text-base font-semibold tabular-nums text-[#f5f5f5]">
                      {formatEur(idx.price)}
                    </p>

                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-[#6a6a6a]">{idx.ticker}</span>
                      {idx.changePercent != null ? (
                        <div
                          className={cn(
                            "flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
                            isPositive ? "text-[#10b981]" : "text-[#ef4444]",
                          )}
                        >
                          {isPositive ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          <span>{formatPercent(idx.changePercent, 2)}</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[#6a6a6a]">—</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Section 2 : Recherche & Fiche Cotation Interactive ──────────────── */}
      <Card className="p-5 space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Search className="h-4 w-4 text-[#c8a55e]" />
            <h3 className="text-sm font-semibold text-[#f5f5f5]">
              Rechercher & Analyser un Instrument
            </h3>
          </div>
          <p className="text-xs text-[#8a8a8a]">
            Tapez un symbole ou nom (ex: <em>MC.PA</em>, <em>AAPL</em>, <em>CW8.PA</em>, <em>TotalEnergies</em>) ou choisissez un actif ci-dessous.
          </p>
        </div>

        {/* Barre de recherche */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#6a6a6a]" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (searchQuery.trim().includes(".")) {
                    void inspectInstrument(searchQuery.trim());
                  } else {
                    void handleSearch();
                  }
                }
              }}
              placeholder="Rechercher ticker ou nom (ex: CW8.PA, MC.PA, NVDA, Air Liquide)..."
              className="pl-9"
            />
          </div>
          <Button variant="secondary" onClick={handleSearch} loading={searching}>
            <Search className="h-3.5 w-3.5" /> Rechercher
          </Button>
          {searchQuery && (
            <Button
              variant="primary"
              onClick={() => inspectInstrument(searchQuery.trim())}
              loading={inspectedLoading}
            >
              Afficher le cours
            </Button>
          )}
        </div>

        {/* Raccourcis populaires */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-[#6a6a6a] mr-1">Populaires :</span>
          {POPULAR_TICKERS.map((item) => (
            <button
              key={item.ticker}
              type="button"
              onClick={() => inspectInstrument(item.ticker)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition-colors",
                inspectedTicker === item.ticker
                  ? "border-[#c8a55e] bg-[rgba(200,165,94,0.15)] text-[#f5f5f5]"
                  : "border-[rgba(255,255,255,0.06)] bg-[#141414] text-[#8a8a8a] hover:border-white/10 hover:text-[#f5f5f5]",
              )}
            >
              <strong className="text-[#f5f5f5] mr-1">{item.name}</strong>
              <span className="text-[10px] text-[#6a6a6a]">{item.ticker}</span>
            </button>
          ))}
        </div>

        {/* Résultats de recherche */}
        {searchResults.length > 0 && (
          <div className="rounded-lg border border-[rgba(255,255,255,0.07)] bg-[#0d0d0d] p-2 space-y-1">
            <p className="text-[10px] uppercase font-semibold text-[#6a6a6a] px-2 py-1">
              Résultats de recherche ({searchResults.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {searchResults.map((res) => (
                <button
                  key={res.ticker}
                  type="button"
                  onClick={() => {
                    inspectInstrument(res.ticker);
                    setSearchResults([]);
                    setSearchQuery(res.name);
                  }}
                  className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.04]"
                >
                  <div className="truncate mr-2">
                    <p className="font-medium text-[#f5f5f5] truncate">{res.name}</p>
                    <p className="text-[10px] text-[#6a6a6a]">{res.exchange || "Marché"}</p>
                  </div>
                  <Badge tone="gray">{res.ticker}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Fiche Instrument Inspecté */}
        {quoteError && <ErrorBanner message={quoteError} onClose={() => setQuoteError("")} />}

        {inspectedQuote && (
          <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0f0f0f] p-4 space-y-4">
            {/* Haut de la fiche : Nom, Ticker, Exchange & Cours */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-lg font-bold text-[#f5f5f5]">
                    {inspectedQuote.name || inspectedQuote.ticker}
                  </h4>
                  <Badge tone="gold">{inspectedQuote.ticker}</Badge>
                  {inspectedQuote.exchange && (
                    <Badge tone="gray">{inspectedQuote.exchange}</Badge>
                  )}
                  {inspectedQuote.instrumentType && (
                    <Badge tone="blue">{inspectedQuote.instrumentType}</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-[#6a6a6a]">
                  Dernière cotation relevée {formatDate(inspectedQuote.fetchedAt || new Date().toISOString())}
                  {inspectedQuote.currency !== "EUR" && inspectedQuote.nativePrice != null && (
                    <span>
                      {" "}· Cours d'origine : {inspectedQuote.nativePrice} {inspectedQuote.currency} (tx EUR: {inspectedQuote.fxRate})
                    </span>
                  )}
                </p>
              </div>

              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums text-[#d4b56e]">
                  {formatEur(inspectedQuote.price)}
                </p>
                {inspectedQuote.changePercent != null && (
                  <div
                    className={cn(
                      "flex items-center justify-end gap-1 text-xs font-semibold tabular-nums mt-0.5",
                      inspectedQuote.changePercent >= 0 ? "text-[#10b981]" : "text-[#ef4444]",
                    )}
                  >
                    {inspectedQuote.changePercent >= 0 ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                    <span>{formatPercent(inspectedQuote.changePercent, 2)}</span>
                    {inspectedQuote.change != null && (
                      <span className="text-[11px] text-[#8a8a8a]">
                        ({inspectedQuote.change >= 0 ? "+" : ""}{formatEur(inspectedQuote.change)})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Statistiques clés de l'actif */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[#141414] p-3">
                <span className="text-[11px] text-[#6a6a6a]">Clôture précédente</span>
                <p className="mt-0.5 font-semibold text-[#f5f5f5] tabular-nums">
                  {inspectedQuote.previousClose != null ? formatEur(inspectedQuote.previousClose) : "—"}
                </p>
              </div>

              <div className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[#141414] p-3">
                <span className="text-[11px] text-[#6a6a6a]">Jour (Bas / Haut)</span>
                <p className="mt-0.5 font-semibold text-[#f5f5f5] tabular-nums">
                  {inspectedQuote.dayLow != null && inspectedQuote.dayHigh != null
                    ? `${formatEur(inspectedQuote.dayLow)} — ${formatEur(inspectedQuote.dayHigh)}`
                    : "—"}
                </p>
              </div>

              <div className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[#141414] p-3">
                <span className="text-[11px] text-[#6a6a6a]">52 Semaines (Bas / Haut)</span>
                <p className="mt-0.5 font-semibold text-[#f5f5f5] tabular-nums">
                  {inspectedQuote.fiftyTwoWeekLow != null && inspectedQuote.fiftyTwoWeekHigh != null
                    ? `${formatEur(inspectedQuote.fiftyTwoWeekLow)} — ${formatEur(inspectedQuote.fiftyTwoWeekHigh)}`
                    : "—"}
                </p>
              </div>

              <div className="rounded-lg border border-[rgba(255,255,255,0.04)] bg-[#141414] p-3">
                <span className="text-[11px] text-[#6a6a6a]">Volume journalier</span>
                <p className="mt-0.5 font-semibold text-[#f5f5f5] tabular-nums">
                  {inspectedQuote.volume != null
                    ? inspectedQuote.volume.toLocaleString("fr-FR")
                    : "—"}
                </p>
              </div>
            </div>

            {/* Jauge visuelle 52 semaines */}
            {inspectedQuote.fiftyTwoWeekLow != null &&
              inspectedQuote.fiftyTwoWeekHigh != null &&
              inspectedQuote.fiftyTwoWeekHigh > inspectedQuote.fiftyTwoWeekLow && (
                <div className="pt-2">
                  <div className="flex items-center justify-between text-[11px] text-[#8a8a8a] mb-1">
                    <span>Plus bas 52s : {formatEur(inspectedQuote.fiftyTwoWeekLow)}</span>
                    <span className="text-[10px] uppercase font-semibold text-[#c8a55e]">
                      Fourchette annuelle 52 semaines
                    </span>
                    <span>Plus haut 52s : {formatEur(inspectedQuote.fiftyTwoWeekHigh)}</span>
                  </div>
                  <div className="relative h-2 w-full rounded-full bg-white/5 overflow-hidden">
                    {(() => {
                      const low = inspectedQuote.fiftyTwoWeekLow;
                      const high = inspectedQuote.fiftyTwoWeekHigh;
                      const current = inspectedQuote.price;
                      const percent = Math.min(Math.max(((current - low) / (high - low)) * 100, 2), 98);
                      return (
                        <div
                          className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-500 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      );
                    })()}
                  </div>
                </div>
              )}
          </div>
        )}
      </Card>

      {/* ─── Section 3 : Bandeau d'information Portefeuille ────────────────── */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 bg-gradient-to-r from-[#141414] to-[#1a1711] border-[rgba(200,165,94,0.15)]">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(200,165,94,0.12)] text-[#c8a55e]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#f5f5f5]">
              Gestion de vos positions & enveloppes
            </p>
            <p className="text-[11px] text-[#8a8a8a]">
              Vos titres individuels (PEA, CTO, PEE, Assurance-vie...) se consultent et s'administrent directement depuis l'onglet <strong>Comptes</strong> via le bouton <strong>Positions</strong>.
            </p>
          </div>
        </div>
        <Button onClick={refreshPortfolio} loading={refreshing} size="sm">
          <RefreshCw className="h-3.5 w-3.5" /> Synchroniser les cours
        </Button>
      </Card>
    </div>
  );
};

export default MarketTab;
