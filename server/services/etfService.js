// Service d'analyse approfondie et de look-through des ETF et fonds (méthode Picsou).
// Calcule la décomposition sectorielle (% Tech, % Santé, % Finance...),
// géographique (% États-Unis, % Europe, % Asie...), et l'exposition réelle aux entreprises sous-jacentes.

import { round2 } from "../lib/validate.js";

export const SECTOR_COLORS = {
  "Technologie de l'information": "#3b82f6",
  "Services financiers": "#10b981",
  "Santé": "#ef4444",
  "Consommation discrétionnaire": "#f59e0b",
  "Industrie": "#8b5cf6",
  "Services de communication": "#ec4899",
  "Consommation courante": "#14b8a6",
  "Énergie": "#f97316",
  "Matériaux": "#84cc16",
  "Services aux collectivités": "#06b6d4",
  "Immobilier": "#a855f7",
  "Monétaire & Liquidités": "#c8a55e",
  "Obligataire & Crédit": "#64748b",
  "Crypto-actifs": "#f7931a",
  "Autre": "#94a3b8",
};

export const COUNTRY_FLAGS = {
  "États-Unis": "🇺🇸",
  "France": "🇫🇷",
  "Zone Euro (hors France)": "🇪🇺",
  "Japon": "🇯🇵",
  "Royaume-Uni": "🇬🇧",
  "Suisse": "🇨🇭",
  "Marchés Émergents": "🌏",
  "Reste du Monde": "🌐",
  "Décentralisé / Crypto": "⛓️",
};

