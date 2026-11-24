// Petites conversions partagées par les sidecars bancaires.

export const decodeHtmlEntities = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
};

export const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const nullableNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const isoDate = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
};

const ASSET_CLASS_MAP = {
  action: "EQUITY",
  actions: "EQUITY",
  equity: "EQUITY",
  stock: "EQUITY",
  fonds: "FUND",
  fund: "FUND",
  opcvm: "FUND",
  etf: "ETF",
  obligation: "BOND",
  obligations: "BOND",
  bond: "BOND",
  immobilier: "REAL_ESTATE",
  "real estate": "REAL_ESTATE",
  monetaire: "CASH",
  "monétaire": "CASH",
  cash: "CASH",
};

export const mapAssetClass = (value, fallback = "EQUITY") => {
  if (value == null) return fallback;
  const key = String(value).trim().toLowerCase();
  return ASSET_CLASS_MAP[key] || fallback;
};
