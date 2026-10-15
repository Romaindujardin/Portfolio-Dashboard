import { parseCsv } from "./csv";
import type {
  BankCsvColumnMapping,
  InvestmentCsvColumnMapping,
} from "../types";
import {
  format,
  parseISO,
  isValid,
  startOfWeek,
  startOfMonth,
  startOfYear,
} from "date-fns";

export type TimeGranularity = "day" | "week" | "month" | "year";

export type ParsedTransaction = {
  date: Date;
  amount: number;
  category: string;
  subCategory: string;
  accountBalance?: number;
  label?: string;
  supplierFound?: string;
  comment?: string;
};

export type PeaHolding = {
  name: string;
  isin: string;
  quantity: number;
  buyingPrice?: number;
  lastPrice?: number;
  amount: number;
  amountVariation?: number;
  variationPercent?: number;
  lastMovementDate?: Date;
};

export type CashflowPoint = {
  key: string; // e.g. 2025-12-30 / 2025-W01 / 2025-12 / 2025
  date: Date; // group start
  income: number;
  expenses: number; // positive number
  net: number; // income - expenses
  endingBalance?: number;
};

export function parseFrenchNumber(
  raw: string | undefined | null,
): number | null {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/\s/g, "")
    .replace("€", "")
    .replace("$", "")
    .replace("£", "")
    .replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseAnyDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  // ISO date
  const d1 = parseISO(raw);
  if (isValid(d1)) return d1;
  // fallback
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return new Date(t);
  return null;
}

function groupStart(date: Date, g: TimeGranularity): Date {
  if (g === "day")
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (g === "week") return startOfWeek(date, { weekStartsOn: 1 });
  if (g === "month") return startOfMonth(date);
  return startOfYear(date);
}

function groupKey(date: Date, g: TimeGranularity): string {
  const d = groupStart(date, g);
  if (g === "day") return format(d, "yyyy-MM-dd");
  if (g === "week") return format(d, "RRRR-'W'II");
  if (g === "month") return format(d, "yyyy-MM");
  return format(d, "yyyy");
}

export function getTimeBucketKey(date: Date, g: TimeGranularity): string {
  return groupKey(date, g);
}

