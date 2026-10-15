export interface AccentColorDef {
  id: string;
  name: string;
  hex: string;
  rgb: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
    950: string;
  };
}

export const ACCENT_COLORS: AccentColorDef[] = [
  {
    id: "blue",
    name: "Bleu Océan",
    hex: "#3b82f6",
    rgb: {
      50: "239 246 255",
      100: "219 234 254",
      200: "191 219 254",
      300: "147 197 253",
      400: "96 165 250",
      500: "59 130 246",
      600: "37 99 235",
      700: "29 78 216",
      800: "30 64 175",
      900: "30 58 138",
      950: "23 37 84",
    },
  },
  {
    id: "emerald",
    name: "Vert Émeraude",
    hex: "#10b981",
    rgb: {
      50: "236 253 245",
      100: "209 250 229",
      200: "167 243 208",
      300: "110 231 183",
      400: "52 211 153",
      500: "16 185 129",
      600: "5 150 105",
      700: "4 120 87",
      800: "6 95 70",
      900: "6 78 59",
      950: "2 44 34",
    },
  },
  {
    id: "purple",
    name: "Violet Améthyste",
    hex: "#8b5cf6",
    rgb: {
      50: "245 243 255",
      100: "237 233 254",
      200: "221 214 254",
      300: "196 181 253",
      400: "167 139 250",
      500: "139 92 246",
      600: "124 58 237",
      700: "109 40 217",
      800: "91 33 182",
      900: "76 29 149",
      950: "46 16 101",
    },
  },
  {
    id: "rose",
    name: "Rose Pivoine",
    hex: "#f43f5e",
    rgb: {
      50: "255 241 242",
      100: "255 228 230",
      200: "254 205 211",
      300: "253 164 175",
      400: "251 113 133",
      500: "244 63 94",
      600: "225 29 72",
      700: "190 18 60",
      800: "159 18 57",
      900: "136 19 55",
      950: "76 5 25",
    },
  },
  {
    id: "amber",
    name: "Ambre & Or",
    hex: "#f59e0b",
    rgb: {
      50: "255 251 235",
      100: "254 243 199",
      200: "253 230 138",
      300: "252 211 77",
      400: "251 191 36",
      500: "245 158 11",
      600: "217 119 6",
      700: "180 83 9",
      800: "146 64 14",
      900: "120 53 15",
      950: "69 26 3",
    },
  },
  {
    id: "cyan",
    name: "Cyan & Lagon",
    hex: "#06b6d4",
    rgb: {
      50: "236 254 255",
      100: "207 250 254",
      200: "165 243 252",
      300: "103 232 249",
      400: "34 211 238",
      500: "6 182 212",
      600: "8 145 178",
      700: "14 116 144",
      800: "21 94 117",
      900: "22 78 99",
      950: "8 51 68",
    },
  },
  {
    id: "indigo",
    name: "Indigo Royal",
    hex: "#6366f1",
    rgb: {
      50: "238 242 255",
      100: "224 231 255",
      200: "199 210 254",
      300: "165 180 252",
      400: "129 140 248",
      500: "99 102 241",
      600: "79 70 229",
      700: "67 56 202",
      800: "55 48 163",
      900: "49 46 129",
      950: "30 27 75",
    },
  },
  {
    id: "red",
    name: "Rouge Rubis",
    hex: "#ef4444",
    rgb: {
      50: "254 242 242",
      100: "254 226 226",
      200: "254 202 202",
      300: "252 165 165",
      400: "248 113 113",
      500: "239 68 68",
      600: "220 38 38",
      700: "185 28 28",
      800: "153 27 27",
      900: "127 29 29",
      950: "69 10 10",
    },
  },
];

export const DEFAULT_ACCENT_COLOR = "blue";

