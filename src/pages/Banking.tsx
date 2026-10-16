import React, { useEffect, useMemo, useState } from "react";
import {
  Upload,
  Trash2,
  Table as TableIcon,
  Columns,
  Search,
  Plus,
  Check,
  X,
  Landmark,
  TrendingUp,
  Download,
  Pencil,
  Loader2,
  RefreshCcw,
  CheckCircle2,
  ArrowRight,
  Split,
  Scale,
  User,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useUser } from "../contexts/UserContext";
import { getSavingsStrategy } from "../utils/savingsStorage";
import { getPersonTheme, getUserAccentColor } from "../utils/theme";
import {
  addOrUpdateExpense,
  addOrUpdateIncome,
  deleteExpense,
  deleteIncome,
  getStoredExpenses,
  getStoredIncomes,
  rebindBankRowIdsAfterCsvRowDelete,
  TricountExpense,
  TricountIncome,
  TricountBeneficiary,
  TricountSplitMethod,
  TricountPayer,
  isPlacementPocket,
} from "../utils/tricountStorage";
import { getUserSettings } from "../utils/userSettings";
import { syncBoursoAccounts } from "../utils/boursoService";
import {
  createBankCsvUpload,
  deleteBankCsvUpload,
  getBankCsvUploadById,
  getStoredBankCsvUploads,
  updateBankCsvUpload,
} from "../utils/storage";
import { parseCsv, stringifyCsv } from "../utils/csv";
import type { BankCsvUploadMeta, BoursoSyncResult } from "../types";
import {
  BankCategorySchema,
  categorizeBankRowsBatch,
} from "../utils/bankCategorizerAI";

type SortDir = "asc" | "desc";
type EditableField = "aiCategory" | "aiSubCategory";
type EditTarget = {
  uploadId: string;
  rowIndex: number;
  field: EditableField;
};
type CsvSectionId = string;
const MANUAL_SOURCE_LABEL = "__manual__";
const DEFAULT_MANUAL_COLUMNS: string[] = [
  "dateOp",
  "dateVal",
  "label",
  "category",
  "categoryParent",
  "supplierFound",
  "amount",
  "comment",
  "accountNum",
  "accountLabel",
  "accountbalance",
  "aiCategory",
  "aiSubCategory",
];
const DEFAULT_HOLDINGS_COLUMNS: string[] = [
  "name",
  "isin",
  "quantity",
  "buyingPrice",
  "lastPrice",
  "amount",
  "amountVariation",
  "variation",
  "lastMovementDate",
];
type CsvRowWithAi = Record<string, string> & {
  aiCategory: string;
  aiSubCategory: string;
};