// Helper to normalize strings for robust column comparison
function normalizeCol(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Helper to get case-insensitive column value with smart fuzzy candidates
function findBestColumnValue(
  row: Record<string, string>,
  explicitKey?: string,
  candidates: string[] = [],
  excludes: string[] = [],
): string | undefined {
  if (explicitKey) {
    const val = getColumnValue(row, explicitKey);
    if (val !== undefined && val.trim() !== "") return val;
  }
  // 1. Exact match on normalized candidate
  for (const cand of candidates) {
    const normC = normalizeCol(cand);
    for (const k in row) {
      const normK = normalizeCol(k);
      if (excludes.some((ex) => normK.includes(normalizeCol(ex)))) continue;
      if (normK === normC && row[k]?.trim() !== "") return row[k];
    }
  }
  // 2. Contains match on normalized candidate
  for (const cand of candidates) {
    const normC = normalizeCol(cand);
    for (const k in row) {
      const normK = normalizeCol(k);
      if (excludes.some((ex) => normK.includes(normalizeCol(ex)))) continue;
      if (normK.includes(normC) && row[k]?.trim() !== "") return row[k];
    }
  }
  return undefined;
}

// Helper to get case-insensitive column value
function getColumnValue(
  row: Record<string, string>,
  key: string,
): string | undefined {
  const lowerKey = key.toLowerCase();
  // Try exact match first
  if (row[key] !== undefined) return row[key];
  // Try case-insensitive match
  for (const k in row) {
    if (k.toLowerCase() === lowerKey) return row[k];
  }
  return undefined;
}

export function sumNumericColumn(
  csvText: string,
  column?: string,
  multiplierColumn?: string,
): number | null {
  if (!column) return null;
  const parsed = parseCsv(csvText || "");
  if (!parsed.rows.length) return null;
  let total = 0;
  let used = 0;
  for (const row of parsed.rows) {
    const raw = getColumnValue(row, column);
    const value = parseFrenchNumber(raw);
    if (value == null) continue;
    let multiplier = 1;
    if (multiplierColumn) {
      const rawMultiplier = getColumnValue(row, multiplierColumn);
      const parsedMultiplier = parseFrenchNumber(rawMultiplier);
      if (parsedMultiplier == null) continue;
      multiplier = parsedMultiplier;
    }
    total += value * multiplier;
    used++;
  }
  return used > 0 ? total : null;
}

export function parseBankCsvTransactions(
  csvText: string,
  mapping?: BankCsvColumnMapping,
): ParsedTransaction[] {
  const parsed = parseCsv(csvText || "");
  const rows = parsed.rows;

  const txs: ParsedTransaction[] = [];
  for (const r of rows) {
    // Use DATEOP as primary date column (case-insensitive)
    let date =
      (mapping?.date ? parseAnyDate(getColumnValue(r, mapping.date)) : null) ||
      parseAnyDate(getColumnValue(r, "DATEOP")) ||
      parseAnyDate(getColumnValue(r, "dateOp")) ||
      parseAnyDate(getColumnValue(r, "dateVal")) ||
      parseAnyDate(getColumnValue(r, "date")) ||
      null;

    const ref =
      (mapping && "reference" in mapping
        ? getColumnValue(r, (mapping as any).reference)
        : undefined) ||
      getColumnValue(r, "reference") ||
      getColumnValue(r, "REFERENCE");

    if (ref && /^[0-9a-f]{24}$/i.test(ref)) {
      const ts = parseInt(ref.substring(0, 8), 16) * 1000;
      if (!isNaN(ts)) {
        if (!date) {
          date = new Date(ts);
        } else {
          // If date is significantly ahead (> 15 days) of the Boursorama ObjectId timestamp,
          // it indicates a fallback date (e.g. today) assigned when date parsing failed
          const diffDays = (date.getTime() - ts) / (1000 * 3600 * 24);
          if (diffDays > 15) {
            date = new Date(ts);
          }
        }
      }
    }

    const amount = parseFrenchNumber(
      (mapping?.amount ? getColumnValue(r, mapping.amount) : undefined) ||
        getColumnValue(r, "amount") ||
        getColumnValue(r, "AMOUNT"),
    );
    if (!date || amount == null) continue;

    // IMPORTANT: only rely on AI categories from CSV (aiCategory/aiSubCategory)
    const category =
      (
        (mapping?.category
          ? getColumnValue(r, mapping.category)
          : getColumnValue(r, "aiCategory")) || ""
      ).trim() || "Non catégorisé";
    const subCategory =
      (
        (mapping?.subCategory
          ? getColumnValue(r, mapping.subCategory)
          : getColumnValue(r, "aiSubCategory")) || ""
      ).trim() || "Non catégorisé";

    const balance = parseFrenchNumber(
      (mapping?.balance ? getColumnValue(r, mapping.balance) : undefined) ||
        getColumnValue(r, "accountbalance") ||
        getColumnValue(r, "ACCOUNTBALANCE"),
    );

    txs.push({
      date,
      amount,
      category,
      subCategory,
      accountBalance: balance ?? undefined,
      label:
        (
          (mapping?.label
            ? getColumnValue(r, mapping.label)
            : getColumnValue(r, "label")) || ""
        ).trim() || undefined,
      supplierFound:
        (
          (mapping?.supplierFound
            ? getColumnValue(r, mapping.supplierFound)
            : getColumnValue(r, "supplierFound")) || ""
        ).trim() || undefined,
      comment:
        (
          (mapping?.comment
            ? getColumnValue(r, mapping.comment)
            : getColumnValue(r, "comment")) || ""
        ).trim() || undefined,
    });
  }

  // Sort by date, and if identical date, maintain balance-consistent sequence
  txs.sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    if (d !== 0) return d;
    if (a.accountBalance != null && b.accountBalance != null) {
      if (
        Math.abs(
          Math.round((a.accountBalance + b.amount) * 100) -
            Math.round(b.accountBalance * 100),
        ) <= 1
      ) {
        return -1;
      }
      if (
        Math.abs(
          Math.round((b.accountBalance + a.amount) * 100) -
            Math.round(a.accountBalance * 100),
        ) <= 1
      ) {
        return 1;
      }
    }
    return 0;
  });
  return txs;
}

