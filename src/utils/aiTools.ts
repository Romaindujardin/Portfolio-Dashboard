// Outils (Tools / Function Calling) mis à la disposition du Conseiller IA (Gemini).
// Permet à l'IA d'interagir directement avec l'application : recherche de cours en direct,
// analyse de la composition d'un ETF (look-through), cotations d'indices, simulations
// d'intérêts composés et calculs de rééquilibrage de portefeuille.

import {
  getEtfProfile,
  getMarketIndices,
  getOverview,
  getQuote,
  searchSymbols,
} from "../services/portfolioApi";

export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  items?: {
    type: string;
    properties?: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

export interface AdvisorToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

// ─── Déclarations des outils pour Gemini ─────────────────────────────────────

export const ADVISOR_TOOL_DECLARATIONS: AdvisorToolDeclaration[] = [
  {
    name: "search_market_asset",
    description:
      "Recherche des symboles boursiers, actions, ETF, indices ou cryptomonnaies par mot-clé, ticker ou nom (ex: 'CW8', 'LVMH', 'Air Liquide', 'S&P 500', 'Bitcoin', 'TotalEnergies').",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description:
            "Nom de l'actif ou symbole recherché (ex: 'CW8', 'LVMH', 'S&P 500', 'Bitcoin').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_asset_price_quote",
    description:
      "Obtient le cours en direct, la devise, la variation journalière en %, et les plus hauts/bas sur 52 semaines pour un ticker précis (ex: 'CW8.PA', 'MC.PA', 'AAPL', 'BTC-EUR', 'ESE.PA').",
    parameters: {
      type: "OBJECT",
      properties: {
        ticker: {
          type: "STRING",
          description:
            "Le ticker ou symbole boursier exact (ex: 'CW8.PA', 'MC.PA', 'NVDA', 'BTC-EUR').",
        },
      },
      required: ["ticker"],
    },
  },
  {
    name: "get_etf_lookthrough",
    description:
      "Analyse la décomposition réelle sous-jacente d'un ETF (méthode Picsou) : répartition géographique (% pays), sectorielle (% secteurs économiques), top 10 des entreprises détenues, et frais annuels (TER).",
    parameters: {
      type: "OBJECT",
      properties: {
        ticker: {
          type: "STRING",
          description:
            "Le ticker ou ISIN de l'ETF (ex: 'CW8.PA', 'WPEA.PA', 'PE500.PA', 'ESE.PA').",
        },
      },
      required: ["ticker"],
    },
  },
  {
    name: "get_market_indices",
    description:
      "Récupère les cours en direct et variations des grands indices mondiaux et matières premières (CAC 40, S&P 500, Nasdaq 100, Euro Stoxx 50, Bitcoin, Ethereum, Or, Pétrole Brent).",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "simulate_compound_interest",
    description:
      "Simule mathématiquement la croissance d'un investissement avec intérêts composés réguliers (capital initial, versement mensuel, taux net moyen annuel espéré et durée en années).",
    parameters: {
      type: "OBJECT",
      properties: {
        initialCapital: {
          type: "NUMBER",
          description: "Capital de départ investi en euros (€).",
        },
        monthlyContribution: {
          type: "NUMBER",
          description: "Versement mensuel programmé en euros (€).",
        },
        annualReturnPercent: {
          type: "NUMBER",
          description: "Rendement annuel moyen net espéré en % (ex: 7 pour 7%).",
        },
        years: {
          type: "NUMBER",
          description: "Durée de l'investissement en années (ex: 5, 10, 15, 20).",
        },
      },
      required: [
        "initialCapital",
        "monthlyContribution",
        "annualReturnPercent",
        "years",
      ],
    },
  },
  {
    name: "calculate_rebalancing",
    description:
      "Calcule les montants d'arbitrages précis en euros à acheter ou vendre pour rééquilibrer un portefeuille vers une allocation cible donnée, en tenant compte éventuellement d'un apport de cash frais.",
    parameters: {
      type: "OBJECT",
      properties: {
        holdings: {
          type: "ARRAY",
          description:
            "Liste des lignes actuelles avec leur nom et montant actuel en euros.",
          items: {
            type: "OBJECT",
            properties: {
              name: {
                type: "STRING",
                description: "Nom ou catégorie de l'actif.",
              },
              currentAmount: {
                type: "NUMBER",
                description: "Valeur actuelle en euros.",
              },
            },
            required: ["name", "currentAmount"],
          },
        },
        targetPercentages: {
          type: "ARRAY",
          description:
            "Liste des pondérations cibles en % pour chaque actif (la somme doit être proche de 100).",
          items: {
            type: "OBJECT",
            properties: {
              name: {
                type: "STRING",
                description: "Nom ou catégorie de l'actif.",
              },
              targetPercent: {
                type: "NUMBER",
                description: "Pourcentage cible (ex: 70 pour 70%).",
              },
            },
            required: ["name", "targetPercent"],
          },
        },
        freshCash: {
          type: "NUMBER",
          description:
            "Montant facultatif de nouvel apport / cash frais à injecter pour rééquilibrer sans vendre.",
        },
      },
      required: ["holdings", "targetPercentages"],
    },
  },
];

// ─── Helpers de calcul mathématique ─────────────────────────────────────────

export interface CompoundInterestMilestone {
  year: number;
  totalInvested: number;
  totalInterest: number;
  totalCapital: number;
}

export interface CompoundInterestResult {
  initialCapital: number;
  monthlyContribution: number;
  annualReturnPercent: number;
  years: number;
  totalInvested: number;
  totalInterest: number;
  finalCapital: number;
  milestones: CompoundInterestMilestone[];
}

export const simulateCompoundInterest = (
  initialCapital: number,
  monthlyContribution: number,
  annualReturnPercent: number,
  years: number,
): CompoundInterestResult => {
  const init = Math.max(0, Number(initialCapital) || 0);
  const monthly = Math.max(0, Number(monthlyContribution) || 0);
  const annualRate = Math.max(0, Number(annualReturnPercent) || 0) / 100;
  const numYears = Math.min(50, Math.max(1, Math.round(Number(years) || 1)));

  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  let capital = init;
  let invested = init;
  const milestones: CompoundInterestMilestone[] = [];

  for (let y = 1; y <= numYears; y++) {
    for (let m = 1; m <= 12; m++) {
      capital = capital * (1 + monthlyRate) + monthly;
      invested += monthly;
    }
    // Enregistre chaque année ou tous les 5 ans si longue durée
    if (y === 1 || y % 5 === 0 || y === numYears) {
      milestones.push({
        year: y,
        totalInvested: Math.round(invested),
        totalInterest: Math.round(capital - invested),
        totalCapital: Math.round(capital),
      });
    }
  }

  return {
    initialCapital: init,
    monthlyContribution: monthly,
    annualReturnPercent: annualRate * 100,
    years: numYears,
    totalInvested: Math.round(invested),
    totalInterest: Math.max(0, Math.round(capital - invested)),
    finalCapital: Math.round(capital),
    milestones,
  };
};

export interface RebalanceAction {
  name: string;
  currentAmount: number;
  currentPercent: number;
  targetPercent: number;
  targetAmount: number;
  differenceEur: number;
  action: "ACHAT" | "VENTE" | "CONSERVER";
}

export interface RebalanceResult {
  totalCurrentValue: number;
  freshCashAdded: number;
  totalTargetValue: number;
  actions: RebalanceAction[];
}

export const calculateRebalancing = (
  holdings: Array<{ name: string; currentAmount: number }>,
  targetPercentages: Array<{ name: string; targetPercent: number }>,
  freshCash = 0,
): RebalanceResult => {
  const safeHoldings = (holdings || []).map((h) => ({
    name: String(h.name || "Actif"),
    currentAmount: Math.max(0, Number(h.currentAmount) || 0),
  }));

  const currentTotal = safeHoldings.reduce((s, h) => s + h.currentAmount, 0);
  const cash = Math.max(0, Number(freshCash) || 0);
  const targetTotal = currentTotal + cash;

  const targetMap = new Map<string, number>();
  for (const t of targetPercentages || []) {
    targetMap.set(String(t.name), Number(t.targetPercent) || 0);
  }

  const actions: RebalanceAction[] = safeHoldings.map((h) => {
    const curPct = currentTotal > 0 ? (h.currentAmount / currentTotal) * 100 : 0;
    const tgtPct = targetMap.get(h.name) ?? 0;
    const tgtAmount = (tgtPct / 100) * targetTotal;
    const diff = tgtAmount - h.currentAmount;

    let action: "ACHAT" | "VENTE" | "CONSERVER" = "CONSERVER";
    if (Math.abs(diff) > 10) {
      action = diff > 0 ? "ACHAT" : "VENTE";
    }

    return {
      name: h.name,
      currentAmount: Math.round(h.currentAmount),
      currentPercent: Math.round(curPct * 10) / 10,
      targetPercent: Math.round(tgtPct * 10) / 10,
      targetAmount: Math.round(tgtAmount),
      differenceEur: Math.round(diff),
      action,
    };
  });

  return {
    totalCurrentValue: Math.round(currentTotal),
    freshCashAdded: Math.round(cash),
    totalTargetValue: Math.round(targetTotal),
    actions,
  };
};

// ─── Exécuteur d'outils local pour le Conseiller IA ──────────────────────────

export const executeAdvisorTool = async (
  name: string,
  args: Record<string, any>,
  userId: string,
): Promise<any> => {
  try {
    switch (name) {
      case "search_market_asset": {
        const query = String(args.query || "").trim();
        if (!query) return { error: "Veuillez fournir un mot-clé de recherche." };
        const results = await searchSymbols(query);
        return {
          query,
          count: results.length,
          results: results.slice(0, 6).map((r) => ({
            ticker: r.ticker,
            name: r.name,
            exchange: r.exchange,
          })),
        };
      }

      case "get_asset_price_quote": {
        const ticker = String(args.ticker || "").trim();
        if (!ticker) return { error: "Veuillez fournir un ticker valide." };
        const quote = await getQuote(ticker, true);
        return {
          ticker: quote.ticker,
          name: quote.name,
          price: quote.price,
          currency: quote.currency,
          changePercent: quote.changePercent,
          previousClose: quote.previousClose,
          dayHigh: quote.dayHigh,
          dayLow: quote.dayLow,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
          marketState: quote.marketState,
        };
      }

      case "get_etf_lookthrough": {
        const query = String(args.ticker || "").trim();
        if (!query) return { error: "Veuillez fournir un ticker ou ISIN d'ETF." };
        const profile = await getEtfProfile(query);
        return {
          name: profile.name,
          ticker: profile.ticker,
          isin: profile.isin,
          expenseRatio: profile.expenseRatio,
          aumEur: profile.aumEur,
          topHoldings: (profile.topHoldings || []).slice(0, 10).map((h) => ({
            name: h.name,
            weight: h.weight,
            ticker: h.ticker,
          })),
          sectors: (profile.sectors || []).slice(0, 8).map((s) => ({
            sector: s.sector,
            weight: s.weight,
          })),
          countries: (profile.countries || []).slice(0, 8).map((c) => ({
            country: c.country,
            weight: c.weight,
          })),
        };
      }

      case "get_market_indices": {
        const indices = await getMarketIndices(undefined, true);
        return {
          count: indices.length,
          indices: indices.map((i) => ({
            ticker: i.ticker,
            name: i.name,
            price: i.price,
            currency: i.currency,
            changePercent: i.changePercent,
          })),
        };
      }

      case "simulate_compound_interest": {
        return simulateCompoundInterest(
          args.initialCapital,
          args.monthlyContribution,
          args.annualReturnPercent,
          args.years,
        );
      }

      case "calculate_rebalancing": {
        return calculateRebalancing(
          args.holdings,
          args.targetPercentages,
          args.freshCash,
        );
      }

      default:
        return { error: `Outil inconnu : ${name}` };
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Erreur lors de l'exécution de l'outil.",
    };
  }
};
