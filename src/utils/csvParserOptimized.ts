// Parseur CSV ultra-optimisé inspiré de Picsou (détection automatique dialecte, décimales, dates et auto-mapping).
// Supporte les exports d'Épargne Salariale (Natixis, Amundi), de banques privées (Gresham), de courtiers (PEA, CTO) et de comptes bancaires.

export interface CsvDialect {
  delimiter: string;
  decimalStyle: "COMMA" | "DOT";
  dateFormat: string;
  hasHeader: boolean;
}

export type CsvMode = "HOLDINGS" | "TRANSACTIONS";

export interface HoldingImportItem {
  name: string;
  isin?: string | null;
  ticker?: string | null;
  quantity: number;
  price: number;
  costBasis?: number | null;
  value?: number | null;
  raw?: Record<string, string>;
}

export interface TransactionImportItem {
  date: string;
  label: string;
  amount: number;
  category?: string | null;
  valueDate?: string | null;
  raw?: Record<string, string>;
}

const DELIMITER_CANDIDATES = [";", ",", "\t", "|"];

const DATE_PATTERNS = [
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "DD.MM.YYYY",
  "MM/DD/YYYY",
  "YYYY/MM/DD",
];

const COMMA_DECIMAL_REGEX = /^[+-]?(?:\d{1,3}(?:[ \u00a0.]\d{3})*|\d+),\d+(?:\s*[%€$£])?$/;
const DOT_DECIMAL_REGEX = /^[+-]?(?:\d{1,3}(?:[ \u00a0,]\d{3})*|\d+)\.\d+(?:\s*[%€$£])?$/;

/**
 * Découpe une ligne CSV selon la RFC-4180 avec gestion des guillemets doubles et échappements.
 */
export function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

/**
 * Découpe l'ensemble d'un texte CSV en tableau 2D de cellules.
 */
export function parseRawCsv(content: string, delimiter: string): string[][] {
  const clean = (content || "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  return lines.map((l) => parseCsvLine(l, delimiter));
}

/**
 * Détecte automatiquement le délimiteur du fichier CSV.
 */
export function detectDelimiter(content: string): string {
  if (!content) return ";";
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ";";

  let best = ";";
  let maxCount = -1;

  for (const delim of DELIMITER_CANDIDATES) {
    let count = 0;
    for (const line of lines) {
      count += (line.split(delim).length - 1);
    }
    if (count > maxCount) {
      maxCount = count;
      best = delim;
    }
  }

  return best;
}

/**
 * Détecte le séparateur décimal (virgule française vs point US).
 */
export function detectDecimalStyle(rows: string[][]): "COMMA" | "DOT" {
  let comma = 0;
  let dot = 0;

  for (const row of rows.slice(0, 40)) {
    for (const cell of row) {
      const trimmed = (cell || "").trim();
      if (COMMA_DECIMAL_REGEX.test(trimmed)) comma++;
      else if (DOT_DECIMAL_REGEX.test(trimmed)) dot++;
    }
  }

  return comma >= dot ? "COMMA" : "DOT";
}

/**
 * Détecte le format de date prédominant dans le CSV.
 */
export function detectDateFormat(rows: string[][]): string {
  const counts: Record<string, number> = {};
  for (const p of DATE_PATTERNS) counts[p] = 0;

  const sample = rows.slice(0, 40);
  for (const row of sample) {
    for (const cell of row) {
      const c = (cell || "").trim();
      if (!c) continue;

      if (/^\d{2}\/\d{2}\/\d{4}$/.test(c)) counts["DD/MM/YYYY"]++;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(c)) counts["YYYY-MM-DD"]++;
      else if (/^\d{2}-\d{2}-\d{4}$/.test(c)) counts["DD-MM-YYYY"]++;
      else if (/^\d{2}\.\d{2}\.\d{4}$/.test(c)) counts["DD.MM.YYYY"]++;
      else if (/^\d{4}\/\d{2}\/\d{2}$/.test(c)) counts["YYYY/MM/DD"]++;
    }
  }

  let best = "DD/MM/YYYY";
  let max = 0;
  for (const [p, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      best = p;
    }
  }
  return best;
}

/**
 * Détecte l'ensemble du dialecte d'un CSV.
 */
export function detectCsvDialect(content: string): CsvDialect {
  const delimiter = detectDelimiter(content);
  const rows = parseRawCsv(content, delimiter);
  const decimalStyle = detectDecimalStyle(rows);
  const dateFormat = detectDateFormat(rows);
  const hasHeader = rows.length > 0;

  return {
    delimiter,
    decimalStyle,
    dateFormat,
    hasHeader,
  };
}

/**
 * Nettoie une chaîne numérique vers un nombre Javascript valide.
 */