// Catalogue de référence des ETF majeurs et benchmarks mondiaux
export const ETF_CATALOG = {
  "SP500": {
    id: "SP500",
    name: "S&P 500 (PEA / CTO)",
    symbols: ["PE500", "PE500.PA", "ESE", "ESE.PA", "SPY", "VOO", "IVV", "FR0013412285", "FR0011550185"],
    patterns: [/s&p\s*500/i, /sp500/i, /pea\s*500/i],
    type: "ETF",
    description: "Les 500 plus grandes entreprises américaines cotées.",
    benchmark: "S&P 500 Index",
    sectors: {
      "Technologie de l'information": 31.2,
      "Services financiers": 13.1,
      "Santé": 11.4,
      "Consommation discrétionnaire": 10.3,
      "Services de communication": 9.1,
      "Industrie": 8.4,
      "Consommation courante": 5.4,
      "Énergie": 3.5,
      "Services aux collectivités": 2.5,
      "Matériaux": 2.1,
      "Immobilier": 2.0,
      "Monétaire & Liquidités": 1.0,
    },
    countries: {
      "États-Unis": 100.0,
    },
    topHoldings: [
      { name: "Apple Inc.", ticker: "AAPL", weight: 7.1, sector: "Technologie de l'information" },
      { name: "Microsoft Corp.", ticker: "MSFT", weight: 6.9, sector: "Technologie de l'information" },
      { name: "NVIDIA Corp.", ticker: "NVDA", weight: 6.2, sector: "Technologie de l'information" },
      { name: "Alphabet Inc. (Google)", ticker: "GOOGL", weight: 4.1, sector: "Services de communication" },
      { name: "Amazon.com Inc.", ticker: "AMZN", weight: 3.8, sector: "Consommation discrétionnaire" },
      { name: "Meta Platforms Inc.", ticker: "META", weight: 2.6, sector: "Services de communication" },
      { name: "Berkshire Hathaway", ticker: "BRK.B", weight: 1.7, sector: "Services financiers" },
      { name: "Broadcom Inc.", ticker: "AVGO", weight: 1.5, sector: "Technologie de l'information" },
      { name: "Eli Lilly & Co.", ticker: "LLY", weight: 1.5, sector: "Santé" },
      { name: "Tesla Inc.", ticker: "TSLA", weight: 1.3, sector: "Consommation discrétionnaire" },
      { name: "JPMorgan Chase & Co.", ticker: "JPM", weight: 1.3, sector: "Services financiers" },
    ],
  },
  "MSCI_WORLD": {
    id: "MSCI_WORLD",
    name: "MSCI World (PEA / CTO)",
    symbols: ["CW8", "CW8.PA", "EWLD", "EWLD.PA", "WPEA", "WPEA.PA", "URTH", "FR0010315770", "FR0011869353", "IE0002XZSHO1"],
    patterns: [/msci\s*world/i, /world\s*ucits/i],
    type: "ETF",
    description: "Indice représentatif de l'économie mondiale développée (1 400+ entreprises, 23 pays).",
    benchmark: "MSCI World Net Return",
    sectors: {
      "Technologie de l'information": 25.5,
      "Services financiers": 15.2,
      "Santé": 11.8,
      "Industrie": 11.0,
      "Consommation discrétionnaire": 10.2,
      "Services de communication": 7.8,
      "Consommation courante": 6.2,
      "Énergie": 4.1,
      "Matériaux": 3.6,
      "Services aux collectivités": 2.5,
      "Immobilier": 2.1,
    },
    countries: {
      "États-Unis": 71.0,
      "Japon": 5.8,
      "Royaume-Uni": 3.8,
      "France": 3.1,
      "Suisse": 2.5,
      "Zone Euro (hors France)": 6.8,
      "Reste du Monde": 7.0,
    },
    topHoldings: [
      { name: "Apple Inc.", ticker: "AAPL", weight: 5.0, sector: "Technologie de l'information" },
      { name: "Microsoft Corp.", ticker: "MSFT", weight: 4.8, sector: "Technologie de l'information" },
      { name: "NVIDIA Corp.", ticker: "NVDA", weight: 4.4, sector: "Technologie de l'information" },
      { name: "Alphabet Inc. (Google)", ticker: "GOOGL", weight: 2.9, sector: "Services de communication" },
      { name: "Amazon.com Inc.", ticker: "AMZN", weight: 2.7, sector: "Consommation discrétionnaire" },
      { name: "Meta Platforms Inc.", ticker: "META", weight: 1.8, sector: "Services de communication" },
      { name: "Berkshire Hathaway", ticker: "BRK.B", weight: 1.2, sector: "Services financiers" },
      { name: "Broadcom Inc.", ticker: "AVGO", weight: 1.1, sector: "Technologie de l'information" },
      { name: "Eli Lilly & Co.", ticker: "LLY", weight: 1.1, sector: "Santé" },
      { name: "JPMorgan Chase & Co.", ticker: "JPM", weight: 0.9, sector: "Services financiers" },
      { name: "Novo Nordisk", ticker: "NOVO-B.CO", weight: 0.9, sector: "Santé" },
    ],
  },
  "NASDAQ100": {
    id: "NASDAQ100",
    name: "Nasdaq 100",
    symbols: ["UST", "UST.PA", "PUST", "QQQ", "LU1681043599"],
    patterns: [/nasdaq/i, /qqq/i],
    type: "ETF",
    description: "Les 100 plus grands leaders technologiques et de croissance.",
    benchmark: "NASDAQ-100 Index",
    sectors: {
      "Technologie de l'information": 50.2,
      "Services de communication": 15.5,
      "Consommation discrétionnaire": 13.8,
      "Santé": 6.5,
      "Industrie": 4.8,
      "Consommation courante": 4.2,
      "Services aux collectivités": 1.2,
      "Autre": 3.8,
    },
    countries: {
      "États-Unis": 97.5,
      "Zone Euro (hors France)": 2.5,
    },
    topHoldings: [
      { name: "Apple Inc.", ticker: "AAPL", weight: 9.0, sector: "Technologie de l'information" },
      { name: "Microsoft Corp.", ticker: "MSFT", weight: 8.5, sector: "Technologie de l'information" },
      { name: "NVIDIA Corp.", ticker: "NVDA", weight: 8.2, sector: "Technologie de l'information" },
      { name: "Alphabet Inc.", ticker: "GOOGL", weight: 5.2, sector: "Services de communication" },
      { name: "Amazon.com Inc.", ticker: "AMZN", weight: 5.2, sector: "Consommation discrétionnaire" },
      { name: "Broadcom Inc.", ticker: "AVGO", weight: 4.8, sector: "Technologie de l'information" },
      { name: "Meta Platforms Inc.", ticker: "META", weight: 4.5, sector: "Services de communication" },
      { name: "Tesla Inc.", ticker: "TSLA", weight: 2.8, sector: "Consommation discrétionnaire" },
      { name: "Costco Wholesale", ticker: "COST", weight: 2.4, sector: "Consommation courante" },
      { name: "Netflix Inc.", ticker: "NFLX", weight: 2.1, sector: "Services de communication" },
    ],
  },
  "CAC40": {
    id: "CAC40",
    name: "CAC 40",
    symbols: ["PX1", "PX1.PA", "^FCHI", "FR0007054316"],
    patterns: [/cac\s*40/i],
    type: "ETF",
    description: "L'indice phare de la bourse de Paris.",
    benchmark: "CAC 40 Gross Return",
    sectors: {
      "Consommation discrétionnaire": 21.5,
      "Industrie": 20.0,
      "Santé": 12.5,
      "Services financiers": 11.0,
      "Énergie": 9.5,
      "Matériaux": 7.5,
      "Technologie de l'information": 6.5,
      "Consommation courante": 5.5,
      "Services de communication": 3.0,
      "Services aux collectivités": 3.0,
    },
    countries: {
      "France": 95.0,
      "Zone Euro (hors France)": 5.0,
    },
    topHoldings: [
      { name: "LVMH Moët Hennessy", ticker: "MC.PA", weight: 10.2, sector: "Consommation discrétionnaire" },
      { name: "TotalEnergies", ticker: "TTE.PA", weight: 8.5, sector: "Énergie" },
      { name: "Schneider Electric", ticker: "SU.PA", weight: 7.8, sector: "Industrie" },
      { name: "Sanofi", ticker: "SAN.PA", weight: 6.8, sector: "Santé" },
      { name: "Air Liquide", ticker: "AI.PA", weight: 6.5, sector: "Matériaux" },
      { name: "Hermès International", ticker: "RMS.PA", weight: 5.4, sector: "Consommation discrétionnaire" },
      { name: "BNP Paribas", ticker: "BNP.PA", weight: 4.6, sector: "Services financiers" },
      { name: "L'Oréal", ticker: "OR.PA", weight: 4.5, sector: "Consommation courante" },
      { name: "Safran", ticker: "SAF.PA", weight: 4.2, sector: "Industrie" },
      { name: "Airbus", ticker: "AIR.PA", weight: 4.0, sector: "Industrie" },
    ],
  },
  "EUROSTOXX50": {
    id: "EUROSTOXX50",
    name: "Euro Stoxx 50",
    symbols: ["MSE", "MSE.PA", "^STOXX50E", "LU0908500753"],
    patterns: [/euro\s*stoxx/i, /stoxx\s*50/i],
    type: "ETF",
    description: "Les 50 leaders économiques de la zone euro.",
    benchmark: "EURO STOXX 50",
    sectors: {
      "Technologie de l'information": 18.5,
      "Services financiers": 17.5,
      "Consommation discrétionnaire": 16.0,
      "Industrie": 15.0,
      "Santé": 9.5,
      "Consommation courante": 6.5,
      "Énergie": 6.0,
      "Matériaux": 5.5,
      "Services aux collectivités": 3.5,
      "Services de communication": 2.0,
    },
    countries: {
      "France": 36.0,
      "Zone Euro (hors France)": 64.0,
    },
    topHoldings: [
      { name: "ASML Holding", ticker: "ASML.AS", weight: 8.5, sector: "Technologie de l'information" },
      { name: "SAP SE", ticker: "SAP.DE", weight: 7.1, sector: "Technologie de l'information" },
      { name: "LVMH Moët Hennessy", ticker: "MC.PA", weight: 6.0, sector: "Consommation discrétionnaire" },
      { name: "Schneider Electric", ticker: "SU.PA", weight: 5.5, sector: "Industrie" },
      { name: "TotalEnergies", ticker: "TTE.PA", weight: 5.0, sector: "Énergie" },
    ],
  },
  "EMERGING_MARKETS": {
    id: "EMERGING_MARKETS",
    name: "MSCI Emerging Markets",
    symbols: ["PAASI", "PAASI.PA", "PRAM", "PRAM.PA", "EEM", "FR0013412012", "FR0013412020"],
    patterns: [/emerging/i, /emergents/i, /asie\s*pacifique/i],
    type: "ETF",
    description: "Les économies en forte croissance (Taïwan, Inde, Chine, Corée...).",
    benchmark: "MSCI Emerging Markets",
    sectors: {
      "Technologie de l'information": 24.0,
      "Services financiers": 22.0,
      "Consommation discrétionnaire": 12.5,
      "Services de communication": 8.5,
      "Industrie": 7.5,
      "Matériaux": 6.5,
      "Consommation courante": 5.5,
      "Énergie": 5.0,
      "Santé": 3.5,
      "Services aux collectivités": 2.5,
      "Immobilier": 2.5,
    },
    countries: {
      "Marchés Émergents": 82.0,
      "Reste du Monde": 18.0,
    },
    topHoldings: [
      { name: "TSMC (Taiwan Semiconductor)", ticker: "TSM", weight: 8.5, sector: "Technologie de l'information" },
      { name: "Tencent Holdings", ticker: "0700.HK", weight: 4.2, sector: "Services de communication" },
      { name: "Samsung Electronics", ticker: "005930.KS", weight: 3.8, sector: "Technologie de l'information" },
      { name: "Alibaba Group", ticker: "BABA", weight: 2.3, sector: "Consommation discrétionnaire" },
      { name: "Reliance Industries", ticker: "RELIANCE.NS", weight: 1.5, sector: "Énergie" },
    ],
  },
  // Fonds de gestion active et fonds euros du portefeuille
  "STRATEGIE_SANTE": {
    id: "STRATEGIE_SANTE",
    name: "Stratégie Santé",
    symbols: ["FR0000983561"],
    patterns: [/strategie\s*sante/i, /sante/i],
    type: "FUND",
    description: "Fonds thématique international spécialisé dans l'innovation médicale et pharmaceutique.",
    sectors: {
      "Santé": 100.0,
    },
    countries: {
      "États-Unis": 55.0,
      "Suisse": 18.0,
      "Zone Euro (hors France)": 12.0,
      "France": 8.0,
      "Reste du Monde": 7.0,
    },
    topHoldings: [
      { name: "Eli Lilly & Co.", ticker: "LLY", weight: 8.0, sector: "Santé" },
      { name: "Novo Nordisk", ticker: "NOVO-B.CO", weight: 7.5, sector: "Santé" },
      { name: "AstraZeneca", ticker: "AZN", weight: 6.0, sector: "Santé" },
      { name: "Novartis AG", ticker: "NOVN.SW", weight: 5.5, sector: "Santé" },
      { name: "Roche Holding", ticker: "ROG.SW", weight: 5.0, sector: "Santé" },
      { name: "Sanofi", ticker: "SAN.PA", weight: 4.5, sector: "Santé" },
      { name: "Pfizer Inc.", ticker: "PFE", weight: 4.0, sector: "Santé" },
      { name: "Merck & Co.", ticker: "MRK", weight: 4.0, sector: "Santé" },
    ],
  },
  "TALENCE_PME": {
    id: "TALENCE_PME",
    name: "Talence Sélection PME",
    symbols: ["FR0011859180"],
    patterns: [/talence/i, /pme/i],
    type: "FUND",
    description: "Fonds actions spécialisé dans les PME et entreprises de taille intermédiaire françaises.",
    sectors: {
      "Industrie": 36.0,
      "Technologie de l'information": 24.0,
      "Santé": 18.0,
      "Consommation discrétionnaire": 14.0,
      "Services financiers": 8.0,
    },
    countries: {
      "France": 92.0,
      "Zone Euro (hors France)": 8.0,
    },
    topHoldings: [
      { name: "ID Logistics Group", ticker: "IDL.PA", weight: 6.0, sector: "Industrie" },
      { name: "Aubay", ticker: "AUB.PA", weight: 5.5, sector: "Technologie de l'information" },
      { name: "Lectra", ticker: "LSS.PA", weight: 5.0, sector: "Technologie de l'information" },
      { name: "Wavestone", ticker: "WAVE.PA", weight: 4.8, sector: "Technologie de l'information" },
      { name: "Virbac", ticker: "VIRP.PA", weight: 4.5, sector: "Santé" },
      { name: "Robertet", ticker: "RBT.PA", weight: 4.2, sector: "Matériaux" },
    ],
  },
  "QUADRIGE_MIDCAPS": {
    id: "QUADRIGE_MIDCAPS",
    name: "Quadrige Rendement FR Midcaps",
    symbols: ["FR0011640986"],
    patterns: [/quadrige/i, /midcaps/i],
    type: "FUND",
    description: "Fonds actions françaises à moyenne capitalisation.",
    sectors: {
      "Industrie": 34.0,
      "Services financiers": 20.0,
      "Technologie de l'information": 18.0,
      "Santé": 16.0,
      "Matériaux": 12.0,
    },
    countries: {
      "France": 95.0,
      "Zone Euro (hors France)": 5.0,
    },
    topHoldings: [
      { name: "Nexans", ticker: "NEX.PA", weight: 5.8, sector: "Industrie" },
      { name: "Spie", ticker: "SPIE.PA", weight: 5.4, sector: "Industrie" },
      { name: "GTT", ticker: "GTT.PA", weight: 5.1, sector: "Énergie" },
      { name: "Sopra Steria", ticker: "SOP.PA", weight: 4.9, sector: "Technologie de l'information" },
    ],
  },
  "STRATEGIE_ACTIONS_EURO": {
    id: "STRATEGIE_ACTIONS_EURO",
    name: "Stratégie Actions Euro Sicav A",
    symbols: ["FR0000016164"],
    patterns: [/strategie\s*actions\s*euro/i, /sicav\s*a/i],
    type: "FUND",
    description: "Fonds diversifié en actions de grandes entreprises de la zone euro.",
    sectors: {
      "Technologie de l'information": 20.0,
      "Industrie": 19.0,
      "Services financiers": 18.0,
      "Consommation discrétionnaire": 16.0,
      "Santé": 11.0,
      "Énergie": 6.0,
      "Matériaux": 5.0,
      "Consommation courante": 5.0,
    },
    countries: {
      "France": 35.0,
      "Zone Euro (hors France)": 65.0,
    },
    topHoldings: [
      { name: "ASML Holding", ticker: "ASML.AS", weight: 7.2, sector: "Technologie de l'information" },
      { name: "SAP SE", ticker: "SAP.DE", weight: 6.8, sector: "Technologie de l'information" },
      { name: "LVMH Moët Hennessy", ticker: "MC.PA", weight: 6.5, sector: "Consommation discrétionnaire" },
      { name: "Schneider Electric", ticker: "SU.PA", weight: 5.4, sector: "Industrie" },
      { name: "Siemens AG", ticker: "SIE.DE", weight: 4.8, sector: "Industrie" },
    ],
  },
  "APICIL_TRESORERIE": {
    id: "APICIL_TRESORERIE",
    name: "Apicil Trésorerie P",
    symbols: ["FR0013328317"],
    patterns: [/apicil/i, /tresorerie/i, /monetaire/i],
    type: "CASH_EQUIVALENT",
    description: "Fonds monétaire de trésorerie en euros, sans risque de change.",
    sectors: {
      "Monétaire & Liquidités": 100.0,
    },
    countries: {
      "France": 100.0,
    },
    topHoldings: [
      { name: "Bons du Trésor Français (BTF)", ticker: "FR-BTF", weight: 55.0, sector: "Monétaire & Liquidités" },
      { name: "Dépôts interbancaires BCE", ticker: "ECB-DEP", weight: 45.0, sector: "Monétaire & Liquidités" },
    ],
  },
  "EURO_GARANTIE": {
    id: "EURO_GARANTIE",
    name: "Fonds Euro Garanti",
    symbols: ["EURGRE000GLT"],
    patterns: [/euro\s*garantie/i, /fonds\s*euro/i, /capital\s*garanti/i],
    type: "CASH_EQUIVALENT",
    description: "Actif à capital garanti par la compagnie d'assurance (Obligations d'État et de crédit souverain).",
    sectors: {
      "Monétaire & Liquidités": 100.0,
    },
    countries: {
      "France": 100.0,
    },
    topHoldings: [
      { name: "OAT France & Emprunts d'État Euro", ticker: "FR-OAT", weight: 80.0, sector: "Monétaire & Liquidités" },
      { name: "Actifs immobiliers de rendement", ticker: "SCI-IMMO", weight: 20.0, sector: "Monétaire & Liquidités" },
    ],
  },
  "SCHRODER_CREDIT": {
    id: "SCHRODER_CREDIT",
    name: "Schroder ISF Credit Inc",
    symbols: ["LU1514167722"],
    patterns: [/schroder/i, /credit\s*inc/i],
    type: "FUND",
    description: "Fonds obligataire international orienté sur le crédit d'entreprises de qualité (Investment Grade).",
    sectors: {
      "Obligataire & Crédit": 100.0,
    },
    countries: {
      "États-Unis": 50.0,
      "Zone Euro (hors France)": 25.0,
      "Royaume-Uni": 15.0,
      "Reste du Monde": 10.0,
    },
    topHoldings: [
      { name: "US Corporate High Yield Bonds", ticker: "US-HY", weight: 45.0, sector: "Obligataire & Crédit" },
      { name: "Euro Corporate Investment Grade", ticker: "EU-IG", weight: 35.0, sector: "Obligataire & Crédit" },
      { name: "Securitized Credit", ticker: "ABS", weight: 20.0, sector: "Obligataire & Crédit" },
    ],
  },
};

