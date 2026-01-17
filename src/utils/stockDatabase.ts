// Base de données des actions avec Yahoo Finance via serveur proxy local
// Solution sans CORS et sans limitations de taux

export interface StockInfo {
  symbol: string;
  name: string;
  market: "US" | "EU" | "UK" | "CH" | "Asia" | "ETF";
  currency: string;
  exchange: string;
}

export interface StockData extends StockInfo {
  price: number | null;
  marketState?: string;
  lastUpdated: string;
}

// URL du serveur proxy local (configurable via variable d'environnement)
const PROXY_SERVER_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Cache local pour éviter les requêtes répétées
const priceCache = new Map<string, { data: StockData; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Catalogue statique complet des actions disponibles (sans prix)
const STOCK_CATALOG: StockInfo[] = [
  // =================================================================
  // == Actions Américaines (NASDAQ/NYSE) - Top 100+ =================
  // =================================================================

  // Technologie & Communications
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc. Class A",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "GOOG",
    name: "Alphabet Inc. Class C",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "AMZN",
    name: "Amazon.com Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "META",
    name: "Meta Platforms Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "AVGO",
    name: "Broadcom Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "ORCL",
    name: "Oracle Corporation",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "CRM",
    name: "Salesforce Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "ADBE",
    name: "Adobe Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "QCOM",
    name: "QUALCOMM Incorporated",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "INTC",
    name: "Intel Corporation",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "CSCO",
    name: "Cisco Systems, Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "IBM",
    name: "International Business Machines",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "NFLX",
    name: "Netflix Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "TXN",
    name: "Texas Instruments Incorporated",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "UBER",
    name: "Uber Technologies Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "SPOT",
    name: "Spotify Technology S.A.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "ZOOM",
    name: "Zoom Video Communications Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "SQ",
    name: "Block Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "SNOW",
    name: "Snowflake Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },

  // Finance & Banque
  {
    symbol: "BRK-B",
    name: "Berkshire Hathaway Inc. Class B",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "V",
    name: "Visa Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "JPM",
    name: "JPMorgan Chase & Co.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "MA",
    name: "Mastercard Incorporated",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "BAC",
    name: "Bank of America Corporation",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "WFC",
    name: "Wells Fargo & Company",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "GS",
    name: "Goldman Sachs Group Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "MS",
    name: "Morgan Stanley",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "BLK",
    name: "BlackRock, Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "C",
    name: "Citigroup Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "PYPL",
    name: "PayPal Holdings Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "AXP",
    name: "American Express Company",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },

  // Santé
  {
    symbol: "LLY",
    name: "Eli Lilly and Company",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "UNH",
    name: "UnitedHealth Group Incorporated",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "JNJ",
    name: "Johnson & Johnson",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "MRK",
    name: "Merck & Co., Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "ABBV",
    name: "AbbVie Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "PFE",
    name: "Pfizer Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "TMO",
    name: "Thermo Fisher Scientific Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "ABT",
    name: "Abbott Laboratories",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "AMGN",
    name: "Amgen Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },

  // Biens de consommation & Distribution
  {
    symbol: "WMT",
    name: "Walmart Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "PG",
    name: "Procter & Gamble Company",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "HD",
    name: "The Home Depot, Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "COST",
    name: "Costco Wholesale Corporation",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "KO",
    name: "The Coca-Cola Company",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "PEP",
    name: "PepsiCo, Inc.",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "MCD",
    name: "McDonald's Corporation",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "NKE",
    name: "NIKE, Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "DIS",
    name: "The Walt Disney Company",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "SBUX",
    name: "Starbucks Corporation",
    market: "US",
    currency: "USD",
    exchange: "NASDAQ",
  },

  // Industrie & Énergie
  {
    symbol: "XOM",
    name: "Exxon Mobil Corporation",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "CVX",
    name: "Chevron Corporation",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "CAT",
    name: "Caterpillar Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "BA",
    name: "The Boeing Company",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "UPS",
    name: "United Parcel Service, Inc.",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "RTX",
    name: "RTX Corporation",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },
  {
    symbol: "LMT",
    name: "Lockheed Martin Corporation",
    market: "US",
    currency: "USD",
    exchange: "NYSE",
  },

  // =================================================================
  // == Actions Européennes ==========================================
  // =================================================================

  // France (Euronext Paris)
  {
    symbol: "MC.PA",
    name: "LVMH Moët Hennessy Louis Vuitton",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "OR.PA",
    name: "L'Oréal S.A.",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "RMS.PA",
    name: "Hermès International",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "TTE.PA",
    name: "TotalEnergies SE",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "SAN.PA",
    name: "Sanofi",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "AIR.PA",
    name: "Airbus SE",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "SU.PA",
    name: "Schneider Electric S.E.",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "BNP.PA",
    name: "BNP Paribas",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "CS.PA",
    name: "AXA SA",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "EL.PA",
    name: "EssilorLuxottica",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "SAF.PA",
    name: "Safran SA",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Paris",
  },

  // Allemagne (XETRA)
  {
    symbol: "SAP.DE",
    name: "SAP SE",
    market: "EU",
    currency: "EUR",
    exchange: "XETRA",
  },
  {
    symbol: "SIE.DE",
    name: "Siemens AG",
    market: "EU",
    currency: "EUR",
    exchange: "XETRA",
  },
  {
    symbol: "MBG.DE",
    name: "Mercedes-Benz Group AG",
    market: "EU",
    currency: "EUR",
    exchange: "XETRA",
  },
  {
    symbol: "VOW3.DE",
    name: "Volkswagen AG",
    market: "EU",
    currency: "EUR",
    exchange: "XETRA",
  },
  {
    symbol: "ADS.DE",
    name: "Adidas AG",
    market: "EU",
    currency: "EUR",
    exchange: "XETRA",
  },

  // Pays-Bas (Euronext Amsterdam)
  {
    symbol: "ASML.AS",
    name: "ASML Holding N.V.",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Amsterdam",
  },
  {
    symbol: "INGA.AS",
    name: "ING Groep N.V.",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Amsterdam",
  },
  {
    symbol: "ADYEN.AS",
    name: "Adyen N.V.",
    market: "EU",
    currency: "EUR",
    exchange: "Euronext Amsterdam",
  },

  // Suisse (SIX Swiss Exchange)
  {
    symbol: "NESN.SW",
    name: "Nestlé S.A.",
    market: "CH",
    currency: "CHF",
    exchange: "SIX Swiss Exchange",
  },
  {
    symbol: "NOVN.SW",
    name: "Novartis AG",
    market: "CH",
    currency: "CHF",
    exchange: "SIX Swiss Exchange",
  },
  {
    symbol: "ROG.SW",
    name: "Roche Holding AG",
    market: "CH",
    currency: "CHF",
    exchange: "SIX Swiss Exchange",
  },
  {
    symbol: "UBSG.SW",
    name: "UBS Group AG",
    market: "CH",
    currency: "CHF",
    exchange: "SIX Swiss Exchange",
  },

  // Royaume-Uni (London Stock Exchange)
  {
    symbol: "SHEL.L",
    name: "Shell plc",
    market: "UK",
    currency: "GBP",
    exchange: "London Stock Exchange",
  },
  {
    symbol: "AZN.L",
    name: "AstraZeneca PLC",
    market: "UK",
    currency: "GBP",
    exchange: "London Stock Exchange",
  },
  {
    symbol: "HSBA.L",
    name: "HSBC Holdings plc",
    market: "UK",
    currency: "GBP",
    exchange: "London Stock Exchange",
  },
  {
    symbol: "ULVR.L",
    name: "Unilever PLC",
    market: "UK",
    currency: "GBP",
    exchange: "London Stock Exchange",
  },

  // Autres pays européens
  {
    symbol: "NOVO-B.CO",
    name: "Novo Nordisk A/S",
    market: "EU",
    currency: "DKK",
    exchange: "Copenhagen",
  },

  // =================================================================
  // == Actions Asiatiques ===========================================
  // =================================================================

  // Chine / Hong Kong
  {
    symbol: "0700.HK",
    name: "Tencent Holdings Limited",
    market: "Asia",
    currency: "HKD",
    exchange: "Hong Kong Stock Exchange",
  },
  {
    symbol: "9988.HK",
    name: "Alibaba Group Holding Limited",
    market: "Asia",
    currency: "HKD",
    exchange: "Hong Kong Stock Exchange",
  },
  {
    symbol: "1211.HK",
    name: "BYD Company Limited",
    market: "Asia",
    currency: "HKD",
    exchange: "Hong Kong Stock Exchange",
  },

  // Japon
  {
    symbol: "7203.T",
    name: "Toyota Motor Corporation",
    market: "Asia",
    currency: "JPY",
    exchange: "Tokyo Stock Exchange",
  },
  {
    symbol: "6758.T",
    name: "Sony Group Corporation",
    market: "Asia",
    currency: "JPY",
    exchange: "Tokyo Stock Exchange",
  },
  {
    symbol: "9984.T",
    name: "SoftBank Group Corp.",
    market: "Asia",
    currency: "JPY",
    exchange: "Tokyo Stock Exchange",
  },

  // Taiwan
  {
    symbol: "2330.TW",
    name: "TSMC (Taiwan Semiconductor)",
    market: "Asia",
    currency: "TWD",
    exchange: "Taiwan Stock Exchange",
  },

  // Corée du Sud
  {
    symbol: "005930.KS",
    name: "Samsung Electronics Co., Ltd.",
    market: "Asia",
    currency: "KRW",
    exchange: "Korea Exchange",
  },

  // =================================================================
  // == ETFs (Exchange-Traded Funds) =================================
  // =================================================================

  // ---- ETFs Européens (éligibles PEA - cotés sur Euronext Paris) ----
  // Indices Mondiaux
  {
    symbol: "CW8.PA",
    name: "Amundi MSCI World UCITS ETF (PEA)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "EWLD.PA",
    name: "iShares MSCI World UCITS ETF (PEA)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },

  // Indices Américains (S&P 500) - Tickers Yahoo Finance vérifiés
  {
    symbol: "SP5.PA",
    name: "Lyxor S&P 500 UCITS ETF (PEA)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "PSP5.PA",
    name: "Amundi PEA S&P 500 UCITS ETF (ISIN: FR0013412285)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },

  // Indices Américains (NASDAQ 100) - Tickers Yahoo Finance vérifiés
  {
    symbol: "QQQ.PA",
    name: "Lyxor NASDAQ-100 UCITS ETF (PEA)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },

  // Indices Européens
  {
    symbol: "C40.PA",
    name: "Lyxor CAC 40 (DR) UCITS ETF (PEA)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "E50.PA",
    name: "Lyxor EURO STOXX 50 (DR) UCITS ETF",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "ETZ.PA",
    name: "Amundi STOXX Europe 600 UCITS ETF",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },

  // Indices Marchés Émergents
  {
    symbol: "AEEM.PA",
    name: "Amundi MSCI Emerging Markets UCITS ETF (PEA)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "PAEEM.PA",
    name: "Lyxor PEA Emergent UCITS ETF",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },

  // ETFs Thématiques (PEA)
  {
    symbol: "WAT.PA",
    name: "Lyxor MSCI Water ESG Filtered UCITS ETF (PEA)",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },
  {
    symbol: "ELOW.PA",
    name: "BNP Paribas Easy Low Carbon 100 Europe PAB",
    market: "ETF",
    currency: "EUR",
    exchange: "Euronext Paris",
  },

  // ---- ETFs US (non éligibles PEA) ----
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "QQQ",
    name: "Invesco QQQ Trust (NASDAQ-100)",
    market: "ETF",
    currency: "USD",
    exchange: "NASDAQ",
  },
  {
    symbol: "DIA",
    name: "SPDR Dow Jones Industrial Average ETF",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "IWM",
    name: "iShares Russell 2000 ETF",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "VTI",
    name: "Vanguard Total Stock Market ETF",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "VEA",
    name: "Vanguard FTSE Developed Markets ETF",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "VWO",
    name: "Vanguard FTSE Emerging Markets ETF",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "GLD",
    name: "SPDR Gold Shares",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
  {
    symbol: "ARKK",
    name: "ARK Innovation ETF",
    market: "ETF",
    currency: "USD",
    exchange: "ARCA",
  },
];

// Fonction pour récupérer le prix via le serveur proxy
const fetchStockPrice = async (symbol: string): Promise<StockData | null> => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/price/${symbol}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.message || data.error);
    }

    // Trouver les informations de l'action dans notre catalogue
    const stockInfo = STOCK_CATALOG.find((s) => s.symbol === symbol);
    if (!stockInfo) {
      throw new Error(`Stock ${symbol} not found in catalog`);
    }

    return {
      ...stockInfo,
      price: data.price || null,
      marketState: data.marketState,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
};

// Fonction pour vérifier si le serveur proxy est disponible
const checkProxyServer = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/test`);
    return response.ok;
  } catch (error) {
    return false;
  }
};

// Initialisation de la base de données (pas besoin de faire quoi que ce soit)
export const initializeStockDatabase = async (): Promise<void> => {
  const isServerRunning = await checkProxyServer();

  if (!isServerRunning) {
    console.warn("⚠️ Yahoo Finance Proxy Server is not running!");
    console.warn("Please start the server with: node server.js");
  } else {
    console.log("✅ Yahoo Finance Proxy Server is available");
  }
};

// Recherche dans le catalogue statique
export const searchStocks = (query: string): StockInfo[] => {
  if (!query || query.length < 1) return [];

  const searchTerm = query.toLowerCase();

  return STOCK_CATALOG.filter(
    (stock) =>
      stock.symbol.toLowerCase().includes(searchTerm) ||
      stock.name.toLowerCase().includes(searchTerm)
  ).slice(0, 10); // Limiter à 10 résultats
};

// Obtenir le prix d'une action (avec cache)
export const getStockPrice = async (
  symbol: string
): Promise<StockData | null> => {
  const now = Date.now();

  // Vérifier le cache
  const cached = priceCache.get(symbol);
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  // Récupérer le prix depuis le serveur proxy
  const stockData = await fetchStockPrice(symbol);

  if (stockData) {
    // Mettre en cache
    priceCache.set(symbol, {
      data: stockData,
      timestamp: now,
    });
  }

  return stockData;
};

// Obtenir les informations d'une action sans prix
export const getStockBySymbol = (symbol: string): StockInfo | null => {
  return STOCK_CATALOG.find((stock) => stock.symbol === symbol) || null;
};

// Obtenir toutes les actions du catalogue
export const getAllStocks = (): StockInfo[] => {
  return [...STOCK_CATALOG];
};

// Statistiques de la base de données
export const getStockDatabaseStats = () => {
  return {
    totalStocks: STOCK_CATALOG.length,
    cachedPrices: priceCache.size,
    lastUpdate: new Date().toISOString(),
    source: "Yahoo Finance via Proxy Server",
    proxyUrl: PROXY_SERVER_URL,
  };
};

// Forcer la mise à jour d'un prix (ignorer le cache)
export const refreshStockPrice = async (
  symbol: string
): Promise<number | null> => {
  // Supprimer du cache
  priceCache.delete(symbol);

  // Récupérer le nouveau prix
  const stockData = await fetchStockPrice(symbol);

  if (stockData && stockData.price !== null) {
    // Mettre en cache
    priceCache.set(symbol, {
      data: stockData,
      timestamp: Date.now(),
    });

    return stockData.price;
  }

  return null;
};

// Nettoyer le cache
export const clearStockCache = (): void => {
  priceCache.clear();
};

// Récupérer plusieurs prix en une fois
export const getMultipleStockPrices = async (
  symbols: string[]
): Promise<Record<string, StockData | null>> => {
  const results: Record<string, StockData | null> = {};

  // Traiter en parallèle
  const promises = symbols.map(async (symbol) => {
    const stockData = await getStockPrice(symbol);
    results[symbol] = stockData;
  });

  await Promise.all(promises);
  return results;
};
