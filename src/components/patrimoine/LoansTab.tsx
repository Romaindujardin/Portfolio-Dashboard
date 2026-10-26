import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  CreditCard,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  Loan,
  LoanSchedule,
  Property,
} from "../../types/portfolio";
import {
  createLoan,
  deleteLoan,
  getLoanSchedule,
  updateLoan,
} from "../../services/portfolioApi";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  SectionHeader,
  Select,
  StatRow,
  formatDate,
  formatEur,
  formatPercent,
} from "./shared";

type Notify = (kind: "success" | "error", message: string) => void;

interface LoansTabProps {
  userId: string;
  loans: Loan[];
  properties: Property[];
  onReload: () => Promise<void>;
  notify: Notify;
}

const LoansTab: React.FC<LoansTabProps> = ({
  userId,
  loans,
  properties,
  onReload,
  notify,
}) => {
  const [schedules, setSchedules] = useState<Record<string, LoanSchedule>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [scheduleLoan, setScheduleLoan] = useState<Loan | null>(null);
  const [schedule, setSchedule] = useState<LoanSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(
        loans.map(async (loan) => {
          try {
            const value = await getLoanSchedule(loan.id, userId);
            return [loan.id, value] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setSchedules(
        Object.fromEntries(entries.filter((entry): entry is readonly [string, LoanSchedule] => Boolean(entry))),
      );
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loans, userId]);

  const totals = useMemo(() => {
    const remaining = Object.values(schedules).reduce(
      (sum, item) => sum + item.summary.remainingBalance,
      0,
    );
    const monthly = Object.values(schedules).reduce(
      (sum, item) => sum + item.summary.monthlyPayment,
      0,
    );
    const interest = Object.values(schedules).reduce(
      (sum, item) => sum + item.summary.totalInterest,
      0,
    );
    return { remaining, monthly, interest };
  }, [schedules]);

  const openSchedule = async (loan: Loan) => {
    setScheduleLoan(loan);
    setSchedule(schedules[loan.id] || null);
    setScheduleLoading(true);
    try {
      setSchedule(await getLoanSchedule(loan.id, userId));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Échéancier indisponible.");
    } finally {
      setScheduleLoading(false);
    }
  };

  const save = async (payload: Record<string, unknown>) => {
    if (editing) {
      await updateLoan(editing.id, userId, payload);
      setEditing(null);
      notify("success", "Prêt mis à jour.");
    } else {
      await createLoan(userId, payload);
      setCreateOpen(false);
      notify("success", "Prêt ajouté et compte de dette créé.");
    }
    await onReload();
  };

  const remove = async (loan: Loan) => {
    if (
      !window.confirm(
        `Supprimer le prêt « ${loan.name} » ? Le compte de dette lié sera supprimé.`,
      )
    ) {
      return;
    }
    try {
      await deleteLoan(loan.id, userId);
      await onReload();
      notify("success", "Prêt supprimé.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Suppression impossible.");
    }
  };

  const propertyName = (loan: Loan) =>
    properties.find((property) => property.id === loan.propertyId)?.name || null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Prêts immobiliers"
        subtitle="Amortissement mensuel, capital restant dû et échéancier. Le compte de dette alimente la synthèse en négatif."
        action={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un prêt
          </Button>
        }
      />

      <Card className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Capital restant dû</p>
          <p className="text-base font-semibold tabular-nums text-[#f87171]">
            {formatEur(totals.remaining)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Mensualités (assurance incluse)</p>
          <p className="text-base font-semibold tabular-nums text-[#f5f5f5]">
            {formatEur(totals.monthly)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#6a6a6a]">Intérêts totaux</p>
          <p className="text-base font-semibold tabular-nums text-[#f5f5f5]">
            {formatEur(totals.interest)}
          </p>
        </div>
      </Card>

      {loans.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-7 w-7" />}
          title="Aucun prêt"
          description="Ajoutez un prêt immobilier pour suivre le capital restant dû, l'échéancier et la part de chaque propriétaire."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Ajouter un prêt
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {loans.map((loan) => {
            const result = schedules[loan.id];
            const summary = result?.summary;
            const progress =
              summary && summary.months > 0
                ? Math.min(100, (summary.paidInstallments / summary.months) * 100)
                : 0;
            return (
              <Card key={loan.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(239,68,68,0.08)]">
                    <CreditCard className="h-5 w-5 text-[#f87171]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-[#f5f5f5]">
                        {loan.name}
                      </h3>
                      <Badge tone="gold">{formatPercent(loan.annualRate)}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#6a6a6a]">
                      {loan.lender || "Prêteur non renseigné"}
                      {propertyName(loan) ? ` · ${propertyName(loan)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold tabular-nums text-[#f87171]">
                      {summary ? formatEur(summary.remainingBalance) : "—"}
                    </p>
                    <p className="text-[10px] text-[#6a6a6a]">capital restant</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 border-t border-[rgba(255,255,255,0.06)] pt-3 sm:grid-cols-2">
                  <div>
                    <StatRow label="Capital emprunté" value={formatEur(loan.principal)} />
                    <StatRow
                      label="Mensualité"
                      value={summary ? formatEur(summary.monthlyPayment) : "—"}
                    />
                    <StatRow label="Début" value={formatDate(loan.startDate)} />
                  </div>
                  <div>
                    <StatRow
                      label="Prochaine échéance"
                      value={summary ? formatDate(summary.nextPaymentDate) : "—"}
                    />
                    <StatRow
                      label="Fin prévue"
                      value={summary ? formatDate(summary.endDate) : formatDate(loan.endDate)}
                    />
                    <StatRow
                      label="Intérêts totaux"
                      value={summary ? formatEur(summary.totalInterest) : "—"}
                    />
                  </div>
                </div>

                {summary && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] text-[#6a6a6a]">
                      <span>
                        {summary.paidInstallments} / {summary.months} échéances payées
                      </span>
                      <span>{formatPercent(progress, 0)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div
                        className="h-full rounded-full bg-[#c8a55e]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[rgba(255,255,255,0.06)] pt-3">
                  <Button size="sm" onClick={() => openSchedule(loan)}>
                    <CalendarDays className="h-3.5 w-3.5" /> Échéancier
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(loan)}>
                    <Pencil className="h-3.5 w-3.5" /> Modifier
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(loan)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <LoanFormModal
        open={createOpen}
        title="Ajouter un prêt"
        properties={properties}
        onClose={() => setCreateOpen(false)}
        onSubmit={save}
      />
      <LoanFormModal
        open={Boolean(editing)}
        title="Modifier le prêt"
        initial={editing}
        properties={properties}
        onClose={() => setEditing(null)}
        onSubmit={save}
      />

      <Modal
        open={Boolean(scheduleLoan)}
        wide
        title={`Échéancier — ${scheduleLoan?.name || ""}`}
        onClose={() => {
          setScheduleLoan(null);
          setSchedule(null);
        }}
        footer={
          <Button
            onClick={() => {
              setScheduleLoan(null);
              setSchedule(null);
            }}
          >
            Fermer
          </Button>
        }
      >
        {scheduleLoading && !schedule ? (
          <p className="py-4 text-center text-xs text-[#8a8a8a]">Calcul de l'échéancier…</p>
        ) : schedule ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Card className="p-3">
                <p className="text-[10px] text-[#6a6a6a]">Mensualité totale</p>
                <p className="text-sm font-semibold text-[#f5f5f5]">
                  {formatEur(schedule.summary.monthlyPayment)}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[10px] text-[#6a6a6a]">Capital restant</p>
                <p className="text-sm font-semibold text-[#f87171]">
                  {formatEur(schedule.summary.remainingBalance)}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[10px] text-[#6a6a6a]">Coût total du crédit</p>
                <p className="text-sm font-semibold text-[#f5f5f5]">
                  {formatEur(schedule.summary.totalInterest + schedule.summary.totalInsurance)}
                </p>
              </Card>
            </div>

            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-[rgba(255,255,255,0.06)]">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[#141414] text-[#6a6a6a]">
                  <tr className="border-b border-[rgba(255,255,255,0.08)]">
                    <th className="px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Capital</th>
                    <th className="px-2 py-2 font-medium">Intérêts</th>
                    <th className="px-2 py-2 font-medium">Assurance</th>
                    <th className="px-2 py-2 font-medium">Total</th>
                    <th className="px-2 py-2 font-medium">Restant</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.installments.map((installment) => {
                    const paid = installment.number <= schedule.summary.paidInstallments;
                    return (
                      <tr
                        key={installment.number}
                        className={`border-b border-[rgba(255,255,255,0.04)] ${
                          paid ? "text-[#8a8a8a]" : "text-[#e5e5e5]"
                        }`}
                      >
                        <td className="px-2 py-1.5">{installment.number}</td>
                        <td className="px-2 py-1.5">{formatDate(installment.date)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{formatEur(installment.capital)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{formatEur(installment.interest)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{formatEur(installment.insurance)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{formatEur(installment.totalPayment)}</td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatEur(installment.remainingBalance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[#6a6a6a]">
              Les échéances déjà payées sont grisées. La dernière échéance absorbe les écarts
              d'arrondi.
            </p>
          </div>
        ) : (
          <ErrorBanner message="Échéancier indisponible : vérifiez la date de début et la durée." />
        )}
      </Modal>
    </div>
  );
};

// ─── Formulaire ─────────────────────────────────────────────────────────────

interface LoanFormState {
  name: string;
  lender: string;
  principal: string;
  annual_rate: string;
  start_date: string;
  end_date: string;
  term_months: string;
  monthly_payment: string;
  insurance_monthly: string;
  file_fees: string;
  property_id: string;
}

const emptyForm: LoanFormState = {
  name: "",
  lender: "",
  principal: "",
  annual_rate: "",
  start_date: "",
  end_date: "",
  term_months: "",
  monthly_payment: "",
  insurance_monthly: "0",
  file_fees: "0",
  property_id: "",
};

const toForm = (loan: Loan): LoanFormState => ({
  name: loan.name || "",
  lender: loan.lender || "",
  principal: String(loan.principal ?? ""),
  annual_rate: String(loan.annualRate ?? ""),
  start_date: loan.startDate || "",
  end_date: loan.endDate || "",
  term_months: loan.termMonths == null ? "" : String(loan.termMonths),
  monthly_payment: loan.monthlyPayment == null ? "" : String(loan.monthlyPayment),
  insurance_monthly: String(loan.insuranceMonthly ?? 0),
  file_fees: String(loan.fileFees ?? 0),
  property_id: loan.propertyId || "",
});

const toNumber = (value: string): number | null => {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const LoanFormModal: React.FC<{
  open: boolean;
  title: string;
  initial?: Loan | null;
  properties: Property[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}> = ({ open, title, initial, properties, onClose, onSubmit }) => {
  const [form, setForm] = useState<LoanFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(initial ? toForm(initial) : emptyForm);
    setError("");
  }, [open, initial]);

  const update = <K extends keyof LoanFormState>(key: K, value: LoanFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Le nom du prêt est requis.");
      return;
    }
    const principal = toNumber(form.principal);
    if (principal == null || principal <= 0) {
      setError("Le capital emprunté doit être supérieur à zéro.");
      return;
    }
    if (!form.start_date) {
      setError("La date de début est requise.");
      return;
    }
    if (!form.end_date && !form.term_months) {
      setError("Renseignez une durée en mois ou une date de fin.");
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      lender: form.lender.trim() || null,
      principal,
      annual_rate: toNumber(form.annual_rate) ?? 0,
      start_date: form.start_date,
      end_date: form.end_date || null,
      term_months: toNumber(form.term_months) == null ? null : Math.round(toNumber(form.term_months) as number),
      monthly_payment: toNumber(form.monthly_payment),
      insurance_monthly: toNumber(form.insurance_monthly) ?? 0,
      file_fees: toNumber(form.file_fees) ?? 0,
      property_id: form.property_id || null,
    };
    setBusy(true);
    setError("");
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {initial ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBanner message={error} onClose={() => setError("")} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom du prêt" required>
            <Input
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Prêt résidence principale"
            />
          </Field>
          <Field label="Prêteur">
            <Input
              value={form.lender}
              onChange={(event) => update("lender", event.target.value)}
              placeholder="BNP, BoursoBank…"
            />
          </Field>
          <Field label="Capital emprunté (€)" required>
            <Input
              inputMode="decimal"
              value={form.principal}
              onChange={(event) => update("principal", event.target.value)}
              placeholder="250000"
            />
          </Field>
          <Field label="Taux annuel (%)" hint="Exemple : 3,5 pour 3,5 %.">
            <Input
              inputMode="decimal"
              value={form.annual_rate}
              onChange={(event) => update("annual_rate", event.target.value)}
              placeholder="3,5"
            />
          </Field>
          <Field label="Date de début" required>
            <Input
              type="date"
              value={form.start_date}
              onChange={(event) => update("start_date", event.target.value)}
            />
          </Field>
          <Field label="Durée (mois)" hint="Ou renseignez une date de fin.">
            <Input
              inputMode="numeric"
              value={form.term_months}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  term_months: event.target.value,
                  end_date: "",
                }))
              }
              placeholder="240"
            />
          </Field>
          <Field label="Date de fin">
            <Input
              type="date"
              value={form.end_date}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  end_date: event.target.value,
                  term_months: "",
                }))
              }
            />
          </Field>
          <Field label="Mensualité hors assurance (€)" hint="Laisser vide pour calculer.">
            <Input
              inputMode="decimal"
              value={form.monthly_payment}
              onChange={(event) => update("monthly_payment", event.target.value)}
            />
          </Field>
          <Field label="Assurance mensuelle (€)">
            <Input
              inputMode="decimal"
              value={form.insurance_monthly}
              onChange={(event) => update("insurance_monthly", event.target.value)}
            />
          </Field>
          <Field label="Frais de dossier (€)">
            <Input
              inputMode="decimal"
              value={form.file_fees}
              onChange={(event) => update("file_fees", event.target.value)}
            />
          </Field>
          <Field label="Bien financé" className="sm:col-span-2">
            <Select
              value={form.property_id}
              onChange={(event) => update("property_id", event.target.value)}
            >
              <option value="">Aucun bien lié</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
};

export default LoansTab;