// Actions individuelles directes connues
export const INDIVIDUAL_STOCKS = {
  "MC.PA": { name: "LVMH Moët Hennessy", ticker: "MC.PA", sector: "Consommation discrétionnaire", country: "France" },
  "TTE.PA": { name: "TotalEnergies", ticker: "TTE.PA", sector: "Énergie", country: "France" },
  "AI.PA": { name: "Air Liquide", ticker: "AI.PA", sector: "Matériaux", country: "France" },
  "SU.PA": { name: "Schneider Electric", ticker: "SU.PA", sector: "Industrie", country: "France" },
  "SAN.PA": { name: "Sanofi", ticker: "SAN.PA", sector: "Santé", country: "France" },
  "RMS.PA": { name: "Hermès International", ticker: "RMS.PA", sector: "Consommation discrétionnaire", country: "France" },
  "BNP.PA": { name: "BNP Paribas", ticker: "BNP.PA", sector: "Services financiers", country: "France" },
  "OR.PA": { name: "L'Oréal", ticker: "OR.PA", sector: "Consommation courante", country: "France" },
  "SAF.PA": { name: "Safran", ticker: "SAF.PA", sector: "Industrie", country: "France" },
  "AIR.PA": { name: "Airbus", ticker: "AIR.PA", sector: "Industrie", country: "France" },
  "AAPL": { name: "Apple Inc.", ticker: "AAPL", sector: "Technologie de l'information", country: "États-Unis" },
  "MSFT": { name: "Microsoft Corp.", ticker: "MSFT", sector: "Technologie de l'information", country: "États-Unis" },
  "NVDA": { name: "NVIDIA Corp.", ticker: "NVDA", sector: "Technologie de l'information", country: "États-Unis" },
  "GOOGL": { name: "Alphabet Inc.", ticker: "GOOGL", sector: "Services de communication", country: "États-Unis" },
  "AMZN": { name: "Amazon.com Inc.", ticker: "AMZN", sector: "Consommation discrétionnaire", country: "États-Unis" },
  "META": { name: "Meta Platforms Inc.", ticker: "META", sector: "Services de communication", country: "États-Unis" },
  "TSLA": { name: "Tesla Inc.", ticker: "TSLA", sector: "Consommation discrétionnaire", country: "États-Unis" },
};

