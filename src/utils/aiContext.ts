// Collecte et mise en forme du contexte patrimonial transmis au Conseiller IA.
// Ce module n'appelle jamais Gemini : il agrège les données locales
// (localStorage + serveur local : CSV de comptes, wallets crypto, stratégie)
// pour produire un texte en français, uniquement en euros.
import type {
  BankCsvColumnMapping,
  InvestmentCsvColumnMapping,
  PocketCategory,
  PocketOwnership,
  SavingsPocket,
} from "../types";
import {
  buildCashflowSeries,
  parseBankCsvTransactions,
  parsePeaCsvHoldings,
  type ParsedTransaction,
  type PeaHolding,
} from "./csvAnalytics";
import {
  calculateHouseholdSummary,
  getPocketMonthlyAmount,
  getSavingsStrategy,
  getTotalMonthlyIncome,
} from "./savingsStorage";
import {
  getBankCsvUploadById,
  getStoredBankCsvUploads,
  getStoredWallets,
} from "./storage";
import {
  calculateMonthlyBudgetSummary,
  formatMonthLabel,
  getCurrentMonthKey,
} from "./tricountStorage";
import { getUserSettings } from "./userSettings";

// ===== Types publics =====

export interface AiContextSelection {
  /** Comptes, enveloppes (PEA, PEE, assurance vie...) et lignes associées. */
  accounts: boolean;
  /** Portefeuille crypto (wallets et actifs valorisés en €). */
  crypto: boolean;
  /** Stratégie d'épargne, foyer, poches et réalité du mois en cours. */
  strategy: boolean;
}

export const DEFAULT_AI_CONTEXT_SELECTION: AiContextSelection = {
  accounts: true,
  crypto: true,
  strategy: true,
};

export interface AiContextMeta {
  /** Comptes / enveloppes disposant de données. */
  sections: number;
  /** Lignes de titres (enveloppes investissement). */
  lines: number;
  /** Comptes bancaires avec opérations. */
  bankAccounts: number;
  /** Wallets crypto. */
  wallets: number;
  /** Actifs crypto non masqués. */
  cryptoAssets: number;
  /** Poches de la stratégie d'épargne. */
  pockets: number;
  /** Somme des valeurs connues en € (comptes + crypto). */
  totalValue: number;
  /** Mois analysé pour les poches réelles. */
  monthKey: string;
}

export interface AiContextResult {
  text: string;
  meta: AiContextMeta;
}

export interface AiContextPreview {
  accounts: string;
  crypto: string;
  strategy: string;
}

// ===== Formatage français (euros) =====

const normalizeSpaces = (value: string): string =>
  value.replace(/[\u202f\u00a0]/g, " ");

const frNumber = (value: number, digits = 2): string => {
  const n = Number(value);
  return normalizeSpaces(
    (Number.isFinite(n) ? n : 0).toLocaleString("fr-FR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
  );
};

export const formatEur = (value: number): string => `${frNumber(value, 2)} €`;

export const formatSignedEur = (value: number): string =>
  `${value >= 0 ? "+" : "-"}${formatEur(Math.abs(value))}`;

export const formatQty = (value: number): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return normalizeSpaces(
    n.toLocaleString("fr-FR", { maximumFractionDigits: 8 }),
  );
};

export const formatPercent = (value: number, digits = 1): string =>
  `${frNumber(value, digits)} %`;

const isoDate = (date: Date): string => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "date inconnue";
  return d.toISOString().slice(0, 10);
};

// ===== Comptes, enveloppes et lignes =====

interface AccountsResult {
  text: string;
  sections: number;
  lines: number;
  bankAccounts: number;
  totalValue: number;
}

const holdingValue = (h: PeaHolding): number => {
  if (h.amount != null && h.amount > 0) return h.amount;
  if (h.lastPrice != null && h.quantity) return h.lastPrice * h.quantity;
  return 0;
};

