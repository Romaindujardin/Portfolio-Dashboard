import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";

export type SupportedCurrency = "EUR" | "USD";

export interface FormatMoneyOptions {
  compact?: boolean;
  signed?: boolean;
  digits?: number;
  fallback?: string;
  currency?: SupportedCurrency;
}

export interface CurrencyContextType {
  currency: SupportedCurrency;
  isMasked: boolean;
  rateEurToUsd: number;
  currencySymbol: string;
  setCurrency: (currency: SupportedCurrency) => void;
  toggleCurrency: () => void;
  setIsMasked: (masked: boolean) => void;
  toggleMasked: () => void;
  formatMoney: (value: number | null | undefined, options?: FormatMoneyOptions) => string;
  maskDigits: (text: string) => string;
  convertAmount: (amountInEur: number, targetCurrency?: SupportedCurrency) => number;
}

const STORAGE_CURRENCY_KEY = "portfolio_currency";
const STORAGE_MASKED_KEY = "dashboardAnonymous";
const STORAGE_RATE_KEY = "portfolio_eur_usd_rate";

const EVENT_CURRENCY_CHANGED = "portfolioCurrencyChanged";
const EVENT_MASKED_CHANGED = "dashboardAnonymousChanged";

// Synchronous module-level globals for direct utility calls
let globalCurrency: SupportedCurrency = (() => {
  if (typeof window === "undefined") return "EUR";
  const stored = localStorage.getItem(STORAGE_CURRENCY_KEY);
  return stored === "USD" ? "USD" : "EUR";
})();

let globalIsMasked: boolean = (() => {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_MASKED_KEY) === "1";
})();

let globalRateEurToUsd: number = (() => {
  if (typeof window === "undefined") return 1.08;
  const stored = Number(localStorage.getItem(STORAGE_RATE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : 1.08;
})();

export const getGlobalCurrency = (): SupportedCurrency => globalCurrency;
export const getGlobalMasked = (): boolean => globalIsMasked;
export const getGlobalRateEurToUsd = (): number => globalRateEurToUsd;

/**
 * Format any numerical value (in EUR by default) into the active currency
 * with automatic conversion, locale formatting, and optional digit masking.
 */
export function formatMoney(
  value: number | null | undefined,
  options: FormatMoneyOptions = {},
  overrideCurrency?: SupportedCurrency,
  overrideMasked?: boolean,
  overrideRate?: number,
): string {
  if (value == null || Number.isNaN(Number(value))) {
    return options.fallback ?? "—";
  }

  const activeCurrency = overrideCurrency ?? globalCurrency;
  const isMasked = overrideMasked ?? globalIsMasked;
  const rate = overrideRate ?? globalRateEurToUsd;

  const rawNum = Number(value);
  const convertedValue = activeCurrency === "USD" ? rawNum * rate : rawNum;

  const maxDigits = options.compact ? 0 : (options.digits ?? 2);
  const minDigits = options.compact ? 0 : (options.digits ?? 2);

  let formatted: string;
  try {
    const formatter = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: activeCurrency,
      maximumFractionDigits: maxDigits,
      minimumFractionDigits: minDigits,
      notation: options.compact ? "compact" : "standard",
      signDisplay: options.signed ? "exceptZero" : "auto",
    });
    formatted = formatter.format(convertedValue);
    // Standardize symbol in French locale: replace "$US" or "US$" with "$"
    formatted = formatted.replace(/\$US/g, "$").replace(/US\$/g, "$");
  } catch {
    const sym = activeCurrency === "USD" ? "$" : "€";
    formatted = `${convertedValue.toFixed(maxDigits)} ${sym}`;
  }

  if (isMasked) {
    return formatted.replace(/[0-9]/g, "*");
  }

  return formatted;
}

/** Alias to formatMoney for backward compatibility */
export const formatEur = (
  value: number | null | undefined,
  options: FormatMoneyOptions = {},
): string => formatMoney(value, options);

/** Mask digits inside arbitrary string */
export function maskDigits(text: string, forceMasked?: boolean): string {
  const isMasked = forceMasked ?? globalIsMasked;
  return isMasked ? text.replace(/[0-9]/g, "*") : text;
}

/** Formats a percentage and respects masking */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const formatted = `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value))} %`;

  return globalIsMasked ? formatted.replace(/[0-9]/g, "*") : formatted;
}

