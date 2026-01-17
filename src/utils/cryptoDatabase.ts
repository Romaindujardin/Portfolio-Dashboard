// Base de données des cryptomonnaies avec CoinGecko API
// Mise à jour manuelle seulement - contrôlée par priceUpdateManager

export interface CryptoData {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  fully_diluted_valuation?: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_change_24h: number;
  market_cap_change_percentage_24h: number;
  circulating_supply: number;
  total_supply?: number;
  max_supply?: number;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  roi?: {
    times: number;
    currency: string;
    percentage: number;
  };
  last_updated: string;
}

// Cache local des données crypto
let cryptoCache: CryptoData[] = [];
let lastUpdateTime = 0;

// Fonction pour récupérer les données depuis CoinGecko
export const fetchCryptoDatabase = async (): Promise<CryptoData[]> => {
  try {
    console.log("🔄 Récupération des données crypto depuis CoinGecko...");

    // Récupérer les top 1000 cryptos avec toutes les données
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=1000&page=1&sparkline=false&price_change_percentage=24h`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    // Valider et nettoyer les données
    const validCryptos = data.filter(
      (crypto: any) =>
        crypto.id &&
        crypto.symbol &&
        crypto.name &&
        crypto.current_price !== null
    );

    console.log(
      `✅ ${validCryptos.length} cryptomonnaies récupérées avec succès`
    );
    return validCryptos;
  } catch (error) {
    console.error("❌ Erreur lors de la récupération des cryptos:", error);

    // En cas d'erreur, retourner des données de base
    return getBasicCryptos();
  }
};

// Fonction pour initialiser la base de données (une seule fois)
export const initializeCryptoDatabase = async (): Promise<void> => {
  // Charger les données au démarrage seulement
  await updateCryptoDatabase();

  console.log(
    "🚀 Base de données crypto initialisée - mises à jour contrôlées par priceUpdateManager"
  );
};

// Fonction pour mettre à jour la base de données (appelée manuellement)
export const updateCryptoDatabase = async (): Promise<void> => {
  const now = Date.now();

  try {
    const freshData = await fetchCryptoDatabase();
    cryptoCache = freshData;
    lastUpdateTime = now;

    console.log(
      `🔄 Base de données crypto mise à jour: ${cryptoCache.length} cryptos`
    );
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour crypto:", error);
  }
};

// Fonction pour rechercher dans la base locale
export const searchCryptos = (query: string): CryptoData[] => {
  if (!query || query.length < 1) return [];

  const normalizedQuery = query.toLowerCase();

  return cryptoCache
    .filter(
      (crypto) =>
        crypto.symbol.toLowerCase().includes(normalizedQuery) ||
        crypto.name.toLowerCase().includes(normalizedQuery)
    )
    .sort((a, b) => a.market_cap_rank - b.market_cap_rank) // Trier par rang de market cap
    .slice(0, 10); // Limiter à 10 résultats
};

// Fonction pour obtenir une crypto par symbole ou nom
export const getCryptoBySymbol = (symbol: string): CryptoData | undefined => {
  // D'abord chercher par symbole exact
  let crypto = cryptoCache.find(
    (crypto) => crypto.symbol.toLowerCase() === symbol.toLowerCase()
  );

  // Si pas trouvé, chercher par nom
  if (!crypto) {
    crypto = cryptoCache.find(
      (crypto) =>
        crypto.name.toLowerCase().includes(symbol.toLowerCase()) ||
        symbol.toLowerCase().includes(crypto.name.toLowerCase())
    );
  }

  // Si toujours pas trouvé, chercher par symbole partiel
  if (!crypto) {
    crypto = cryptoCache.find(
      (crypto) =>
        crypto.symbol.toLowerCase().includes(symbol.toLowerCase()) ||
        symbol.toLowerCase().includes(crypto.symbol.toLowerCase())
    );
  }

  return crypto;
};

// Fonction pour obtenir une crypto par ID CoinGecko
export const getCryptoById = (id: string): CryptoData | undefined => {
  return cryptoCache.find((crypto) => crypto.id === id);
};

// Fonction pour obtenir les top cryptos
export const getTopCryptos = (limit: number = 50): CryptoData[] => {
  return cryptoCache
    .filter((crypto) => crypto.market_cap_rank <= limit)
    .sort((a, b) => a.market_cap_rank - b.market_cap_rank);
};

// Fonction pour obtenir toutes les cryptos en cache
export const getAllCryptos = (): CryptoData[] => {
  return [...cryptoCache];
};

// Fonction pour obtenir les statistiques de la base
export const getDatabaseStats = () => {
  return {
    totalCryptos: cryptoCache.length,
    lastUpdate: new Date(lastUpdateTime).toLocaleString(),
    lastUpdateTime: lastUpdateTime,
    isUpdated: cryptoCache.length > 0,
  };
};

// Données de base en cas d'erreur réseau
const getBasicCryptos = (): CryptoData[] => [
  {
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    image: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
    current_price: 97000,
    market_cap: 1920000000000,
    market_cap_rank: 1,
    fully_diluted_valuation: 2030000000000,
    total_volume: 45000000000,
    high_24h: 98000,
    low_24h: 95000,
    price_change_24h: 2400,
    price_change_percentage_24h: 2.5,
    market_cap_change_24h: 48000000000,
    market_cap_change_percentage_24h: 2.6,
    circulating_supply: 19800000,
    total_supply: 19800000,
    max_supply: 21000000,
    ath: 108135,
    ath_change_percentage: -10.3,
    ath_date: "2024-03-14T07:10:36.635Z",
    atl: 67.81,
    atl_change_percentage: 143000.8,
    atl_date: "2013-07-06T00:00:00.000Z",
    last_updated: new Date().toISOString(),
  },
  {
    id: "ethereum",
    symbol: "eth",
    name: "Ethereum",
    image: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    current_price: 3800,
    market_cap: 460000000000,
    market_cap_rank: 2,
    fully_diluted_valuation: 460000000000,
    total_volume: 25000000000,
    high_24h: 3850,
    low_24h: 3720,
    price_change_24h: 67,
    price_change_percentage_24h: 1.8,
    market_cap_change_24h: 8100000000,
    market_cap_change_percentage_24h: 1.8,
    circulating_supply: 120000000,
    total_supply: 120000000,
    ath: 4878.26,
    ath_change_percentage: -22.1,
    ath_date: "2021-11-10T14:24:19.604Z",
    atl: 0.432979,
    atl_change_percentage: 878000.2,
    atl_date: "2015-10-20T00:00:00.000Z",
    last_updated: new Date().toISOString(),
  },
  {
    id: "solana",
    symbol: "sol",
    name: "Solana",
    image: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
    current_price: 240,
    market_cap: 115000000000,
    market_cap_rank: 4,
    fully_diluted_valuation: 140000000000,
    total_volume: 8000000000,
    high_24h: 245,
    low_24h: 232,
    price_change_24h: 7.5,
    price_change_percentage_24h: 3.2,
    market_cap_change_24h: 3600000000,
    market_cap_change_percentage_24h: 3.2,
    circulating_supply: 480000000,
    total_supply: 580000000,
    ath: 259.96,
    ath_change_percentage: -7.7,
    ath_date: "2024-11-23T16:05:38.250Z",
    atl: 0.500801,
    atl_change_percentage: 47844.5,
    atl_date: "2020-05-11T19:35:23.449Z",
    last_updated: new Date().toISOString(),
  },
  {
    id: "binancecoin",
    symbol: "bnb",
    name: "BNB",
    image:
      "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
    current_price: 710,
    market_cap: 103000000000,
    market_cap_rank: 5,
    fully_diluted_valuation: 142000000000,
    total_volume: 2000000000,
    high_24h: 720,
    low_24h: 700,
    price_change_24h: 8.4,
    price_change_percentage_24h: 1.2,
    market_cap_change_24h: 1200000000,
    market_cap_change_percentage_24h: 1.2,
    circulating_supply: 145000000,
    total_supply: 145000000,
    max_supply: 200000000,
    ath: 720.67,
    ath_change_percentage: -1.5,
    ath_date: "2024-12-04T08:30:00.000Z",
    atl: 0.0398177,
    atl_change_percentage: 1783000.3,
    atl_date: "2017-10-19T00:00:00.000Z",
    last_updated: new Date().toISOString(),
  },
  {
    id: "xrp",
    symbol: "xrp",
    name: "XRP",
    image:
      "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
    current_price: 2.8,
    market_cap: 160000000000,
    market_cap_rank: 7,
    fully_diluted_valuation: 280000000000,
    total_volume: 12000000000,
    high_24h: 2.95,
    low_24h: 2.64,
    price_change_24h: 0.15,
    price_change_percentage_24h: 5.8,
    market_cap_change_24h: 8800000000,
    market_cap_change_percentage_24h: 5.8,
    circulating_supply: 57000000000,
    total_supply: 99988000000,
    max_supply: 100000000000,
    ath: 3.4,
    ath_change_percentage: -17.6,
    ath_date: "2018-01-07T00:00:00.000Z",
    atl: 0.00268621,
    atl_change_percentage: 104000.2,
    atl_date: "2014-05-22T00:00:00.000Z",
    last_updated: new Date().toISOString(),
  },
];

// Fonction pour forcer une mise à jour manuelle
export const forceUpdateDatabase = async (): Promise<void> => {
  lastUpdateTime = 0; // Reset pour forcer la mise à jour
  await updateCryptoDatabase();
};

// Fonction pour rafraîchir le prix d'une crypto spécifique (appelée manuellement)
export const refreshCryptoPrice = async (
  symbol: string
): Promise<number | null> => {
  console.log(`🔄 Tentative de rafraîchissement du prix pour ${symbol}...`);

  try {
    // Trouver la crypto dans notre base de données pour obtenir l'ID CoinGecko
    const crypto = cryptoCache.find(
      (c) => c.symbol.toLowerCase() === symbol.toLowerCase()
    );

    if (!crypto) {
      console.warn(`⚠️ Crypto ${symbol} non trouvée dans la base de données`);
      return null;
    }

    // Utiliser l'API CoinGecko pour obtenir le prix actuel
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${crypto.id}&vs_currencies=usd&include_24hr_change=true`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const priceData = data[crypto.id];

    if (priceData && priceData.usd) {
      const newPrice = priceData.usd;
      const change24h = priceData.usd_24h_change || 0;

      // Mettre à jour dans la base de données locale
      const cryptoIndex = cryptoCache.findIndex((c) => c.id === crypto.id);
      if (cryptoIndex !== -1) {
        cryptoCache[cryptoIndex] = {
          ...cryptoCache[cryptoIndex],
          current_price: newPrice,
          price_change_percentage_24h: change24h,
          last_updated: new Date().toISOString(),
        };
      }

      console.log(`✅ Prix rafraîchi pour ${symbol}: $${newPrice}`);
      return newPrice;
    }
  } catch (error) {
    console.warn(`⚠️ Impossible de rafraîchir le prix pour ${symbol}:`, error);
  }

  return null;
};
