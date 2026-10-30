import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  LayoutDashboard,
  Wallet2,
  Landmark,
  Coins,
  Building2,
  CreditCard,
  TrendingUp,
  PieChart,
  PiggyBank,
  Sparkles,
  Settings,
  ShieldCheck,
  Activity,
  Layers,
  Receipt,
  Globe,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { useCurrency } from "../contexts/CurrencyContext";
import {
  getAccounts,
  getAllHoldings,
  getProperties,
  getLoans,
  searchSymbols,
} from "../services/portfolioApi";
import { getStoredWallets } from "../utils/storage";
import { getSavingsStrategy } from "../utils/savingsStorage";
import type { PortfolioAccount, PortfolioAccountType, Holding, Property, Loan } from "../types/portfolio";
import type { Wallet } from "../types";

export type SearchResultCategory =
  | "page"
  | "account"
  | "holding"
  | "crypto"
  | "property"
  | "loan"
  | "pocket"
  | "market";

export interface SearchItem {
  id: string;
  category: SearchResultCategory;
  categoryLabel: string;
  title: string;
  subtitle: string;
  keywords: string[];
  amount?: number | null;
  isNegative?: boolean;
  action: () => void;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}

const normalize = (str: string): string =>
  str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const getAccountTypeLabel = (type: PortfolioAccountType): string => {
  switch (type) {
    case "CHECKING":
      return "Compte Courant";
    case "SAVINGS":
      return "Livret d'Épargne";
    case "PEA":
      return "PEA";
    case "SECURITIES":
      return "Compte-Titres (CTO)";
    case "CRYPTO":
      return "Compte Crypto";
    case "REAL_ESTATE":
      return "Immobilier";
    case "LOAN":
      return "Prêt / Emprunt";
    case "EMPLOYEE_SAVINGS":
      return "Épargne Salariale";
    default:
      return "Compte Bancaire";
  }
};

