import React, { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import SavingsStrategyPage from "./SavingsStrategy";
import { getCurrentMonthKey } from "../utils/tricountStorage";

const MONTH_KEY_REGEX = /^\d{4}-\d{2}$/;

/**
 * Page Stratégie d'épargne — un onglet par mois.
 * Le mois actif vit dans l'URL (?mois=AAAA-MM) pour permettre le partage,
 * le rafraîchissement et la navigation arrière du navigateur.
 */
const Strategy: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawMonth = searchParams.get("mois") || "";
  const monthKey = MONTH_KEY_REGEX.test(rawMonth)
    ? rawMonth
    : getCurrentMonthKey();

  const handleMonthChange = useCallback(
    (month: string) => {
      setSearchParams({ mois: month });
    },
    [setSearchParams],
  );

  return (
    <SavingsStrategyPage
      monthKey={monthKey}
      onMonthChange={handleMonthChange}
    />
  );
};

export default Strategy;
