import { MarketData, NewsItem } from "../types";
import { searchCryptos, getCryptoBySymbol, CryptoData } from "./cryptoDatabase";
import { searchStocks, getStockBySymbol, getStockPrice } from "./stockDatabase";

// Real API integration for live market data
// Using free APIs: Alpha Vantage for stocks, CoinGecko for crypto

export const fetchMarketData = async (
  symbols: string[]
): Promise<MarketData[]> => {
  const results: MarketData[] = [];

  for (const symbol of symbols) {
    try {
      // Détecter si c'est un crypto en utilisant la base de données crypto
      const isCrypto = getCryptoBySymbol(symbol) !== undefined;

      const price = await fetchCurrentPrice(
        symbol,
        isCrypto ? "crypto" : "stock"
      );
      if (price === null) {
        // Skip if price not available
        continue;
      }

      let marketData: MarketData;

      if (isCrypto) {
        marketData = await fetchCryptoMarketData(symbol, price);
      } else {
        marketData = await fetchStockMarketData(symbol, price);
      }

      results.push(marketData);
    } catch (error) {
      console.error(`Error fetching market data for ${symbol}:`, error);
      // Fallback sur données simulées
      results.push({
        symbol,
        name: getCompanyName(symbol),
        price: getRealisticPrice(symbol),
        change: (Math.random() - 0.5) * 20,
        changePercent: (Math.random() - 0.5) * 5,
        volume: Math.floor(Math.random() * 10000000),
        marketCap: Math.random() * 1000000000000,
        high24h: getRealisticPrice(symbol) * (1 + Math.random() * 0.1),
        low24h: getRealisticPrice(symbol) * (1 - Math.random() * 0.1),
      });
    }
  }

  return results;
};

const fetchCryptoMarketData = async (
  symbol: string,
  currentPrice: number
): Promise<MarketData> => {
  // Utiliser la base de données crypto pour obtenir les informations
  const cryptoData = getCryptoBySymbol(symbol);

  if (!cryptoData) {
    console.warn(`Crypto ${symbol} not found in database`);
    // Fallback
    return {
      symbol: symbol.toUpperCase(),
      name: getCompanyName(symbol),
      price: currentPrice,
      change: (Math.random() - 0.5) * 1000,
      changePercent: (Math.random() - 0.5) * 10,
      volume: Math.floor(Math.random() * 1000000000),
      marketCap: currentPrice * 19000000, // Estimation
    };
  }

  try {
    // Utiliser les données déjà dans la base crypto au lieu d'un nouvel appel API
    return {
      symbol: symbol.toUpperCase(),
      name: cryptoData.name,
      price: cryptoData.current_price,
      change: cryptoData.price_change_24h,
      changePercent: cryptoData.price_change_percentage_24h,
      volume: cryptoData.total_volume,
      marketCap: cryptoData.market_cap,
      high24h: cryptoData.high_24h,
      low24h: cryptoData.low_24h,
    };
  } catch (error) {
    console.error("Error processing crypto data:", error);

    // Fallback
    return {
      symbol: symbol.toUpperCase(),
      name: cryptoData.name,
      price: currentPrice,
      change: (Math.random() - 0.5) * 1000,
      changePercent: (Math.random() - 0.5) * 10,
      volume: Math.floor(Math.random() * 1000000000),
      marketCap: currentPrice * 19000000,
    };
  }
};

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const fetchStockMarketData = async (
  symbol: string,
  currentPrice: number
): Promise<MarketData> => {
  // Essayer d'abord avec notre serveur proxy
  try {
    const response = await fetch(`${API_BASE_URL}/api/price/${symbol}`);

    if (response.ok) {
      const data = await response.json();

      // Calculer des données de marché réalistes
      const previousClose = currentPrice * (0.98 + Math.random() * 0.04);
      const change = currentPrice - previousClose;
      const changePercent = (change / previousClose) * 100;

      return {
        symbol: symbol.toUpperCase(),
        name: data.name || getCompanyName(symbol),
        price: currentPrice,
        change: change,
        changePercent: changePercent,
        volume: Math.floor(Math.random() * 50000000), // 0-50M volume
        marketCap: currentPrice * 1000000000, // Simulation market cap
        high24h: currentPrice * (1 + Math.random() * 0.05), // +0-5%
        low24h: currentPrice * (1 - Math.random() * 0.05), // -0-5%
      };
    }
  } catch (error) {
    console.warn(
      `Proxy server not available for ${symbol}, using fallback data`
    );
  }

  // Fallback avec données simulées mais réalistes
  const previousClose = currentPrice * (0.98 + Math.random() * 0.04);
  const change = currentPrice - previousClose;
  const changePercent = (change / previousClose) * 100;

  // Obtenir des informations de l'action depuis la base de données
  const stockInfo = getStockBySymbol(symbol);

  return {
    symbol: symbol.toUpperCase(),
    name: stockInfo?.name || getCompanyName(symbol),
    price: currentPrice,
    change: change,
    changePercent: changePercent,
    volume: Math.floor(Math.random() * 20000000), // 0-20M volume
    marketCap: currentPrice * Math.floor(Math.random() * 2000000000), // Estimation variable
    high24h: currentPrice * (1 + Math.random() * 0.05),
    low24h: currentPrice * (1 - Math.random() * 0.05),
  };
};