const holdingPnl = (h: PeaHolding): number | null => {
  if (h.amountVariation != null && Number.isFinite(h.amountVariation)) {
    return h.amountVariation;
  }
  if (
    h.buyingPrice == null ||
    h.lastPrice == null ||
    !Number.isFinite(h.buyingPrice) ||
    !Number.isFinite(h.lastPrice)
  ) {
    return null;
  }
  const q = Number(h.quantity || 0);
  if (!Number.isFinite(q) || q === 0) return null;
  return (h.lastPrice - h.buyingPrice) * q;
};

const formatHoldingLine = (h: PeaHolding, sectionTotal: number): string => {
  const bits: string[] = [h.name || "Ligne sans nom"];
  if (h.isin) bits.push(`ISIN ${h.isin}`);
  if (h.quantity) bits.push(`${formatQty(h.quantity)} part(s)`);
  if (h.buyingPrice != null && Number.isFinite(h.buyingPrice)) {
    bits.push(`PRU ${formatEur(h.buyingPrice)}`);
  }
  if (h.lastPrice != null && Number.isFinite(h.lastPrice)) {
    bits.push(`dernier cours ${formatEur(h.lastPrice)}`);
  }
  const value = holdingValue(h);
  if (value > 0) bits.push(`valeur ${formatEur(value)}`);
  const pnl = holdingPnl(h);
  if (pnl != null) bits.push(`+/- ${formatSignedEur(pnl)}`);
  if (h.variationPercent != null && Number.isFinite(h.variationPercent)) {
    bits.push(
      `perf ${h.variationPercent >= 0 ? "+" : ""}${formatPercent(
        h.variationPercent,
      )}`,
    );
  }
  if (value > 0 && sectionTotal > 0) {
    bits.push(`poids ${formatPercent((value / sectionTotal) * 100)}`);
  }
  return `- ${bits.join(" · ")}`;
};

const buildBankSectionText = (txs: ParsedTransaction[]): string => {
  let balance: number | null = null;
  let balanceDate: Date | null = null;
  for (const t of txs) {
    if (t.accountBalance == null || !Number.isFinite(t.accountBalance)) continue;
    if (!balanceDate || t.date > balanceDate) {
      balance = t.accountBalance;
      balanceDate = t.date;
    }
  }

  const series = buildCashflowSeries(txs, "month").slice(-3);
  const income = series.reduce((s, p) => s + (p.income || 0), 0);
  const expenses = series.reduce((s, p) => s + (p.expenses || 0), 0);
  const net = income - expenses;

  const lines: string[] = [];
  if (balance != null) {
    lines.push(
      `- Solde : ${formatEur(balance)}${
        balanceDate ? ` (relevé du ${isoDate(balanceDate)})` : ""
      }`,
    );
  }
  if (series.length > 0) {
    lines.push(
      `- Flux des ${series.length} derniers mois : revenus ${formatEur(
        income,
      )} · dépenses ${formatEur(expenses)} · net ${formatSignedEur(net)}`,
    );
  }
  if (lines.length === 0) {
    lines.push(
      `- ${txs.length} opération(s) importée(s), sans solde ni flux exploitable`,
    );
  }
  return lines.join("\n");
};