function parseMaybeNumber(raw: string): number | null {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .replace(/\s/g, "")
    .replace(/\u00A0/g, "")
    .replace(",", "."); // common FR decimal separator

  // Remove currency symbols
  const cleaned = s.replace(/[€$£]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseMaybeDate(raw: string): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function parseBankRowInfo(row: any) {
  const rawAmount = row.amount || row.montant;
  let numericAmount = 0;
  if (rawAmount != null) {
    if (typeof rawAmount === "number") numericAmount = rawAmount;
    else {
      const parsed = parseFloat(String(rawAmount).replace(/\s/g, "").replace(",", "."));
      numericAmount = isNaN(parsed) ? 0 : parsed;
    }
  }
  const cleanAmount = Math.round(Math.abs(numericAmount) * 100) / 100;
  const isIncome = numericAmount > 0;

  const rawDate = row.dateOp || row.date || row.dateVal || row.lastMovementDate || "";
  let cleanDate = "";
  if (rawDate) {
    const parts = String(rawDate).trim().split("/");
    if (parts.length === 3 && parts[2].length === 4) {
      cleanDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(String(rawDate))) {
      cleanDate = String(rawDate).slice(0, 10);
    }
  }
  if (!cleanDate) {
    cleanDate = new Date().toISOString().slice(0, 10);
  }

  const cleanLabel = (
    row.label ||
    row.supplierFound ||
    row.comment ||
    (isIncome ? "Revenu bancaire" : "Dépense bancaire")
  ).toString().trim();

  const rowReference = (row.reference || "").toString().trim();
  const rowKey = getStableBankRowId(row);
  const legacyRowKey = getLegacyIndexBankRowId(row);

  return {
    rawAmount,
    numericAmount,
    cleanAmount,
    isIncome,
    cleanDate,
    cleanLabel,
    rowReference,
    rowKey,
    legacyRowKey,
  };
}

function getStableBankRowId(row: Record<string, string> | any): string {
  const uploadId = (row?.__uploadId || "").toString();
  const ref = (row?.reference || "").toString().trim();
  if (ref) return `${uploadId}:ref:${ref}`;
  const dateOp = (row?.dateOp || row?.date || "").toString().trim();
  const dateVal = (row?.dateVal || "").toString().trim();
  const label = (row?.label || "").toString().trim();
  const amount = (row?.amount || row?.montant || "").toString().trim();
  const balance = (row?.accountbalance || "").toString().trim();
  return `${uploadId}:fp:${dateOp}|${dateVal}|${label}|${amount}|${balance}`;
}

function getLegacyIndexBankRowId(row: Record<string, string> | any): string {
  const uploadId = (row?.__uploadId || "").toString();
  if (row?.__rowIndex === undefined || row?.__rowIndex === "") return "";
  return `${uploadId}:${row.__rowIndex}`;
}

const Banking: React.FC = () => {
  const { currentUser, availableUsers } = useUser();

  const [userSettings, setUserSettings] = useState(() =>
    getUserSettings(currentUser),
  );
  const accountSections = userSettings.accountSections || [];
  const [currentSection, setCurrentSection] = useState<CsvSectionId>(
    accountSections[0]?.id || "bank",
  );
  const [sectionCounts, setSectionCounts] = useState<
    Record<CsvSectionId, number>
  >({});

  const [uploads, setUploads] = useState<BankCsvUploadMeta[]>([]);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);

  const [csvCache, setCsvCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [globalFilter, setGlobalFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    {},
  );
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const [editRowsMode, setEditRowsMode] = useState(false);
  const [rowDeleting, setRowDeleting] = useState(false);
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);

  const boursoSettings = userSettings;
  const currentSectionConfig =
    accountSections.find((s) => s.id === currentSection) || accountSections[0];
  const currentSectionLabel = currentSectionConfig?.label || currentSection;
  const isInvestmentSection = currentSectionConfig?.kind === "investment";

  // ===== Bourso sync =====
  const [showBoursoSyncModal, setShowBoursoSyncModal] = useState(false);
  const [boursoPassword, setBoursoPassword] = useState("");
  const [boursoPages, setBoursoPages] = useState(10);
  const [boursoSyncLoading, setBoursoSyncLoading] = useState(false);
  const [boursoSyncError, setBoursoSyncError] = useState("");
  const [boursoSyncResult, setBoursoSyncResult] =
    useState<BoursoSyncResult | null>(null);
  const [boursoSyncPreview, setBoursoSyncPreview] = useState(false);
  const [boursoDuplicateSelection, setBoursoDuplicateSelection] = useState<
    Set<string>
  >(new Set());

  // ===== IA catégorisation =====
  const schemaStorageKey = useMemo(
    () => `bank_ai_schema_${currentUser}`,
    [currentUser],
  );
  const [schema, setSchema] = useState<BankCategorySchema>([]);
  const [schemaJsonDraft, setSchemaJsonDraft] = useState<string>("");
  const [showAdvancedSchema, setShowAdvancedSchema] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number }>(
    { done: 0, total: 0 },
  );
  const [aiMode, setAiMode] = useState<"missing" | "overwrite">("missing");
  const [showAiModeChoice, setShowAiModeChoice] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSubByCategory, setNewSubByCategory] = useState<
    Record<string, string>
  >({});

  // ===== Tricount Integration =====
  const [showTricountModal, setShowTricountModal] = useState(false);
  const [tricountModalType, setTricountModalType] = useState<"expense" | "placement" | "income">("expense");
  const [tricountDate, setTricountDate] = useState("");
  const [tricountLabel, setTricountLabel] = useState("");
  const [tricountAmount, setTricountAmount] = useState<number | "">("");
  const [tricountPayer, setTricountPayer] = useState<TricountPayer>("person1");
  const [tricountBeneficiary, setTricountBeneficiary] = useState<TricountBeneficiary>("person1");
  const [tricountPocketId, setTricountPocketId] = useState<string>("unallocated");
  const [tricountSubPocketId, setTricountSubPocketId] = useState<string>("");
  const [tricountSubPocketName, setTricountSubPocketName] = useState<string>("");
  const [tricountSplitMethod, setTricountSplitMethod] = useState<TricountSplitMethod>("50_50");
  const [showSplitOverride, setShowSplitOverride] = useState<boolean>(false);
  const [tricountToast, setTricountToast] = useState<string | null>(null);

  // Synchronisation dynamique avec le Budget & Tricount (tous les mois)
  const [tricountExpenses, setTricountExpenses] = useState<TricountExpense[]>(() => getStoredExpenses());
  const [tricountIncomes, setTricountIncomes] = useState<TricountIncome[]>(() => getStoredIncomes());
  const [selectedRowForTricount, setSelectedRowForTricount] = useState<any>(null);
  const [matchedTricountItem, setMatchedTricountItem] = useState<TricountExpense | TricountIncome | null>(null);

  useEffect(() => {
    const handleTricountUpdate = () => {
      setTricountExpenses(getStoredExpenses());
      setTricountIncomes(getStoredIncomes());
    };
    window.addEventListener("tricount_data_updated", handleTricountUpdate);
    window.addEventListener("storage", handleTricountUpdate);
    return () => {
      window.removeEventListener("tricount_data_updated", handleTricountUpdate);
      window.removeEventListener("storage", handleTricountUpdate);
    };
  }, []);

  const savingsStrategy = useMemo(() => {
    try {
      return getSavingsStrategy();
    } catch {
      return null;
    }
  }, [showTricountModal]);

  const isSoloMode = availableUsers.length < 2 || savingsStrategy?.household?.enabled === false;
  const p1Name = savingsStrategy?.household?.person1?.name || currentUser || "Romain";
  const p2Name =
    savingsStrategy?.household?.person2?.name ||
    availableUsers.find((u) => u.toLowerCase() !== p1Name.toLowerCase()) ||
    "Sophie";

  const p1Color = getUserAccentColor(p1Name);
  const p2Color = getUserAccentColor(p2Name);
  const p1Theme = useMemo(() => getPersonTheme(p1Color, p1Name), [p1Color, p1Name]);
  const p2Theme = useMemo(() => getPersonTheme(p2Color, p2Name), [p2Color, p2Name]);

  const formatEur = (val: number | null | undefined): string => {
    if (val == null || isNaN(val)) return "0,00 €";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const computeAutoSplit = (
    pocketId: string,
    subPocketId?: string
  ): {
    splitMethod: TricountSplitMethod;
    payer: TricountPayer;
    label: string;
    explanation: string;
  } => {
    if (isSoloMode) {
      return {
        splitMethod: "100_person1",
        payer: "person1",
        label: `100% ${p1Name}`,
        explanation: `Mode Solo (100% ${p1Name})`,
      };
    }

    const pocket = savingsStrategy?.pockets.find((p) => p.id === pocketId);
    const subItem = pocket?.subItems?.find((s) => s.id === subPocketId);

    // 1. Sous-poche avec affectation personnelle explicite
    if (subItem?.personId === "person1") {
      return {
        splitMethod: "100_person1",
        payer: "person1",
        label: `100% ${p1Name}`,
        explanation: `Sous-poche individuelle (${subItem.name})`,
      };
    }
    if (subItem?.personId === "person2") {
      return {
        splitMethod: "100_person2",
        payer: "person2",
        label: `100% ${p2Name}`,
        explanation: `Sous-poche individuelle (${subItem.name})`,
      };
    }

    // 2. Poche avec ownership individuelle
    if (pocket?.ownership === "person1") {
      return {
        splitMethod: "100_person1",
        payer: "person1",
        label: `100% ${p1Name}`,
        explanation: `Poche individuelle (${p1Name})`,
      };
    }
    if (pocket?.ownership === "person2") {
      return {
        splitMethod: "100_person2",
        payer: "person2",
        label: `100% ${p2Name}`,
        explanation: `Poche individuelle (${p2Name})`,
      };
    }

    const defaultPayer: TricountPayer =
      currentUser.toLowerCase() === p2Name.toLowerCase() ? "person2" : "person1";

    // 3. Poche commune avec split défini
    if (pocket) {
      if (pocket.splitMethod === "proportional") {
        return {
          splitMethod: "proportional",
          payer: defaultPayer,
          label: "Prorata",
          explanation: "Poche commune au prorata des revenus",
        };
      }
      return {
        splitMethod: "50_50",
        payer: defaultPayer,
        label: "50 / 50",
        explanation: "Poche commune 50/50",
      };
    }

    // Non alloué
    return {
      splitMethod: "50_50",
      payer: defaultPayer,
      label: "50 / 50",
      explanation: "Répartition standard 50/50",
    };
  };

  const handleOpenTricountModal = (row: any) => {
    const info = parseBankRowInfo(row);
    setSelectedRowForTricount(row);

    const matched = tricountMatchMap.get(info.rowKey) || null;
    setMatchedTricountItem(matched);

    if (matched) {
      if ("payerPersonId" in matched) {
        setTricountModalType(matched.nature === "placement" ? "placement" : "expense");
        setTricountDate(matched.date || info.cleanDate);
        setTricountLabel(matched.label || info.cleanLabel);
        setTricountAmount(matched.amount || info.cleanAmount);
        setTricountPayer(matched.payerPersonId || "person1");
        setTricountPocketId(matched.pocketId || "unallocated");
        setTricountSubPocketId(matched.subPocketId || "");
        setTricountSubPocketName(matched.subPocketName || "");
        setTricountSplitMethod(matched.splitMethod || "50_50");
      } else {
        setTricountModalType("income");
        setTricountDate(matched.date || info.cleanDate);
        setTricountLabel(matched.label || info.cleanLabel);
        setTricountAmount(matched.amount || info.cleanAmount);
        setTricountBeneficiary(matched.beneficiaryPersonId || "person1");
      }
      setShowSplitOverride(false);
      setShowTricountModal(true);
      return;
    }

    const cleanAmount = info.cleanAmount;
    const isIncome = info.isIncome;
    const cleanDate = info.cleanDate;
    const cleanLabel = info.cleanLabel;

    let detectedPocketId = "unallocated";
    let detectedSubPocketId = "";
    let detectedSubPocketName = "";

    if (savingsStrategy) {
      const cleanLabelLower = cleanLabel.toLowerCase();
      const aiCat = (row.aiCategory || row.category || "").toString().toLowerCase();
      const aiSub = (row.aiSubCategory || row.subCategory || "").toString().toLowerCase();
      const supplier = (row.supplierFound || "").toString().toLowerCase();
      const comment = (row.comment || "").toString().toLowerCase();

      const searchTerms = [cleanLabelLower, aiCat, aiSub, supplier, comment].filter(Boolean);

      // Priorité 1 : Recherche dans les sous-poches
      outerSubLoop: for (const p of savingsStrategy.pockets) {
        if (p.subItems && p.subItems.length > 0) {
          for (const sub of p.subItems) {
            const subName = sub.name.toLowerCase();
            if (subName.length >= 3) {
              for (const term of searchTerms) {
                if (term.includes(subName) || subName.includes(term)) {
                  detectedPocketId = p.id;
                  detectedSubPocketId = sub.id;
                  detectedSubPocketName = sub.name;
                  break outerSubLoop;
                }
              }
            }
          }
        }
      }

      // Priorité 2 : Si aucune sous-poche n'a matché, recherche dans les poches
      if (detectedPocketId === "unallocated") {
        for (const p of savingsStrategy.pockets) {
          const pName = p.name.toLowerCase();
          if (pName.length >= 3) {
            for (const term of searchTerms) {
              if (term.includes(pName) || pName.includes(term)) {
                detectedPocketId = p.id;
                break;
              }
            }
          }
          if (detectedPocketId !== "unallocated") break;
        }
      }
    }

    const auto = computeAutoSplit(detectedPocketId, detectedSubPocketId);
    const detectedSplit: TricountSplitMethod = auto.splitMethod;
    const detectedPayer: TricountPayer = auto.payer;
    const detectedBeneficiary: TricountBeneficiary =
      currentUser.toLowerCase() === p2Name.toLowerCase() && !isSoloMode ? "person2" : "person1";

    const foundPocket = savingsStrategy?.pockets.find((p) => p.id === detectedPocketId);
    const isPlacement = isPlacementPocket(foundPocket);
    const initialModalType: "expense" | "placement" | "income" = isIncome
      ? "income"
      : isPlacement
      ? "placement"
      : "expense";

    setTricountModalType(initialModalType);
    setTricountDate(cleanDate);
    setTricountLabel(cleanLabel);
    setTricountAmount(cleanAmount || "");
    setTricountPayer(detectedPayer);
    setTricountBeneficiary(detectedBeneficiary);
    setTricountPocketId(detectedPocketId);
    setTricountSubPocketId(detectedSubPocketId);
    setTricountSubPocketName(detectedSubPocketName);
    setTricountSplitMethod(detectedSplit);
    setShowSplitOverride(false);
    setShowTricountModal(true);
  };

  const handleConfirmTricount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tricountLabel.trim() || tricountAmount === "" || Number(tricountAmount) <= 0) return;

    const m = tricountDate.slice(0, 7) || new Date().toISOString().slice(0, 7);
    const numAmt = Math.round(Number(tricountAmount) * 100) / 100;
    const info = selectedRowForTricount ? parseBankRowInfo(selectedRowForTricount) : null;

    if (tricountModalType === "income") {
      const incomeId =
        matchedTricountItem && !("payerPersonId" in matchedTricountItem)
          ? matchedTricountItem.id
          : `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      if (matchedTricountItem && "payerPersonId" in matchedTricountItem) {
        deleteExpense(matchedTricountItem.id);
      }

      const income: TricountIncome = {
        id: incomeId,
        month: m,
        date: tricountDate,
        label: tricountLabel.trim(),
        amount: numAmt,
        beneficiaryPersonId: isSoloMode ? "person1" : tricountBeneficiary,
        source: "bank_import",
        bankAccount:
          selectedRowForTricount?.accountLabel ||
          selectedRowForTricount?.sourceFile ||
          undefined,
        bankReference: info?.rowReference || undefined,
        bankRowId: info?.rowKey || undefined,
        createdAt: matchedTricountItem?.createdAt || Date.now(),
      };

      addOrUpdateIncome(income);
      setShowTricountModal(false);
      setTricountToast(
        matchedTricountItem
          ? `Revenu mis à jour dans le Budget (${m}) !`
          : `Revenu de ${formatEur(income.amount)} ajouté au Budget (${m}) !`
      );
      setTimeout(() => setTricountToast(null), 4000);
      return;
    }

    const pocket = savingsStrategy?.pockets.find((p) => p.id === tricountPocketId);
    const subItem = pocket?.subItems?.find((s) => s.id === tricountSubPocketId);
    const subPocketName = subItem ? subItem.name : tricountSubPocketName || undefined;

    const expenseId =
      matchedTricountItem && "payerPersonId" in matchedTricountItem
        ? matchedTricountItem.id
        : `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (matchedTricountItem && !("payerPersonId" in matchedTricountItem)) {
      deleteIncome(matchedTricountItem.id);
    }

    const expense: TricountExpense = {
      id: expenseId,
      month: m,
      date: tricountDate,
      label: tricountLabel.trim(),
      amount: numAmt,
      payerPersonId: tricountPayer,
      pocketId: tricountPocketId,
      pocketName: pocket ? pocket.name : "Autre / Non classé",
      subPocketId: tricountSubPocketId || undefined,
      subPocketName,
      splitMethod: tricountSplitMethod,
      nature: tricountModalType === "placement" ? "placement" : "expense",
      source: "bank_import",
      bankAccount:
        selectedRowForTricount?.accountLabel ||
        selectedRowForTricount?.sourceFile ||
        undefined,
      bankReference: info?.rowReference || undefined,
      bankRowId: info?.rowKey || undefined,
      createdAt: matchedTricountItem?.createdAt || Date.now(),
    };

    addOrUpdateExpense(expense);
    setShowTricountModal(false);
    const typeLabel = tricountModalType === "placement" ? "Placement" : "Dépense";
    setTricountToast(
      matchedTricountItem
        ? `${typeLabel} mis(e) à jour dans le Budget (${m}) !`
        : `${typeLabel} de ${formatEur(expense.amount)} ajouté(e) au Budget (${m}) !`
    );
    setTimeout(() => setTricountToast(null), 4000);
  };

  const handleDeleteMatchedTricountItem = () => {
    if (!matchedTricountItem) return;
    const label = matchedTricountItem.label || "cette opération";
    if (window.confirm(`Retirer "${label}" du Budget ?`)) {
      if ("payerPersonId" in matchedTricountItem) {
        deleteExpense(matchedTricountItem.id);
      } else {
        deleteIncome(matchedTricountItem.id);
      }
      setShowTricountModal(false);
      setTricountToast(`Opération "${label}" retirée du Budget !`);
      setTimeout(() => setTricountToast(null), 4000);
    }
  };
  const [isAiSectionCollapsed, setIsAiSectionCollapsed] = useState(true);

  // ===== ajout manuel de ligne (CSV dédié) =====
  const [showManualModal, setShowManualModal] = useState(false);
  const manualColumnsStorageKey = useMemo(
    () => `manual_columns_${currentUser}_${currentSection}`,
    [currentUser, currentSection],
  );
  const [manualBaseHeaders, setManualBaseHeaders] = useState<string[] | null>(
    null,
  );
  const [manualCustomHeaders, setManualCustomHeaders] = useState<string[]>(
    DEFAULT_MANUAL_COLUMNS,
  );
  const [newManualColumn, setNewManualColumn] = useState("");
  const [manualDraft, setManualDraft] = useState<Record<string, string>>({});
  const [manualRowsDraft, setManualRowsDraft] = useState<
    Array<Record<string, string>>
  >([]);

  // ===== édition manuelle catégories dans le tableau =====
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);

  const refreshSectionCounts = async () => {
    try {
      const counts = await Promise.all(
        accountSections.map(async (section) => {
          const uploads = await getStoredBankCsvUploads(
            currentUser,
            section.id,
          );
          return [section.id, uploads.length] as const;
        }),
      );
      setSectionCounts(Object.fromEntries(counts));
    } catch {
      // keep previous counts on error
    }
  };

  useEffect(() => {
    setUserSettings(getUserSettings(currentUser));
  }, [currentUser]);

  useEffect(() => {
    const refresh = (event?: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as
        | { username?: string }
        | undefined;
      if (detail?.username && detail.username !== currentUser) return;
      setUserSettings(getUserSettings(currentUser));
    };

    window.addEventListener("userSettingsUpdated", refresh as EventListener);
    window.addEventListener("storage", refresh as EventListener);
    return () => {
      window.removeEventListener(
        "userSettingsUpdated",
        refresh as EventListener,
      );
      window.removeEventListener("storage", refresh as EventListener);
    };
  }, [currentUser]);

  useEffect(() => {
    if (!accountSections.length) return;
    if (!accountSections.find((s) => s.id === currentSection)) {
      setCurrentSection(accountSections[0].id);
    }
  }, [accountSections, currentSection]);

  useEffect(() => {
    // Load custom manual columns per section/user
    try {
      const raw = localStorage.getItem(manualColumnsStorageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        setManualCustomHeaders(parsed as string[]);
      } else {
        setManualCustomHeaders(
          isInvestmentSection
            ? DEFAULT_HOLDINGS_COLUMNS
            : DEFAULT_MANUAL_COLUMNS,
        );
      }
    } catch {
      setManualCustomHeaders(
        isInvestmentSection ? DEFAULT_HOLDINGS_COLUMNS : DEFAULT_MANUAL_COLUMNS,
      );
    }
    setManualBaseHeaders(null);
    setNewManualColumn("");
    setManualDraft({});
    setManualRowsDraft([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualColumnsStorageKey, isInvestmentSection]);

  const loadUploads = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getStoredBankCsvUploads(currentUser, currentSection);
      setUploads(list);
      // refresh counts for all tabs so they stay correct even before visiting each tab
      refreshSectionCounts();
      // Auto-select first upload if none selected
      if (selectedUploadIds.length === 0 && list.length > 0) {
        setSelectedUploadIds([list[0].id]);
      }
    } catch (e: any) {
      setError(e?.message || "Erreur lors du chargement des fichiers CSV");
    } finally {
      setLoading(false);
    }
  };

  const openBoursoSyncModal = () => {
    setBoursoSyncError("");
    setBoursoPassword("");
    setBoursoSyncResult(null);
    setBoursoSyncPreview(false);
    setBoursoDuplicateSelection(new Set());
    setShowBoursoSyncModal(true);
  };

  const closeBoursoSyncModal = () => setShowBoursoSyncModal(false);

  const handleBoursoSync = async () => {
    if (!boursoSettings.boursoClientId) {
      setBoursoSyncError("Identifiant client Bourso manquant.");
      return;
    }
    if (!boursoPassword) {
      setBoursoSyncError("Mot de passe requis.");
      return;
    }
    if (!boursoSettings.boursoAccountMappings?.length) {
      setBoursoSyncError("Aucun compte Bourso configuré dans les paramètres.");
      return;
    }

    const mappingSection = isInvestmentSection ? "pea" : "bank";
    const sectionMappings = boursoSettings.boursoAccountMappings.filter(
      (m) => m.section === mappingSection,
    );
    if (!sectionMappings.length) {
      setBoursoSyncError(
        `Aucun compte Bourso configuré pour l'onglet ${currentSectionLabel}.`,
      );
      return;
    }

    setBoursoSyncLoading(true);
    setBoursoSyncError("");
    try {
      const result = await syncBoursoAccounts({
        customerId: boursoSettings.boursoClientId,
        password: boursoPassword,
        mappings: sectionMappings,
        pages: boursoPages,
        userId: currentUser,
        dryRun: true,
      });
      setBoursoSyncResult(result);
      setBoursoSyncPreview(true);
      // Auto-select all detected authorization duplicates for removal
      const allDupRefs = new Set<string>();
      for (const item of result.items || []) {
        for (const dup of item.duplicateRows || []) {
          const ref = dup.existingRow?.reference;
          if (ref) allDupRefs.add(ref);
        }
      }
      setBoursoDuplicateSelection(allDupRefs);
    } catch (e: any) {
      setBoursoSyncError(e?.message || "Erreur lors de la synchronisation");
    } finally {
      setBoursoSyncLoading(false);
    }
  };

  const handleBoursoConfirm = async () => {
    if (!boursoSettings.boursoClientId || !boursoPassword) return;
    const mappingSection = isInvestmentSection ? "pea" : "bank";
    const sectionMappings = boursoSettings.boursoAccountMappings.filter(
      (m) => m.section === mappingSection,
    );
    if (!sectionMappings.length) return;

    setBoursoSyncLoading(true);
    setBoursoSyncError("");
    try {
      const result = await syncBoursoAccounts({
        customerId: boursoSettings.boursoClientId,
        password: boursoPassword,
        mappings: sectionMappings,
        pages: boursoPages,
        userId: currentUser,
        dryRun: false,
        duplicateRefsToRemove: Array.from(boursoDuplicateSelection),
      });
      setBoursoSyncResult(result);
      setBoursoSyncPreview(false);
      await loadUploads();
      setShowBoursoSyncModal(false);
    } catch (e: any) {
      setBoursoSyncError(e?.message || "Erreur lors de la synchronisation");
    } finally {
      setBoursoSyncLoading(false);
    }
  };

  const handleBoursoReject = () => {
    setBoursoSyncResult(null);
    setBoursoSyncPreview(false);
    setBoursoSyncError("");
    setShowBoursoSyncModal(false);
  };

  const closeManualModal = () => setShowManualModal(false);

  const persistManualCustomHeaders = (headers: string[]) => {
    setManualCustomHeaders(headers);
    try {
      localStorage.setItem(manualColumnsStorageKey, JSON.stringify(headers));
    } catch {
      // ignore
    }
  };

  const syncManualDraftToHeaders = (headers: string[]) => {
    const today = new Date().toISOString().slice(0, 10);
    setManualDraft((prev) => {
      const next: Record<string, string> = {};
      headers.forEach((h) => {
        const existing = prev[h];
        if (existing !== undefined) {
          next[h] = (existing ?? "").toString();
          return;
        }
        if (h === "dateOp" || h === "dateVal" || h === "date") {
          next[h] = today;
          return;
        }
        next[h] = "";
      });
      return next;
    });
  };

  const syncManualRowsDraftToHeaders = (headers: string[]) => {
    const today = new Date().toISOString().slice(0, 10);
    setManualRowsDraft((prevRows) => {
      const rows = (prevRows || []).length > 0 ? prevRows : [{}];
      return rows.map((prev) => {
        const next: Record<string, string> = {};
        headers.forEach((h) => {
          const existing = prev?.[h];
          if (existing !== undefined) {
            next[h] = (existing ?? "").toString();
            return;
          }
          if (h === "dateOp" || h === "dateVal" || h === "date") {
            next[h] = today;
            return;
          }
          if (h === "accountLabel" && isInvestmentSection) {
            next[h] = currentSectionLabel;
            return;
          }
          next[h] = "";
        });
        return next;
      });
    });
  };

  const getEffectiveManualHeaders = (): string[] => {
    const base = (manualBaseHeaders || []).filter(Boolean);
    if (base.length > 0) return base;
    const custom = (manualCustomHeaders || []).filter(Boolean);
    return custom.length > 0 ? custom : DEFAULT_MANUAL_COLUMNS;
  };

  const detectBaseHeadersForManual = async (): Promise<string[] | null> => {
    // find first non-manual upload in current section
    const candidate = uploads.find(
      (u) => u.sourceLabel !== MANUAL_SOURCE_LABEL,
    );
    if (!candidate) return null;

    let contentText = csvCache[candidate.id];
    if (contentText === undefined) {
      const upload = await getBankCsvUploadById(candidate.id, currentUser);
      contentText = upload?.content || "";
      setCsvCache((prev) => ({ ...prev, [candidate.id]: contentText || "" }));
    }

    try {
      const parsed = parseCsv(contentText || "");
      const headers = (parsed.headers || []).filter(Boolean);
      if (headers.length === 0) return null;
      // For investment sections, we want the same format as holdings.
      // If the existing CSV is not holdings-shaped, ignore it and use custom/default holdings headers.
      if (isInvestmentSection) {
        const looksLikeHoldings =
          headers.includes("name") ||
          headers.includes("isin") ||
          headers.includes("quantity");
        return looksLikeHoldings ? headers : null;
      }
      return headers;
    } catch {
      return null;
    }
  };

  const openManualModal = async () => {
    setError(null);
    try {
      const base = await detectBaseHeadersForManual();
      setManualBaseHeaders(base);

      // When no base CSV exists, load custom headers from localStorage for this section/user
      if (!base || base.length === 0) {
        try {
          const raw = localStorage.getItem(manualColumnsStorageKey);
          const parsed = raw ? (JSON.parse(raw) as unknown) : null;
          if (
            Array.isArray(parsed) &&
            parsed.every((x) => typeof x === "string")
          ) {
            setManualCustomHeaders(parsed as string[]);
          } else if (!manualCustomHeaders.length) {
            setManualCustomHeaders(DEFAULT_MANUAL_COLUMNS);
          }
        } catch {
          // ignore
        }
      }

      const headers = (base && base.length > 0 ? base : manualCustomHeaders)
        .filter(Boolean)
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

      const today = new Date().toISOString().slice(0, 10);
      const nextDraft: Record<string, string> = {};
      headers.forEach((h) => {
        if (h === "dateOp" || h === "dateVal" || h === "date") {
          nextDraft[h] = today;
        } else if (h === "accountLabel" && isInvestmentSection) {
          nextDraft[h] = currentSectionLabel;
        } else {
          nextDraft[h] = "";
        }
      });

      setManualDraft(nextDraft);
      if (isInvestmentSection) {
        // Start with a few empty rows so it feels like a spreadsheet
        const startRows = Array.from({ length: 8 }).map(() => ({
          ...nextDraft,
        }));
        setManualRowsDraft(startRows);
      } else {
        setManualRowsDraft([]);
      }
      setShowManualModal(true);
    } catch (e: any) {
      setError(e?.message || "Impossible de préparer le formulaire");
    }
  };

  const copyPeaStructureToPee = async () => {
    if (!currentUser) return;
    if (!isInvestmentSection) return;

    const peaSection =
      accountSections.find((s) => s.id === "pea") ||
      accountSections.find(
        (s) => s.kind === "investment" && s.id !== currentSection,
      );
    if (!peaSection) {
      setError("Aucun autre compte investissement trouvé pour la copie.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const peaMetas = await getStoredBankCsvUploads(
        currentUser,
        peaSection.id,
      );
      const candidate =
        peaMetas.find((u) => u.sourceLabel !== MANUAL_SOURCE_LABEL) ||
        peaMetas[0] ||
        null;
      if (!candidate) {
        throw new Error(
          `Aucun CSV ${peaSection.label} trouvé. Uploade d’abord un CSV (format holdings).`,
        );
      }

      const upload = await getBankCsvUploadById(candidate.id, currentUser);
      const contentText = upload?.content || "";
      if (!contentText.trim()) {
        throw new Error(`CSV ${peaSection.label} vide ou introuvable.`);
      }

      const parsed = parseCsv(contentText);
      const headers = (parsed.headers || [])
        .filter(Boolean)
        .map((h) => h.trim())
        .filter((h) => h.length > 0);
      if (headers.length === 0)
        throw new Error(
          `Impossible de lire les colonnes de ${peaSection.label}.`,
        );

      // Force investment sections to share the same headers (so dashboard treats them identically).
      setManualBaseHeaders(null);
      persistManualCustomHeaders(headers);
      syncManualRowsDraftToHeaders(headers);
    } catch (e: any) {
      setError(e?.message || "Impossible de copier la structure");
    } finally {
      setLoading(false);
    }
  };

  const saveManualRows = async () => {
    if (!currentUser) return;
    if (!isInvestmentSection) return;

    const effectiveHeaders = getEffectiveManualHeaders();
    // Investment sections are treated like holdings: require amount + (name or isin)
    const required = new Set<string>();
    if (effectiveHeaders.includes("amount")) required.add("amount");

    const nonEmptyRows = (manualRowsDraft || []).filter((r) =>
      effectiveHeaders.some((h) => ((r?.[h] ?? "") + "").trim() !== ""),
    );
    if (nonEmptyRows.length === 0) {
      setError("Ajoute au moins une ligne.");
      return;
    }

    const invalid: number[] = [];
    nonEmptyRows.forEach((r, idx) => {
      const name = ((r?.name ?? "") + "").trim();
      const isin = ((r?.isin ?? "") + "").trim();
      const amount = ((r?.amount ?? "") + "").trim();
      if ((!name && !isin) || (required.has("amount") && !amount)) {
        invalid.push(idx + 1);
      }
    });
    if (invalid.length > 0) {
      setError(
        `Lignes incomplètes: ${invalid
          .slice(0, 8)
          .join(", ")}. Champs requis: amount + (name ou isin).`,
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const manualMeta =
        uploads.find((u) => u.sourceLabel === MANUAL_SOURCE_LABEL) || null;

      let manualId: string | null = manualMeta?.id || null;
      let contentText = manualId ? csvCache[manualId] : undefined;

      if (manualId && contentText === undefined) {
        const upload = await getBankCsvUploadById(manualId, currentUser);
        contentText = upload?.content || "";
      }

      // Create if missing
      if (!manualId) {
        const filename = `${currentSectionLabel} - lignes manuelles.csv`;
        const headers = effectiveHeaders;
        const starter = stringifyCsv({
          headers,
          rows: [],
          delimiter: ";",
        });

        manualId = await createBankCsvUpload(
          {
            filename,
            sourceLabel: MANUAL_SOURCE_LABEL,
            content: starter,
            sizeBytes: starter.length,
            section: currentSection,
          },
          currentUser,
        );

        if (!manualId) throw new Error("Impossible de créer le CSV manuel");
        contentText = starter;
      }

      const parsed = parseCsv(contentText || "");
      const delimiter = parsed.delimiter || ";";
      const headers = Array.from(
        new Set([...parsed.headers, ...effectiveHeaders]),
      );

      const rows: Array<Record<string, string>> = parsed.rows.map((r) => ({
        ...r,
        aiCategory: r.aiCategory ?? "",
        aiSubCategory: r.aiSubCategory ?? "",
      }));

      for (const draftRow of nonEmptyRows) {
        const newRow: Record<string, string> = {};
        headers.forEach((h) => (newRow[h] = ""));
        headers.forEach((h) => {
          if (draftRow?.[h] !== undefined) {
            newRow[h] = (draftRow[h] ?? "").toString().trim();
          }
        });
        rows.push(newRow);
      }

      const updatedText = stringifyCsv({ headers, rows, delimiter });
      const ok = await updateBankCsvUpload(
        manualId,
        { content: updatedText, sizeBytes: updatedText.length },
        currentUser,
      );
      if (!ok) throw new Error("Impossible de sauvegarder les lignes");

      setCsvCache((prev) => ({ ...prev, [manualId as string]: updatedText }));
      await loadUploads();
      setSelectedUploadIds((prev) =>
        prev.includes(manualId as string)
          ? prev
          : [manualId as string, ...prev],
      );
      closeManualModal();
    } catch (e: any) {
      setError(e?.message || "Erreur lors de l'ajout des lignes");
    } finally {
      setLoading(false);
    }
  };

  const saveManualLine = async () => {
    if (!currentUser) return;
    if (isInvestmentSection) {
      setError("Ajout manuel non supporté pour les sections d'investissement");
      return;
    }

    const effectiveHeaders = getEffectiveManualHeaders();
    const getVal = (h: string) => (manualDraft[h] ?? "").toString().trim();

    const dateVal = getVal("dateVal") || getVal("dateOp") || getVal("date");
    const label = getVal("label");
    const amount = getVal("amount");

    if (!dateVal || !amount || (effectiveHeaders.includes("label") && !label)) {
      setError(
        effectiveHeaders.includes("label")
          ? "Champs requis: date, libellé, montant"
          : "Champs requis: date, montant",
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const manualMeta =
        uploads.find((u) => u.sourceLabel === MANUAL_SOURCE_LABEL) || null;

      let manualId: string | null = manualMeta?.id || null;
      let contentText = manualId ? csvCache[manualId] : undefined;

      if (manualId && contentText === undefined) {
        const upload = await getBankCsvUploadById(manualId, currentUser);
        contentText = upload?.content || "";
      }

      // Create if missing
      if (!manualId) {
        const filename = `${currentSectionLabel} - lignes manuelles.csv`;
        const headers = effectiveHeaders;
        const starter = stringifyCsv({
          headers,
          rows: [],
          delimiter: ";",
        });

        manualId = await createBankCsvUpload(
          {
            filename,
            sourceLabel: MANUAL_SOURCE_LABEL,
            content: starter,
            sizeBytes: starter.length,
            section: currentSection,
          },
          currentUser,
        );

        if (!manualId) throw new Error("Impossible de créer le CSV manuel");
        contentText = starter;
      }

      const parsed = parseCsv(contentText || "");
      const delimiter = parsed.delimiter || ";";
      const headers = Array.from(
        new Set([...parsed.headers, ...effectiveHeaders]),
      );

      const rows: Array<Record<string, string>> = parsed.rows.map((r) => ({
        ...r,
        aiCategory: r.aiCategory ?? "",
        aiSubCategory: r.aiSubCategory ?? "",
      }));

      const newRow: Record<string, string> = {};
      headers.forEach((h) => (newRow[h] = ""));
      // Fill from draft for all known headers
      headers.forEach((h) => {
        if (manualDraft[h] !== undefined) {
          newRow[h] = (manualDraft[h] ?? "").toString().trim();
        }
      });
      // Ensure at least a dateVal field is populated when present
      if (headers.includes("dateVal") && !newRow.dateVal)
        newRow.dateVal = dateVal;
      if (headers.includes("dateOp") && !newRow.dateOp)
        newRow.dateOp = getVal("dateOp") || dateVal;

      rows.push(newRow);

      const updatedText = stringifyCsv({ headers, rows, delimiter });
      const ok = await updateBankCsvUpload(
        manualId,
        { content: updatedText, sizeBytes: updatedText.length },
        currentUser,
      );
      if (!ok) throw new Error("Impossible de sauvegarder la ligne manuelle");

      setCsvCache((prev) => ({ ...prev, [manualId as string]: updatedText }));
      await loadUploads();
      setSelectedUploadIds((prev) =>
        prev.includes(manualId as string)
          ? prev
          : [manualId as string, ...prev],
      );
      closeManualModal();
    } catch (e: any) {
      setError(e?.message || "Erreur lors de l'ajout de la ligne");
    } finally {
      setLoading(false);
    }
  };

  const manualFieldLabel = (h: string): string => {
    switch (h) {
      case "name":
        return "Nom";
      case "isin":
        return "ISIN";
      case "quantity":
        return "Quantité";
      case "buyingPrice":
        return "Prix d'achat";
      case "lastPrice":
        return "Dernier prix";
      case "amountVariation":
        return "Variation (€)";
      case "variation":
        return "Variation (%)";
      case "lastMovementDate":
        return "Date dernier mouvement";
      case "dateOp":
        return "Date opération";
      case "dateVal":
        return "Date valeur";
      case "date":
        return "Date";
      case "label":
        return "Libellé";
      case "supplierFound":
        return "Fournisseur";
      case "amount":
        return "Montant";
      case "comment":
        return "Commentaire";
      case "category":
        return "Catégorie";
      case "categoryParent":
        return "Catégorie parent";
      case "accountNum":
        return "Compte (numéro)";
      case "accountLabel":
        return "Compte (label)";
      case "accountbalance":
        return "Account balance";
      case "aiCategory":
        return "aiCategory";
      case "aiSubCategory":
        return "aiSubCategory";
      default:
        return h;
    }
  };

  const manualFieldType = (h: string): "date" | "text" => {
    if (
      h === "dateOp" ||
      h === "dateVal" ||
      h === "date" ||
      h === "lastMovementDate"
    )
      return "date";
    return "text";
  };

  const manualFieldPlaceholder = (h: string): string | undefined => {
    if (h === "amount") return "Ex: -32,50";
    if (h === "label") return "Ex: Courses Carrefour";
    if (h === "supplierFound") return "Ex: carrefour";
    if (h === "accountLabel" && isInvestmentSection)
      return `Ex: ${currentSectionLabel}`;
    return undefined;
  };

  useEffect(() => {
    loadUploads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentSection]);

  useEffect(() => {
    // ensure tab counts are correct when arriving on the page (and after remount)
    refreshSectionCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    // reset selection when switching section
    setSelectedUploadIds([]);
    setUploads([]); // avoid showing previous section files while fetching
    setShowColumnsPanel(false);
    setEditTarget(null);
    setEditValue("");
    setPage(1);
    setGlobalFilter("");
    setShowAiModeChoice(false);
  }, [currentSection]);

  // Auto-close the "Nouveau / Tout" choice if user doesn't click quickly
  useEffect(() => {
    if (!showAiModeChoice || aiRunning) return;
    const t = window.setTimeout(() => {
      setShowAiModeChoice(false);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [showAiModeChoice, aiRunning]);

  useEffect(() => {
    // Load schema from localStorage
    const stored = localStorage.getItem(schemaStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as BankCategorySchema;
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSchema(parsed);
          return;
        }
      } catch {
        // ignore -> fallback to default
      }
    }
    // Default schema
    const defaultSchema: BankCategorySchema = [
      {
        category: "Revenus",
        subcategories: ["Salaire", "Virements", "Autres"],
      },
      {
        category: "Logement",
        subcategories: ["Loyer", "Charges", "Internet", "Assurance", "Autres"],
      },
      {
        category: "Alimentation",
        subcategories: ["Courses", "Restaurants", "Livraison", "Autres"],
      },
      {
        category: "Transport",
        subcategories: ["Carburant", "Parking", "Train", "Uber/Taxi", "Autres"],
      },
      { category: "Santé", subcategories: ["Médecin", "Pharmacie", "Autres"] },
      {
        category: "Loisirs",
        subcategories: ["Sport", "Jeux", "Sorties", "Abonnements", "Autres"],
      },
      {
        category: "Shopping",
        subcategories: ["Vêtements", "Maison", "Tech", "Cadeaux", "Autres"],
      },
      { category: "Frais", subcategories: ["Banque", "Impôts", "Autres"] },
      { category: "Autres", subcategories: ["Non catégorisé"] },
    ];
    setSchema(defaultSchema);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaStorageKey]);

  useEffect(() => {
    // Keep JSON draft in sync with visual editor (unless user is actively editing advanced JSON)
    if (!showAdvancedSchema) {
      setSchemaJsonDraft(JSON.stringify(schema, null, 2));
      setSchemaError(null);
    }
  }, [schema, showAdvancedSchema]);

  const validateSchema = (s: BankCategorySchema): string | null => {
    if (!Array.isArray(s) || s.length === 0)
      return "Le schéma doit contenir au moins 1 catégorie";
    for (const c of s) {
      if (!c?.category || typeof c.category !== "string")
        return "Chaque catégorie doit avoir un champ 'category'";
      if (!Array.isArray(c.subcategories))
        return `La catégorie '${c.category}' doit avoir un tableau 'subcategories'`;
      if (c.subcategories.length === 0)
        return `La catégorie '${c.category}' doit avoir au moins 1 sous-catégorie`;
    }
    return null;
  };

  const applySchemaJsonDraft = () => {
    setSchemaError(null);
    try {
      const parsed = JSON.parse(schemaJsonDraft) as BankCategorySchema;
      const err = validateSchema(parsed);
      if (err) throw new Error(err);
      setSchema(parsed);
      localStorage.setItem(schemaStorageKey, JSON.stringify(parsed));
    } catch (e: any) {
      setSchemaError(
        e?.message || "Schéma JSON invalide (ex: accolade manquante)",
      );
    }
  };

  const saveSchema = () => {
    const err = validateSchema(schema);
    if (err) {
      setSchemaError(err);
      return;
    }
    localStorage.setItem(schemaStorageKey, JSON.stringify(schema));
    setSchemaError(null);
  };

  const runAiCategorization = async (
    modeOverride?: "missing" | "overwrite",
  ) => {
    const err = validateSchema(schema);
    if (err) {
      setSchemaError(err);
      return;
    }
    if (selectedUploadIds.length === 0) return;

    const modeToUse = modeOverride ?? aiMode;
    setAiMode(modeToUse);
    setShowAiModeChoice(false);

    setAiRunning(true);
    setError(null);
    try {
      // Ensure all contents are loaded
      const missing = selectedUploadIds.filter(
        (id) => csvCache[id] === undefined,
      );
      if (missing.length > 0) {
        const results = await Promise.all(
          missing.map(async (id) => {
            const upload = await getBankCsvUploadById(id, currentUser);
            return { id, content: upload?.content || "" };
          }),
        );
        setCsvCache((prev) => {
          const next = { ...prev };
          results.forEach((r) => (next[r.id] = r.content));
          return next;
        });
      }

      // For progress: count total rows across files
      const parsedFiles = selectedUploadIds.map((id) => {
        const text = csvCache[id] || "";
        const parsed = parseCsv(text);
        return { id, parsed };
      });
      const total = parsedFiles.reduce((sum, f) => {
        const rows: CsvRowWithAi[] = f.parsed.rows.map((r) => ({
          ...r,
          aiCategory: r.aiCategory ?? "",
          aiSubCategory: r.aiSubCategory ?? "",
        }));

        if (modeToUse === "overwrite") return sum + rows.length;

        const missingCount = rows.filter(
          (r) =>
            !String(r.aiCategory || "").trim() ||
            !String(r.aiSubCategory || "").trim(),
        ).length;
        return sum + missingCount;
      }, 0);
      setAiProgress({ done: 0, total });

      // Process each file independently then persist
      for (const f of parsedFiles) {
        const { id, parsed } = f;
        const delimiter = parsed.delimiter;
        const headers = Array.from(
          new Set([...parsed.headers, "aiCategory", "aiSubCategory"]),
        );

        const rows: CsvRowWithAi[] = parsed.rows.map((r) => ({
          ...r,
          aiCategory: r.aiCategory ?? "",
          aiSubCategory: r.aiSubCategory ?? "",
        }));

        // Bigger batch = fewer API calls (reduces "too many requests" on large imports)
        const batchSize = 50;
        const targetIndices =
          modeToUse === "overwrite"
            ? rows.map((_, idx) => idx)
            : rows
                .map((r, idx) => ({ r, idx }))
                .filter(
                  ({ r }) =>
                    !String(r.aiCategory || "").trim() ||
                    !String(r.aiSubCategory || "").trim(),
                )
                .map(({ idx }) => idx);

        if (targetIndices.length === 0) continue;

        for (let start = 0; start < targetIndices.length; start += batchSize) {
          const batchIdx = targetIndices.slice(start, start + batchSize);
          const inputs = batchIdx.map((i) => {
            const r = rows[i];
            return {
              dateOp: r["dateOp"] ?? "",
              dateVal: r["dateVal"] ?? "",
              label: r["label"] ?? "",
              supplierFound: r["supplierFound"] ?? "",
              amount: r["amount"] ?? "",
              comment: r["comment"] ?? "",
              category: r["category"] ?? "",
              categoryParent: r["categoryParent"] ?? "",
              accountLabel: r["accountLabel"] ?? "",
            };
          });

          const outputs = await categorizeBankRowsBatch({
            rows: inputs,
            schema: schema,
            username: currentUser,
          });

          outputs.forEach((o, j) => {
            const originalIndex = batchIdx[j];
            rows[originalIndex].aiCategory = o.aiCategory;
            rows[originalIndex].aiSubCategory = o.aiSubCategory;
          });

          setAiProgress((p) => ({
            done: Math.min(p.total, p.done + batchIdx.length),
            total: p.total,
          }));
        }

        // persist back
        const updatedText = stringifyCsv({
          headers,
          rows,
          delimiter,
        });

        const ok = await updateBankCsvUpload(
          id,
          { content: updatedText, sizeBytes: updatedText.length },
          currentUser,
        );
        if (!ok)
          throw new Error("Échec sauvegarde CSV après catégorisation IA");

        setCsvCache((prev) => ({ ...prev, [id]: updatedText }));
      }
    } catch (e: any) {
      setError(e?.message || "Erreur pendant la catégorisation IA");
    } finally {
      setAiRunning(false);
    }
  };

  useEffect(() => {
    const loadSelected = async () => {
      if (selectedUploadIds.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const missing = selectedUploadIds.filter(
          (id) => csvCache[id] === undefined,
        );
        if (missing.length === 0) return;

        const results = await Promise.all(
          missing.map(async (id) => {
            const upload = await getBankCsvUploadById(id, currentUser);
            return { id, content: upload?.content || "" };
          }),
        );

        setCsvCache((prev) => {
          const next = { ...prev };
          results.forEach((r) => (next[r.id] = r.content));
          return next;
        });
      } catch (e: any) {
        setError(e?.message || "Erreur lors du chargement du CSV");
      } finally {
        setLoading(false);
      }
    };
    loadSelected();
    setPage(1);
    setGlobalFilter("");
    // default sort when possible
    const headerCandidates = ["dateVal", "dateOp"];
    const found = headerCandidates.find((h) =>
      Object.values(csvCache).some((txt) => txt.includes(h)),
    );
    if (found) {
      setSortKey(found);
      setSortDir("asc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUploadIds, currentUser]);

  const merged = useMemo(() => {
    if (selectedUploadIds.length === 0)
      return { headers: [], rows: [], delimiter: ";" as string };

    const selected = uploads.filter((u) => selectedUploadIds.includes(u.id));
    // sourceFile must follow the (renamable) filename
    const fileNameById = new Map(selected.map((u) => [u.id, u.filename]));

    const parsedParts = selectedUploadIds
      .map((id) => {
        const text = csvCache[id];
        if (text === undefined) return null;
        try {
          const p = parseCsv(text);
          return { id, ...p };
        } catch {
          return { id, headers: [], rows: [], delimiter: ";" as string };
        }
      })
      .filter(Boolean) as Array<{
      id: string;
      headers: string[];
      rows: Array<Record<string, string>>;
      delimiter: string;
    }>;

    // union headers + add sourceFile
    const headerSet = new Set<string>();
    parsedParts.forEach((p) => p.headers.forEach((h) => headerSet.add(h)));
    headerSet.add("sourceFile");
    const headers = Array.from(headerSet);

    const rows: Array<Record<string, string>> = [];
    for (const p of parsedParts) {
      const filename = fileNameById.get(p.id) || p.id;
      for (let i = 0; i < p.rows.length; i++) {
        const r = p.rows[i];
        rows.push({
          ...r,
          sourceFile: filename,
          __uploadId: p.id,
          __rowIndex: String(i),
        });
      }
    }

    // delimiter: display "mixed" if more than 1
    const delimiter =
      new Set(parsedParts.map((p) => p.delimiter)).size > 1
        ? "mix"
        : parsedParts[0]?.delimiter || ";";

    return { headers, rows, delimiter };
  }, [selectedUploadIds, csvCache, uploads]);

  const tricountMatchMap = useMemo(() => {
    const matches = new Map<string, TricountExpense | TricountIncome>();
    const allItems: Array<TricountExpense | TricountIncome> = [
      ...tricountExpenses,
      ...tricountIncomes,
    ];
    if (allItems.length === 0 || merged.rows.length === 0) {
      return matches;
    }

    const itemByBankRowId = new Map<string, TricountExpense | TricountIncome>();
    const itemByBankReference = new Map<string, TricountExpense | TricountIncome>();
    const legacyItems: Array<TricountExpense | TricountIncome> = [];

    for (const item of allItems) {
      if (item.bankRowId) {
        itemByBankRowId.set(item.bankRowId, item);
      }
      if (item.bankReference) {
        itemByBankReference.set(item.bankReference, item);
      }
      if (!item.bankRowId && !item.bankReference) {
        legacyItems.push(item);
      }
    }

    const matchedRowKeys = new Set<string>();
    const usedItemIds = new Set<string>();

    const assignMatch = (
      rowKey: string,
      item: TricountExpense | TricountIncome | undefined,
    ) => {
      if (!item || usedItemIds.has(item.id) || matchedRowKeys.has(rowKey)) return false;
      matches.set(rowKey, item);
      matchedRowKeys.add(rowKey);
      usedItemIds.add(item.id);
      return true;
    };

    // Étape 1 : référence bancaire stable (ne décale pas après une suppression de ligne)
    for (const row of merged.rows) {
      const info = parseBankRowInfo(row);
      if (info.rowReference) {
        assignMatch(info.rowKey, itemByBankReference.get(info.rowReference));
      }
    }

    // Étape 1b : identifiant de ligne stable (ref:/fp:), puis ancien index CSV
    for (const row of merged.rows) {
      const info = parseBankRowInfo(row);
      if (matchedRowKeys.has(info.rowKey)) continue;
      if (assignMatch(info.rowKey, itemByBankRowId.get(info.rowKey))) continue;

      const legacyItem = info.legacyRowKey
        ? itemByBankRowId.get(info.legacyRowKey)
        : undefined;
      if (
        legacyItem &&
        (!legacyItem.bankReference ||
          legacyItem.bankReference === info.rowReference) &&
        Math.abs((legacyItem.amount || 0) - info.cleanAmount) < 0.02
      ) {
        assignMatch(info.rowKey, legacyItem);
      }
    }

    // Étape 2 : Correspondances par signature pour opérations antérieures
    if (legacyItems.length > 0) {
      const normalizeText = (s: string) =>
        (s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");

      const legacyByCents = new Map<
        number,
        Array<{ item: TricountExpense | TricountIncome; used: boolean }>
      >();
      for (const item of legacyItems) {
        const cents = Math.round((item.amount || 0) * 100);
        if (!legacyByCents.has(cents)) {
          legacyByCents.set(cents, []);
        }
        legacyByCents.get(cents)!.push({ item, used: false });
      }

      for (const row of merged.rows) {
        const info = parseBankRowInfo(row);
        if (matchedRowKeys.has(info.rowKey)) continue;

        const rowCents = Math.round(info.cleanAmount * 100);
        const candidates = legacyByCents.get(rowCents);
        if (!candidates || candidates.length === 0) continue;

        const normRow = normalizeText(info.cleanLabel);
        const rowTime = new Date(info.cleanDate).getTime();

        let bestCandidate: {
          item: TricountExpense | TricountIncome;
          used: boolean;
        } | null = null;
        let minDiffDays = Infinity;

        for (const candidate of candidates) {
          if (candidate.used || usedItemIds.has(candidate.item.id)) continue;

          const normItem = normalizeText(candidate.item.label);
          const labelMatch =
            normItem === normRow ||
            (normItem.length >= 3 &&
              normRow.length >= 3 &&
              (normItem.includes(normRow) || normRow.includes(normItem)));
          if (!labelMatch) continue;

          let diffDays = 0;
          if (candidate.item.date && !isNaN(rowTime)) {
            const itemTime = new Date(candidate.item.date).getTime();
            if (!isNaN(itemTime)) {
              diffDays = Math.abs(itemTime - rowTime) / (1000 * 60 * 60 * 24);
            }
          }

          if (diffDays <= 45 && diffDays < minDiffDays) {
            minDiffDays = diffDays;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate) {
          bestCandidate.used = true;
          assignMatch(info.rowKey, bestCandidate.item);
        }
      }

      // Étape 3 : Opérations renommées (ex: "Ba 1" renommé en "Baguette")
      // Correspondance sur le même montant en centimes + date identique ou très proche
      for (const row of merged.rows) {
        const info = parseBankRowInfo(row);
        if (matchedRowKeys.has(info.rowKey)) continue;

        const rowCents = Math.round(info.cleanAmount * 100);
        const candidates = legacyByCents.get(rowCents);
        if (!candidates || candidates.length === 0) continue;

        const rowTime = new Date(info.cleanDate).getTime();
        let bestCandidate: {
          item: TricountExpense | TricountIncome;
          used: boolean;
        } | null = null;
        let minDiffDays = Infinity;

        for (const candidate of candidates) {
          if (candidate.used || usedItemIds.has(candidate.item.id)) continue;

          let diffDays = Infinity;
          if (candidate.item.date && !isNaN(rowTime)) {
            const itemTime = new Date(candidate.item.date).getTime();
            if (!isNaN(itemTime)) {
              diffDays = Math.abs(itemTime - rowTime) / (1000 * 60 * 60 * 24);
            }
          }

          // Pour une opération importée de la banque (source === "bank_import"),
          // autoriser jusqu'à 7 jours d'écart (décalage dateOp / dateVal / week-end).
          // Sinon, exiger la date exacte (0 jour d'écart).
          const isBankImport = candidate.item.source === "bank_import";
          const maxAllowedDays = isBankImport ? 7 : 0;

          if (diffDays <= maxAllowedDays && diffDays < minDiffDays) {
            minDiffDays = diffDays;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate) {
          bestCandidate.used = true;
          assignMatch(info.rowKey, bestCandidate.item);
        }
      }
    }

    return matches;
  }, [merged.rows, tricountExpenses, tricountIncomes]);

  const getCategoryOptions = useMemo(() => {
    return schema.map((c) => c.category);
  }, [schema]);

  const getSubcategoryOptions = (category: string): string[] => {
    const found = schema.find((c) => c.category === category);
    return found?.subcategories || [];
  };

  const startEdit = (row: Record<string, string>, field: EditableField) => {
    const uploadId = row.__uploadId;
    const rowIndexStr = row.__rowIndex;
    const rowIndex = Number(rowIndexStr);
    if (!uploadId || !Number.isFinite(rowIndex)) return;

    setEditTarget({ uploadId, rowIndex, field });
    setEditValue((row[field] ?? "").toString());
  };

  const cancelEdit = () => {
    setEditTarget(null);
    setEditValue("");
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    const { uploadId, rowIndex, field } = editTarget;

    setEditSaving(true);
    setError(null);
    try {
      const text = csvCache[uploadId] ?? "";
      const parsed = parseCsv(text);

      const delimiter = parsed.delimiter;
      const headers = Array.from(
        new Set([...parsed.headers, "aiCategory", "aiSubCategory"]),
      );

      const rows = parsed.rows.map((r) => ({
        ...r,
        aiCategory: r.aiCategory ?? "",
        aiSubCategory: r.aiSubCategory ?? "",
      }));

      if (!rows[rowIndex]) throw new Error("Ligne introuvable dans le CSV");

      if (field === "aiCategory") {
        rows[rowIndex].aiCategory = editValue;
        // Si la sous-catégorie n'est plus compatible, on la reset
        const allowedSubs = getSubcategoryOptions(editValue);
        if (!allowedSubs.includes(rows[rowIndex].aiSubCategory)) {
          rows[rowIndex].aiSubCategory = allowedSubs[0] || "";
        }
      } else {
        rows[rowIndex].aiSubCategory = editValue;
      }

      const updatedText = stringifyCsv({
        headers,
        rows,
        delimiter,
      });

      const ok = await updateBankCsvUpload(
        uploadId,
        { content: updatedText, sizeBytes: updatedText.length },
        currentUser,
      );
      if (!ok) throw new Error("Échec sauvegarde CSV");

      setCsvCache((prev) => ({ ...prev, [uploadId]: updatedText }));
      cancelEdit();
    } catch (e: any) {
      setError(e?.message || "Erreur lors de la sauvegarde de la catégorie");
    } finally {
      setEditSaving(false);
    }
  };

  const deleteRowFromCsv = async (row: Record<string, string>) => {
    const uploadId = row.__uploadId;
    const rowIndexStr = row.__rowIndex;
    const rowIndex = Number(rowIndexStr);
    if (!uploadId || !Number.isFinite(rowIndex)) return;

    const ok = window.confirm("Supprimer cette ligne du CSV ?");
    if (!ok) return;

    setRowDeleting(true);
    setError(null);
    try {
      const text = csvCache[uploadId] ?? "";
      const parsed = parseCsv(text);
      if (!parsed.rows[rowIndex]) throw new Error("Ligne introuvable");

      const nextRows = parsed.rows.filter((_, i) => i !== rowIndex);
      const updatedText = stringifyCsv({
        headers: parsed.headers,
        rows: nextRows,
        delimiter: parsed.delimiter || ";",
      });

      const saved = await updateBankCsvUpload(
        uploadId,
        { content: updatedText, sizeBytes: updatedText.length },
        currentUser,
      );
      if (!saved) throw new Error("Échec suppression ligne");

      rebindBankRowIdsAfterCsvRowDelete(
        uploadId,
        rowIndex,
        (row.reference || "").toString().trim() || undefined,
      );
      setTricountExpenses(getStoredExpenses());
      setTricountIncomes(getStoredIncomes());

      setCsvCache((prev) => ({ ...prev, [uploadId]: updatedText }));
    } catch (e: any) {
      setError(e?.message || "Erreur lors de la suppression de la ligne");
    } finally {
      setRowDeleting(false);
    }
  };

  // initialize visible columns when headers change
  useEffect(() => {
    if (!merged.headers.length) {
      setVisibleColumns({});
      return;
    }
    setVisibleColumns((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const h of merged.headers) {
        if (next[h] === undefined) next[h] = true;
      }
      // remove non-existing
      Object.keys(next).forEach((k) => {
        if (!merged.headers.includes(k)) delete next[k];
      });
      return next;
    });
  }, [merged.headers]);

  const displayHeaders = useMemo(() => {
    return merged.headers.filter((h) => visibleColumns[h] !== false);
  }, [merged.headers, visibleColumns]);

  const filteredRows = useMemo(() => {
    const q = globalFilter.trim().toLowerCase();
    if (!q) return merged.rows;

    return merged.rows.filter((row) => {
      for (const h of displayHeaders) {
        const v = (row[h] ?? "").toString().toLowerCase();
        if (v.includes(q)) return true;
      }
      return false;
    });
  }, [merged.rows, globalFilter, displayHeaders]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const key = sortKey;
    const dir = sortDir === "asc" ? 1 : -1;

    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const av = (a[key] ?? "").toString();
      const bv = (b[key] ?? "").toString();

      const an = parseMaybeNumber(av);
      const bn = parseMaybeNumber(bv);
      if (an != null && bn != null) return (an - bn) * dir;

      const ad = parseMaybeDate(av);
      const bd = parseMaybeDate(bv);
      if (ad != null && bd != null) return (ad - bd) * dir;

      return av.localeCompare(bv, "fr", { numeric: true }) * dir;
    });
    return copy;
  }, [filteredRows, sortKey, sortDir]);

  const pageCount = useMemo(() => {
    if (pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(sortedRows.length / pageSize));
  }, [sortedRows.length, pageSize]);

  const pagedRows = useMemo(() => {
    if (pageSize <= 0) return sortedRows;
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const id = await createBankCsvUpload(
        {
          filename: file.name,
          content: text,
          sizeBytes: file.size,
          section: currentSection,
        },
        currentUser,
      );
      if (!id) {
        setError("Impossible de sauvegarder le CSV");
        return;
      }
      await loadUploads();
      setSelectedUploadIds((prev) =>
        prev.includes(id) ? prev : [id, ...prev],
      );
    } catch (e: any) {
      setError(e?.message || "Erreur lors de l'upload du fichier");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSelected = async (id: string) => {
    if (!window.confirm("Supprimer ce fichier CSV ?")) return;
    setLoading(true);
    setError(null);
    try {
      const ok = await deleteBankCsvUpload(id, currentUser);
      if (!ok) {
        setError("Suppression impossible");
        return;
      }
      // refresh list
      const next = uploads.filter((u) => u.id !== id);
      setUploads(next);
      setSelectedUploadIds((prev) => {
        const after = prev.filter((x) => x !== id);
        if (after.length === 0 && next.length > 0) return [next[0].id];
        return after;
      });
      setCsvCache((prev) => {
        const cp = { ...prev };
        delete cp[id];
        return cp;
      });
    } catch (e: any) {
      setError(e?.message || "Erreur lors de la suppression");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadUpload = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const upload = await getBankCsvUploadById(id, currentUser);
      if (!upload?.content) throw new Error("CSV introuvable");

      const filename =
        uploads.find((u) => u.id === id)?.filename ||
        upload.filename ||
        "export.csv";

      const blob = new Blob([upload.content], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "Erreur lors du téléchargement du CSV");
    } finally {
      setLoading(false);
    }
  };

  const handleRenameUpload = async (id: string) => {
    const currentName = uploads.find((u) => u.id === id)?.filename || "";
    const next = window.prompt("Nouveau nom du CSV", currentName);
    if (next == null) return; // cancelled
    const trimmed = next.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const ok = await updateBankCsvUpload(
        id,
        { filename: trimmed },
        currentUser,
      );
      if (!ok) throw new Error("Impossible de renommer le CSV");

      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, filename: trimmed } : u)),
      );
    } catch (e: any) {
      setError(e?.message || "Erreur lors du renommage");
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (header: string) => {
    if (sortKey !== header) {
      setSortKey(header);
      setSortDir("asc");
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Onglets (style Suivi Marché) */}
      <div className="border-b border-[rgba(255,255,255,0.06)]">
        <nav className="-mb-px flex flex-wrap justify-center gap-6">
          {accountSections.map((section) => {
            const isActive = currentSection === section.id;
            const count = sectionCounts[section.id] ?? 0;
            const Icon = section.kind === "investment" ? TrendingUp : Landmark;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setCurrentSection(section.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  isActive
                    ? "border-[#c8a55e] text-[#c8a55e] text-[#c8a55e]"
                    : "border-transparent text-[#555555] hover:text-[#8a8a8a] hover:border-[rgba(255,255,255,0.08)] text-[#8a8a8a] hover:text-[#f5f5f5] dark:hover:border-[rgba(255,255,255,0.06)]"
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Icon size={16} />
                  <span>
                    {section.label} ({count})
                  </span>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#f5f5f5]">
            {currentSectionLabel}
          </h1>
          <p className="text-[#8a8a8a] mt-2">
            Importez vos transactions via CSV puis triez/filtrez dans un tableau
            dynamique.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openBoursoSyncModal}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCcw size={18} />
            <span>Mettre à jour</span>
          </button>
          <button
            onClick={openManualModal}
            className="btn-secondary flex items-center gap-2"
            disabled={loading}
            title={
              isInvestmentSection
                ? "Ajouter des lignes manuelles (tableur)"
                : "Ajouter une ligne manuelle (CSV dédié)"
            }
          >
            <Plus size={18} />
            <span>Ajouter ligne</span>
          </button>

          <label className="btn-primary flex items-center gap-2 cursor-pointer">
            <Upload size={18} />
            <span>Uploader CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="card border border-danger-500">
          <p className="text-[#ef4444]">{error}</p>
        </div>
      )}

      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeManualModal}
          />
          <div className="relative card w-full max-w-5xl mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#f5f5f5]">
                {isInvestmentSection
                  ? `Saisie manuelle (tableur) - ${currentSectionLabel}`
                  : `Ajouter une ligne manuelle (${currentSectionLabel})`}
              </h2>
              <button
                type="button"
                className="text-[#555555] hover:text-[#8a8a8a] hover:text-[#f5f5f5]"
                onClick={closeManualModal}
                title="Fermer"
              >
                <X size={18} />
              </button>
            </div>

            {(() => {
              const baseHeaders = manualBaseHeaders || [];
              const usingBase = baseHeaders.length > 0;
              const effectiveHeaders = getEffectiveManualHeaders();

              const dateKey = effectiveHeaders.includes("dateVal")
                ? "dateVal"
                : effectiveHeaders.includes("dateOp")
                  ? "dateOp"
                  : effectiveHeaders.includes("date")
                    ? "date"
                    : null;
              const required = new Set<string>();
              if (dateKey) required.add(dateKey);
              if (effectiveHeaders.includes("amount")) required.add("amount");
              if (effectiveHeaders.includes("label")) required.add("label");

              return (
                <div className="space-y-4">
                  {usingBase ? (
                    <div className="text-xs text-[#8a8a8a]">
                      Champs basés sur tes CSV existants (mêmes colonnes).
                    </div>
                  ) : (
                    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] p-3 space-y-3">
                      <div className="text-sm font-medium text-[#f5f5f5]">
                        Colonnes (personnalisables)
                      </div>
                      <div className="text-xs text-[#8a8a8a]">
                        Conseil: garde au minimum{" "}
                        <span className="font-mono">dateVal</span> et{" "}
                        <span className="font-mono">amount</span> pour que les
                        graphes du dashboard puissent lire tes lignes.
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {manualCustomHeaders.map((h) => (
                          <span
                            key={h}
                            className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs border border-[rgba(255,255,255,0.06)] text-[#f5f5f5]"
                          >
                            {h}
                            <button
                              type="button"
                              className="text-[#555555] hover:text-danger-500 transition-colors"
                              title="Supprimer"
                              onClick={() => {
                                const next = manualCustomHeaders.filter(
                                  (x) => x !== h,
                                );
                                persistManualCustomHeaders(next);
                                if (isInvestmentSection) {
                                  syncManualRowsDraftToHeaders(next);
                                } else {
                                  syncManualDraftToHeaders(next);
                                }
                              }}
                            >
                              <X size={14} />
                            </button>
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <input
                          className="input-field"
                          value={newManualColumn}
                          onChange={(e) => setNewManualColumn(e.target.value)}
                          placeholder="Nouvelle colonne (ex: note)"
                        />
                        <button
                          type="button"
                          className="btn-secondary flex items-center gap-2"
                          onClick={() => {
                            const name = newManualColumn.trim();
                            if (!name) return;
                            if (manualCustomHeaders.includes(name)) return;
                            const next = [...manualCustomHeaders, name];
                            persistManualCustomHeaders(next);
                            if (isInvestmentSection) {
                              syncManualRowsDraftToHeaders(next);
                            } else {
                              syncManualDraftToHeaders(next);
                            }
                            setNewManualColumn("");
                          }}
                        >
                          <Plus size={18} />
                          Ajouter
                        </button>
                      </div>
                    </div>
                  )}

                  {isInvestmentSection ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary flex items-center gap-2"
                          disabled={loading}
                          onClick={() => {
                            const today = new Date().toISOString().slice(0, 10);
                            const row: Record<string, string> = {};
                            effectiveHeaders.forEach((h) => {
                              if (
                                h === "dateOp" ||
                                h === "dateVal" ||
                                h === "date"
                              ) {
                                row[h] = today;
                              } else {
                                row[h] = "";
                              }
                            });
                            setManualRowsDraft((prev) => [
                              ...(prev || []),
                              row,
                            ]);
                          }}
                        >
                          <Plus size={18} />
                          Ajouter une ligne
                        </button>
                        <button
                          type="button"
                          className="btn-secondary flex items-center gap-2"
                          disabled={loading}
                          onClick={copyPeaStructureToPee}
                        >
                          Copier la structure
                        </button>
                        <div className="text-xs text-[#8a8a8a]">
                          Applique exactement les mêmes colonnes qu'un autre
                          compte investissement.
                        </div>
                      </div>

                      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] overflow-auto max-h-[55vh]">
                        <table className="min-w-full text-sm">
                          <thead className="sticky top-0 bg-[#111111] bg-[#0a0a0a] z-10">
                            <tr className="border-b border-[rgba(255,255,255,0.06)]">
                              <th className="px-2 py-2 text-left text-xs text-[#555555] w-[56px]">
                                #
                              </th>
                              {effectiveHeaders.map((h) => (
                                <th
                                  key={h}
                                  className="px-2 py-2 text-left text-xs text-[#555555] whitespace-nowrap"
                                >
                                  {manualFieldLabel(h)}
                                  {required.has(h) ? " *" : ""}
                                </th>
                              ))}
                              <th className="px-2 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {(manualRowsDraft || []).map((row, rowIdx) => (
                              <tr
                                key={rowIdx}
                                className="border-b border-[rgba(255,255,255,0.06)]"
                              >
                                <td className="px-2 py-2 text-xs text-[#555555]">
                                  {rowIdx + 1}
                                </td>
                                {effectiveHeaders.map((h) => (
                                  <td key={h} className="px-2 py-1">
                                    <input
                                      type={manualFieldType(h)}
                                      className="input-field !py-1 !px-2 text-sm"
                                      value={(row?.[h] ?? "").toString()}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setManualRowsDraft((prev) =>
                                          (prev || []).map((r, i) =>
                                            i === rowIdx
                                              ? { ...(r || {}), [h]: v }
                                              : r,
                                          ),
                                        );
                                      }}
                                      placeholder={manualFieldPlaceholder(h)}
                                    />
                                  </td>
                                ))}
                                <td className="px-2 py-1">
                                  <button
                                    type="button"
                                    className="text-[#555555] hover:text-danger-500"
                                    title="Supprimer la ligne"
                                    onClick={() =>
                                      setManualRowsDraft((prev) =>
                                        (prev || []).filter(
                                          (_, i) => i !== rowIdx,
                                        ),
                                      )
                                    }
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {effectiveHeaders.map((h) => {
                        const span2 = h === "label" || h === "comment";
                        return (
                          <div
                            key={h}
                            className={`space-y-1 ${
                              span2 ? "sm:col-span-2" : ""
                            }`}
                          >
                            <label className="text-xs text-[#555555]">
                              {manualFieldLabel(h)}
                              {required.has(h) ? " *" : ""}
                            </label>
                            <input
                              type={manualFieldType(h)}
                              className="input-field"
                              value={manualDraft[h] || ""}
                              onChange={(e) =>
                                setManualDraft((p) => ({
                                  ...p,
                                  [h]: e.target.value,
                                }))
                              }
                              placeholder={manualFieldPlaceholder(h)}
                            />
                            {h === "amount" && (
                              <div className="text-[11px] text-[#555555]">
                                Astuce: mets un “-” pour une dépense, “+” pour
                                un revenu.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                className="btn-secondary py-2 px-4"
                onClick={closeManualModal}
                disabled={loading}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn-primary py-2 px-4"
                onClick={isInvestmentSection ? saveManualRows : saveManualLine}
                disabled={loading}
              >
                {isInvestmentSection ? "Enregistrer" : "Ajouter"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBoursoSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeBoursoSyncModal}
          />
          <div className="relative w-full max-w-4xl mx-4 bg-[#111111] rounded-lg p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#f5f5f5]">
                Mise à jour BoursoBank
              </h2>
              <button
                type="button"
                onClick={closeBoursoSyncModal}
                className="text-[#555555] hover:text-[#8a8a8a] hover:text-[#f5f5f5]"
                title="Fermer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {!boursoSettings.boursoClientId && (
                <div className="p-3 rounded-md bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-sm">
                  Renseigne ton identifiant client Bourso dans les paramètres.
                </div>
              )}
              {!boursoSettings.boursoAccountMappings?.length && (
                <div className="p-3 rounded-md bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-sm">
                  Aucun compte Bourso configuré. Lance la détection dans les
                  paramètres.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#8a8a8a] mb-2">
                    Mot de passe BoursoBank
                  </label>
                  <input
                    type="password"
                    value={boursoPassword}
                    onChange={(e) => setBoursoPassword(e.target.value)}
                    placeholder="Mot de passe (non stocké)"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#8a8a8a] mb-2">
                    Pages à récupérer
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={boursoPages}
                    onChange={(e) => setBoursoPages(Number(e.target.value))}
                    className="input-field"
                  />
                </div>
              </div>

              {!boursoSyncPreview && (
                <button
                  type="button"
                  onClick={handleBoursoSync}
                  disabled={boursoSyncLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#c8a55e] text-white rounded-md hover:bg-[#d4b06a] disabled:opacity-60"
                >
                  {boursoSyncLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Mise à jour...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCcw size={16} />
                      <span>Lancer la mise à jour</span>
                    </>
                  )}
                </button>
              )}

              {boursoSyncError && (
                <div className="p-3 rounded-md bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-sm">
                  {boursoSyncError}
                </div>
              )}

              {boursoSyncResult?.items?.length ? (
                <div className="space-y-4">
                  {boursoSyncResult.items.map((item) => {
                    const headers = item.newRows?.length
                      ? Object.keys(item.newRows[0])
                      : [];
                    return (
                      <div
                        key={`${item.section}-${item.accountId}`}
                        className="border border-[rgba(255,255,255,0.06)] rounded-md p-4"
                      >
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                          <div>
                            <p className="font-medium text-[#f5f5f5]">
                              {item.accountName}
                            </p>
                            <p className="text-xs text-[#555555]">
                              {item.section === "bank"
                                ? "Compte bancaire"
                                : "Investissement"}{" "}
                              • {item.filename}
                            </p>
                          </div>
                          <div className="text-sm text-[#8a8a8a]">
                            {item.addedCount} nouvelle(s) • total{" "}
                            {item.totalCount}
                          </div>
                        </div>

                        {item.newRows?.length ? (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead className="bg-[#0a0a0a] bg-[#161616]">
                                <tr>
                                  {headers.map((h) => (
                                    <th
                                      key={h}
                                      className="px-2 py-1 text-left text-[#8a8a8a]"
                                    >
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {item.newRows.map((row, idx) => (
                                  <tr
                                    key={idx}
                                    className="border-t border-[rgba(255,255,255,0.06)]"
                                  >
                                    {headers.map((h) => (
                                      <td
                                        key={h}
                                        className="px-2 py-1 text-[#f5f5f5] whitespace-nowrap"
                                      >
                                        {(row?.[h] ?? "").toString()}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-sm text-[#555555]">
                            Aucune nouvelle donnée détectée.
                          </p>
                        )}

                        {/* Doublons d'autorisation détectés */}
                        {item.duplicateRows?.length > 0 && (
                          <div className="mt-4 border border-amber-300 dark:border-amber-600 rounded-md p-3 bg-amber-50 dark:bg-amber-900/20">
                            <div className="flex items-center gap-2 mb-2">
                              <Trash2
                                size={16}
                                className="text-amber-600 dark:text-amber-400"
                              />
                              <p className="font-medium text-amber-800 dark:text-amber-300 text-sm">
                                {item.duplicateRows.length} ligne(s)
                                indésirable(s) détectée(s)
                              </p>
                              <span className="text-xs text-amber-600 dark:text-amber-400">
                                (autorisations en cours remplacées par le
                                paiement définitif)
                              </span>
                            </div>
                            <div className="space-y-3">
                              {item.duplicateRows.map((dup, dupIdx) => {
                                const dupRef = dup.existingRow?.reference || "";
                                const isSelected =
                                  boursoDuplicateSelection.has(dupRef);
                                const dupHeaders = Object.keys(
                                  dup.existingRow || {},
                                ).filter(
                                  (h) =>
                                    ![
                                      "aiCategory",
                                      "aiSubCategory",
                                      "supplierFound",
                                      "comment",
                                      "currency",
                                      "accountLabel",
                                    ].includes(h),
                                );
                                return (
                                  <div
                                    key={dupIdx}
                                    className={`rounded-md border p-2 transition-colors ${
                                      isSelected
                                        ? "border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20"
                                        : "border-[rgba(255,255,255,0.08)] bg-[#111111]"
                                    }`}
                                  >
                                    <div className="flex items-start gap-2 mb-2">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {
                                          setBoursoDuplicateSelection(
                                            (prev) => {
                                              const next = new Set(prev);
                                              if (next.has(dupRef)) {
                                                next.delete(dupRef);
                                              } else {
                                                next.add(dupRef);
                                              }
                                              return next;
                                            },
                                          );
                                        }}
                                        className="mt-0.5"
                                        title="Supprimer cette ligne d'autorisation"
                                      />
                                      <div className="flex-1">
                                        <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                                          {dup.reason}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-xs">
                                        <thead>
                                          <tr>
                                            <th className="px-2 py-0.5 text-left text-[#555555]"></th>
                                            {dupHeaders.map((h) => (
                                              <th
                                                key={h}
                                                className="px-2 py-0.5 text-left text-[#555555]"
                                              >
                                                {h}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr className="bg-red-50 dark:bg-red-900/30">
                                            <td className="px-2 py-0.5 text-red-600 dark:text-red-400 font-medium whitespace-nowrap">
                                              ❌ Autorisation
                                            </td>
                                            {dupHeaders.map((h) => (
                                              <td
                                                key={h}
                                                className="px-2 py-0.5 text-[#8a8a8a] whitespace-nowrap"
                                              >
                                                {(
                                                  dup.existingRow?.[h] ?? ""
                                                ).toString()}
                                              </td>
                                            ))}
                                          </tr>
                                          <tr className="bg-green-50 dark:bg-green-900/30">
                                            <td className="px-2 py-0.5 text-green-600 dark:text-green-400 font-medium whitespace-nowrap">
                                              ✅ Définitif
                                            </td>
                                            {dupHeaders.map((h) => (
                                              <td
                                                key={h}
                                                className="px-2 py-0.5 text-[#8a8a8a] whitespace-nowrap"
                                              >
                                                {(
                                                  dup.newRow?.[h] ?? ""
                                                ).toString()}
                                              </td>
                                            ))}
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {boursoSyncPreview && (
                    <div className="flex flex-col sm:flex-row gap-2 justify-end">
                      <button
                        type="button"
                        onClick={handleBoursoReject}
                        className="px-4 py-2 rounded-md border border-[rgba(255,255,255,0.08)] text-[#f5f5f5]"
                      >
                        Refuser
                      </button>
                      <button
                        type="button"
                        onClick={handleBoursoConfirm}
                        disabled={boursoSyncLoading}
                        className="px-4 py-2 rounded-md bg-[#c8a55e] text-white hover:bg-[#d4b06a] disabled:opacity-60"
                      >
                        Valider
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: uploads list */}
        <div className="lg:col-span-1">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TableIcon className="text-[#555555]" size={18} />
                <h2 className="text-lg font-semibold text-[#f5f5f5]">
                  Fichiers
                </h2>
              </div>
              <span className="text-xs text-[#555555]">
                {uploads.length} fichier{uploads.length > 1 ? "s" : ""}
              </span>
            </div>

            {uploads.length > 0 && (
              <div className="flex gap-2 mb-3">
                <button
                  className="btn-secondary py-1 px-3 text-sm"
                  type="button"
                  onClick={() => setSelectedUploadIds(uploads.map((u) => u.id))}
                >
                  Tout sélectionner
                </button>
                <button
                  className="btn-secondary py-1 px-3 text-sm"
                  type="button"
                  onClick={() => setSelectedUploadIds([])}
                >
                  Tout désélectionner
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
              {uploads.length === 0 && (
                <div className="text-sm text-[#555555]">
                  Aucun CSV pour le moment. Uploade ton premier fichier.
                </div>
              )}

              {uploads.map((u) => {
                const active = selectedUploadIds.includes(u.id);
                return (
                  <div
                    key={u.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      active
                        ? "border-[#c8a55e] bg-[rgba(200,165,94,0.12)] hover:bg-primary-200 dark:bg-primary-900/35 dark:hover:bg-primary-900/45"
                        : "border-[rgba(255,255,255,0.06)] hover:border-primary-300 hover:bg-[#c8a55e] dark:hover:border-primary-600 dark:hover:bg-primary-900/20"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedUploadIds((prev) => {
                            if (checked) {
                              return prev.includes(u.id)
                                ? prev
                                : [u.id, ...prev];
                            }
                            return prev.filter((x) => x !== u.id);
                          });
                        }}
                        className="mt-1"
                        title="Inclure dans le tableau"
                      />
                      <div className="text-sm font-medium text-[#f5f5f5] truncate">
                        {u.filename}
                      </div>
                    </div>
                    <div className="text-xs text-[#555555] mt-1">
                      {(u.sizeBytes / 1024).toFixed(1)} KB •{" "}
                      {new Date(u.uploadedAt).toLocaleString("fr-FR")}
                    </div>

                    <div className="flex justify-end items-center gap-3 mt-2">
                      <button
                        className="text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 transition-colors"
                        title="Télécharger"
                        onClick={() => handleDownloadUpload(u.id)}
                        disabled={loading}
                      >
                        <Download size={16} />
                      </button>
                      <button
                        className="text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 transition-colors"
                        title="Renommer"
                        onClick={() => handleRenameUpload(u.id)}
                        disabled={loading}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="text-[#555555] hover:text-danger-500 transition-colors"
                        title="Supprimer"
                        onClick={() => handleDeleteSelected(u.id)}
                        disabled={loading}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: table */}
        <div className="lg:col-span-3">
          {!isInvestmentSection && (
            <div className="card mb-6">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[#f5f5f5]">
                    Catégorisation IA
                  </h2>
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary py-2 px-4"
                      type="button"
                      onClick={() => setIsAiSectionCollapsed((v) => !v)}
                    >
                      {isAiSectionCollapsed ? "Afficher" : "Masquer"}
                    </button>
                    {aiRunning ? (
                      <button
                        className="btn-primary py-2 px-4"
                        type="button"
                        disabled
                        title="Catégorisation en cours"
                      >
                        {`Catégorisation… (${aiProgress.done}/${aiProgress.total})`}
                      </button>
                    ) : showAiModeChoice ? (
                      <>
                        <button
                          className="btn-primary py-2 px-4"
                          type="button"
                          disabled={selectedUploadIds.length === 0}
                          onClick={() => runAiCategorization("missing")}
                          title="Catégorise uniquement les lignes où aiCategory/aiSubCategory est vide"
                        >
                          Nouveau
                        </button>
                        <button
                          className="btn-primary py-2 px-4"
                          type="button"
                          disabled={selectedUploadIds.length === 0}
                          onClick={() => runAiCategorization("overwrite")}
                          title="Catégorise toutes les lignes (écrase aiCategory/aiSubCategory)"
                        >
                          Tout
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-primary py-2 px-4"
                        type="button"
                        disabled={selectedUploadIds.length === 0}
                        onClick={() => setShowAiModeChoice(true)}
                        title="Choisir le mode de catégorisation"
                      >
                        Catégoriser avec IA
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-sm text-[#8a8a8a]">
                  L’IA écrit le résultat dans{" "}
                  <span className="font-mono">aiCategory</span> et{" "}
                  <span className="font-mono">aiSubCategory</span>.
                </p>

                {schemaError && (
                  <div className="text-sm text-[#ef4444]">
                    {schemaError}
                  </div>
                )}

                {!isAiSectionCollapsed && (
                  <div className="rounded-lg border border-[rgba(255,255,255,0.06)] p-4 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                      <div className="flex gap-2 items-center">
                        <input
                          className="input-field"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="Nouvelle catégorie (ex: Alimentation)"
                        />
                        <button
                          type="button"
                          className="btn-secondary flex items-center gap-2"
                          onClick={() => {
                            const name = newCategoryName.trim();
                            if (!name) return;
                            setSchema((prev) => {
                              if (prev.some((c) => c.category === name))
                                return prev;
                              return [
                                ...prev,
                                { category: name, subcategories: ["Autres"] },
                              ];
                            });
                            setNewCategoryName("");
                          }}
                        >
                          <Plus size={18} />
                          Ajouter
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary py-2 px-4"
                          onClick={saveSchema}
                        >
                          Sauvegarder
                        </button>
                        <label className="text-sm text-[#8a8a8a] flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={showAdvancedSchema}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setShowAdvancedSchema(checked);
                              if (checked) {
                                setSchemaJsonDraft(
                                  JSON.stringify(schema, null, 2),
                                );
                              }
                            }}
                          />
                          Mode avancé (JSON)
                        </label>
                      </div>
                    </div>

                    <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
                      {schema.map((cat) => (
                        <div
                          key={cat.category}
                          className="rounded-lg border border-[rgba(255,255,255,0.06)] p-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <input
                                className="input-field"
                                value={cat.category}
                                onChange={(e) => {
                                  const nextName = e.target.value;
                                  setSchema((prev) =>
                                    prev.map((c) =>
                                      c.category === cat.category
                                        ? { ...c, category: nextName }
                                        : c,
                                    ),
                                  );
                                }}
                              />
                              <button
                                type="button"
                                className="text-[#555555] hover:text-danger-500 transition-colors"
                                title="Supprimer la catégorie"
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Supprimer la catégorie "${cat.category}" ?`,
                                    )
                                  )
                                    return;
                                  setSchema((prev) =>
                                    prev.filter(
                                      (c) => c.category !== cat.category,
                                    ),
                                  );
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>

                            <div className="flex items-center gap-2">
                              <input
                                className="input-field"
                                value={newSubByCategory[cat.category] || ""}
                                onChange={(e) =>
                                  setNewSubByCategory((prev) => ({
                                    ...prev,
                                    [cat.category]: e.target.value,
                                  }))
                                }
                                placeholder="Ajouter sous-catégorie"
                              />
                              <button
                                type="button"
                                className="btn-secondary flex items-center gap-2"
                                onClick={() => {
                                  const sub = (
                                    newSubByCategory[cat.category] || ""
                                  ).trim();
                                  if (!sub) return;
                                  setSchema((prev) =>
                                    prev.map((c) => {
                                      if (c.category !== cat.category) return c;
                                      if (c.subcategories.includes(sub))
                                        return c;
                                      return {
                                        ...c,
                                        subcategories: [
                                          ...c.subcategories,
                                          sub,
                                        ],
                                      };
                                    }),
                                  );
                                  setNewSubByCategory((prev) => ({
                                    ...prev,
                                    [cat.category]: "",
                                  }));
                                }}
                              >
                                <Plus size={18} />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 mt-3">
                            {cat.subcategories.map((sub) => (
                              <span
                                key={sub}
                                className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs border border-[rgba(255,255,255,0.06)] text-[#f5f5f5]"
                              >
                                {sub}
                                <button
                                  type="button"
                                  className="text-[#555555] hover:text-danger-500 transition-colors"
                                  title="Supprimer sous-catégorie"
                                  onClick={() => {
                                    setSchema((prev) =>
                                      prev.map((c) => {
                                        if (c.category !== cat.category)
                                          return c;
                                        const nextSubs = c.subcategories.filter(
                                          (s) => s !== sub,
                                        );
                                        return {
                                          ...c,
                                          subcategories:
                                            nextSubs.length > 0
                                              ? nextSubs
                                              : ["Autres"],
                                        };
                                      }),
                                    );
                                  }}
                                >
                                  <X size={14} />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {showAdvancedSchema && (
                      <div className="space-y-2">
                        <div className="text-sm text-[#8a8a8a]">
                          Mode avancé: tu peux éditer le JSON directement. Si tu
                          as une erreur du type{" "}
                          <span className="font-mono">Expected '{"}"}'</span>,
                          c’est qu’il manque une accolade/virgule.
                        </div>
                        <textarea
                          value={schemaJsonDraft}
                          onChange={(e) => setSchemaJsonDraft(e.target.value)}
                          className="input-field font-mono text-xs min-h-[180px]"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn-secondary py-2 px-4"
                            onClick={applySchemaJsonDraft}
                          >
                            Appliquer le JSON
                          </button>
                          <button
                            type="button"
                            className="btn-secondary py-2 px-4"
                            onClick={() =>
                              setSchemaJsonDraft(
                                JSON.stringify(schema, null, 2),
                              )
                            }
                          >
                            Réinitialiser
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-[#f5f5f5]">
                    {selectedUploadIds.length === 0
                      ? "Tableau"
                      : selectedUploadIds.length === 1
                        ? uploads.find((u) => u.id === selectedUploadIds[0])
                            ?.filename || "Tableau"
                        : `${selectedUploadIds.length} fichiers sélectionnés`}
                  </h2>
                  <p className="text-sm text-[#555555]">
                    {merged.rows.length} lignes • {merged.headers.length}{" "}
                    colonnes • séparateur “
                    {merged.delimiter === "\t"
                      ? "TAB"
                      : merged.delimiter === "mix"
                        ? "mix"
                        : merged.delimiter}
                    ”
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]"
                      size={18}
                    />
                    <input
                      type="text"
                      value={globalFilter}
                      onChange={(e) => {
                        setGlobalFilter(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Rechercher…"
                      className="pl-10 w-full rounded-lg py-2 bg-[#111111] text-[#f5f5f5] placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                    />
                  </div>

                  <button
                    className="btn-secondary flex items-center gap-2"
                    onClick={() => setShowColumnsPanel((v) => !v)}
                    type="button"
                  >
                    <Columns size={18} />
                    <span>Colonnes</span>
                  </button>
                  <button
                    className="btn-secondary flex items-center gap-2"
                    onClick={() => setEditRowsMode((v) => !v)}
                    type="button"
                  >
                    <Pencil size={18} />
                    <span>{editRowsMode ? "Terminer" : "Edit"}</span>
                  </button>
                </div>
              </div>

              {showColumnsPanel && merged.headers.length > 0 && (
                <div className="rounded-lg border border-[rgba(255,255,255,0.06)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-[#f5f5f5]">
                      Colonnes visibles
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn-secondary py-1 px-3 text-sm"
                        onClick={() => {
                          const next: Record<string, boolean> = {};
                          merged.headers.forEach((h) => (next[h] = true));
                          setVisibleColumns(next);
                        }}
                        type="button"
                      >
                        Tout afficher
                      </button>
                      <button
                        className="btn-secondary py-1 px-3 text-sm"
                        onClick={() => {
                          const next: Record<string, boolean> = {};
                          merged.headers.forEach((h) => (next[h] = false));
                          setVisibleColumns(next);
                        }}
                        type="button"
                      >
                        Tout masquer
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-auto pr-1">
                    {merged.headers.map((h) => (
                      <label
                        key={h}
                        className="flex items-center gap-2 text-sm text-[#8a8a8a]"
                      >
                        <input
                          type="checkbox"
                          checked={visibleColumns[h] !== false}
                          onChange={(e) =>
                            setVisibleColumns((prev) => ({
                              ...prev,
                              [h]: e.target.checked,
                            }))
                          }
                        />
                        <span className="truncate" title={h}>
                          {h}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              {merged.headers.length === 0 ? (
                <div className="text-sm text-[#555555]">
                  Coche un ou plusieurs CSV à gauche pour afficher les
                  transactions (ex: tous les mois).
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-transparent">
                        <tr>
                          <th className="w-10 px-2 py-2 text-center text-xs font-semibold text-[#555555] uppercase tracking-wider" title="Statut Budget Réel & Tricount">
                            Budget
                          </th>
                          {displayHeaders.map((h) => {
                            const isActive = sortKey === h;
                            return (
                              <th
                                key={h}
                                className="px-3 py-2 text-left text-xs font-medium text-[#555555] uppercase tracking-wider text-[#f5f5f5] cursor-pointer select-none"
                                onClick={() => toggleSort(h)}
                                title="Cliquer pour trier"
                              >
                                <span className="inline-flex items-center gap-2">
                                  {h}
                                  {isActive && (
                                    <span className="text-[#555555]">
                                      {sortDir === "asc" ? "▲" : "▼"}
                                    </span>
                                  )}
                                </span>
                              </th>
                            );
                          })}
                          {editRowsMode && (
                            <th className="px-3 py-2 text-right text-xs font-medium text-[#555555] uppercase tracking-wider text-[#f5f5f5]">
                              Actions
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-[#111111]">
                        {pagedRows.map((row) => {
                          const rowKey = getStableBankRowId(row);
                          const matchedItem = tricountMatchMap.get(rowKey);
                          const isInTricount = !!matchedItem;

                          return (
                            <tr
                              key={rowKey || getLegacyIndexBankRowId(row)}
                              className={`even:bg-[rgba(200,165,94,0.10)] dark:even:bg-[rgba(200,165,94,0.07)] hover:bg-[rgba(200,165,94,0.14)] dark:hover:bg-[rgba(200,165,94,0.11)] transition-colors ${
                                isInTricount ? "bg-emerald-50/30 dark:bg-emerald-950/15" : ""
                              }`}
                            >
                              <td className="w-10 px-2 py-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenTricountModal(row)}
                                  className={`w-7 h-7 inline-flex items-center justify-center rounded-lg transition shadow-xs group ${
                                    isInTricount
                                      ? "bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500 border border-emerald-600 dark:border-emerald-500 ring-2 ring-emerald-500/20"
                                      : "bg-primary-50 text-[#c8a55e] hover:bg-[#c8a55e] hover:text-white dark:bg-primary-950/60 text-[#c8a55e] dark:hover:bg-[#c8a55e] hover:text-[#f5f5f5] border border-primary-200 dark:border-primary-800"
                                  }`}
                                  title={
                                    isInTricount
                                      ? `Présent dans le Budget (${matchedItem?.month || ""}${matchedItem?.label ? ` • "${matchedItem.label}"` : ""}) - Cliquer pour modifier ou retirer`
                                      : "Ajouter au Budget Réel & Tricount"
                                  }
                                >
                                  {isInTricount ? (
                                    <Check size={15} className="stroke-[2.5] transition-transform group-hover:scale-110" />
                                  ) : (
                                    <Plus size={15} className="transition-transform group-hover:scale-110" />
                                  )}
                                </button>
                              </td>
                            {displayHeaders.map((h) => (
                              <td
                                key={h}
                                className="px-3 py-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#f5f5f5] whitespace-nowrap"
                              >
                                {h === "aiCategory" || h === "aiSubCategory"
                                  ? (() => {
                                      const isEditing =
                                        editTarget &&
                                        editTarget.uploadId ===
                                          row.__uploadId &&
                                        String(editTarget.rowIndex) ===
                                          String(row.__rowIndex) &&
                                        editTarget.field === h;

                                      if (isEditing) {
                                        const options =
                                          h === "aiCategory"
                                            ? getCategoryOptions
                                            : getSubcategoryOptions(
                                                (
                                                  row.aiCategory ?? ""
                                                ).toString(),
                                              );
                                        return (
                                          <div className="flex items-center gap-2">
                                            <select
                                              className="input-field py-1 px-2 w-auto"
                                              value={editValue}
                                              onChange={(e) =>
                                                setEditValue(e.target.value)
                                              }
                                            >
                                              <option value="">
                                                {h === "aiCategory"
                                                  ? "— catégorie —"
                                                  : "— sous-catégorie —"}
                                              </option>
                                              {options.map((opt) => (
                                                <option key={opt} value={opt}>
                                                  {opt}
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              type="button"
                                              className="btn-secondary py-1 px-2 text-xs"
                                              onClick={saveEdit}
                                              disabled={editSaving}
                                              title="Enregistrer"
                                            >
                                              OK
                                            </button>
                                            <button
                                              type="button"
                                              className="btn-secondary py-1 px-2 text-xs"
                                              onClick={cancelEdit}
                                              disabled={editSaving}
                                              title="Annuler"
                                            >
                                              Annuler
                                            </button>
                                          </div>
                                        );
                                      }

                                      const value = (row[h] ?? "").toString();
                                      return (
                                        <button
                                          type="button"
                                          className="text-left hover:underline"
                                          onClick={() =>
                                            startEdit(
                                              row as Record<string, string>,
                                              h,
                                            )
                                          }
                                          title="Cliquer pour modifier"
                                        >
                                          {value || (
                                            <span className="text-[#555555]">
                                              —
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })()
                                  : (row[h] ?? "").toString()}
                              </td>
                            ))}
                            {editRowsMode && (
                              <td className="px-3 py-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  className="text-[#555555] hover:text-danger-500 disabled:opacity-50 p-1"
                                  title="Supprimer la ligne"
                                  onClick={() =>
                                    deleteRowFromCsv(
                                      row as Record<string, string>,
                                    )
                                  }
                                  disabled={rowDeleting}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
                    <div className="text-sm text-[#555555]">
                      {sortedRows.length} résultat
                      {sortedRows.length > 1 ? "s" : ""} • page {page} /{" "}
                      {pageCount}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-sm text-[#555555] flex items-center gap-2">
                        Lignes:
                        <select
                          value={pageSize}
                          onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                          }}
                          className="input-field py-1 px-2 w-auto"
                        >
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                          <option value={250}>250</option>
                          <option value={0}>Tout</option>
                        </select>
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          className="btn-secondary py-1 px-3 text-sm"
                          disabled={page <= 1}
                          onClick={() => setPage(1)}
                          type="button"
                        >
                          {"<<"}
                        </button>
                        <button
                          className="btn-secondary py-1 px-3 text-sm"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          type="button"
                        >
                          {"<"}
                        </button>
                        <button
                          className="btn-secondary py-1 px-3 text-sm"
                          disabled={page >= pageCount}
                          onClick={() =>
                            setPage((p) => Math.min(pageCount, p + 1))
                          }
                          type="button"
                        >
                          {">"}
                        </button>
                        <button
                          className="btn-secondary py-1 px-3 text-sm"
                          disabled={page >= pageCount}
                          onClick={() => setPage(pageCount)}
                          type="button"
                        >
                          {">>"}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Toast Feedback Tricount */}
      {tricountToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0a0a0a] text-white dark:bg-[#111111] dark:text-[#f5f5f5] px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium animate-fade-in">
          <CheckCircle2 size={16} className="text-emerald-400 dark:text-emerald-600 flex-shrink-0" />
          <span>{tricountToast}</span>
          <Link
            to="/budget-tracking"
            className="text-xs font-bold text-primary-400 dark:text-[#c8a55e] hover:underline flex items-center gap-0.5 ml-2"
          >
            <span>Voir</span>
            <ArrowRight size={12} />
          </Link>
        </div>
      )}

      {/* Modale d'intégration Budget */}
      {showTricountModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111111] dark:bg-[#1a1a1a] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] space-y-4 animate-scale-up text-xs">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] pb-3">
              <h3 className="text-base font-bold text-[#f5f5f5]">
                {matchedTricountItem ? "Modifier dans le Budget" : "Intégrer dans le Budget"}
              </h3>
              <button
                type="button"
                onClick={() => setShowTricountModal(false)}
                className="text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              >
                <X size={18} />
              </button>
            </div>

            {matchedTricountItem && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="font-semibold text-xs truncate">
                    Présent dans le Budget ({matchedTricountItem.month})
                    {matchedTricountItem.label ? ` : "${matchedTricountItem.label}"` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDeleteMatchedTricountItem}
                  className="text-xs font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:underline flex items-center gap-1 shrink-0 ml-2"
                  title="Supprimer cette opération du Budget"
                >
                  <Trash2 size={13} />
                  Retirer
                </button>
              </div>
            )}

            {/* Toggle Dépense (-) vs Placement (-) vs Revenu (+) */}
            <div className="grid grid-cols-3 p-1 rounded-xl bg-[#1a1a1a] bg-[#161616]">
              <button
                type="button"
                onClick={() => setTricountModalType("expense")}
                className={`py-1.5 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  tricountModalType === "expense"
                    ? "bg-[#111111] text-rose-600 dark:text-rose-400 shadow-xs"
                    : "text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                }`}
              >
                <span>Dépense (-)</span>
              </button>
              <button
                type="button"
                onClick={() => setTricountModalType("placement")}
                className={`py-1.5 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  tricountModalType === "placement"
                    ? "bg-[#111111] text-indigo-600 dark:text-indigo-400 shadow-xs"
                    : "text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                }`}
              >
                <span>Placement (-)</span>
              </button>
              <button
                type="button"
                onClick={() => setTricountModalType("income")}
                className={`py-1.5 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  tricountModalType === "income"
                    ? "bg-[#111111] text-emerald-600 dark:text-emerald-400 shadow-xs"
                    : "text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                }`}
              >
                <span>Revenu (+)</span>
              </button>
            </div>

            {tricountModalType === "income" ? (
              /* FORMULAIRE REVENU */
              <form onSubmit={handleConfirmTricount} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-[#8a8a8a] mb-1">
                      Date de l'opération *
                    </label>
                    <input
                      type="date"
                      required
                      value={tricountDate}
                      onChange={(e) => setTricountDate(e.target.value)}
                      className="input-field w-full py-1.5"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#8a8a8a] mb-1">
                      Montant reçu (€) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={tricountAmount}
                      onChange={(e) =>
                        setTricountAmount(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className="input-field w-full py-1.5 font-bold text-emerald-600 dark:text-emerald-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Libellé du revenu *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Salaire, Remboursement, Prime..."
                    value={tricountLabel}
                    onChange={(e) => setTricountLabel(e.target.value)}
                    className="input-field w-full py-1.5"
                  />
                </div>

                {!isSoloMode ? (
                  <div>
                    <label className="block font-bold text-[#8a8a8a] mb-1">
                      Bénéficiaire du revenu *
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setTricountBeneficiary("person1")}
                        className={`p-2 rounded-xl border text-center font-bold transition ${
                          tricountBeneficiary === "person1"
                            ? "bg-primary-50 text-[#c8a55e] border-[#c8a55e] dark:bg-primary-950/40 text-[#c8a55e]"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        {p1Name}
                      </button>

                      <button
                        type="button"
                        onClick={() => setTricountBeneficiary("person2")}
                        className={`p-2 rounded-xl border text-center font-bold transition ${
                          tricountBeneficiary === "person2"
                            ? "bg-primary-50 text-[#c8a55e] border-[#c8a55e] dark:bg-primary-950/40 text-[#c8a55e]"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        {p2Name}
                      </button>

                      <button
                        type="button"
                        onClick={() => setTricountBeneficiary("shared")}
                        className={`p-2 rounded-xl border text-center font-bold transition ${
                          tricountBeneficiary === "shared"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        Commun (50/50)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-[#0a0a0a] dark:bg-[#222222] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a] font-medium">
                    Mode Solo : revenu 100% alloué à {p1Name}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                  <button
                    type="button"
                    onClick={() => setShowTricountModal(false)}
                    className="btn-secondary py-1.5"
                  >
                    Annuler
                  </button>
                  <button type="submit" className="btn-primary py-1.5 px-4 font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                    {matchedTricountItem ? "Mettre à jour le revenu" : "Confirmer l'ajout du revenu"}
                  </button>
                </div>
              </form>
            ) : (
              /* FORMULAIRE DÉPENSE */
              <form onSubmit={handleConfirmTricount} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-[#8a8a8a] mb-1">
                      Date de l'opération *
                    </label>
                    <input
                      type="date"
                      required
                      value={tricountDate}
                      onChange={(e) => setTricountDate(e.target.value)}
                      className="input-field w-full py-1.5"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#8a8a8a] mb-1">
                      Montant (€) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={tricountAmount}
                      onChange={(e) =>
                        setTricountAmount(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className="input-field w-full py-1.5 font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Libellé de la dépense *
                  </label>
                  <input
                    type="text"
                    required
                    value={tricountLabel}
                    onChange={(e) => setTricountLabel(e.target.value)}
                    className="input-field w-full py-1.5"
                  />
                </div>

                {!isSoloMode && (
                  <div>
                    <label className="block font-bold text-[#8a8a8a] mb-1">
                      Payé par *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTricountPayer("person1")}
                        className={`p-2 rounded-xl border text-center font-bold transition ${
                          tricountPayer === "person1"
                            ? "bg-primary-50 text-[#c8a55e] border-[#c8a55e] dark:bg-primary-950/40 text-[#c8a55e]"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        {p1Name}
                      </button>

                      <button
                        type="button"
                        onClick={() => setTricountPayer("person2")}
                        className={`p-2 rounded-xl border text-center font-bold transition ${
                          tricountPayer === "person2"
                            ? "bg-primary-50 text-[#c8a55e] border-[#c8a55e] dark:bg-primary-950/40 text-[#c8a55e]"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        {p2Name}
                      </button>
                    </div>
                  </div>
                )}

                {/* Poche de la Stratégie */}
                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Poche de la Stratégie *
                  </label>
                  <select
                    value={tricountPocketId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      setTricountPocketId(pid);
                      setTricountSubPocketId("");
                      setTricountSubPocketName("");
                      const chosenPocket = savingsStrategy?.pockets.find((p) => p.id === pid);
                      if (chosenPocket) {
                        if (isPlacementPocket(chosenPocket)) {
                          setTricountModalType("placement");
                        } else {
                          setTricountModalType("expense");
                        }
                      }
                      const auto = computeAutoSplit(pid, "");
                      setTricountSplitMethod(auto.splitMethod);
                      if (auto.splitMethod === "100_person1") {
                        setTricountPayer("person1");
                      } else if (auto.splitMethod === "100_person2") {
                        setTricountPayer("person2");
                      }
                    }}
                    className="input-field w-full py-1.5"
                  >
                    <option value="unallocated">Autres / Dépense non classée</option>
                    {savingsStrategy?.pockets && savingsStrategy.pockets.filter((p) => !isPlacementPocket(p)).length > 0 && (
                      <optgroup label="Dépenses de vie courante & charges">
                        {savingsStrategy.pockets
                          .filter((p) => !isPlacementPocket(p))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.allocationValue} {p.allocationType === "percent" ? "%" : "€"})
                            </option>
                          ))}
                      </optgroup>
                    )}
                    {savingsStrategy?.pockets && savingsStrategy.pockets.filter((p) => isPlacementPocket(p)).length > 0 && (
                      <optgroup label="Épargne & Placements / Investissements">
                        {savingsStrategy.pockets
                          .filter((p) => isPlacementPocket(p))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.allocationValue} {p.allocationType === "percent" ? "%" : "€"})
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* Sous-poche associée (si la poche en possède) */}
                {(() => {
                  const currentPocket = savingsStrategy?.pockets.find(
                    (p) => p.id === tricountPocketId
                  );
                  if (
                    !currentPocket ||
                    !currentPocket.subItems ||
                    currentPocket.subItems.length === 0
                  ) {
                    return null;
                  }
                  return (
                    <div>
                      <label className="block font-bold text-[#8a8a8a] mb-1">
                        Sous-poche de "{currentPocket.name}" (Optionnel)
                      </label>
                      <select
                        value={tricountSubPocketId}
                        onChange={(e) => {
                          const subId = e.target.value;
                          setTricountSubPocketId(subId);
                          const subItem = currentPocket.subItems?.find((s) => s.id === subId);
                          setTricountSubPocketName(subItem ? subItem.name : "");
                          const auto = computeAutoSplit(tricountPocketId, subId);
                          setTricountSplitMethod(auto.splitMethod);
                          if (auto.splitMethod === "100_person1") {
                            setTricountPayer("person1");
                          } else if (auto.splitMethod === "100_person2") {
                            setTricountPayer("person2");
                          }
                        }}
                        className="input-field w-full py-1.5"
                      >
                        <option value="">-- Aucune sous-poche (Dépense globale) --</option>
                        {currentPocket.subItems.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name} {sub.amount > 0 ? `(${formatEur(sub.amount)}/m)` : ""}
                            {sub.personId === "person1"
                              ? ` · ${p1Name}`
                              : sub.personId === "person2"
                              ? ` · ${p2Name}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })()}

                {/* Répartition Tricount Automatique basée sur le setup de la poche */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-bold text-[#8a8a8a]">
                      Répartition Tricount
                    </label>
                    {!isSoloMode && (
                      <button
                        type="button"
                        onClick={() => setShowSplitOverride((prev) => !prev)}
                        className="text-[10px] text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 underline font-medium"
                      >
                        {showSplitOverride ? "Masquer ajustements" : "Ajuster manuellement"}
                      </button>
                    )}
                  </div>

                  {(() => {
                    const auto = computeAutoSplit(tricountPocketId, tricountSubPocketId);
                    return (
                      <div className="p-2.5 rounded-xl bg-[#0a0a0a] dark:bg-[#222222] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            style={
                              tricountSplitMethod === "100_person1"
                                ? p1Theme.badgeStyle
                                : tricountSplitMethod === "100_person2"
                                ? p2Theme.badgeStyle
                                : p1Theme.badgeStyle
                            }
                            className="px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5"
                          >
                            {tricountSplitMethod === "50_50" ? (
                              <>
                                <Split size={12} /> 50 / 50
                              </>
                            ) : tricountSplitMethod === "proportional" ? (
                              <>
                                <Scale size={12} /> Prorata
                              </>
                            ) : tricountSplitMethod === "100_person1" ? (
                              <>
                                <User size={12} /> 100% {p1Name}
                              </>
                            ) : (
                              <>
                                <User size={12} /> 100% {p2Name}
                              </>
                            )}
                          </span>
                          <span className="text-[11px] text-[#8a8a8a]">
                            {auto.explanation}
                          </span>
                        </div>
                        <span className="text-[10px] uppercase font-bold tracking-wide text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded">
                          Auto
                        </span>
                      </div>
                    );
                  })()}

                  {!isSoloMode && showSplitOverride && (
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5 animate-fade-in">
                      <button
                        type="button"
                        onClick={() => setTricountSplitMethod("50_50")}
                        className={`p-1.5 rounded-lg border text-center font-bold transition text-xs ${
                          tricountSplitMethod === "50_50"
                            ? "bg-[#c8a55e] text-white border-primary-600"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        50 / 50
                      </button>

                      <button
                        type="button"
                        onClick={() => setTricountSplitMethod("proportional")}
                        className={`p-1.5 rounded-lg border text-center font-bold transition text-xs ${
                          tricountSplitMethod === "proportional"
                            ? "bg-[#c8a55e] text-white border-primary-600"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        Prorata
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setTricountSplitMethod("100_person1");
                          setTricountPayer("person1");
                        }}
                        className={`p-1.5 rounded-lg border text-center font-bold transition text-xs ${
                          tricountSplitMethod === "100_person1"
                            ? "bg-[#c8a55e] text-white border-primary-600"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        100% {p1Name}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setTricountSplitMethod("100_person2");
                          setTricountPayer("person2");
                        }}
                        className={`p-1.5 rounded-lg border text-center font-bold transition text-xs ${
                          tricountSplitMethod === "100_person2"
                            ? "bg-[#c8a55e] text-white border-primary-600"
                            : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                      >
                        100% {p2Name}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                  <button
                    type="button"
                    onClick={() => setShowTricountModal(false)}
                    className="btn-secondary py-1.5"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className={`btn-primary py-1.5 px-4 font-bold ${
                      tricountModalType === "placement"
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                        : ""
                    }`}
                  >
                    {matchedTricountItem
                      ? (tricountModalType === "placement"
                          ? "Mettre à jour le placement"
                          : "Mettre à jour la dépense")
                      : (tricountModalType === "placement"
                          ? "Confirmer l'ajout du placement"
                          : "Confirmer l'ajout de la dépense")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Banking;
