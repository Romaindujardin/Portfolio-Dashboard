// Service de gestion et synchronisation des cryptomonnaies (inspiré de Picsou).
// Supporte :
//  - Binance (CEX) via HMAC-SHA256
//  - EVM multi-chain fan-out via PublicNode RPCs gratuits
//  - Bitcoin via Blockstream Esplora
//  - Solana via RPC public
//  - Saisie manuelle / Cold storage
//  - Cotations EUR en direct via CoinGecko & Binance

import crypto from "crypto";
import { nowIso, round2 } from "../lib/validate.js";
import { decryptJson } from "../lib/secrets.js";
import { getUserSecret, setUserSecret } from "./userSecretsService.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const BINANCE_BASE = "https://api.binance.com";
const TIMEOUT_MS = 15000;

/**
 * Erreur de récupération crypto. Elle est levée AVANT toute écriture afin de
 * ne jamais remplacer des positions existantes par un résultat partiel.
 */
export class CryptoFetchError extends Error {
  constructor(message, { code = "CRYPTO_FETCH_FAILED", details = null } = {}) {
    super(message);
    this.name = "CryptoFetchError";
    this.status = 502;
    this.code = code;
    this.details = details;
  }
}

// Certains cours peuvent manquer temporairement : les stablecoins restent
// valorisés avec une approximation prudente plutôt qu'à zéro.
const STABLECOIN_EUR_FALLBACK = {
  USDT: 0.92,
  USDC: 0.92,
  DAI: 0.92,
  SUSD: 0.92,
  EURC: 1,
};

/**
 * Vérifie que chaque position détenue possède un cours exploitable.
 * Un cours manquant ne doit jamais faire disparaître une position.
 */
const requireQuotes = (symbols, quotes, { context, fallbacks = {} } = {}) => {
  const resolved = { ...(quotes || {}) };
  const missing = [];
  for (const symbol of symbols) {
    const current = Number(resolved[symbol]);
    if (Number.isFinite(current) && current > 0) continue;
    const fallback = Number(fallbacks[symbol]);
    if (Number.isFinite(fallback) && fallback > 0) {
      resolved[symbol] = fallback;
      continue;
    }
    missing.push(symbol);
  }
  if (missing.length > 0) {
    throw new CryptoFetchError(
      `Cours indisponibles pour ${missing.join(", ")} (${context}). ` +
        "Synchronisation annulée pour préserver les positions existantes.",
      {
        code: "CRYPTO_QUOTES_UNAVAILABLE",
        details: { context, missing },
      },
    );
  }
  return resolved;
};

// Mapping des symboles courants vers l'identifiant CoinGecko
const COINGECKO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOGE: "dogecoin",
  DOT: "polkadot",
  LINK: "chainlink",
  POL: "matic-network",
  MATIC: "matic-network",
  NEAR: "near",
  SUI: "sui",
  ATOM: "cosmos",
  USDT: "tether",
  USDC: "usd-coin",
  EURC: "euro-coin",
  DAI: "dai",
  SHIB: "shiba-inu",
  UNI: "uniswap",
  LTC: "litecoin",
  APT: "aptos",
  RENDER: "render-token",
  PEPE: "pepe",
  FET: "artificial-superintelligence-alliance",
  HYPE: "hyperliquid",
  LEOX: "galileo-protocol",
  MNT: "mantle",
  ARB: "arbitrum",
  OP: "optimism",
  CAKE: "pancakeswap-token",
  AERO: "aerodrome-finance",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  SUSD: "nusd",
};

const BALANCE_OF_SELECTOR = "0x70a08231";