/**
 * Résout le profil de composition pour une ligne de portefeuille ou un titre.
 */
export const resolveHoldingProfile = (holding = {}) => {
  const isin = (holding.isin || "").trim().toUpperCase();
  const ticker = (holding.ticker || "").trim().toUpperCase();
  const name = (holding.name || "").trim();

  // 1. Détection crypto
  if (
    ["ETH", "BTC", "BNB", "AVAX", "USDC", "USDT", "SOL", "SENT", "HYPE"].includes(ticker) ||
    holding.accountType === "CRYPTO" ||
    name.toLowerCase().includes("crypto") ||
    name.toLowerCase().includes("tether")
  ) {
    return {
      identified: true,
      id: ticker || "CRYPTO",
      name: name || ticker || "Crypto",
      category: "CRYPTO",
      sectors: { "Crypto-actifs": 100.0 },
      countries: { "Décentralisé / Crypto": 100.0 },
      topHoldings: [{ name: name || ticker, ticker, weight: 100.0, sector: "Crypto-actifs" }],
    };
  }

  // 2. Recherche exacte dans le catalogue ETF par ISIN ou Symbole
  for (const etf of Object.values(ETF_CATALOG)) {
    if (isin && etf.symbols.includes(isin)) return { identified: true, ...etf };
    if (ticker && etf.symbols.includes(ticker)) return { identified: true, ...etf };
  }

  // 3. Recherche par motifs d'expressions régulières sur le nom ou le ticker
  const targetStr = `${ticker} ${name}`;
  for (const etf of Object.values(ETF_CATALOG)) {
    if (etf.patterns && etf.patterns.some((re) => re.test(targetStr))) {
      return { identified: true, ...etf };
    }
  }

  // 4. Action individuelle directe
  if (ticker && INDIVIDUAL_STOCKS[ticker]) {
    const stock = INDIVIDUAL_STOCKS[ticker];
    return {
      identified: true,
      id: ticker,
      name: stock.name,
      category: "STOCK",
      sectors: { [stock.sector]: 100.0 },
      countries: { [stock.country]: 100.0 },
      topHoldings: [{ name: stock.name, ticker: stock.ticker, weight: 100.0, sector: stock.sector }],
    };
  }

  // 5. Repli intelligent selon les mots-clés du nom
  const lower = name.toLowerCase();
  if (lower.includes("monetaire") || lower.includes("liquidite") || lower.includes("cash") || lower.includes("livret")) {
    return {
      identified: true,
      id: isin || ticker || "CASH",
      name,
      category: "CASH_EQUIVALENT",
      sectors: { "Monétaire & Liquidités": 100.0 },
      countries: { "France": 100.0 },
      topHoldings: [{ name, ticker: ticker || "CASH", weight: 100.0, sector: "Monétaire & Liquidités" }],
    };
  }

  if (lower.includes("obligation") || lower.includes("bond") || lower.includes("credit") || lower.includes("dette")) {
    return {
      identified: true,
      id: isin || ticker || "BOND",
      name,
      category: "FUND",
      sectors: { "Obligataire & Crédit": 100.0 },
      countries: { "Zone Euro (hors France)": 60.0, "France": 40.0 },
      topHoldings: [{ name, ticker: ticker || "BOND", weight: 100.0, sector: "Obligataire & Crédit" }],
    };
  }

  // Profil non catalogué : classe par défaut « Autre »
  return {
    identified: false,
    id: isin || ticker || "UNKNOWN",
    name: name || ticker || "Autre actif",
    category: "OTHER",
    sectors: { "Autre": 100.0 },
    countries: { "Reste du Monde": 100.0 },
    topHoldings: [{ name: name || ticker || "Titre", ticker: ticker || "-", weight: 100.0, sector: "Autre" }],
  };
};