export const buildAccountsContext = async (
  userId: string,
): Promise<AccountsResult> => {
  const settings = getUserSettings(userId);
  const sections = settings.accountSections ?? [];
  const parts: string[] = [];
  let sectionCount = 0;
  let lines = 0;
  let bankAccounts = 0;
  let totalValue = 0;

  for (const section of sections) {
    try {
      const metas = await getStoredBankCsvUploads(userId, section.id);
      if (metas.length === 0) continue;

      const contents: string[] = [];
      for (const meta of metas) {
        const upload = await getBankCsvUploadById(meta.id, userId);
        if (upload?.content) contents.push(upload.content);
      }
      if (contents.length === 0) continue;

      if (section.kind === "investment") {
        const mapping = settings.csvColumnMappings[section.id] as
          | InvestmentCsvColumnMapping
          | undefined;
        const holdings = contents.flatMap((content) =>
          parsePeaCsvHoldings(content, mapping),
        );
        if (holdings.length === 0) continue;

        const total = holdings.reduce((s, h) => s + holdingValue(h), 0);
        const hasPnl = holdings.some((h) => holdingPnl(h) != null);
        const pnl = holdings.reduce((s, h) => s + (holdingPnl(h) ?? 0), 0);

        sectionCount += 1;
        lines += holdings.length;
        totalValue += total;

        const header =
          `### ${section.label} — enveloppe investissement · ${holdings.length} ligne(s)` +
          (total > 0 ? ` · valeur ${formatEur(total)}` : "") +
          (hasPnl ? ` · +/- ${formatSignedEur(pnl)}` : "");
        parts.push(
          [
            header,
            ...holdings.map((h) => formatHoldingLine(h, total)),
          ].join("\n"),
        );
      } else {
        const mapping = settings.csvColumnMappings[section.id] as
          | BankCsvColumnMapping
          | undefined;
        const txs = contents.flatMap((content) =>
          parseBankCsvTransactions(content, mapping),
        );
        if (txs.length === 0) continue;

        bankAccounts += 1;
        sectionCount += 1;
        const balance = [...txs]
          .filter((t) => t.accountBalance != null)
          .sort((a, b) => b.date.getTime() - a.date.getTime())[0]?.accountBalance;
        if (typeof balance === "number" && Number.isFinite(balance)) {
          totalValue += balance;
        }

        parts.push(
          `### ${section.label} — compte bancaire\n${buildBankSectionText(txs)}`,
        );
      }
    } catch (error) {
      console.warn(`Contexte IA : section « ${section.id} » ignorée`, error);
    }
  }

  const text =
    parts.length > 0
      ? parts.join("\n\n")
      : "Aucun compte ni ligne disponible (aucun relevé CSV importé).";

  return { text, sections: sectionCount, lines, bankAccounts, totalValue };
};

// ===== Portefeuille crypto =====

interface CryptoResult {
  text: string;
  wallets: number;
  assets: number;
  totalValue: number;
}

const shortenAddress = (address: string): string => {
  if (!address || address.length <= 12) return address || "adresse inconnue";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};

export const buildCryptoContext = async (
  userId: string,
): Promise<CryptoResult> => {
  const wallets = await getStoredWallets(userId);
  if (wallets.length === 0) {
    return {
      text: "Aucun wallet crypto enregistré.",
      wallets: 0,
      assets: 0,
      totalValue: 0,
    };
  }

  let assetCount = 0;
  let totalValue = 0;
  const parts: string[] = [];

  for (const wallet of wallets) {
    const assets = (wallet.assets || []).filter(
      (a) => !a.isHidden && ((a.balance ?? 0) > 0 || (a.value ?? 0) > 0),
    );
    const nfts = (wallet.nfts || []).filter((n) => !n.isHidden);

    if (assets.length === 0 && nfts.length === 0) continue;

    assetCount += assets.length;
    const walletValue =
      assets.reduce((s, a) => s + (a.value || 0), 0) +
      nfts.reduce((s, n) => s + (n.value || 0), 0);
    totalValue += walletValue;

    const chains = (wallet.blockchains || []).join(", ");
    const lines = assets.map(
      (a) =>
        `- ${a.name || a.symbol} (${a.symbol}) : ${formatQty(a.balance)}${
          (a.value || 0) > 0 ? ` → ${formatEur(a.value || 0)}` : ""
        }`,
    );
    if (nfts.length > 0) {
      const nftValue = nfts.reduce((s, n) => s + (n.value || 0), 0);
      lines.push(
        `- NFTs : ${nfts.length} (valeur estimée ${
          nftValue > 0 ? formatEur(nftValue) : "inconnue"
        })`,
      );
    }

    parts.push(
      [
        `### ${wallet.name || "Wallet"} (${shortenAddress(wallet.address)}${
          chains ? ` · ${chains}` : ""
        }${wallet.lastUpdated ? ` · MAJ ${isoDate(new Date(wallet.lastUpdated))}` : ""})`,
        ...lines,
      ].join("\n"),
    );
  }

  const text =
    parts.length > 0
      ? parts.join("\n\n")
      : "Wallets enregistrés mais aucun actif valorisé (actualisez vos wallets).";

  return { text, wallets: wallets.length, assets: assetCount, totalValue };
};

