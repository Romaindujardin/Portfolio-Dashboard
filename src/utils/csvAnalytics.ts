import { parseCsv } from "./csv";
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

export function parseFrenchNumber(raw: string | undefined | null): number | null {
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
  if (g === "day") return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

export function parseBankCsvTransactions(csvText: string): ParsedTransaction[] {
  const parsed = parseCsv(csvText || "");
  const rows = parsed.rows;

  const txs: ParsedTransaction[] = [];
  for (const r of rows) {
    const date =
      parseAnyDate(r.dateVal) ||
      parseAnyDate(r.dateOp) ||
      parseAnyDate(r.date) ||
      null;
    const amount = parseFrenchNumber(r.amount);
    if (!date || amount == null) continue;

    // IMPORTANT: only rely on AI categories from CSV (aiCategory/aiSubCategory)
    const category = (r.aiCategory || "").trim() || "Non catégorisé";
    const subCategory = (r.aiSubCategory || "").trim() || "Non catégorisé";

    const balance = parseFrenchNumber(r.accountbalance);

    txs.push({
      date,
      amount,
      category,
      subCategory,
      accountBalance: balance ?? undefined,
      label: (r.label || "").trim() || undefined,
      supplierFound: (r.supplierFound || "").trim() || undefined,
      comment: (r.comment || "").trim() || undefined,
    });
  }

  // Sort by date
  txs.sort((a, b) => a.date.getTime() - b.date.getTime());
  return txs;
}

export function parsePeaCsvHoldings(csvText: string): PeaHolding[] {
  const parsed = parseCsv(csvText || "");
  const rows = parsed.rows;

  const holdings: PeaHolding[] = [];
  for (const r of rows) {
    const name = (r.name || "").trim();
    const isin = (r.isin || "").trim();
    const quantity = parseFrenchNumber(r.quantity) ?? 0;
    const amount = parseFrenchNumber(r.amount) ?? 0;

    if (!name && !isin) continue;

    holdings.push({
      name: name || isin || "Position",
      isin,
      quantity,
      buyingPrice: parseFrenchNumber(r.buyingPrice) ?? undefined,
      lastPrice: parseFrenchNumber(r.lastPrice) ?? undefined,
      amount,
      amountVariation: parseFrenchNumber(r.amountVariation) ?? undefined,
      variationPercent: parseFrenchNumber(r.variation) ?? undefined,
      lastMovementDate: parseAnyDate(r.lastMovementDate) ?? undefined,
    });
  }

  // Sort by amount desc
  holdings.sort((a, b) => b.amount - a.amount);
  return holdings;
}

export function buildCashflowSeries(
  txs: ParsedTransaction[],
  g: TimeGranularity
): CashflowPoint[] {
  const map = new Map<string, CashflowPoint>();

  for (const t of txs) {
    const key = groupKey(t.date, g);
    const start = groupStart(t.date, g);
    if (!map.has(key)) {
      map.set(key, { key, date: start, income: 0, expenses: 0, net: 0 });
    }
    const p = map.get(key)!;
    if (t.amount >= 0) p.income += t.amount;
    else p.expenses += Math.abs(t.amount);
    p.net = p.income - p.expenses;

    // ending balance: keep the last non-null balance in the group
    if (t.accountBalance != null) {
      p.endingBalance = t.accountBalance;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function aggregateByCategory(txs: ParsedTransaction[]) {
  const map = new Map<
    string,
    { category: string; subCategory: string; income: number; expenses: number; net: number }
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


