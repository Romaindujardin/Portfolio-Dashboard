import React, { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  Calendar,
  Search,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  X,
  Sliders,
} from "lucide-react";
import {
  TricountExpense,
  TricountIncome,
  TricountBeneficiary,
  MonthlyTricountConfig,
  TricountSplitMethod,
  TricountPayer,
  SavingsStrategy,
} from "../types";
import {
  getAvailableMonths,
  getCurrentMonthKey,
  formatMonthLabel,
  getExpensesForMonth,
  addOrUpdateExpense,
  deleteExpense,
  getIncomesForMonth,
  addOrUpdateIncome,
  deleteIncome,
  getMonthlyConfig,
  saveMonthlyConfig,
  calculateMonthlyBudgetSummary,
  isPlacementPocket,
  syncTricountWithDatabase,
} from "../utils/tricountStorage";
import {
  getSavingsStrategyForMonth,
  DEFAULT_SAVINGS_STRATEGY,
  getTotalMonthlyIncome,
} from "../utils/savingsStorage";
import MonthlyStrategyModal from "../components/MonthlyStrategyModal";
import { useUser } from "../contexts/UserContext";
import { getPersonTheme, getUserAccentColor } from "../utils/theme";

const formatEur = (val: number | null | undefined): string => {
  if (val == null || isNaN(val)) return "0,00 €";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
};

