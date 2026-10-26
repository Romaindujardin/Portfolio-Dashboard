import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CreditCard,
  Landmark,
  LineChart,
  Wallet2,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { getOverview } from "../services/portfolioApi";
import type { Overview } from "../types/portfolio";
import { formatEur } from "./patrimoine/shared";

/**
 * Carte additive de la Synthèse.
 * Elle ne remplace aucun calcul existant : elle affiche uniquement les données
 * du nouveau modèle (comptes connectés, immobilier, prêts, marché) et renvoie
 * vers la page Patrimoine.
 */
const PortfolioBridgeCard: React.FC = () => {
  const { currentUser } = useUser();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getOverview(currentUser)
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const counts = overview?.counts;
  const isEmpty =
    !overview ||
    ((counts?.accounts ?? 0) === 0 &&
      (counts?.properties ?? 0) === 0 &&
      (counts?.loans ?? 0) === 0 &&
      (counts?.holdings ?? 0) === 0);

  const realEstateValue =
    overview?.accounts
      .filter((account) => account.type === "REAL_ESTATE")
      .reduce((sum, account) => sum + (account.balance || 0), 0) ?? 0;
  const marketValue =
    overview?.accounts
      .filter((account) => ["PEA", "SECURITIES", "CRYPTO", "EMPLOYEE_SAVINGS"].includes(account.type))
      .reduce((sum, account) => sum + (account.balance || 0), 0) ?? 0;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(200,165,94,0.1)]">
            <Wallet2 className="h-4 w-4 text-[#c8a55e]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[#f5f5f5]">Patrimoine connecté</h3>
              <span className="rounded-full border border-[rgba(200,165,94,0.25)] bg-[rgba(200,165,94,0.08)] px-2 py-0.5 text-[10px] text-[#d4b56e]">
                Nouveau
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#6a6a6a]">
              Multi-banques, immobilier, prêts et marchés — sans modifier les calculs historiques
              de cette page.
            </p>
          </div>
        </div>
        <Link
          to="/patrimoine"
          className="inline-flex items-center gap-1 rounded-lg border border-[rgba(200,165,94,0.3)] bg-[rgba(200,165,94,0.08)] px-3 py-1.5 text-xs font-medium text-[#d4b56e] transition-colors hover:bg-[rgba(200,165,94,0.15)]"
        >
          Ouvrir Patrimoine <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="mt-4 h-16 animate-pulse rounded-lg bg-[rgba(255,255,255,0.03)]" />
      ) : failed ? (
        <p className="mt-4 rounded-lg border border-dashed border-[rgba(255,255,255,0.08)] px-3 py-3 text-[11px] text-[#8a8a8a]">
          La couche patrimoine n'est pas joignable pour le moment. Les données existantes de la
          Synthèse restent disponibles.
        </p>
      ) : isEmpty ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[rgba(255,255,255,0.08)] px-3 py-3">
          <p className="text-[11px] text-[#8a8a8a]">
            Aucun compte dans le nouveau modèle. Connectez une banque, ajoutez un bien ou un prêt
            pour commencer.
          </p>
          <Link
            to="/patrimoine"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#c8a55e] hover:underline"
          >
            Configurer <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-[#6a6a6a]">
              <Landmark className="h-3 w-3" /> Patrimoine net
            </div>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[#f5f5f5]">
              {formatEur(overview?.totals.netWorth, { compact: true })}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-[#6a6a6a]">
              <Building2 className="h-3 w-3" /> Immobilier
            </div>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[#f5f5f5]">
              {formatEur(realEstateValue, { compact: true })}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-[#6a6a6a]">
              <CreditCard className="h-3 w-3" /> Dettes
            </div>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[#f87171]">
              {formatEur(overview?.totals.debts, { compact: true })}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-[#6a6a6a]">
              <LineChart className="h-3 w-3" /> Marché
            </div>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[#f5f5f5]">
              {formatEur(marketValue, { compact: true })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioBridgeCard;