// ===== Stratégie d'épargne et poches réelles =====

interface StrategyResult {
  text: string;
  pockets: number;
}

const CATEGORY_LABELS: Record<PocketCategory, string> = {
  fixed_expense: "Dépense fixe",
  savings_goal: "Projet / Épargne",
  investment: "Investissement",
  emergency: "Précaution",
  leisure: "Plaisirs / Loisirs",
};

const OWNERSHIP_LABELS: Record<PocketOwnership, string> = {
  shared: "commun",
  person1: "Personne 1",
  person2: "Personne 2",
  dossier: "dossier (comptes séparés)",
};

const SPLIT_MODE_LABELS: Record<string, string> = {
  "50_50": "50/50",
  proportional: "au prorata des revenus",
  custom: "répartition personnalisée",
};

const pocketCapital = (p: SavingsPocket): number =>
  p.ownership === "dossier"
    ? (Number(p.person1Current) || 0) + (Number(p.person2Current) || 0)
    : Number(p.currentAmount) || 0;

const pocketTarget = (p: SavingsPocket): number =>
  p.ownership === "dossier"
    ? (Number(p.person1Target) || 0) + (Number(p.person2Target) || 0)
    : Number(p.targetAmount) || 0;

const formatPocketLine = (
  pocket: SavingsPocket,
  referenceIncome: number,
): string[] => {
  const bits: string[] = [];
  const category = CATEGORY_LABELS[pocket.category] || pocket.category;
  const typeLabel =
    pocket.pocketType === "placement" ? "placement" : "dépense de vie";
  const ownership = OWNERSHIP_LABELS[pocket.ownership || "shared"] || "commun";
  bits.push(`${category} · ${typeLabel} · ${ownership}`);

  const monthly = getPocketMonthlyAmount(pocket, referenceIncome);
  let monthlyText = `${formatEur(monthly)}/mois`;
  if (
    pocket.ownership === "dossier" &&
    ((Number(pocket.person1Amount) || 0) > 0 ||
      (Number(pocket.person2Amount) || 0) > 0)
  ) {
    monthlyText += ` (Personne 1 : ${formatEur(
      Number(pocket.person1Amount) || 0,
    )} + Personne 2 : ${formatEur(Number(pocket.person2Amount) || 0)})`;
  }
  bits.push(monthlyText);

  const capital = pocketCapital(pocket);
  if (capital > 0) bits.push(`capital actuel ${formatEur(capital)}`);
  const target = pocketTarget(pocket);
  if (target > 0) bits.push(`objectif ${formatEur(target)}`);
  const rate = Number(pocket.expectedReturnRate) || 0;
  if (rate > 0) bits.push(`rendement attendu ${formatPercent(rate)}/an`);

  const lines = [`- ${pocket.name} (${bits.join(" · ")})`];

  const subItems = pocket.subItems || [];
  if (subItems.length > 0) {
    const subText = subItems
      .map((s) => {
        const subBits: string[] = [formatEur(Number(s.amount) || 0) + "/mois"];
        if ((Number(s.currentAmount) || 0) > 0) {
          subBits.push(`capital ${formatEur(Number(s.currentAmount) || 0)}`);
        }
        if ((Number(s.targetAmount) || 0) > 0) {
          subBits.push(`objectif ${formatEur(Number(s.targetAmount) || 0)}`);
        }
        return `${s.name} (${subBits.join(" · ")})`;
      })
      .join(" ; ");
    lines.push(`  Sous-comptes : ${subText}`);
  }

  return lines;
};

