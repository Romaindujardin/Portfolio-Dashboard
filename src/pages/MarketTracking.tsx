import React, { useState, useEffect } from "react";
import {
  Plus,
  Search,
  TrendingUp,
  TrendingDown,
  Star,
  StarOff,
  RefreshCw,
  BarChart3,
  Eye,
} from "lucide-react";
import { MarketData, WatchlistItem, Investment } from "../types";
import {
  getStoredWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getStoredInvestments,
} from "../utils/storage";
import { fetchMarketData } from "../utils/api";
import PriceRefreshButton from "../components/PriceRefreshButton";
import PriceChart from "../components/PriceChart";
import { useUser } from "../contexts/UserContext";

const MarketTracking = () => {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [portfolioInvestments, setPortfolioInvestments] = useState<
    Investment[]
  >([]);
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"portfolio" | "watchlist">(
    "portfolio"
  );
  const { currentUser } = useUser();

  const loadData = async () => {
    try {
      const stored = await getStoredInvestments(currentUser);
      setPortfolioInvestments(stored);

      const watchlistData = await getStoredWatchlist(currentUser);
      setWatchlist(watchlistData);
    } catch (error) {
      console.error("❌ Erreur lors du chargement des données:", error);
      setPortfolioInvestments([]);
      setWatchlist([]);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser]);

  useEffect(() => {
    const allSymbols = [
      ...portfolioInvestments.map((inv) => inv.symbol),
      ...watchlist.map((item) => item.symbol),
    ];
    const uniqueSymbols = [...new Set(allSymbols)];

    if (uniqueSymbols.length > 0) {
      loadMarketData(uniqueSymbols);
    }
  }, [watchlist, portfolioInvestments]);

  const loadWatchlist = async () => {
    try {
      const stored = await getStoredWatchlist(currentUser);
      setWatchlist(stored);
    } catch (error) {
      console.error("❌ Erreur lors du chargement de la watchlist:", error);
      setWatchlist([]);
    }
  };

  const loadPortfolioInvestments = async () => {
    try {
      const stored = await getStoredInvestments(currentUser);
      setPortfolioInvestments(stored);
    } catch (error) {
      console.error("❌ Erreur lors du chargement des investissements:", error);
      setPortfolioInvestments([]);
    }
  };

  const loadMarketData = async (symbols: string[]) => {
    setLoading(true);
    try {
      const data = await fetchMarketData(symbols);
      setMarketData(data);
    } catch (error) {
      console.error("Error fetching market data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToWatchlist = async () => {
    if (newSymbol.trim()) {
      const item: WatchlistItem = {
        symbol: newSymbol.toUpperCase().trim(),
        name: newSymbol.toUpperCase().trim(),
        type: "stock",
        addedAt: new Date().toISOString(),
      };
      await addToWatchlist(item, currentUser);
      setNewSymbol("");
      await loadWatchlist();
    }
  };

  const handleRemoveFromWatchlist = async (symbol: string) => {
    await removeFromWatchlist(symbol, currentUser);
    await loadWatchlist();
  };

  const handleCleanupWatchlist = () => {
    if (
      window.confirm("Supprimer tous les symboles invalides de la watchlist ?")
    ) {
      // Nettoyer seulement la watchlist, pas les investissements du portfolio
      const validWatchlist = watchlist.filter((item) => {
        // Ici on pourrait ajouter une validation plus spécifique si nécessaire
        return item.symbol && item.symbol.trim().length > 0;
      });

      // Sauvegarder la watchlist nettoyée
      localStorage.setItem("watchlist", JSON.stringify(validWatchlist));

      loadWatchlist();
    }
  };

  const getMarketDataForSymbol = (symbol: string) => {
    return marketData.find((data) => data.symbol === symbol);
  };

  // Unifier les investissements par symbole pour le portfolio
  const uniquePortfolioInvestments = Array.from(
    new Map(portfolioInvestments.map((inv) => [inv.symbol, inv])).values()
  );

  const filteredPortfolio = uniquePortfolioInvestments.filter(
    (inv) =>
      inv.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredWatchlist = watchlist.filter(
    (item) =>
      item.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const popularSymbols = [
    { symbol: "AAPL", name: "Apple Inc.", type: "stock" as const },
    { symbol: "GOOGL", name: "Alphabet Inc.", type: "stock" as const },
    { symbol: "MSFT", name: "Microsoft Corp.", type: "stock" as const },
    { symbol: "TSLA", name: "Tesla Inc.", type: "stock" as const },
    { symbol: "BTC", name: "Bitcoin", type: "crypto" as const },
    { symbol: "ETH", name: "Ethereum", type: "crypto" as const },
  ];

  const renderAssetCard = (
    symbol: string,
    name: string,
    isFromPortfolio = false,
    investment?: Investment
  ) => {
    const data = getMarketDataForSymbol(symbol);
    const isInWatchlist = watchlist.some((w) => w.symbol === symbol);

    return (
      <div key={symbol} className="card hover:shadow-lg transition-shadow">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <h3 className="text-lg font-semibold text-white">{symbol}</h3>
              {isFromPortfolio && (
                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-primary-100 text-primary-800">
                  Portfolio
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">{name}</p>
            {investment && (
              <p className="text-xs text-gray-400 mt-1">
                Quantité: {investment.quantity} • Achat: $
                {investment.purchasePrice}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() =>
                setSelectedSymbol(selectedSymbol === symbol ? null : symbol)
              }
              className={`p-2 rounded-lg transition-colors ${
                selectedSymbol === symbol
                  ? "bg-primary-100 text-primary-600"
                  : "text-gray-400 hover:text-primary-600 hover:bg-gray-100"
              }`}
              title="Voir le graphique"
            >
              <BarChart3 size={16} />
            </button>
            {!isFromPortfolio && (
              <button
                onClick={() => {
                  if (isInWatchlist) {
                    handleRemoveFromWatchlist(symbol);
                  } else {
                    const watchlistItem: WatchlistItem = {
                      symbol,
                      name,
                      type: "stock",
                      addedAt: new Date().toISOString(),
                    };
                    addToWatchlist(watchlistItem, currentUser);
                    loadWatchlist();
                  }
                }}
                className={`p-2 rounded-lg transition-colors ${
                  isInWatchlist
                    ? "text-yellow-500 hover:text-yellow-600"
                    : "text-gray-400 hover:text-yellow-500"
                }`}
                title={
                  isInWatchlist
                    ? "Retirer de la watchlist"
                    : "Ajouter à la watchlist"
                }
              >
                {isInWatchlist ? <Star size={16} /> : <StarOff size={16} />}
              </button>
            )}
          </div>
        </div>

        {data ? (
          <div className="space-y-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-white">
                ${data.price.toLocaleString()}
              </p>
              <div
                className={`flex items-center justify-center space-x-1 text-sm ${
                  data.change >= 0 ? "text-success-600" : "text-danger-600"
                }`}
              >
                {data.change >= 0 ? (
                  <TrendingUp size={16} />
                ) : (
                  <TrendingDown size={16} />
                )}
                <span>
                  ${Math.abs(data.change).toLocaleString()} (
                  {Math.abs(data.changePercent).toFixed(2)}%)
                </span>
              </div>
            </div>

            {investment && (
              <div className="grid grid-cols-2 gap-3 text-sm text-center">
                <div>
                  <p className="text-gray-500">Valeur actuelle</p>
                  <p className="font-medium text-white">
                    ${(investment.quantity * data.price).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Gain/Perte</p>
                  <p
                    className={`font-medium ${
                      investment.quantity * data.price -
                        investment.quantity * investment.purchasePrice >=
                      0
                        ? "text-success-600"
                        : "text-danger-600"
                    }`}
                  >
                    $
                    {(
                      investment.quantity * data.price -
                      investment.quantity * investment.purchasePrice
                    ).toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm text-center">
              <div>
                <p className="text-gray-500">Volume</p>
                <p className="font-medium text-white">
                  {data.volume.toLocaleString()}
                </p>
              </div>
              {data.marketCap && (
                <div>
                  <p className="text-gray-500">Market Cap</p>
                  <p className="font-medium text-white">
                    ${(data.marketCap / 1e9).toFixed(1)}B
                  </p>
                </div>
              )}
            </div>

            {(data.high24h || data.low24h) && (
              <div className="grid grid-cols-2 gap-4 text-sm text-center">
                {data.high24h && (
                  <div>
                    <p className="text-gray-500">24h High</p>
                    <p className="font-medium text-white">
                      ${data.high24h.toLocaleString()}
                    </p>
                  </div>
                )}
                {data.low24h && (
                  <div>
                    <p className="text-gray-500">24h Low</p>
                    <p className="font-medium text-white">
                      ${data.low24h.toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Graphique de prix */}
            {selectedSymbol === symbol && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <PriceChart
                  symbol={symbol}
                  name={name}
                  currentPrice={data.price}
                  high24h={data.high24h}
                  low24h={data.low24h}
                  height={250}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>Données de prix non disponibles</p>
            <p className="text-sm">Le symbole pourrait être invalide</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Suivi de Marché</h1>
          <div className="text-sm text-gray-500 mt-1">
            Portfolio: {portfolioInvestments.length} actifs • Watchlist:{" "}
            {watchlist.length} symboles
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleCleanupWatchlist}
            className="btn-secondary flex items-center space-x-2"
            title="Nettoyer les symboles invalides"
          >
            <RefreshCw size={16} />
            <span>Nettoyer</span>
          </button>
          <PriceRefreshButton
            variant="primary"
            size="md"
            showCountdown={true}
          />
        </div>
      </div>

      {/* Onglets */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("portfolio")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "portfolio"
                ? "border-primary-500 text-primary-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center space-x-2">
              <Eye size={16} />
              <span>Mon Portfolio ({portfolioInvestments.length})</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab("watchlist")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "watchlist"
                ? "border-primary-500 text-primary-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center space-x-2">
              <Star size={16} />
              <span>Watchlist ({watchlist.length})</span>
            </div>
          </button>
        </nav>
      </div>

      {/* Ajouter à la watchlist - seulement visible dans l'onglet watchlist */}
      {activeTab === "watchlist" && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Ajouter à la Watchlist</h3>
          <div className="flex space-x-4">
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="Symbole (ex: AAPL, BTC)"
              className="input-field flex-1"
              onKeyPress={(e) => e.key === "Enter" && handleAddToWatchlist()}
            />
            <button
              onClick={handleAddToWatchlist}
              className="btn-primary flex items-center space-x-2"
            >
              <Plus size={20} />
              <span>Ajouter</span>
            </button>
          </div>

          {/* Symboles populaires */}
          <div className="mt-4">
            <p className="text-sm text-gray-600 mb-2">Symboles populaires:</p>
            <div className="flex flex-wrap gap-2">
              {popularSymbols.map((item) => {
                const isInWatchlist = watchlist.some(
                  (w) => w.symbol === item.symbol
                );
                const isInPortfolio = portfolioInvestments.some(
                  (inv) => inv.symbol === item.symbol
                );
                return (
                  <button
                    key={item.symbol}
                    onClick={() => {
                      if (isInWatchlist) {
                        handleRemoveFromWatchlist(item.symbol);
                      } else {
                        const watchlistItem: WatchlistItem = {
                          ...item,
                          addedAt: new Date().toISOString(),
                        };
                        addToWatchlist(watchlistItem, currentUser);
                        loadWatchlist();
                      }
                    }}
                    disabled={isInPortfolio}
                    className={`px-3 py-1 text-sm rounded-full transition-colors ${
                      isInPortfolio
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : isInWatchlist
                        ? "bg-primary-100 text-primary-700 hover:bg-primary-200"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {item.symbol} {isInPortfolio && "(Portfolio)"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Recherche */}
      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={20}
        />
        <input
          type="text"
          placeholder={`Rechercher dans ${
            activeTab === "portfolio" ? "votre portfolio" : "votre watchlist"
          }...`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 input-field"
        />
      </div>

      {/* Contenu selon l'onglet actif */}
      {loading ? (
        <div className="card text-center py-12">
          <div className="text-gray-500">
            Chargement des données de marché...
          </div>
        </div>
      ) : (
        <div>
          {activeTab === "portfolio" ? (
            filteredPortfolio.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredPortfolio.map((investment) =>
                  renderAssetCard(
                    investment.symbol,
                    investment.name,
                    true,
                    investment
                  )
                )}
              </div>
            ) : (
              <div className="card text-center py-12">
                <div className="text-gray-500 mb-4">
                  {searchTerm
                    ? "Aucun investissement trouvé dans votre recherche."
                    : "Aucun investissement dans votre portfolio."}
                </div>
                {!searchTerm && (
                  <div className="text-gray-400">
                    Ajoutez des investissements pour les voir ici
                    automatiquement
                  </div>
                )}
              </div>
            )
          ) : filteredWatchlist.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredWatchlist.map((item) =>
                renderAssetCard(item.symbol, item.name, false)
              )}
            </div>
          ) : (
            <div className="card text-center py-12">
              <div className="text-gray-500 mb-4">
                {searchTerm
                  ? "Aucun symbole trouvé dans votre recherche."
                  : "Aucun symbole dans votre watchlist."}
              </div>
              {!searchTerm && (
                <div className="text-gray-400">
                  Ajoutez des symboles à votre watchlist pour suivre leurs prix
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MarketTracking;
