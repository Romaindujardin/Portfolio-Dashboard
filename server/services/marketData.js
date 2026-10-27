// Données de marché : Yahoo Finance (prix, FX, recherche) et OpenFIGI (ISIN).
// Les prix sont convertis en EUR et mis en cache 15 minutes. Aucune donnée
// n'est envoyée à un tiers en dehors du ticker / de l'ISIN demandé.

import { round2 } from "../lib/validate.js";

const YAHOO_BASE = "https://query1.finance.yahoo.com";
const OPENFIGI_BASE = "https://api.openfigi.com";
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_VERIFIED_CANDIDATES = 3;

export class MarketDataError extends Error {
  constructor(message, { status = 502, code = "MARKET_DATA_ERROR", details = null } = {}) {
    super(message);
    this.name = "MarketDataError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[A-Z0-9]$/;
const TICKER_RE = /^[A-Z0-9^][A-Z0-9.=\-^]{0,24}$/i;

export const isIsin = (value) => ISIN_RE.test(String(value || "").trim().toUpperCase());

export const normalizeTicker = (value) => {
  const ticker = String(value || "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    throw new MarketDataError(`Ticker invalide : ${value}`, {
      status: 400,
      code: "INVALID_TICKER",
    });
  }
  return ticker;
};

const fetchJson = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Portfolio-Dashboard/1.0)",
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new MarketDataError(`Source de marché injoignable : ${error.message}`, {
      code: "NETWORK_ERROR",
      details: { url },
    });
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new MarketDataError(
      payload?.chart?.error?.description ||
        payload?.error?.message ||
        payload?.message ||
        `Erreur source de marché (HTTP ${response.status})`,
      {
        status: response.status === 404 ? 404 : 502,
        code: "PROVIDER_ERROR",
        details: { status: response.status, body: payload },
      },
    );
  }
  return payload;
};

const fxCache = new Map();

const getFxRateToEur = async (currency) => {
  const code = String(currency || "").trim();
  if (!code || code.toUpperCase() === "EUR") return 1;
  if (code === "GBp" || code.toUpperCase() === "GBX") {
    const gbp = await getFxRateToEur("GBP");
    return gbp / 100;
  }
  const upper = code.toUpperCase();
  const cached = fxCache.get(upper);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rate;

  try {
    const payload = await fetchJson(
      `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(`${upper}EUR=X`)}?range=1d&interval=1d`,
    );
    const rate = Number(payload?.chart?.result?.[0]?.meta?.regularMarketPrice);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("taux absent");
    fxCache.set(upper, { rate, at: Date.now() });
    return rate;
  } catch (error) {
    throw new MarketDataError(
      `Taux de change ${upper}→EUR indisponible : ${error.message}`,
      { code: "FX_UNAVAILABLE", details: { currency: upper } },
    );
  }
};