const formatComparisonLine = (c: {
  pocketName: string;
  plannedAmount: number;
  realSpent: number;
  status: "under_budget" | "over_budget" | "exact";
}): string => {
  const statusLabel =
    c.status === "over_budget"
      ? "au-dessus du plan"
      : c.status === "under_budget"
        ? "sous le plan"
        : "conforme au plan";
  return `- ${c.pocketName} : planifié ${formatEur(
    c.plannedAmount,
  )} → réel ${formatEur(c.realSpent)} (${statusLabel})`;
};

export const buildStrategyContext = (
  userId: string,
  monthKey: string = getCurrentMonthKey(),
): StrategyResult => {
  const strategy = getSavingsStrategy(userId);
  const incomes = strategy.incomes || [];
  const pockets = strategy.pockets || [];
  const householdSummary = calculateHouseholdSummary(strategy);
  const monthSummary = calculateMonthlyBudgetSummary(monthKey, strategy);

  const referenceIncome =
    getTotalMonthlyIncome(incomes) ||
    householdSummary.totalMonthlyIncome ||
    1;

  if (incomes.length === 0 && pockets.length === 0) {
    return {
      text: "Aucune stratégie d'épargne configurée (pas de revenus ni de poches).",
      pockets: 0,
    };
  }

  const parts: string[] = [];

  // Foyer
  const householdLines: string[] = [];
  const isCouple = householdSummary.enabled !== false;
  const p1Name =
    strategy.household?.person1?.name || householdSummary.p1.name || "Personne 1";
  const p2Name =
    strategy.household?.person2?.name || householdSummary.p2.name || "Personne 2";
  if (isCouple) {
    const splitLabel =
      SPLIT_MODE_LABELS[strategy.household?.splitMode || "proportional"] ||
      "répartition personnalisée";
    householdLines.push(
      `- Mode : couple · ${p1Name} (Personne 1) / ${p2Name} (Personne 2) · ${splitLabel} (P1 ${formatPercent(
        householdSummary.splitRatioP1 * 100,
      )} / P2 ${formatPercent(householdSummary.splitRatioP2 * 100)})`,
    );
  } else {
    householdLines.push(`- Mode : célibataire · ${p1Name}`);
  }
  householdLines.push(
    `- Revenus mensuels déclarés : ${formatEur(
      householdSummary.totalMonthlyIncome,
    )} (${p1Name} ${formatEur(householdSummary.p1.monthlyIncome)}${
      isCouple ? ` · ${p2Name} ${formatEur(householdSummary.p2.monthlyIncome)}` : ""
    })`,
  );
  householdLines.push(
    `- Épargne planifiée via les poches : ${formatEur(
      householdSummary.totalSavingsEur,
    )} (${formatPercent(householdSummary.savingsRate)} des revenus)`,
  );
  householdLines.push(
    `- Horizon d'investissement : ${strategy.horizonYears || 0} an(s)`,
  );
  parts.push(["### Foyer et revenus", ...householdLines].join("\n"));

  // Poches
  if (pockets.length > 0) {
    const pocketLines = pockets.flatMap((p) =>
      formatPocketLine(p, referenceIncome),
    );
    parts.push(
      [`### Poches de la stratégie (${pockets.length})`, ...pocketLines].join(
        "\n",
      ),
    );
  } else {
    parts.push("### Poches de la stratégie\n- Aucune poche configurée.");
  }

  // Réalité du mois
  const realLines: string[] = [];
  const monthLabel = `${formatMonthLabel(monthKey)} (${monthKey})`;
  realLines.push(
    `- Revenus réels perçus : ${formatEur(
      monthSummary.totalIncome,
    )} (${p1Name} ${formatEur(monthSummary.p1Income)}${
      isCouple ? ` · ${p2Name} ${formatEur(monthSummary.p2Income)}` : ""
    })`,
  );
  realLines.push(
    `- Dépenses réelles de vie : ${formatEur(
      monthSummary.totalExpenses,
    )} · capacité d'épargne réelle : ${formatEur(
      monthSummary.realSavingsAmount,
    )} (${formatPercent(monthSummary.realSavingsRate)} des revenus)`,
  );
  realLines.push(
    `- Placements réalisés ce mois : ${formatEur(
      monthSummary.totalPlacements,
    )} · restant non placé : ${formatEur(monthSummary.unplacedSavings)}`,
  );

  const expenseComparisons = monthSummary.expenseComparisons || [];
  if (expenseComparisons.length > 0) {
    realLines.push("- Poches de dépenses (planifié → réel) :");
    realLines.push(...expenseComparisons.map(formatComparisonLine));
  }
  const placementComparisons = monthSummary.placementComparisons || [];
  if (placementComparisons.length > 0) {
    realLines.push("- Poches de placement (planifié → réel) :");
    realLines.push(...placementComparisons.map(formatComparisonLine));
  }
  if (monthSummary.incomesCount === 0 && expenseComparisons.length === 0) {
    realLines.push(
      "- Aucune opération réelle saisie pour ce mois dans le suivi de budget.",
    );
  }
  parts.push([`### Réalité du mois — ${monthLabel}`, ...realLines].join("\n"));

  return { text: parts.join("\n\n"), pockets: pockets.length };
};