export const getAccentColorDef = (colorIdOrHex?: string): AccentColorDef => {
  if (!colorIdOrHex) return ACCENT_COLORS[0];
  const found = ACCENT_COLORS.find(
    (c) =>
      c.id.toLowerCase() === colorIdOrHex.toLowerCase() ||
      c.hex.toLowerCase() === colorIdOrHex.toLowerCase()
  );
  if (found) return found;

  // Fallback if custom hex was passed
  if (colorIdOrHex.startsWith("#")) {
    const hex = colorIdOrHex;
    // convert hex to rgb
    const cleanHex = hex.replace("#", "");
    const r = parseInt(cleanHex.substring(0, 2), 16) || 59;
    const g = parseInt(cleanHex.substring(2, 4), 16) || 130;
    const b = parseInt(cleanHex.substring(4, 6), 16) || 246;
    const rgbStr = `${r} ${g} ${b}`;
    return {
      id: "custom",
      name: "Personnalisé",
      hex,
      rgb: {
        50: rgbStr,
        100: rgbStr,
        200: rgbStr,
        300: rgbStr,
        400: rgbStr,
        500: rgbStr,
        600: rgbStr,
        700: rgbStr,
        800: rgbStr,
        900: rgbStr,
        950: rgbStr,
      },
    };
  }

  return ACCENT_COLORS[0];
};

export const getUserAccentColor = (username: string): string => {
  if (!username) return DEFAULT_ACCENT_COLOR;
  try {
    const stored = localStorage.getItem(`user_settings_${username}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.accentColor) return parsed.accentColor;
    }
  } catch (error) {
    console.error("Erreur lors de la lecture de la couleur utilisateur:", error);
  }

  // Sensible default for Sophie = emerald if not set, Romain = blue
  if (username.toLowerCase().includes("sophie")) {
    return "emerald";
  }
  return DEFAULT_ACCENT_COLOR;
};

export const applyUserTheme = (colorIdOrHex: string): void => {
  if (typeof document === "undefined") return;
  const def = getAccentColorDef(colorIdOrHex);
  const root = document.documentElement;

  root.style.setProperty("--color-primary-50", def.rgb[50]);
  root.style.setProperty("--color-primary-100", def.rgb[100]);
  root.style.setProperty("--color-primary-200", def.rgb[200]);
  root.style.setProperty("--color-primary-300", def.rgb[300]);
  root.style.setProperty("--color-primary-400", def.rgb[400]);
  root.style.setProperty("--color-primary-500", def.rgb[500]);
  root.style.setProperty("--color-primary-600", def.rgb[600]);
  root.style.setProperty("--color-primary-700", def.rgb[700]);
  root.style.setProperty("--color-primary-800", def.rgb[800]);
  root.style.setProperty("--color-primary-900", def.rgb[900]);
  root.style.setProperty("--color-primary-950", def.rgb[950]);
  root.style.setProperty("--color-primary-hex", def.hex);
};

import type React from "react";

export interface PersonTheme {
  id: string;
  name: string;
  hex: string;
  rgb500: string;
  cardStyle: React.CSSProperties;
  badgeStyle: React.CSSProperties;
  textStyle: React.CSSProperties;
  dotStyle: React.CSSProperties;
  barStyle: React.CSSProperties;
  tabActiveStyle: React.CSSProperties;
}

export const getPersonTheme = (
  colorIdOrHex: string,
  personName: string = "Personne"
): PersonTheme => {
  const def = getAccentColorDef(colorIdOrHex);
  const rgbComma = def.rgb[500].replace(/ /g, ", ");
  return {
    id: def.id,
    name: personName,
    hex: def.hex,
    rgb500: def.rgb[500],
    cardStyle: {
      backgroundColor: `rgba(${rgbComma}, 0.07)`,
      borderColor: `rgba(${rgbComma}, 0.35)`,
    },
    badgeStyle: {
      backgroundColor: `rgba(${rgbComma}, 0.15)`,
      color: def.hex,
    },
    textStyle: {
      color: def.hex,
    },
    dotStyle: {
      backgroundColor: def.hex,
    },
    barStyle: {
      backgroundColor: def.hex,
    },
    tabActiveStyle: {
      color: def.hex,
      borderColor: def.hex,
    },
  };
};