interface GlobalSearchProps {
  onSearchChange?: (query: string) => void;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ onSearchChange }) => {
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const { formatMoney } = useCurrency();

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Données de l'utilisateur
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);

  // Résultats de recherche de marché en direct (Yahoo Finance API)
  const [marketResults, setMarketResults] = useState<
    Array<{ ticker: string; name: string; exchange: string | null }>
  >([]);
  const [isSearchingMarket, setIsSearchingMarket] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Charger toutes les données du portefeuille de l'utilisateur
  const loadPortfolioData = useCallback(async () => {
    try {
      const [accRes, holdRes, walRes, propRes, loanRes] = await Promise.allSettled([
        getAccounts(currentUser),
        getAllHoldings(currentUser),
        getStoredWallets(currentUser),
        getProperties(currentUser),
        getLoans(currentUser),
      ]);

      if (accRes.status === "fulfilled") setAccounts(accRes.value || []);
      if (holdRes.status === "fulfilled") setHoldings(holdRes.value || []);
      if (walRes.status === "fulfilled") setWallets(walRes.value || []);
      if (propRes.status === "fulfilled") setProperties(propRes.value || []);
      if (loanRes.status === "fulfilled") setLoans(loanRes.value || []);
    } catch {
      // Tolérance silencieuse
    }
  }, [currentUser]);

  useEffect(() => {
    void loadPortfolioData();
  }, [loadPortfolioData]);

  // Écouter les mises à jour des données (wallets, poches, transactions)
  useEffect(() => {
    const handleUpdate = () => {
      void loadPortfolioData();
    };
    window.addEventListener("walletsUpdated", handleUpdate);
    window.addEventListener("savings_strategy_updated", handleUpdate);
    window.addEventListener("portfolio_accounts_updated", handleUpdate);
    return () => {
      window.removeEventListener("walletsUpdated", handleUpdate);
      window.removeEventListener("savings_strategy_updated", handleUpdate);
      window.removeEventListener("portfolio_accounts_updated", handleUpdate);
    };
  }, [loadPortfolioData]);

  // 2. Raccourci global clavier ⌘K ou Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // 3. Fermeture au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 4. Recherche de marché asynchrone débouncée
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setMarketResults([]);
      setIsSearchingMarket(false);
      return;
    }

    setIsSearchingMarket(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchSymbols(trimmed);
        setMarketResults(results || []);
      } catch {
        setMarketResults([]);
      } finally {
        setIsSearchingMarket(false);
      }
    }, 280);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  // 5. Indexation des éléments statiques et locaux
  const staticNavigationItems = useMemo<SearchItem[]>(() => {
    return [
      {
        id: "nav-dashboard",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Synthèse & Tableau de bord",
        subtitle: "Vue d'ensemble de votre patrimoine et performances globales",
        keywords: ["synthese", "tableau", "bord", "dashboard", "overview", "resume", "accueil"],
        action: () => navigate("/"),
        badge: "Page",
        icon: LayoutDashboard,
        iconBg: "bg-blue-500/10",
        iconColor: "text-blue-400",
      },
      {
        id: "nav-patrimoine-accounts",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Comptes Bancaires & Épargne",
        subtitle: "Comptes courants, livrets, PEA, CTO et transactions historiques",
        keywords: ["patrimoine", "comptes", "banque", "livret", "pea", "cto", "bourso", "transactions", "solde"],
        action: () => navigate("/patrimoine?tab=accounts"),
        badge: "Patrimoine",
        icon: Wallet2,
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-400",
      },
      {
        id: "nav-patrimoine-crypto",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Cryptomonnaies & Portefeuilles",
        subtitle: "Wallets blockchain, Bitcoin, Ethereum, Solana, tokens et DeFi",
        keywords: ["crypto", "cryptomonnaies", "wallets", "bitcoin", "ethereum", "solana", "tokens", "defi", "metamask", "phantom"],
        action: () => navigate("/patrimoine?tab=crypto"),
        badge: "Patrimoine",
        icon: Coins,
        iconBg: "bg-purple-500/10",
        iconColor: "text-purple-400",
      },
      {
        id: "nav-patrimoine-realestate",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Patrimoine Immobilier",
        subtitle: "Biens immobiliers, valorisation DVF, surfaces et loyers perçus",
        keywords: ["immobilier", "biens", "maison", "appartement", "dvf", "loyer", "foncier", "estimation"],
        action: () => navigate("/patrimoine?tab=realestate"),
        badge: "Patrimoine",
        icon: Building2,
        iconBg: "bg-orange-500/10",
        iconColor: "text-orange-400",
      },
      {
        id: "nav-patrimoine-loans",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Prêts & Emprunts",
        subtitle: "Tableaux d'amortissement, mensualités et capital restant dû",
        keywords: ["prets", "emprunts", "credits", "dettes", "taux", "mensualites", "banque", "capital"],
        action: () => navigate("/patrimoine?tab=loans"),
        badge: "Patrimoine",
        icon: CreditCard,
        iconBg: "bg-rose-500/10",
        iconColor: "text-rose-400",
      },
      {
        id: "nav-patrimoine-connections",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Connexions Bancaires & Sidecar",
        subtitle: "Accès Sidecar BoursoBank, synchronisations et liaisons bancaires",
        keywords: ["connexions", "banques", "sidecar", "boursobank", "sync", "open banking", "liaison"],
        action: () => navigate("/patrimoine?tab=connections"),
        badge: "Patrimoine",
        icon: ShieldCheck,
        iconBg: "bg-teal-500/10",
        iconColor: "text-teal-400",
      },
      {
        id: "nav-market-search",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Marché - Recherche & Cotations Mondiales",
        subtitle: "Recherche en direct d'actions, ETF, indices et cryptos mondiales",
        keywords: ["marche", "bourse", "cotations", "actions", "cours", "yahoo", "ticker", "etf", "finance"],
        action: () => navigate("/market?tab=search"),
        badge: "Marché",
        icon: Activity,
        iconBg: "bg-[#c8a55e]/15",
        iconColor: "text-[#c8a55e]",
      },
      {
        id: "nav-market-indices",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Marché - Baromètres & Grands Indices",
        subtitle: "CAC 40, S&P 500, Nasdaq, Or, Pétrole, Matières premières",
        keywords: ["indices", "cac40", "sp500", "nasdaq", "or", "petrole", "barometre", "marche"],
        action: () => navigate("/market?tab=indices"),
        badge: "Marché",
        icon: TrendingUp,
        iconBg: "bg-[#c8a55e]/15",
        iconColor: "text-[#c8a55e]",
      },
      {
        id: "nav-market-etf",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Marché - Look-Through & Décomposition ETF",
        subtitle: "Transparence des sous-jacents sectoriels et géographiques (Picsou)",
        keywords: ["etf", "lookthrough", "secteurs", "geographie", "sous-jacents", "msci world", "amundi"],
        action: () => navigate("/market?tab=etf-lookthrough"),
        badge: "Marché",
        icon: Layers,
        iconBg: "bg-[#c8a55e]/15",
        iconColor: "text-[#c8a55e]",
      },
      {
        id: "nav-budget",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Budget & Dépenses Partagées",
        subtitle: "Gestion Tricount, suivi des dépenses du foyer et équilibre",
        keywords: ["budget", "tricount", "depenses", "comptes", "partage", "remboursement", "frais"],
        action: () => navigate("/budget"),
        badge: "Budget",
        icon: Receipt,
        iconBg: "bg-lime-500/10",
        iconColor: "text-lime-400",
      },
      {
        id: "nav-strategy",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Stratégie & Allocation Cible",
        subtitle: "Planification patrimoniale, répartition des revenus et équilibrage",
        keywords: ["strategie", "allocation", "planification", "objectifs", "repartition", "foyer"],
        action: () => navigate("/strategy"),
        badge: "Stratégie",
        icon: PieChart,
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-400",
      },
      {
        id: "nav-savings",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Épargne & Poches de Projets",
        subtitle: "Poches d'épargne dédiées, fonds d'urgence et projections d'intérêts",
        keywords: ["epargne", "projets", "poches", "objectifs", "fonds d'urgence", "previsions", "capital"],
        action: () => navigate("/savings"),
        badge: "Épargne",
        icon: PiggyBank,
        iconBg: "bg-pink-500/10",
        iconColor: "text-pink-400",
      },
      {
        id: "nav-ai",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: "Conseiller IA & Analyse",
        subtitle: "Diagnostic patrimonial automatisé, optimisations fiscales et recommandations",
        keywords: ["ia", "intelligence", "artificielle", "conseil", "optimisation", "fiscalite", "assistant"],
        action: () => navigate("/ai-analysis"),
        badge: "IA",
        icon: Sparkles,
        iconBg: "bg-indigo-500/10",
        iconColor: "text-indigo-400",
      },
      {
        id: "nav-settings",
        category: "page",
        categoryLabel: "Navigation & Pages",
        title: `Paramètres (${currentUser})`,
        subtitle: "Sécurité scrypt, mot de passe de session, devises et gestion du profil",
        keywords: ["parametres", "reglages", "profil", "securite", "mot de passe", "configuration", "settings", "lock"],
        action: () => navigate(`/settings/${currentUser}`),
        badge: "Profil",
        icon: Settings,
        iconBg: "bg-neutral-500/10",
        iconColor: "text-neutral-400",
      },
    ];
  }, [currentUser, navigate]);

  // Indexation des actifs de l'utilisateur
  const userAssetItems = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];

    // Comptes bancaires
    accounts.forEach((acc) => {
      items.push({
        id: `account-${acc.id}`,
        category: "account",
        categoryLabel: "Comptes Bancaires",
        title: acc.name,
        subtitle: `${acc.provider || "Banque"} • ${getAccountTypeLabel(acc.type)}${acc.iban ? ` • ${acc.iban.slice(-6)}` : ""}`,
        keywords: [acc.name, acc.provider || "", acc.iban || "", acc.type, "compte", "banque", "solde"],
        amount: acc.balance,
        action: () => navigate("/patrimoine?tab=accounts"),
        badge: acc.provider || "Banque",
        icon: Landmark,
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-400",
      });
    });

    // Titres en Bourse / PEA / CTO
    holdings.forEach((h) => {
      const tickerOrIsin = h.ticker || h.isin || "Titre";
      const holdingValue = typeof h.value === "number" ? h.value : h.quantity * (h.price || 0);

      items.push({
        id: `holding-${h.id}`,
        category: "holding",
        categoryLabel: "Bourse & Titres du Portefeuille",
        title: h.name || tickerOrIsin,
        subtitle: `Symbole : ${tickerOrIsin}${h.accountName ? ` • ${h.accountName}` : ""} • ${h.quantity.toLocaleString("fr-FR")} part(s)`,
        keywords: [tickerOrIsin, h.ticker || "", h.isin || "", h.name || "", "bourse", "action", "etf", "titre", "pea", "portefeuille"],
        amount: holdingValue,
        action: () => {
          if (h.ticker) {
            navigate(`/market?ticker=${encodeURIComponent(h.ticker)}`);
          } else {
            navigate("/patrimoine?tab=accounts");
          }
        },
        badge: tickerOrIsin,
        icon: TrendingUp,
        iconBg: "bg-[#c8a55e]/15",
        iconColor: "text-[#c8a55e]",
      });
    });

    // Cryptomonnaies et Wallets
    wallets.forEach((w) => {
      items.push({
        id: `wallet-${w.id}`,
        category: "crypto",
        categoryLabel: "Cryptomonnaies & Wallets",
        title: `Portefeuille ${w.name}`,
        subtitle: `Wallet ${w.walletType} • ${w.assets?.length || 0} actif(s) répertorié(s)`,
        keywords: [w.name, w.walletType, "wallet", "crypto", ...(w.blockchains || [])],
        amount: w.totalValue,
        action: () => navigate("/patrimoine?tab=crypto"),
        badge: "Wallet",
        icon: Wallet2,
        iconBg: "bg-purple-500/10",
        iconColor: "text-purple-400",
      });

      w.assets?.forEach((asset, idx) => {
        items.push({
          id: `crypto-asset-${w.id}-${asset.symbol}-${idx}`,
          category: "crypto",
          categoryLabel: "Cryptomonnaies & Wallets",
          title: `${asset.symbol} - ${asset.name}`,
          subtitle: `${w.name} • ${asset.balance.toLocaleString("fr-FR", { maximumFractionDigits: 6 })} ${asset.symbol}`,
          keywords: [asset.symbol, asset.name, w.name, "crypto", "token", "jeton"],
          amount: asset.value || 0,
          action: () => navigate("/patrimoine?tab=crypto"),
          badge: asset.symbol,
          icon: Coins,
          iconBg: "bg-purple-500/10",
          iconColor: "text-purple-400",
        });
      });
    });

    // Immobilier
    properties.forEach((p) => {
      items.push({
        id: `property-${p.id}`,
        category: "property",
        categoryLabel: "Patrimoine Immobilier",
        title: p.name,
        subtitle: `Bien immobilier • ${p.city || p.country || "France"}${p.surfaceM2 ? ` • ${p.surfaceM2} m²` : ""}`,
        keywords: [p.name, p.city || "", p.country || "", "immobilier", "bien", "logement", "appartement", "maison"],
        amount: p.purchasePrice || 0,
        action: () => navigate("/patrimoine?tab=realestate"),
        badge: p.city || "Immobilier",
        icon: Building2,
        iconBg: "bg-orange-500/10",
        iconColor: "text-orange-400",
      });
    });

    // Prêts et dettes
    loans.forEach((l) => {
      items.push({
        id: `loan-${l.id}`,
        category: "loan",
        categoryLabel: "Prêts & Crédits",
        title: l.name,
        subtitle: `${l.lender || "Banque"} • Échéance : ${l.monthlyPayment ? `${l.monthlyPayment.toLocaleString("fr-FR")} €/m` : "N/C"}`,
        keywords: [l.name, l.lender || "", "pret", "emprunt", "credit", "dette", "emprunteur"],
        amount: l.principal,
        isNegative: true,
        action: () => navigate("/patrimoine?tab=loans"),
        badge: "Prêt",
        icon: CreditCard,
        iconBg: "bg-rose-500/10",
        iconColor: "text-rose-400",
      });
    });

    // Poches d'épargne
    try {
      const strategy = getSavingsStrategy(currentUser);
      (strategy?.pockets || []).forEach((poc) => {
        items.push({
          id: `pocket-${poc.id}`,
          category: "pocket",
          categoryLabel: "Poches d'Épargne & Projets",
          title: poc.name,
          subtitle: `Objectif d'épargne • ${poc.notes || poc.category}`,
          keywords: [poc.name, poc.category, poc.notes || "", "epargne", "poche", "projet", "reserve"],
          amount: poc.currentAmount,
          action: () => navigate("/savings"),
          badge: "Poche",
          icon: PiggyBank,
          iconBg: "bg-pink-500/10",
          iconColor: "text-pink-400",
        });
      });
    } catch {
      // Tolérance
    }

    return items;
  }, [accounts, holdings, wallets, properties, loans, currentUser, navigate]);

  // 6. Résultats filtrés & groupés
  const filteredItems = useMemo<SearchItem[]>(() => {
    const rawQ = query.trim();
    if (!rawQ) {
      // Si la recherche est vide, proposer les pages principales d'accès rapide
      return staticNavigationItems.slice(0, 7);
    }

    const nq = normalize(rawQ);

    // Filtrer les éléments statiques et locaux
    const allLocal = [...userAssetItems, ...staticNavigationItems];
    const matched = allLocal.filter((item) => {
      const matchTitle = normalize(item.title).includes(nq);
      const matchSubtitle = normalize(item.subtitle).includes(nq);
      const matchKeyword = item.keywords.some((k) => normalize(k).includes(nq));
      return matchTitle || matchSubtitle || matchKeyword;
    });

    // Trier pour placer les correspondances exactes ou de début en premier
    matched.sort((a, b) => {
      const aTitle = normalize(a.title);
      const bTitle = normalize(b.title);
      const aStarts = aTitle.startsWith(nq) ? 1 : 0;
      const bStarts = bTitle.startsWith(nq) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return a.category === "account" || a.category === "holding" ? -1 : 1;
    });

    // Ajouter les résultats du marché mondial en direct
    const marketItems: SearchItem[] = marketResults.map((m) => ({
      id: `market-${m.ticker}`,
      category: "market",
      categoryLabel: "Marché Mondial en Direct",
      title: `${m.ticker} • ${m.name}`,
      subtitle: `${m.exchange || "Marché mondial"} • Cotation et fiche détaillée`,
      keywords: [m.ticker, m.name, m.exchange || ""],
      action: () => navigate(`/market?ticker=${encodeURIComponent(m.ticker)}`),
      badge: "Cotation ↗",
      icon: Globe,
      iconBg: "bg-cyan-500/10",
      iconColor: "text-cyan-400",
    }));

    return [...matched, ...marketItems];
  }, [query, staticNavigationItems, userAssetItems, marketResults, navigate]);

  // Groupement par catégorie pour affichage propre
  const groupedResults = useMemo(() => {
    const groups: { [key: string]: SearchItem[] } = {};
    filteredItems.forEach((item) => {
      if (!groups[item.categoryLabel]) {
        groups[item.categoryLabel] = [];
      }
      groups[item.categoryLabel].push(item);
    });
    return groups;
  }, [filteredItems]);

  // Sélection active au clavier
  const handleSelectItem = useCallback((item: SearchItem) => {
    setIsOpen(false);
    setQuery("");
    onSearchChange?.("");
    inputRef.current?.blur();
    item.action();
  }, [onSearchChange]);

  // Gestion des touches clavier flèches, entrée et échap
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
      setIsOpen(true);
      return;
    }

    if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (filteredItems.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filteredItems[selectedIndex];
      if (selected) {
        handleSelectItem(selected);
      }
    }
  };

  // Scroll automatique vers l'élément sélectionné
  useEffect(() => {
    if (!isOpen || !dropdownRef.current) return;
    const selectedElement = dropdownRef.current.querySelector<HTMLElement>(
      `[data-search-index="${selectedIndex}"]`
    );
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  // Réinitialiser la sélection lors du changement de filtre
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <div ref={containerRef} className="relative flex items-center">
      {/* Champ de recherche Navbar */}
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 w-4 h-4 text-[#737373] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => {
            setIsOpen(true);
            void loadPortfolioData();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            onSearchChange?.(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher (comptes, actions, crypto, pages)..."
          className="w-56 sm:w-80 md:w-96 pl-10 pr-16 py-2 bg-[#141414] hover:bg-[#181818] text-[#f5f5f5] text-xs sm:text-sm placeholder-[#666666] rounded-full border border-[rgba(255,255,255,0.08)] focus:border-[#c8a55e]/60 focus:ring-1 focus:ring-[#c8a55e]/30 focus:outline-none transition-all duration-200"
          aria-label="Recherche globale dans le portefeuille"
        />

        {/* Boutons d'état à droite : Chargement, Effacer ou Badge ⌘K */}
        <div className="absolute right-3 flex items-center gap-1.5 pointer-events-auto">
          {isSearchingMarket ? (
            <Loader2 className="w-3.5 h-3.5 text-[#c8a55e] animate-spin" />
          ) : query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                onSearchChange?.("");
                inputRef.current?.focus();
              }}
              className="p-1 rounded-full text-[#737373] hover:text-[#f5f5f5] hover:bg-white/10 transition-colors"
              title="Effacer la recherche"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] text-[#8a8a8a] font-mono border border-white/[0.08] shadow-sm select-none">
              ⌘K
            </span>
          )}
        </div>
      </div>

      {/* Menu Déroulant / Command Palette Omnisearch */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="fixed sm:absolute left-3 right-3 sm:left-0 sm:right-auto top-[72px] sm:top-full mt-2 sm:w-[520px] md:w-[620px] max-h-[72vh] flex flex-col bg-[#0e0e0e]/95 backdrop-blur-xl border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.85)] z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Entête d'état de recherche */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="text-[11px] font-medium text-[#8a8a8a] flex items-center gap-1.5">
              <Search className="w-3 h-3 text-[#c8a55e]" />
              {query.trim() ? (
                <>
                  Résultats pour <span className="text-[#f5f5f5] font-semibold">« {query} »</span>
                </>
              ) : (
                "Accès rapide & suggestions"
              )}
            </span>
            <span className="text-[11px] text-[#666666]">
              {filteredItems.length} résultat{filteredItems.length > 1 ? "s" : ""}
            </span>
          </div>

          {/* Liste des résultats organisée par groupes */}
          <div className="overflow-y-auto p-2 space-y-4 max-h-[56vh]">
            {filteredItems.length === 0 ? (
              <div className="py-10 text-center px-4 space-y-3">
                <div className="w-10 h-10 mx-auto rounded-full bg-white/5 flex items-center justify-center text-[#737373]">
                  <Search className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-[#f5f5f5]">
                  Aucun résultat pour « {query} »
                </p>
                <p className="text-xs text-[#8a8a8a] max-w-sm mx-auto">
                  Vérifiez l'orthographe ou recherchez directement le symbole ou l'actif sur le marché mondial.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    navigate(`/market?ticker=${encodeURIComponent(query)}`);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#c8a55e]/15 text-[#d4b56e] border border-[#c8a55e]/30 hover:bg-[#c8a55e]/25 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Inspecter « {query} » sur le Marché
                </button>
              </div>
            ) : (
              Object.entries(groupedResults).map(([groupLabel, items]) => (
                <div key={groupLabel} className="space-y-1">
                  <div className="px-3 py-1 text-[10px] font-bold text-[#737373] uppercase tracking-wider flex items-center justify-between">
                    <span>{groupLabel}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/[0.04] text-[#8a8a8a]">
                      {items.length}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    {items.map((item) => {
                      const flatIndex = filteredItems.indexOf(item);
                      const isSelected = flatIndex === selectedIndex;
                      const IconComponent = item.icon;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-search-index={flatIndex}
                          onClick={() => handleSelectItem(item)}
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          className={`w-full text-left flex items-center justify-between p-2.5 rounded-xl transition-all ${
                            isSelected
                              ? "bg-[rgba(200,165,94,0.16)] text-[#f5f5f5] border-l-2 border-[#c8a55e] pl-3"
                              : "hover:bg-white/[0.04] text-[#d4d4d4]"
                          }`}
                        >
                          {/* Gauche : Icône + Titre + Sous-titre */}
                          <div className="flex items-center gap-3 min-w-0 pr-3">
                            <div className={`p-2 rounded-xl flex-shrink-0 ${item.iconBg} ${item.iconColor}`}>
                              <IconComponent className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs sm:text-sm font-semibold text-[#f5f5f5] truncate">
                                  {item.title}
                                </span>
                                {item.badge && (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-white/[0.06] text-[#a3a3a3] border border-white/[0.08] flex-shrink-0">
                                    {item.badge}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#8a8a8a] truncate mt-0.5">
                                {item.subtitle}
                              </p>
                            </div>
                          </div>

                          {/* Droite : Montant chiffré ou Flèche */}
                          <div className="flex-shrink-0 text-right">
                            {typeof item.amount === "number" ? (
                              <span
                                className={`text-xs sm:text-sm font-semibold font-mono ${
                                  item.isNegative ? "text-rose-400" : "text-[#f5f5f5]"
                                }`}
                              >
                                {item.isNegative && "-"}
                                {formatMoney(item.amount)}
                              </span>
                            ) : (
                              <span className="text-xs text-[#8a8a8a] flex items-center gap-1 group-hover:text-[#c8a55e] transition-colors">
                                <ArrowRight className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pied de page avec raccourcis claviers */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#080808] border-t border-white/[0.06] text-[11px] text-[#666666]">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-[#8a8a8a] border border-white/[0.06]">
                  ↑↓
                </kbd>
                Naviguer
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-[#8a8a8a] border border-white/[0.06]">
                  ↵
                </kbd>
                Ouvrir
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-[#8a8a8a] border border-white/[0.06]">
                  Échap
                </kbd>
                Fermer
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-1 text-[11px] text-[#8a8a8a]">
              <span>💡 Astuce : Taper un ticker (ex: CW8, BTC) pour le marché direct</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
