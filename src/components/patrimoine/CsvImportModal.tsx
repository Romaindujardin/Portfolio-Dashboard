import React, { useState, useMemo } from "react";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Layers,
  Building2,
  Wallet2,
} from "lucide-react";
import {
  Modal,
  Button,
  Card,
  Input,
  Select,
  Badge,
  formatEur,
  cn,
} from "./shared";
import type { PortfolioAccount, PortfolioAccountType } from "../../types/portfolio";
import {
  detectCsvDialect,
  detectCsvMode,
  suggestColumnMapping,
  convertMappedRows,
  parseRawCsv,
  type CsvDialect,
  type CsvMode,
  type HoldingImportItem,
  type TransactionImportItem,
} from "../../utils/csvParserOptimized";
import { importAccountCsv } from "../../services/portfolioApi";

interface CsvImportModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  accounts: PortfolioAccount[];
  preselectedAccountId?: string | null;
  onSuccess: () => Promise<void> | void;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  open,
  onClose,
  userId,
  accounts,
  preselectedAccountId,
  onSuccess,
}) => {
  // Étape du wizard : 1 (Fichier & Compte) -> 2 (Mappage & Aperçu) -> 3 (Succès)
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Configuration du compte
  const [destinationType, setDestinationType] = useState<"NEW" | "EXISTING">(
    preselectedAccountId ? "EXISTING" : "NEW",
  );
  const [targetAccountId, setTargetAccountId] = useState<string>(
    preselectedAccountId || (accounts[0]?.id ?? ""),
  );
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState<PortfolioAccountType>("EMPLOYEE_SAVINGS");

  // Configuration du dialecte et des données
  const [mode, setMode] = useState<CsvMode>("HOLDINGS");
  const [dialect, setDialect] = useState<CsvDialect>({
    delimiter: ";",
    decimalStyle: "COMMA",
    dateFormat: "DD/MM/YYYY",
    hasHeader: true,
  });
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Résultat d'importation
  const [importResult, setImportResult] = useState<{
    importedCount: number;
    totalValue: number;
    accountName: string;
  } | null>(null);

  // Analyse automatique dès que le contenu CSV change
  const handleFileContent = (content: string, name = "") => {
    setError(null);
    setCsvContent(content);
    if (name) {
      setFileName(name);
      // Suggestion automatique du nom de compte à partir du fichier (ex: Natixis_PEE.csv -> Natixis PEE)
      const cleanedName = name
        .replace(/\.csv$/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
      if (!newAccountName) {
        setNewAccountName(cleanedName);
      }
      if (/natixis|amundi|pee|percol|epargne/i.test(cleanedName)) {
        setNewAccountType("EMPLOYEE_SAVINGS");
      } else if (/gresham|assurance|vie/i.test(cleanedName)) {
        setNewAccountType("SAVINGS");
      } else if (/pea/i.test(cleanedName)) {
        setNewAccountType("PEA");
      } else if (/cto|bourse|titres/i.test(cleanedName)) {
        setNewAccountType("SECURITIES");
      }
    }

    const detectedDialect = detectCsvDialect(content);
    setDialect(detectedDialect);

    const parsed = parseRawCsv(content, detectedDialect.delimiter);
    if (parsed.length > 0) {
      const headers = parsed[0];
      const detectedMode = detectCsvMode(headers);
      setMode(detectedMode);
      const suggested = suggestColumnMapping(headers, detectedMode);
      setMapping(suggested);
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      handleFileContent(text, file.name);
    };
    reader.onerror = () => {
      setError("Impossible de lire ce fichier.");
    };
    reader.readAsText(file);
  };

  // Tableau brut découpe
  const rawRows = useMemo(() => {
    if (!csvContent) return [];
    return parseRawCsv(csvContent, dialect.delimiter);
  }, [csvContent, dialect.delimiter]);

  const headers = useMemo(() => {
    return rawRows[0] || [];
  }, [rawRows]);

  const dataRows = useMemo(() => {
    return rawRows.slice(1);
  }, [rawRows]);

  // Données converties selon le mapping actuel
  const mappedItems = useMemo(() => {
    if (dataRows.length === 0 || headers.length === 0) return [];
    return convertMappedRows(dataRows, headers, mapping, dialect, mode);
  }, [dataRows, headers, mapping, dialect, mode]);

  // Valeur totale estimée pour l'aperçu
  const estimatedTotal = useMemo(() => {
    if (mode === "HOLDINGS") {
      return (mappedItems as HoldingImportItem[]).reduce(
        (sum, item) => sum + (item.value || item.quantity * item.price || 0),
        0,
      );
    }
    return (mappedItems as TransactionImportItem[]).reduce(
      (sum, item) => sum + (item.amount || 0),
      0,
    );
  }, [mappedItems, mode]);

  // Passage à l'étape 2 (Validation du fichier & compte)
  const goToStep2 = () => {
    setError(null);
    if (!csvContent.trim() || rawRows.length < 2) {
      setError("Veuillez sélectionner un fichier CSV contenant des données.");
      return;
    }
    if (destinationType === "NEW" && !newAccountName.trim()) {
      setError("Veuillez nommer le nouveau compte à créer (ex: Natixis - PEE, Gresham...).");
      return;
    }
    if (destinationType === "EXISTING" && !targetAccountId) {
      setError("Veuillez sélectionner un compte de destination existant.");
      return;
    }
    setStep(2);
  };

  // Exécution de l'import
  const handleExecuteImport = async () => {
    setError(null);
    if (mappedItems.length === 0) {
      setError("Aucune ligne valide à importer.");
      return;
    }
    setLoading(true);
    try {
      const payload: {
        accountId?: string;
        newAccount?: { name: string; type: PortfolioAccountType; currency: string };
        mode: CsvMode;
        items: unknown[];
      } = {
        mode,
        items: mappedItems,
      };

      if (destinationType === "NEW") {
        payload.newAccount = {
          name: newAccountName.trim(),
          type: newAccountType,
          currency: "EUR",
        };
      } else {
        payload.accountId = targetAccountId;
      }

      const res = await importAccountCsv(userId, payload);
      setImportResult({
        importedCount: res.importedCount,
        totalValue: res.totalValue,
        accountName: res.account.name,
      });
      await onSuccess();
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'importation.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetAndClose = () => {
    setStep(1);
    setCsvContent("");
    setFileName("");
    setNewAccountName("");
    setImportResult(null);
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      wide
      title={
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(200,165,94,0.15)] text-[#d4b56e]">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <span>Importation CSV — Compte & Portefeuille</span>
        </div>
      }
      onClose={handleResetAndClose}
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" onClick={handleResetAndClose}>
              Annuler
            </Button>
            <Button variant="primary" onClick={goToStep2} disabled={!csvContent}>
              Suivant : Mappage & Aperçu <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="secondary" onClick={() => setStep(1)} disabled={loading}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Retour
            </Button>
            <Button
              variant="primary"
              onClick={handleExecuteImport}
              loading={loading}
              disabled={mappedItems.length === 0}
            >
              Importer {mappedItems.length} ligne{mappedItems.length > 1 ? "s" : ""}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={handleResetAndClose}>
            Terminer
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[#fca5a5]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ÉTAPE 1 : FICHIER & DESTINATION */}
        {step === 1 && (
          <div className="space-y-5">
            {/* Zone de téléversement */}
            <div>
              <label className="block text-xs font-medium text-[#f5f5f5] mb-1.5">
                Fichier CSV (Natixis, Gresham, banque ou courtier)
              </label>
              <div
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer",
                  dragOver
                    ? "border-[#c8a55e] bg-[rgba(200,165,94,0.05)]"
                    : csvContent
                      ? "border-[#10b981]/40 bg-[#10b981]/5"
                      : "border-[rgba(255,255,255,0.12)] hover:border-[#c8a55e]/60 bg-[#161616]",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                onClick={() => {
                  const input = document.getElementById("csv-file-input") as HTMLInputElement;
                  input?.click();
                }}
              >
                <input
                  id="csv-file-input"
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                {csvContent ? (
                  <>
                    <CheckCircle2 className="h-8 w-8 text-[#10b981]" />
                    <p className="text-sm font-medium text-[#f5f5f5]">
                      {fileName || "Fichier CSV chargé"}
                    </p>
                    <p className="text-xs text-[#8a8a8a]">
                      {dataRows.length} lignes détectées · Séparateur :{" "}
                      <code className="text-[#c8a55e]">
                        {dialect.delimiter === "\t" ? "Tabulation" : dialect.delimiter}
                      </code>
                    </p>
                    <Button size="sm" variant="secondary" className="mt-1">
                      Changer de fichier
                    </Button>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-[#8a8a8a]" />
                    <p className="text-sm font-medium text-[#f5f5f5]">
                      Glissez votre export CSV ici ou cliquez pour parcourir
                    </p>
                    <p className="text-xs text-[#6a6a6a]">
                      Compatible avec les relevés PEE Natixis, Gresham Banque Privée, BoursoBank, PEA, etc.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Compte cible */}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-[#f5f5f5]">
                Compte de destination
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDestinationType("NEW")}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors",
                    destinationType === "NEW"
                      ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                      : "border-[rgba(255,255,255,0.08)] bg-[#161616] text-[#8a8a8a] hover:text-[#f5f5f5]",
                  )}
                >
                  <Sparkles className="h-4 w-4 text-[#c8a55e]" />
                  <div>
                    <p className="text-xs font-semibold">Créer un nouveau compte</p>
                    <p className="text-[10px] text-[#6a6a6a]">Natixis, Gresham, nouveau PEE...</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDestinationType("EXISTING")}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors",
                    destinationType === "EXISTING"
                      ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                      : "border-[rgba(255,255,255,0.08)] bg-[#161616] text-[#8a8a8a] hover:text-[#f5f5f5]",
                  )}
                >
                  <Wallet2 className="h-4 w-4 text-[#c8a55e]" />
                  <div>
                    <p className="text-xs font-semibold">Compte existant</p>
                    <p className="text-[10px] text-[#6a6a6a]">Alimenter un compte déjà créé</p>
                  </div>
                </button>
              </div>

              {destinationType === "NEW" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-[#8a8a8a] mb-1">
                      Nom du compte *
                    </label>
                    <Input
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      placeholder="Ex: Natixis - PEE Safran, Gresham..."
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#8a8a8a] mb-1">
                      Type de patrimoine
                    </label>
                    <Select
                      value={newAccountType}
                      onChange={(e) =>
                        setNewAccountType(e.target.value as PortfolioAccountType)
                      }
                    >
                      <option value="EMPLOYEE_SAVINGS">Épargne salariale (PEE, PERCOL)</option>
                      <option value="SECURITIES">Compte-titres ordinaire (CTO)</option>
                      <option value="PEA">Plan d'Épargne en Actions (PEA)</option>
                      <option value="SAVINGS">Épargne / Assurance-Vie</option>
                      <option value="CHECKING">Compte bancaire courant</option>
                      <option value="OTHER">Autre compte</option>
                    </Select>
                  </div>
                </div>
              ) : (
                <div className="pt-1">
                  <label className="block text-[11px] text-[#8a8a8a] mb-1">
                    Sélectionnez le compte à créditer *
                  </label>
                  <Select
                    value={targetAccountId}
                    onChange={(e) => setTargetAccountId(e.target.value)}
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.type}) — Solde : {formatEur(acc.balance)}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            {/* Type de données */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#f5f5f5]">
                Nature des données contenues dans le CSV
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode("HOLDINGS");
                    if (headers.length > 0) setMapping(suggestColumnMapping(headers, "HOLDINGS"));
                  }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                    mode === "HOLDINGS"
                      ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                      : "border-[rgba(255,255,255,0.08)] bg-[#161616] text-[#8a8a8a] hover:text-[#f5f5f5]",
                  )}
                >
                  <Layers className="h-4 w-4 text-[#c8a55e]" />
                  <div>
                    <p className="text-xs font-semibold">Positions / Titres (Recommandé PEE)</p>
                    <p className="text-[10px] text-[#6a6a6a]">
                      Fonds, parts, cours / VL et valorisation
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("TRANSACTIONS");
                    if (headers.length > 0) setMapping(suggestColumnMapping(headers, "TRANSACTIONS"));
                  }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                    mode === "TRANSACTIONS"
                      ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                      : "border-[rgba(255,255,255,0.08)] bg-[#161616] text-[#8a8a8a] hover:text-[#f5f5f5]",
                  )}
                >
                  <Building2 className="h-4 w-4 text-[#c8a55e]" />
                  <div>
                    <p className="text-xs font-semibold">Transactions bancaires</p>
                    <p className="text-[10px] text-[#6a6a6a]">
                      Date, libellé, montants débit / crédit
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ÉTAPE 2 : MAPPAGE ET APERÇU */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Barre de dialecte détecté */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[#161616] p-3 text-xs">
              <div className="flex items-center gap-2 text-[#8a8a8a]">
                <Sparkles className="h-4 w-4 text-[#c8a55e]" />
                <span>
                  Format détecté : Séparateur{" "}
                  <strong className="text-[#f5f5f5]">
                    {dialect.delimiter === ";" ? "Point-virgule (;)" : dialect.delimiter === "," ? "Virgule (,)" : "Tabulation"}
                  </strong>{" "}
                  · Décimales{" "}
                  <strong className="text-[#f5f5f5]">
                    {dialect.decimalStyle === "COMMA" ? "Virgule (1 234,56)" : "Point (1234.56)"}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="gold">{dataRows.length} lignes trouvées</Badge>
                <Badge tone="blue">Total estimé : {formatEur(estimatedTotal)}</Badge>
              </div>
            </div>

            {/* Mappage des colonnes */}
            <div>
              <h4 className="text-xs font-semibold text-[#f5f5f5] mb-2.5">
                Correspondance des colonnes {mode === "HOLDINGS" ? "(Positions)" : "(Transactions)"}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {mode === "HOLDINGS" ? (
                  <>
                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Nom du support / Fonds *
                      </label>
                      <Select
                        value={mapping.name || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, name: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Nombre de parts *
                      </label>
                      <Select
                        value={mapping.quantity || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, quantity: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Cours / Valeur liquidative (VL) *
                      </label>
                      <Select
                        value={mapping.price || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, price: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Code ISIN ou Ticker
                      </label>
                      <Select
                        value={mapping.isin || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, isin: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Montant / Valorisation
                      </label>
                      <Select
                        value={mapping.amount || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, amount: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Montant investi / PRU
                      </label>
                      <Select
                        value={mapping.costBasis || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, costBasis: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Date de l'opération *
                      </label>
                      <Select
                        value={mapping.date || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, date: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Libellé / Description *
                      </label>
                      <Select
                        value={mapping.label || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, label: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Montant (ou colonne commune)
                      </label>
                      <Select
                        value={mapping.amount || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, amount: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Débit (si séparé)
                      </label>
                      <Select
                        value={mapping.debit || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, debit: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Crédit (si séparé)
                      </label>
                      <Select
                        value={mapping.credit || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, credit: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#8a8a8a] mb-1">
                        Catégorie
                      </label>
                      <Select
                        value={mapping.category || ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, category: e.target.value }))}
                      >
                        <option value="">-- Ignorer --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Tableau d'aperçu dynamique */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-[#f5f5f5]">
                  Aperçu en direct (5 premières lignes)
                </h4>
                <span className="text-[11px] text-[#8a8a8a]">
                  {mappedItems.length} ligne{mappedItems.length > 1 ? "s" : ""} prête
                  {mappedItems.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0d0d0d]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[rgba(255,255,255,0.08)] bg-[#161616] text-[#8a8a8a]">
                    {mode === "HOLDINGS" ? (
                      <tr>
                        <th className="px-3 py-2">Fonds / Titre</th>
                        <th className="px-3 py-2">ISIN / Ticker</th>
                        <th className="px-3 py-2 text-right">Parts</th>
                        <th className="px-3 py-2 text-right">Cours (VL)</th>
                        <th className="px-3 py-2 text-right">Valorisation</th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Libellé</th>
                        <th className="px-3 py-2 text-right">Montant</th>
                        <th className="px-3 py-2">Catégorie</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-[rgba(255,255,255,0.04)] text-[#f5f5f5]">
                    {mappedItems.slice(0, 5).map((item, idx) => {
                      if (mode === "HOLDINGS") {
                        const h = item as HoldingImportItem;
                        return (
                          <tr key={idx} className="hover:bg-white/[0.02]">
                            <td className="px-3 py-2 font-medium">{h.name}</td>
                            <td className="px-3 py-2 text-[#8a8a8a]">{h.isin || "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {h.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 4 })}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatEur(h.price)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-[#d4b56e] tabular-nums">
                              {formatEur(h.value || h.quantity * h.price)}
                            </td>
                          </tr>
                        );
                      }
                      const t = item as TransactionImportItem;
                      return (
                        <tr key={idx} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2 tabular-nums text-[#8a8a8a]">{t.date}</td>
                          <td className="px-3 py-2 font-medium">{t.label}</td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right font-semibold tabular-nums",
                              t.amount < 0 ? "text-[#ef4444]" : "text-[#10b981]",
                            )}
                          >
                            {formatEur(t.amount, { signed: true })}
                          </td>
                          <td className="px-3 py-2 text-[#8a8a8a]">{t.category || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ÉTAPE 3 : SUCCÈS */}
        {step === 3 && importResult && (
          <div className="py-6 text-center space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#10b981]/15 text-[#10b981] mx-auto">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#f5f5f5]">
                Importation réussie !
              </h3>
              <p className="mt-1 text-xs text-[#8a8a8a]">
                Le compte <strong className="text-[#f5f5f5]">{importResult.accountName}</strong> a été
                alimenté avec succès.
              </p>
            </div>
            <Card className="max-w-md mx-auto p-4 bg-[#161616] text-left space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#8a8a8a]">Lignes importées</span>
                <span className="font-semibold text-[#f5f5f5]">
                  {importResult.importedCount} {mode === "HOLDINGS" ? "positions" : "transactions"}
                </span>
              </div>
              <div className="flex justify-between text-xs border-t border-[rgba(255,255,255,0.06)] pt-2">
                <span className="text-[#8a8a8a]">Solde / Valorisation totale</span>
                <span className="font-semibold text-[#d4b56e] tabular-nums">
                  {formatEur(importResult.totalValue)}
                </span>
              </div>
            </Card>
          </div>
        )}
      </div>
    </Modal>
  );
};
