// Service de gestion et synchronisation des cryptomonnaies (inspiré de Picsou).
// Supporte :
//  - Binance (CEX) via HMAC-SHA256
//  - EVM multi-chain fan-out via PublicNode RPCs gratuits
//  - Bitcoin via Blockstream Esplora
//  - Solana via RPC public
//  - Saisie manuelle / Cold storage
//  - Cotations EUR en direct via CoinGecko & Binance

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { nowIso, round2 } from "../lib/validate.js";
import { encryptJson, decryptJson } from "../lib/secrets.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const BINANCE_BASE = "https://api.binance.com";
const TIMEOUT_MS = 15000;

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
};

// RPCs EVM sans clé API (PublicNode)
const EVM_NETWORKS = [
  { name: "Ethereum", symbol: "ETH", rpc: "https://ethereum-rpc.publicnode.com" },
  { name: "BNB Chain", symbol: "BNB", rpc: "https://bsc-rpc.publicnode.com" },
  { name: "Polygon", symbol: "POL", rpc: "https://polygon-bor-rpc.publicnode.com" },
  { name: "Arbitrum", symbol: "ETH", rpc: "https://arbitrum-one-rpc.publicnode.com" },
  { name: "Base", symbol: "ETH", rpc: "https://base-rpc.publicnode.com" },
  { name: "Optimism", symbol: "ETH", rpc: "https://optimism-rpc.publicnode.com" },
  { name: "Avalanche", symbol: "AVAX", rpc: "https://avalanche-c-chain-rpc.publicnode.com" },
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

/**
 * Récupère les cours en EUR pour une liste de symboles crypto.
 * Utilise CoinGecko en priorité, avec fallback sur Binance EUR.
 */
export async function fetchCryptoQuotes(symbols = []) {
  const uniqueSymbols = Array.from(
    new Set(symbols.map((s) => String(s || "").toUpperCase().trim())),
  ).filter(Boolean);

  if (uniqueSymbols.length === 0) return {};

  const quotes = {};

  // 1. Tenter CoinGecko
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
    console.warn("⚠️ CoinGecko indisponible pour les quotes, tentative Binance:", err.message);
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
    throw new Error("Clé API et Clé Secrète Binance requises");
  }

  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");

  const url = `${BINANCE_BASE}/api/v3/account?${queryString}&signature=${signature}`;
  const response = await fetch(url, {
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erreur Binance API (${response.status}) : ${errText}`);
  }

  const data = await response.json();
  const balances = (data.balances || [])
    .map((b) => ({
      symbol: b.asset.toUpperCase(),
      quantity: parseFloat(b.free) + parseFloat(b.locked),
    }))
    .filter((b) => b.quantity > 0.00000001);

  // Prix en direct
  const quotes = await fetchCryptoQuotes(balances.map((b) => b.symbol));

  return balances
    .map((b) => {
      const price = quotes[b.symbol] || 0;
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
 * Récupère les soldes d'une adresse EVM (fan-out multi-chain PublicNode).
 */
export async function fetchEvmHoldings(address) {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
    throw new Error("Adresse EVM invalide (format 0x... attendu)");
  }

  const cleanAddr = address.trim();
  const aggregated = {}; // symbol -> total quantity

  await Promise.all(
    EVM_NETWORKS.map(async (net) => {
      try {
        const payload = {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: [cleanAddr, "latest"],
        };
        const res = await fetch(net.rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.result) {
            const raw = BigInt(json.result);
            const balance = Number(raw) / 1e18;
            if (balance > 0.00001) {
              aggregated[net.symbol] = (aggregated[net.symbol] || 0) + balance;
            }
          }
        }
      } catch (err) {
        // Un RPC qui échoue ne bloque pas les autres chaînes
      }
    }),
  );

  const symbols = Object.keys(aggregated);
  const quotes = await fetchCryptoQuotes(symbols);

  return symbols.map((symbol) => {
    const qty = aggregated[symbol];
    const price = quotes[symbol] || 0;
    return {
      ticker: symbol,
      name: symbol,
      quantity: qty,
      price,
      value: round2(qty * price),
    };
  });
}

/**
 * Récupère le solde d'une adresse Bitcoin via Blockstream Esplora.
 */
export async function fetchBitcoinHoldings(address) {
  const cleanAddr = address.trim();
  const url = `https://blockstream.info/api/address/${cleanAddr}`;
  const data = await fetchWithTimeout(url);

  const funded = Number(data?.chain_stats?.funded_txo_sum || 0);
  const spent = Number(data?.chain_stats?.spent_txo_sum || 0);
  const satoshis = funded - spent;
  const btc = satoshis / 1e8;

  const quotes = await fetchCryptoQuotes(["BTC"]);
  const price = quotes["BTC"] || 0;

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
 * Récupère le solde d'une adresse Solana via RPC public.
 */
export async function fetchSolanaHoldings(address) {
  const cleanAddr = address.trim();
  const res = await fetch("https://api.mainnet-beta.solana.com", {
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

  if (!res.ok) throw new Error("Erreur RPC Solana");
  const json = await res.json();
  const lamports = Number(json?.result?.value || 0);
  const sol = lamports / 1e9;

  const quotes = await fetchCryptoQuotes(["SOL"]);
  const price = quotes["SOL"] || 0;

  return [
    {
      ticker: "SOL",
      name: "Solana",
      quantity: sol,
      price,
      value: round2(sol * price),
    },
  ];
}

/**
 * Synchronise un compte crypto donné (Binance, EVM, BTC, SOL ou Manuel)
 * et met à jour ses holdings et son solde dans la base SQLite.
 */
export async function syncCryptoAccount(repository, accountId, userId) {
  const account = repository.getAccount(accountId, userId);
  if (!account) throw new Error("Compte crypto introuvable");
  if (account.type !== "CRYPTO") throw new Error("Ce compte n'est pas de type CRYPTO");

  const metadata = account.metadata || {};
  const provider = account.provider || "manual";
  let holdings = [];

  if (provider === "binance") {
    const creds = metadata.credentialsEncrypted
      ? decryptJson(metadata.credentialsEncrypted)
      : metadata;
    holdings = await fetchBinanceHoldings({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });
  } else if (provider === "evm") {
    holdings = await fetchEvmHoldings(metadata.address || account.externalId);
  } else if (provider === "bitcoin") {
    holdings = await fetchBitcoinHoldings(metadata.address || account.externalId);
  } else if (provider === "solana") {
    holdings = await fetchSolanaHoldings(metadata.address || account.externalId);
  } else {
    // Manuel : réévaluer les prix des positions existantes
    const currentHoldings = repository.listHoldings(account.id, userId);
    const symbols = currentHoldings.map((h) => h.ticker).filter(Boolean);
    const quotes = await fetchCryptoQuotes(symbols);

    holdings = currentHoldings.map((h) => {
      const price = quotes[h.ticker] ?? h.price ?? 0;
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

  // Mettre à jour les positions dans SQLite
  // On supprime les anciennes pour remplacer par le snapshot exact
  repository.db
    .prepare("DELETE FROM holdings WHERE account_id = ? AND user_id = ?")
    .run(account.id, userId);

  let totalBalance = 0;
  for (const h of holdings) {
    totalBalance += h.value;
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
  const updated = repository.updateAccount(account.id, userId, {
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
      results.push({ accountId: acc.id, success: false, error: err.message });
    }
  }

  return {
    total: accounts.length,
    synced: results.filter((r) => r.success).length,
    results,
  };
}