/**
 * Calcule l'agrégation Look-Through complète pour un ensemble de lignes de portefeuille.
 */
export const computePortfolioEtfBreakdown = (holdings = []) => {
  const sectorTotals = {};
  const countryTotals = {};
  const companyTotals = {};
  const assetsAnalyzed = [];

  let totalPortfolioValue = 0;

  for (const h of holdings) {
    const qty = Number(h.quantity) || 0;
    const price = Number(h.price) || 0;
    const val = Number(h.value != null ? h.value : qty * price) || 0;

    if (val <= 0) continue;
    totalPortfolioValue += val;

    const profile = resolveHoldingProfile(h);

    assetsAnalyzed.push({
      holdingId: h.id,
      accountId: h.accountId,
      accountName: h.accountName || null,
      name: h.name || profile.name,
      ticker: h.ticker || null,
      isin: h.isin || null,
      value: round2(val),
      category: profile.category || "OTHER",
      identified: profile.identified,
      profileName: profile.name,
      sectors: profile.sectors,
      countries: profile.countries,
    });

    // Décomposition sectorielle
    for (const [sector, pct] of Object.entries(profile.sectors || {})) {
      const euroAmount = val * (pct / 100);
      sectorTotals[sector] = (sectorTotals[sector] || 0) + euroAmount;
    }

    // Décomposition géographique
    for (const [country, pct] of Object.entries(profile.countries || {})) {
      const euroAmount = val * (pct / 100);
      countryTotals[country] = (countryTotals[country] || 0) + euroAmount;
    }

    // Entreprises sous-jacentes (Look-Through)
    for (const comp of profile.topHoldings || []) {
      const euroAmount = val * (comp.weight / 100);
      const key = comp.name;
      if (!companyTotals[key]) {
        companyTotals[key] = {
          name: comp.name,
          ticker: comp.ticker || null,
          sector: comp.sector || "Autre",
          totalValue: 0,
        };
      }
      companyTotals[key].totalValue += euroAmount;
    }
  }

  // Formatage des secteurs triés par montant décroissant
  const sectors = Object.entries(sectorTotals)
    .map(([sector, amount]) => {
      const weight = totalPortfolioValue > 0 ? (amount / totalPortfolioValue) * 100 : 0;
      return {
        sector,
        weight: round2(weight),
        value: round2(amount),
        color: SECTOR_COLORS[sector] || SECTOR_COLORS["Autre"],
      };
    })
    .sort((a, b) => b.value - a.value);

  // Formatage des pays triés par montant décroissant
  const countries = Object.entries(countryTotals)
    .map(([country, amount]) => {
      const weight = totalPortfolioValue > 0 ? (amount / totalPortfolioValue) * 100 : 0;
      return {
        country,
        weight: round2(weight),
        value: round2(amount),
        flag: COUNTRY_FLAGS[country] || "🌐",
      };
    })
    .sort((a, b) => b.value - a.value);

  // Top entreprises sous-jacentes triées par montant décroissant
  const topHoldings = Object.values(companyTotals)
    .map((comp) => {
      const weight = totalPortfolioValue > 0 ? (comp.totalValue / totalPortfolioValue) * 100 : 0;
      return {
        name: comp.name,
        ticker: comp.ticker,
        sector: comp.sector,
        value: round2(comp.totalValue),
        weight: round2(weight),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  // Calcul des métriques clés
  const techWeight = sectors.find((s) => s.sector === "Technologie de l'information")?.weight || 0;
  const usWeight = countries.find((c) => c.country === "États-Unis")?.weight || 0;
  const top10Concentration = topHoldings.slice(0, 10).reduce((sum, h) => sum + h.weight, 0);

  return {
    totalValue: round2(totalPortfolioValue),
    assetCount: assetsAnalyzed.length,
    summary: {
      techWeight: round2(techWeight),
      usWeight: round2(usWeight),
      top10Concentration: round2(top10Concentration),
      uniqueCompaniesCount: Object.keys(companyTotals).length,
    },
    sectors,
    countries,
    topHoldings,
    assets: assetsAnalyzed,
  };
};
