import React, { useEffect, useMemo, useState } from "react";
import {
  Upload,
  Trash2,
  Table as TableIcon,
  Columns,
  Search,
  Plus,
  X,
  Landmark,
  TrendingUp,
  Download,
  Pencil,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
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

const Banking: React.FC = () => {
  const { currentUser } = useUser();

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
      <div className="border-b border-gray-200 dark:border-gray-700">
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
                    ? "border-primary-500 text-primary-600 dark:text-primary-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-300 dark:hover:text-white dark:hover:border-gray-600"
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {currentSectionLabel}
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
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
          <p className="text-danger-600 dark:text-danger-400">{error}</p>
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
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {isInvestmentSection
                  ? `Saisie manuelle (tableur) - ${currentSectionLabel}`
                  : `Ajouter une ligne manuelle (${currentSectionLabel})`}
              </h2>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
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
                    <div className="text-xs text-gray-500 dark:text-gray-300">
                      Champs basés sur tes CSV existants (mêmes colonnes).
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Colonnes (personnalisables)
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-300">
                        Conseil: garde au minimum{" "}
                        <span className="font-mono">dateVal</span> et{" "}
                        <span className="font-mono">amount</span> pour que les
                        graphes du dashboard puissent lire tes lignes.
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {manualCustomHeaders.map((h) => (
                          <span
                            key={h}
                            className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
                          >
                            {h}
                            <button
                              type="button"
                              className="text-gray-400 hover:text-danger-500 transition-colors"
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
                        <div className="text-xs text-gray-500 dark:text-gray-300">
                          Applique exactement les mêmes colonnes qu'un autre
                          compte investissement.
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto max-h-[55vh]">
                        <table className="min-w-full text-sm">
                          <thead className="sticky top-0 bg-white dark:bg-gray-900 z-10">
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                              <th className="px-2 py-2 text-left text-xs text-gray-500 w-[56px]">
                                #
                              </th>
                              {effectiveHeaders.map((h) => (
                                <th
                                  key={h}
                                  className="px-2 py-2 text-left text-xs text-gray-500 whitespace-nowrap"
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
                                className="border-b border-gray-100 dark:border-gray-800"
                              >
                                <td className="px-2 py-2 text-xs text-gray-500">
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
                                    className="text-gray-400 hover:text-danger-500"
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
                            <label className="text-xs text-gray-500">
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
                              <div className="text-[11px] text-gray-500">
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
          <div className="relative w-full max-w-4xl mx-4 bg-white dark:bg-[#111111] rounded-lg p-6 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Mise à jour BoursoBank
              </h2>
              <button
                type="button"
                onClick={closeBoursoSyncModal}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Mot de passe BoursoBank
                  </label>
                  <input
                    type="password"
                    value={boursoPassword}
                    onChange={(e) => setBoursoPassword(e.target.value)}
                    placeholder="Mot de passe (non stocké)"
                    className="w-full px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Pages à récupérer
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={boursoPages}
                    onChange={(e) => setBoursoPages(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                  />
                </div>
              </div>

              {!boursoSyncPreview && (
                <button
                  type="button"
                  onClick={handleBoursoSync}
                  disabled={boursoSyncLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-60"
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
                        className="border border-gray-200 dark:border-gray-700 rounded-md p-4"
                      >
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-gray-100">
                              {item.accountName}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {item.section === "bank"
                                ? "Compte bancaire"
                                : "Investissement"}{" "}
                              • {item.filename}
                            </p>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            {item.addedCount} nouvelle(s) • total{" "}
                            {item.totalCount}
                          </div>
                        </div>

                        {item.newRows?.length ? (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                  {headers.map((h) => (
                                    <th
                                      key={h}
                                      className="px-2 py-1 text-left text-gray-600 dark:text-gray-300"
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
                                    className="border-t border-gray-200 dark:border-gray-700"
                                  >
                                    {headers.map((h) => (
                                      <td
                                        key={h}
                                        className="px-2 py-1 text-gray-900 dark:text-gray-100 whitespace-nowrap"
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
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Aucune nouvelle donnée détectée.
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {boursoSyncPreview && (
                    <div className="flex flex-col sm:flex-row gap-2 justify-end">
                      <button
                        type="button"
                        onClick={handleBoursoReject}
                        className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
                      >
                        Refuser
                      </button>
                      <button
                        type="button"
                        onClick={handleBoursoConfirm}
                        disabled={boursoSyncLoading}
                        className="px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
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
                <TableIcon className="text-gray-500" size={18} />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Fichiers
                </h2>
              </div>
              <span className="text-xs text-gray-500">
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
                <div className="text-sm text-gray-500 dark:text-gray-400">
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
                        ? "border-primary-500 bg-primary-100 hover:bg-primary-200 dark:bg-primary-900/35 dark:hover:bg-primary-900/45"
                        : "border-gray-200 dark:border-gray-700 hover:border-primary-300 hover:bg-primary-600 dark:hover:border-primary-600 dark:hover:bg-primary-900/20"
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
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {u.filename}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {(u.sizeBytes / 1024).toFixed(1)} KB •{" "}
                      {new Date(u.uploadedAt).toLocaleString("fr-FR")}
                    </div>

                    <div className="flex justify-end items-center gap-3 mt-2">
                      <button
                        className="text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        title="Télécharger"
                        onClick={() => handleDownloadUpload(u.id)}
                        disabled={loading}
                      >
                        <Download size={16} />
                      </button>
                      <button
                        className="text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        title="Renommer"
                        onClick={() => handleRenameUpload(u.id)}
                        disabled={loading}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="text-gray-400 hover:text-danger-500 transition-colors"
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
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
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

                <p className="text-sm text-gray-600 dark:text-gray-300">
                  L’IA écrit le résultat dans{" "}
                  <span className="font-mono">aiCategory</span> et{" "}
                  <span className="font-mono">aiSubCategory</span>.
                </p>

                {schemaError && (
                  <div className="text-sm text-danger-600 dark:text-danger-400">
                    {schemaError}
                  </div>
                )}

                {!isAiSectionCollapsed && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
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
                        <label className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
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
                          className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
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
                                className="text-gray-400 hover:text-danger-500 transition-colors"
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
                                className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
                              >
                                {sub}
                                <button
                                  type="button"
                                  className="text-gray-400 hover:text-danger-500 transition-colors"
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
                        <div className="text-sm text-gray-600 dark:text-gray-300">
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
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selectedUploadIds.length === 0
                      ? "Tableau"
                      : selectedUploadIds.length === 1
                        ? uploads.find((u) => u.id === selectedUploadIds[0])
                            ?.filename || "Tableau"
                        : `${selectedUploadIds.length} fichiers sélectionnés`}
                  </h2>
                  <p className="text-sm text-gray-500">
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
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
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
                      className="pl-10 w-full rounded-lg py-2 bg-white dark:bg-[#111111] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
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
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
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
                        className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
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
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Coche un ou plusieurs CSV à gauche pour afficher les
                  transactions (ex: tous les mois).
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-transparent">
                        <tr>
                          {displayHeaders.map((h) => {
                            const isActive = sortKey === h;
                            return (
                              <th
                                key={h}
                                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white cursor-pointer select-none"
                                onClick={() => toggleSort(h)}
                                title="Cliquer pour trier"
                              >
                                <span className="inline-flex items-center gap-2">
                                  {h}
                                  {isActive && (
                                    <span className="text-gray-400">
                                      {sortDir === "asc" ? "▲" : "▼"}
                                    </span>
                                  )}
                                </span>
                              </th>
                            );
                          })}
                          {editRowsMode && (
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-white">
                              Actions
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-[#111111]">
                        {pagedRows.map((row, idx) => (
                          <tr
                            key={idx}
                            className="even:bg-gray-50 dark:even:bg-gray-800"
                          >
                            {displayHeaders.map((h) => (
                              <td
                                key={h}
                                className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 whitespace-nowrap"
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
                                            <span className="text-gray-400">
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
                              <td className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-right">
                                <button
                                  type="button"
                                  className="text-gray-400 hover:text-danger-500 disabled:opacity-50"
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
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
                    <div className="text-sm text-gray-500">
                      {sortedRows.length} résultat
                      {sortedRows.length > 1 ? "s" : ""} • page {page} /{" "}
                      {pageCount}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-sm text-gray-500 flex items-center gap-2">
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
    </div>
  );
};

export default Banking;
