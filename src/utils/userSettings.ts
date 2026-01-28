import type {
  AccountSectionConfig,
  BankCsvColumnMapping,
  BoursoAccountMapping,
  InvestmentCsvColumnMapping,
} from "../types";

export interface UserSettings {
  binanceApiKey: string;
  binanceSecretKey: string;
  geminiApiKey: string;
  etherscanApiKey: string;
  coinGeckoApiKey: string;
  openSeaApiKey: string;
  customApiEndpoint: string;
  accountSections: AccountSectionConfig[];
  csvColumnMappings: Record<
    string,
    BankCsvColumnMapping | InvestmentCsvColumnMapping
  >;
  boursoClientId: string;
  boursoAccountMappings: BoursoAccountMapping[];
  theme: "light" | "dark" | "auto";
  currency: string;
  language: string;
}

const defaultSettings: UserSettings = {
  binanceApiKey: "",
  binanceSecretKey: "",
  geminiApiKey: "",
  etherscanApiKey: "",
  coinGeckoApiKey: "",
  openSeaApiKey: "",
  customApiEndpoint: "",
  accountSections: [
    { id: "bank", label: "Compte bancaire", kind: "bank" },
    { id: "pea", label: "PEA", kind: "investment" },
    { id: "pee", label: "PEE", kind: "investment" },
  ],
  csvColumnMappings: {},
  boursoClientId: "",
  boursoAccountMappings: [],
  theme: "auto",
  currency: "USD",
  language: "fr",
};

export const getUserSettings = (username: string): UserSettings => {
  try {
    const stored = localStorage.getItem(`user_settings_${username}`);
    if (stored) {
      const parsedSettings = JSON.parse(stored);
      const merged = { ...defaultSettings, ...parsedSettings } as UserSettings;
      if (
        !Array.isArray(merged.accountSections) ||
        !merged.accountSections.length
      ) {
        merged.accountSections = [...defaultSettings.accountSections];
      }
      if (!merged.csvColumnMappings) {
        merged.csvColumnMappings = {};
      }
      return merged;
    }
  } catch (error) {
    console.error("Erreur lors du chargement des paramètres:", error);
  }
  return defaultSettings;
};

export const saveUserSettings = (
  username: string,
  settings: UserSettings,
): void => {
  try {
    localStorage.setItem(`user_settings_${username}`, JSON.stringify(settings));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("userSettingsUpdated", { detail: { username } }),
      );
    }
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des paramètres:", error);
  }
};

export const getSetting = (
  username: string,
  key: keyof UserSettings,
): UserSettings[keyof UserSettings] => {
  const settings = getUserSettings(username);
  return settings[key] || defaultSettings[key];
};

export const setSetting = <K extends keyof UserSettings>(
  username: string,
  key: K,
  value: UserSettings[K],
): void => {
  const settings = getUserSettings(username);
  settings[key] = value;
  saveUserSettings(username, settings);
};

// Fonctions utilitaires pour les clés API
export const getBinanceApiKey = (username: string): string => {
  return getSetting(username, "binanceApiKey") as string;
};

export const getBinanceSecretKey = (username: string): string => {
  return getSetting(username, "binanceSecretKey") as string;
};

export const getGeminiApiKey = (username: string): string => {
  return getSetting(username, "geminiApiKey") as string;
};

export const getEtherscanApiKey = (username: string): string => {
  return getSetting(username, "etherscanApiKey") as string;
};

export const getCoinGeckoApiKey = (username: string): string => {
  return getSetting(username, "coinGeckoApiKey") as string;
};

export const getOpenSeaApiKey = (username: string): string => {
  return getSetting(username, "openSeaApiKey") as string;
};

export const getCustomApiEndpoint = (username: string): string => {
  return getSetting(username, "customApiEndpoint") as string;
};

export const getUserTheme = (username: string): "light" | "dark" | "auto" => {
  const theme = getSetting(username, "theme") as string;
  if (theme === "light" || theme === "dark" || theme === "auto") {
    return theme as "light" | "dark" | "auto";
  }
  return "auto";
};

export const getUserCurrency = (username: string): string => {
  return getSetting(username, "currency") as string;
};

export const getUserLanguage = (username: string): string => {
  return getSetting(username, "language") as string;
};
