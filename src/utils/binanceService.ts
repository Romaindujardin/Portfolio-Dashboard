import { WalletAsset } from "../types";
import { API_ORIGIN } from "./apiBase";
// Récupère les prix depuis l'API Binance (pas besoin d'authentification)
async function getCryptoPrices(
  symbols: string[]
): Promise<Record<string, number>> {
  try {
    const prices: Record<string, number> = {};

    // Taux USDT -> EUR (1 EUR = X USDT) pour convertir les paires Binance
    let eurUsdt = 1;
    try {
      const rateResponse = await fetch(
        "https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT"
      );
      const rateData = await rateResponse.json();
      const rate = parseFloat(rateData.price);
      if (rate > 0) eurUsdt = rate;
    } catch {
      // Taux indisponible : approximation à 1
    }

    // Récupérer les prix un par un depuis Binance
    for (const symbol of symbols) {
      try {
        // Ajouter USDT pour former la paire
        const pair = `${symbol}USDT`;
        const response = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`
        );
        const data = await response.json();

        if (data.price) {
          prices[symbol] = parseFloat(data.price) / eurUsdt;
        }
      } catch {
        console.log(`Prix non disponible pour ${symbol}`);
      }
    }

    return prices;
  } catch (error) {
    console.error("Erreur lors de la récupération des prix:", error);
    return {};
  }
}

const API_BASE_URL = API_ORIGIN;

// Récupère les assets d'un compte Binance
export async function getBinanceAccountInfo(
  apiKey: string,
  apiSecret: string
): Promise<WalletAsset[]> {
  const res = await fetch(`${API_BASE_URL}/api/binance/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, apiSecret }),
  });
  if (!res.ok) throw new Error("Erreur API Binance: " + res.status);
  const data = await res.json();

  // data.balances: [{ asset: 'BTC', free: '0.1', locked: '0.0' }, ...]
  const balances = (data.balances || []).filter(
    (b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
  );

  // Récupérer les symboles uniques
  const symbols = balances.map((b: any) => b.asset);

  // Récupérer les prix depuis Binance
  const prices = await getCryptoPrices(symbols);

  const assets: WalletAsset[] = balances.map((b: any) => {
    const balance = parseFloat(b.free) + parseFloat(b.locked);
    const price = prices[b.asset] || 0;
    const value = balance * price;

    return {
      symbol: b.asset,
      name: b.asset,
      balance: balance,
      decimals: 8,
      blockchain: "binance",
      price: price,
      value: value,
    };
  });

  return assets;
}