export function parsePeaCsvHoldings(
  csvText: string,
  mapping?: InvestmentCsvColumnMapping,
): PeaHolding[] {
  const parsed = parseCsv(csvText || "");
  const rows = parsed.rows;

  const holdings: PeaHolding[] = [];
  for (const r of rows) {
    const name = (
      findBestColumnValue(r, mapping?.name, [
        "libellesupport",
        "libelle",
        "support",
        "nom",
        "valeur",
        "titre",
        "designation",
        "name",
        "description",
        "instrument",
      ]) || ""
    ).trim();

    const isin = (
      findBestColumnValue(r, mapping?.isin, [
        "isin",
        "codeisin",
        "code",
        "symbole",
        "ticker",
        "symbol",
      ]) || ""
    ).trim();

    let amount =
      parseFrenchNumber(
        findBestColumnValue(r, mapping?.amount, [
          "encours",
          "valorisation",
          "montant",
          "solde",
          "valeurtotale",
          "amount",
          "total",
          "value",
        ]),
      ) ?? 0;

    let quantity =
      parseFrenchNumber(
        findBestColumnValue(r, mapping?.quantity, [
          "nbdeparts",
          "nombredeparts",
          "nbparts",
          "parts",
          "quantite",
          "quantity",
          "qte",
          "nombre",
          "titres",
          "qty",
        ]),
      ) ?? 0;

    let lastPrice = parseFrenchNumber(
      findBestColumnValue(
        r,
        mapping?.lastPrice,
        [
          "valactuelle",
          "valeuractuelle",
          "derniercours",
          "coursactuel",
          "lastprice",
          "prixactuel",
          "vl",
          "valeurliquidative",
        ],
        ["encours", "pru", "revient", "achat"],
      ),
    );

    let buyingPrice = parseFrenchNumber(
      findBestColumnValue(r, mapping?.buyingPrice, [
        "prixderevient",
        "pru",
        "coursdachat",
        "prixdachat",
        "prixmoyen",
        "buyingprice",
        "purchaseprice",
      ]),
    );

    let variationPercent = parseFrenchNumber(
      findBestColumnValue(r, mapping?.variation, [
        "performance",
        "rendement",
        "variation",
        "perf",
        "plusvalue",
      ]),
    );

    let amountVariation = parseFrenchNumber(
      findBestColumnValue(r, mapping?.amountVariation, [
        "plusmoinsvalue",
        "plusvalue",
        "pv",
        "amountvariation",
        "gain",
      ]),
    );

    // Si la ligne n'a ni nom ni ISIN, ignorer
    if (!name && !isin) continue;

    // Gestion intelligente des Fonds Euro / supports avec Encours seul (sans parts ni cours)
    if (amount > 0 && quantity === 0) {
      if (lastPrice != null && lastPrice > 0) {
        quantity = amount / lastPrice;
      } else {
        quantity = 1;
        lastPrice = amount;
        if (buyingPrice == null) buyingPrice = amount;
      }
    } else if (quantity > 0 && amount === 0 && lastPrice != null) {
      amount = quantity * lastPrice;
    }

    if (lastPrice == null && quantity > 0 && amount > 0) {
      lastPrice = amount / quantity;
    }

    // Calcul de la plus-value si non fournie directement
    if (amountVariation == null) {
      if (buyingPrice != null && quantity > 0) {
        amountVariation = amount - buyingPrice * quantity;
      } else if (variationPercent != null && amount > 0) {
        const initial = amount / (1 + variationPercent / 100);
        amountVariation = amount - initial;
      }
    }

    // Calcul du % de performance si non fourni directement
    if (variationPercent == null && buyingPrice != null && lastPrice != null && buyingPrice > 0) {
      variationPercent = ((lastPrice - buyingPrice) / buyingPrice) * 100;
    }

    holdings.push({
      name: name || isin || "Position",
      isin,
      quantity,
      buyingPrice,
      lastPrice,
      amount,
      amountVariation,
      variationPercent,
      lastMovementDate: parseAnyDate(
        mapping?.lastMovementDate
          ? getColumnValue(r, mapping.lastMovementDate)
          : getColumnValue(r, "lastMovementDate"),
      ) ?? undefined,
    });
  }

  // Sort by amount desc
  holdings.sort((a, b) => b.amount - a.amount);
  return holdings;
}

