import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  CreditCard,
  Landmark,
  LineChart,
  RefreshCw,
  ShieldCheck,
  Wallet2,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { useCurrency } from "../contexts/CurrencyContext";
import type {
  Connection,
  Holding,
  IntegrationStatus,
  Overview,
} from "../types/portfolio";
import {
  getAllHoldings,
  getConnections,
  getOverview,
} from "../services/portfolioApi";
import {
  Button,
  Card,
  ErrorBanner,
  Spinner,
  SuccessBanner,
  cn,
  formatEur,
  formatPercent,
} from "../components/patrimoine/shared";
import AccountsTab from "../components/patrimoine/AccountsTab";
import CryptoTab from "../components/patrimoine/CryptoTab";
import ConnectionsTab from "../components/patrimoine/ConnectionsTab";
import RealEstateTab from "../components/patrimoine/RealEstateTab";
import LoansTab from "../components/patrimoine/LoansTab";
import MarketTab from "../components/patrimoine/MarketTab";
import { Coins } from "lucide-react";

type TabKey = "accounts" | "crypto" | "connections" | "realestate" | "loans" | "market";

type Notice = { kind: "success" | "error"; message: string } | null;

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "accounts", label: "Comptes", icon: <Wallet2 className="h-3.5 w-3.5" /> },
  { key: "crypto", label: "Crypto", icon: <Coins className="h-3.5 w-3.5" /> },
  { key: "connections", label: "Connexions", icon: <Landmark className="h-3.5 w-3.5" /> },
  { key: "realestate", label: "Immobilier", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "loans", label: "Prêts", icon: <CreditCard className="h-3.5 w-3.5" /> },
  { key: "market", label: "Marché", icon: <LineChart className="h-3.5 w-3.5" /> },
];

