import React, { useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Wallet2,
  X,
} from "lucide-react";
import type {
  Holding,
  Ownership,
  PortfolioAccount,
  PortfolioAccountType,
} from "../../types/portfolio";
import {
  createAccount,
  createHolding,
  deleteAccount,
  deleteHolding,
  getHoldings,
  refreshPrices,
  setOwnership,
  updateAccount,
} from "../../services/portfolioApi";
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
  onReload,
  notify,
}) => {
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
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Compte
            </Button>
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
            return (
              <Card key={account.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${account.color || "#c8a55e"}15`,
                      color: account.color || "#c8a55e",
                    }}
                  >
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
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-[#f5f5f5]">
                        {account.name}
                      </span>
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
                        {!isManaged && (
                          <Button size="sm" onClick={() => startEdit(account)}>
                            <Pencil className="h-3.5 w-3.5" /> Modifier
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setOwnershipAccount(account)}>
                          <Users className="h-3.5 w-3.5" /> Parts
                        </Button>
                        {!isManaged && INVESTMENT_ACCOUNT_TYPES.has(account.type) && (
                          <Button size="sm" onClick={() => setHoldingsAccount(account)}>
                            <RefreshCw className="h-3.5 w-3.5" /> Positions
                          </Button>
                        )}
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
}> = ({ userId, account, onClose, onChanged, notify }) => {
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
      const result = await refreshPrices(userId, true);
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
      title={`Positions — ${account.name}`}
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
          <p className="rounded-lg border border-dashed border-[rgba(255,255,255,0.08)] px-3 py-4 text-center text-xs text-[#8a8a8a]">
            Aucune position. Ajoutez un ISIN ou un ticker ci-dessous.
          </p>
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
