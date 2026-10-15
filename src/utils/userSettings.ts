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
  accentColor?: string;
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
    { id: "assurance-vie", label: "Assurance vie", kind: "investment" },
  ],
  csvColumnMappings: {},
  boursoClientId: "",
  boursoAccountMappings: [],
  theme: "auto",
  currency: "USD",
  language: "fr",
  accentColor: "blue",
};

export const getUserSettings = (username: string): UserSettings => {
  try {
    const stored = localStorage.getItem(`user_settings_${username}`);
    if (stored) {
      const parsedSettings = JSON.parse(stored);
      const merged = { ...defaultSettings, ...parsedSettings } as UserSettings;
      if (!merged.accentColor) {
        merged.accentColor = username.toLowerCase().includes("sophie") ? "emerald" : "blue";
      }
      if (
        !Array.isArray(merged.accountSections) ||
        !merged.accountSections.length
      ) {
        merged.accountSections = [...defaultSettings.accountSections];
      } else {
        // Nettoyer automatiquement l'éventuel "per" injecté précédemment par erreur
        if (merged.accountSections.some((s) => s.id === "per")) {
          merged.accountSections = merged.accountSections.filter(
            (s) => s.id !== "per",
          );
          try {
            localStorage.setItem(
              `user_settings_${username}`,
              JSON.stringify(merged),
            );
          } catch (e) {
            console.error("Erreur lors de la mise à jour des paramètres:", e);
          }
        }
      }
      if (!merged.csvColumnMappings) {
        merged.csvColumnMappings = {};
      }
      return merged;
    }
  } catch (error) {
    console.error("Erreur lors du chargement des paramètres:", error);
  }
  return {
    ...defaultSettings,
    accentColor: username.toLowerCase().includes("sophie") ? "emerald" : "blue",
  };
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
    // Sauvegarder sur la base de données et disque
    pushUserSettingsToDatabase(username, settings);
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des paramètres:", error);
  }
};

const SETTINGS_API_BASE = "http://localhost:3001/api/database/user-settings";

export const fetchUserSettingsFromDatabase = async (
  username: string = "Romain"
): Promise<UserSettings | null> => {
  try {
    const res = await fetch(
      `${SETTINGS_API_BASE}?user_id=${encodeURIComponent(username)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.settings || null;
  } catch (e) {
    console.warn("Impossible de récupérer les paramètres utilisateur depuis le serveur:", e);
    return null;
  }
};

export const pushUserSettingsToDatabase = async (
  username: string = "Romain",
  settings?: UserSettings
): Promise<boolean> => {
  try {
    const stg = settings || getUserSettings(username);
    const res = await fetch(SETTINGS_API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: stg, userId: username }),
    });
    return res.ok;
  } catch (e) {
    console.warn("Impossible de pousser les paramètres utilisateur vers le serveur:", e);
    return false;
  }
};

export const syncUserSettingsWithDatabase = async (
  username: string = "Romain"
): Promise<void> => {
  try {
    const serverSettings = await fetchUserSettingsFromDatabase(username);
    const localRaw =
      typeof window !== "undefined"
        ? localStorage.getItem(`user_settings_${username}`)
        : null;

    if (localRaw) {
      pushUserSettingsToDatabase(username);
    } else if (serverSettings) {
      localStorage.setItem(
        `user_settings_${username}`,
        JSON.stringify(serverSettings)
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("userSettingsUpdated", { detail: { username } })
        );
      }
    }
  } catch (e) {
    console.error("Erreur syncUserSettingsWithDatabase:", e);
  }
};

if (typeof window !== "undefined") {
  setTimeout(() => {
    syncUserSettingsWithDatabase("Romain");
  }, 120);
}

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