const Patrimoine: React.FC = () => {
  const { currentUser } = useUser();
  useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>("accounts");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      getOverview(currentUser),
      getConnections(currentUser),
      getAllHoldings(currentUser),
    ]);
    const [overviewResult, connectionsResult, holdingsResult] = results;

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    } else {
      setError(
        overviewResult.reason instanceof Error
          ? overviewResult.reason.message
          : "Impossible de charger la synthèse patrimoine.",
      );
    }
    if (connectionsResult.status === "fulfilled") {
      setConnections(connectionsResult.value.connections);
      setStatus(connectionsResult.value.status);
    }
    if (holdingsResult.status === "fulfilled") {
      setHoldings(holdingsResult.value);
    }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const tabParam = searchParams.get("tab") as TabKey | null;
    if (tabParam && ["accounts", "crypto", "connections", "realestate", "loans", "market"].includes(tabParam)) {
      setTab(tabParam);
    }
    const connection = searchParams.get("connection");
    if (!connection) return;
    const message = searchParams.get("message");
    setTab("connections");
    if (connection === "success") {
      setNotice({ kind: "success", message: "Connexion bancaire réussie et comptes synchronisés." });
    } else if (connection === "pending") {
      setNotice({
        kind: "success",
        message:
          "Autorisation acceptée. La banque n'a pas encore renvoyé les comptes : réessayez la synchronisation dans quelques instants.",
      });
    } else if (connection === "error") {
      setNotice({ kind: "error", message: message || "La connexion bancaire a échoué." });
    }
    const next = new URLSearchParams(searchParams);
    next.delete("connection");
    next.delete("message");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const totals = overview?.totals || { assets: 0, debts: 0, netWorth: 0 };
  const myShare = overview?.perOwner?.[currentUser] ?? null;
  const hasOwnershipSplit = useMemo(() => {
    if (!overview) return false;
    return overview.accounts.some(
      (account) => (account.ownerships || []).length > 0,
    );
  }, [overview]);

  const notify = (kind: "success" | "error", message: string) => {
    setNotice({ kind, message });
  };

  if (loading && !overview) {
    return (
      <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#111111]">
        <Spinner label="Chargement du patrimoine…" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[#f5f5f5]">Patrimoine</h1>
            <span className="rounded-full border border-[rgba(200,165,94,0.3)] bg-[rgba(200,165,94,0.08)] px-2 py-0.5 text-[10px] font-medium text-[#d4b56e]">
              Multi-banques
            </span>
          </div>
          <p className="mt-1 text-xs text-[#8a8a8a]">
            Vue consolidée des comptes bancaires, de la crypto, de l'immobilier, des prêts et des marchés.
            Les pages historiques (Budget, Épargne) restent inchangées.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void loadAll()} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Actualiser
          </Button>
        </div>
      </div>

      {notice && (
        <div>
          {notice.kind === "success" ? (
            <SuccessBanner message={notice.message} onClose={() => setNotice(null)} />
          ) : (
            <ErrorBanner message={notice.message} onClose={() => setNotice(null)} />
          )}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.06)] p-4">
          <p className="text-sm font-medium text-[#fca5a5]">Serveur patrimoine indisponible</p>
          <p className="mt-1 text-xs text-[#d4a0a0]">{error}</p>
          <p className="mt-2 text-[11px] text-[#8a8a8a]">
            Vérifiez que le serveur local est démarré (<code>npm run server</code>) et que le
            schéma a bien été initialisé. Les autres pages de l'application ne sont pas affectées.
          </p>
        </div>
      )}

      {/* Cartes de synthèse */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wide text-[#6a6a6a]">Patrimoine net</p>
            <Wallet2 className="h-4 w-4 text-[#c8a55e]" />
          </div>
          <p
            className={cn(
              "mt-1 text-xl font-semibold tabular-nums",
              totals.netWorth >= 0 ? "text-[#f5f5f5]" : "text-[#f87171]",
            )}
          >
            {formatEur(totals.netWorth)}
          </p>
          <p className="mt-0.5 text-[10px] text-[#6a6a6a]">
            Actifs {formatEur(totals.assets, { compact: true })} · dettes{" "}
            {formatEur(totals.debts, { compact: true })}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wide text-[#6a6a6a]">Actifs</p>
            <Landmark className="h-4 w-4 text-[#34d399]" />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[#f5f5f5]">
            {formatEur(totals.assets)}
          </p>
          <p className="mt-0.5 text-[10px] text-[#6a6a6a]">
            {overview?.counts.accounts ?? 0} compte(s) · {overview?.counts.properties ?? 0} bien(s)
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wide text-[#6a6a6a]">Dettes</p>
            <CreditCard className="h-4 w-4 text-[#f87171]" />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[#f87171]">
            {formatEur(totals.debts)}
          </p>
          <p className="mt-0.5 text-[10px] text-[#6a6a6a]">
            {overview?.counts.loans ?? 0} prêt(s) suivi(s)
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wide text-[#6a6a6a]">
              {hasOwnershipSplit ? `Ma part (${currentUser})` : "Ma situation"}
            </p>
            <ShieldCheck className="h-4 w-4 text-[#60a5fa]" />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[#d4b56e]">
            {formatEur(myShare ?? totals.netWorth)}
          </p>
          <p className="mt-0.5 text-[10px] text-[#6a6a6a]">
            {hasOwnershipSplit
              ? "Après répartition des parts de propriété"
              : "Aucune part configurée : 100 %"}
          </p>
        </Card>
      </div>

      {/* Répartition par type */}
      {overview && Object.keys(overview.byType).length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-[#d4d4d4]">Répartition par enveloppe</p>
            <p className="text-[10px] text-[#6a6a6a]">
              Les prêts sont comptés en négatif dans le patrimoine net.
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(overview.byType)
              .filter(([, value]) => Math.abs(value) > 0.5)
              .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
              .map(([type, value]) => (
                <div
                  key={type}
                  className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[#0d0d0d] px-2.5 py-1.5"
                >
                  <span className="text-[10px] text-[#6a6a6a]">
                    {type === "REAL_ESTATE"
                      ? "Immobilier"
                      : type === "LOAN"
                        ? "Prêts"
                        : type === "CHECKING"
                          ? "Comptes courants"
                          : type === "SAVINGS"
                            ? "Épargne"
                            : type === "PEA"
                              ? "PEA"
                              : type === "SECURITIES"
                                ? "Compte-titres"
                                : type === "CRYPTO"
                                  ? "Crypto"
                                  : type === "EMPLOYEE_SAVINGS"
                                    ? "Épargne salariale"
                                    : type}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-medium tabular-nums",
                      value < 0 ? "text-[#f87171]" : "text-[#f5f5f5]",
                    )}
                  >
                    {formatEur(value, { compact: true })}
                  </span>
                  <span className="text-[10px] text-[#555555]">
                    {totals.assets > 0 && value > 0
                      ? formatPercent((value / totals.assets) * 100, 0)
                      : ""}
                  </span>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Onglets */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[rgba(255,255,255,0.07)] pb-0">
        {TABS.map((item) => {
          const count =
            item.key === "accounts"
              ? overview?.accounts.filter((a) => a.type !== "CRYPTO").length
              : item.key === "crypto"
                ? overview?.accounts.filter((a) => a.type === "CRYPTO").length
                : item.key === "connections"
                  ? connections.length
                  : item.key === "realestate"
                    ? overview?.counts.properties
                    : item.key === "loans"
                      ? overview?.counts.loans
                      : overview?.counts.holdings;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                tab === item.key
                  ? "border-[#c8a55e] text-[#d4b56e]"
                  : "border-transparent text-[#8a8a8a] hover:text-[#f5f5f5]",
              )}
            >
              {item.icon}
              {item.label}
              {count != null && count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px]",
                    tab === item.key
                      ? "bg-[rgba(200,165,94,0.15)] text-[#d4b56e]"
                      : "bg-[rgba(255,255,255,0.05)] text-[#6a6a6a]",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div>
        {tab === "accounts" && overview && (
          <AccountsTab
            userId={currentUser}
            accounts={overview.accounts.filter((a) => a.type !== "CRYPTO")}
            holdings={holdings}
            onReload={loadAll}
            notify={notify}
          />
        )}
        {tab === "crypto" && (
          <CryptoTab
            userId={currentUser}
            onReload={loadAll}
            notify={notify}
          />
        )}
        {tab === "connections" && (
          <ConnectionsTab
            userId={currentUser}
            connections={connections}
            status={status}
            onReload={loadAll}
            notify={notify}
          />
        )}
        {tab === "realestate" && overview && (
          <RealEstateTab
            userId={currentUser}
            properties={overview.properties}
            onReload={loadAll}
            notify={notify}
          />
        )}
        {tab === "loans" && overview && (
          <LoansTab
            userId={currentUser}
            loans={overview.loans}
            properties={overview.properties}
            onReload={loadAll}
            notify={notify}
          />
        )}
        {tab === "market" && overview && (
          <MarketTab
            userId={currentUser}
            holdings={holdings}
            accounts={overview.accounts}
            onReload={loadAll}
            notify={notify}
          />
        )}
      </div>
    </div>
  );
};

export default Patrimoine;
