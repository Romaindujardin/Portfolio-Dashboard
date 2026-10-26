import React, { useMemo, useState } from "react";
import {
  BarChart3,
  LineChart,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
} from "lucide-react";
import type { Holding, PortfolioAccount, Quote } from "../../types/portfolio";
import {
  createHolding,
  deleteHolding,
  getQuote,
  refreshPrices,
  searchSymbols,
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
  SectionHeader,
  Select,
  formatDate,
  formatEur,
  formatPercent,
} from "./shared";

type Notify = (kind: "success" | "error", message: string) => void;

interface MarketTabProps {
  userId: string;
  holdings: Holding[];
  accounts: PortfolioAccount[];
  onReload: () => Promise<void>;
  notify: Notify;
}

const MarketTab: React.FC<MarketTabProps> = ({
  userId,
  holdings,
  accounts,
  onReload,
  notify,
}) => {
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    account_id: "",
    isin: "",
    ticker: "",
    name: "",
    quantity: "",
    cost_basis: "",
    price: "",
    cash_balance: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [quoteTicker, setQuoteTicker] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ ticker: string; name: string; exchange: string | null }>
  >([]);
  const [searching, setSearching] = useState(false);

  const eligibleAccounts = useMemo(
    () => accounts.filter((account) => INVESTMENT_ACCOUNT_TYPES.has(account.type)),
    [accounts],
  );

  const totals = useMemo(() => {
    const value = holdings.reduce(
      (sum, holding) => sum + (holding.quantity || 0) * (holding.price || 0),
      0,
    );
    const cost = holdings.reduce((sum, holding) => sum + (holding.costBasis || 0), 0);
    return { value, cost, pnl: value - cost };
  }, [holdings]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await refreshPrices(userId, true);
      await onReload();
      notify(
        result.failed.length > 0 ? "error" : "success",
        `${result.updated} cours mis à jour${
          result.failed.length ? `, ${result.failed.length} échec(s)` : ""
        }.`,
      );
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Rafraîchissement impossible.");
    } finally {
      setRefreshing(false);
    }
  };

  const add = async () => {
    if (!form.account_id) {
      setError("Choisissez un compte d'investissement.");
      return;
    }
    if (!form.isin.trim() && !form.ticker.trim()) {
      setError("Renseignez un ISIN ou un ticker.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createHolding(form.account_id, userId, {
        isin: form.isin.trim() || undefined,
        ticker: form.ticker.trim() || undefined,
        name: form.name.trim() || undefined,
        quantity: Number(form.quantity.replace(",", ".")) || 0,
        cost_basis: form.cost_basis ? Number(form.cost_basis.replace(",", ".")) : undefined,
        price: form.price ? Number(form.price.replace(",", ".")) : undefined,
        cash_balance:
          form.cash_balance === ""
            ? undefined
            : Number(form.cash_balance.replace(",", ".")) || 0,
      });
      setAddOpen(false);
      setForm({
        account_id: "",
        isin: "",
        ticker: "",
        name: "",
        quantity: "",
        cost_basis: "",
        price: "",
        cash_balance: "",
      });
      await onReload();
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
      await deleteHolding(holding.accountId, holding.id, userId);
      await onReload();
      notify("success", "Position supprimée.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  const checkQuote = async (ticker?: string) => {
    const symbol = (ticker ?? quoteTicker).trim();
    if (!symbol) return;
    setQuoteLoading(true);
    setQuoteError("");
    try {
      setQuote(await getQuote(symbol));
      setQuoteTicker(symbol.toUpperCase());
    } catch (err) {
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Cours indisponible.");
    } finally {
      setQuoteLoading(false);
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      setSearchResults(await searchSymbols(searchQuery.trim()));
    } catch (err) {
      setSearchResults([]);
      setQuoteError(err instanceof Error ? err.message : "Recherche impossible.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Marché"
        subtitle="Cours des actions, ETF et crypto via Yahoo Finance (convertis en EUR), positions par compte et plus-values latentes."
        action={
          <Button onClick={refresh} loading={refreshing} disabled={holdings.length === 0}>
            <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir les cours
          </Button>
        }
      />

      <Card className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Valeur des positions</p>
          <p className="text-base font-semibold tabular-nums text-[#d4b56e]">
            {formatEur(totals.value)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Prix de revient</p>
          <p className="text-base font-semibold tabular-nums text-[#f5f5f5]">
            {formatEur(totals.cost)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Plus-value latente</p>
          <p
            className={`text-base font-semibold tabular-nums ${
              totals.pnl >= 0 ? "text-[#34d399]" : "text-[#f87171]"
            }`}
          >
            {formatEur(totals.pnl, { signed: true })}
            {totals.cost > 0 && (
              <span className="ml-1 text-[10px] text-[#6a6a6a]">
                {formatPercent((totals.pnl / totals.cost) * 100, 1)}
              </span>
            )}
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#8a8a8a]">
          {holdings.length} position{holdings.length > 1 ? "s" : ""}
        </p>
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter une position
        </Button>
      </div>

      {holdings.length === 0 ? (
        <EmptyState
          icon={<LineChart className="h-7 w-7" />}
          title="Aucune position"
          description="Ajoutez un ISIN ou un ticker à un compte d'investissement (PEA, compte-titres, crypto). Les cours sont récupérés automatiquement et convertis en euros."
          action={
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Ajouter une position
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[#6a6a6a]">
                <tr className="border-b border-[rgba(255,255,255,0.07)]">
                  <th className="px-4 py-2.5 font-medium">Instrument</th>
                  <th className="px-2 py-2.5 font-medium">Compte</th>
                  <th className="px-2 py-2.5 text-right font-medium">Quantité</th>
                  <th className="px-2 py-2.5 text-right font-medium">Prix</th>
                  <th className="px-2 py-2.5 text-right font-medium">Valeur</th>
                  <th className="px-2 py-2.5 text-right font-medium">P&L</th>
                  <th className="px-4 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {holdings.map((holding) => {
                  const value = (holding.quantity || 0) * (holding.price || 0);
                  const pnl = holding.costBasis != null ? value - holding.costBasis : null;
                  return (
                    <tr
                      key={holding.id}
                      className="border-b border-[rgba(255,255,255,0.04)] last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[rgba(200,165,94,0.08)]">
                            <BarChart3 className="h-3.5 w-3.5 text-[#c8a55e]" />
                          </div>
                          <div>
                            <p className="text-[#f5f5f5]">{holding.name || holding.ticker}</p>
                            <p className="text-[10px] text-[#6a6a6a]">
                              {holding.ticker}
                              {holding.isin ? ` · ${holding.isin}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[#8a8a8a]">
                        {holding.accountName || "—"}
                        {holding.lastPriceAt && (
                          <span className="block text-[10px] text-[#555555]">
                            {formatDate(holding.lastPriceAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#d4d4d4]">
                        {holding.quantity}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#d4d4d4]">
                        {formatEur(holding.price)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-[#f5f5f5]">
                        {formatEur(value)}
                      </td>
                      <td
                        className={`px-2 py-2.5 text-right tabular-nums ${
                          pnl == null
                            ? "text-[#6a6a6a]"
                            : pnl >= 0
                              ? "text-[#34d399]"
                              : "text-[#f87171]"
                        }`}
                      >
                        {pnl == null ? "—" : formatEur(pnl, { signed: true })}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" onClick={() => remove(holding)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Vérificateur de cours */}
      <Card className="p-4">
        <SectionHeader
          title="Vérifier un cours"
          subtitle="Recherchez un ticker (MC.PA, AAPL, CW8.PA…) ou un nom d'entreprise."
        />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Ticker" className="w-40">
            <Input
              value={quoteTicker}
              onChange={(event) => setQuoteTicker(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") void checkQuote();
              }}
              placeholder="MC.PA"
            />
          </Field>
          <Button variant="primary" onClick={() => checkQuote()} loading={quoteLoading}>
            <TrendingUp className="h-3.5 w-3.5" /> Cours
          </Button>
          <Field label="Rechercher" className="min-w-[220px] flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6a6a6a]" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                placeholder="LVMH, Apple, MSCI World…"
                className="pl-9"
              />
            </div>
          </Field>
          <Button onClick={runSearch} loading={searching}>
            <Search className="h-3.5 w-3.5" /> Chercher
          </Button>
        </div>

        {quoteError && (
          <div className="mt-3">
            <ErrorBanner message={quoteError} onClose={() => setQuoteError("")} />
          </div>
        )}

        {quote && (
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-[rgba(200,165,94,0.2)] bg-[rgba(200,165,94,0.04)] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Badge tone="gold">{quote.ticker}</Badge>
              <span className="text-sm font-medium text-[#f5f5f5]">{quote.name}</span>
            </div>
            <div className="ml-auto flex items-center gap-4 text-xs">
              <span className="text-base font-semibold tabular-nums text-[#d4b56e]">
                {formatEur(quote.price)}
              </span>
              {quote.currency !== "EUR" && quote.nativePrice != null && (
                <span className="text-[10px] text-[#6a6a6a]">
                  {quote.nativePrice} {quote.currency} · FX {quote.fxRate}
                </span>
              )}
              {quote.marketState === "CLOSED" ? (
                <Badge tone="gray">Clôturé</Badge>
              ) : (
                <Badge tone="green">Cours</Badge>
              )}
            </div>
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {searchResults.map((result) => (
              <button
                key={result.ticker}
                type="button"
                onClick={() => {
                  setQuoteTicker(result.ticker);
                  void checkQuote(result.ticker);
                }}
                className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[#0d0d0d] px-3 py-2 text-left hover:border-[rgba(200,165,94,0.3)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs text-[#f5f5f5]">{result.name}</p>
                  <p className="text-[10px] text-[#6a6a6a]">
                    {result.ticker} · {result.exchange || "—"}
                  </p>
                </div>
                <TrendingUp className="h-3.5 w-3.5 flex-shrink-0 text-[#c8a55e]" />
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Ajout */}
      <Modal
        open={addOpen}
        title="Ajouter une position"
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button onClick={() => setAddOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={add} loading={busy}>
              Ajouter
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} onClose={() => setError("")} />}
          {eligibleAccounts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[rgba(255,255,255,0.08)] px-3 py-4 text-center text-xs text-[#8a8a8a]">
              Créez d'abord un compte d'investissement dans l'onglet Comptes.
            </p>
          ) : (
            <Field label="Compte" required>
              <Select
                value={form.account_id}
                onChange={(event) => setForm({ ...form, account_id: event.target.value })}
              >
                <option value="">Choisir un compte…</option>
                {eligibleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} — {formatEur(account.balance)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ISIN" hint="Résolution automatique du ticker Yahoo.">
              <Input
                value={form.isin}
                onChange={(event) => setForm({ ...form, isin: event.target.value.toUpperCase() })}
                placeholder="FR0000121014"
              />
            </Field>
            <Field label="Ticker" hint="Si vous le connaissez déjà.">
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
              />
            </Field>
            <Field label="Quantité" required>
              <Input
                inputMode="decimal"
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              />
            </Field>
            <Field label="Prix de revient total (€)">
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
            <Field label="Liquidités du compte (€)" hint="Optionnel.">
              <Input
                inputMode="decimal"
                value={form.cash_balance}
                onChange={(event) => setForm({ ...form, cash_balance: event.target.value })}
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MarketTab;