const BudgetTricount: React.FC = () => {
  const { currentUser, availableUsers } = useUser();
  const [selectedMonth, setSelectedMonth] =
    useState<string>(getCurrentMonthKey);
  const [strategy, setStrategy] = useState<SavingsStrategy>(() => {
    try {
      return getSavingsStrategyForMonth(getCurrentMonthKey(), currentUser);
    } catch {
      return DEFAULT_SAVINGS_STRATEGY;
    }
  });

  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [expenses, setExpenses] = useState<TricountExpense[]>([]);
  const [incomes, setIncomes] = useState<TricountIncome[]>([]);
  const [monthlyConfig, setMonthlyConfig] =
    useState<MonthlyTricountConfig | null>(null);

  // Filtres et tri
  const [searchTerm, setSearchTerm] = useState("");
  const [payerFilter, setPayerFilter] = useState<"all" | "person1" | "person2">(
    "all",
  );
  const [expandedPockets, setExpandedPockets] = useState<
    Record<string, boolean>
  >({});

  // Modales
  const [isStrategyModalOpen, setIsStrategyModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<TricountExpense | null>(
    null,
  );
  const [isIncomeItemModalOpen, setIsIncomeItemModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<TricountIncome | null>(
    null,
  );
  const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Formulaire de dépense / placement
  const [formDate, setFormDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [formLabel, setFormLabel] = useState("");
  const [formAmount, setFormAmount] = useState<number | "">("");
  const [formPayer, setFormPayer] = useState<TricountPayer>("person1");
  const [formPocketId, setFormPocketId] = useState<string>("unallocated");
  const [formSubPocketId, setFormSubPocketId] = useState<string>("");
  const [formSubPocketName, setFormSubPocketName] = useState<string>("");
  const [formNature, setFormNature] = useState<"expense" | "placement">(
    "expense",
  );
  const [formSplitMethod, setFormSplitMethod] =
    useState<TricountSplitMethod>("50_50");
  const [formNotes, setFormNotes] = useState("");

  // Formulaire d'ajout/édition de revenu détaillé
  const [incomeFormDate, setIncomeFormDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [incomeFormLabel, setIncomeFormLabel] = useState("");
  const [incomeFormAmount, setIncomeFormAmount] = useState<number | "">("");
  const [incomeFormBeneficiary, setIncomeFormBeneficiary] =
    useState<TricountBeneficiary>("person1");
  const [incomeFormNotes, setIncomeFormNotes] = useState("");

  // Formulaire de revenus globaux
  const [formP1Income, setFormP1Income] = useState<number | "">("");
  const [formP2Income, setFormP2Income] = useState<number | "">("");

  // Mode Solo vs Couple et Détection automatique des profils
  const isSoloMode =
    availableUsers.length < 2 || strategy.household?.enabled === false;
  const p1Name = strategy.household?.person1?.name || currentUser || "Romain";
  const p2Name =
    strategy.household?.person2?.name ||
    availableUsers.find((u) => u.toLowerCase() !== p1Name.toLowerCase()) ||
    "Sophie";
  const p1Color = getUserAccentColor(p1Name);
  const p2Color = getUserAccentColor(p2Name);
  const p1Theme = useMemo(
    () => getPersonTheme(p1Color, p1Name),
    [p1Color, p1Name],
  );
  const p2Theme = useMemo(
    () => getPersonTheme(p2Color, p2Name),
    [p2Color, p2Name],
  );

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = () => {
    const months = getAvailableMonths();
    setAvailableMonths(months);

    let activeMonth = selectedMonth;
    if (months.length > 0 && !months.includes(selectedMonth)) {
      activeMonth = months[0];
      setSelectedMonth(activeMonth);
    }

    const strat = getSavingsStrategyForMonth(activeMonth, currentUser);
    setStrategy(strat);

    const exps = getExpensesForMonth(activeMonth);
    setExpenses(exps);
    const incs = getIncomesForMonth(activeMonth);
    setIncomes(incs);
    const conf = getMonthlyConfig(activeMonth, strat);
    setMonthlyConfig(conf);
  };

  useEffect(() => {
    syncTricountWithDatabase(currentUser).then(() => {
      loadData();
    });
    loadData();
    const handleUpdate = () => loadData();
    window.addEventListener("tricount_data_updated", handleUpdate);
    window.addEventListener("savings_strategy_updated", handleUpdate);
    return () => {
      window.removeEventListener("tricount_data_updated", handleUpdate);
      window.removeEventListener("savings_strategy_updated", handleUpdate);
    };
  }, [selectedMonth, currentUser]);

  // Résumé et calculs budgétaires
  const summary = useMemo(() => {
    return calculateMonthlyBudgetSummary(selectedMonth, strategy);
  }, [selectedMonth, expenses, incomes, monthlyConfig, strategy]);

  // Répartition prorata dynamique basée sur les revenus du mois
  const totalMonthlyIncome = (summary.p1Income || 0) + (summary.p2Income || 0);
  const p1Ratio =
    totalMonthlyIncome > 0
      ? Math.round(((summary.p1Income || 0) / totalMonthlyIncome) * 100)
      : 50;
  const p2Ratio = totalMonthlyIncome > 0 ? 100 - p1Ratio : 50;

  // Revenus prévus et gestion du déroulement des poches
  const plannedIncome = useMemo(() => {
    const fromStrategy = getTotalMonthlyIncome(strategy.incomes || []);
    if (fromStrategy > 0) return fromStrategy;
    const p1 = Number(monthlyConfig?.p1Income) || 0;
    const p2 = Number(monthlyConfig?.p2Income) || 0;
    if (p1 + p2 > 0) return p1 + p2;
    return summary.totalIncome;
  }, [strategy.incomes, monthlyConfig, summary.totalIncome]);

  const togglePocket = (pocketId: string) => {
    setExpandedPockets((prev) => ({
      ...prev,
      [pocketId]: !prev[pocketId],
    }));
  };

  // Ouvrir modale ajout opération (avec poche et nature optionnelles)
  const handleOpenAddExpense = (
    defaultPocketId?: string,
    defaultSubPocketId?: string,
    defaultNature?: "expense" | "placement",
    suggestedAmount?: number,
    defaultPayer?: TricountPayer,
  ) => {
    setEditingExpense(null);
    const defaultDate = `${selectedMonth}-01`;
    const today = new Date().toISOString().slice(0, 10);
    setFormDate(today.startsWith(selectedMonth) ? today : defaultDate);
    setFormLabel("");
    setFormAmount(
      suggestedAmount && suggestedAmount > 0 ? suggestedAmount : "",
    );
    const initialPayer: TricountPayer =
      defaultPayer ||
      (currentUser.toLowerCase() === p2Name.toLowerCase() && !isSoloMode
        ? "person2"
        : "person1");
    setFormPayer(initialPayer);

    const pocketId = defaultPocketId || "unallocated";
    setFormPocketId(pocketId);
    setFormSubPocketId(defaultSubPocketId || "");

    const pocket = strategy.pockets.find((p) => p.id === pocketId);
    const subItem = pocket?.subItems?.find((s) => s.id === defaultSubPocketId);
    setFormSubPocketName(subItem ? subItem.name : "");

    const isPlac = isPlacementPocket(pocket) || defaultNature === "placement";
    setFormNature(isPlac ? "placement" : "expense");

    if (isSoloMode) {
      setFormSplitMethod("100_person1");
    } else if (defaultPayer === "person1") {
      setFormSplitMethod("100_person1");
      setFormPayer("person1");
    } else if (defaultPayer === "person2") {
      setFormSplitMethod("100_person2");
      setFormPayer("person2");
    } else if (subItem?.personId === "person1") {
      setFormSplitMethod("100_person1");
      setFormPayer("person1");
    } else if (subItem?.personId === "person2") {
      setFormSplitMethod("100_person2");
      setFormPayer("person2");
    } else if (pocket?.ownership === "person1") {
      setFormSplitMethod("100_person1");
      setFormPayer("person1");
    } else if (pocket?.ownership === "person2") {
      setFormSplitMethod("100_person2");
      setFormPayer("person2");
    } else if (pocket?.splitMethod === "proportional") {
      setFormSplitMethod("proportional");
    } else {
      setFormSplitMethod("50_50");
    }

    setFormNotes("");
    setIsExpenseModalOpen(true);
  };

  // Ouvrir modale édition opération
  const handleOpenEditExpense = (exp: TricountExpense) => {
    setEditingExpense(exp);
    setFormDate(exp.date);
    setFormLabel(exp.label);
    setFormAmount(exp.amount);
    setFormPayer(isSoloMode ? "person1" : exp.payerPersonId);
    setFormPocketId(exp.pocketId || "unallocated");
    setFormSubPocketId(exp.subPocketId || "");
    setFormSubPocketName(exp.subPocketName || "");
    setFormSplitMethod(isSoloMode ? "100_person1" : exp.splitMethod || "50_50");
    setFormNotes(exp.notes || "");
    const pocket = strategy.pockets.find((p) => p.id === exp.pocketId);
    setFormNature(
      exp.nature || (isPlacementPocket(pocket) ? "placement" : "expense"),
    );
    setIsExpenseModalOpen(true);
  };

  // Sauvegarder l'opération (dépense ou placement)
  const handleSaveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formLabel.trim() || formAmount === "" || Number(formAmount) <= 0) {
      alert("Veuillez saisir un libellé et un montant valide.");
      return;
    }

    const pocket = strategy.pockets.find((p) => p.id === formPocketId);
    const pocketName = pocket
      ? pocket.name
      : formPocketId === "unallocated"
        ? "Autre / Non classé"
        : "";
    const subItem = pocket?.subItems?.find((s) => s.id === formSubPocketId);
    const subPocketName = subItem
      ? subItem.name
      : formSubPocketName || undefined;

    const expenseMonth = formDate.slice(0, 7) || selectedMonth;

    const newExpense: TricountExpense = {
      id: editingExpense
        ? editingExpense.id
        : `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      month: expenseMonth,
      date: formDate,
      label: formLabel.trim(),
      amount: Math.round(Number(formAmount) * 100) / 100,
      payerPersonId: formPayer,
      pocketId: formPocketId,
      pocketName,
      subPocketId: formSubPocketId || undefined,
      subPocketName,
      nature: formNature,
      splitMethod: formSplitMethod,
      source: editingExpense?.source || "manual",
      bankAccount: editingExpense?.bankAccount,
      bankReference: editingExpense?.bankReference,
      bankRowId: editingExpense?.bankRowId,
      notes: formNotes.trim(),
      createdAt: editingExpense?.createdAt || Date.now(),
    };

    addOrUpdateExpense(newExpense);
    setIsExpenseModalOpen(false);
    showToast(
      editingExpense
        ? "Opération mise à jour !"
        : formNature === "placement"
          ? "Placement ajouté avec succès !"
          : "Dépense ajoutée avec succès !",
    );
  };

  const handleDeleteExpense = (id: string, label: string) => {
    if (window.confirm(`Supprimer la dépense "${label}" ?`)) {
      deleteExpense(id);
      showToast("Dépense supprimée.");
    }
  };

  // ===== Handlers Revenus détaillés =====
  const handleOpenAddIncome = () => {
    setEditingIncome(null);
    const defaultDate = `${selectedMonth}-01`;
    const today = new Date().toISOString().slice(0, 10);
    setIncomeFormDate(today.startsWith(selectedMonth) ? today : defaultDate);
    setIncomeFormLabel("");
    setIncomeFormAmount("");
    const defaultBen: TricountBeneficiary =
      currentUser.toLowerCase() === p2Name.toLowerCase() && !isSoloMode
        ? "person2"
        : "person1";
    setIncomeFormBeneficiary(defaultBen);
    setIncomeFormNotes("");
    setIsIncomeItemModalOpen(true);
  };

  const handleOpenEditIncome = (inc: TricountIncome) => {
    setEditingIncome(inc);
    setIncomeFormDate(inc.date);
    setIncomeFormLabel(inc.label);
    setIncomeFormAmount(inc.amount);
    setIncomeFormBeneficiary(
      isSoloMode ? "person1" : inc.beneficiaryPersonId || "person1",
    );
    setIncomeFormNotes(inc.notes || "");
    setIsIncomeItemModalOpen(true);
  };

  const handleSaveIncomeItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !incomeFormLabel.trim() ||
      incomeFormAmount === "" ||
      Number(incomeFormAmount) <= 0
    ) {
      alert("Veuillez saisir un libellé et un montant de revenu valide.");
      return;
    }

    const incomeMonth = incomeFormDate.slice(0, 7) || selectedMonth;

    const newIncome: TricountIncome = {
      id:
        editingIncome?.id ||
        `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      month: incomeMonth,
      date: incomeFormDate,
      label: incomeFormLabel.trim(),
      amount: Math.round(Number(incomeFormAmount) * 100) / 100,
      beneficiaryPersonId: isSoloMode ? "person1" : incomeFormBeneficiary,
      source: editingIncome?.source || "manual",
      bankAccount: editingIncome?.bankAccount,
      bankReference: editingIncome?.bankReference,
      bankRowId: editingIncome?.bankRowId,
      notes: incomeFormNotes.trim() || undefined,
      createdAt: editingIncome?.createdAt || Date.now(),
    };

    addOrUpdateIncome(newIncome);
    setIsIncomeItemModalOpen(false);
    showToast(
      editingIncome ? "Revenu mis à jour !" : "Revenu ajouté avec succès !",
    );
  };

  const handleDeleteIncome = (id: string, label: string) => {
    if (window.confirm(`Supprimer le revenu "${label}" ?`)) {
      deleteIncome(id);
      showToast("Revenu supprimé.");
    }
  };

  // Ouvrir modale d'édition globale des revenus du mois
  const handleOpenIncomeModal = () => {
    setFormP1Income(summary.p1Income);
    setFormP2Income(isSoloMode ? 0 : summary.p2Income);
    setIsIncomeModalOpen(true);
  };

  const handleSaveIncomes = (e: React.FormEvent) => {
    e.preventDefault();
    if (formP1Income === "" || (!isSoloMode && formP2Income === "")) return;
    const p1Val = Number(formP1Income) || 0;
    const p2Val = isSoloMode ? 0 : Number(formP2Income) || 0;

    saveMonthlyConfig({
      month: selectedMonth,
      p1Income: p1Val,
      p2Income: p2Val,
      isStrategyApplied: monthlyConfig?.isStrategyApplied ?? false,
      targetSavingsRate: monthlyConfig?.targetSavingsRate,
    });

    // Synchroniser directement avec la table des opérations de revenus
    const currentMonthIncomes = getIncomesForMonth(selectedMonth);
    const existingP1 = currentMonthIncomes.find(
      (i) => (i.beneficiaryPersonId || "person1") === "person1",
    );
    const existingP2 = currentMonthIncomes.find(
      (i) => i.beneficiaryPersonId === "person2",
    );

    if (p1Val > 0) {
      if (existingP1) {
        addOrUpdateIncome({ ...existingP1, amount: p1Val });
      } else {
        addOrUpdateIncome({
          id: `inc_${Date.now()}_p1`,
          month: selectedMonth,
          date: `${selectedMonth}-01`,
          label: `Salaire / Revenu net ${p1Name}`,
          amount: p1Val,
          beneficiaryPersonId: "person1",
          source: "manual",
          createdAt: Date.now(),
        });
      }
    }

    if (!isSoloMode && p2Val > 0) {
      if (existingP2) {
        addOrUpdateIncome({ ...existingP2, amount: p2Val });
      } else {
        addOrUpdateIncome({
          id: `inc_${Date.now()}_p2`,
          month: selectedMonth,
          date: `${selectedMonth}-01`,
          label: `Salaire / Revenu net ${p2Name}`,
          amount: p2Val,
          beneficiaryPersonId: "person2",
          source: "manual",
          createdAt: Date.now() + 1,
        });
      }
    }

    loadData();
    setIsIncomeModalOpen(false);
    showToast("Revenus du mois enregistrés !");
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0a0a0a] text-white dark:bg-[#111111] dark:text-[#f5f5f5] px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-sm font-medium animate-fade-in">
          <CheckCircle2
            size={16}
            className="text-emerald-400 dark:text-emerald-600"
          />
          {toastMessage}
        </div>
      )}

      {/* En-tête Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#f5f5f5]">
            Budget
          </h1>
          <p className="text-sm text-[#8a8a8a] mt-1">
            Confrontation entre vos revenus, vos dépenses réelles et les
            objectifs de votre stratégie d'épargne.
          </p>
        </div>
      </div>

      {/* Volets des Mois */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center space-x-2 sm:space-x-6 overflow-x-auto scrollbar-none py-0.5">
          {availableMonths.map((m) => {
            const isActive = m === selectedMonth;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMonth(m)}
                className={`pb-2.5 text-sm font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? "border-[#c8a55e] text-[#c8a55e] text-[#c8a55e]"
                    : "border-transparent text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                }`}
              >
                <Calendar
                  size={15}
                  className={isActive ? "text-primary-500" : "text-[#555555]"}
                />
                <span>{formatMonthLabel(m)}</span>
              </button>
            );
          })}
        </div>

        {/* Barre d'action : boutons */}
        <div className="flex items-center gap-2 pb-2">
          {/* Bouton Voir la Stratégie */}
          <button
            type="button"
            onClick={() => setIsStrategyModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111111] text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)] transition shadow-xs"
            title={`Voir et éditer la stratégie d'épargne pour ${formatMonthLabel(selectedMonth)}`}
          >
            <Sliders size={13} className="text-primary-500" />
            <span className="hidden sm:inline">Voir la stratégie</span>
            <span className="sm:hidden">Stratégie</span>
          </button>

          {/* Bouton Unique + Regroupant les 3 Actions */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAddMenu((prev) => !prev)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-[#c8a55e] hover:bg-[#d4b06a] text-white transition shadow-xs"
            >
              <Plus size={15} />
              <span>Ajouter</span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${showAddMenu ? "rotate-180" : ""}`}
              />
            </button>

            {showAddMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowAddMenu(false)}
                />
                <div className="absolute right-0 mt-1.5 w-52 bg-[#111111] dark:bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-xl shadow-xl z-50 py-1.5 text-xs font-medium animate-fade-in">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMenu(false);
                      handleOpenAddIncome();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-between transition-colors"
                  >
                    <span className="font-semibold">Nouveau revenu</span>
                    <span className="text-[10px] text-[#555555]">
                      Salaire, rente...
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMenu(false);
                      handleOpenAddExpense();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-[rgba(255,255,255,0.04)] text-[#f5f5f5]  flex items-center justify-between transition-colors border-t border-[rgba(255,255,255,0.06)]"
                  >
                    <span className="font-semibold">Nouvelle dépense fixe</span>
                    <span className="text-[10px] text-[#555555]">
                      Loyer, courses...
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMenu(false);
                      handleOpenAddExpense(undefined, undefined, "placement");
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-between transition-colors border-t border-[rgba(255,255,255,0.06)]"
                  >
                    <span className="font-semibold">Nouveau placement</span>
                    <span className="text-[10px] text-[#555555]">
                      PEA, livret...
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 4 Cartes Métriques Clés du Mois */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* 1. Revenus Réels */}
        <div className="card flex flex-col items-center justify-center text-center relative group">
          <div className="flex items-center justify-center">
            <span className="text-sm font-medium text-[#8a8a8a]">
              Revenus Réels ({formatMonthLabel(selectedMonth).split(" ")[0]})
            </span>
            <button
              type="button"
              onClick={handleOpenIncomeModal}
              className="text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 transition p-1"
              title="Ajuster les revenus réels"
            >
              <Edit2 size={13} />
            </button>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatEur(summary.totalIncome)}
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-[#555555] mt-2">
              <span style={p1Theme.textStyle} className="font-semibold">
                {p1Name}: {formatEur(summary.p1Income)}
              </span>
              •
              <span style={p2Theme.textStyle} className="font-semibold">
                {p2Name}: {formatEur(summary.p2Income)}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Dépenses Fixes & Courantes */}
        <div className="card flex flex-col items-center justify-center text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm font-medium text-[#8a8a8a]">
              Dépenses Fixes
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              Charges & vie
            </span>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold text-[#f5f5f5]">
              {formatEur(summary.totalExpenses)}
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-[#555555] mt-2">
              <span style={p1Theme.textStyle} className="font-medium">
                Payé {p1Name}: {formatEur(summary.balance.totalP1Paid)}
              </span>
              •
              <span style={p2Theme.textStyle} className="font-medium">
                {p2Name}: {formatEur(summary.balance.totalP2Paid)}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Capacité d'Épargne Réelle */}
        <div className="card flex flex-col items-center justify-center text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm font-medium text-[#8a8a8a]">
              Capacité d'Épargne
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                summary.realSavingsAmount >= 0
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
              }`}
            >
              {summary.realSavingsRate.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1">
            <div
              className={`text-2xl font-bold ${
                summary.realSavingsAmount >= 0
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {formatEur(summary.realSavingsAmount)}
            </div>
            <div
              className="flex items-center justify-center gap-2 text-xs text-[#555555] mt-2"
              title={`Total placé : ${formatEur(summary.totalPlacements)} • Libre : ${formatEur(summary.unplacedSavings)}`}
            >
              {isSoloMode ? (
                <span style={p1Theme.textStyle} className="font-semibold">
                  {p1Name}: {formatEur(summary.p1SavingsAmount ?? summary.realSavingsAmount)}
                </span>
              ) : (
                <>
                  <span style={p1Theme.textStyle} className="font-semibold">
                    {p1Name}: {formatEur(summary.p1SavingsAmount ?? 0)}
                  </span>
                  •
                  <span style={p2Theme.textStyle} className="font-semibold">
                    {p2Name}: {formatEur(summary.p2SavingsAmount ?? 0)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 4. Équilibrage Tricount */}
        <div className="card flex flex-col items-center justify-center text-center">
          <span className="text-sm font-medium text-[#8a8a8a]">
            Équilibre Tricount
          </span>
          <div className="mt-1">
            {isSoloMode ? (
              <div>
                <div className="text-lg font-bold text-[#c8a55e] text-[#c8a55e]">
                  Mode Solo
                </div>
                <p className="text-xs text-[#555555] mt-1">
                  Gestion individuelle — 100% alloué à {p1Name}
                </p>
              </div>
            ) : summary.balance.debtor === "none" ? (
              <div>
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  Comptes équilibrés
                </div>
                <p className="text-xs text-[#555555] mt-1">
                  Chacun a payé sa part exacte (
                  {summary.balance.sharedExpensesCount} dépenses partagées)
                </p>
              </div>
            ) : (
              <div>
                <div className="text-lg font-bold text-[#f5f5f5]">
                  <span
                    style={
                      summary.balance.debtor === "person1"
                        ? p1Theme.textStyle
                        : p2Theme.textStyle
                    }
                  >
                    {summary.balance.debtor === "person1" ? p1Name : p2Name}
                  </span>{" "}
                  doit{" "}
                  <span className="text-[#c8a55e] text-[#c8a55e] font-extrabold">
                    {formatEur(summary.balance.transferAmount)}
                  </span>
                </div>
                <p className="text-xs text-[#555555] mt-1">
                  À rembourser à{" "}
                  <strong
                    style={
                      summary.balance.creditor === "person1"
                        ? p1Theme.textStyle
                        : p2Theme.textStyle
                    }
                  >
                    {summary.balance.creditor === "person1" ? p1Name : p2Name}
                  </strong>{" "}
                  pour clore {formatMonthLabel(selectedMonth).split(" ")[0]}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Budget réel découpé en trois sections indépendantes */}
      <div className="space-y-4">
        {/* En-tête sobre du panneau */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#f5f5f5]">
              Budget Réel du mois ({formatMonthLabel(selectedMonth)})
            </h3>
            <p className="text-xs text-[#555555] mt-0.5">
              Revenus perçus, dépenses fixes et affectation de l'épargne réelle.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Barre de recherche */}
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555555]"
              />
              <input
                type="text"
                placeholder="Rechercher une opération..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field pl-8 pr-2 py-1 text-xs w-36 sm:w-48"
              />
            </div>

            {/* Filtre Payeur (si couple) */}
            {!isSoloMode && (
              <select
                value={payerFilter}
                onChange={(e) => setPayerFilter(e.target.value as any)}
                className="input-field py-1 px-2 text-xs w-auto cursor-pointer"
              >
                <option value="all">Tous payeurs</option>
                <option value="person1">{p1Name}</option>
                <option value="person2">{p2Name}</option>
              </select>
            )}
          </div>
        </div>

        {/* Liste des Sections : 1. Revenus, 2. Dépenses fixes, 3. Épargne & Placements */}
        <div className="space-y-3.5">
          <div className="card p-4 sm:p-5 space-y-4">
            {/* ===== 1. POCHE REVENUS DU MOIS ===== */}
            {(() => {
              const isIncomeExpanded =
                !!expandedPockets["incomes"] ||
                (searchTerm.trim().length > 0 &&
                  incomes.some(
                    (i) =>
                      (i.label || "")
                        .toLowerCase()
                        .includes(searchTerm.toLowerCase()) ||
                      (i.notes || "")
                        .toLowerCase()
                        .includes(searchTerm.toLowerCase()),
                  ));

              const percentIncomeReceived =
                plannedIncome > 0
                  ? Math.round((summary.totalIncome / plannedIncome) * 100)
                  : summary.totalIncome > 0
                    ? 100
                    : 0;
              const isIncomeTargetMet =
                summary.totalIncome >= plannedIncome && summary.totalIncome > 0;
              const incomeDiff = summary.totalIncome - plannedIncome;

              const displayedIncomes = incomes
                .filter((i) => {
                  if (payerFilter !== "all") {
                    const ben = i.beneficiaryPersonId || "person1";
                    if (payerFilter === "person1" && ben === "person2")
                      return false;
                    if (payerFilter === "person2" && ben === "person1")
                      return false;
                  }
                  if (searchTerm.trim()) {
                    const s = searchTerm.toLowerCase();
                    const matchLabel = (i.label || "")
                      .toLowerCase()
                      .includes(s);
                    const matchNotes = (i.notes || "")
                      .toLowerCase()
                      .includes(s);
                    if (!matchLabel && !matchNotes) return false;
                  }
                  return true;
                })
                .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

              return (
                <div className="p-3.5 rounded-xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] bg-[#0a0a0a]/50 dark:bg-[#161616] space-y-2 transition-all hover:border-[rgba(255,255,255,0.08)] dark:hover:border-[rgba(255,255,255,0.06)]">
                  {/* Ligne d'en-tête cliquable */}
                  <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => togglePocket("incomes")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-emerald-500" />
                      <h4 className="font-bold text-sm text-[#f5f5f5] flex items-center gap-1.5">
                        <span>Revenus perçus</span>
                        <span className="text-xs font-normal text-[#555555]">
                          ({incomes.length})
                        </span>
                      </h4>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="text-right">
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {formatEur(summary.totalIncome)}
                        </span>
                        <span className="text-xs text-[#555555]">
                          {" "}
                          / {formatEur(plannedIncome)} prévus
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePocket("incomes");
                        }}
                        className="p-1 rounded-lg text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5] hover:bg-[#1a1a1a]/60 hover:bg-[rgba(255,255,255,0.04)] transition"
                        aria-label={
                          isIncomeExpanded
                            ? "Replier les revenus"
                            : "Dérouler les revenus"
                        }
                      >
                        {isIncomeExpanded ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Barre de perception */}
                  <div className="w-full bg-[#1a1a1a] bg-[#1a1a1a]/80 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300 bg-emerald-500"
                      style={{
                        width: `${Math.min(100, percentIncomeReceived)}%`,
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#555555]">
                      {percentIncomeReceived}% perçu
                    </span>
                    <span
                      className={`font-semibold ${
                        isIncomeTargetMet
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {isIncomeTargetMet
                        ? `Objectif atteint (+${formatEur(incomeDiff)})`
                        : summary.totalIncome > 0
                          ? `Reste ${formatEur(Math.abs(incomeDiff))} à percevoir`
                          : plannedIncome > 0
                            ? `Aucun revenu perçu (${formatEur(plannedIncome)} prévus)`
                            : "Aucun revenu enregistré"}
                    </span>
                  </div>

                  {/* Contenu Déroulable : Tableau des Revenus */}
                  {isIncomeExpanded && (
                    <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] space-y-2.5 animate-fade-in">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#8a8a8a]">
                          Détail des revenus ({displayedIncomes.length})
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenIncomeModal();
                            }}
                            className="text-[#555555] hover:text-[#8a8a8a] text-[#555555] hover:text-[#f5f5f5] text-xs hover:underline"
                          >
                            Ajuster totaux
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenAddIncome();
                            }}
                            className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                          >
                            <Plus size={13} />
                            <span>Ajouter un revenu</span>
                          </button>
                        </div>
                      </div>

                      {displayedIncomes.length === 0 ? (
                        <div className="py-4 text-center text-xs text-[#555555] bg-white/50 bg-[#0a0a0a]/20 rounded-lg border border-dashed border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                          Aucun revenu enregistré pour ce mois.
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] bg-[#111111] dark:bg-[#121212]">
                          <table className="min-w-full text-xs">
                            <thead className="bg-[#0a0a0a] dark:bg-[#181818] border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#555555]">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold">
                                  Date
                                </th>
                                <th className="px-3 py-2 text-left font-semibold">
                                  Libellé
                                </th>
                                <th className="px-3 py-2 text-left font-semibold">
                                  Bénéficiaire
                                </th>
                                <th className="px-3 py-2 text-right font-semibold">
                                  Montant
                                </th>
                                <th className="px-3 py-2 text-right font-semibold">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {displayedIncomes.map((inc) => {
                                const ben =
                                  inc.beneficiaryPersonId || "person1";
                                const isP1 = ben === "person1";
                                const isShared = ben === "shared";
                                const benName = isP1
                                  ? p1Name
                                  : isShared
                                    ? "Commun / Foyer"
                                    : p2Name;
                                const benTheme = isP1
                                  ? p1Theme
                                  : isShared
                                    ? p1Theme
                                    : p2Theme;

                                return (
                                  <tr
                                    key={inc.id}
                                    className="hover:bg-[#0a0a0a]/80 dark:hover:bg-[#1e1e1e] transition-colors"
                                  >
                                    <td className="px-3 py-2 text-[#555555] whitespace-nowrap">
                                      {inc.date}
                                    </td>
                                    <td className="px-3 py-2 font-medium text-[#f5f5f5]">
                                      <div className="flex items-center gap-1.5">
                                        <span>{inc.label}</span>
                                        {inc.source === "bank_import" && (
                                          <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                            BoursoBank
                                          </span>
                                        )}
                                      </div>
                                      {inc.notes && (
                                        <div className="text-[10px] text-[#555555] truncate max-w-xs">
                                          {inc.notes}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      <span
                                        style={
                                          isShared
                                            ? undefined
                                            : benTheme.badgeStyle
                                        }
                                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                          isShared
                                            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                                            : ""
                                        }`}
                                      >
                                        {benName}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap font-bold text-emerald-600 dark:text-emerald-400">
                                      +{formatEur(inc.amount)}
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleOpenEditIncome(inc)
                                          }
                                          className="p-1 text-[#555555] hover:text-emerald-600 dark:hover:text-emerald-400 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                                          title="Modifier"
                                        >
                                          <Edit2 size={13} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteIncome(
                                              inc.id,
                                              inc.label,
                                            )
                                          }
                                          className="p-1 text-[#555555] hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                                          title="Supprimer"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* ===== SECTION 2 : DÉPENSES FIXES ===== */}
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-[rgba(255,255,255,0.06)]">
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-[#8a8a8a]">
                  2. Dépenses fixes ({summary.expenseComparisons.length} poches)
                </h4>
                <p className="text-[11px] text-[#555555]">
                  Loyer, alimentation, abonnements, charges fixes... Déduites en
                  priorité de vos revenus perçus.
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                  {formatEur(summary.totalExpenses)}
                </span>
                <span className="text-xs text-[#555555]">
                  {" "}
                  /{" "}
                  {formatEur(
                    summary.expenseComparisons.reduce(
                      (s, c) => s + c.plannedAmount,
                      0,
                    ),
                  )}{" "}
                  prévus
                </span>
              </div>
            </div>

            {summary.expenseComparisons.map((comp) => {
              const pocketExpenses = expenses
                .filter((e) => {
                  if (comp.pocketId === "unallocated") {
                    const exists = strategy.pockets.some(
                      (p) => p.id === e.pocketId,
                    );
                    if (e.pocketId && e.pocketId !== "unallocated" && exists) {
                      return false;
                    }
                  } else {
                    const pId = e.pocketId || "unallocated";
                    if (pId !== comp.pocketId) return false;
                  }
                  if (payerFilter !== "all" && e.payerPersonId !== payerFilter)
                    return false;
                  if (searchTerm.trim()) {
                    const s = searchTerm.toLowerCase();
                    const matchLabel = (e.label || "")
                      .toLowerCase()
                      .includes(s);
                    const matchNotes = (e.notes || "")
                      .toLowerCase()
                      .includes(s);
                    if (!matchLabel && !matchNotes) return false;
                  }
                  return true;
                })
                .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

              const isExpanded =
                !!expandedPockets[comp.pocketId] ||
                (searchTerm.trim().length > 0 && pocketExpenses.length > 0);

              const percentConsumed =
                comp.plannedAmount > 0
                  ? Math.round((comp.realSpent / comp.plannedAmount) * 100)
                  : comp.realSpent > 0
                    ? 100
                    : 0;

              const isOverBudget = comp.difference < 0;
              const pocketObj = strategy.pockets.find(
                (p) => p.id === comp.pocketId,
              );

              return (
                <div
                  key={comp.pocketId}
                  className="p-3.5 rounded-xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] bg-[#0a0a0a]/50 dark:bg-[#161616] space-y-2 transition-all hover:border-[rgba(255,255,255,0.08)] dark:hover:border-[rgba(255,255,255,0.06)]"
                >
                  {/* Ligne d'en-tête cliquable */}
                  <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => togglePocket(comp.pocketId)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: comp.color }}
                      />
                      <h4 className="font-bold text-sm text-[#f5f5f5] flex items-center gap-1.5">
                        <span>{comp.pocketName}</span>
                        <span className="text-xs font-normal text-[#555555]">
                          ({pocketExpenses.length})
                        </span>
                      </h4>
                      {comp.ownership && (
                        <span
                          style={
                            comp.ownership === "person1"
                              ? p1Theme.badgeStyle
                              : comp.ownership === "person2"
                                ? p2Theme.badgeStyle
                                : comp.ownership === "shared"
                                  ? p1Theme.badgeStyle
                                  : undefined
                          }
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            comp.ownership === "dossier"
                              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                              : ""
                          }`}
                        >
                          {comp.ownership === "dossier"
                            ? "Dossier"
                            : comp.ownership === "shared"
                              ? pocketObj?.splitMethod === "proportional"
                                ? "Prorata"
                                : "50/50"
                              : comp.ownership === "person1"
                                ? p1Name
                                : p2Name}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="text-right">
                        <span className="text-sm font-bold text-[#f5f5f5]">
                          {formatEur(comp.realSpent)}
                        </span>
                        <span className="text-xs text-[#555555]">
                          {" "}
                          / {formatEur(comp.plannedAmount)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePocket(comp.pocketId);
                        }}
                        className="p-1 rounded-lg text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                        aria-label={
                          isExpanded ? "Replier la poche" : "Dérouler la poche"
                        }
                      >
                        {isExpanded ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Barre de consommation du budget */}
                  <div className="w-full bg-[#1a1a1a] bg-[#1a1a1a] h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isOverBudget
                          ? "bg-rose-500"
                          : percentConsumed > 80
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                      style={{
                        width: `${Math.min(100, percentConsumed)}%`,
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#555555]">
                      {percentConsumed}% consommé
                    </span>
                    <span
                      className={`font-semibold ${
                        isOverBudget
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {isOverBudget
                        ? `Dépassement de +${formatEur(Math.abs(comp.difference))}`
                        : `Reste ${formatEur(comp.difference)} disponible`}
                    </span>
                  </div>

                  {/* Contenu Déroulable : Tableau des Dépenses de la poche */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] space-y-2.5 animate-fade-in">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#8a8a8a]">
                          Détail des dépenses ({pocketExpenses.length})
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenAddExpense(
                              comp.pocketId,
                              undefined,
                              "expense",
                            );
                          }}
                          className="flex items-center gap-1 text-[#c8a55e] text-[#c8a55e] hover:underline font-semibold"
                        >
                          <Plus size={13} />
                          <span>Ajouter une dépense</span>
                        </button>
                      </div>

                      {/* Synthèse par sous-poche si la poche en a */}
                      {pocketObj?.subItems && pocketObj.subItems.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 py-1">
                          {pocketObj.subItems.map((sub) => {
                            const subSpent = pocketExpenses
                              .filter(
                                (e) =>
                                  e.subPocketId === sub.id ||
                                  (e.subPocketName &&
                                    e.subPocketName.toLowerCase() ===
                                      sub.name.toLowerCase()),
                              )
                              .reduce((sum, e) => sum + (e.amount || 0), 0);
                            return (
                              <div
                                key={sub.id}
                                className="text-[11px] px-2 py-0.5 rounded-md bg-[#0a0a0a] dark:bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] flex items-center gap-1.5"
                              >
                                <span className="font-medium text-[#8a8a8a]">
                                  {sub.name}:
                                </span>
                                <span className="font-bold text-[#f5f5f5]">
                                  {formatEur(subSpent)}
                                </span>
                                {sub.amount > 0 && (
                                  <span className="text-[#555555]">
                                    / {formatEur(sub.amount)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {pocketExpenses.length === 0 ? (
                        <div className="py-4 text-center text-xs text-[#555555] bg-white/50 bg-[#0a0a0a]/20 rounded-lg border border-dashed border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                          Aucune dépense enregistrée dans cette poche pour ce
                          mois.
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] bg-[#111111] dark:bg-[#121212]">
                          <table className="min-w-full text-xs">
                            <thead className="bg-[#0a0a0a] dark:bg-[#181818] border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#555555]">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold">
                                  Date
                                </th>
                                <th className="px-3 py-2 text-left font-semibold">
                                  Libellé
                                </th>
                                <th className="px-3 py-2 text-left font-semibold">
                                  Payé par
                                </th>
                                <th className="px-3 py-2 text-left font-semibold">
                                  Répartition
                                </th>
                                <th className="px-3 py-2 text-right font-semibold">
                                  Montant
                                </th>
                                <th className="px-3 py-2 text-right font-semibold">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {pocketExpenses.map((exp) => {
                                const isP1 = exp.payerPersonId === "person1";
                                const payerName = isP1 ? p1Name : p2Name;
                                const payerTheme = isP1 ? p1Theme : p2Theme;

                                return (
                                  <tr
                                    key={exp.id}
                                    className="hover:bg-[#0a0a0a]/80 dark:hover:bg-[#1e1e1e] transition-colors"
                                  >
                                    <td className="px-3 py-2 text-[#555555] whitespace-nowrap">
                                      {exp.date}
                                    </td>
                                    <td className="px-3 py-2 font-medium text-[#f5f5f5]">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span>{exp.label}</span>
                                        {exp.subPocketName && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[#1a1a1a] text-[#8a8a8a] bg-[#161616] text-[#8a8a8a] border border-[rgba(255,255,255,0.06)] inline-flex items-center gap-1">
                                            ↳ {exp.subPocketName}
                                          </span>
                                        )}
                                        {exp.source === "bank_import" && (
                                          <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                                            BoursoBank
                                          </span>
                                        )}
                                      </div>
                                      {exp.notes && (
                                        <div className="text-[10px] text-[#555555] truncate max-w-xs">
                                          {exp.notes}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      <span
                                        style={payerTheme.badgeStyle}
                                        className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                      >
                                        {payerName}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      {isSoloMode ? (
                                        <span
                                          style={p1Theme.badgeStyle}
                                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                        >
                                          100% {p1Name}
                                        </span>
                                      ) : exp.splitMethod === "50_50" ? (
                                        <span
                                          style={p1Theme.badgeStyle}
                                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                        >
                                          50/50
                                        </span>
                                      ) : exp.splitMethod === "proportional" ? (
                                        <span
                                          style={p1Theme.badgeStyle}
                                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                        >
                                          Prorata
                                        </span>
                                      ) : exp.splitMethod === "100_person1" ? (
                                        <span
                                          style={p1Theme.badgeStyle}
                                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                        >
                                          100% {p1Name}
                                        </span>
                                      ) : (
                                        <span
                                          style={p2Theme.badgeStyle}
                                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                        >
                                          100% {p2Name}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap font-bold text-[#f5f5f5]">
                                      {formatEur(exp.amount)}
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleOpenEditExpense(exp)
                                          }
                                          className="p-1 text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                                          title="Modifier"
                                        >
                                          <Edit2 size={13} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteExpense(
                                              exp.id,
                                              exp.label,
                                            )
                                          }
                                          className="p-1 text-[#555555] hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                                          title="Supprimer"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ===== SECTION 3 : ÉPARGNE & AUTRES POCHES (BASÉE SUR LE RÉEL) ===== */}
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[rgba(255,255,255,0.06)]">
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-[#8a8a8a]">
                  3. Épargne, Plaisir perso & Projets (
                  {summary.placementComparisons.length} poches)
                </h4>
                <p className="text-[11px] text-[#555555]">
                  Voyage, plaisir perso, précaution, PEA...
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-indigo-600 dark:text-indigo-400">
                  Placé : {formatEur(summary.totalPlacements)}
                </span>
                <span className="text-[#555555]">•</span>
                <span className="font-medium text-[#8a8a8a]">
                  Reste libre : {formatEur(summary.unplacedSavings)}
                </span>
              </div>
            </div>

            {summary.placementComparisons.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-center text-xs text-[#555555]">
                Aucune poche d'épargne, projet ou loisir configurée dans votre
                Stratégie.
              </div>
            ) : (
              summary.placementComparisons.map((comp) => {
                const placementOps = expenses
                  .filter((e) => {
                    if (comp.pocketId === "unallocated_placement") {
                      const exists = strategy.pockets.some(
                        (p) => p.id === e.pocketId,
                      );
                      if (e.pocketId && e.pocketId !== "unallocated" && exists) {
                        return false;
                      }
                    } else {
                      const pId = e.pocketId || "unallocated";
                      if (pId !== comp.pocketId) return false;
                    }
                    if (
                      payerFilter !== "all" &&
                      e.payerPersonId !== payerFilter
                    )
                      return false;
                    if (searchTerm.trim()) {
                      const s = searchTerm.toLowerCase();
                      const matchLabel = (e.label || "")
                        .toLowerCase()
                        .includes(s);
                      const matchNotes = (e.notes || "")
                        .toLowerCase()
                        .includes(s);
                      if (!matchLabel && !matchNotes) return false;
                    }
                    return true;
                  })
                  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

                const isExpanded =
                  !!expandedPockets[comp.pocketId] ||
                  (searchTerm.trim().length > 0 && placementOps.length > 0);

                const allocatedFromReal = comp.allocatedFromReal ?? 0;
                const percentPlaced =
                  allocatedFromReal > 0
                    ? Math.round((comp.realSpent / allocatedFromReal) * 100)
                    : comp.realSpent > 0
                      ? 100
                      : 0;

                return (
                  <div
                    key={comp.pocketId}
                    className="p-3.5 rounded-xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] bg-[#0a0a0a]/50 dark:bg-[#161616] space-y-2 transition-all hover:border-[rgba(255,255,255,0.08)] dark:hover:border-[rgba(255,255,255,0.06)]"
                  >
                    {/* Ligne d'en-tête cliquable */}
                    <div
                      className="flex items-center justify-between cursor-pointer select-none"
                      onClick={() => togglePocket(comp.pocketId)}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: comp.color || "#6366f1" }}
                        />
                        <h4 className="font-bold text-sm text-[#f5f5f5] flex items-center gap-1.5">
                          <span>{comp.pocketName}</span>
                          <span className="text-xs font-normal text-[#555555]">
                            ({placementOps.length})
                          </span>
                        </h4>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                          {comp.category === "leisure"
                            ? "Plaisir perso"
                            : comp.category === "savings_goal"
                              ? "Projet"
                              : comp.category === "emergency"
                                ? "Précaution"
                                : comp.category === "investment"
                                  ? "Investissement"
                                  : "Épargne"}
                        </span>
                        {comp.splitRuleLabel && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#1a1a1a] bg-[#161616] text-[#8a8a8a]">
                            {comp.splitRuleLabel}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="text-right">
                          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                            {formatEur(comp.realSpent)}
                          </span>
                          <span className="text-xs text-[#555555]">
                            {" "}
                            / {formatEur(comp.allocatedFromReal)} allouable
                          </span>
                          {comp.plannedAmount > 0 && (
                            <span className="text-[10px] text-[#555555] block">
                              (Cible : {formatEur(comp.plannedAmount)})
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePocket(comp.pocketId);
                          }}
                          className="p-1 rounded-lg text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                          aria-label={
                            isExpanded
                              ? "Replier la poche"
                              : "Dérouler la poche"
                          }
                        >
                          {isExpanded ? (
                            <ChevronUp size={16} />
                          ) : (
                            <ChevronDown size={16} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Barre de progression du placement */}
                    <div className="w-full bg-[#1a1a1a] bg-[#1a1a1a] h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          (comp.remainingToPlace ?? 0) === 0 &&
                          (comp.allocatedFromReal ?? 0) > 0
                            ? "bg-emerald-500"
                            : "bg-indigo-500"
                        }`}
                        style={{
                          width: `${Math.min(100, percentPlaced)}%`,
                        }}
                      />
                    </div>

                    <div className="text-xs text-[#555555]">
                      {percentPlaced}% placé
                    </div>

                    {/* Détail par personne pour cette poche (si couple) */}
                    {!isSoloMode && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 pb-1">
                        {/* Personne 1 */}
                        <div className="p-2 rounded-lg bg-white/70 bg-[#0a0a0a]/30 border border-[rgba(255,255,255,0.06)]/70 border-[rgba(255,255,255,0.06)] flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="font-bold px-1.5 py-0.5 rounded text-[11px]"
                              style={p1Theme.badgeStyle}
                            >
                              {p1Name}
                            </span>
                            <div className="flex flex-col">
                              <span className="text-[#f5f5f5] font-semibold">
                                {formatEur(comp.p1Allocated || 0)}{" "}
                                <span className="text-[10px] font-normal text-[#555555]">
                                  à placer
                                </span>
                              </span>
                              <span className="text-[10px] text-[#555555]">
                                Déjà placé : {formatEur(comp.p1Placed || 0)}
                                {comp.p1Planned !== undefined &&
                                  comp.p1Planned !== comp.p1Allocated && (
                                    <span className="text-[#555555]">
                                      {" "}
                                      (Plan : {formatEur(comp.p1Planned)})
                                    </span>
                                  )}
                              </span>
                            </div>
                          </div>
                          <div>
                            {(comp.p1Remaining || 0) > 0 ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenAddExpense(
                                    comp.pocketId === "unallocated_placement"
                                      ? "unallocated"
                                      : comp.pocketId,
                                    undefined,
                                    "placement",
                                    comp.p1Remaining,
                                    "person1",
                                  );
                                }}
                                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md text-white transition hover:opacity-90 shadow-2xs"
                                style={{ backgroundColor: p1Theme.hex }}
                              >
                                <Plus size={11} />
                                <span>
                                  Reste {formatEur(comp.p1Remaining || 0)}
                                </span>
                              </button>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 px-2 py-1">
                                ✓ Placé
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Personne 2 */}
                        <div className="p-2 rounded-lg bg-white/70 bg-[#0a0a0a]/30 border border-[rgba(255,255,255,0.06)]/70 border-[rgba(255,255,255,0.06)] flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="font-bold px-1.5 py-0.5 rounded text-[11px]"
                              style={p2Theme.badgeStyle}
                            >
                              {p2Name}
                            </span>
                            <div className="flex flex-col">
                              <span className="text-[#f5f5f5] font-semibold">
                                {formatEur(comp.p2Allocated || 0)}{" "}
                                <span className="text-[10px] font-normal text-[#555555]">
                                  à placer
                                </span>
                              </span>
                              <span className="text-[10px] text-[#555555]">
                                Déjà placé : {formatEur(comp.p2Placed || 0)}
                                {comp.p2Planned !== undefined &&
                                  comp.p2Planned !== comp.p2Allocated && (
                                    <span className="text-[#555555]">
                                      {" "}
                                      (Plan : {formatEur(comp.p2Planned)})
                                    </span>
                                  )}
                              </span>
                            </div>
                          </div>
                          <div>
                            {(comp.p2Remaining || 0) > 0 ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenAddExpense(
                                    comp.pocketId === "unallocated_placement"
                                      ? "unallocated"
                                      : comp.pocketId,
                                    undefined,
                                    "placement",
                                    comp.p2Remaining,
                                    "person2",
                                  );
                                }}
                                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md text-white transition hover:opacity-90 shadow-2xs"
                                style={{ backgroundColor: p2Theme.hex }}
                              >
                                <Plus size={11} />
                                <span>
                                  Reste {formatEur(comp.p2Remaining || 0)}
                                </span>
                              </button>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 px-2 py-1">
                                ✓ Placé
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Contenu Déroulable : Tableau des Placements de la poche */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] space-y-2.5 animate-fade-in">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#8a8a8a]">
                            Détail des placements & virements (
                            {placementOps.length})
                          </span>
                          <div className="flex items-center gap-2">
                            {!isSoloMode && (comp.p1Remaining || 0) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenAddExpense(
                                    comp.pocketId === "unallocated_placement"
                                      ? "unallocated"
                                      : comp.pocketId,
                                    undefined,
                                    "placement",
                                    comp.p1Remaining,
                                    "person1",
                                  );
                                }}
                                className="flex items-center gap-1 text-xs font-semibold hover:underline"
                                style={{ color: p1Theme.hex }}
                              >
                                <Plus size={12} />
                                <span>+ {p1Name}</span>
                              </button>
                            )}
                            {!isSoloMode && (comp.p2Remaining || 0) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenAddExpense(
                                    comp.pocketId === "unallocated_placement"
                                      ? "unallocated"
                                      : comp.pocketId,
                                    undefined,
                                    "placement",
                                    comp.p2Remaining,
                                    "person2",
                                  );
                                }}
                                className="flex items-center gap-1 text-xs font-semibold hover:underline"
                                style={{ color: p2Theme.hex }}
                              >
                                <Plus size={12} />
                                <span>+ {p2Name}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenAddExpense(
                                  comp.pocketId === "unallocated_placement"
                                    ? "unallocated"
                                    : comp.pocketId,
                                  undefined,
                                  "placement",
                                  (comp.remainingToPlace ?? 0) > 0
                                    ? comp.remainingToPlace
                                    : undefined,
                                );
                              }}
                              className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
                            >
                              <Plus size={13} />
                              <span>Ajouter un placement</span>
                            </button>
                          </div>
                        </div>

                        {placementOps.length === 0 ? (
                          <div className="py-4 text-center text-xs text-[#555555] bg-white/50 bg-[#0a0a0a]/20 rounded-lg border border-dashed border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                            Aucun virement ou placement enregistré dans cette
                            poche pour ce mois.
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] bg-[#111111] dark:bg-[#121212]">
                            <table className="min-w-full text-xs">
                              <thead className="bg-[#0a0a0a] dark:bg-[#181818] border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#555555]">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold">
                                    Date
                                  </th>
                                  <th className="px-3 py-2 text-left font-semibold">
                                    Libellé
                                  </th>
                                  <th className="px-3 py-2 text-left font-semibold">
                                    Payé par
                                  </th>
                                  <th className="px-3 py-2 text-left font-semibold">
                                    Répartition
                                  </th>
                                  <th className="px-3 py-2 text-right font-semibold">
                                    Montant
                                  </th>
                                  <th className="px-3 py-2 text-right font-semibold">
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {placementOps.map((exp) => {
                                  const isP1 = exp.payerPersonId === "person1";
                                  const payerName = isP1 ? p1Name : p2Name;
                                  const payerTheme = isP1 ? p1Theme : p2Theme;

                                  return (
                                    <tr
                                      key={exp.id}
                                      className="hover:bg-[#0a0a0a]/80 dark:hover:bg-[#1e1e1e] transition-colors"
                                    >
                                      <td className="px-3 py-2 text-[#555555] whitespace-nowrap">
                                        {exp.date}
                                      </td>
                                      <td className="px-3 py-2 font-medium text-[#f5f5f5]">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span>{exp.label}</span>
                                          <span className="text-[9px] px-1.5 py-0.2 rounded font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                            {comp.category === "leisure"
                                              ? "Loisir"
                                              : comp.category === "savings_goal"
                                                ? "Projet"
                                                : comp.category === "emergency"
                                                  ? "Précaution"
                                                  : comp.category ===
                                                      "investment"
                                                    ? "Investissement"
                                                    : "Épargne"}
                                          </span>
                                          {exp.source === "bank_import" && (
                                            <span className="text-[9px] px-1 py-0.2 rounded font-medium bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                                              BoursoBank
                                            </span>
                                          )}
                                        </div>
                                        {exp.notes && (
                                          <div className="text-[10px] text-[#555555] truncate max-w-xs">
                                            {exp.notes}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <span
                                          style={payerTheme.badgeStyle}
                                          className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                        >
                                          {payerName}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {isSoloMode ? (
                                          <span
                                            style={p1Theme.badgeStyle}
                                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                          >
                                            100% {p1Name}
                                          </span>
                                        ) : exp.splitMethod === "50_50" ? (
                                          <span
                                            style={p1Theme.badgeStyle}
                                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                          >
                                            50/50
                                          </span>
                                        ) : exp.splitMethod ===
                                          "proportional" ? (
                                          <span
                                            style={p1Theme.badgeStyle}
                                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                          >
                                            Prorata
                                          </span>
                                        ) : exp.splitMethod ===
                                          "100_person1" ? (
                                          <span
                                            style={p1Theme.badgeStyle}
                                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                          >
                                            100% {p1Name}
                                          </span>
                                        ) : (
                                          <span
                                            style={p2Theme.badgeStyle}
                                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                          >
                                            100% {p2Name}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right whitespace-nowrap font-bold text-indigo-600 dark:text-indigo-400">
                                        {formatEur(exp.amount)}
                                      </td>
                                      <td className="px-3 py-2 text-right whitespace-nowrap">
                                        <div className="flex items-center justify-end gap-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenEditExpense(exp)
                                            }
                                            className="p-1 text-[#555555] hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                                            title="Modifier"
                                          >
                                            <Edit2 size={13} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDeleteExpense(
                                                exp.id,
                                                exp.label,
                                              )
                                            }
                                            className="p-1 text-[#555555] hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] transition"
                                            title="Supprimer"
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* MODALE : AJOUTER / MODIFIER UNE DÉPENSE */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#111111] dark:bg-[#1a1a1a] rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] pb-3">
              <h3 className="text-lg font-bold text-[#f5f5f5] flex items-center gap-2">
                {editingExpense
                  ? formNature === "placement"
                    ? "Modifier le placement"
                    : "Modifier la dépense"
                  : formNature === "placement"
                    ? "Nouveau placement / virement"
                    : "Nouvelle dépense"}
              </h3>
              <button
                type="button"
                onClick={() => setIsExpenseModalOpen(false)}
                className="text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Toggle Dépense de vie vs Placement / Épargne */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-[#1a1a1a] bg-[#161616]">
              <button
                type="button"
                onClick={() => setFormNature("expense")}
                className={`py-1.5 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  formNature === "expense"
                    ? "bg-[#111111] text-rose-600 dark:text-rose-400 shadow-xs"
                    : "text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                }`}
              >
                <span>Dépense de vie</span>
              </button>
              <button
                type="button"
                onClick={() => setFormNature("placement")}
                className={`py-1.5 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 ${
                  formNature === "placement"
                    ? "bg-[#111111] text-indigo-600 dark:text-indigo-400 shadow-xs"
                    : "text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                }`}
              >
                <span>Placement / Épargne</span>
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="space-y-4 text-xs">
              {/* Date & Montant */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="input-field w-full py-2"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Montant (€) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="Ex: 45.50"
                    value={formAmount}
                    onChange={(e) =>
                      setFormAmount(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    className="input-field w-full py-2 font-bold"
                  />
                </div>
              </div>

              {/* Libellé */}
              <div>
                <label className="block font-bold text-[#8a8a8a] mb-1">
                  Libellé / Fournisseur *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Courses Carrefour, Loyer, Restaurant..."
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  className="input-field w-full py-2"
                />
              </div>

              {/* Qui a payé */}
              {!isSoloMode && (
                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Payé par *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormPayer("person1")}
                      style={
                        formPayer === "person1" ? p1Theme.cardStyle : undefined
                      }
                      className={`p-2.5 rounded-xl border text-center font-bold transition flex items-center justify-center gap-2 ${
                        formPayer === "person1"
                          ? "border-current"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={p1Theme.dotStyle}
                      />
                      <span
                        style={
                          formPayer === "person1"
                            ? p1Theme.textStyle
                            : undefined
                        }
                      >
                        {p1Name}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormPayer("person2")}
                      style={
                        formPayer === "person2" ? p2Theme.cardStyle : undefined
                      }
                      className={`p-2.5 rounded-xl border text-center font-bold transition flex items-center justify-center gap-2 ${
                        formPayer === "person2"
                          ? "border-current"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={p2Theme.dotStyle}
                      />
                      <span
                        style={
                          formPayer === "person2"
                            ? p2Theme.textStyle
                            : undefined
                        }
                      >
                        {p2Name}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Poche de Stratégie associée */}
              <div>
                <label className="block font-bold text-[#8a8a8a] mb-1">
                  Associer à une Poche de la Stratégie
                </label>
                <select
                  value={formPocketId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setFormPocketId(pid);
                    setFormSubPocketId("");
                    setFormSubPocketName("");
                    const found = strategy.pockets.find((p) => p.id === pid);
                    if (found) {
                      setFormNature(
                        isPlacementPocket(found) ? "placement" : "expense",
                      );
                      if (isSoloMode) {
                        setFormPayer("person1");
                        setFormSplitMethod("100_person1");
                      } else if (found.ownership === "person1") {
                        setFormPayer("person1");
                        setFormSplitMethod("100_person1");
                      } else if (found.ownership === "person2") {
                        setFormPayer("person2");
                        setFormSplitMethod("100_person2");
                      } else if (found.splitMethod) {
                        setFormSplitMethod(
                          found.splitMethod === "50_50"
                            ? "50_50"
                            : "proportional",
                        );
                      } else {
                        setFormSplitMethod("50_50");
                      }
                    } else {
                      if (!isSoloMode) setFormSplitMethod("50_50");
                    }
                  }}
                  className="input-field w-full py-2"
                >
                  <option value="unallocated">Autres / Non classé</option>
                  {strategy.pockets.filter((p) => !isPlacementPocket(p))
                    .length > 0 && (
                    <optgroup label="Dépenses de vie courante & charges">
                      {strategy.pockets
                        .filter((p) => !isPlacementPocket(p))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.allocationValue}{" "}
                            {p.allocationType === "percent" ? "%" : "€"})
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {strategy.pockets.filter((p) => isPlacementPocket(p)).length >
                    0 && (
                    <optgroup label="Épargne & Placements / Investissements">
                      {strategy.pockets
                        .filter((p) => isPlacementPocket(p))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.allocationValue}{" "}
                            {p.allocationType === "percent" ? "%" : "€"})
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Sous-poche associée (si la poche en possède) */}
              {(() => {
                const curPocket = strategy.pockets.find(
                  (p) => p.id === formPocketId,
                );
                if (
                  !curPocket ||
                  !curPocket.subItems ||
                  curPocket.subItems.length === 0
                )
                  return null;
                return (
                  <div>
                    <label className="block font-bold text-[#8a8a8a] mb-1">
                      Sous-poche de "{curPocket.name}" (Optionnel)
                    </label>
                    <select
                      value={formSubPocketId}
                      onChange={(e) => {
                        const subId = e.target.value;
                        setFormSubPocketId(subId);
                        const subItem = curPocket.subItems?.find(
                          (s) => s.id === subId,
                        );
                        setFormSubPocketName(subItem ? subItem.name : "");
                        if (isSoloMode) {
                          setFormSplitMethod("100_person1");
                        } else if (subItem?.personId === "person1") {
                          setFormSplitMethod("100_person1");
                          setFormPayer("person1");
                        } else if (subItem?.personId === "person2") {
                          setFormSplitMethod("100_person2");
                          setFormPayer("person2");
                        } else if (curPocket.ownership === "person1") {
                          setFormSplitMethod("100_person1");
                          setFormPayer("person1");
                        } else if (curPocket.ownership === "person2") {
                          setFormSplitMethod("100_person2");
                          setFormPayer("person2");
                        } else if (curPocket.splitMethod === "proportional") {
                          setFormSplitMethod("proportional");
                        } else {
                          setFormSplitMethod("50_50");
                        }
                      }}
                      className="input-field w-full py-2"
                    >
                      <option value="">
                        -- Aucune sous-poche (Dépense globale) --
                      </option>
                      {curPocket.subItems.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name}{" "}
                          {sub.amount > 0 ? `(${formatEur(sub.amount)}/m)` : ""}
                          {sub.personId === "person1"
                            ? ` · ${p1Name}`
                            : sub.personId === "person2"
                              ? ` · ${p2Name}`
                              : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}

              {/* Mode de Répartition Tricount */}
              <div>
                <label className="block font-bold text-[#8a8a8a] mb-1">
                  Répartition de la dépense *
                </label>
                {!isSoloMode ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFormSplitMethod("50_50")}
                      className={`p-2 rounded-lg border text-center font-bold transition ${
                        formSplitMethod === "50_50"
                          ? "bg-[#c8a55e] text-white border-primary-600"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      50 / 50
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormSplitMethod("proportional")}
                      className={`p-2 rounded-lg border text-center font-bold transition ${
                        formSplitMethod === "proportional"
                          ? "bg-[#c8a55e] text-white border-primary-600"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      Prorata ({p1Ratio}% / {p2Ratio}%)
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormSplitMethod("100_person1")}
                      className={`p-2 rounded-lg border text-center font-bold transition ${
                        formSplitMethod === "100_person1"
                          ? "bg-[#c8a55e] text-white border-primary-600"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      100% {p1Name}
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormSplitMethod("100_person2")}
                      className={`p-2 rounded-lg border text-center font-bold transition ${
                        formSplitMethod === "100_person2"
                          ? "bg-[#c8a55e] text-white border-primary-600"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      100% {p2Name}
                    </button>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-[#0a0a0a] dark:bg-[#222222] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a] font-medium">
                    Mode Solo : dépense 100% allouée à {p1Name}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block font-bold text-[#8a8a8a] mb-1">
                  Notes / Détails (optionnel)
                </label>
                <input
                  type="text"
                  placeholder="Commentaire ou précision..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="input-field w-full py-1.5"
                />
              </div>

              {/* Boutons d'action */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="btn-secondary py-2"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className={`btn-primary py-2 px-5 font-bold ${
                    formNature === "placement"
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                      : ""
                  }`}
                >
                  {editingExpense
                    ? "Enregistrer"
                    : formNature === "placement"
                      ? "Confirmer le placement"
                      : "Ajouter la dépense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE : AJOUTER / MODIFIER UN REVENU DÉTAILLÉ */}
      {isIncomeItemModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111111] dark:bg-[#1a1a1a] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] space-y-4 animate-scale-up text-xs">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] pb-3">
              <h3 className="text-base font-bold text-[#f5f5f5] flex items-center gap-2">
                <DollarSign className="text-emerald-500" size={18} />
                {editingIncome ? "Modifier le revenu" : "Nouveau revenu"}
              </h3>
              <button
                type="button"
                onClick={() => setIsIncomeItemModalOpen(false)}
                className="text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveIncomeItem} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Date de perception *
                  </label>
                  <input
                    type="date"
                    required
                    value={incomeFormDate}
                    onChange={(e) => setIncomeFormDate(e.target.value)}
                    className="input-field w-full py-1.5"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Montant net perçu (€) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="Ex: 2400.00"
                    value={incomeFormAmount}
                    onChange={(e) =>
                      setIncomeFormAmount(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    className="input-field w-full py-1.5 font-bold text-emerald-600 dark:text-emerald-400"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#8a8a8a] mb-1">
                  Libellé du revenu *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Salaire, Prime, Vente, Remboursement..."
                  value={incomeFormLabel}
                  onChange={(e) => setIncomeFormLabel(e.target.value)}
                  className="input-field w-full py-1.5"
                />
              </div>

              {!isSoloMode ? (
                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1">
                    Bénéficiaire du revenu *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setIncomeFormBeneficiary("person1")}
                      className={`p-2 rounded-xl border text-center font-bold transition ${
                        incomeFormBeneficiary === "person1"
                          ? "bg-primary-50 text-[#c8a55e] border-[#c8a55e] dark:bg-primary-950/40 text-[#c8a55e]"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      {p1Name}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIncomeFormBeneficiary("person2")}
                      className={`p-2 rounded-xl border text-center font-bold transition ${
                        incomeFormBeneficiary === "person2"
                          ? "bg-primary-50 text-[#c8a55e] border-[#c8a55e] dark:bg-primary-950/40 text-[#c8a55e]"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      {p2Name}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIncomeFormBeneficiary("shared")}
                      className={`p-2 rounded-xl border text-center font-bold transition ${
                        incomeFormBeneficiary === "shared"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                    >
                      Commun (50/50)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-[#0a0a0a] dark:bg-[#222222] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] text-xs text-[#8a8a8a] font-medium">
                  Mode Solo : revenu 100% alloué à {p1Name}
                </div>
              )}

              <div>
                <label className="block font-bold text-[#8a8a8a] mb-1">
                  Notes / Détails (optionnel)
                </label>
                <input
                  type="text"
                  placeholder="Commentaire ou précision..."
                  value={incomeFormNotes}
                  onChange={(e) => setIncomeFormNotes(e.target.value)}
                  className="input-field w-full py-1.5"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                <button
                  type="button"
                  onClick={() => setIsIncomeItemModalOpen(false)}
                  className="btn-secondary py-1.5"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn-primary py-1.5 px-4 font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {editingIncome ? "Enregistrer" : "Ajouter le revenu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE : AJUSTER LES REVENUS RÉELS DU MOIS */}
      {isIncomeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111111] dark:bg-[#1a1a1a] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] pb-3">
              <h3 className="text-base font-bold text-[#f5f5f5] flex items-center gap-2">
                <DollarSign className="text-emerald-500" size={18} />
                Revenus Réels de {formatMonthLabel(selectedMonth)}
              </h3>
              <button
                type="button"
                onClick={() => setIsIncomeModalOpen(false)}
                className="text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveIncomes} className="space-y-4 text-xs">
              <p className="text-[#555555]">
                Indiquez les revenus nets réellement perçus pour ce mois
                (salaires, primes, dividendes...) pour calculer le vrai taux
                d'épargne.
              </p>

              <div>
                <label className="block font-bold text-[#8a8a8a] mb-1 flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={p1Theme.dotStyle}
                  />
                  Revenu net réel de {p1Name} (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formP1Income}
                  onChange={(e) =>
                    setFormP1Income(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  className="input-field w-full py-2 font-bold"
                />
              </div>

              {!isSoloMode && (
                <div>
                  <label className="block font-bold text-[#8a8a8a] mb-1 flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={p2Theme.dotStyle}
                    />
                    Revenu net réel de {p2Name} (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formP2Income}
                    onChange={(e) =>
                      setFormP2Income(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    className="input-field w-full py-2 font-bold"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)]">
                <button
                  type="button"
                  onClick={() => setIsIncomeModalOpen(false)}
                  className="btn-secondary py-2"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn-primary py-2 px-5 font-bold"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale de la Stratégie d'épargne mensuelle */}
      <MonthlyStrategyModal
        isOpen={isStrategyModalOpen}
        onClose={() => setIsStrategyModalOpen(false)}
        monthKey={selectedMonth}
        onStrategySaved={(updatedStrat) => {
          setStrategy(updatedStrat);
          loadData();
        }}
      />
    </div>
  );
};

export default BudgetTricount;
