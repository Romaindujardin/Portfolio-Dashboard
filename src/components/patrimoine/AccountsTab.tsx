import React, { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
  FileSpreadsheet,
  Landmark,
  Layers,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Wallet2,
  X,
  Zap,
} from "lucide-react";
import { CsvImportModal } from "./CsvImportModal";
import type {
  Holding,
  Ownership,
  PortfolioAccount,
  PortfolioAccountType,
  Transaction,
} from "../../types/portfolio";
import type {
  TricountExpense,
  TricountIncome,
  TricountPayer,
  TricountBeneficiary,
  TricountSplitMethod,
} from "../../types";
import {
  createAccount,
  createHolding,
  deleteAccount,
  deleteHolding,
  getHoldings,
  getTransactions,
  refreshPrices,
  setOwnership,
  syncAccount,
  updateAccount,
} from "../../services/portfolioApi";
import {
  addOrUpdateExpense,
  addOrUpdateIncome,
  deleteExpense,
  deleteIncome,
  getStoredExpenses,
  getStoredIncomes,
} from "../../utils/tricountStorage";
import { getSavingsStrategy } from "../../utils/savingsStorage";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  INVESTMENT_ACCOUNT_TYPES,
  Input,
  Modal,
  Select,
  SectionHeader,
  StatRow,
  accountTypeLabel,
  cn,
  formatDate,
  formatEur,
} from "./shared";

type Notify = (kind: "success" | "error", message: string) => void;

interface AccountsTabProps {
  userId: string;
  accounts: PortfolioAccount[];
  holdings?: Holding[];
  onReload: () => Promise<void>;
  notify: Notify;
}

const ACCOUNT_TYPES: PortfolioAccountType[] = [
  "CHECKING",
  "SAVINGS",
  "PEA",
  "SECURITIES",
  "CRYPTO",
  "EMPLOYEE_SAVINGS",
  "OTHER",
];

const defaultAccountForm = {
  name: "",
  type: "CHECKING" as PortfolioAccountType,
  balance: "",
  cash_balance: "",
  currency: "EUR",
};

