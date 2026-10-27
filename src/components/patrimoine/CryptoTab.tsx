import React, { useEffect, useMemo, useState } from "react";
import {
  Coins,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
  Shield,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import type { PortfolioAccount, Holding } from "../../types/portfolio";
import {
  getCryptoAccounts,
  createCryptoAccount,
  syncCryptoAccount,
  syncAllCryptoAccounts,
  deleteAccount,
} from "../../services/portfolioApi";
import {
  Card,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Spinner,
  EmptyState,
  formatEur,
  formatPercent,
  formatDate,
  cn,
} from "./shared";

type Notify = (kind: "success" | "error", message: string) => void;

interface CryptoTabProps {
  userId: string;
  onReload: () => Promise<void>;
  notify: Notify;
}

const PROVIDER_INFO: Record<
  string,
  { label: string; tone: "gold" | "blue" | "green" | "red" | "gray"; icon?: string }
> = {
  binance: { label: "Binance CEX", tone: "gold" },
  evm: { label: "EVM Multi-chain", tone: "blue" },
  bitcoin: { label: "Bitcoin", tone: "gold" },
  solana: { label: "Solana", tone: "green" },
  manual: { label: "Manuel / Cold", tone: "gray" },
};

export const CryptoTab: React.FC<CryptoTabProps> = ({
  userId,
  onReload,
  notify,
}) => {
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "exchange" | "wallet" | "manual">("all");

  // Modal d'ajout
  const [modalOpen, setModalOpen] = useState(false);
  const [providerType, setProviderType] = useState<"binance" | "evm" | "bitcoin" | "solana" | "manual">("evm");
  const [accountName, setAccountName] = useState("");
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [manualSymbol, setManualSymbol] = useState("BTC");
  const [manualQuantity, setManualQuantity] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PortfolioAccount | null>(null);

  const loadCrypto = async () => {
    try {
      setLoading(true);
      const list = await getCryptoAccounts(userId);
      setAccounts(list);
    } catch (err: any) {
      notify("error", err.message || "Erreur de chargement des comptes crypto");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCrypto();
  }, [userId]);

  const handleSyncAll = async () => {
    try {
      setSyncingAll(true);
      const res = await syncAllCryptoAccounts(userId);
      notify("success", `${res.synced} / ${res.total} compte(s) crypto actualisé(s)`);
      await loadCrypto();
      await onReload();
    } catch (err: any) {
      notify("error", err.message || "Erreur lors de la synchronisation crypto");
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSyncAccount = async (id: string) => {
    try {
      setSyncingId(id);
      await syncCryptoAccount(id, userId);
      notify("success", "Compte crypto actualisé");
      await loadCrypto();
      await onReload();
    } catch (err: any) {
      notify("error", err.message || "Échec de l'actualisation");
    } finally {
      setSyncingId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirmDelete) return;
    try {
      await deleteAccount(confirmDelete.id, userId);
      notify("success", `Compte « ${confirmDelete.name} » supprimé`);
      setConfirmDelete(null);
      await loadCrypto();
      await onReload();
    } catch (err: any) {
      notify("error", err.message || "Erreur lors de la suppression");
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim()) {
      notify("error", "Veuillez renseigner un nom pour ce compte");
      return;
    }

    try {
      setSubmitting(true);
      const payload: any = {
        name: accountName.trim(),
        provider: providerType,
      };

      if (providerType === "binance") {
        if (!apiKey.trim() || !apiSecret.trim()) {
          notify("error", "Clé API et Clé Secrète requises pour Binance");
          setSubmitting(false);
          return;
        }
        payload.apiKey = apiKey.trim();
        payload.apiSecret = apiSecret.trim();
      } else if (["evm", "bitcoin", "solana"].includes(providerType)) {
        if (!address.trim()) {
          notify("error", "Adresse publique requise");
          setSubmitting(false);
          return;
        }
        payload.address = address.trim();
      } else if (providerType === "manual") {
        if (!manualSymbol.trim() || !manualQuantity) {
          notify("error", "Symbole et quantité requis");
          setSubmitting(false);
          return;
        }
        payload.holdings = [
          {
            ticker: manualSymbol.trim().toUpperCase(),
            name: manualSymbol.trim().toUpperCase(),
            quantity: parseFloat(manualQuantity),
            price: manualPrice ? parseFloat(manualPrice) : undefined,
          },
        ];
      }

      await createCryptoAccount(userId, payload);
      notify("success", "Compte crypto ajouté et synchronisé !");
      setModalOpen(false);
      // Reset
      setAccountName("");
      setAddress("");
      setApiKey("");
      setApiSecret("");
      setManualQuantity("");
      setManualPrice("");
      await loadCrypto();
      await onReload();
    } catch (err: any) {
      notify("error", err.message || "Impossible d'ajouter le compte crypto");
    } finally {
      setSubmitting(false);
    }
  };

  // Statistiques globales
  const totalBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.balance || 0), 0),
    [accounts],
  );

  const allHoldings = useMemo(() => {
    const list: Array<{ holding: Holding; account: PortfolioAccount }> = [];
    for (const a of accounts) {
      for (const h of a.holdings || []) {
        list.push({ holding: h, account: a });
      }
    }
    return list;
  }, [accounts]);

  const uniqueTickers = useMemo(() => {
    const set = new Set<string>();
    for (const item of allHoldings) {
      if (item.holding.ticker) set.add(item.holding.ticker);
    }
    return Array.from(set);
  }, [allHoldings]);

  // Filtrage
  const filteredAccounts = useMemo(() => {
    if (filter === "exchange") {
      return accounts.filter((a) => a.provider === "binance");
    }
    if (filter === "wallet") {
      return accounts.filter((a) => ["evm", "bitcoin", "solana"].includes(a.provider));
    }
    if (filter === "manual") {
      return accounts.filter((a) => a.provider === "manual");
    }
    return accounts;
  }, [accounts, filter]);

  return (
    <div className="space-y-6">
      {/* En-tête & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#f5f5f5] flex items-center gap-2">
            <Coins className="h-5 w-5 text-[#c8a55e]" />
            Actifs Crypto & Web3
          </h2>
          <p className="text-xs text-[#8a8a8a] mt-0.5">
            Suivi automatique sur Binance et on-chain (EVM multi-chain, Bitcoin, Solana) sans clé tierce payante.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSyncAll}
            disabled={syncingAll || loading || accounts.length === 0}
          >
            {syncingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Tout actualiser
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1 stroke-[2.5]" />
            Ajouter un compte Crypto
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <span className="text-xs text-[#8a8a8a] block mb-1">Valeur Totale Crypto</span>
          <span className="text-2xl font-bold text-[#f5f5f5]">
            {formatEur(totalBalance)}
          </span>
          <span className="text-[11px] text-[#8a8a8a] block mt-1">
            Converti en direct en EUR
          </span>
        </Card>

        <Card className="p-4">
          <span className="text-xs text-[#8a8a8a] block mb-1">Comptes & Wallets</span>
          <span className="text-2xl font-bold text-[#c8a55e]">
            {accounts.length}
          </span>
          <span className="text-[11px] text-[#8a8a8a] block mt-1">
            {accounts.filter((a) => a.provider === "binance").length} CEX ·{" "}
            {accounts.filter((a) => a.provider !== "binance").length} on-chain/manuel
          </span>
        </Card>

        <Card className="p-4">
          <span className="text-xs text-[#8a8a8a] block mb-1">Tokens Détenus</span>
          <span className="text-2xl font-bold text-[#f5f5f5]">
            {uniqueTickers.length}
          </span>
          <span className="text-[11px] text-[#8a8a8a] block mt-1">
            Actifs distincts valorisés
          </span>
        </Card>

        <Card className="p-4">
          <span className="text-xs text-[#8a8a8a] block mb-1">Dernière Synchro</span>
          <span className="text-sm font-semibold text-[#d4d4d4] block truncate">
            {accounts[0]?.lastSyncAt ? formatDate(accounts[0].lastSyncAt) : "Jamais"}
          </span>
          <span className="text-[11px] text-[#22c55e] flex items-center gap-1 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"></span>
            Cotations CoinGecko & Binance
          </span>
        </Card>
      </div>

      {/* Filtres par type */}
      <div className="flex items-center gap-1.5 border-b border-[rgba(255,255,255,0.06)] pb-3">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            filter === "all"
              ? "bg-[#c8a55e] text-[#0a0a0a]"
              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)]",
          )}
        >
          Tous ({accounts.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter("exchange")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            filter === "exchange"
              ? "bg-[#c8a55e] text-[#0a0a0a]"
              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)]",
          )}
        >
          Exchanges CEX ({accounts.filter((a) => a.provider === "binance").length})
        </button>
        <button
          type="button"
          onClick={() => setFilter("wallet")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            filter === "wallet"
              ? "bg-[#c8a55e] text-[#0a0a0a]"
              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)]",
          )}
        >
          Wallets On-Chain ({accounts.filter((a) => ["evm", "bitcoin", "solana"].includes(a.provider)).length})
        </button>
        <button
          type="button"
          onClick={() => setFilter("manual")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            filter === "manual"
              ? "bg-[#c8a55e] text-[#0a0a0a]"
              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)]",
          )}
        >
          Manuels ({accounts.filter((a) => a.provider === "manual").length})
        </button>
      </div>

      {/* Liste des comptes */}
      {loading ? (
        <div className="py-12 flex justify-center">
          <Spinner />
        </div>
      ) : filteredAccounts.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-8 w-8 text-[#8a8a8a]" />}
          title="Aucun compte crypto configuré"
          description="Connectez votre compte Binance ou ajoutez une adresse blockchain (EVM, Bitcoin, Solana) pour synchroniser vos avoirs automatiquement."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setModalOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Ajouter un compte Crypto
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {filteredAccounts.map((account) => {
            const providerInfo = PROVIDER_INFO[account.provider] || {
              label: account.provider,
              tone: "gray" as const,
            };
            const holdings = account.holdings || [];
            const isSyncing = syncingId === account.id;

            return (
              <Card key={account.id} className="overflow-hidden">
                {/* Header du compte */}
                <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(200,165,94,0.1)] border border-[rgba(200,165,94,0.2)] flex items-center justify-center text-[#c8a55e]">
                      <Coins className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm text-[#f5f5f5]">
                          {account.name}
                        </h3>
                        <Badge tone={providerInfo.tone}>{providerInfo.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-[#8a8a8a]">
                        {Boolean(account.metadata?.address) && (
                          <span className="font-mono text-[11px] text-[#a3a3a3]">
                            {String(account.metadata.address).slice(0, 10)}...
                            {String(account.metadata.address).slice(-6)}
                          </span>
                        )}
                        {Boolean(account.metadata?.apiKeyMasked) && (
                          <span className="font-mono text-[11px] text-[#a3a3a3]">
                            API: {String(account.metadata.apiKeyMasked)}
                          </span>
                        )}
                        <span>•</span>
                        <span>Synchro : {account.lastSyncAt ? formatDate(account.lastSyncAt) : "En attente"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <div className="text-right">
                      <span className="text-xs text-[#8a8a8a] block">Solde</span>
                      <span className="text-base font-bold text-[#f5f5f5]">
                        {formatEur(account.balance)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSyncAccount(account.id)}
                        disabled={isSyncing || syncingAll}
                        title="Actualiser les soldes"
                      >
                        {isSyncing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmDelete(account)}
                        title="Supprimer ce compte"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Table des holdings */}
                {holdings.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#8a8a8a]">
                    Aucune position détectée sur ce compte. Cliquez sur « Actualiser » pour synchroniser.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[rgba(255,255,255,0.04)] text-[#8a8a8a] uppercase tracking-wider text-[10px]">
                          <th className="py-2.5 px-4 font-medium">Actif</th>
                          <th className="py-2.5 px-4 font-medium text-right">Quantité</th>
                          <th className="py-2.5 px-4 font-medium text-right">Cours (€)</th>
                          <th className="py-2.5 px-4 font-medium text-right">Valeur (€)</th>
                          <th className="py-2.5 px-4 font-medium text-right">Part</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(255,255,255,0.03)]">
                        {holdings.map((h) => {
                          const val = (h.quantity || 0) * (h.price || 0);
                          const share = account.balance > 0 ? (val / account.balance) * 100 : 0;
                          return (
                            <tr key={h.id || h.ticker} className="hover:bg-[rgba(255,255,255,0.02)]">
                              <td className="py-2.5 px-4">
                                <div className="flex items-center gap-2">
                                  <span className="w-6 h-6 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center font-bold text-[10px] text-[#c8a55e]">
                                    {(h.ticker || "?").slice(0, 3)}
                                  </span>
                                  <div>
                                    <span className="font-semibold text-[#f5f5f5]">
                                      {h.ticker}
                                    </span>
                                    {h.name && h.name !== h.ticker && (
                                      <span className="text-[11px] text-[#8a8a8a] ml-1.5">
                                        {h.name}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-[#d4d4d4]">
                                {h.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 6 })}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-[#8a8a8a]">
                                {formatEur(h.price)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-semibold text-[#f5f5f5]">
                                {formatEur(val)}
                              </td>
                              <td className="py-2.5 px-4 text-right text-[11px] text-[#8a8a8a]">
                                {formatPercent(share, 1)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal d'ajout de compte */}
      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title="Ajouter un compte Crypto"
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          {/* Sélecteur de méthode */}
          <div>
            <label className="text-xs font-medium text-[#d4d4d4] block mb-2">
              Type de connexion
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setProviderType("evm");
                  if (!accountName || accountName.includes("Binance")) setAccountName("Wallet EVM");
                }}
                className={cn(
                  "p-2.5 rounded-lg border text-left text-xs transition-colors",
                  providerType === "evm"
                    ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                    : "border-[rgba(255,255,255,0.08)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.02)]",
                )}
              >
                <div className="font-semibold">EVM Multi-chain</div>
                <div className="text-[10px] text-[#8a8a8a]">Ethereum, BSC, Polygon, Base...</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProviderType("binance");
                  if (!accountName || accountName.includes("Wallet")) setAccountName("Binance");
                }}
                className={cn(
                  "p-2.5 rounded-lg border text-left text-xs transition-colors",
                  providerType === "binance"
                    ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                    : "border-[rgba(255,255,255,0.08)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.02)]",
                )}
              >
                <div className="font-semibold">Binance (CEX)</div>
                <div className="text-[10px] text-[#8a8a8a]">Lecture seule API</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProviderType("bitcoin");
                  if (!accountName) setAccountName("Wallet Bitcoin");
                }}
                className={cn(
                  "p-2.5 rounded-lg border text-left text-xs transition-colors",
                  providerType === "bitcoin"
                    ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                    : "border-[rgba(255,255,255,0.08)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.02)]",
                )}
              >
                <div className="font-semibold">Bitcoin</div>
                <div className="text-[10px] text-[#8a8a8a]">Adresse bc1q... ou 1...</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProviderType("solana");
                  if (!accountName) setAccountName("Wallet Solana");
                }}
                className={cn(
                  "p-2.5 rounded-lg border text-left text-xs transition-colors",
                  providerType === "solana"
                    ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                    : "border-[rgba(255,255,255,0.08)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.02)]",
                )}
              >
                <div className="font-semibold">Solana</div>
                <div className="text-[10px] text-[#8a8a8a]">Phantom / Solflare</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProviderType("manual");
                  if (!accountName) setAccountName("Cold Wallet Manuel");
                }}
                className={cn(
                  "p-2.5 rounded-lg border text-left text-xs transition-colors",
                  providerType === "manual"
                    ? "border-[#c8a55e] bg-[rgba(200,165,94,0.08)] text-[#f5f5f5]"
                    : "border-[rgba(255,255,255,0.08)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.02)]",
                )}
              >
                <div className="font-semibold">Manuel / Ledger</div>
                <div className="text-[10px] text-[#8a8a8a]">Saisie sans clé API</div>
              </button>
            </div>
          </div>

          <Field label="Nom du compte">
            <Input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="ex: Metamask Principal, Binance Romain..."
              required
            />
          </Field>

          {/* Formulaire spécifique Binance */}
          {providerType === "binance" && (
            <div className="space-y-3 pt-1">
              <Field label="Clé API Binance">
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Collez votre clé API publique"
                  required
                />
              </Field>

              <Field label="Clé Secrète Binance">
                <div className="relative">
                  <Input
                    type={showSecret ? "text" : "password"}
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="Collez votre clé secrète"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a8a8a] hover:text-[#f5f5f5]"
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              <div className="p-3 rounded-lg bg-[rgba(200,165,94,0.05)] border border-[rgba(200,165,94,0.15)] text-xs text-[#d4d4d4] flex items-start gap-2">
                <Shield className="h-4 w-4 text-[#c8a55e] shrink-0 mt-0.5" />
                <span>
                  <strong>Sécurité :</strong> Utilisez impérativement des clés en <em>lecture seule</em> (Read-Only) sans autorisation de retrait. Vos clés sont chiffrées en AES-256-GCM localement.
                </span>
              </div>
            </div>
          )}

          {/* Formulaire Wallet On-Chain */}
          {["evm", "bitcoin", "solana"].includes(providerType) && (
            <div className="space-y-3 pt-1">
              <Field
                label={
                  providerType === "evm"
                    ? "Adresse publique EVM (0x...)"
                    : providerType === "bitcoin"
                    ? "Adresse publique Bitcoin"
                    : "Adresse publique Solana"
                }
              >
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={
                    providerType === "evm"
                      ? "0x1234567890abcdef..."
                      : providerType === "bitcoin"
                      ? "bc1q... ou 1..."
                      : "Base58 address..."
                  }
                  required
                />
              </Field>

              <div className="p-3 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a]">
                {providerType === "evm" && (
                  <span>
                    🌐 <strong>Multi-chain automatique :</strong> Votre adresse sera interrogée simultanément sur Ethereum, BSC, Polygon, Arbitrum, Base, Optimism et Avalanche sans aucune clé API requise.
                  </span>
                )}
                {providerType === "bitcoin" && (
                  <span>
                    ⚡ Interrogation directe et sécurisée du réseau Bitcoin via l'explorateur public Blockstream.
                  </span>
                )}
                {providerType === "solana" && (
                  <span>
                    🟣 Interrogation directe du réseau Solana Mainnet pour remonter vos SOL.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Formulaire Manuel */}
          {providerType === "manual" && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Symbole">
                <Input
                  value={manualSymbol}
                  onChange={(e) => setManualSymbol(e.target.value.toUpperCase())}
                  placeholder="BTC, ETH, SOL..."
                  required
                />
              </Field>
              <Field label="Quantité">
                <Input
                  type="number"
                  step="any"
                  value={manualQuantity}
                  onChange={(e) => setManualQuantity(e.target.value)}
                  placeholder="0.5"
                  required
                />
              </Field>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[rgba(255,255,255,0.08)]">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Ajouter et synchroniser
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation de suppression */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Supprimer le compte crypto"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#d4d4d4]">
            Êtes-vous sûr de vouloir supprimer le compte{" "}
            <strong>« {confirmDelete?.name} »</strong> et l'ensemble de ses positions ?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmDelete(null)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeleteAccount}
            >
              Supprimer définitivement
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default CryptoTab;