const CurrencyContext = createContext<CurrencyContextType | null>(null);

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currency, setCurrencyState] = useState<SupportedCurrency>(globalCurrency);
  const [isMasked, setIsMaskedState] = useState<boolean>(globalIsMasked);
  const [rateEurToUsd, setRateEurToUsd] = useState<number>(globalRateEurToUsd);

  // Sync state changes with globals, storage and dispatch events
  const setCurrency = useCallback((next: SupportedCurrency) => {
    globalCurrency = next;
    setCurrencyState(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_CURRENCY_KEY, next);
      window.dispatchEvent(
        new CustomEvent(EVENT_CURRENCY_CHANGED, { detail: { value: next } }),
      );
    }
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrency(globalCurrency === "EUR" ? "USD" : "EUR");
  }, [setCurrency]);

  const setIsMasked = useCallback((next: boolean) => {
    globalIsMasked = next;
    setIsMaskedState(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_MASKED_KEY, next ? "1" : "0");
      window.dispatchEvent(
        new CustomEvent(EVENT_MASKED_CHANGED, { detail: { value: next } }),
      );
    }
  }, []);

  const toggleMasked = useCallback(() => {
    setIsMasked(!globalIsMasked);
  }, [setIsMasked]);

  const convertAmount = useCallback(
    (amountInEur: number, targetCurrency?: SupportedCurrency): number => {
      const active = targetCurrency ?? currency;
      return active === "USD" ? amountInEur * rateEurToUsd : amountInEur;
    },
    [currency, rateEurToUsd],
  );

  const formatMoneyBound = useCallback(
    (value: number | null | undefined, options?: FormatMoneyOptions): string => {
      return formatMoney(value, options, currency, isMasked, rateEurToUsd);
    },
    [currency, isMasked, rateEurToUsd],
  );

  const maskDigitsBound = useCallback(
    (text: string): string => {
      return maskDigits(text, isMasked);
    },
    [isMasked],
  );

  // Listen to storage and custom events
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_MASKED_KEY) {
        const masked = event.newValue === "1";
        globalIsMasked = masked;
        setIsMaskedState(masked);
      } else if (event.key === STORAGE_CURRENCY_KEY) {
        const curr = event.newValue === "USD" ? "USD" : "EUR";
        globalCurrency = curr;
        setCurrencyState(curr);
      }
    };

    const handleMaskedCustom = (event: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as
        | { value?: boolean }
        | undefined;
      if (typeof detail?.value === "boolean") {
        globalIsMasked = detail.value;
        setIsMaskedState(detail.value);
      }
    };

    const handleCurrencyCustom = (event: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as
        | { value?: SupportedCurrency }
        | undefined;
      if (detail?.value === "EUR" || detail?.value === "USD") {
        globalCurrency = detail.value;
        setCurrencyState(detail.value);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(EVENT_MASKED_CHANGED, handleMaskedCustom);
    window.addEventListener(EVENT_CURRENCY_CHANGED, handleCurrencyCustom);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(EVENT_MASKED_CHANGED, handleMaskedCustom);
      window.removeEventListener(EVENT_CURRENCY_CHANGED, handleCurrencyCustom);
    };
  }, []);

  // Fetch live EUR/USD rate in background
  useEffect(() => {
    let isMounted = true;

    const fetchRate = async () => {
      try {
        const resp = await fetch("/api/portfolio/fx/rates");
        if (resp.ok) {
          const data = await resp.json();
          if (data?.eur_usd && Number.isFinite(Number(data.eur_usd))) {
            const rate = Number(data.eur_usd);
            if (isMounted) {
              globalRateEurToUsd = rate;
              setRateEurToUsd(rate);
              localStorage.setItem(STORAGE_RATE_KEY, String(rate));
            }
            return;
          }
        }
      } catch (_) {
        // Fallback to direct ECB Frankfurter if backend is restarting
        try {
          const directResp = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD");
          if (directResp.ok) {
            const data = await directResp.json();
            if (data?.rates?.USD && Number.isFinite(Number(data.rates.USD))) {
              const rate = Number(data.rates.USD);
              if (isMounted) {
                globalRateEurToUsd = rate;
                setRateEurToUsd(rate);
                localStorage.setItem(STORAGE_RATE_KEY, String(rate));
              }
            }
          }
        } catch (_) {}
      }
    };

    fetchRate();
    const interval = setInterval(fetchRate, 10 * 60 * 1000); // refresh every 10 min
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const currencySymbol = useMemo(() => (currency === "USD" ? "$" : "€"), [currency]);

  const value = useMemo(
    () => ({
      currency,
      isMasked,
      rateEurToUsd,
      currencySymbol,
      setCurrency,
      toggleCurrency,
      setIsMasked,
      toggleMasked,
      formatMoney: formatMoneyBound,
      maskDigits: maskDigitsBound,
      convertAmount,
    }),
    [
      currency,
      isMasked,
      rateEurToUsd,
      currencySymbol,
      setCurrency,
      toggleCurrency,
      setIsMasked,
      toggleMasked,
      formatMoneyBound,
      maskDigitsBound,
      convertAmount,
    ],
  );

  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
};

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (!context) {
    // Graceful fallback for non-provider usage or tests
    return {
      currency: globalCurrency,
      isMasked: globalIsMasked,
      rateEurToUsd: globalRateEurToUsd,
      currencySymbol: globalCurrency === "USD" ? "$" : "€",
      setCurrency: (c) => {
        globalCurrency = c;
      },
      toggleCurrency: () => {
        globalCurrency = globalCurrency === "EUR" ? "USD" : "EUR";
      },
      setIsMasked: (m) => {
        globalIsMasked = m;
      },
      toggleMasked: () => {
        globalIsMasked = !globalIsMasked;
      },
      formatMoney: (v, opts) => formatMoney(v, opts),
      maskDigits: (t) => maskDigits(t),
      convertAmount: (amt, target) => {
        const c = target ?? globalCurrency;
        return c === "USD" ? amt * globalRateEurToUsd : amt;
      },
    };
  }
  return context;
};

export default CurrencyContext;