function padAddress(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

// RPCs EVM sans clé API (PublicNode) avec jetons ERC-20 / BEP-20 vérifiés (méthode Picsou)
export const EVM_NETWORKS = [
  {
    name: "Ethereum",
    symbol: "ETH",
    rpc: "https://ethereum-rpc.publicnode.com",
    tokens: [
      { ticker: "USDT", name: "Tether USD", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { ticker: "USDC", name: "USD Coin", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { ticker: "DAI", name: "Dai Stablecoin", contract: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
      { ticker: "EURC", name: "Euro Coin", contract: "0x1aBaEA1f7C25db8950e2517C62971B6570672523", decimals: 6 },
      { ticker: "WBTC", name: "Wrapped BTC", contract: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
      { ticker: "LINK", name: "Chainlink", contract: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
      { ticker: "UNI", name: "Uniswap", contract: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
      { ticker: "SHIB", name: "Shiba Inu", contract: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18 },
      { ticker: "PEPE", name: "Pepe", contract: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 },
      { ticker: "LEOX", name: "Galileo Protocol", contract: "0xa444ec96ee01bb219a44b285de47bf33c3447ad5", decimals: 18 },
      { ticker: "MNT", name: "Mantle", contract: "0x3c3a81e81dc49a522a592e7622a7e711c06bf354", decimals: 18 },
      { ticker: "SUSD", name: "Synthetix sUSD", contract: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51", decimals: 18 },
      { ticker: "DYDX", name: "dYdX", contract: "0x92D6C1e31e145C379c816E2Be224282e8CC3579C", decimals: 18 },
    ],
  },
  {
    name: "BNB Chain",
    symbol: "BNB",
    rpc: "https://bsc-rpc.publicnode.com",
    tokens: [
      { ticker: "USDT", name: "Tether USD", contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { ticker: "USDC", name: "USD Coin", contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      { ticker: "DAI", name: "Dai Stablecoin", contract: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", decimals: 18 },
      { ticker: "CAKE", name: "PancakeSwap", contract: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18 },
    ],
  },
  {
    name: "Polygon",
    symbol: "POL",
    rpc: "https://polygon-bor-rpc.publicnode.com",
    tokens: [
      { ticker: "USDT", name: "Tether USD", contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      { ticker: "USDC", name: "USD Coin", contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
      { ticker: "USDC", name: "Bridged USDC", contract: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
      { ticker: "DAI", name: "Dai Stablecoin", contract: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18 },
      { ticker: "WETH", name: "Wrapped Ether", contract: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
      { ticker: "LEOX", name: "Galileo Protocol", contract: "0x925f63901b045e032B70940733a1e1DE22A1E29a", decimals: 18 },
    ],
  },
  {
    name: "Arbitrum",
    symbol: "ETH",
    rpc: "https://arbitrum-one-rpc.publicnode.com",
    tokens: [
      { ticker: "USDC", name: "USD Coin", contract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      { ticker: "USDC", name: "Bridged USDC", contract: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },
      { ticker: "USDT", name: "Tether USD", contract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      { ticker: "ARB", name: "Arbitrum", contract: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
    ],
  },
  {
    name: "Base",
    symbol: "ETH",
    rpc: "https://base-rpc.publicnode.com",
    tokens: [
      { ticker: "USDC", name: "USD Coin", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { ticker: "AERO", name: "Aerodrome", contract: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
      { ticker: "EURC", name: "Euro Coin", contract: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", decimals: 6 },
    ],
  },
  {
    name: "Optimism",
    symbol: "ETH",
    rpc: "https://optimism-rpc.publicnode.com",
    tokens: [
      { ticker: "USDC", name: "USD Coin", contract: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
      { ticker: "USDC", name: "Bridged USDC", contract: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", decimals: 6 },
      { ticker: "USDT", name: "Tether USD", contract: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
      { ticker: "OP", name: "Optimism", contract: "0x4200000000000000000000000000000000000042", decimals: 18 },
      { ticker: "SUSD", name: "Synthetix sUSD", contract: "0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9", decimals: 18 },
    ],
  },
  {
    name: "Avalanche",
    symbol: "AVAX",
    rpc: "https://avalanche-c-chain-rpc.publicnode.com",
    tokens: [
      { ticker: "USDC", name: "USD Coin", contract: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
      { ticker: "USDT", name: "Tether USD", contract: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
    ],
  },
  {
    name: "Mantle",
    symbol: "MNT",
    rpc: "https://rpc.mantle.xyz",
    tokens: [
      { ticker: "USDT", name: "Tether USD", contract: "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE", decimals: 6 },
      { ticker: "USDC", name: "USD Coin", contract: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", decimals: 6 },
    ],
  },
];

const fetchWithTimeout = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Erreur réseau ${res.status} sur ${url}`);
  }
  return res.json();
};

let coinGeckoRateLimitedUntil = 0;

/**
 * Récupère les cours en EUR pour une liste de symboles crypto.
 * Utilise CoinGecko en priorité (avec cooldown 429 comme Picsou), avec fallback sur Binance EUR.
 */
export async function fetchCryptoQuotes(symbols = []) {
  const uniqueSymbols = Array.from(
    new Set(symbols.map((s) => String(s || "").toUpperCase().trim())),
  ).filter(Boolean);

  if (uniqueSymbols.length === 0) return {};

  const quotes = {};

  // 1. Tenter CoinGecko si pas en cooldown 429
  if (Date.now() >= coinGeckoRateLimitedUntil) {
    try {
      const ids = uniqueSymbols
        .map((s) => COINGECKO_IDS[s])
        .filter(Boolean);

      if (ids.length > 0) {
        const url = `${COINGECKO_BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=eur`;
        const data = await fetchWithTimeout(url, {
          headers: { Accept: "application/json" },
        });

        for (const sym of uniqueSymbols) {
          const id = COINGECKO_IDS[sym];
          if (id && data[id]?.eur) {
            quotes[sym] = Number(data[id].eur);
          }
        }
      }
    } catch (err) {
      if (err.message && err.message.includes("429")) {
        coinGeckoRateLimitedUntil = Date.now() + 60000;
        console.warn("⚠️ CoinGecko 429 (rate limit). Cooldown de 60s activé, bascule sur Binance.");
      } else {
        console.warn("⚠️ CoinGecko indisponible pour les quotes, tentative Binance:", err.message);
      }
    }
  }

  // 2. Pour les symboles manquants, interroger Binance
  const missing = uniqueSymbols.filter((s) => !quotes[s]);
  if (missing.length > 0) {
    let eurUsdt = 1;
    try {
      const eurData = await fetchWithTimeout(`${BINANCE_BASE}/api/v3/ticker/price?symbol=EURUSDT`);
      const parsed = parseFloat(eurData.price);
      if (parsed > 0) eurUsdt = parsed;
    } catch {
      // Ignorer
    }

    await Promise.all(
      missing.map(async (symbol) => {
        // Tenter paire direct EUR
        try {
          const direct = await fetchWithTimeout(
            `${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}EUR`,
          );
          if (direct.price) {
            quotes[symbol] = parseFloat(direct.price);
            return;
          }
        } catch {}

        // Tenter paire USDT
        try {
          const usdt = await fetchWithTimeout(
            `${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}USDT`,
          );
          if (usdt.price) {
            quotes[symbol] = parseFloat(usdt.price) / eurUsdt;
          }
        } catch {}
      }),
    );
  }

  // Stablecoins EUR fixés par défaut à 1
  if (uniqueSymbols.includes("EURC") && !quotes["EURC"]) quotes["EURC"] = 1.0;

  return quotes;
}

/**
 * Récupère les positions d'un compte Binance via clé API et Secret.
 */
export async function fetchBinanceHoldings({ apiKey, apiSecret }) {
  if (!apiKey || !apiSecret) {
    throw new CryptoFetchError(
      "Clé API et Clé Secrète Binance requises. Synchronisation annulée.",
      { code: "CRYPTO_BINANCE_KEYS_MISSING" },
    );
  }

  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");

  const url = `${BINANCE_BASE}/api/v3/account?${queryString}&signature=${signature}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new CryptoFetchError(
      `Binance injoignable : ${error.message}. Synchronisation annulée.`,
      { code: "CRYPTO_BINANCE_NETWORK" },
    );
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new CryptoFetchError(
      `Erreur Binance API (${response.status}) : ${errText || "réponse vide"}. ` +
        "Synchronisation annulée.",
      {
        code: "CRYPTO_BINANCE_API_ERROR",
        details: { status: response.status },
      },
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new CryptoFetchError(
      `Réponse Binance illisible : ${error.message}. Synchronisation annulée.`,
      { code: "CRYPTO_BINANCE_INVALID_JSON" },
    );
  }
  if (!Array.isArray(data.balances)) {
    throw new CryptoFetchError(
      "Réponse Binance invalide : liste de soldes absente. Synchronisation annulée.",
      { code: "CRYPTO_BINANCE_INVALID_RESPONSE" },
    );
  }
  const balances = [];
  for (const b of data.balances) {
    const symbol = String(b.asset || "").toUpperCase();
    const quantity = parseFloat(b.free) + parseFloat(b.locked);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new CryptoFetchError(
        `Solde Binance invalide pour ${symbol || "un actif"}. Synchronisation annulée.`,
        { code: "CRYPTO_BINANCE_INVALID_BALANCE" },
      );
    }
    if (symbol && quantity > 0.00000001) {
      balances.push({ symbol, quantity });
    }
  }

  if (balances.length === 0) return [];

  // Prix en direct : un cours manquant annule la synchronisation.
  const symbols = balances.map((b) => b.symbol);
  const quotes = requireQuotes(
    symbols,
    await fetchCryptoQuotes(symbols),
    { context: "Binance", fallbacks: STABLECOIN_EUR_FALLBACK },
  );

  return balances
    .map((b) => {
      const price = Number(quotes[b.symbol]);
      return {
        ticker: b.symbol,
        name: b.symbol,
        quantity: b.quantity,
        price,
        value: round2(b.quantity * price),
      };
    })
    .filter((h) => h.value > 0.05); // Filtre les poussières (< 5 centimes)
}

/**
 * Récupère les soldes d'une adresse EVM (fan-out multi-chain PublicNode avec requêtes par lot).
 * Détecte les jetons natifs (ETH, BNB, POL, AVAX, MNT) ainsi que l'ensemble des jetons ERC-20 / BEP-20 configurés.
 */
export async function fetchEvmHoldings(address) {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
    throw new Error("Adresse EVM invalide (format 0x... attendu)");
  }

  const cleanAddr = address.trim();
  const pad = padAddress(cleanAddr);
  const aggregated = {}; // symbol -> { quantity, name }
  const failedNetworks = [];

  await Promise.allSettled(
    EVM_NETWORKS.map(async (net) => {
      try {
        const calls = [
          { jsonrpc: "2.0", id: 0, method: "eth_getBalance", params: [cleanAddr, "latest"] },
          ...net.tokens.map((tok, idx) => ({
            jsonrpc: "2.0",
            id: idx + 1,
            method: "eth_call",
            params: [{ to: tok.contract, data: BALANCE_OF_SELECTOR + pad }, "latest"],
          })),
        ];

        const res = await fetch(net.rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(calls),
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("réponse JSON-RPC invalide");
        const rpcError = data.find((item) => item?.error);
        if (rpcError) {
          throw new Error(
            rpcError.error?.message || "erreur JSON-RPC renvoyée par le nœud",
          );
        }
        const resultsById = new Map(
          data
            .filter((item) => item && typeof item.id === "number")
            .map((item) => [item.id, item]),
        );
        const parseQuantity = (value, label) => {
          if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
            throw new Error(`réponse JSON-RPC invalide pour ${label}`);
          }
          return value === "0x" ? 0n : BigInt(value);
        };

        const native = resultsById.get(0);
        if (!native || typeof native.result !== "string") {
          throw new Error("réponse JSON-RPC incomplète (solde natif)");
        }
        const nativeBalance = parseQuantity(native.result, net.symbol);
        const bal = Number(nativeBalance) / 1e18;
        if (bal > 0.00001) {
          if (!aggregated[net.symbol]) {
            aggregated[net.symbol] = { quantity: 0, name: net.symbol };
          }
          aggregated[net.symbol].quantity += bal;
        }

        for (const [index, tok] of net.tokens.entries()) {
          const item = resultsById.get(index + 1);
          if (!item || typeof item.result !== "string") {
            throw new Error(`réponse JSON-RPC incomplète pour ${tok.ticker}`);
          }
          const raw = parseQuantity(item.result, tok.ticker);
          const val = Number(raw) / Math.pow(10, tok.decimals);
          if (val > 0.00001) {
            if (!aggregated[tok.ticker]) {
              aggregated[tok.ticker] = { quantity: 0, name: tok.name };
            }
            aggregated[tok.ticker].quantity += val;
          }
        }
      } catch (error) {
        // Une chaîne en échec rend le résultat partiel : on annulera la
        // synchronisation complète plutôt que de supprimer ses positions.
        failedNetworks.push(`${net.name}: ${error.message}`);
      }
    }),
  );

  if (failedNetworks.length > 0) {
    throw new CryptoFetchError(
      `Récupération EVM incomplète (${failedNetworks.length}/${EVM_NETWORKS.length} réseau(x) en échec). ` +
        "Synchronisation annulée pour préserver les positions existantes.",
      {
        code: "CRYPTO_EVM_PARTIAL",
        details: { failedNetworks },
      },
    );
  }

  const symbols = Object.keys(aggregated);
  if (symbols.length === 0) return [];

  const quotes = requireQuotes(
    symbols,
    await fetchCryptoQuotes(symbols),
    { context: "EVM", fallbacks: STABLECOIN_EUR_FALLBACK },
  );

  return symbols
    .map((symbol) => {
      const { quantity, name } = aggregated[symbol];
      const price = Number(quotes[symbol]);
      return {
        ticker: symbol,
        name,
        quantity,
        price,
        value: round2(quantity * price),
      };
    })
    .filter((h) => h.value >= 0.05); // Filtre les poussières (< 5 centimes)
}

/**
 * Récupère les soldes d'un compte Hyperliquid L1 (Spot, Perps margin et jetons natifs).
 */
export async function fetchHyperliquidHoldings(address) {
  if (!address) return [];
  const cleanAddr = address.trim();

  const [spotRes, midsRes, metaRes] = await Promise.all([
    fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotClearinghouseState", user: cleanAddr }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  ]);

  if (!spotRes?.ok || !midsRes?.ok || !metaRes?.ok) {
    throw new CryptoFetchError(
      "API Hyperliquid indisponible. Synchronisation annulée pour préserver les positions existantes.",
      {
        code: "CRYPTO_HYPERLIQUID_UNAVAILABLE",
        details: {
          spot: spotRes?.status ?? null,
          mids: midsRes?.status ?? null,
          meta: metaRes?.status ?? null,
        },
      },
    );
  }

  const spotData = await spotRes.json();
  const mids = await midsRes.json();
  const meta = await metaRes.json();
  if (
    !Array.isArray(spotData?.balances) ||
    !mids ||
    typeof mids !== "object" ||
    Array.isArray(mids) ||
    !Array.isArray(meta) ||
    !Array.isArray(meta?.[0]?.tokens) ||
    !Array.isArray(meta?.[1])
  ) {
    throw new CryptoFetchError(
      "Réponse Hyperliquid invalide. Synchronisation annulée pour préserver les positions existantes.",
      { code: "CRYPTO_HYPERLIQUID_INVALID_RESPONSE" },
    );
  }
  const tokens = meta[0].tokens;
  const ctxs = meta[1];

  const rawHoldings = [];
  for (const b of spotData.balances) {
    const qty = parseFloat(b.total || 0);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new CryptoFetchError(
        `Solde Hyperliquid invalide pour ${b.coin || "un actif"}. Synchronisation annulée.`,
        { code: "CRYPTO_HYPERLIQUID_INVALID_BALANCE" },
      );
    }
    if (qty <= 0.000001) continue;
    let usdPrice = 0;
    if (b.coin === "USDC") {
      usdPrice = 1.0;
    } else if (mids[b.coin]) {
      usdPrice = parseFloat(mids[b.coin]);
    } else if (b.token != null && mids["@" + b.token]) {
      usdPrice = parseFloat(mids["@" + b.token]);
    } else if (b.entryNtl && b.total && parseFloat(b.total) > 0) {
      usdPrice = parseFloat(b.entryNtl) / parseFloat(b.total);
    } else {
      const tok = tokens.find((t) => t.name === b.coin);
      if (tok && ctxs[tok.index]?.markPx) {
        usdPrice = parseFloat(ctxs[tok.index].markPx);
      }
    }
    rawHoldings.push({
      ticker: b.coin,
      name: b.coin,
      quantity: qty,
      usdPrice,
    });
  }

  if (rawHoldings.length === 0) return [];

  // Obtenir les cours EUR. Le taux USDC sert de repli pour les actifs dont
  // seul le prix USD est connu ; un actif sans aucun cours annule la sync.
  const tickers = rawHoldings.map((h) => h.ticker);
  const quotes = await fetchCryptoQuotes([...tickers, "USDC"]);
  const usdToEur =
    Number(quotes["USDC"]) > 0 ? Number(quotes["USDC"]) : 0.92;
  const unpriced = [];
  const priced = rawHoldings.map((h) => {
    let priceEur = Number(quotes[h.ticker]);
    if (!Number.isFinite(priceEur) || priceEur <= 0) {
      if (h.usdPrice > 0) {
        priceEur = h.usdPrice * usdToEur;
        if (priceEur >= 0.01) priceEur = round2(priceEur);
      }
    }
    if (!Number.isFinite(priceEur) || priceEur <= 0) {
      unpriced.push(h.ticker);
      priceEur = 0;
    }
    return {
      ticker: h.ticker,
      name: h.name,
      quantity: h.quantity,
      price: priceEur,
      value: round2(h.quantity * priceEur),
    };
  });

  if (unpriced.length > 0) {
    throw new CryptoFetchError(
      `Cours indisponibles pour ${unpriced.join(", ")} (Hyperliquid). ` +
        "Synchronisation annulée pour préserver les positions existantes.",
      {
        code: "CRYPTO_QUOTES_UNAVAILABLE",
        details: { context: "Hyperliquid", missing: unpriced },
      },
    );
  }

  return priced.filter((h) => h.quantity > 0.000001);
}

/**
 * Récupère les soldes d'un compte Aptos (Fewcha / Petra, Move CoinStore).
 */
export async function fetchAptosHoldings(address) {
  if (!address) return [];
  const cleanAddr = address.trim();
  let res;
  try {
    res = await fetch(
      `https://fullnode.mainnet.aptoslabs.com/v1/accounts/${cleanAddr}/resources`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
  } catch (error) {
    throw new CryptoFetchError(
      `Nœud Aptos injoignable (${error.message}). Synchronisation annulée pour préserver les positions existantes.`,
      { code: "CRYPTO_APTOS_UNAVAILABLE" },
    );
  }
  if (!res.ok) {
    throw new CryptoFetchError(
      `Erreur Aptos HTTP ${res.status}. Synchronisation annulée pour préserver les positions existantes.`,
      { code: "CRYPTO_APTOS_UNAVAILABLE", details: { status: res.status } },
    );
  }
  let resources;
  try {
    resources = await res.json();
  } catch (error) {
    throw new CryptoFetchError(
      `Réponse Aptos illisible (${error.message}). Synchronisation annulée.`,
      { code: "CRYPTO_APTOS_INVALID_RESPONSE" },
    );
  }
  if (!Array.isArray(resources)) {
    throw new CryptoFetchError(
      "Réponse Aptos invalide : liste de ressources absente. Synchronisation annulée.",
      { code: "CRYPTO_APTOS_INVALID_RESPONSE" },
    );
  }

  const coinStores = resources.filter((r) => r.type?.startsWith("0x1::coin::CoinStore<"));
  const rawList = [];

  for (const cs of coinStores) {
    const match = cs.type.match(/<(.+)>/);
    if (!match) continue;
    const coinType = match[1];
    let rawVal;
    try {
      rawVal = BigInt(cs.data?.coin?.value || "0");
    } catch {
      throw new CryptoFetchError(
        `Solde Aptos invalide pour ${coinType}. Synchronisation annulée.`,
        { code: "CRYPTO_APTOS_INVALID_BALANCE" },
      );
    }
    let decimals = 8;
    let symbol = "APT";

    if (coinType === "0x1::aptos_coin::AptosCoin") {
      symbol = "APT";
      decimals = 8;
    } else {
      const parts = coinType.split("::");
      symbol = parts[parts.length - 1].toUpperCase();
    }

    const qty = Number(rawVal) / Math.pow(10, decimals);
    if (qty > 0.0001) {
      rawList.push({ ticker: symbol, name: symbol, quantity: qty });
    }
  }

  if (rawList.length === 0) return [];
  const tickers = rawList.map((h) => h.ticker);
  const quotes = requireQuotes(
    tickers,
    await fetchCryptoQuotes(tickers),
    { context: "Aptos", fallbacks: STABLECOIN_EUR_FALLBACK },
  );

  return rawList.map((h) => {
    const price = Number(quotes[h.ticker]);
    return {
      ticker: h.ticker,
      name: h.name,
      quantity: h.quantity,
      price,
      value: round2(h.quantity * price),
    };
  });
}

/**
 * Récupère le solde d'une adresse Bitcoin via Blockstream Esplora.
 */
export async function fetchBitcoinHoldings(address) {
  const cleanAddr = address.trim();
  const url = `https://blockstream.info/api/address/${cleanAddr}`;
  let data;
  try {
    data = await fetchWithTimeout(url);
  } catch (error) {
    throw new CryptoFetchError(
      `Blockstream injoignable (${error.message}). Synchronisation annulée pour préserver les positions existantes.`,
      { code: "CRYPTO_BITCOIN_UNAVAILABLE" },
    );
  }

  const funded = Number(data?.chain_stats?.funded_txo_sum);
  const spent = Number(data?.chain_stats?.spent_txo_sum);
  if (
    !data ||
    typeof data.chain_stats !== "object" ||
    !Number.isFinite(funded) ||
    !Number.isFinite(spent) ||
    funded < 0 ||
    spent < 0
  ) {
    throw new CryptoFetchError(
      "Réponse Blockstream invalide. Synchronisation annulée pour préserver les positions existantes.",
      { code: "CRYPTO_BITCOIN_INVALID_RESPONSE" },
    );
  }
  const satoshis = funded - spent;
  const btc = satoshis / 1e8;
  if (btc <= 0) return [];

  const quotes = requireQuotes(
    ["BTC"],
    await fetchCryptoQuotes(["BTC"]),
    { context: "Bitcoin" },
  );
  const price = Number(quotes["BTC"]);

  return [
    {
      ticker: "BTC",
      name: "Bitcoin",
      quantity: btc,
      price,
      value: round2(btc * price),
    },
  ];
}

/**
 * Récupère le solde d'une adresse Solana (SOL natif et jetons SPL).
 */
export async function fetchSolanaHoldings(address) {
  const cleanAddr = address.trim();
  let res;
  try {
    res = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [cleanAddr],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new CryptoFetchError(
      `RPC Solana injoignable (${error.message}). Synchronisation annulée pour préserver les positions existantes.`,
      { code: "CRYPTO_SOLANA_UNAVAILABLE" },
    );
  }

  if (!res.ok) {
    throw new CryptoFetchError(
      `Erreur RPC Solana HTTP ${res.status}. Synchronisation annulée pour préserver les positions existantes.`,
      { code: "CRYPTO_SOLANA_UNAVAILABLE", details: { status: res.status } },
    );
  }
  let json;
  try {
    json = await res.json();
  } catch (error) {
    throw new CryptoFetchError(
      `Réponse Solana illisible (${error.message}). Synchronisation annulée.`,
      { code: "CRYPTO_SOLANA_INVALID_RESPONSE" },
    );
  }
  const lamports = Number(json?.result?.value);
  if (!Number.isFinite(lamports) || lamports < 0) {
    throw new CryptoFetchError(
      "Réponse Solana invalide : solde natif absent. Synchronisation annulée.",
      { code: "CRYPTO_SOLANA_INVALID_RESPONSE" },
    );
  }
  const sol = lamports / 1e9;

  const rawHoldings = [];
  if (sol > 0.0001) {
    rawHoldings.push({ ticker: "SOL", name: "Solana", quantity: sol });
  }

  // Jetons SPL courants via getTokenAccountsByOwner. Un échec de cette
  // seconde requête rend le résultat partiel : on annule la synchronisation.
  let splRes;
  try {
    splRes = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "getTokenAccountsByOwner",
        params: [
          cleanAddr,
          { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
          { encoding: "jsonParsed" },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new CryptoFetchError(
      `RPC Solana (jetons SPL) injoignable (${error.message}). Synchronisation annulée.`,
      { code: "CRYPTO_SOLANA_SPL_UNAVAILABLE" },
    );
  }
  if (!splRes.ok) {
    throw new CryptoFetchError(
      `Erreur RPC Solana (jetons SPL) HTTP ${splRes.status}. Synchronisation annulée.`,
      { code: "CRYPTO_SOLANA_SPL_UNAVAILABLE", details: { status: splRes.status } },
    );
  }
  let splJson;
  try {
    splJson = await splRes.json();
  } catch (error) {
    throw new CryptoFetchError(
      `Réponse Solana (jetons SPL) illisible (${error.message}). Synchronisation annulée.`,
      { code: "CRYPTO_SOLANA_SPL_INVALID_RESPONSE" },
    );
  }
  const accounts = splJson?.result?.value;
  if (!Array.isArray(accounts)) {
    throw new CryptoFetchError(
      "Réponse Solana invalide : liste des jetons SPL absente. Synchronisation annulée.",
      { code: "CRYPTO_SOLANA_SPL_INVALID_RESPONSE" },
    );
  }
  const KNOWN_SPL = {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { ticker: "USDC", name: "USD Coin" },
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { ticker: "USDT", name: "Tether USD" },
    DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { ticker: "BONK", name: "Bonk" },
    JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { ticker: "JUP", name: "Jupiter" },
    HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { ticker: "PYTH", name: "Pyth Network" },
    rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: { ticker: "RENDER", name: "Render" },
  };
  for (const a of accounts) {
    const info = a.account?.data?.parsed?.info;
    const mint = info?.mint;
    const amount = Number(info?.tokenAmount?.uiAmount || 0);
    if (amount > 0.0001 && KNOWN_SPL[mint]) {
      const meta = KNOWN_SPL[mint];
      rawHoldings.push({
        ticker: meta.ticker,
        name: meta.name,
        quantity: amount,
      });
    }
  }

  if (rawHoldings.length === 0) return [];

  const tickers = rawHoldings.map((h) => h.ticker);
  const quotes = requireQuotes(
    tickers,
    await fetchCryptoQuotes(tickers),
    { context: "Solana", fallbacks: STABLECOIN_EUR_FALLBACK },
  );
  return rawHoldings
    .map((h) => {
      const price = Number(quotes[h.ticker]);
      return {
        ticker: h.ticker,
        name: h.name,
        quantity: h.quantity,
        price,
        value: round2(h.quantity * price),
      };
    })
    .filter((h) => h.value >= 0.05);
}

/**
 * Synchronise un compte crypto donné (Binance, EVM, Hyperliquid, Aptos, BTC, SOL ou Manuel)
 * et met à jour ses holdings et son solde dans la base SQLite.
 */
export async function syncCryptoAccount(repository, accountId, userId) {
  const account = repository.getAccount(accountId, userId);
  if (!account) throw new Error("Compte crypto introuvable");
  if (account.type !== "CRYPTO") throw new Error("Ce compte n'est pas de type CRYPTO");

  const metadata = account.metadata || {};
  const rawAddr = (metadata.address || account.externalId || "").trim();
  const provider = (account.provider || "manual").toLowerCase();
  const nameLower = (account.name || "").toLowerCase();
  let holdings = [];

  if (provider === "binance") {
    let apiKey = getUserSecret(repository.db, userId, "binanceApiKey");
    let apiSecret = getUserSecret(repository.db, userId, "binanceSecretKey");

    // Compatibilité avec les comptes créés avant le coffre : on migre les
    // identifiants chiffrés présents dans les métadonnées vers user_secrets.
    if ((!apiKey || !apiSecret) && metadata.credentialsEncrypted) {
      try {
        const legacy = decryptJson(metadata.credentialsEncrypted);
        const legacyKey =
          typeof legacy?.apiKey === "string" ? legacy.apiKey.trim() : "";
        const legacySecret =
          typeof legacy?.apiSecret === "string" ? legacy.apiSecret.trim() : "";
        if (legacyKey && !apiKey) {
          setUserSecret(repository.db, userId, "binanceApiKey", legacyKey);
          apiKey = legacyKey;
        }
        if (legacySecret && !apiSecret) {
          setUserSecret(repository.db, userId, "binanceSecretKey", legacySecret);
          apiSecret = legacySecret;
        }
      } catch (error) {
        console.warn(
          `⚠️ Identifiants Binance historiques illisibles: ${error.message}`,
        );
      }
    }

    if (!apiKey || !apiSecret) {
      throw new CryptoFetchError(
        "Clés API Binance non configurées. Renseignez-les dans les paramètres.",
        { code: "CRYPTO_BINANCE_KEYS_MISSING" },
      );
    }
    holdings = await fetchBinanceHoldings({ apiKey, apiSecret });
  } else if (
    provider === "hyperliquid" ||
    nameLower.includes("hyperliquid")
  ) {
    // Hyperliquid : interroger à la fois l'API L1 Hyperliquid ET les chaînes EVM
    const [hlRes, evmRes] = await Promise.allSettled([
      fetchHyperliquidHoldings(rawAddr),
      fetchEvmHoldings(rawAddr),
    ]);

    // Hyperliquid et EVM contribuent tous deux aux positions. Un seul échec
    // rend le résultat partiel : mieux vaut conserver l'état précédent.
    if (hlRes.status === "rejected" || evmRes.status === "rejected") {
      const failures = [hlRes, evmRes]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message || "échec inconnu");
      throw new CryptoFetchError(
        `Récupération Hyperliquid/EVM incomplète (${failures.join(" ; ")}). ` +
          "Synchronisation annulée pour préserver les positions existantes.",
        { code: "CRYPTO_HYPERLIQUID_PARTIAL" },
      );
    }

    const map = new Map();
    const addHoldings = (list) => {
      for (const h of list) {
        if (!map.has(h.ticker)) {
          map.set(h.ticker, { ...h });
        } else {
          const cur = map.get(h.ticker);
          cur.quantity += h.quantity;
          cur.value = round2(cur.value + h.value);
        }
      }
    };
    addHoldings(hlRes.value);
    addHoldings(evmRes.value);
    holdings = Array.from(map.values());
  } else if (
    provider === "aptos" ||
    nameLower.includes("fewcha") ||
    nameLower.includes("aptos") ||
    (rawAddr.startsWith("0x") && rawAddr.length > 42)
  ) {
    holdings = await fetchAptosHoldings(rawAddr);
  } else if (
    provider === "solana" ||
    (!rawAddr.startsWith("0x") && rawAddr.length >= 32 && rawAddr.length <= 44 && !rawAddr.startsWith("1") && !rawAddr.startsWith("3") && !rawAddr.startsWith("bc1"))
  ) {
    holdings = await fetchSolanaHoldings(rawAddr);
  } else if (
    provider === "bitcoin" ||
    rawAddr.startsWith("1") ||
    rawAddr.startsWith("3") ||
    rawAddr.startsWith("bc1")
  ) {
    holdings = await fetchBitcoinHoldings(rawAddr);
  } else if (provider === "evm" || rawAddr.startsWith("0x")) {
    holdings = await fetchEvmHoldings(rawAddr);
  } else {
    // Manuel : réévaluer les prix des positions existantes
    const currentHoldings = repository.listHoldings(account.id, userId);
    const symbols = currentHoldings.map((h) => h.ticker).filter(Boolean);
    const quotes = await fetchCryptoQuotes(symbols);

    holdings = currentHoldings.map((h) => {
      const quotedPrice = Number(quotes[h.ticker]);
      const price =
        Number.isFinite(quotedPrice) && quotedPrice > 0
          ? quotedPrice
          : h.price ?? 0;
      return {
        ticker: h.ticker,
        name: h.name || h.ticker,
        quantity: h.quantity,
        costBasis: h.costBasis,
        price,
        value: round2(h.quantity * price),
      };
    });
  }

  if (!Array.isArray(holdings)) {
    throw new CryptoFetchError(
      "Résultat de synchronisation invalide. Aucune position n'a été modifiée.",
      { code: "CRYPTO_INVALID_RESULT" },
    );
  }

  // Une synchronisation réussie peut légitimement renvoyer un portefeuille
  // vide. En revanche, toute erreur réseau ou cotation a déjà levé avant ce
  // point. L'écriture est atomique : DELETE + upserts + compte + snapshot.
  const applySync = repository.db.transaction(() => {
    repository.db
      .prepare("DELETE FROM holdings WHERE account_id = ? AND user_id = ?")
      .run(account.id, userId);

    let totalBalance = 0;
    for (const h of holdings) {
      const value = Number(h.value);
      if (!Number.isFinite(value) || value < 0) {
        throw new CryptoFetchError(
          `Valorisation invalide pour ${h.ticker || "une position"}. ` +
            "Aucune position n'a été modifiée.",
          { code: "CRYPTO_INVALID_VALUATION" },
        );
      }
      totalBalance += value;
      repository.upsertHolding(userId, account.id, {
        ticker: h.ticker,
        name: h.name,
        quantity: h.quantity,
        costBasis: h.costBasis ?? null,
        price: h.price,
        currency: "EUR",
        lastPriceAt: nowIso(),
      });
    }

    totalBalance = round2(totalBalance);

    // Mettre à jour le solde du compte et lastSyncAt
    const updatedAccount = repository.updateAccount(account.id, userId, {
      balance: totalBalance,
      cashBalance: 0,
      lastSyncAt: nowIso(),
    });

    // Sauvegarder un snapshot de solde pour la courbe historique
    repository.saveSnapshot(
      userId,
      account.id,
      nowIso().slice(0, 10),
      totalBalance,
      "EUR",
      "crypto_sync",
    );

    return updatedAccount;
  });

  const updated = applySync();

  return {
    account: updated,
    holdings: repository.listHoldings(account.id, userId),
  };
}

/**
 * Synchronise l'ensemble des comptes crypto d'un utilisateur.
 */
export async function syncAllCryptoAccounts(repository, userId) {
  const accounts = repository
    .listAccounts(userId)
    .filter((a) => a.type === "CRYPTO" && !a.isArchived);

  const results = [];
  for (const acc of accounts) {
    try {
      const res = await syncCryptoAccount(repository, acc.id, userId);
      results.push({ accountId: acc.id, success: true, balance: res.account.balance });
    } catch (err) {
      results.push({
        accountId: acc.id,
        success: false,
        error: err.message,
        code: err.code || "CRYPTO_SYNC_ERROR",
      });
    }
  }

  return {
    total: accounts.length,
    synced: results.filter((r) => r.success).length,
    results,
  };
}
