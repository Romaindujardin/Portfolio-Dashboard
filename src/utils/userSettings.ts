export interface UserSettings {
  binanceApiKey: string;
  binanceSecretKey: string;
  geminiApiKey: string;
  etherscanApiKey: string;
  coinGeckoApiKey: string;
  openSeaApiKey: string;
  customApiEndpoint: string;
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
  theme: "auto",
  currency: "USD",
  language: "fr",
};

export const getUserSettings = (username: string): UserSettings => {
  try {
    const stored = localStorage.getItem(`user_settings_${username}`);
    if (stored) {
      const parsedSettings = JSON.parse(stored);
      return { ...defaultSettings, ...parsedSettings };
    }
  } catch (error) {
    console.error("Erreur lors du chargement des paramètres:", error);
  }
  return defaultSettings;
};

export const saveUserSettings = (
  username: string,
  settings: UserSettings
): void => {
  try {
    localStorage.setItem(`user_settings_${username}`, JSON.stringify(settings));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des paramètres:", error);
  }
};

export const getSetting = (
  username: string,
  key: keyof UserSettings
): UserSettings[keyof UserSettings] => {
  const settings = getUserSettings(username);
  return settings[key] || defaultSettings[key];
};

export const setSetting = (
  username: string,
  key: keyof UserSettings,
  value: UserSettings[keyof UserSettings]
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