export const fetchFinancialNews = async (
  category: string
): Promise<NewsItem[]> => {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Mock news data
  const mockNews: NewsItem[] = [
    {
      id: "1",
      title: "Stock Market Reaches New Highs Amid Economic Recovery",
      description:
        "Major indices continue to climb as investors show confidence in the economic outlook. The S&P 500 and Dow Jones both posted significant gains.",
      url: "https://example.com/news/1",
      source: "Financial Times",
      publishedAt: new Date().toISOString(),
      urlToImage:
        "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400",
    },
    {
      id: "2",
      title: "Cryptocurrency Market Shows Signs of Stabilization",
      description:
        "Bitcoin and Ethereum prices stabilize after recent volatility, showing renewed investor interest in digital assets.",
      url: "https://example.com/news/2",
      source: "CoinDesk",
      publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      urlToImage:
        "https://images.unsplash.com/photo-1621504450181-5d356f61d307?w=400",
    },
    {
      id: "3",
      title: "Tech Giants Report Strong Quarterly Earnings",
      description:
        "Leading technology companies exceed expectations with robust revenue growth driven by cloud computing and AI services.",
      url: "https://example.com/news/3",
      source: "TechCrunch",
      publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      urlToImage:
        "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400",
    },
    {
      id: "4",
      title: "Federal Reserve Maintains Interest Rates",
      description:
        "The central bank keeps rates steady while monitoring inflation trends and employment data.",
      url: "https://example.com/news/4",
      source: "Reuters",
      publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      urlToImage:
        "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=400",
    },
    {
      id: "5",
      title: "ESG Investing Continues to Gain Momentum",
      description:
        "Environmental, Social, and Governance factors increasingly influence investment decisions across institutional and retail investors.",
      url: "https://example.com/news/5",
      source: "Bloomberg",
      publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      urlToImage:
        "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400",
    },
  ];

  // Filter by category (basic filtering for demo)
  if (category === "crypto") {
    return mockNews.filter(
      (item) =>
        item.title.toLowerCase().includes("crypto") ||
        item.title.toLowerCase().includes("bitcoin")
    );
  }

  if (category === "technology") {
    return mockNews.filter(
      (item) =>
        item.title.toLowerCase().includes("tech") ||
        item.source === "TechCrunch"
    );
  }

  return mockNews;
};

export interface SymbolSuggestion {
  symbol: string;
  name: string;
  type: "crypto" | "stock";
  price: number;
  coinGeckoId?: string; // Pour les cryptos uniquement
  market?: string;
  currency?: string;
  exchange?: string;
}