export function buildCashflowSeries(
  txs: ParsedTransaction[],
  g: TimeGranularity,
): CashflowPoint[] {
  if (txs.length === 0) return [];

  // Trouver la date la plus ancienne
  const oldestDate = txs.reduce(
    (oldest, t) => (t.date < oldest ? t.date : oldest),
    txs[0].date,
  );

  // Date de début : début de la période de la date la plus ancienne
  const startDate = groupStart(oldestDate, g);
  // Date de fin : aujourd'hui
  const endDate = new Date();
  // Date de fin : début de la période d'aujourd'hui (inclure la période actuelle)
  const endPeriodStart = groupStart(endDate, g);

  // Générer tous les buckets entre startDate et endPeriodStart
  const map = new Map<string, CashflowPoint>();
  const current = new Date(startDate);

  while (current <= endPeriodStart) {
    const key = groupKey(current, g);
    const periodStart = new Date(groupStart(current, g));

    // Créer le bucket s'il n'existe pas déjà
    if (!map.has(key)) {
      map.set(key, { key, date: periodStart, income: 0, expenses: 0, net: 0 });
    }

    // Avancer à la période suivante selon la granularité
    if (g === "day") {
      current.setDate(current.getDate() + 1);
    } else if (g === "week") {
      current.setDate(current.getDate() + 7);
    } else if (g === "month") {
      current.setMonth(current.getMonth() + 1);
    } else if (g === "year") {
      current.setFullYear(current.getFullYear() + 1);
    }
  }

  // Remplir les buckets avec les données des transactions
  for (const t of txs) {
    const key = groupKey(t.date, g);
    const p = map.get(key);
    if (!p) continue; // Ne devrait pas arriver, mais sécurité

    if (t.amount >= 0) p.income += t.amount;
    else p.expenses += Math.abs(t.amount);
    p.net = p.income - p.expenses;

    // ending balance: keep the last non-null balance in the group
    if (t.accountBalance != null) {
      p.endingBalance = t.accountBalance;
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

export function aggregateByCategory(txs: ParsedTransaction[]) {
  const map = new Map<
    string,
    {
      category: string;
      subCategory: string;
      income: number;
      expenses: number;
      net: number;
    }
  >();

  for (const t of txs) {
    const k = `${t.category}|||${t.subCategory}`;
    if (!map.has(k)) {
      map.set(k, {
        category: t.category,
        subCategory: t.subCategory,
        income: 0,
        expenses: 0,
        net: 0,
      });
    }
    const a = map.get(k)!;
    if (t.amount >= 0) a.income += t.amount;
    else a.expenses += Math.abs(t.amount);
    a.net = a.income - a.expenses;
  }

  return Array.from(map.values()).sort((a, b) => b.expenses - a.expenses);
}

export function latestBalance(txs: ParsedTransaction[]): number | null {
  for (let i = txs.length - 1; i >= 0; i--) {
    const b = txs[i].accountBalance;
    if (b != null) return b;
  }
  return null;
}
