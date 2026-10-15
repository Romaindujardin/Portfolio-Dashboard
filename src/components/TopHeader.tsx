import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Eye, EyeOff, Plus, RefreshCw, Bell, Sun, Moon } from "lucide-react";
import { forceManualUpdate } from "../utils/priceUpdateManager";
import { toggleThemeWithTransition } from "../utils/themeToggle";

interface TopHeaderProps {
  onSearch?: (query: string) => void;
}

const TopHeader: React.FC<TopHeaderProps> = ({ onSearch }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return document.documentElement.classList.contains("dark");
  });
  const [isAnonymous, setIsAnonymous] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dashboardAnonymous") === "1";
  });

  const toggleAnonymous = () => {
    const next = !isAnonymous;
    setIsAnonymous(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboardAnonymous", next ? "1" : "0");
      window.dispatchEvent(
        new CustomEvent("dashboardAnonymousChanged", {
          detail: { value: next },
        })
      );
    }
  };

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
      handleCustom as EventListener
    );
    const handleThemeChange = (event: Event) => {
      const custom = event as CustomEvent;
      if (typeof custom.detail?.isDark === "boolean") {
        setIsDark(custom.detail.isDark);
      } else {
        setIsDark(document.documentElement.classList.contains("dark"));
      }
    };
    window.addEventListener("themeChanged", handleThemeChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "dashboardAnonymousChanged",
        handleCustom as EventListener
      );
      window.removeEventListener("themeChanged", handleThemeChange);
    };
  }, []);

  const handleRefreshPrices = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await forceManualUpdate();
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 1200);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-[rgba(255,255,255,0.06)]">
      {/* Search Bar */}
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 w-4 h-4 text-[#555555]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            onSearch?.(e.target.value);
          }}
          placeholder="Recherche..."
          className="w-48 sm:w-72 pl-10 pr-4 py-2 bg-[#141414] hover:bg-[#181818] text-[#f5f5f5] text-xs sm:text-sm placeholder-[#555555] rounded-full border border-[rgba(255,255,255,0.06)] focus:border-[#c8a55e]/50 focus:outline-none transition-all duration-200"
        />
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Dark / Light Mode Progressive Toggle */}
        <button
          type="button"
          onClick={(e) => toggleThemeWithTransition(e, (dark) => setIsDark(dark))}
          title={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
          className="p-2 rounded-full text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200 group"
          aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
        >
          {isDark ? (
            <Sun className="w-4 h-4 text-[#c8a55e] transition-transform duration-300 group-hover:rotate-45" />
          ) : (
            <Moon className="w-4 h-4 text-[#3b82f6] transition-transform duration-300 group-hover:-rotate-12" />
          )}
        </button>

        {/* Toggle Anonymous Eye */}
        <button
          type="button"
          onClick={toggleAnonymous}
          title={isAnonymous ? "Afficher les chiffres" : "Masquer les chiffres"}
          className="p-2 rounded-full text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200"
        >
          {isAnonymous ? (
            <EyeOff className="w-4 h-4 text-[#c8a55e]" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>

        {/* Refresh Prices */}
        <button
          type="button"
          onClick={handleRefreshPrices}
          title="Actualiser les prix"
          className="p-2 rounded-full text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200"
        >
          <RefreshCw
            className={`w-4 h-4 ${isRefreshing ? "animate-spin text-[#c8a55e]" : ""}`}
          />
        </button>

        {/* Add Asset Pill Button */}
        <button
          type="button"
          onClick={() => navigate("/investments")}
          className="flex items-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold tracking-tight transition-all duration-200 shadow-sm"
          style={{
            background: "linear-gradient(135deg, #c8a55e 0%, #b8944e 100%)",
            color: "#0a0a0a",
          }}
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span className="hidden sm:inline">Ajouter des actifs</span>
          <span className="sm:hidden">Ajouter</span>
        </button>
      </div>
    </header>
  );
};

export default TopHeader;