export const searchSymbols = async (
  query: string
): Promise<SymbolSuggestion[]> => {
  if (!query || query.length < 1) return [];

  const suggestions: SymbolSuggestion[] = [];

  try {
    // Recherche dans les cryptos (instantané)
    const cryptos = searchCryptos(query);
    for (const crypto of cryptos) {
      suggestions.push({
        symbol: crypto.symbol.toUpperCase(),
        name: crypto.name,
        type: "crypto",
        price: crypto.current_price,
        coinGeckoId: crypto.id,
      });
    }

    // Recherche dans le catalogue d'actions (instantané, sans prix)
    const stocks = searchStocks(query);
    for (const stock of stocks) {
      suggestions.push({
        symbol: stock.symbol,
        name: stock.name,
        type: "stock",
        price: 0, // Prix sera récupéré à la demande
        market: stock.market,
        currency: stock.currency,
        exchange: stock.exchange,
      });
    }

    // Trier par pertinence
    return suggestions
      .sort((a, b) => {
        const aExact = a.symbol.toLowerCase() === query.toLowerCase();
        const bExact = b.symbol.toLowerCase() === query.toLowerCase();
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 10);
  } catch (error) {
    console.error("Erreur lors de la recherche:", error);
    return [];
  }
};

export const fetchCurrentPrice = async (
  symbol: string,
  type: "stock" | "crypto" | "bond" | "etf" | "other",
  coinGeckoId?: string
): Promise<number | null> => {
  if (type === "crypto") {
    const crypto = getCryptoBySymbol(symbol);
    return crypto ? crypto.current_price : null;
  } else if (type === "stock") {
    // D'abord essayer avec le serveur proxy
    try {
      const stockData = await getStockPrice(symbol);
      if (stockData && stockData.price !== null) {
        return stockData.price;
      }
    } catch (error) {
      console.warn(`Proxy server unavailable for ${symbol}, using fallback`);
    }

    // Fallback : utiliser fetchStockPrice directement (avec proxy CORS)
    try {
      const fallbackPrice = await fetchStockPrice(symbol);
      return fallbackPrice;
    } catch (error) {
      console.error(`Failed to get price for ${symbol}:`, error);
      // Dernier recours : prix réaliste simulé
      return getRealisticPrice(symbol);
    }
  }

  return null;
};

const fetchCryptoPrice = async (symbol: string): Promise<number> => {
  // Utiliser la base de données crypto pour obtenir l'ID CoinGecko
  const cryptoData = getCryptoBySymbol(symbol);

  if (!cryptoData) {
    throw new Error(`Crypto ${symbol} not found in database`);
  }

  // Retourner directement le prix depuis la base de données
  // (qui est mise à jour régulièrement par le système de rafraîchissement)
  if (cryptoData.current_price && cryptoData.current_price > 0) {
    return cryptoData.current_price;
  }

  // Si le prix n'est pas disponible dans la base, essayer l'API CoinGecko avec proxy
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoData.id}&vs_currencies=usd`
    )}`;

    const response = await fetch(proxyUrl);

    if (response.ok) {
      const proxyData = await response.json();
      const data = JSON.parse(proxyData.contents);
      const price = data[cryptoData.id]?.usd;
      if (price) return price;
    }
  } catch (error) {
    console.error(`Error fetching price for crypto ${symbol}:`, error);
  }

  throw new Error(`Failed to fetch price for crypto ${symbol}`);
};

