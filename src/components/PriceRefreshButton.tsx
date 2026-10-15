import React, { useState, useEffect } from "react";
import { RefreshCw, Clock } from "lucide-react";
import {
  forceManualUpdate,
  getReadableStats,
  subscribeToUpdates,
} from "../utils/priceUpdateManager";

interface PriceRefreshButtonProps {
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  showCountdown?: boolean;
  className?: string;
}

const PriceRefreshButton: React.FC<PriceRefreshButtonProps> = ({
  variant = "secondary",
  size = "md",
  showCountdown = true,
  className = "",
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stats, setStats] = useState(() => {
    try {
      return getReadableStats();
    } catch (error) {
      console.error("Erreur lors de l'initialisation des stats:", error);
      return {
        isUpdating: false,
        lastUpdate: 0,
        nextUpdate: Date.now() + 60 * 60 * 1000,
        timeUntilNext: 60 * 60 * 1000,
        minutesUntilNext: 60,
        lastUpdateFormatted: "Jamais",
        nextUpdateFormatted: new Date(
          Date.now() + 60 * 60 * 1000
        ).toLocaleTimeString(),
        status: "✅ Prêt",
        nextUpdateText: "Dans 60 min",
      };
    }
  });

  useEffect(() => {
    try {
      // S'abonner aux mises à jour du gestionnaire
      const unsubscribe = subscribeToUpdates((isUpdating, nextUpdate) => {
        console.log("🔄 Update callback reçu:", isUpdating, nextUpdate);
        setIsRefreshing(isUpdating);
        setStats(getReadableStats());
      });

      // Mettre à jour les stats toutes les 30 secondes
      const interval = setInterval(() => {
        try {
          setStats(getReadableStats());
        } catch (error) {
          console.error("Erreur lors de la mise à jour des stats:", error);
        }
      }, 30000);

      return () => {
        unsubscribe();
        clearInterval(interval);
      };
    } catch (error) {
      console.error("Erreur lors de l'initialisation du bouton:", error);
    }
  }, []);

  const handleRefresh = async () => {
    console.log("🔄 Démarrage de la mise à jour manuelle des prix...");
    console.log("📊 État actuel:", stats);
    setIsRefreshing(true);

    try {
      // Test des bases de données avant la mise à jour
      console.log("🧪 Test des bases de données...");
      const { getAllCryptos } = await import("../utils/cryptoDatabase");
      const { getAllStocks } = await import("../utils/stockDatabase");

      const cryptos = getAllCryptos();
      const stocks = getAllStocks();
      console.log("📊 Cryptos disponibles:", cryptos.length);
      console.log("📊 Stocks disponibles:", stocks.length);

      console.log("🔄 Appel de forceManualUpdate...");
      await forceManualUpdate();
      console.log("✅ Mise à jour manuelle des prix terminée avec succès");

      // Forcer une mise à jour des stats après la mise à jour
      setTimeout(() => {
        console.log("🔄 Mise à jour des stats après refresh...");
        setStats(getReadableStats());
        setIsRefreshing(false);
      }, 1000);
    } catch (error) {
      console.error("❌ Erreur lors de la mise à jour des prix:", error);
      setIsRefreshing(false); // Reset en cas d'erreur
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case "sm":
        return "px-2 py-1 text-sm";
      case "lg":
        return "px-4 py-3 text-lg";
      default:
        return "px-3 py-2";
    }
  };

  const getVariantClasses = () => {
    switch (variant) {
      case "primary":
        return "bg-[#c8a55e] hover:bg-[#d4b06a] text-white";
      default:
        return "bg-[#1a1a1a] hover:bg-[#1a1a1a] text-[#8a8a8a]";
    }
  };

  const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;

  return (
    <div className="flex items-center space-x-2">
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className={`
          ${getSizeClasses()}
          ${getVariantClasses()}
          ${className}
          rounded-lg font-medium transition-colors duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          flex items-center space-x-2
        `}
        title={`Rafraîchir les prix maintenant (dernière MAJ: ${stats.lastUpdateFormatted})`}
      >
        <RefreshCw
          size={iconSize}
          className={isRefreshing ? "animate-spin" : ""}
        />
        <span>{isRefreshing ? "Updating..." : "Refresh"}</span>
      </button>

      {showCountdown && (
        <div className="flex items-center space-x-1 text-sm text-[#555555]">
          <Clock size={14} />
          <span>{stats.nextUpdateText}</span>
        </div>
      )}
    </div>
  );
};

export default PriceRefreshButton;