// ===== Orchestrateur =====

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const collectAiContext = async (
  userId: string,
  selection: AiContextSelection = DEFAULT_AI_CONTEXT_SELECTION,
  monthKey: string = getCurrentMonthKey(),
): Promise<AiContextResult> => {
  const blocks: string[] = [
    `# PATRIMOINE — profil « ${userId} » — données au ${todayIso()}`,
  ];
  const meta: AiContextMeta = {
    sections: 0,
    lines: 0,
    bankAccounts: 0,
    wallets: 0,
    cryptoAssets: 0,
    pockets: 0,
    totalValue: 0,
    monthKey,
  };

  if (selection.accounts) {
    const accounts = await buildAccountsContext(userId);
    blocks.push(`## COMPTES, ENVELOPPES ET LIGNES\n${accounts.text}`);
    meta.sections += accounts.sections;
    meta.lines += accounts.lines;
    meta.bankAccounts += accounts.bankAccounts;
    meta.totalValue += accounts.totalValue;
  }

  if (selection.crypto) {
    const crypto = await buildCryptoContext(userId);
    blocks.push(`## PORTEFEUILLE CRYPTO\n${crypto.text}`);
    meta.wallets += crypto.wallets;
    meta.cryptoAssets += crypto.assets;
    meta.totalValue += crypto.totalValue;
  }

  if (selection.strategy) {
    const strategy = buildStrategyContext(userId, monthKey);
    blocks.push(`## STRATÉGIE D'ÉPARGNE\n${strategy.text}`);
    meta.pockets += strategy.pockets;
  }

  if (!selection.accounts && !selection.crypto && !selection.strategy) {
    blocks.push("(Aucune donnée n'a été jointe à la question.)");
  }

  return { text: blocks.join("\n\n"), meta };
};

// Aperçu synthétique affiché dans les cartes de sélection de la page.
export const getAiContextPreview = async (
  userId: string,
): Promise<AiContextPreview> => {
  let accounts = "Comptes & lignes";
  let crypto = "Portefeuille crypto";
  let strategy = "Stratégie d'épargne";

  try {
    const settings = getUserSettings(userId);
    accounts = `${settings.accountSections.length} enveloppe(s) configurée(s)`;
  } catch (error) {
    console.warn("Aperçu IA : comptes indisponibles", error);
  }

  try {
    const wallets = await getStoredWallets(userId);
    const assets = wallets.reduce(
      (sum, w) => sum + (w.assets || []).filter((a) => !a.isHidden).length,
      0,
    );
    crypto = `${wallets.length} wallet(s) · ${assets} actif(s)`;
  } catch (error) {
    console.warn("Aperçu IA : wallets indisponibles", error);
  }

  try {
    const s = getSavingsStrategy(userId);
    strategy = `${s.pockets.length} poche(s) · ${s.incomes.length} revenu(s)`;
  } catch (error) {
    console.warn("Aperçu IA : stratégie indisponible", error);
  }

  return { accounts, crypto, strategy };
};
