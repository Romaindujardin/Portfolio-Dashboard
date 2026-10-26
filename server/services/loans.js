// Prêts et amortissement (phase 2).
// Taux stocké en pourcentage annuel (3,5 = 3,5 %). Tous les montants sont
// arrondis au centime, la dernière échéance absorbe les écarts d'arrondi.

import { round2 } from "../lib/validate.js";

export class LoanError extends Error {
  constructor(message, { status = 400, code = "LOAN_ERROR", details = null } = {}) {
    super(message);
    this.name = "LoanError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const addMonths = (date, months) => {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, daysInMonth));
  return result;
};

export const monthsBetween = (from, to) => {
  if (!from || !to) return 0;
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  );
};

export const computeMonthlyPayment = (principal, annualRatePercent, months) => {
  const amount = Number(principal);
  const rate = Number(annualRatePercent) / 100 / 12;
  const periods = Math.round(Number(months));
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(periods) || periods <= 0) {
    return 0;
  }
  if (!Number.isFinite(rate) || rate <= 0) return round2(amount / periods);
  const factor = (1 + rate) ** periods;
  return round2((amount * rate * factor) / (factor - 1));
};

/**
 * Construit l'échéancier complet et le résumé à une date donnée.
 * @param {object} loan
 * @param {Date} asOf
 */
export const buildAmortizationSchedule = (loan, asOf = new Date()) => {
  const principal = Number(loan.principal);
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new LoanError("Le capital emprunté doit être supérieur à zéro.");
  }
  const annualRate = Number(loan.annualRate ?? loan.annual_rate ?? 0);
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new LoanError("Taux annuel invalide.");
  }
  const startDate = parseDate(loan.startDate ?? loan.start_date);
  if (!startDate) throw new LoanError("La date de début du prêt est requise.");

  const endDate = parseDate(loan.endDate ?? loan.end_date);
  let months = Number(loan.termMonths ?? loan.term_months);
  if (endDate) {
    const diff = monthsBetween(startDate, endDate);
    if (diff < 0) {
      throw new LoanError("La date de fin doit être postérieure à la date de début.");
    }
    // La date de fin est la date de la dernière échéance : elle est incluse.
    months = Math.max(1, diff + 1);
  }
  if (!Number.isFinite(months) || months <= 0) {
    throw new LoanError("La durée du prêt (ou sa date de fin) est requise.");
  }
  months = Math.round(months);
  if (months > 600) throw new LoanError("Durée de prêt invalide (maximum 50 ans).");

  const monthlyRate = annualRate / 100 / 12;
  const insuranceMonthly = Math.max(0, Number(loan.insuranceMonthly ?? loan.insurance_monthly ?? 0));
  const providedPayment = Number(loan.monthlyPayment ?? loan.monthly_payment);
  const basePayment =
    Number.isFinite(providedPayment) && providedPayment > 0
      ? providedPayment
      : computeMonthlyPayment(principal, annualRate, months);

  let balance = principal;
  let totalInterest = 0;
  let totalInsurance = 0;
  const installments = [];

  for (let number = 1; number <= months; number += 1) {
    const interest = round2(balance * monthlyRate);
    let capital = round2(basePayment - interest);
    let payment = basePayment;
    if (number === months || capital >= balance) {
      capital = round2(balance);
      payment = round2(capital + interest);
    }
    balance = round2(Math.max(0, balance - capital));
    totalInterest = round2(totalInterest + interest);
    totalInsurance = round2(totalInsurance + insuranceMonthly);
    installments.push({
      number,
      date: addMonths(startDate, number - 1).toISOString().slice(0, 10),
      capital,
      interest,
      insurance: round2(insuranceMonthly),
      totalPayment: round2(payment + insuranceMonthly),
      remainingBalance: balance,
    });
  }

  const cutoff = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  const paidInstallments = installments.filter(
    (installment) => parseDate(installment.date) <= cutoff,
  ).length;
  const current = installments[Math.max(0, paidInstallments - 1)];
  const remainingBalance =
    paidInstallments === 0 ? round2(principal) : current.remainingBalance;
  const remainingInstallments = Math.max(0, months - paidInstallments);
  const totalPaid = round2(
    installments
      .slice(0, paidInstallments)
      .reduce((sum, installment) => sum + installment.totalPayment, 0),
  );

  return {
    installments,
    summary: {
      principal: round2(principal),
      annualRate,
      months,
      monthlyPayment: round2(basePayment + insuranceMonthly),
      basePayment: round2(basePayment),
      insuranceMonthly: round2(insuranceMonthly),
      totalInterest,
      totalInsurance,
      totalCost: round2(principal + totalInterest + totalInsurance),
      paidInstallments,
      remainingInstallments,
      remainingBalance,
      totalPaid,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: installments.at(-1)?.date || null,
      nextPaymentDate:
        paidInstallments < months ? installments[paidInstallments]?.date || null : null,
    },
  };
};

/** Met à jour le compte de type LOAN lié (solde négatif = dette restante). */
export const syncLoanAccount = (repository, loan, userId, asOf = new Date()) => {
  if (!loan?.accountId) return null;
  const { summary } = buildAmortizationSchedule(loan, asOf);
  return repository.updateAccount(loan.accountId, userId, {
    balance: -summary.remainingBalance,
    lastSyncAt: asOf.toISOString(),
  });
};
