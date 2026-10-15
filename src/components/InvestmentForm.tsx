import React, { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { Investment } from "../types";
import {
  fetchCurrentPrice,
  searchSymbols,
  SymbolSuggestion,
} from "../utils/api";
import { getDatabaseStats } from "../utils/cryptoDatabase";
import {
  getStockDatabaseStats,
  refreshStockPrice,
} from "../utils/stockDatabase";
import { refreshCryptoPrice } from "../utils/cryptoDatabase";

interface InvestmentFormProps {
  investment?: Investment | null;
  onSubmit: (investment: Investment) => void;
  onCancel: () => void;
}

const InvestmentForm: React.FC<InvestmentFormProps> = ({
  investment,
  onSubmit,
  onCancel,
}) => {
  const [formData, setFormData] = useState({
    name: "",
    type: "stock" as Investment["type"],
    symbol: "",
    quantity: "",
    purchasePrice: "",
    currentPrice: "",
    purchaseDate: new Date().toISOString().split("T")[0],
    notes: "",
    accountType: "" as "PEA" | "CTO" | "",
  });
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedCoinGeckoId, setSelectedCoinGeckoId] = useState<
    string | undefined
  >();
  const [cryptoDbStats, setCryptoDbStats] = useState(getDatabaseStats());
  const [stockDbStats, setStockDbStats] = useState(getStockDatabaseStats());

  useEffect(() => {
    if (investment) {
      setFormData({
        name: investment.name,
        type: investment.type,
        symbol: investment.symbol,
        quantity: investment.quantity.toString(),
        purchasePrice: investment.purchasePrice.toString(),
        currentPrice: investment.currentPrice?.toString() || "",
        purchaseDate: investment.purchaseDate.split("T")[0],
        notes: investment.notes || "",
        accountType: investment.accountType || "",
      });
    }
  }, [investment]);

  // Mettre à jour les stats des bases de données périodiquement
  useEffect(() => {
    const interval = setInterval(() => {
      setCryptoDbStats(getDatabaseStats());
      setStockDbStats(getStockDatabaseStats());
    }, 30000); // Mettre à jour toutes les 30 secondes

    return () => clearInterval(interval);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Gérer le cas où currentPrice est vide ou invalide
    const currentPriceValue = formData.currentPrice
      ? parseFloat(formData.currentPrice)
      : null;
    const isValidCurrentPrice =
      currentPriceValue !== null && !isNaN(currentPriceValue);

    const newInvestment: Investment = {
      id: investment?.id || crypto.randomUUID(),
      name: formData.name,
      type: formData.type,
      symbol: formData.symbol.toUpperCase(),
      quantity: parseFloat(formData.quantity),
      purchasePrice: parseFloat(formData.purchasePrice),
      currentPrice: isValidCurrentPrice ? currentPriceValue : null,
      purchaseDate: new Date(formData.purchaseDate).toISOString(),
      notes: formData.notes,
      accountType: formData.type === "stock" ? formData.accountType : undefined,
    };

    onSubmit(newInvestment);
  };

  const fetchSuggestions = async (query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoadingSuggestions(true);

    try {
      // Utiliser la recherche locale (rapide, pas d'API calls)
      const results = await searchSymbols(query);
      // Filtrer par type si nécessaire
      const filteredResults =
        formData.type === "stock" || formData.type === "crypto"
          ? results.filter((item) => item.type === formData.type)
          : results;

      setSuggestions(filteredResults);
      setShowSuggestions(filteredResults.length > 0);
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const selectSuggestion = (suggestion: SymbolSuggestion) => {
    setFormData((prev) => ({
      ...prev,
      symbol: suggestion.symbol,
      name: suggestion.name,
      currentPrice: suggestion.price.toString(),
    }));
    setSelectedCoinGeckoId(suggestion.coinGeckoId);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const fetchPriceForSymbol = async (
    symbol: string,
    type: Investment["type"],
    coinGeckoId?: string
  ) => {
    if (!symbol || (type !== "stock" && type !== "crypto")) return;

    setIsLoadingPrice(true);
    setPriceError("");

    try {
      const price = await fetchCurrentPrice(
        symbol.toUpperCase(),
        type,
        coinGeckoId
      );
      if (price !== null) {
        setFormData((prev) => ({
          ...prev,
          currentPrice: price.toString(),
          name: prev.name || symbol.toUpperCase(),
        }));
      } else {
        setPriceError("Prix non disponible pour ce symbole");
      }
    } catch (error) {
      setPriceError("Impossible de récupérer le prix actuel");
      console.error("Error fetching price:", error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  const handleChange = async (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value } = e.target;

    setFormData({
      ...formData,
      [name]: value,
    });

    // Rechercher des suggestions pour le symbole
    if (name === "symbol") {
      // Réinitialiser l'ID CoinGecko si on change le symbole manuellement
      setSelectedCoinGeckoId(undefined);
      await fetchSuggestions(value);
      // Ne PAS récupérer le prix automatiquement pendant la saisie
      // Le prix sera récupéré seulement à la validation ou sélection
    } else if (name === "type") {
      // Changer le type, réinitialiser les suggestions si nécessaire
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedCoinGeckoId(undefined);
      if (formData.symbol) {
        await fetchSuggestions(formData.symbol);
        // Ne récupérer le prix que si on a déjà un symbole validé
        if (formData.symbol.length >= 3) {
          const investmentType = value as Investment["type"];
          if (investmentType === "stock" || investmentType === "crypto") {
            await fetchPriceForSymbol(
              formData.symbol,
              investmentType,
              selectedCoinGeckoId
            );
          }
        }
      }
    }
  };

  const handleRefreshPrice = async () => {
    if (!formData.symbol) return;

    setIsLoadingPrice(true);
    try {
      let newPrice: number | null = null;

      if (formData.type === "crypto") {
        newPrice = await refreshCryptoPrice(formData.symbol);
      } else {
        newPrice = await refreshStockPrice(formData.symbol);
      }

      if (newPrice !== null) {
        setFormData((prev) => ({
          ...prev,
          currentPrice: newPrice.toString(),
        }));
      }
    } catch (error) {
      console.error("Erreur lors du rafraîchissement du prix:", error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        className="bg-[#111111] rounded-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
        onClick={() => setShowSuggestions(false)}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-[#f5f5f5]">
            {investment ? "Edit Investment" : "Add Investment"}
          </h2>
          <button
            onClick={onCancel}
            className="text-[#555555] hover:text-[#8a8a8a] hover:text-[#f5f5f5]"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#f5f5f5] mb-1">
              Nom de l'Investissement
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="input-field"
              placeholder="ex: Apple Inc."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#f5f5f5] mb-1">
              Type
            </label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              className="input-field"
              required
            >
              <option value="stock">Action</option>
              <option value="crypto">Cryptomonnaie</option>
              <option value="etf">ETF</option>
              <option value="bond">Obligation</option>
              <option value="other">Autre</option>
            </select>
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-[#f5f5f5] mb-1">
              Symbole
            </label>
            <div className="relative">
              <input
                type="text"
                name="symbol"
                value={formData.symbol}
                onChange={handleChange}
                onFocus={() =>
                  formData.symbol && setShowSuggestions(suggestions.length > 0)
                }
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="input-field"
                placeholder="ex: AAPL, BTC"
                required
              />
              {loadingSuggestions && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <Loader2 size={16} className="animate-spin text-[#555555]" />
                </div>
              )}
            </div>

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-[#111111] rounded-md  max-h-60 overflow-y-auto">
                {suggestions.map((suggestion, index) => (
                  <div
                    key={`${suggestion.symbol}-${index}`}
                    onClick={() => selectSuggestion(suggestion)}
                    className="px-4 py-3 hover:bg-[#0a0a0a] cursor-pointer border-b border-[rgba(255,255,255,0.06)] last:border-b-0"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-[#f5f5f5]">
                            {suggestion.symbol}
                          </span>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              suggestion.type === "stock"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-orange-100 text-orange-800"
                            }`}
                          >
                            {suggestion.type === "stock" ? "Action" : "Crypto"}
                          </span>
                        </div>
                        <p className="text-sm text-[#8a8a8a] truncate">
                          {suggestion.name}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-medium text-[#f5f5f5]">
                          ${suggestion.price.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(formData.type === "stock" || formData.type === "crypto") && (
              <div className="mt-1">
                <p className="text-xs text-[#555555]">
                  Tapez pour voir les suggestions et sélectionner
                </p>
                {formData.type === "crypto" && (
                  <p className="text-xs text-green-600 mt-1">
                    📊 Base crypto: {cryptoDbStats.totalCryptos} monnaies
                    disponibles
                    {cryptoDbStats.isUpdated
                      ? " ✅"
                      : " ⏳ Mise à jour en cours..."}
                  </p>
                )}
                {formData.type === "stock" && (
                  <p className="text-xs text-blue-600 mt-1">
                    📈 Base actions: {stockDbStats.totalStocks} actions
                    disponibles
                    {true ? " ✅" : " ⏳ Mise à jour en cours..."}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Account type for stock */}
          {formData.type === "stock" && (
            <div>
              <label className="block text-sm font-medium text-[#8a8a8a] mb-1">
                Compte associé (optionnel)
              </label>
              <div className="flex space-x-4">
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    name="accountType"
                    value="PEA"
                    checked={formData.accountType === "PEA"}
                    onChange={handleChange}
                    className="form-radio text-blue-600"
                  />
                  <span className="ml-2">PEA</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    name="accountType"
                    value="CTO"
                    checked={formData.accountType === "CTO"}
                    onChange={handleChange}
                    className="form-radio text-blue-600"
                  />
                  <span className="ml-2">CTO</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    name="accountType"
                    value=""
                    checked={formData.accountType === ""}
                    onChange={handleChange}
                    className="form-radio text-blue-600"
                  />
                  <span className="ml-2">Aucun</span>
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#f5f5f5] mb-1">
                Quantité
              </label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                className="input-field"
                placeholder="0"
                step="0.001"
                min="0"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#f5f5f5] mb-1">
                Prix d'Achat
              </label>
              <input
                type="number"
                name="purchasePrice"
                value={formData.purchasePrice}
                onChange={handleChange}
                className="input-field"
                placeholder="0.00"
                step="0.01"
                min="0"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#f5f5f5] mb-2">
              Prix actuel
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                step="0.01"
                value={formData.currentPrice || ""}
                readOnly
                className="flex-1 px-3 py-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-[#0a0a0a] dark:bg-[#2f2f2f] text-[#f5f5f5]"
                placeholder="Prix automatique"
              />
              <button
                type="button"
                onClick={handleRefreshPrice}
                disabled={!formData.symbol || isLoadingPrice}
                className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[44px]"
                title="Rafraîchir le prix en temps réel"
              >
                {isLoadingPrice ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <span className="text-lg">🔄</span>
                )}
              </button>
            </div>
            {formData.currentPrice && (
              <p className="text-xs text-[#555555] mt-1">
                💡 Prix temps réel - Cliquez sur 🔄 pour actualiser
              </p>
            )}
            {priceError && (
              <p className="text-xs text-red-600 mt-1">⚠️ {priceError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#8a8a8a] mb-1">
              Date d'Achat
            </label>
            <input
              type="date"
              name="purchaseDate"
              value={formData.purchaseDate}
              onChange={handleChange}
              className="input-field"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#8a8a8a] mb-1">
              Notes (Optionnel)
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              className="input-field"
              rows={3}
              placeholder="Notes supplémentaires..."
            />
          </div>

          <div className="flex space-x-3 pt-4">
            <button type="submit" className="btn-primary flex-1">
              {investment
                ? "Modifier l'Investissement"
                : "Ajouter l'Investissement"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary flex-1"
            >
              Annuler
            </button>
          </div>
        </form>

        {/* Statistiques des bases de données */}
        {/*
        <div className="mt-6 p-4 bg-[#0a0a0a] rounded-lg">
          <h4 className="text-sm font-semibold text-[#8a8a8a] mb-2">
            📊 Bases de données
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[#8a8a8a]">
            <div>
              <p className="font-medium">🪙 Cryptomonnaies:</p>
              <p>{cryptoDbStats.totalCryptos} disponibles</p>
              <p>Mise à jour: {cryptoDbStats.lastUpdate}</p>
            </div>
            <div>
              <p className="font-medium">📈 Actions:</p>
              <p>{stockDbStats.totalStocks} disponibles</p>
              <p>En cache: {stockDbStats.cachedPrices} prix</p>
              <p className="text-orange-600 font-medium">⚠️ Alpha Vanta</p>
            </div>
          </div>
        </div>
        */}
      </div>
    </div>
  );
};

export default InvestmentForm;
