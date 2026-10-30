import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Plus, Sun, Moon, Euro, DollarSign, Lock } from "lucide-react";
import { toggleThemeWithTransition } from "../utils/themeToggle";
import { useCurrency } from "../contexts/CurrencyContext";
import { useUser } from "../contexts/UserContext";

const TopHeader: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, lockUser } = useUser();
  const { isMasked, toggleMasked, currency, toggleCurrency, rateEurToUsd } = useCurrency();
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
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
      window.removeEventListener("themeChanged", handleThemeChange);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-end px-6 py-4 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-[rgba(255,255,255,0.06)]">

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
          onClick={toggleMasked}
          title={isMasked ? "Afficher les chiffres" : "Masquer les chiffres"}
          className="p-2 rounded-full text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200"
          aria-label={isMasked ? "Afficher les chiffres" : "Masquer les chiffres"}
        >
          {isMasked ? (
            <EyeOff className="w-4 h-4 text-[#c8a55e]" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>

        {/* Currency Switcher (EUR / USD) */}
        <button
          type="button"
          onClick={toggleCurrency}
          title={
            currency === "EUR"
              ? `Devise actuelle : EUR (€). Cliquer pour convertir en USD ($) (taux : 1 € = ${rateEurToUsd.toFixed(4)} $)`
              : `Devise actuelle : USD ($). Cliquer pour convertir en EUR (€) (taux : 1 € = ${rateEurToUsd.toFixed(4)} $)`
          }
          className="p-2 rounded-full text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200 group flex items-center justify-center"
          aria-label="Basculer entre Euro et Dollar"
        >
          {currency === "EUR" ? (
            <Euro className="w-4 h-4 text-[#c8a55e] transition-transform duration-200 group-hover:scale-110" />
          ) : (
            <DollarSign className="w-4 h-4 text-[#c8a55e] transition-transform duration-200 group-hover:scale-110" />
          )}
        </button>

        {/* Verrouiller la session */}
        <button
          type="button"
          onClick={() => lockUser(currentUser)}
          title={`Verrouiller la session (${currentUser})`}
          className="p-2 rounded-full text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200 group flex items-center justify-center"
          aria-label={`Verrouiller la session de ${currentUser}`}
        >
          <Lock className="w-4 h-4 text-[#8a8a8a] group-hover:text-[#c8a55e] transition-colors duration-200" />
        </button>

        {/* Add Asset Pill Button */}
        <button
          type="button"
          onClick={() => navigate("/patrimoine?tab=crypto")}
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