export const fetchYahooQuote = async (ticker) => {
  const symbol = normalizeTicker(ticker);
  const payload = await fetchJson(
    `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
  );
  const result = payload?.chart?.result?.[0];
  if (!result?.meta) {
    throw new MarketDataError(
      payload?.chart?.error?.description || `Aucun cours pour ${symbol}`,
      { status: 404, code: "QUOTE_NOT_FOUND", details: { ticker: symbol } },
    );
  }
  const meta = result.meta;
  const nativePrice = Number(
    meta.regularMarketPrice ??
      meta.previousClose ??
      result.indicators?.quote?.[0]?.close?.filter((value) => Number.isFinite(value)).at(-1),
  );
  if (!Number.isFinite(nativePrice) || nativePrice <= 0) {
    throw new MarketDataError(`Cours indisponible pour ${symbol}`, {
      status: 404,
      code: "QUOTE_NOT_FOUND",
      details: { ticker: symbol },
    });
  }
  const currency = meta.currency || "EUR";
  const fxRate = await getFxRateToEur(currency);
  const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? nativePrice);
  const change =
    Number.isFinite(nativePrice) && Number.isFinite(prevClose)
      ? round2((nativePrice - prevClose) * fxRate)
      : 0;
  const changePercent =
    meta.regularMarketChangePercent != null
      ? round2(Number(meta.regularMarketChangePercent))
      : prevClose > 0
      ? round2(((nativePrice - prevClose) / prevClose) * 100)
      : 0;

  return {
    ticker: symbol,
    price: round2(nativePrice * fxRate),
    nativePrice,
    currency,
    fxRate,
    name: meta.longName || meta.shortName || symbol,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    instrumentType: meta.instrumentType || null,
    marketState: meta.marketState || null,
    change,
    changePercent,
    previousClose: round2(prevClose * fxRate),
    dayHigh: meta.regularMarketDayHigh != null ? round2(Number(meta.regularMarketDayHigh) * fxRate) : null,
    dayLow: meta.regularMarketDayLow != null ? round2(Number(meta.regularMarketDayLow) * fxRate) : null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh != null ? round2(Number(meta.fiftyTwoWeekHigh) * fxRate) : null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow != null ? round2(Number(meta.fiftyTwoWeekLow) * fxRate) : null,
    volume: meta.regularMarketVolume != null ? Number(meta.regularMarketVolume) : null,
    fetchedAt: new Date().toISOString(),
    source: "yahoo",
  };
};

/** Recherche Yahoo (utilisée notamment pour vérifier un ISIN). */
export const searchYahooSymbols = async (query, { limit = 10 } = {}) => {
  const q = String(query || "").trim();
  if (!q) return [];
  const payload = await fetchJson(
    `${YAHOO_BASE}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${Math.min(
      Math.max(limit, 1),
      20,
    )}&newsCount=0&listsCount=0`,
  );
  return (Array.isArray(payload?.quotes) ? payload.quotes : [])
    .filter((quote) => quote?.symbol)
    .map((quote) => ({
      ticker: quote.symbol,
      name: quote.longname || quote.shortname || quote.symbol,
      exchange: quote.exchDisp || quote.exchange || null,
      quoteType: quote.quoteType || null,
    }));
};

// OpenFIGI exchCode -> suffixe Yahoo.
const EXCHANGE_SUFFIX = {
  US: "",
  UN: "",
  UA: "",
  UC: "",
  UD: "",
  UW: "",
  NQ: "",
  NY: "",
  OQ: "",
  PK: "",
  PQ: "",
  GR: ".DE",
  GF: ".DE",
  GD: ".DE",
  GY: ".DE",
  GS: ".DE",
  GM: ".DE",
  GT: ".DE",
  GI: ".DE",
  GH: ".DE",
  GZ: ".DE",
  TH: ".DE",
  QT: ".DE",
  FP: ".PA",
  PA: ".PA",
  NA: ".AS",
  LN: ".L",
  IM: ".MI",
  BR: ".BR",
  SW: ".SW",
  SZ: ".SW",
  SM: ".MC",
  TO: ".TO",
  TV: ".TO",
  JT: ".T",
  HK: ".HK",
  AU: ".AX",
  SG: ".SI",
  IN: ".NS",
  KS: ".KS",
};

const HOME_EXCHANGE = {
  US: "US",
  HK: "HK",
  JP: "JT",
  AU: "AU",
  SG: "SG",
  IN: "IN",
  KR: "KS",
  GB: "LN",
  DE: "GY",
  FR: "FP",
  NL: "NA",
  IT: "IM",
  CH: "SW",
  ES: "SM",
  CA: "TO",
};

const EU_PREFERRED = ["NA", "FP", "GY", "GR", "GF", "LN", "IM", "BR"];

const yahooTickerFor = (ticker, exchCode) =>
  `${ticker}${EXCHANGE_SUFFIX[exchCode] ?? ""}`;

/**
 * Choisit les meilleurs candidats OpenFIGI pour un ISIN.
 * Stratégie : place d'origine, puis places européennes, puis US, puis le reste.
 */
export const pickFigiCandidates = (data, isin) => {
  const country = String(isin || "").slice(0, 2).toUpperCase();
  const home = HOME_EXCHANGE[country] || null;
  const rank = (entry) => {
    if (home && entry.exchCode === home) return 0;
    if (EU_PREFERRED.includes(entry.exchCode)) return 1;
    if (EXCHANGE_SUFFIX[entry.exchCode] === "") return 2;
    if (entry.exchCode in EXCHANGE_SUFFIX) return 3;
    return 4;
  };
  return (Array.isArray(data) ? data : [])
    .filter((entry) => entry?.ticker && entry?.exchCode in EXCHANGE_SUFFIX)
    .map((entry) => ({
      ticker: yahooTickerFor(entry.ticker, entry.exchCode),
      rawTicker: entry.ticker,
      exchange: entry.exchCode,
      name: entry.name || null,
      securityType: entry.securityType || null,
      rank: rank(entry),
    }))
    .sort((a, b) => a.rank - b.rank);
};

const fetchOpenFigi = async (isin) => {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OPENFIGI_API_KEY) {
    headers["X-OPENFIGI-APIKEY"] = process.env.OPENFIGI_API_KEY;
  }
  const payload = await fetchJson(`${OPENFIGI_BASE}/v3/mapping`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
  });
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first || first.error) return [];
  return Array.isArray(first.data) ? first.data : [];
};

/**
 * Convertit un symbole interne BoursoBank (ex: "1rPMC", "1rTPE500", "1rTCW8")
 * en ticker Yahoo Finance résoluble (ex: "MC.PA", "PE500.PA", "CW8.PA").
 */
export const convertBoursoSymbolToYahoo = (symbol) => {
  if (!symbol || typeof symbol !== "string") return null;
  const s = symbol.trim();
  if (!s) return null;
  // Euronext Paris: 1rP (action), 1rT (tracker/ETF), 1rA (alternext/growth)
  if (/^1r[pta]/i.test(s)) {
    return `${s.slice(3).toUpperCase()}.PA`;
  }
  // 1r général (Euronext Paris)
  if (/^1r/i.test(s)) {
    return `${s.slice(2).toUpperCase()}.PA`;
  }
  // 2r (Euronext Amsterdam / Bruxelles)
  if (/^2r[pta]?/i.test(s)) {
    const code = s.replace(/^2r[pta]?/i, "").toUpperCase();
    return `${code}.AS`;
  }
  return s.toUpperCase();
};

export class MarketDataService {
  constructor({ repository } = {}) {
    this.repository = repository;
  }

  async getQuote(ticker, { force = false } = {}) {
    const symbol = normalizeTicker(ticker);
    if (!force && this.repository) {
      const cached = this.repository.getCachedPrice(symbol);
      if (
        cached &&
        Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS
      ) {
        return {
          ticker: cached.ticker,
          price: cached.price,
          currency: cached.metadata?.nativeCurrency || cached.currency,
          fetchedAt: cached.fetchedAt,
          source: cached.source,
          cached: true,
          ...(cached.metadata || {}),
        };
      }
    }

    const quote = await fetchYahooQuote(symbol);
    if (this.repository) {
      this.repository.saveCachedPrice(symbol, {
        price: quote.price,
        currency: "EUR",
        source: quote.source,
        fetchedAt: quote.fetchedAt,
        metadata: {
          nativePrice: quote.nativePrice,
          nativeCurrency: quote.currency,
          fxRate: quote.fxRate,
          name: quote.name,
          exchange: quote.exchange,
          instrumentType: quote.instrumentType,
          change: quote.change,
          changePercent: quote.changePercent,
          previousClose: quote.previousClose,
          dayHigh: quote.dayHigh,
          dayLow: quote.dayLow,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
          volume: quote.volume,
        },
      });
    }
    return quote;
  }

  async getQuotes(tickers, { force = false, concurrency = 5 } = {}) {
    const unique = [...new Set((tickers || []).map(normalizeTicker))];
    const results = [];
    for (let index = 0; index < unique.length; index += concurrency) {
      const batch = unique.slice(index, index + concurrency);
      const settled = await Promise.allSettled(
        batch.map((ticker) => this.getQuote(ticker, { force })),
      );
      settled.forEach((entry, offset) => {
        if (entry.status === "fulfilled") results.push(entry.value);
        else {
          results.push({
            ticker: batch[offset],
            error: entry.reason?.message || "Cours indisponible",
            code: entry.reason?.code || "QUOTE_ERROR",
          });
        }
      });
    }
    return results;
  }

  async search(query) {
    return searchYahooSymbols(query);
  }

  /**
   * Résout un ISIN en ticker Yahoo. Le résultat est mémorisé en base pour
   * éviter de solliciter OpenFIGI à chaque rafraîchissement.
   */
  async resolveIsin(isin) {
    const normalized = String(isin || "").trim().toUpperCase();
    if (!isIsin(normalized)) {
      throw new MarketDataError(`ISIN invalide : ${isin}`, {
        status: 400,
        code: "INVALID_ISIN",
      });
    }

    if (this.repository) {
      const known = this.repository.getSecurity(normalized);
      if (known?.ticker) return { ...known, cached: true, resolved: true };
    }

    let candidates = [];
    try {
      candidates = pickFigiCandidates(await fetchOpenFigi(normalized), normalized);
    } catch (error) {
      if (error.code === "NETWORK_ERROR") throw error;
      candidates = [];
    }

    // Vérification : on ne retient qu'un ticker réellement coté chez Yahoo.
    let verified = null;
    for (const candidate of candidates.slice(0, MAX_VERIFIED_CANDIDATES)) {
      try {
        const quote = await fetchYahooQuote(candidate.ticker);
        verified = { ...candidate, name: candidate.name || quote.name };
        break;
      } catch {
        // Candidat non coté chez Yahoo : essayer le suivant.
      }
    }

    if (!verified) {
      // Repli : recherche Yahoo par ISIN (certaines places y sont référencées).
      try {
        const matches = await searchYahooSymbols(normalized, { limit: 5 });
        for (const match of matches.slice(0, MAX_VERIFIED_CANDIDATES)) {
          try {
            const quote = await fetchYahooQuote(match.ticker);
            verified = {
              ticker: match.ticker,
              exchange: match.exchange,
              name: candidates[0]?.name || match.name || quote.name,
            };
            break;
          } catch {
            // Continuer.
          }
        }
      } catch {
        // Pas de repli disponible.
      }
    }

    const result = verified
      ? {
          isin: normalized,
          ticker: verified.ticker,
          name: verified.name || null,
          exchange: verified.exchange || null,
          currency: "EUR",
          resolved: true,
        }
      : {
          isin: normalized,
          ticker: normalized,
          name: null,
          exchange: null,
          currency: null,
          resolved: false,
        };

    // On ne mémorise que les résolutions vérifiées : sinon un incident
    // temporaire figerait un faux ticker (l'ISIN lui-même) pour toujours.
    if (this.repository && verified) this.repository.saveSecurity(normalized, result);
    return result;
  }

  /**
   * Met à jour les prix de tous les holdings d'un utilisateur et recalcule la
   * valeur des comptes d'investissement concernés.
   * Exclut les comptes CRYPTO (gérés par le service crypto) et supporte le filtrage
   * par accountId.
   */
  async refreshHoldings(userId, { force = true, accountId = null } = {}) {
    if (!this.repository) throw new Error("Repository requis");

    // Récupérer les comptes pour identifier leur type
    const accounts = new Map(
      this.repository.listAccounts(userId).map((a) => [a.id, a]),
    );

    let holdings = this.repository.listAllHoldings(userId);

    // Ne rafraîchir que les comptes d'investissement (PEA, SECURITIES, OTHER...)
    // Les comptes CRYPTO sont gérés exclusivement par le service crypto
    holdings = holdings.filter((holding) => {
      const account = accounts.get(holding.accountId);
      return account && account.type !== "CRYPTO";
    });

    // Filtrer par compte si spécifié (ex: modal positions d'un compte précis)
    if (accountId) {
      holdings = holdings.filter((holding) => holding.accountId === accountId);
    }

    // Auto-conversion des symboles BoursoBank résiduels éventuels (1rPMC -> MC.PA, etc.)
    for (const holding of holdings) {
      if (holding.ticker && /^1r/i.test(holding.ticker)) {
        const converted = convertBoursoSymbolToYahoo(holding.ticker);
        if (converted && converted !== holding.ticker) {
          holding.ticker = converted;
          if (typeof this.repository.updateHolding === "function") {
            this.repository.updateHolding(holding.id, { ticker: converted });
          }
        }
      }
    }

    const tickers = holdings
      .map((holding) => holding.ticker)
      .filter(Boolean);

    if (tickers.length === 0) {
      return { updated: 0, failed: [], accounts: 0 };
    }

    const quotes = await this.getQuotes(tickers, { force });
    const byTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));

    let updated = 0;
    const failed = [];
    const touchedAccounts = new Set();

    for (const holding of holdings) {
      if (!holding.ticker) continue;
      const quote = byTicker.get(holding.ticker);
      if (!quote || quote.error) {
        failed.push({ ticker: holding.ticker, error: quote?.error || "Cours absent" });
        continue;
      }
      this.repository.updateHoldingPrice(
        holding.id,
        quote.price,
        quote.fetchedAt,
        {
          nativePrice: quote.nativePrice,
          nativeCurrency: quote.currency,
          fxRate: quote.fxRate,
          source: quote.source,
        },
      );
      touchedAccounts.add(holding.accountId);
      updated += 1;
    }

    for (const accId of touchedAccounts) {
      this.recomputeInvestmentAccount(accId, userId);
    }

    return { updated, failed, accounts: touchedAccounts.size };
  }

  recomputeInvestmentAccount(accountId, userId) {
    if (!this.repository) return null;
    const account = this.repository.getAccount(accountId, userId);
    if (!account) return null;
    const holdings = this.repository.listHoldings(accountId, userId);
    if (holdings.length === 0) {
      // Dernière position supprimée : on revient aux liquidités connues. Pour
      // un compte sans notion de liquidités, on préserve le solde manuel.
      if (account.cashBalance == null) return account;
      return this.repository.updateAccount(accountId, userId, {
        balance: round2(account.cashBalance),
      });
    }
    const holdingsValue = holdings.reduce(
      (sum, holding) => sum + (holding.quantity || 0) * (holding.price || 0),
      0,
    );
    const cash = account.cashBalance ?? 0;
    return this.repository.updateAccount(accountId, userId, {
      balance: round2(cash + holdingsValue),
    });
  }
}

export default MarketDataService;