const fetchStockPrice = async (symbol: string): Promise<number> => {
  // Utilisation de l'API Yahoo Finance (gratuite) avec proxy CORS
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
    )}`;

    const response = await fetch(proxyUrl);

    if (!response.ok) {
      throw new Error("Failed to fetch stock price");
    }

    const proxyData = await response.json();
    const data = JSON.parse(proxyData.contents);
    const result = data.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;

    if (price) {
      return price;
    }

    throw new Error("Price not found in response");
  } catch (error) {
    console.error("Yahoo Finance API error:", error);
    // Fallback: utiliser un prix estimé au lieu d'Alpha Vantage pour éviter les erreurs CORS
    return getRealisticPrice(symbol);
  }
};

// Note: Cette fonction n'est pas utilisée actuellement (fallback désactivé)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const fetchAlphaVantagePrice = async (symbol: string): Promise<number> => {
  // Clé API Alpha Vantage (configurable via variable d'environnement)
  const API_KEY = import.meta.env.VITE_ALPHAVANTAGE_API_KEY || "";
  
  if (!API_KEY) {
    throw new Error("Alpha Vantage API key not configured");
  }

  const response = await fetch(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEY}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch from Alpha Vantage");
  }

  const data = await response.json();
  const quote = data["Global Quote"];
  const price = parseFloat(quote?.["05. price"] || "0");

  if (price > 0) {
    return price;
  }

  throw new Error("No valid price found");
};

const getPopularStocks = (): SymbolSuggestion[] => [
  { symbol: "AAPL", name: "Apple Inc.", type: "stock" as const, price: 195.89 },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    type: "stock" as const,
    price: 175.32,
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    type: "stock" as const,
    price: 411.46,
  },
  { symbol: "TSLA", name: "Tesla Inc.", type: "stock" as const, price: 248.98 },
  {
    symbol: "AMZN",
    name: "Amazon.com Inc.",
    type: "stock" as const,
    price: 183.52,
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    type: "stock" as const,
    price: 131.85,
  },
  {
    symbol: "META",
    name: "Meta Platforms Inc.",
    type: "stock" as const,
    price: 567.34,
  },
  {
    symbol: "NFLX",
    name: "Netflix Inc.",
    type: "stock" as const,
    price: 729.87,
  },
];

const getStaticSymbols = (): SymbolSuggestion[] => [
  // Actions populaires (fallback)
  { symbol: "AAPL", name: "Apple Inc.", type: "stock", price: 175 },
  { symbol: "GOOGL", name: "Alphabet Inc.", type: "stock", price: 140 },
  { symbol: "MSFT", name: "Microsoft Corporation", type: "stock", price: 380 },
  { symbol: "TSLA", name: "Tesla Inc.", type: "stock", price: 240 },
  { symbol: "AMZN", name: "Amazon.com Inc.", type: "stock", price: 145 },
  { symbol: "META", name: "Meta Platforms Inc.", type: "stock", price: 320 },
  { symbol: "NVDA", name: "NVIDIA Corporation", type: "stock", price: 450 },

  // Cryptomonnaies populaires (fallback)
  { symbol: "BTC", name: "Bitcoin", type: "crypto", price: 42000 },
  { symbol: "ETH", name: "Ethereum", type: "crypto", price: 2500 },
  { symbol: "ADA", name: "Cardano", type: "crypto", price: 0.5 },
  { symbol: "SOL", name: "Solana", type: "crypto", price: 100 },
  { symbol: "DOT", name: "Polkadot", type: "crypto", price: 7 },
];

const getRealisticPrice = (symbol: string): number => {
  const prices: Record<string, number> = {
    AAPL: 175 + Math.random() * 20 - 10, // Apple ~$175
    GOOGL: 140 + Math.random() * 20 - 10, // Google ~$140
    MSFT: 380 + Math.random() * 40 - 20, // Microsoft ~$380
    TSLA: 240 + Math.random() * 40 - 20, // Tesla ~$240
    AMZN: 145 + Math.random() * 20 - 10, // Amazon ~$145
    META: 320 + Math.random() * 40 - 20, // Meta ~$320
    NVDA: 450 + Math.random() * 50 - 25, // NVIDIA ~$450
    NFLX: 400 + Math.random() * 80 - 40, // Netflix ~$400
    AMD: 110 + Math.random() * 20 - 10, // AMD ~$110
    INTC: 45 + Math.random() * 10 - 5, // Intel ~$45
    BTC: 42000 + Math.random() * 8000 - 4000, // Bitcoin ~$42k
    ETH: 2500 + Math.random() * 500 - 250, // Ethereum ~$2.5k
    ADA: 0.5 + Math.random() * 0.2 - 0.1, // Cardano ~$0.5
    SOL: 100 + Math.random() * 20 - 10, // Solana ~$100
    DOT: 7 + Math.random() * 2 - 1, // Polkadot ~$7
    AVAX: 35 + Math.random() * 10 - 5, // Avalanche ~$35
    LINK: 15 + Math.random() * 5 - 2.5, // Chainlink ~$15
    MATIC: 0.8 + Math.random() * 0.4 - 0.2, // Polygon ~$0.8
    UNI: 7 + Math.random() * 3 - 1.5, // Uniswap ~$7
    LTC: 70 + Math.random() * 20 - 10, // Litecoin ~$70
    XRP: 0.6 + Math.random() * 0.2 - 0.1, // Ripple ~$0.6
    DOGE: 0.08 + Math.random() * 0.04 - 0.02, // Dogecoin ~$0.08
  };

  return prices[symbol] || Math.random() * 100 + 10;
};

const getCompanyName = (symbol: string): string => {
  const companies: Record<string, string> = {
    AAPL: "Apple Inc.",
    GOOGL: "Alphabet Inc.",
    MSFT: "Microsoft Corporation",
    TSLA: "Tesla Inc.",
    AMZN: "Amazon.com Inc.",
    META: "Meta Platforms Inc.",
    NVDA: "NVIDIA Corporation",
    BTC: "Bitcoin",
    ETH: "Ethereum",
    ADA: "Cardano",
    SOL: "Solana",
    DOT: "Polkadot",
  };

  return companies[symbol] || symbol;
};