export function parseNumericValue(value: string | null | undefined, decimalStyle: "COMMA" | "DOT" = "COMMA"): number {
  if (value == null) return 0;
  let str = String(value).trim();
  if (!str) return 0;

  // Détection des parenthèses comptables (100.00) -> -100.00
  let isNegative = false;
  if (/^\(.*\)$/.test(str)) {
    isNegative = true;
    str = str.replace(/[()]/g, "");
  }

  // Retrait des devises et caractères non numériques (sauf virgule, point, moins, plus)
  str = str.replace(/[€$£CHF%]/gi, "").trim();

  // Suppression des espaces de milliers (espaces insécables \u00a0, espaces standard, etc.)
  str = str.replace(/[\s\u00a0\u202f]/g, "");

  if (decimalStyle === "COMMA") {
    // Dans le style virgule : les points sont des séparateurs de milliers
    str = str.replace(/\./g, "").replace(",", ".");
  } else {
    // Dans le style point : les virgules sont des séparateurs de milliers
    str = str.replace(/,/g, "");
  }

  const num = parseFloat(str);
  if (isNaN(num)) return 0;
  return isNegative ? -Math.abs(num) : num;
}

/**
 * Convertit une date textuelle selon son format vers ISO YYYY-MM-DD.
 */
export function parseDateValue(value: string | null | undefined, format = "DD/MM/YYYY"): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  if (format === "DD/MM/YYYY" || format === "DD-MM-YYYY" || format === "DD.MM.YYYY") {
    const parts = str.split(/[/.-]/);
    if (parts.length === 3) {
      const day = parts[0].padStart(2, "0");
      const month = parts[1].padStart(2, "0");
      let year = parts[2];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    }
  }

  if (format === "MM/DD/YYYY") {
    const parts = str.split(/[/.-]/);
    if (parts.length === 3) {
      const month = parts[0].padStart(2, "0");
      const day = parts[1].padStart(2, "0");
      let year = parts[2];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalise un nom de colonne pour la recherche d'alias (retire accents, ponctuation).
 */
const normalizeHeaderKey = (h: string): string =>
  (h || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Dictionnaires d'alias de colonnes (France / International)
const HOLDINGS_ALIASES: Record<string, string[]> = {
  name: [
    "nom du support", "libelle du support", "libelle support", "nom du fonds", "fonds",
    "nom du titre", "titre", "designation", "libelle", "description", "nom valeur",
    "nom", "support",
  ],
  isin: ["isin", "code isin", "code", "code valeur", "ticker", "symbole", "symbol", "mnemo"],
  quantity: [
    "nb de parts", "nombre de parts", "quantite de parts", "nb parts", "quantite",
    "solde parts", "avoir en parts", "parts", "nombre", "qty", "quantity",
  ],
  amount: [
    "encours", "encours total", "encours valorise", "valeur marchande", "valeur atteinte",
    "avoir en euros", "montant total", "montant brut", "montant net", "valorisation",
    "evaluation", "montant", "solde", "avoir", "total",
  ],
  price: [
    "val actuelle", "valeur actuelle", "valeur liquidative", "dernier cours", "cours du jour",
    "cours de cloture", "valeur de la part", "valeur part", "prix unitaire", "cours", "vl",
    "prix", "pu",
  ],
  costBasis: [
    "prix de revient", "prix de revient unitaire", "pru", "montant investi", "prix d achat",
    "prix achat", "versements", "cumul versements",
  ],
};

const TRANSACTIONS_ALIASES: Record<string, string[]> = {
  date: [
    "date", "date operation", "date op", "date de valeur", "date valeur", "date comptable",
    "date d operation", "date execution",
  ],
  label: [
    "libelle", "operation", "libelle operation", "description", "details", "detail", "motif",
    "nature", "intitule", "wording",
  ],
  amount: ["montant", "montant net", "valeur", "total", "amount", "somme"],
  debit: ["debit", "depense", "depenses", "retrait", "sorties", "debits"],
  credit: ["credit", "recette", "revenu", "recettes", "versement", "versements", "credits"],
  category: ["categorie", "rubrique", "type", "famille", "classement"],
};

/**
 * Compare une clé normalisée à un alias sans faux positifs (ex: "encours" ne doit pas matcher "cours").
 */
const matchAlias = (key: string, alias: string): boolean => {
  if (key === alias) return true;
  const keyWords = key.split(/\s+/);
  const aliasWords = alias.split(/\s+/);

  if (aliasWords.length === 1) {
    return keyWords.includes(aliasWords[0]);
  }
  return key.includes(alias);
};

/**
 * Détecte si le fichier ressemble à des positions (Holdings) ou des transactions bancaires.
 */
export function detectCsvMode(headers: string[]): CsvMode {
  const normalized = headers.map(normalizeHeaderKey);
  let holdingsScore = 0;
  let txScore = 0;

  for (const h of normalized) {
    if (HOLDINGS_ALIASES.quantity.some((k) => matchAlias(h, k))) holdingsScore += 3;
    if (HOLDINGS_ALIASES.price.some((k) => matchAlias(h, k))) holdingsScore += 3;
    if (HOLDINGS_ALIASES.amount.some((k) => matchAlias(h, k))) holdingsScore += 2;
    if (HOLDINGS_ALIASES.isin.some((k) => matchAlias(h, k))) holdingsScore += 2;
    if (HOLDINGS_ALIASES.name.some((k) => matchAlias(h, k))) holdingsScore += 2;

    if (TRANSACTIONS_ALIASES.date.some((k) => matchAlias(h, k))) txScore += 2;
    if (TRANSACTIONS_ALIASES.debit.some((k) => matchAlias(h, k))) txScore += 3;
    if (TRANSACTIONS_ALIASES.credit.some((k) => matchAlias(h, k))) txScore += 3;
    if (TRANSACTIONS_ALIASES.label.some((k) => matchAlias(h, k))) txScore += 1;
  }

  return holdingsScore > txScore ? "HOLDINGS" : "TRANSACTIONS";
}

/**
 * Propose le mappage le plus pertinent entre colonnes du fichier et champs attendus.
 */
export function suggestColumnMapping(
  headers: string[],
  mode: CsvMode,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const aliases = mode === "HOLDINGS" ? HOLDINGS_ALIASES : TRANSACTIONS_ALIASES;
  const assigned = new Set<string>();

  // 1. Recherche exacte
  for (const [field, fieldAliases] of Object.entries(aliases)) {
    for (const header of headers) {
      if (assigned.has(header)) continue;
      const key = normalizeHeaderKey(header);
      if (fieldAliases.includes(key)) {
        mapping[field] = header;
        assigned.add(header);
        break;
      }
    }
  }

  // 2. Recherche par mot-clé intelligent (sans faux positifs)
  for (const [field, fieldAliases] of Object.entries(aliases)) {
    if (mapping[field]) continue;
    for (const header of headers) {
      if (assigned.has(header)) continue;
      const key = normalizeHeaderKey(header);
      if (fieldAliases.some((alias) => matchAlias(key, alias))) {
        mapping[field] = header;
        assigned.add(header);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Convertit les lignes brutes en objets métiers prêts à être importés.
 */
export function convertMappedRows(
  rows: string[][],
  headers: string[],
  mapping: Record<string, string>,
  dialect: CsvDialect,
  mode: CsvMode,
): Array<HoldingImportItem | TransactionImportItem> {
  const headerIdx = new Map(headers.map((h, i) => [h, i]));

  const getCell = (row: string[], field: string): string => {
    const colName = mapping[field];
    if (!colName) return "";
    const idx = headerIdx.get(colName);
    return idx != null && row[idx] != null ? row[idx] : "";
  };

  if (mode === "HOLDINGS") {
    const holdings: HoldingImportItem[] = [];
    for (const row of rows) {
      const name = getCell(row, "name");
      const isin = getCell(row, "isin");
      const qtyStr = getCell(row, "quantity");
      const priceStr = getCell(row, "price");
      const amountStr = getCell(row, "amount");
      const costBasisStr = getCell(row, "costBasis");

      if (!name && !isin) continue;

      const rawQty = parseNumericValue(qtyStr, dialect.decimalStyle);
      const rawPrice = parseNumericValue(priceStr, dialect.decimalStyle);
      const rawAmount = amountStr ? parseNumericValue(amountStr, dialect.decimalStyle) : 0;
      const costBasis = costBasisStr ? parseNumericValue(costBasisStr, dialect.decimalStyle) : null;

      if (rawQty <= 0 && rawPrice <= 0 && rawAmount <= 0) continue;

      let quantity = rawQty;
      let price = rawPrice;
      let value = rawAmount > 0 ? rawAmount : quantity * price;

      // Résolution cohérente pour fonds en euros ou lignes avec valorisation seule
      if (rawAmount > 0) {
        if (quantity <= 0 && price <= 0) {
          quantity = 1;
          price = rawAmount;
          value = rawAmount;
        } else if (quantity > 0 && price <= 0) {
          price = Math.round((rawAmount / quantity) * 100) / 100;
          value = rawAmount;
        } else if (price > 0 && quantity <= 0) {
          quantity = Math.round((rawAmount / price) * 10000) / 10000;
          value = rawAmount;
        }
      }

      holdings.push({
        name: name || isin || "Titre",
        isin: isin ? isin.trim().toUpperCase() : null,
        ticker: isin ? isin.trim().toUpperCase() : null,
        quantity,
        price,
        value,
        costBasis,
      });
    }
    return holdings;
  }

  const transactions: TransactionImportItem[] = [];
  for (const row of rows) {
    const dateStr = getCell(row, "date");
    const label = getCell(row, "label");
    const amountStr = getCell(row, "amount");
    const debitStr = getCell(row, "debit");
    const creditStr = getCell(row, "credit");
    const category = getCell(row, "category");

    if (!dateStr && !label && !amountStr && !debitStr && !creditStr) continue;

    let amount = 0;
    if (debitStr || creditStr) {
      const debit = Math.abs(parseNumericValue(debitStr, dialect.decimalStyle));
      const credit = Math.abs(parseNumericValue(creditStr, dialect.decimalStyle));
      amount = credit - debit;
    } else {
      amount = parseNumericValue(amountStr, dialect.decimalStyle);
    }

    transactions.push({
      date: parseDateValue(dateStr, dialect.dateFormat),
      label: label || "Opération",
      amount,
      category: category || null,
    });
  }
  return transactions;
}