const AccountsTab: React.FC<AccountsTabProps> = ({
  userId,
  accounts,
  holdings = [],
  onReload,
  notify,
}) => {
  const holdingsByAccountId = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const h of holdings) {
      if (!map.has(h.accountId)) map.set(h.accountId, []);
      map.get(h.accountId)!.push(h);
    }
    return map;
  }, [holdings]);

  const [filter, setFilter] = useState<"all" | "manual" | "connected">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(defaultAccountForm);
  const [editing, setEditing] = useState<PortfolioAccount | null>(null);
  const [editForm, setEditForm] = useState({ name: "", type: "OTHER", balance: "", cash_balance: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ownershipAccount, setOwnershipAccount] = useState<PortfolioAccount | null>(null);
  const [holdingsAccount, setHoldingsAccount] = useState<PortfolioAccount | null>(null);
  const [txAccount, setTxAccount] = useState<PortfolioAccount | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txSearch, setTxSearch] = useState("");
  const [txLimit, setTxLimit] = useState(500);
  const [hasMoreTx, setHasMoreTx] = useState(false);
  const [txLoadingMore, setTxLoadingMore] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvTargetAccountId, setCsvTargetAccountId] = useState<string | null>(null);

  // ===== Intégration Tricount dans le modal de transactions =====
  const [tricountExpenses, setTricountExpenses] = useState<TricountExpense[]>([]);
  const [tricountIncomes, setTricountIncomes] = useState<TricountIncome[]>([]);
  const [selectedTxForTricount, setSelectedTxForTricount] = useState<Transaction | null>(null);
  const [matchedTricountItem, setMatchedTricountItem] = useState<TricountExpense | TricountIncome | null>(null);
  const [tricountModalOpen, setTricountModalOpen] = useState(false);
  const [tricountForm, setTricountForm] = useState({
    type: "expense" as "expense" | "income" | "placement",
    month: "",
    date: "",
    label: "",
    amount: "",
    payer: "person1" as TricountPayer,
    beneficiary: "person1" as TricountBeneficiary,
    splitMethod: "50_50" as TricountSplitMethod,
    pocketId: "unallocated",
    subPocketId: "",
  });
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  React.useEffect(() => {
    const loadTricount = () => {
      setTricountExpenses(getStoredExpenses());
      setTricountIncomes(getStoredIncomes());
    };
    loadTricount();
    window.addEventListener("tricount_data_updated", loadTricount);
    window.addEventListener("storage", loadTricount);
    return () => {
      window.removeEventListener("tricount_data_updated", loadTricount);
      window.removeEventListener("storage", loadTricount);
    };
  }, []);

  const findTricountItem = (t: Transaction): TricountExpense | TricountIncome | null => {
    const expense = tricountExpenses.find(
      (e) =>
        e.bankRowId === t.id ||
        (t.externalId && e.bankReference === t.externalId) ||
        (t.dedupKey && e.bankReference === t.dedupKey),
    );
    if (expense) return expense;

    const income = tricountIncomes.find(
      (i) =>
        i.bankRowId === t.id ||
        (t.externalId && i.bankReference === t.externalId) ||
        (t.dedupKey && i.bankReference === t.dedupKey),
    );
    return income || null;
  };

  const openTricountForTx = (t: Transaction) => {
    const matched = findTricountItem(t);
    setSelectedTxForTricount(t);
    setMatchedTricountItem(matched);

    const isIncome = t.amount > 0;
    const defaultMonth = (t.date || "").slice(0, 7) || new Date().toISOString().slice(0, 7);

    if (matched) {
      const isExp = "payerPersonId" in matched;
      setTricountForm({
        type: isExp ? (matched.nature === "placement" ? "placement" : "expense") : "income",
        month: matched.month || defaultMonth,
        date: matched.date || t.date,
        label: matched.label || t.label || "",
        amount: String(matched.amount || Math.abs(t.amount)),
        payer: isExp ? matched.payerPersonId : "person1",
        beneficiary: !isExp ? matched.beneficiaryPersonId : "person1",
        splitMethod: isExp ? matched.splitMethod : "50_50",
        pocketId: isExp ? matched.pocketId || "unallocated" : "unallocated",
        subPocketId: isExp ? matched.subPocketId || "" : "",
      });
    } else {
      setTricountForm({
        type: isIncome ? "income" : "expense",
        month: defaultMonth,
        date: t.date,
        label: t.label || "",
        amount: String(Math.abs(t.amount)),
        payer: "person1",
        beneficiary: "person1",
        splitMethod: "50_50",
        pocketId: "unallocated",
        subPocketId: "",
      });
    }
    setTricountModalOpen(true);
  };

  const handleSaveTricount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTxForTricount) return;
    const t = selectedTxForTricount;
    const amt = Number(tricountForm.amount);
    if (!amt || amt <= 0) {
      notify("error", "Veuillez saisir un montant valide.");
      return;
    }

    const m = tricountForm.month.trim() || t.date.slice(0, 7);
    const strategy = getSavingsStrategy(userId);
    const pocket = strategy.pockets.find((p) => p.id === tricountForm.pocketId);
    const subItem = pocket?.subItems?.find((s) => s.id === tricountForm.subPocketId);

    if (tricountForm.type === "income") {
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
        date: tricountForm.date || t.date,
        label: tricountForm.label.trim() || t.label || "Revenu",
        amount: Math.round(amt * 100) / 100,
        beneficiaryPersonId: tricountForm.beneficiary,
        source: "bank_import",
        bankAccount: txAccount?.name || undefined,
        bankReference: t.externalId || t.dedupKey || undefined,
        bankRowId: t.id,
        createdAt: matchedTricountItem?.createdAt || Date.now(),
      };

      addOrUpdateIncome(income);
      notify("success", `Revenu de ${formatEur(amt)} enregistré dans le Budget (${m}) !`);
    } else {
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
        date: tricountForm.date || t.date,
        label: tricountForm.label.trim() || t.label || "Dépense",
        amount: Math.round(amt * 100) / 100,
        payerPersonId: tricountForm.payer,
        pocketId: tricountForm.pocketId,
        pocketName: pocket?.name,
        subPocketId: tricountForm.subPocketId || undefined,
        subPocketName: subItem?.name,
        splitMethod: tricountForm.splitMethod,
        nature: tricountForm.type === "placement" ? "placement" : "expense",
        source: "bank_import",
        bankAccount: txAccount?.name || undefined,
        bankReference: t.externalId || t.dedupKey || undefined,
        bankRowId: t.id,
        createdAt: matchedTricountItem?.createdAt || Date.now(),
      };

      addOrUpdateExpense(expense);
      notify(
        "success",
        `${tricountForm.type === "placement" ? "Placement" : "Dépense"} de ${formatEur(amt)} ajouté(e) au Tricount (${m}) !`,
      );
    }

    setTricountExpenses(getStoredExpenses());
    setTricountIncomes(getStoredIncomes());
    setTricountModalOpen(false);
  };

  const handleDeleteTricountItem = () => {
    if (!matchedTricountItem) return;
    if ("payerPersonId" in matchedTricountItem) {
      deleteExpense(matchedTricountItem.id);
    } else {
      deleteIncome(matchedTricountItem.id);
    }
    setTricountExpenses(getStoredExpenses());
    setTricountIncomes(getStoredIncomes());
    setTricountModalOpen(false);
    notify("success", "Opération retirée du Tricount.");
  };

  const handleSyncAccount = async (account: PortfolioAccount) => {
    setSyncingAccountId(account.id);
    try {
      await syncAccount(account.id, userId);
      await onReload();
      notify("success", `Compte ${account.name} synchronisé avec succès.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Synchronisation impossible.");
    } finally {
      setSyncingAccountId(null);
    }
  };

  const openTransactions = async (account: PortfolioAccount) => {
    setTxAccount(account);
    setTxLoading(true);
    setTxSearch("");
    setTxLimit(500);
    try {
      const data = await getTransactions(account.id, userId, { limit: 500 });
      const list = data || [];
      setTransactions(list);
      setHasMoreTx(list.length >= 500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Impossible de charger les transactions";
      notify("error", message);
      setTransactions([]);
      setHasMoreTx(false);
    } finally {
      setTxLoading(false);
    }
  };

  const loadMoreTransactions = async () => {
    if (!txAccount || txLoadingMore) return;
    setTxLoadingMore(true);
    try {
      const nextLimit = txLimit + 500;
      const data = await getTransactions(txAccount.id, userId, { limit: nextLimit });
      const list = data || [];
      setTransactions(list);
      setTxLimit(nextLimit);
      setHasMoreTx(list.length >= nextLimit);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Impossible de charger plus de transactions";
      notify("error", message);
    } finally {
      setTxLoadingMore(false);
    }
  };

  const exportTransactionsCsv = () => {
    if (!txAccount || transactions.length === 0) return;
    const header = "Date;Libellé;Montant;Devise;Catégorie\n";
    const rows = transactions
      .map(
        (t) =>
          `"${t.date}";"${(t.label || "").replace(/"/g, '""')}";"${t.amount}";"${t.currency || "EUR"}";"${(t.category || "").replace(/"/g, '""')}"`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${(txAccount.name || "compte").replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleAccounts = useMemo(() => {
    return accounts.filter((account) => {
      if (filter === "manual") return account.isManual || !account.connectionId;
      if (filter === "connected") return Boolean(account.connectionId);
      return true;
    });
  }, [accounts, filter]);

  const total = useMemo(
    () =>
      visibleAccounts.reduce(
        (sum, account) => sum + (account.type === "LOAN" ? -Math.abs(account.balance) : account.balance),
        0,
      ),
    [visibleAccounts],
  );

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setError("Le nom du compte est requis.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const isInvestment = INVESTMENT_ACCOUNT_TYPES.has(form.type);
      await createAccount(userId, {
        name: form.name.trim(),
        type: form.type,
        balance: Number(form.balance.replace(",", ".")) || 0,
        cash_balance:
          isInvestment && form.cash_balance !== ""
            ? Number(form.cash_balance.replace(",", ".")) || 0
            : undefined,
        currency: form.currency,
      });
      setCreateOpen(false);
      setForm(defaultAccountForm);
      await onReload();
      notify("success", "Compte ajouté.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (account: PortfolioAccount) => {
    setEditing(account);
    setEditForm({
      name: account.name,
      type: account.type,
      balance: String(account.balance ?? ""),
      cash_balance: account.cashBalance == null ? "" : String(account.cashBalance),
    });
  };

  const handleEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await updateAccount(editing.id, userId, {
        name: editForm.name.trim(),
        type: editForm.type as PortfolioAccountType,
        balance: Number(editForm.balance.replace(",", ".")) || 0,
        cash_balance:
          editForm.cash_balance === ""
            ? null
            : Number(editForm.cash_balance.replace(",", ".")) || 0,
      });
      setEditing(null);
      await onReload();
      notify("success", "Compte mis à jour.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour impossible.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (account: PortfolioAccount) => {
    if (
      !window.confirm(
        `Supprimer le compte « ${account.name} » ? Les transactions et snapshots associés seront supprimés.`,
      )
    ) {
      return;
    }
    try {
      await deleteAccount(account.id, userId);
      await onReload();
      notify("success", "Compte supprimé.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Comptes normalisés"
        subtitle="Comptes bancaires connectés et comptes manuels. Le solde est la valeur utilisée dans la synthèse."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[rgba(255,255,255,0.08)] p-0.5">
              {(
                [
                  ["all", "Tous"],
                  ["connected", "Connectés"],
                  ["manual", "Manuels"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] transition-colors",
                    filter === key
                      ? "bg-[rgba(200,165,94,0.15)] text-[#d4b56e]"
                      : "text-[#8a8a8a] hover:text-[#f5f5f5]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setCsvTargetAccountId(null);
                  setCsvImportOpen(true);
                }}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Importer CSV
              </Button>
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Compte
              </Button>
            </div>
          </div>
        }
      />

      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[#8a8a8a]">
            {visibleAccounts.length} compte{visibleAccounts.length > 1 ? "s" : ""} affiché
            {visibleAccounts.length > 1 ? "s" : ""}
          </span>
          <span className="text-sm font-semibold tabular-nums text-[#f5f5f5]">
            {formatEur(total)}
          </span>
        </div>
      </Card>

      {visibleAccounts.length === 0 ? (
        <EmptyState
          icon={<Wallet2 className="h-7 w-7" />}
          title="Aucun compte"
          description="Ajoutez un compte manuel (Livret A, PEA, compte courant…) ou connectez une banque dans l'onglet Connexions."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Ajouter un compte
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleAccounts.map((account) => {
            const isOpen = expanded === account.id;
            const isLoan = account.type === "LOAN";
            const isRealEstate = account.type === "REAL_ESTATE";
            const isManaged = isLoan || isRealEstate;
            const accountHoldings = holdingsByAccountId.get(account.id) || [];
            const hasHoldings = accountHoldings.length > 0;
            const isInvestment = INVESTMENT_ACCOUNT_TYPES.has(account.type) || hasHoldings;
            const isBankChecking = account.type === "CHECKING";
            return (
              <Card key={account.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg overflow-hidden border border-white/5"
                    style={{
                      backgroundColor: account.logo ? "#ffffff" : `${account.color || "#c8a55e"}15`,
                      color: account.color || "#c8a55e",
                    }}
                  >
                    {account.logo ? (
                      <img
                        src={account.logo}
                        alt=""
                        className="h-6 w-6 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          const fallback = e.currentTarget.parentElement?.querySelector(".fallback-icon");
                          if (fallback) fallback.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <div className={cn("flex items-center justify-center", account.logo && "fallback-icon hidden")}>
                      {isRealEstate ? (
                        <Building2 className="h-4 w-4" />
                      ) : isLoan ? (
                        <CreditCard className="h-4 w-4" />
                      ) : account.type === "CHECKING" ? (
                        <Landmark className="h-4 w-4" />
                      ) : (
                        <Wallet2 className="h-4 w-4" />
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-[#f5f5f5]">
                        {account.name}
                      </span>
                      {account.provider === "bourso-sidecar" && (
                        <Badge tone="gold">
                          <Zap className="h-2.5 w-2.5 mr-0.5" /> Sidecar BoursoBank
                        </Badge>
                      )}
                      <Badge tone={account.isManual || !account.connectionId ? "gray" : "gold"}>
                        {account.isManual
                          ? "Manuel"
                          : account.connectionId
                            ? "Connecté"
                            : "Déconnecté"}
                      </Badge>
                      {account.isArchived && <Badge tone="red">Archivé</Badge>}
                      {isRealEstate && <Badge tone="blue">Immobilier</Badge>}
                      {isLoan && <Badge tone="red">Dette</Badge>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#6a6a6a]">
                      {accountTypeLabel[account.type] || account.type}
                      {account.iban ? ` · ${account.iban.slice(0, 4)}…${account.iban.slice(-4)}` : ""}
                      {account.lastSyncAt ? ` · synchronisé le ${formatDate(account.lastSyncAt)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        isLoan ? "text-[#f87171]" : "text-[#f5f5f5]",
                      )}
                    >
                      {formatEur(account.balance)}
                    </p>
                    {account.cashBalance != null && (
                      <p className="text-[10px] text-[#6a6a6a]">
                        dont liquidités {formatEur(account.cashBalance)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(isOpen ? null : account.id)}>
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] px-4 py-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#6a6a6a]">
                          Détails
                        </p>
                        <StatRow label="Fournisseur" value={account.provider} />
                        <StatRow label="Type" value={accountTypeLabel[account.type] || account.type} />
                        <StatRow label="Devise" value={account.currency} />
                        <StatRow label="Solde total" value={formatEur(account.balance)} emphasis />
                        {account.availableBalance != null && (
                          <StatRow label="Solde disponible" value={formatEur(account.availableBalance)} />
                        )}
                        {account.ownerships && account.ownerships.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {account.ownerships.map((share) => (
                              <Badge key={share.id} tone="blue">
                                {share.ownerName} {share.sharePercent} %
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap content-start gap-2">
                        {/* 1. Bouton Positions : pour comptes d'investissement (PEA, CTO, PEE, Crypto) ou tout compte détenant des positions (ex: Assurance-vie Gresham) */}
                        {isInvestment && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => setHoldingsAccount(account)}
                            title="Consulter et gérer les positions du compte"
                          >
                            <Layers className="h-3.5 w-3.5" /> Positions {hasHoldings ? `(${accountHoldings.length})` : ""}
                          </Button>
                        )}

                        {/* 2. Bouton Transactions : pour les comptes courants/bancaires */}
                        {isBankChecking && (
                          <Button size="sm" onClick={() => openTransactions(account)}>
                            <Receipt className="h-3.5 w-3.5" /> Transactions
                          </Button>
                        )}

                        {(account.connectionId || account.provider === "bourso-sidecar") && !isManaged && (
                          <Button
                            size="sm"
                            onClick={() => handleSyncAccount(account)}
                            loading={syncingAccountId === account.id}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Actualiser
                          </Button>
                        )}
                        {!isManaged && (
                          <Button size="sm" onClick={() => startEdit(account)}>
                            <Pencil className="h-3.5 w-3.5" /> Modifier
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setOwnershipAccount(account)}>
                          <Users className="h-3.5 w-3.5" /> Parts
                        </Button>
                        {!isManaged && (
                          <Button size="sm" variant="danger" onClick={() => handleDelete(account)}>
                            <Trash2 className="h-3.5 w-3.5" /> Supprimer
                          </Button>
                        )}
                        {isRealEstate && (
                          <p className="w-full text-[11px] text-[#6a6a6a]">
                            Valeur, modification et suppression gérées depuis l'onglet Immobilier.
                          </p>
                        )}
                        {isLoan && (
                          <p className="w-full text-[11px] text-[#6a6a6a]">
                            Dette, modification et suppression gérées depuis l'onglet Prêts.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Création */}
      <Modal
        open={createOpen}
        title="Ajouter un compte manuel"
        onClose={() => {
          setCreateOpen(false);
          setError("");
        }}
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={handleCreate} loading={busy}>
              Ajouter
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} onClose={() => setError("")} />}
          <Field label="Nom" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Livret A, PEA, compte courant…"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" required>
              <Select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as PortfolioAccountType })
                }
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {accountTypeLabel[type]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Devise">
              <Select
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value })}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
              </Select>
            </Field>
          </div>
          <Field
            label="Solde total"
            hint="Pour un compte d'investissement, saisissez la valeur totale actuelle. Tant qu'aucune position n'est ajoutée, ce montant est utilisé tel quel ; ensuite, précisez les liquidités ci-dessous."
          >
            <Input
              inputMode="decimal"
              value={form.balance}
              onChange={(event) => setForm({ ...form, balance: event.target.value })}
              placeholder="0,00"
            />
          </Field>
          {INVESTMENT_ACCOUNT_TYPES.has(form.type) && (
            <Field
              label="Dont liquidités"
              hint="Optionnel. Sert à recalculer la valeur quand les cours des positions sont rafraîchis."
            >
              <Input
                inputMode="decimal"
                value={form.cash_balance}
                onChange={(event) => setForm({ ...form, cash_balance: event.target.value })}
                placeholder="0,00"
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* Édition */}
      <Modal
        open={Boolean(editing)}
        title="Modifier le compte"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Annuler</Button>
            <Button variant="primary" onClick={handleEdit} loading={busy}>
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} onClose={() => setError("")} />}
          <Field label="Nom" required>
            <Input
              value={editForm.name}
              onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={editForm.type}
                onChange={(event) => setEditForm({ ...editForm, type: event.target.value })}
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {accountTypeLabel[type] || type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Solde total">
              <Input
                inputMode="decimal"
                value={editForm.balance}
                onChange={(event) => setEditForm({ ...editForm, balance: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Dont liquidités" hint="Laisser vide si non applicable.">
            <Input
              inputMode="decimal"
              value={editForm.cash_balance}
              onChange={(event) => setEditForm({ ...editForm, cash_balance: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <OwnershipModal
        userId={userId}
        account={
          ownershipAccount
            ? accounts.find((item) => item.id === ownershipAccount.id) ?? null
            : null
        }
        onClose={() => setOwnershipAccount(null)}
        onSaved={async () => {
          setOwnershipAccount(null);
          await onReload();
          notify("success", "Parts enregistrées.");
        }}
        notify={notify}
      />

      <HoldingsModal
        userId={userId}
        account={
          holdingsAccount
            ? accounts.find((item) => item.id === holdingsAccount.id) ?? null
            : null
        }
        onClose={() => setHoldingsAccount(null)}
        onChanged={onReload}
        notify={notify}
        onOpenCsvImport={(accountId) => {
          setCsvTargetAccountId(accountId);
          setCsvImportOpen(true);
        }}
      />

      {/* Modal Transactions */}
      <Modal
        open={Boolean(txAccount)}
        title={
          txAccount ? (
            <div className="flex items-center gap-2.5">
              {txAccount.logo && (
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white p-0.5 overflow-hidden border border-white/10 flex-shrink-0">
                  <img src={txAccount.logo} alt="" className="h-5 w-5 object-contain" />
                </div>
              )}
              <span>Transactions — {txAccount.name}</span>
            </div>
          ) : (
            "Transactions"
          )
        }
        onClose={() => setTxAccount(null)}
        footer={
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-[#8a8a8a]">
              {transactions.length} transaction(s) affichée(s)
              {hasMoreTx && !txSearch && " · d'autres transactions disponibles"}
            </span>
            <div className="flex items-center gap-2">
              {transactions.length > 0 && (
                <Button size="sm" onClick={exportTransactionsCsv}>
                  <Download className="h-3.5 w-3.5" /> Exporter CSV
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setTxAccount(null)}>
                Fermer
              </Button>
            </div>
          </div>
        }
      >
        {txLoading ? (
          <div className="py-12 text-center text-sm text-[#8a8a8a]">
            Chargement des transactions...
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            title="Aucune transaction"
            description="Aucune transaction n'a été trouvée pour ce compte."
          />
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#555555]" />
              <input
                type="text"
                placeholder="Rechercher par libellé ou montant..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-[#141414] text-xs text-[#f5f5f5] rounded-lg border border-[rgba(255,255,255,0.06)] focus:border-[#c8a55e]/50 focus:outline-none"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-[rgba(255,255,255,0.04)] pr-1">
              {transactions
                .filter(
                  (t) =>
                    !txSearch ||
                    (t.label || "").toLowerCase().includes(txSearch.toLowerCase()) ||
                    String(t.amount).includes(txSearch) ||
                    (t.category || "").toLowerCase().includes(txSearch.toLowerCase()),
                )
                .map((t) => {
                  const matched = findTricountItem(t);
                  return (
                    <div key={t.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="truncate font-medium text-[#f5f5f5]">{t.label}</p>
                          {matched && (
                            <span
                              onClick={() => openTricountForTx(t)}
                              className="inline-flex cursor-pointer items-center gap-1 rounded bg-[#10b981]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#34d399] border border-[#10b981]/25 hover:bg-[#10b981]/25 transition-colors"
                              title="Déjà ajouté au Tricount & Budget (cliquer pour modifier)"
                            >
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              {"payerPersonId" in matched
                                ? matched.nature === "placement"
                                  ? "Placement Tricount"
                                  : "Dépense Tricount"
                                : "Revenu Tricount"}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-[#6a6a6a]">
                          {formatDate(t.date)} {t.category ? `· ${t.category}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={cn(
                            "font-semibold tabular-nums text-right",
                            t.amount >= 0 ? "text-[#10b981]" : "text-[#f5f5f5]",
                          )}
                        >
                          {formatEur(t.amount, { signed: true })}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={cn(
                            "h-7 px-2 text-[11px] border transition-colors",
                            matched
                              ? "border-[rgba(255,255,255,0.1)] text-[#a0a0a0] hover:text-[#f5f5f5]"
                              : "border-[rgba(200,165,94,0.3)] text-[#c8a55e] hover:bg-[rgba(200,165,94,0.1)]",
                          )}
                          onClick={() => openTricountForTx(t)}
                          title={matched ? "Modifier dans le Tricount" : "Ajouter au Tricount & Budget"}
                        >
                          {matched ? (
                            <Pencil className="h-3 w-3" />
                          ) : (
                            <>
                              <Plus className="h-3 w-3 mr-1" />
                              Tricount
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
            {hasMoreTx && !txSearch && (
              <div className="pt-2 text-center border-t border-[rgba(255,255,255,0.06)]">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={loadMoreTransactions}
                  loading={txLoadingMore}
                  className="border border-[rgba(200,165,94,0.3)] text-[#c8a55e] hover:bg-[rgba(200,165,94,0.1)] text-xs"
                >
                  <ChevronDown className="h-3.5 w-3.5 mr-1" />
                  Afficher plus (+500 transactions)
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal Ajout / Modification Tricount */}
      <Modal
        open={tricountModalOpen}
        title={matchedTricountItem ? "Modifier dans le Budget & Tricount" : "Ajouter au Budget & Tricount"}
        onClose={() => setTricountModalOpen(false)}
        footer={
          <div className="flex w-full items-center justify-between">
            {matchedTricountItem ? (
              <Button size="sm" variant="danger" onClick={handleDeleteTricountItem}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Retirer du Tricount
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setTricountModalOpen(false)}>
                Annuler
              </Button>
              <Button size="sm" variant="primary" onClick={handleSaveTricount}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                {matchedTricountItem ? "Mettre à jour" : "Enregistrer dans le Budget"}
              </Button>
            </div>
          </div>
        }
      >
        <form onSubmit={handleSaveTricount} className="space-y-3">
          <div className="flex items-center gap-1 rounded-lg bg-[#141414] p-1 border border-[rgba(255,255,255,0.06)]">
            <button
              type="button"
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                tricountForm.type === "expense"
                  ? "bg-[#c8a55e] text-[#0a0a0a]"
                  : "text-[#a0a0a0] hover:text-[#f5f5f5]",
              )}
              onClick={() => setTricountForm({ ...tricountForm, type: "expense" })}
            >
              Dépense
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                tricountForm.type === "placement"
                  ? "bg-[#c8a55e] text-[#0a0a0a]"
                  : "text-[#a0a0a0] hover:text-[#f5f5f5]",
              )}
              onClick={() => setTricountForm({ ...tricountForm, type: "placement" })}
            >
              Placement / Épargne
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                tricountForm.type === "income"
                  ? "bg-[#c8a55e] text-[#0a0a0a]"
                  : "text-[#a0a0a0] hover:text-[#f5f5f5]",
              )}
              onClick={() => setTricountForm({ ...tricountForm, type: "income" })}
            >
              Revenu
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Mois budgétaire (YYYY-MM)" required>
              <Input
                value={tricountForm.month}
                onChange={(e) => setTricountForm({ ...tricountForm, month: e.target.value })}
                placeholder="2026-10"
              />
            </Field>
            <Field label="Date de l'opération" required>
              <Input
                type="date"
                value={tricountForm.date}
                onChange={(e) => setTricountForm({ ...tricountForm, date: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Libellé" required>
            <Input
              value={tricountForm.label}
              onChange={(e) => setTricountForm({ ...tricountForm, label: e.target.value })}
            />
          </Field>

          <Field label="Montant (€)" required>
            <Input
              type="number"
              step="0.01"
              value={tricountForm.amount}
              onChange={(e) => setTricountForm({ ...tricountForm, amount: e.target.value })}
            />
          </Field>

          {tricountForm.type === "income" ? (
            <Field label="Bénéficiaire du revenu" required>
              <select
                value={tricountForm.beneficiary}
                onChange={(e) =>
                  setTricountForm({
                    ...tricountForm,
                    beneficiary: e.target.value as TricountBeneficiary,
                  })
                }
                className="w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-2.5 py-2 text-xs text-[#f5f5f5] outline-none focus:border-[#c8a55e]"
              >
                <option value="person1">Romain</option>
                <option value="person2">Sophie</option>
                <option value="shared">Commun</option>
              </select>
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Payeur de la dépense" required>
                  <select
                    value={tricountForm.payer}
                    onChange={(e) =>
                      setTricountForm({
                        ...tricountForm,
                        payer: e.target.value as TricountPayer,
                      })
                    }
                    className="w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-2.5 py-2 text-xs text-[#f5f5f5] outline-none focus:border-[#c8a55e]"
                  >
                    <option value="person1">Romain</option>
                    <option value="person2">Sophie</option>
                  </select>
                </Field>

                <Field label="Répartition" required>
                  <select
                    value={tricountForm.splitMethod}
                    onChange={(e) =>
                      setTricountForm({
                        ...tricountForm,
                        splitMethod: e.target.value as TricountSplitMethod,
                      })
                    }
                    className="w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-2.5 py-2 text-xs text-[#f5f5f5] outline-none focus:border-[#c8a55e]"
                  >
                    <option value="50_50">50 / 50 (Équitable)</option>
                    <option value="proportional">Au prorata des revenus</option>
                    <option value="100_person1">100% Romain (Perso)</option>
                    <option value="100_person2">100% Sophie (Perso)</option>
                  </select>
                </Field>
              </div>

              <Field label="Poche de budget associée">
                <select
                  value={tricountForm.pocketId}
                  onChange={(e) =>
                    setTricountForm({
                      ...tricountForm,
                      pocketId: e.target.value,
                      subPocketId: "",
                    })
                  }
                  className="w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-2.5 py-2 text-xs text-[#f5f5f5] outline-none focus:border-[#c8a55e]"
                >
                  <option value="unallocated">Non alloué / Autre</option>
                  {getSavingsStrategy(userId).pockets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>

              {(() => {
                const selectedPocket = getSavingsStrategy(userId).pockets.find(
                  (p) => p.id === tricountForm.pocketId,
                );
                if (selectedPocket?.subItems && selectedPocket.subItems.length > 0) {
                  return (
                    <Field label="Sous-poste / Sous-poche">
                      <select
                        value={tricountForm.subPocketId}
                        onChange={(e) =>
                          setTricountForm({ ...tricountForm, subPocketId: e.target.value })
                        }
                        className="w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-2.5 py-2 text-xs text-[#f5f5f5] outline-none focus:border-[#c8a55e]"
                      >
                        <option value="">Aucun sous-poste</option>
                        {selectedPocket.subItems.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                }
                return null;
              })()}
            </>
          )}
        </form>
      </Modal>

      <CsvImportModal
        open={csvImportOpen}
        onClose={() => {
          setCsvImportOpen(false);
          setCsvTargetAccountId(null);
        }}
        userId={userId}
        accounts={accounts}
        preselectedAccountId={csvTargetAccountId}
        onSuccess={async () => {
          await onReload();
          notify("success", "Importation CSV effectuée avec succès.");
        }}
      />
    </div>
  );
};

// ─── Parts ──────────────────────────────────────────────────────────────────

const OwnershipModal: React.FC<{
  userId: string;
  account: PortfolioAccount | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: Notify;
}> = ({ userId, account, onClose, onSaved, notify }) => {
  const [shares, setShares] = useState<Array<{ ownerName: string; sharePercent: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (!account) return;
    setShares(
      (account.ownerships || []).map((ownership: Ownership) => ({
        ownerName: ownership.ownerName,
        sharePercent: String(ownership.sharePercent),
      })),
    );
    setError("");
  }, [account]);

  if (!account) return null;
  const total = shares.reduce((sum, share) => sum + (Number(share.sharePercent) || 0), 0);

  return (
    <Modal
      open
      title={`Parts — ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await setOwnership(
                  account.id,
                  userId,
                  shares
                    .filter((share) => share.ownerName.trim())
                    .map((share) => ({
                      ownerName: share.ownerName.trim(),
                      sharePercent: Number(share.sharePercent) || 0,
                    })),
                );
                await onSaved();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Enregistrement impossible.");
                notify("error", err instanceof Error ? err.message : "Enregistrement impossible.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBanner message={error} onClose={() => setError("")} />}
        <p className="text-xs text-[#8a8a8a]">
          Répartissez la valeur du compte entre les propriétaires. La somme peut être inférieure à
          100 % : le reliquat reste attribué au propriétaire principal.
        </p>
        {shares.map((share, index) => (
          <div key={index} className="flex items-end gap-2">
            <Field label="Propriétaire" className="flex-1">
              <Input
                value={share.ownerName}
                onChange={(event) => {
                  const next = [...shares];
                  next[index] = { ...share, ownerName: event.target.value };
                  setShares(next);
                }}
                placeholder="Romain, Sophie…"
              />
            </Field>
            <Field label="Part (%)" className="w-28">
              <Input
                inputMode="decimal"
                value={share.sharePercent}
                onChange={(event) => {
                  const next = [...shares];
                  next[index] = { ...share, sharePercent: event.target.value };
                  setShares(next);
                }}
              />
            </Field>
            <Button
              variant="ghost"
              className="mb-0.5"
              onClick={() => setShares(shares.filter((_, i) => i !== index))}
              aria-label="Retirer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            onClick={() => setShares([...shares, { ownerName: "", sharePercent: "" }])}
          >
            <Plus className="h-3.5 w-3.5" /> Propriétaire
          </Button>
          <Badge tone={total > 100 ? "red" : total === 100 ? "green" : "gray"}>
            Total {Math.round(total * 100) / 100} %
          </Badge>
        </div>
      </div>
    </Modal>
  );
};

// ─── Positions ──────────────────────────────────────────────────────────────

const HoldingsModal: React.FC<{
  userId: string;
  account: PortfolioAccount | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  notify: Notify;
  onOpenCsvImport?: (accountId: string) => void;
}> = ({ userId, account, onClose, onChanged, notify, onOpenCsvImport }) => {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    isin: "",
    ticker: "",
    name: "",
    quantity: "",
    cost_basis: "",
    price: "",
    cash_balance: "",
  });

  const load = React.useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      setHoldings(await getHoldings(account.id, userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [account, userId]);

  React.useEffect(() => {
    if (account) {
      void load();
      setForm((prev) => ({
        ...prev,
        cash_balance: account.cashBalance == null ? "" : String(account.cashBalance),
      }));
    }
  }, [account, load]);

  if (!account) return null;

  const add = async () => {
    if (!form.isin.trim() && !form.ticker.trim()) {
      setError("Renseignez un ISIN ou un ticker.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createHolding(account.id, userId, {
        isin: form.isin.trim() || undefined,
        ticker: form.ticker.trim() || undefined,
        name: form.name.trim() || undefined,
        quantity: Number(form.quantity.replace(",", ".")) || 0,
        cost_basis: form.cost_basis ? Number(form.cost_basis.replace(",", ".")) : undefined,
        price: form.price ? Number(form.price.replace(",", ".")) : undefined,
        cash_balance: form.cash_balance === "" ? undefined : Number(form.cash_balance.replace(",", ".")) || 0,
      });
      setForm({ isin: "", ticker: "", name: "", quantity: "", cost_basis: "", price: "", cash_balance: form.cash_balance });
      await load();
      await onChanged();
      notify("success", "Position ajoutée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (holding: Holding) => {
    if (!window.confirm(`Supprimer la position ${holding.name || holding.ticker} ?`)) return;
    try {
      await deleteHolding(account.id, holding.id, userId);
      await load();
      await onChanged();
      notify("success", "Position supprimée.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await refreshPrices(userId, true, account.id);
      await load();
      await onChanged();
      notify(
        result.failed.length > 0 ? "error" : "success",
        `${result.updated} cours mis à jour${result.failed.length ? `, ${result.failed.length} échec(s)` : ""}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rafraîchissement impossible.");
    } finally {
      setBusy(false);
    }
  };

  const totalValue = holdings.reduce(
    (sum, holding) => sum + (holding.quantity || 0) * (holding.price || 0),
    0,
  );

  return (
    <Modal
      open
      wide
      title={
        <div className="flex items-center gap-2.5">
          {account.logo && (
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white p-0.5 overflow-hidden border border-white/10 flex-shrink-0">
              <img src={account.logo} alt="" className="h-5 w-5 object-contain" />
            </div>
          )}
          <span>Positions — {account.name}</span>
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Fermer</Button>
          <Button onClick={refresh} loading={busy}>
            <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir les cours
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} onClose={() => setError("")} />}
        {loading ? (
          <p className="py-4 text-center text-xs text-[#8a8a8a]">Chargement…</p>
        ) : holdings.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed border-[rgba(255,255,255,0.12)] p-4 text-center">
            <p className="text-sm font-medium text-[#f5f5f5]">
              Aucune position détaillée
            </p>
            <p className="text-xs text-[#8a8a8a] max-w-md mx-auto leading-relaxed">
              Le solde global du compte ({formatEur(account.balance)}) est bien pris en compte dans votre patrimoine. Les agrégateurs bancaires transmettent uniquement la valorisation globale des plans d'épargne ou comptes externes (PEE/PER Natixis, etc.), sans le détail des unités de compte ou fonds.
            </p>
            {onOpenCsvImport && (
              <div className="flex justify-center pt-1">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onClose();
                    onOpenCsvImport(account.id);
                  }}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Importer un relevé de positions CSV
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[#6a6a6a]">
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="py-2 pr-2 font-medium">Instrument</th>
                  <th className="py-2 pr-2 font-medium">Quantité</th>
                  <th className="py-2 pr-2 font-medium">Prix</th>
                  <th className="py-2 pr-2 font-medium">Valeur</th>
                  <th className="py-2 pr-2 font-medium">P&L</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {holdings.map((holding) => {
                  const value = (holding.quantity || 0) * (holding.price || 0);
                  const pnl =
                    holding.costBasis != null ? value - holding.costBasis : null;
                  return (
                    <tr key={holding.id} className="border-b border-[rgba(255,255,255,0.04)]">
                      <td className="py-2 pr-2">
                        <p className="text-[#e5e5e5]">{holding.name || holding.ticker}</p>
                        <p className="text-[10px] text-[#6a6a6a]">
                          {holding.ticker}
                          {holding.isin ? ` · ${holding.isin}` : ""}
                        </p>
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-[#d4d4d4]">{holding.quantity}</td>
                      <td className="py-2 pr-2 tabular-nums text-[#d4d4d4]">
                        {formatEur(holding.price)}
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-[#f5f5f5]">{formatEur(value)}</td>
                      <td
                        className={cn(
                          "py-2 pr-2 tabular-nums",
                          pnl == null ? "text-[#6a6a6a]" : pnl >= 0 ? "text-[#34d399]" : "text-[#f87171]",
                        )}
                      >
                        {pnl == null ? "—" : formatEur(pnl, { signed: true })}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => remove(holding)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-right text-xs text-[#8a8a8a]">
              Valeur des positions : <span className="font-medium text-[#f5f5f5]">{formatEur(totalValue)}</span>
            </p>
          </div>
        )}

        <div className="rounded-lg border border-[rgba(255,255,255,0.07)] p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#6a6a6a]">
            Ajouter une position
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="ISIN">
              <Input
                value={form.isin}
                onChange={(event) => setForm({ ...form, isin: event.target.value.toUpperCase() })}
                placeholder="FR0000121014"
              />
            </Field>
            <Field label="Ticker (si pas d'ISIN)">
              <Input
                value={form.ticker}
                onChange={(event) => setForm({ ...form, ticker: event.target.value.toUpperCase() })}
                placeholder="MC.PA"
              />
            </Field>
            <Field label="Nom (optionnel)">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="LVMH"
              />
            </Field>
            <Field label="Quantité" required>
              <Input
                inputMode="decimal"
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              />
            </Field>
            <Field label="Prix de revient (total)">
              <Input
                inputMode="decimal"
                value={form.cost_basis}
                onChange={(event) => setForm({ ...form, cost_basis: event.target.value })}
              />
            </Field>
            <Field label="Prix actuel (€)" hint="Laissez vide pour récupérer le cours automatiquement.">
              <Input
                inputMode="decimal"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
              />
            </Field>
            <Field label="Liquidités du compte" hint="Met à jour la part non investie.">
              <Input
                inputMode="decimal"
                value={form.cash_balance}
                onChange={(event) => setForm({ ...form, cash_balance: event.target.value })}
              />
            </Field>
          </div>
          <div className="mt-2 flex justify-end">
            <Button variant="primary" size="sm" onClick={add} loading={busy}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AccountsTab;
