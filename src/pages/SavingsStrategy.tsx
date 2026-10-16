import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  TrendingUp,
  CheckCircle2,
  Calendar,
  Info,
  ShieldCheck,
  Building,
  Heart,
  Coffee,
  Users,
  User,
  ChevronDown,
  ChevronUp,
  Scale,
  Split,
  Layers,
  Folder,
  Sliders,
  RotateCcw,
  Save,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  PieChart as RePieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useUser } from "../contexts/UserContext";
import {
  IncomeSource,
  PocketCategory,
  PocketSubItem,
  SavingsPocket,
  SavingsStrategy,
  HouseholdConfig,
  PocketOwnership,
  SplitMode,
  PersonId,
} from "../types";
import {
  getSavingsStrategyForMonth,
  saveSavingsStrategyForMonth,
  hasCustomStrategyForMonth,
  getSourceStrategyMonthFor,
  copySavingsStrategyFromMonth,
  getAllConfiguredStrategyMonths,
  getPocketMonthlyAmount,
  getPocketPercent,
  calculateHouseholdSummary,
  calculateSavingsProjection,
  DEFAULT_SAVINGS_STRATEGY,
  DEFAULT_HOUSEHOLD_CONFIG,
} from "../utils/savingsStorage";
import {
  formatMonthLabel,
  getCurrentMonthKey,
  getAvailableMonths,
  applyStrategyToMonth,
} from "../utils/tricountStorage";
import {
  getPersonTheme,
  getUserAccentColor,
  getAccentColorDef,
} from "../utils/theme";

const COLOR_PALETTE = [
  "#6366f1", // Indigo
  "#10b981", // Emerald
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#06b6d4", // Cyan
  "#8b5cf6", // Purple
  "#3b82f6", // Blue
  "#14b8a6", // Teal
  "#f43f5e", // Rose
  "#eab308", // Yellow
];

const CATEGORY_META: Record<
  PocketCategory,
  {
    label: string;
    icon: LucideIcon;
    desc: string;
  }
> = {
  fixed_expense: {
    label: "Dépense fixe",
    icon: Building,
    desc: "Loyer, abonnements, assurances, charges incompressibles",
  },
  savings_goal: {
    label: "Projet / Épargne",
    icon: Heart,
    desc: "Mariage, voyage, achat auto, équipement",
  },
  investment: {
    label: "Investissement",
    icon: TrendingUp,
    desc: "PEA, ETF, actions, crypto, SCPI à long terme",
  },
  emergency: {
    label: "Précaution",
    icon: ShieldCheck,
    desc: "Fonds de secours disponible immédiatement",
  },
  leisure: {
    label: "Plaisir / Loisir",
    icon: Coffee,
    desc: "Sorties, restaurants, shopping, vacances",
  },
};

const HORIZON_OPTIONS = [
  { label: "1 an", value: 1 },
  { label: "2 ans", value: 2 },
  { label: "3 ans", value: 3 },
  { label: "5 ans", value: 5 },
  { label: "10 ans", value: 10 },
  { label: "20 ans", value: 20 },
];

const formatEur = (val: number, decimals: number = 2) => {
  const normalized = Math.abs(val) < 0.005 ? 0 : val;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(normalized);
};

export interface SavingsStrategyPageProps {
  monthKey?: string;
  onMonthChange?: (month: string) => void;
  showProjections?: boolean;
  onStrategySaved?: (strategy: SavingsStrategy) => void;
}

const SavingsStrategyPage: React.FC<SavingsStrategyPageProps> = ({
  monthKey: propMonthKey,
  onMonthChange,
  showProjections = false,
  onStrategySaved,
}) => {
  const { currentUser, availableUsers } = useUser();
  const [activeMonth, setActiveMonth] = useState<string>(
    () => propMonthKey || getCurrentMonthKey(),
  );

  useEffect(() => {
    if (propMonthKey && propMonthKey !== activeMonth) {
      setActiveMonth(propMonthKey);
    }
  }, [propMonthKey]);

  const [strategy, setStrategy] = useState<SavingsStrategy>(() =>
    getSavingsStrategyForMonth(propMonthKey || getCurrentMonthKey(), currentUser),
  );

  // Synchroniser la stratégie lors d'un changement d'utilisateur actif ou de mois actif
  useEffect(() => {
    const updateStrategy = () => {
      setStrategy(getSavingsStrategyForMonth(activeMonth, currentUser));
    };
    updateStrategy();
    window.addEventListener("savings_strategy_updated", updateStrategy);
    return () => {
      window.removeEventListener("savings_strategy_updated", updateStrategy);
    };
  }, [currentUser, activeMonth]);

  // Écouter les mises à jour des réglages/couleurs utilisateurs
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => {
    const handler = () => setThemeVersion((v) => v + 1);
    window.addEventListener("userSettingsUpdated", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("userSettingsUpdated", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const [selectedHorizon, setSelectedHorizon] = useState<number>(
    () => strategy.horizonYears || 5,
  );

  // View filter: all (household) | person1 | person2
  const [viewFilter, setViewFilter] = useState<"all" | "person1" | "person2">(
    "all",
  );

  // Partenaires disponibles depuis les profils de l'outil (tous les profils sauf l'utilisateur actif)
  const availablePartners = useMemo(() => {
    const active = (currentUser || "Romain").trim().toLowerCase();
    return availableUsers.filter((u) => u.trim().toLowerCase() !== active);
  }, [availableUsers, currentUser]);

  // Basculer en temps réel entre Mode Solo et Mode Couple
  const toggleHouseholdMode = (enabled: boolean) => {
    if (enabled && availableUsers.length < 2) return;
    const p1Name = currentUser || "Romain";
    const partnerName =
      availablePartners[0] ||
      availableUsers.find((u) => u.toLowerCase() !== p1Name.toLowerCase()) ||
      "Sophie";
    const p1ColorHex = getAccentColorDef(getUserAccentColor(p1Name)).hex;
    const p2ColorHex = getAccentColorDef(getUserAccentColor(partnerName)).hex;

    const updatedHousehold: HouseholdConfig = {
      ...(strategy.household || DEFAULT_HOUSEHOLD_CONFIG),
      enabled,
      person1: {
        id: "person1",
        name: p1Name,
        color: p1ColorHex,
      },
      person2: {
        id: "person2",
        name: partnerName,
        color: p2ColorHex,
      },
    };

    updateStrategy({
      ...strategy,
      household: updatedHousehold,
    });

    if (!enabled) {
      setViewFilter("person1");
    } else {
      setViewFilter("all");
    }
  };

  // Adaptation automatique en temps réel si le nombre d'utilisateurs passe à 1
  useEffect(() => {
    if (availableUsers.length < 2 && strategy.household?.enabled) {
      toggleHouseholdMode(false);
    }
  }, [availableUsers.length]);

  // Dropdown du sélecteur Mode Solo / Mode Couple
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modeMenuRef.current &&
        !modeMenuRef.current.contains(event.target as Node)
      ) {
        setIsModeMenuOpen(false);
      }
    };
    if (isModeMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isModeMenuOpen]);

  // Income form state
  const [isAddingIncome, setIsAddingIncome] = useState(false);
  const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null);
  const [incomeName, setIncomeName] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeFreq, setIncomeFreq] = useState<"monthly" | "yearly">("monthly");
  const [incomePersonId, setIncomePersonId] = useState<PersonId>("person1");

  // Pocket form state
  const [isAddingPocket, setIsAddingPocket] = useState(false);
  const [editingPocketId, setEditingPocketId] = useState<string | null>(null);
  const [pocketName, setPocketName] = useState("");
  const [pocketCategory, setPocketCategory] =
    useState<PocketCategory>("savings_goal");
  const [pocketOwnership, setPocketOwnership] =
    useState<PocketOwnership>("shared");
  const [pocketSplitMethod, setPocketSplitMethod] =
    useState<SplitMode>("proportional");
  const [pocketAllocType, setPocketAllocType] = useState<"percent" | "fixed">(
    "percent",
  );
  const [pocketAllocVal, setPocketAllocVal] = useState("");
  const [pocketCurrent, setPocketCurrent] = useState("");
  const [pocketTarget, setPocketTarget] = useState("");
  const [pocketReturnRate, setPocketReturnRate] = useState("");
  const [pocketColor, setPocketColor] = useState(COLOR_PALETTE[0]);
  const [pocketNotes, setPocketNotes] = useState("");

  // Sub-items editor inside pocket form
  const [pocketSubItems, setPocketSubItems] = useState<PocketSubItem[]>([]);
  const [newSubName, setNewSubName] = useState("");
  const [newSubAmount, setNewSubAmount] = useState("");
  const [newSubCurrent, setNewSubCurrent] = useState("");
  const [newSubTarget, setNewSubTarget] = useState("");
  const [newSubReturnRate, setNewSubReturnRate] = useState("");
  const [newSubPersonId, setNewSubPersonId] = useState<
    "person1" | "person2" | "shared"
  >("person1");

  // Inline sub-item editing state
  const [editingSubItemId, setEditingSubItemId] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState("");
  const [editSubAmount, setEditSubAmount] = useState("");
  const [editSubCurrent, setEditSubCurrent] = useState("");
  const [editSubTarget, setEditSubTarget] = useState("");
  const [editSubReturnRate, setEditSubReturnRate] = useState("");
  const [editSubPersonId, setEditSubPersonId] = useState<
    "person1" | "person2" | "shared"
  >("person1");

  // Grouped dossier state (individual accounts like PEA grouped together)
  const [pocketPerson1Amount, setPocketPerson1Amount] = useState("");
  const [pocketPerson2Amount, setPocketPerson2Amount] = useState("");
  const [pocketPerson1Current, setPocketPerson1Current] = useState("");
  const [pocketPerson2Current, setPocketPerson2Current] = useState("");
  const [pocketPerson1Target, setPocketPerson1Target] = useState("");
  const [pocketPerson2Target, setPocketPerson2Target] = useState("");

  // Accordion expanded state for pocket cards
  const [expandedPockets, setExpandedPockets] = useState<
    Record<string, boolean>
  >({});
  const toggleExpandPocket = (id: string) =>
    setExpandedPockets((prev) => ({ ...prev, [id]: !prev[id] }));

  // Toast / notification
  const [showSavedToast, setShowSavedToast] = useState(false);

  // Save changes automatically when strategy updates
  const updateStrategy = (newStrategy: SavingsStrategy) => {
    setStrategy(newStrategy);
    saveSavingsStrategyForMonth(activeMonth, newStrategy, currentUser);
    try {
      applyStrategyToMonth(activeMonth, newStrategy);
    } catch (e) {
      console.error("Erreur sync tricount:", e);
    }
    onStrategySaved?.(newStrategy);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2000);
  };

  // Liste des mois disponibles pour la copie rapide
  const [selectedSourceMonth, setSelectedSourceMonth] = useState<string>("");
  const availableMonthsList = useMemo(() => {
    const list = getAvailableMonths();
    const configured = getAllConfiguredStrategyMonths();
    const set = new Set<string>([...list, ...configured, activeMonth]);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonth]);

  // Onglets des mois — même logique que Budget : un mois apparaît dès qu'il a des dépenses/revenus
  const monthTabs = useMemo(() => {
    const set = new Set<string>([...getAvailableMonths(), activeMonth]);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [activeMonth]);

  // Sélection d'un mois : met à jour la stratégie affichée et l'URL
  const handleSelectMonth = (month: string) => {
    if (month === activeMonth) return;
    setActiveMonth(month);
    onMonthChange?.(month);
  };

  // Garder l'onglet du mois actif visible dans la barre d'onglets
  const activeMonthTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeMonthTabRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
    });
  }, [activeMonth]);

  const handleApplyStrategyFromOtherMonth = (sourceMonth: string) => {
    if (!sourceMonth || sourceMonth === activeMonth) return;
    if (
      window.confirm(
        `Voulez-vous copier et appliquer la stratégie de ${formatMonthLabel(
          sourceMonth,
        )} sur le mois de ${formatMonthLabel(activeMonth)} ?`,
      )
    ) {
      const copied = copySavingsStrategyFromMonth(
        sourceMonth,
        activeMonth,
        currentUser,
      );
      setStrategy(copied);
      try {
        applyStrategyToMonth(activeMonth, copied);
      } catch (e) {
        console.error("Erreur sync tricount:", e);
      }
      onStrategySaved?.(copied);
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 2000);
    }
  };

  // Household summary & calculations
  const householdSummary = useMemo(
    () => calculateHouseholdSummary(strategy),
    [strategy],
  );
  const household = strategy.household || DEFAULT_HOUSEHOLD_CONFIG;
  const p1 = householdSummary.p1;
  const p2 = householdSummary.p2;

  // Thèmes et couleurs dynamiques de Personne 1 et Personne 2
  const p1Color = getUserAccentColor(p1.name);
  const p2Color = getUserAccentColor(p2.name);
  const p1Theme = useMemo(
    () => getPersonTheme(p1Color, p1.name),
    [p1Color, p1.name, themeVersion],
  );
  const p2Theme = useMemo(
    () => getPersonTheme(p2Color, p2.name),
    [p2Color, p2.name, themeVersion],
  );

  const totalMonthlyIncome = householdSummary.totalMonthlyIncome;
  const totalYearlyIncome = totalMonthlyIncome * 12;

  // Donut chart data
  const pieData = useMemo(() => {
    const data = strategy.pockets.map((p) => {
      const amt = getPocketMonthlyAmount(p, totalMonthlyIncome);
      const pct = getPocketPercent(p, totalMonthlyIncome);
      return {
        id: p.id,
        name: p.name,
        value: Math.round((amt + Number.EPSILON) * 100) / 100,
        pct: pct,
        color: p.color,
      };
    });

    if (householdSummary.totalRemainingEur > 0.005) {
      data.push({
        id: "remaining",
        name: "Reste à vivre / Libre",
        value:
          Math.round(
            (householdSummary.totalRemainingEur + Number.EPSILON) * 100,
          ) / 100,
        pct: householdSummary.remainingPercent,
        color: "#94a3b8", // Slate
      });
    }

    return data;
  }, [
    strategy.pockets,
    totalMonthlyIncome,
    householdSummary.totalRemainingEur,
    householdSummary.remainingPercent,
  ]);

  // Projected savings calculation based on current horizon
  const projection = useMemo(() => {
    return calculateSavingsProjection(strategy, selectedHorizon);
  }, [strategy, selectedHorizon]);

  // Quick preset horizons

  // Handle Incomes
  const handleSaveIncome = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(incomeAmount.replace(",", "."));
    if (!incomeName.trim() || isNaN(amountNum) || amountNum <= 0) return;

    if (editingIncomeId) {
      const updatedIncomes = strategy.incomes.map((inc) =>
        inc.id === editingIncomeId
          ? {
              ...inc,
              name: incomeName.trim(),
              amount: amountNum,
              frequency: incomeFreq,
              personId: incomePersonId,
            }
          : inc,
      );
      updateStrategy({
        ...strategy,
        incomes: updatedIncomes,
      });
    } else {
      const newIncome: IncomeSource = {
        id: "inc-" + Date.now(),
        name: incomeName.trim(),
        amount: amountNum,
        frequency: incomeFreq,
        personId: incomePersonId,
      };

      updateStrategy({
        ...strategy,
        incomes: [...strategy.incomes, newIncome],
      });
    }

    handleCancelIncomeForm();
  };

  const handleOpenEditIncome = (inc: IncomeSource) => {
    setEditingIncomeId(inc.id);
    setIncomeName(inc.name);
    setIncomeAmount(inc.amount.toString());
    setIncomeFreq(inc.frequency);
    setIncomePersonId(inc.personId || "person1");
    setIsAddingIncome(true);
  };

  const handleCancelIncomeForm = () => {
    setEditingIncomeId(null);
    setIncomeName("");
    setIncomeAmount("");
    setIncomeFreq("monthly");
    setIncomePersonId("person1");
    setIsAddingIncome(false);
  };

  const handleDeleteIncome = (id: string) => {
    if (editingIncomeId === id) {
      handleCancelIncomeForm();
    }
    updateStrategy({
      ...strategy,
      incomes: strategy.incomes.filter((i) => i.id !== id),
    });
  };

  // Manual explicit save button handler
  const handleManualSave = () => {
    saveSavingsStrategyForMonth(activeMonth, strategy, currentUser);
    try {
      applyStrategyToMonth(activeMonth, strategy);
    } catch (e) {
      console.error("Erreur synchronisation tricount:", e);
    }
    onStrategySaved?.(strategy);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2500);
  };

  // Synchronisation automatique des sous-postes d'un dossier avec la formule (50/50 ou Prorata)
  const syncSubItemsToDossierSplit = (
    method: SplitMode,
    allocType: "percent" | "fixed",
    allocVal: string,
    currentSubs: PocketSubItem[],
  ): PocketSubItem[] => {
    if (method === "custom" || currentSubs.length === 0) return currentSubs;

    const allocNum = parseFloat(allocVal.replace(",", ".")) || 0;
    const totalEur =
      allocType === "percent"
        ? (totalMonthlyIncome * allocNum) / 100
        : allocNum;

    const p1TargetEur =
      method === "50_50"
        ? Math.round(totalEur * 0.5 * 100) / 100
        : Math.round(totalEur * p1.incomeRatio * 100) / 100;
    const p2TargetEur = Math.round((totalEur - p1TargetEur) * 100) / 100;

    const p1Subs = currentSubs.filter((s) => s.personId === "person1");
    const p2Subs = currentSubs.filter((s) => s.personId === "person2");

    const p1CurrentSum = p1Subs.reduce((sum, s) => sum + (s.amount || 0), 0);
    const p2CurrentSum = p2Subs.reduce((sum, s) => sum + (s.amount || 0), 0);

    return currentSubs.map((sub) => {
      if (sub.personId === "person1") {
        if (p1Subs.length === 1) {
          return { ...sub, amount: p1TargetEur };
        }
        const ratio =
          p1CurrentSum > 0 ? sub.amount / p1CurrentSum : 1 / p1Subs.length;
        return { ...sub, amount: Math.round(p1TargetEur * ratio * 100) / 100 };
      }
      if (sub.personId === "person2") {
        if (p2Subs.length === 1) {
          return { ...sub, amount: p2TargetEur };
        }
        const ratio =
          p2CurrentSum > 0 ? sub.amount / p2CurrentSum : 1 / p2Subs.length;
        return { ...sub, amount: Math.round(p2TargetEur * ratio * 100) / 100 };
      }
      return sub;
    });
  };

  // Handle Pockets
  const openAddPocket = () => {
    setEditingPocketId(null);
    setPocketName("");
    setPocketCategory("savings_goal");
    setPocketOwnership("shared");
    setPocketSplitMethod("proportional");
    setPocketAllocType("percent");
    setPocketAllocVal("10");
    setPocketCurrent("0");
    setPocketTarget("");
    setPocketReturnRate("0");
    setPocketColor(
      COLOR_PALETTE[strategy.pockets.length % COLOR_PALETTE.length],
    );
    setPocketNotes("");
    setPocketSubItems([]);
    setEditingSubItemId(null);
    setEditSubName("");
    setEditSubAmount("");
    setEditSubPersonId("person1");
    setNewSubName("");
    setNewSubAmount("");
    setNewSubCurrent("");
    setNewSubTarget("");
    setNewSubReturnRate("");
    setNewSubPersonId("person1");
    setPocketPerson1Amount("");
    setPocketPerson2Amount("");
    setPocketPerson1Current("");
    setPocketPerson2Current("");
    setPocketPerson1Target("");
    setPocketPerson2Target("");
    setIsAddingPocket(true);
  };

  const openEditPocket = (pocket: SavingsPocket) => {
    setEditingPocketId(pocket.id);
    setPocketName(pocket.name);
    setPocketCategory(pocket.category);
    const ownership = pocket.ownership || "shared";
    setPocketOwnership(ownership);
    const splitMethod =
      pocket.splitMethod ||
      (ownership === "dossier"
        ? "custom"
        : pocket.category === "fixed_expense"
          ? "50_50"
          : "proportional");
    setPocketSplitMethod(splitMethod);
    setPocketAllocType(pocket.allocationType);
    setPocketAllocVal(pocket.allocationValue.toString());
    setPocketCurrent((pocket.currentAmount || 0).toString());
    setPocketTarget(
      pocket.targetAmount != null ? pocket.targetAmount.toString() : "",
    );
    setPocketReturnRate(
      pocket.expectedReturnRate != null
        ? pocket.expectedReturnRate.toString()
        : "0",
    );
    setPocketColor(pocket.color || COLOR_PALETTE[0]);
    setPocketNotes(pocket.notes || "");

    let initialSubItems = pocket.subItems ? [...pocket.subItems] : [];
    if (
      ownership === "dossier" &&
      (splitMethod === "50_50" || splitMethod === "proportional") &&
      initialSubItems.length > 0
    ) {
      initialSubItems = syncSubItemsToDossierSplit(
        splitMethod,
        pocket.allocationType,
        pocket.allocationValue.toString(),
        initialSubItems,
      );
    }
    setPocketSubItems(initialSubItems);
    setEditingSubItemId(null);
    setEditSubName("");
    setEditSubAmount("");
    setEditSubPersonId("person1");

    setNewSubName("");
    setNewSubAmount("");
    setNewSubCurrent("");
    setNewSubTarget("");
    setNewSubReturnRate("");
    setNewSubPersonId("person1");

    if (
      ownership === "dossier" &&
      (splitMethod === "50_50" || splitMethod === "proportional") &&
      initialSubItems.length > 0
    ) {
      const p1T = initialSubItems
        .filter((s) => s.personId === "person1")
        .reduce((sum, it) => sum + it.amount, 0);
      const p2T = initialSubItems
        .filter((s) => s.personId === "person2")
        .reduce((sum, it) => sum + it.amount, 0);
      setPocketPerson1Amount(p1T.toString());
      setPocketPerson2Amount(p2T.toString());
    } else {
      setPocketPerson1Amount(
        pocket.person1Amount != null ? pocket.person1Amount.toString() : "",
      );
      setPocketPerson2Amount(
        pocket.person2Amount != null ? pocket.person2Amount.toString() : "",
      );
    }

    let p1CurStr =
      pocket.person1Current != null ? pocket.person1Current.toString() : "";
    let p2CurStr =
      pocket.person2Current != null ? pocket.person2Current.toString() : "";
    if (
      ownership === "dossier" &&
      !p1CurStr &&
      !p2CurStr &&
      pocket.currentAmount != null &&
      pocket.currentAmount > 0
    ) {
      const p1AmtVal = pocket.person1Amount || 0;
      const p2AmtVal = pocket.person2Amount || 0;
      const totalAmt = p1AmtVal + p2AmtVal;
      const r1 = totalAmt > 0 ? p1AmtVal / totalAmt : 0.5;
      const c1 = Math.round(pocket.currentAmount * r1);
      const c2 = pocket.currentAmount - c1;
      p1CurStr = c1.toString();
      p2CurStr = c2.toString();
    }
    setPocketPerson1Current(p1CurStr);
    setPocketPerson2Current(p2CurStr);

    let p1TgtStr =
      pocket.person1Target != null ? pocket.person1Target.toString() : "";
    let p2TgtStr =
      pocket.person2Target != null ? pocket.person2Target.toString() : "";
    if (
      ownership === "dossier" &&
      !p1TgtStr &&
      !p2TgtStr &&
      pocket.targetAmount != null &&
      pocket.targetAmount > 0
    ) {
      const p1AmtVal = pocket.person1Amount || 0;
      const p2AmtVal = pocket.person2Amount || 0;
      const totalAmt = p1AmtVal + p2AmtVal;
      const r1 = totalAmt > 0 ? p1AmtVal / totalAmt : 0.5;
      const t1 = Math.round(pocket.targetAmount * r1);
      const t2 = pocket.targetAmount - t1;
      p1TgtStr = t1.toString();
      p2TgtStr = t2.toString();
    }
    setPocketPerson1Target(p1TgtStr);
    setPocketPerson2Target(p2TgtStr);
    setIsAddingPocket(true);
  };

  const handleAddSubItem = (e: React.MouseEvent) => {
    e.preventDefault();
    const amt = parseFloat(newSubAmount.replace(",", "."));
    if (!newSubName.trim() || isNaN(amt) || amt < 0) return;

    const newItem: PocketSubItem = {
      id: "sub-" + Date.now(),
      name: newSubName.trim(),
      amount: amt,
      personId: pocketOwnership === "dossier" ? newSubPersonId : undefined,
      currentAmount: newSubCurrent.trim()
        ? parseFloat(newSubCurrent.replace(",", ".")) || 0
        : undefined,
      targetAmount: newSubTarget.trim()
        ? parseFloat(newSubTarget.replace(",", ".")) || 0
        : undefined,
      expectedReturnRate: newSubReturnRate.trim()
        ? parseFloat(newSubReturnRate.replace(",", ".")) || 0
        : undefined,
    };
    const updated = [...pocketSubItems, newItem];
    setNewSubName("");
    setNewSubAmount("");
    setNewSubCurrent("");
    setNewSubTarget("");
    setNewSubReturnRate("");

    if (
      pocketOwnership === "dossier" &&
      (pocketSplitMethod === "50_50" || pocketSplitMethod === "proportional")
    ) {
      const synced = syncSubItemsToDossierSplit(
        pocketSplitMethod,
        pocketAllocType,
        pocketAllocVal,
        updated,
      );
      setPocketSubItems(synced);
      const p1T = synced
        .filter((s) => s.personId === "person1")
        .reduce((sum, s) => sum + (s.amount || 0), 0);
      const p2T = synced
        .filter((s) => s.personId === "person2")
        .reduce((sum, s) => sum + (s.amount || 0), 0);
      setPocketPerson1Amount(p1T.toString());
      setPocketPerson2Amount(p2T.toString());
    } else {
      setPocketSubItems(updated);
      if (pocketOwnership === "dossier" && pocketSplitMethod === "custom") {
        const p1T = updated
          .filter((s) => s.personId === "person1")
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        const p2T = updated
          .filter((s) => s.personId === "person2")
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        setPocketPerson1Amount(p1T.toString());
        setPocketPerson2Amount(p2T.toString());
        setPocketAllocVal((p1T + p2T).toString());
      }
    }
  };

  const handleDeleteSubItem = (id: string) => {
    if (editingSubItemId === id) {
      setEditingSubItemId(null);
    }
    const updated = pocketSubItems.filter((item) => item.id !== id);
    if (
      pocketOwnership === "dossier" &&
      (pocketSplitMethod === "50_50" || pocketSplitMethod === "proportional")
    ) {
      const synced = syncSubItemsToDossierSplit(
        pocketSplitMethod,
        pocketAllocType,
        pocketAllocVal,
        updated,
      );
      setPocketSubItems(synced);
      const p1T = synced
        .filter((s) => s.personId === "person1")
        .reduce((sum, s) => sum + (s.amount || 0), 0);
      const p2T = synced
        .filter((s) => s.personId === "person2")
        .reduce((sum, s) => sum + (s.amount || 0), 0);
      setPocketPerson1Amount(p1T.toString());
      setPocketPerson2Amount(p2T.toString());
    } else {
      setPocketSubItems(updated);
      if (pocketOwnership === "dossier" && pocketSplitMethod === "custom") {
        const p1T = updated
          .filter((s) => s.personId === "person1")
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        const p2T = updated
          .filter((s) => s.personId === "person2")
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        setPocketPerson1Amount(p1T.toString());
        setPocketPerson2Amount(p2T.toString());
        setPocketAllocVal((p1T + p2T).toString());
      }
    }
  };

  const handleStartEditSubItem = (sub: PocketSubItem) => {
    setEditingSubItemId(sub.id);
    setEditSubName(sub.name);
    setEditSubAmount(sub.amount.toString());
    setEditSubCurrent(
      sub.currentAmount != null ? sub.currentAmount.toString() : "",
    );
    setEditSubTarget(
      sub.targetAmount != null ? sub.targetAmount.toString() : "",
    );
    setEditSubReturnRate(
      sub.expectedReturnRate != null ? sub.expectedReturnRate.toString() : "",
    );
    setEditSubPersonId(sub.personId || "person1");
  };

  const handleCancelEditSubItem = () => {
    setEditingSubItemId(null);
    setEditSubName("");
    setEditSubAmount("");
    setEditSubCurrent("");
    setEditSubTarget("");
    setEditSubReturnRate("");
    setEditSubPersonId("person1");
  };

  const handleSaveEditSubItem = (id: string) => {
    const amt = parseFloat(editSubAmount.replace(",", "."));
    if (!editSubName.trim() || isNaN(amt) || amt < 0) return;

    const oldItem = pocketSubItems.find((s) => s.id === id);
    const amountChanged = oldItem
      ? Math.abs(oldItem.amount - amt) > 0.001
      : false;

    let targetSplitMethod = pocketSplitMethod;
    if (
      pocketOwnership === "dossier" &&
      amountChanged &&
      pocketSplitMethod !== "custom"
    ) {
      targetSplitMethod = "custom";
      setPocketSplitMethod("custom");
      setPocketAllocType("fixed");
    }

    const updated = pocketSubItems.map((item) =>
      item.id === id
        ? {
            ...item,
            name: editSubName.trim(),
            amount: amt,
            currentAmount: editSubCurrent.trim()
              ? parseFloat(editSubCurrent.replace(",", ".")) || 0
              : undefined,
            targetAmount: editSubTarget.trim()
              ? parseFloat(editSubTarget.replace(",", ".")) || 0
              : undefined,
            expectedReturnRate: editSubReturnRate.trim()
              ? parseFloat(editSubReturnRate.replace(",", ".")) || 0
              : undefined,
            personId:
              pocketOwnership === "dossier" ? editSubPersonId : item.personId,
          }
        : item,
    );

    setEditingSubItemId(null);

    if (
      pocketOwnership === "dossier" &&
      (targetSplitMethod === "50_50" || targetSplitMethod === "proportional")
    ) {
      const synced = syncSubItemsToDossierSplit(
        targetSplitMethod,
        pocketAllocType,
        pocketAllocVal,
        updated,
      );
      setPocketSubItems(synced);
      const p1T = synced
        .filter((s) => s.personId === "person1")
        .reduce((sum, s) => sum + (s.amount || 0), 0);
      const p2T = synced
        .filter((s) => s.personId === "person2")
        .reduce((sum, s) => sum + (s.amount || 0), 0);
      setPocketPerson1Amount(p1T.toString());
      setPocketPerson2Amount(p2T.toString());
    } else {
      setPocketSubItems(updated);
      if (pocketOwnership === "dossier") {
        const p1T = updated
          .filter((s) => s.personId === "person1")
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        const p2T = updated
          .filter((s) => s.personId === "person2")
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        setPocketPerson1Amount(p1T.toString());
        setPocketPerson2Amount(p2T.toString());
        setPocketAllocVal((p1T + p2T).toString());
      }
    }
  };

  const handleSyncPocketAmountFromSubItems = () => {
    if (pocketOwnership === "dossier" && pocketSplitMethod === "custom") {
      const p1Total = pocketSubItems
        .filter((s) => s.personId === "person1")
        .reduce((sum, it) => sum + (it.amount || 0), 0);
      const p2Total = pocketSubItems
        .filter((s) => s.personId === "person2")
        .reduce((sum, it) => sum + (it.amount || 0), 0);
      setPocketPerson1Amount(p1Total.toString());
      setPocketPerson2Amount(p2Total.toString());
      setPocketAllocType("fixed");
      setPocketAllocVal((p1Total + p2Total).toString());
    } else {
      const total = pocketSubItems.reduce(
        (sum, it) => sum + (it.amount || 0),
        0,
      );
      setPocketAllocType("fixed");
      setPocketAllocVal(total.toString());
    }
  };

  const handleSavePocket = (e: React.FormEvent) => {
    e.preventDefault();
    const isDossier = pocketOwnership === "dossier";
    let p1Amt = parseFloat(pocketPerson1Amount.replace(",", ".")) || 0;
    let p2Amt = parseFloat(pocketPerson2Amount.replace(",", ".")) || 0;

    // Si le dossier dispose de sous-comptes, ils font foi et déterminent exactement les parts
    if (isDossier && pocketSubItems.length > 0) {
      p1Amt = pocketSubItems
        .filter((s) => s.personId === "person1")
        .reduce((sum, it) => sum + (it.amount || 0), 0);
      p2Amt = pocketSubItems
        .filter((s) => s.personId === "person2")
        .reduce((sum, it) => sum + (it.amount || 0), 0);
    }

    const p1Cur = parseFloat(pocketPerson1Current.replace(",", ".")) || 0;
    const p2Cur = parseFloat(pocketPerson2Current.replace(",", ".")) || 0;
    const p1Tgt = pocketPerson1Target.trim()
      ? parseFloat(pocketPerson1Target.replace(",", "."))
      : undefined;
    const p2Tgt = pocketPerson2Target.trim()
      ? parseFloat(pocketPerson2Target.replace(",", "."))
      : undefined;

    let allocNum = parseFloat(pocketAllocVal.replace(",", "."));
    let allocType = pocketAllocType;

    if (isDossier) {
      if (pocketSplitMethod === "custom") {
        if (pocketSubItems.length > 0) {
          p1Amt = pocketSubItems
            .filter((s) => s.personId === "person1")
            .reduce((sum, it) => sum + (it.amount || 0), 0);
          p2Amt = pocketSubItems
            .filter((s) => s.personId === "person2")
            .reduce((sum, it) => sum + (it.amount || 0), 0);
        }
        allocNum = p1Amt + p2Amt;
        allocType = "fixed";
      } else {
        const totalEur =
          allocType === "percent"
            ? (totalMonthlyIncome * (allocNum || 0)) / 100
            : allocNum || 0;
        if (pocketSplitMethod === "50_50") {
          p1Amt = totalEur * 0.5;
          p2Amt = totalEur * 0.5;
        } else {
          p1Amt = totalEur * p1.incomeRatio;
          p2Amt = totalEur * p2.incomeRatio;
        }
      }
    }

    if (!pocketName.trim() || isNaN(allocNum) || allocNum < 0) return;

    let currentNum = parseFloat(pocketCurrent.replace(",", ".")) || 0;
    if (isDossier && (p1Cur > 0 || p2Cur > 0)) {
      currentNum = p1Cur + p2Cur;
    }

    let targetNum = pocketTarget.trim()
      ? parseFloat(pocketTarget.replace(",", "."))
      : undefined;
    if (isDossier && (p1Tgt != null || p2Tgt != null)) {
      targetNum = (p1Tgt || 0) + (p2Tgt || 0);
    }

    let finalP1Tgt = isDossier ? p1Tgt : undefined;
    let finalP2Tgt = isDossier ? p2Tgt : undefined;
    if (
      isDossier &&
      finalP1Tgt == null &&
      finalP2Tgt == null &&
      targetNum != null &&
      targetNum > 0
    ) {
      const totalAmt = (p1Amt || 0) + (p2Amt || 0);
      const r1 = totalAmt > 0 ? (p1Amt || 0) / totalAmt : 0.5;
      finalP1Tgt = Math.round(targetNum * r1);
      finalP2Tgt = targetNum - finalP1Tgt;
    }

    let finalP1Cur = isDossier ? p1Cur : undefined;
    let finalP2Cur = isDossier ? p2Cur : undefined;
    if (
      isDossier &&
      finalP1Cur == null &&
      finalP2Cur == null &&
      currentNum > 0
    ) {
      const totalAmt = (p1Amt || 0) + (p2Amt || 0);
      const r1 = totalAmt > 0 ? (p1Amt || 0) / totalAmt : 0.5;
      finalP1Cur = Math.round(currentNum * r1);
      finalP2Cur = currentNum - finalP1Cur;
    }

    const returnNum = pocketReturnRate.trim()
      ? parseFloat(pocketReturnRate.replace(",", "."))
      : undefined;

    let finalSubItems = pocketSubItems;
    if (
      isDossier &&
      (pocketSplitMethod === "50_50" || pocketSplitMethod === "proportional") &&
      pocketSubItems.length > 0
    ) {
      finalSubItems = syncSubItemsToDossierSplit(
        pocketSplitMethod,
        allocType,
        pocketAllocVal,
        pocketSubItems,
      );
    }

    if (isDossier && finalSubItems.length > 0) {
      currentNum = finalSubItems.reduce(
        (sum, sub) => sum + (Number(sub.currentAmount) || 0),
        0,
      );
      const individualTarget = finalSubItems.reduce(
        (sum, sub) => sum + (Number(sub.targetAmount) || 0),
        0,
      );
      targetNum = individualTarget > 0 ? individualTarget : undefined;
    }

    const pocketData: Partial<SavingsPocket> = {
      name: pocketName.trim(),
      category: pocketCategory,
      ownership: pocketOwnership,
      splitMethod:
        pocketOwnership === "shared" || pocketOwnership === "dossier"
          ? pocketSplitMethod
          : undefined,
      allocationType: allocType,
      allocationValue: allocNum,
      currentAmount: currentNum,
      targetAmount: targetNum,
      expectedReturnRate: returnNum,
      color: pocketColor,
      notes: pocketNotes.trim(),
      subItems: finalSubItems,
      person1Amount: isDossier ? p1Amt : undefined,
      person2Amount: isDossier ? p2Amt : undefined,
      person1Current: finalP1Cur,
      person2Current: finalP2Cur,
      person1Target: finalP1Tgt,
      person2Target: finalP2Tgt,
    };

    if (editingPocketId) {
      // Edit existing pocket
      const updated = strategy.pockets.map((p) =>
        p.id === editingPocketId
          ? ({ ...p, ...pocketData } as SavingsPocket)
          : p,
      );
      updateStrategy({ ...strategy, pockets: updated });
    } else {
      // Add new pocket
      const newPocket: SavingsPocket = {
        id: "poc-" + Date.now(),
        ...(pocketData as Omit<SavingsPocket, "id">),
      } as SavingsPocket;
      updateStrategy({
        ...strategy,
        pockets: [...strategy.pockets, newPocket],
      });
    }

    setIsAddingPocket(false);
    setEditingPocketId(null);
    setEditingSubItemId(null);
  };

  const handleDeletePocket = (id: string) => {
    updateStrategy({
      ...strategy,
      pockets: strategy.pockets.filter((p) => p.id !== id),
    });
  };

  const handleResetDefault = () => {
    if (
      window.confirm(
        "Voulez-vous réinitialiser votre stratégie avec les valeurs modèles par défaut ?",
      )
    ) {
      const p1Name = currentUser || "Romain";
      const partnerName =
        availablePartners[0] ||
        availableUsers.find((u) => u.toLowerCase() !== p1Name.toLowerCase()) ||
        "Sophie";
      const resetConfig: SavingsStrategy = {
        ...DEFAULT_SAVINGS_STRATEGY,
        household: {
          ...DEFAULT_SAVINGS_STRATEGY.household,
          splitMode:
            DEFAULT_SAVINGS_STRATEGY.household?.splitMode ?? "proportional",
          enabled: availableUsers.length >= 2,
          person1: {
            id: "person1",
            name: p1Name,
            color: getAccentColorDef(getUserAccentColor(p1Name)).hex,
          },
          person2: {
            id: "person2",
            name: partnerName,
            color: getAccentColorDef(getUserAccentColor(partnerName)).hex,
          },
        },
      };
      updateStrategy(resetConfig);
      setSelectedHorizon(resetConfig.horizonYears);
    }
  };

  // Sub-items total in form
  const currentSubItemsTotal = useMemo(
    () =>
      pocketSubItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [pocketSubItems],
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[rgba(255,255,255,0.06)] pb-5">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-bold text-[#f5f5f5]">
              Stratégie d'Épargne
            </h1>
            {hasCustomStrategyForMonth(activeMonth) ? (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                <CheckCircle2 size={12} /> Personnalisée pour{" "}
                {formatMonthLabel(activeMonth)}
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                Reconduite depuis{" "}
                {getSourceStrategyMonthFor(activeMonth)
                  ? formatMonthLabel(getSourceStrategyMonthFor(activeMonth)!)
                  : "la base"}
              </span>
            )}
          </div>
          <p className="text-sm text-[#555555] mt-1">
            Ajustez les revenus, charges incompressibles et poches
            d'investissement de ce mois. Chaque mois se reconduit
            automatiquement depuis le mois précédent.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showSavedToast && (
            <span className="text-xs flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-1.5 rounded-xl animate-fade-in shadow-sm">
              <CheckCircle2 size={14} /> Plan sauvegardé !
            </span>
          )}

          {/* Bouton choix déroulant Mode Solo / Mode Couple (style noir et contour gris) */}
          <div className="relative" ref={modeMenuRef}>
            <button
              type="button"
              onClick={() => setIsModeMenuOpen(!isModeMenuOpen)}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] bg-[#111111] dark:bg-[#1a1a1a] text-[#f5f5f5]  hover:bg-[#0a0a0a] dark:hover:bg-[#252525] transition shadow-sm flex items-center gap-2"
            >
              {strategy.household?.enabled ? (
                <>
                  <Users
                    size={14}
                    className="text-primary-500 text-[#c8a55e]"
                  />
                  <span>Mode Couple</span>
                </>
              ) : (
                <>
                  <User
                    size={14}
                    className="text-[#555555]"
                  />
                  <span>Mode Solo</span>
                </>
              )}
              <ChevronDown
                size={14}
                className={`text-[#555555] transition-transform duration-200 ${
                  isModeMenuOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isModeMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-48 bg-[#111111] dark:bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] rounded-xl shadow-xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={() => {
                    toggleHouseholdMode(false);
                    setIsModeMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg font-medium transition ${
                    !strategy.household?.enabled
                      ? "bg-[#1a1a1a] bg-[#161616] text-[#f5f5f5] font-semibold"
                      : "text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <User
                      size={14}
                      className={
                        !strategy.household?.enabled
                          ? "text-primary-500"
                          : "text-[#555555]"
                      }
                    />
                    <span>Mode Solo</span>
                  </div>
                  {!strategy.household?.enabled && (
                    <Check size={14} className="text-primary-500" />
                  )}
                </button>

                <button
                  type="button"
                  disabled={availableUsers.length < 2}
                  onClick={() => {
                    if (availableUsers.length >= 2) {
                      toggleHouseholdMode(true);
                      setIsModeMenuOpen(false);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg font-medium transition mt-0.5 ${
                    strategy.household?.enabled
                      ? "bg-[#1a1a1a] bg-[#161616] text-[#f5f5f5] font-semibold"
                      : availableUsers.length < 2
                        ? "opacity-40 cursor-not-allowed text-[#555555]"
                        : "text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)]"
                  }`}
                  title={
                    availableUsers.length < 2
                      ? "Ajoutez un 2ème utilisateur dans le menu de profil pour débloquer le Mode Couple"
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <Users
                      size={14}
                      className={
                        strategy.household?.enabled
                          ? "text-primary-500"
                          : "text-[#555555]"
                      }
                    />
                    <span>Mode Couple</span>
                    {availableUsers.length < 2 && (
                      <span className="text-[10px] px-1 py-0.2 bg-[#1a1a1a] bg-[#1a1a1a] rounded text-[#555555]">
                        1/2
                      </span>
                    )}
                  </div>
                  {strategy.household?.enabled && (
                    <Check size={14} className="text-primary-500" />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Bouton Sauvegarder (petit bouton disquette comme reset) */}
          <button
            type="button"
            onClick={handleManualSave}
            title="Sauvegarder le plan"
            className="p-2 text-xs font-medium border border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] rounded-xl text-[#8a8a8a] hover:text-[#c8a55e] dark:hover:text-primary-400 hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)] bg-[#111111] dark:bg-[#1a1a1a] transition shadow-sm"
          >
            <Save size={15} />
          </button>

          {/* Bouton Réinitialiser */}
          <button
            type="button"
            onClick={handleResetDefault}
            title="Réinitialiser avec le modèle par défaut"
            className="p-2 text-xs font-medium border border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] rounded-xl text-[#555555] hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 bg-[#111111] dark:bg-[#1a1a1a] transition shadow-sm"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      {/* Onglets des mois — chaque mois a sa stratégie (reconduite automatiquement) */}
      <div className="flex items-center gap-2 sm:gap-6 overflow-x-auto scrollbar-none py-0.5 border-b border-[rgba(255,255,255,0.06)]">
        {monthTabs.map((m) => {
          const isActive = m === activeMonth;
          const isCustom = hasCustomStrategyForMonth(m);
          const source = getSourceStrategyMonthFor(m);
          const tabTitle = isCustom
            ? "Stratégie personnalisée pour ce mois"
            : source
              ? `Reconduite depuis ${formatMonthLabel(source)}`
              : "Stratégie par défaut";
          return (
            <button
              key={m}
              type="button"
              ref={isActive ? activeMonthTabRef : undefined}
              onClick={() => handleSelectMonth(m)}
              title={tabTitle}
              className={`pb-2.5 text-sm font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
                isActive
                  ? "border-[#c8a55e] text-[#c8a55e]"
                  : "border-transparent text-[#555555] hover:text-[#f5f5f5]"
              }`}
            >
              <Calendar
                size={15}
                className={isActive ? "text-[#c8a55e]" : "text-[#555555]"}
              />
              <span>{formatMonthLabel(m)}</span>
              {isCustom && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#c8a55e]"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Règle de reconduction — ligne discrète + copie depuis un autre mois */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111111] px-4 py-3">
        <p className="text-xs text-[#8a8a8a] flex items-center gap-2">
          <Calendar size={14} className="text-[#c8a55e] flex-shrink-0" />
          <span>
            La stratégie du dernier mois s'applique automatiquement au mois
            suivant — ou copiez la stratégie d'un autre mois :
          </span>
        </p>
        <div className="flex items-center gap-2 bg-[#0a0a0a] border border-[rgba(255,255,255,0.06)] rounded-lg p-1 shadow-xs flex-shrink-0">
          <RotateCcw
            size={14}
            className="text-[#555555] ml-1.5 flex-shrink-0"
          />
          <select
            value={selectedSourceMonth}
            onChange={(e) => setSelectedSourceMonth(e.target.value)}
            className="text-xs font-semibold bg-transparent border-0 text-[#f5f5f5] focus:ring-0 cursor-pointer py-1"
          >
            <option value="">Choisir un mois...</option>
            {availableMonthsList
              .filter((m) => m !== activeMonth)
              .map((m) => (
                <option key={m} value={m}>
                  Stratégie de {formatMonthLabel(m)}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!selectedSourceMonth}
            onClick={() => handleApplyStrategyFromOtherMonth(selectedSourceMonth)}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#c8a55e] text-white hover:bg-[#d4b06a] disabled:opacity-40 disabled:cursor-not-allowed transition shadow-xs whitespace-nowrap"
          >
            Appliquer à {formatMonthLabel(activeMonth).split(" ")[0]}
          </button>
        </div>
      </div>

      {/* Centered View Filter Switcher (Simple text with navbar-like active underline) */}
      {household.enabled && (
        <div className="flex justify-center -mt-2 mb-3">
          <nav
            className="flex items-center space-x-8"
            aria-label="Onglets de vue"
          >
            <button
              type="button"
              onClick={() => setViewFilter("all")}
              className={`text-sm py-3 px-1 border-b-2 transition-all ${
                viewFilter === "all"
                  ? "text-[#c8a55e] text-[#c8a55e] border-[#c8a55e] font-semibold"
                  : "text-[#555555] hover:text-[#8a8a8a] text-[#555555] hover:text-[#f5f5f5] border-transparent font-medium"
              }`}
            >
              Vue d'ensemble (Couple)
            </button>

            <button
              type="button"
              onClick={() => setViewFilter("person1")}
              style={
                viewFilter === "person1" ? p1Theme.tabActiveStyle : undefined
              }
              className={`text-sm py-3 px-1 border-b-2 transition-all ${
                viewFilter === "person1"
                  ? "font-semibold"
                  : "text-[#555555] hover:text-[#8a8a8a] text-[#555555] hover:text-[#f5f5f5] border-transparent font-medium"
              }`}
            >
              Vue {p1.name}
            </button>

            <button
              type="button"
              onClick={() => setViewFilter("person2")}
              style={
                viewFilter === "person2" ? p2Theme.tabActiveStyle : undefined
              }
              className={`text-sm py-3 px-1 border-b-2 transition-all ${
                viewFilter === "person2"
                  ? "font-semibold"
                  : "text-[#555555] hover:text-[#8a8a8a] text-[#555555] hover:text-[#f5f5f5] border-transparent font-medium"
              }`}
            >
              Vue {p2.name}
            </button>
          </nav>
        </div>
      )}

      {/* KPI Cards adapted to view filter */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Revenus mensuels */}
        <div className="card p-5 flex flex-col justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#555555]">
            {household.enabled
              ? viewFilter === "all"
                ? "Revenus Mensuels (Foyer)"
                : `Revenu Mensuel (${viewFilter === "person1" ? p1.name : p2.name})`
              : "Revenus Mensuels"}
          </p>
          <div className="mt-3">
            <p className="text-2xl font-bold text-[#f5f5f5]">
              {formatEur(
                !household.enabled || viewFilter === "all"
                  ? totalMonthlyIncome
                  : viewFilter === "person1"
                    ? p1.monthlyIncome
                    : p2.monthlyIncome,
              )}
            </p>
            <p className="text-xs text-[#555555] mt-1">
              {!household.enabled || viewFilter === "all"
                ? `Soit ${formatEur(totalYearlyIncome)} / an`
                : `Part du foyer : ${(
                    (viewFilter === "person1"
                      ? p1.incomeRatio
                      : p2.incomeRatio) * 100
                  ).toFixed(1)}%`}
            </p>
          </div>
        </div>

        {/* Total alloué / payé */}
        <div className="card p-5 flex flex-col justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#555555]">
            {household.enabled
              ? viewFilter === "all"
                ? "Total Alloué (Foyer)"
                : `Total Payé (${viewFilter === "person1" ? p1.name : p2.name})`
              : "Total Alloué"}
          </p>
          <div className="mt-3">
            <p className="text-2xl font-bold text-[#f5f5f5]">
              {formatEur(
                viewFilter === "all"
                  ? householdSummary.totalAllocatedEur
                  : viewFilter === "person1"
                    ? p1.totalAllocatedEur
                    : p2.totalAllocatedEur,
              )}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-full bg-[#1a1a1a] bg-[#1a1a1a] h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    (viewFilter === "all"
                      ? householdSummary.totalAllocatedEur /
                        (totalMonthlyIncome || 1)
                      : (viewFilter === "person1"
                          ? p1.totalAllocatedEur
                          : p2.totalAllocatedEur) /
                        ((viewFilter === "person1"
                          ? p1.monthlyIncome
                          : p2.monthlyIncome) || 1)) > 1
                      ? "bg-danger-500"
                      : "bg-indigo-600"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      viewFilter === "all"
                        ? householdSummary.remainingPercent <= 0
                          ? 100
                          : 100 - householdSummary.remainingPercent
                        : viewFilter === "person1"
                          ? 100 - p1.remainingPercent
                          : 100 - p2.remainingPercent,
                    )}%`,
                  }}
                />
              </div>
              <span className="text-xs font-medium text-[#8a8a8a] min-w-[40px] text-right">
                {(viewFilter === "all"
                  ? (householdSummary.totalAllocatedEur /
                      (totalMonthlyIncome || 1)) *
                    100
                  : ((viewFilter === "person1"
                      ? p1.totalAllocatedEur
                      : p2.totalAllocatedEur) /
                      ((viewFilter === "person1"
                        ? p1.monthlyIncome
                        : p2.monthlyIncome) || 1)) *
                    100
                ).toFixed(1)}
                %
              </span>
            </div>
          </div>
        </div>

        {/* Reste à vivre / libre */}
        <div className="card p-5 flex flex-col justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#555555]">
            {household.enabled
              ? viewFilter === "all"
                ? "Reste à vivre (Foyer)"
                : `Reste à vivre (${viewFilter === "person1" ? p1.name : p2.name})`
              : "Reste à vivre"}
          </p>
          <div className="mt-3">
            <p
              className={`text-2xl font-bold ${
                (viewFilter === "all"
                  ? householdSummary.totalRemainingEur
                  : viewFilter === "person1"
                    ? p1.remainingEur
                    : p2.remainingEur) >= -0.005
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {formatEur(
                viewFilter === "all"
                  ? householdSummary.totalRemainingEur
                  : viewFilter === "person1"
                    ? p1.remainingEur
                    : p2.remainingEur,
              )}
            </p>
            <p className="text-xs text-[#555555] mt-1">
              {(viewFilter === "all"
                ? householdSummary.remainingPercent
                : viewFilter === "person1"
                  ? p1.remainingPercent
                  : p2.remainingPercent) >= -0.005
                ? `${Math.max(
                    0,
                    viewFilter === "all"
                      ? householdSummary.remainingPercent
                      : viewFilter === "person1"
                        ? p1.remainingPercent
                        : p2.remainingPercent,
                  ).toFixed(1)}% disponible pour les dépenses perso / imprévus`
                : "Dépassement de budget"}
            </p>
          </div>
        </div>

        {/* Taux d'épargne réel */}
        <div className="card p-5 flex flex-col justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#555555]">
            {household.enabled
              ? viewFilter === "all"
                ? "Taux d'Épargne Global"
                : `Taux d'Épargne (${viewFilter === "person1" ? p1.name : p2.name})`
              : "Taux d'Épargne Personnel"}
          </p>
          <div className="mt-3">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {(viewFilter === "all"
                ? householdSummary.savingsRate
                : viewFilter === "person1"
                  ? p1.savingsRate
                  : p2.savingsRate
              ).toFixed(1)}
              %
            </p>
            <p className="text-xs text-[#555555] mt-1">
              {formatEur(
                viewFilter === "all"
                  ? householdSummary.totalSavingsEur
                  : viewFilter === "person1"
                    ? p1.savingsAmountEur
                    : p2.savingsAmountEur,
              )}{" "}
              / mois mis de côté
            </p>
          </div>
        </div>
      </div>

      {/* Tableau d'Équilibre & Répartition du Couple */}
      {household.enabled && (
        <div className="card p-6 space-y-4">
          <div className="border-b border-[rgba(255,255,255,0.06)] pb-3">
            <h3 className="text-base font-bold text-[#f5f5f5]">
              Tableau d'Équilibre & Répartition du Couple
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Personne 1 Card */}
            <div
              style={p1Theme.cardStyle}
              className="p-4 rounded-xl border space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={p1Theme.dotStyle}
                  />
                  <h4 className="font-bold text-sm text-gray-950 text-[#f5f5f5]">
                    {p1.name}
                  </h4>
                </div>
                <span
                  style={p1Theme.badgeStyle}
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                >
                  {(p1.incomeRatio * 100).toFixed(1)}% des revenus
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-[#8a8a8a]">
                  <span>Revenu net mensuel :</span>
                  <strong className="text-[#f5f5f5]">
                    {formatEur(p1.monthlyIncome)}
                  </strong>
                </div>
                <div className="flex justify-between text-[#8a8a8a]">
                  <span>Quote-part charges & poches communes :</span>
                  <strong style={p1Theme.textStyle}>
                    {formatEur(p1.sharedContributionEur)}
                  </strong>
                </div>
                <div className="flex justify-between text-[#8a8a8a]">
                  <span>Épargne & poches personnelles :</span>
                  <strong className="text-[#f5f5f5]">
                    {formatEur(p1.personalContributionEur)}
                  </strong>
                </div>
                <div className="pt-2 border-t border-[rgba(255,255,255,0.06)] flex justify-between font-bold text-sm">
                  <span className="text-[#f5f5f5] ">
                    Reste à vivre personnel :
                  </span>
                  <span
                    className={
                      p1.remainingEur >= -0.005
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }
                  >
                    {formatEur(p1.remainingEur)}
                  </span>
                </div>
              </div>
            </div>

            {/* Personne 2 Card */}
            <div
              style={p2Theme.cardStyle}
              className="p-4 rounded-xl border space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={p2Theme.dotStyle}
                  />
                  <h4 className="font-bold text-sm text-gray-950 text-[#f5f5f5]">
                    {p2.name}
                  </h4>
                </div>
                <span
                  style={p2Theme.badgeStyle}
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                >
                  {(p2.incomeRatio * 100).toFixed(1)}% des revenus
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-[#8a8a8a]">
                  <span>Revenu net mensuel :</span>
                  <strong className="text-[#f5f5f5]">
                    {formatEur(p2.monthlyIncome)}
                  </strong>
                </div>
                <div className="flex justify-between text-[#8a8a8a]">
                  <span>Quote-part charges & poches communes :</span>
                  <strong style={p2Theme.textStyle}>
                    {formatEur(p2.sharedContributionEur)}
                  </strong>
                </div>
                <div className="flex justify-between text-[#8a8a8a]">
                  <span>Épargne & poches personnelles :</span>
                  <strong className="text-[#f5f5f5]">
                    {formatEur(p2.personalContributionEur)}
                  </strong>
                </div>
                <div className="pt-2 border-t border-[rgba(255,255,255,0.06)] flex justify-between font-bold text-sm">
                  <span className="text-[#f5f5f5] ">
                    Reste à vivre personnel :
                  </span>
                  <span
                    className={
                      p2.remainingEur >= -0.005
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }
                  >
                    {formatEur(p2.remainingEur)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid : Incomes & Poches */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Colonne gauche : Sources de revenus & Donut (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-[#f5f5f5]">
                  Sources de Revenus
                </h3>
                <p className="text-xs text-[#555555]">
                  Salaires et rentrées d'argent des deux partenaires
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isAddingIncome) {
                    handleCancelIncomeForm();
                  } else {
                    setIsAddingIncome(true);
                  }
                }}
                className="btn btn-primary p-2 text-xs flex items-center gap-1 rounded-lg"
                title={
                  isAddingIncome ? "Fermer" : "Ajouter une source de revenus"
                }
              >
                {isAddingIncome ? <X size={16} /> : <Plus size={16} />}
              </button>
            </div>

            {/* Formulaire ajout/édition revenu */}
            {isAddingIncome && (
              <form
                onSubmit={handleSaveIncome}
                className="mb-4 p-4 rounded-xl bg-[#0a0a0a] dark:bg-[#161616] border border-[rgba(255,255,255,0.06)] space-y-3 animate-fade-in shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] pb-2">
                  <span className="text-xs font-bold text-[#f5f5f5]">
                    {editingIncomeId
                      ? "Modifier la source de revenus"
                      : "Nouvelle source de revenus"}
                  </span>
                  {editingIncomeId && (
                    <span className="text-[10px] text-primary-500 font-semibold uppercase">
                      Édition en cours
                    </span>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                    Nom de la source
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Salaire Romain, Salaire Copine, Freelance..."
                    value={incomeName}
                    onChange={(e) => setIncomeName(e.target.value)}
                    className="input-field text-xs"
                  />
                </div>

                {household.enabled && (
                  <div>
                    <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                      Attribué à
                    </label>
                    <select
                      value={incomePersonId}
                      onChange={(e) =>
                        setIncomePersonId(e.target.value as PersonId)
                      }
                      className="input-field text-xs"
                    >
                      <option value="person1">{p1.name} (Personne 1)</option>
                      <option value="person2">{p2.name} (Personne 2)</option>
                      <option value="shared">Revenu commun / partagé</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                      Montant (€)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      placeholder="3000"
                      value={incomeAmount}
                      onChange={(e) => setIncomeAmount(e.target.value)}
                      className="input-field text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                      Période
                    </label>
                    <select
                      value={incomeFreq}
                      onChange={(e) =>
                        setIncomeFreq(e.target.value as "monthly" | "yearly")
                      }
                      className="input-field text-xs"
                    >
                      <option value="monthly">Par mois</option>
                      <option value="yearly">Par an</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCancelIncomeForm}
                    className="btn btn-secondary text-xs py-1 px-2.5"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary text-xs py-1 px-3 font-semibold"
                  >
                    {editingIncomeId ? "Enregistrer" : "Ajouter"}
                  </button>
                </div>
              </form>
            )}

            {/* Liste des revenus */}
            <div className="space-y-2.5">
              {strategy.incomes.length === 0 ? (
                <div className="text-center py-6 text-xs text-[#555555]">
                  Aucune source de revenu renseignée.
                </div>
              ) : (
                strategy.incomes.map((inc) => {
                  const monthlyVal =
                    inc.frequency === "yearly" ? inc.amount / 12 : inc.amount;
                  const pid = inc.personId || "person1";
                  const personLabel =
                    pid === "person1"
                      ? p1.name
                      : pid === "person2"
                        ? p2.name
                        : "Commun";
                  const personBadgeStyle =
                    pid === "person1"
                      ? p1Theme.badgeStyle
                      : pid === "person2"
                        ? p2Theme.badgeStyle
                        : {
                            backgroundColor: "rgba(168, 85, 247, 0.15)",
                            color: "#a855f7",
                          };

                  return (
                    <div
                      key={inc.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-[#0a0a0a]/70 bg-[#161616]/40 transition"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#f5f5f5]">
                            {inc.name}
                          </p>
                          {household.enabled && (
                            <span
                              style={personBadgeStyle}
                              className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                            >
                              {personLabel}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#555555] mt-0.5">
                          {formatEur(inc.amount)}{" "}
                          {inc.frequency === "yearly" ? "/ an" : "/ mois"}
                          {inc.frequency === "yearly" &&
                            ` (${formatEur(monthlyVal)} / mois)`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-[#c8a55e] text-[#c8a55e] mr-1">
                          {formatEur(monthlyVal)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenEditIncome(inc)}
                          className="text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 transition p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)]"
                          title="Modifier cette source de revenus"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteIncome(inc.id)}
                          className="text-[#555555] hover:text-danger-500 transition p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)]"
                          title="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Graphique Donut */}
          <div className="card p-5">
            <h3 className="text-sm font-bold text-[#f5f5f5] mb-2">
              Diagramme de Répartition
            </h3>
            <div className="h-56 w-full flex items-center justify-center">
              {pieData.length === 0 ? (
                <p className="text-xs text-[#555555]">Aucune donnée</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <RechartsTooltip
                      formatter={(val: number, name: string) => [
                        formatEur(Number(val)),
                        name,
                      ]}
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #334155",
                        borderRadius: "8px",
                        color: "#fff",
                        fontSize: "12px",
                      }}
                    />
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map((entry) => (
                        <Cell key={`cell-${entry.id}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </RePieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Colonne droite : Poches d'épargne avec sous-sections & attribution (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          <div className="card p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-base font-bold text-[#f5f5f5]">
                  Poches d'Épargne & Dépenses
                </h3>
                <p className="text-xs text-[#555555]">
                  Définissez vos enveloppes budgétaires, leurs sous-sections
                  internes et leur répartition.
                </p>
              </div>
              <button
                type="button"
                onClick={openAddPocket}
                className="btn btn-primary text-xs flex items-center gap-1.5 self-start sm:self-auto py-2 px-3.5 rounded-xl shadow-sm"
              >
                <Plus size={16} />
                Nouvelle Poche
              </button>
            </div>

            {/* Modal / Formulaire d'ajout ou d'édition de poche */}
            {isAddingPocket && (
              <form
                onSubmit={handleSavePocket}
                className="mb-6 p-5 rounded-2xl bg-[#0a0a0a] bg-[#161616]/90 border border-[rgba(255,255,255,0.06)] space-y-5 animate-fade-in "
              >
                <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] pb-3">
                  <h4 className="text-sm font-bold text-[#f5f5f5]">
                    {editingPocketId
                      ? "Modifier la poche d'épargne"
                      : "Créer une nouvelle poche d'épargne"}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingPocket(false);
                      setEditingPocketId(null);
                      setEditingSubItemId(null);
                    }}
                    className="text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Nom */}
                  <div>
                    <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                      Nom de la poche *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Loyer & charges, Mariage, PEA..."
                      value={pocketName}
                      onChange={(e) => setPocketName(e.target.value)}
                      className="input-field text-xs"
                    />
                  </div>

                  {/* Catégorie */}
                  <div>
                    <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                      Catégorie
                    </label>
                    <select
                      value={pocketCategory}
                      onChange={(e) =>
                        setPocketCategory(e.target.value as PocketCategory)
                      }
                      className="input-field text-xs"
                    >
                      {Object.entries(CATEGORY_META).map(([cat, meta]) => (
                        <option key={cat} value={cat}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Attribution / Propriétaire */}
                  {household.enabled && (
                    <div className="md:col-span-2 space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                          Qui finance cette poche ? *
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <button
                            type="button"
                            onClick={() => setPocketOwnership("shared")}
                            className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center ${
                              pocketOwnership === "shared"
                                ? "bg-[#c8a55e] text-white border-primary-600 shadow-sm"
                                : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                            }`}
                          >
                            Commune (Partagée)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPocketOwnership("dossier");
                              if (
                                pocketSplitMethod !== "50_50" &&
                                pocketSplitMethod !== "proportional" &&
                                pocketSplitMethod !== "custom"
                              ) {
                                setPocketSplitMethod("50_50");
                              }
                              if (
                                pocketTarget.trim() &&
                                !pocketPerson1Target &&
                                !pocketPerson2Target
                              ) {
                                const tgt =
                                  parseFloat(pocketTarget.replace(",", ".")) ||
                                  0;
                                if (tgt > 0) {
                                  const t1 = Math.round(tgt / 2);
                                  setPocketPerson1Target(t1.toString());
                                  setPocketPerson2Target((tgt - t1).toString());
                                }
                              }
                              if (
                                pocketCurrent.trim() &&
                                !pocketPerson1Current &&
                                !pocketPerson2Current
                              ) {
                                const cur =
                                  parseFloat(pocketCurrent.replace(",", ".")) ||
                                  0;
                                if (cur > 0) {
                                  const c1 = Math.round(cur / 2);
                                  setPocketPerson1Current(c1.toString());
                                  setPocketPerson2Current(
                                    (cur - c1).toString(),
                                  );
                                }
                              }
                            }}
                            className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center flex items-center justify-center gap-1.5 ${
                              pocketOwnership === "dossier"
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                            }`}
                          >
                            <Folder size={13} />
                            Dossier (Chacun de son côté)
                          </button>
                          <button
                            type="button"
                            onClick={() => setPocketOwnership("person1")}
                            style={
                              pocketOwnership === "person1"
                                ? {
                                    backgroundColor: p1Theme.hex,
                                    borderColor: p1Theme.hex,
                                    color: "#fff",
                                  }
                                : undefined
                            }
                            className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center ${
                              pocketOwnership === "person1"
                                ? "shadow-sm"
                                : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                            }`}
                          >
                            Personnel {p1.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPocketOwnership("person2")}
                            style={
                              pocketOwnership === "person2"
                                ? {
                                    backgroundColor: p2Theme.hex,
                                    borderColor: p2Theme.hex,
                                    color: "#fff",
                                  }
                                : undefined
                            }
                            className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center ${
                              pocketOwnership === "person2"
                                ? "shadow-sm"
                                : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                            }`}
                          >
                            Personnel {p2.name}
                          </button>
                        </div>
                      </div>

                      {/* Mode de répartition 50/50 vs Prorata quand la poche est partagée */}
                      {pocketOwnership === "shared" && (
                        <div className="p-3.5 bg-primary-50/60 dark:bg-primary-950/20 rounded-xl border border-primary-200/80 dark:border-primary-900/40 space-y-2.5 animate-fade-in">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-[#f5f5f5]  flex items-center gap-1.5">
                              <Scale size={14} className="text-primary-500" />
                              Mode de répartition pour cette poche
                            </label>
                            <span className="text-[11px] text-[#555555]">
                              {pocketSplitMethod === "50_50"
                                ? "Partage égalitaire (50 / 50)"
                                : "Au prorata des revenus nets"}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setPocketSplitMethod("50_50")}
                              className={`p-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                                pocketSplitMethod === "50_50"
                                  ? "bg-[#c8a55e] text-white border-primary-600 shadow-sm"
                                  : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                              }`}
                            >
                              <Split size={13} />
                              50 / 50 (Égalité)
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPocketSplitMethod("proportional")
                              }
                              className={`p-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                                pocketSplitMethod === "proportional"
                                  ? "bg-[#c8a55e] text-white border-primary-600 shadow-sm"
                                  : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                              }`}
                            >
                              <Scale size={13} />
                              Au prorata des salaires
                            </button>
                          </div>

                          {/* Aperçu dynamique */}
                          <div className="text-[11px] text-[#8a8a8a] flex items-center justify-between pt-1 border-t border-primary-200/50 dark:border-primary-900/30">
                            <span>
                              {p1.name} :{" "}
                              <strong
                                style={p1Theme.textStyle}
                                className="font-semibold"
                              >
                                {formatEur(
                                  pocketSplitMethod === "50_50"
                                    ? (pocketAllocType === "percent"
                                        ? (totalMonthlyIncome *
                                            (parseFloat(pocketAllocVal) || 0)) /
                                          100
                                        : parseFloat(pocketAllocVal) || 0) * 0.5
                                    : (pocketAllocType === "percent"
                                        ? (totalMonthlyIncome *
                                            (parseFloat(pocketAllocVal) || 0)) /
                                          100
                                        : parseFloat(pocketAllocVal) || 0) *
                                        p1.incomeRatio,
                                )}
                              </strong>{" "}
                              (
                              {pocketSplitMethod === "50_50"
                                ? "50%"
                                : `${(p1.incomeRatio * 100).toFixed(1)}%`}
                              )
                            </span>
                            <span>
                              {p2.name} :{" "}
                              <strong
                                style={p2Theme.textStyle}
                                className="font-semibold"
                              >
                                {formatEur(
                                  pocketSplitMethod === "50_50"
                                    ? (pocketAllocType === "percent"
                                        ? (totalMonthlyIncome *
                                            (parseFloat(pocketAllocVal) || 0)) /
                                          100
                                        : parseFloat(pocketAllocVal) || 0) * 0.5
                                    : (pocketAllocType === "percent"
                                        ? (totalMonthlyIncome *
                                            (parseFloat(pocketAllocVal) || 0)) /
                                          100
                                        : parseFloat(pocketAllocVal) || 0) *
                                        p2.incomeRatio,
                                )}
                              </strong>{" "}
                              (
                              {pocketSplitMethod === "50_50"
                                ? "50%"
                                : `${(p2.incomeRatio * 100).toFixed(1)}%`}
                              )
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Mode Dossier : Choix de la répartition */}
                      {pocketOwnership === "dossier" && (
                        <div className="p-3.5 bg-indigo-50/70 dark:bg-indigo-950/25 rounded-xl border border-indigo-200/80 dark:border-indigo-900/40 space-y-3 animate-fade-in">
                          <div>
                            <label className="text-xs font-semibold text-[#f5f5f5] block mb-1.5">
                              Répartition du dossier entre {p1.name} et{" "}
                              {p2.name} *
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setPocketSplitMethod("50_50");
                                  if (pocketSubItems.length > 0) {
                                    const synced = syncSubItemsToDossierSplit(
                                      "50_50",
                                      pocketAllocType,
                                      pocketAllocVal,
                                      pocketSubItems,
                                    );
                                    setPocketSubItems(synced);
                                    const p1Amt = synced
                                      .filter((s) => s.personId === "person1")
                                      .reduce((sum, it) => sum + it.amount, 0);
                                    const p2Amt = synced
                                      .filter((s) => s.personId === "person2")
                                      .reduce((sum, it) => sum + it.amount, 0);
                                    setPocketPerson1Amount(p1Amt.toString());
                                    setPocketPerson2Amount(p2Amt.toString());
                                  }
                                }}
                                className={`p-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                                  pocketSplitMethod === "50_50"
                                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                    : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                                }`}
                              >
                                <Users size={13} />
                                50 / 50
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPocketSplitMethod("proportional");
                                  if (pocketSubItems.length > 0) {
                                    const synced = syncSubItemsToDossierSplit(
                                      "proportional",
                                      pocketAllocType,
                                      pocketAllocVal,
                                      pocketSubItems,
                                    );
                                    setPocketSubItems(synced);
                                    const p1Amt = synced
                                      .filter((s) => s.personId === "person1")
                                      .reduce((sum, it) => sum + it.amount, 0);
                                    const p2Amt = synced
                                      .filter((s) => s.personId === "person2")
                                      .reduce((sum, it) => sum + it.amount, 0);
                                    setPocketPerson1Amount(p1Amt.toString());
                                    setPocketPerson2Amount(p2Amt.toString());
                                  }
                                }}
                                className={`p-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                                  pocketSplitMethod === "proportional"
                                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                    : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                                }`}
                              >
                                <Scale size={13} />
                                Au prorata
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPocketSplitMethod("custom");
                                  setPocketAllocType("fixed");
                                  if (
                                    pocketOwnership === "dossier" &&
                                    pocketSubItems.length > 0
                                  ) {
                                    const p1Amt = pocketSubItems
                                      .filter((s) => s.personId === "person1")
                                      .reduce((sum, it) => sum + it.amount, 0);
                                    const p2Amt = pocketSubItems
                                      .filter((s) => s.personId === "person2")
                                      .reduce((sum, it) => sum + it.amount, 0);
                                    setPocketPerson1Amount(p1Amt.toString());
                                    setPocketPerson2Amount(p2Amt.toString());
                                    setPocketAllocVal(
                                      (p1Amt + p2Amt).toString(),
                                    );
                                  }
                                }}
                                className={`p-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                                  pocketSplitMethod === "custom"
                                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                    : "bg-[#111111] bg-[#161616] text-[#8a8a8a] border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.04)]"
                                }`}
                              >
                                <Sliders size={13} />
                                Personnalisé
                              </button>
                            </div>
                          </div>

                          {/* Aperçu dynamique si 50_50 */}
                          {pocketSplitMethod === "50_50" && (
                            <div className="text-[11px] text-[#8a8a8a] flex items-center justify-between pt-1 border-t border-indigo-200/50 dark:border-indigo-900/30">
                              <span>
                                {p1.name} :{" "}
                                <strong
                                  style={p1Theme.textStyle}
                                  className="font-semibold"
                                >
                                  {formatEur(
                                    (pocketAllocType === "percent"
                                      ? (totalMonthlyIncome *
                                          (parseFloat(pocketAllocVal) || 0)) /
                                        100
                                      : parseFloat(pocketAllocVal) || 0) * 0.5,
                                  )}
                                </strong>{" "}
                                (50%)
                              </span>
                              <span>
                                {p2.name} :{" "}
                                <strong
                                  style={p2Theme.textStyle}
                                  className="font-semibold"
                                >
                                  {formatEur(
                                    (pocketAllocType === "percent"
                                      ? (totalMonthlyIncome *
                                          (parseFloat(pocketAllocVal) || 0)) /
                                        100
                                      : parseFloat(pocketAllocVal) || 0) * 0.5,
                                  )}
                                </strong>{" "}
                                (50%)
                              </span>
                            </div>
                          )}

                          {/* Aperçu dynamique si proportional */}
                          {pocketSplitMethod === "proportional" && (
                            <div className="text-[11px] text-[#8a8a8a] flex items-center justify-between pt-1 border-t border-indigo-200/50 dark:border-indigo-900/30">
                              <span>
                                {p1.name} :{" "}
                                <strong
                                  style={p1Theme.textStyle}
                                  className="font-semibold"
                                >
                                  {formatEur(
                                    (pocketAllocType === "percent"
                                      ? (totalMonthlyIncome *
                                          (parseFloat(pocketAllocVal) || 0)) /
                                        100
                                      : parseFloat(pocketAllocVal) || 0) *
                                      p1.incomeRatio,
                                  )}
                                </strong>{" "}
                                ({(p1.incomeRatio * 100).toFixed(1)}%)
                              </span>
                              <span>
                                {p2.name} :{" "}
                                <strong
                                  style={p2Theme.textStyle}
                                  className="font-semibold"
                                >
                                  {formatEur(
                                    (pocketAllocType === "percent"
                                      ? (totalMonthlyIncome *
                                          (parseFloat(pocketAllocVal) || 0)) /
                                        100
                                      : parseFloat(pocketAllocVal) || 0) *
                                      p2.incomeRatio,
                                  )}
                                </strong>{" "}
                                ({(p2.incomeRatio * 100).toFixed(1)}%)
                              </span>
                            </div>
                          )}

                          {/* Mode personnalisé : géré directement via les sous-sections ci-dessous */}
                          {pocketSplitMethod === "custom" && (
                            <div className="text-[11px] text-[#555555] flex items-center justify-between pt-1 border-t border-indigo-200/50 dark:border-indigo-900/30">
                              <span>
                                Les montants de chacun sont définis directement
                                dans les sous-sections ci-dessous.
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Mode d'allocation : % ou € (masqué uniquement en mode dossier personnalisé où le total est déduit de P1 + P2) */}
                  {!(
                    pocketOwnership === "dossier" &&
                    pocketSplitMethod === "custom"
                  ) && (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                          Type d'allocation *
                        </label>
                        <div className="flex rounded-lg overflow-hidden border border-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.06)] text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setPocketAllocType("percent");
                              if (
                                pocketOwnership === "dossier" &&
                                (pocketSplitMethod === "50_50" ||
                                  pocketSplitMethod === "proportional") &&
                                pocketSubItems.length > 0
                              ) {
                                const synced = syncSubItemsToDossierSplit(
                                  pocketSplitMethod,
                                  "percent",
                                  pocketAllocVal,
                                  pocketSubItems,
                                );
                                setPocketSubItems(synced);
                                const p1Amt = synced
                                  .filter((s) => s.personId === "person1")
                                  .reduce((sum, it) => sum + it.amount, 0);
                                const p2Amt = synced
                                  .filter((s) => s.personId === "person2")
                                  .reduce((sum, it) => sum + it.amount, 0);
                                setPocketPerson1Amount(p1Amt.toString());
                                setPocketPerson2Amount(p2Amt.toString());
                              }
                            }}
                            className={`flex-1 py-2 font-medium transition ${
                              pocketAllocType === "percent"
                                ? "bg-[#c8a55e] text-white"
                                : "bg-[#1a1a1a] bg-[#161616] text-[#8a8a8a] hover:bg-[#1a1a1a] dark:hover:bg-[#2a2a2a]"
                            }`}
                          >
                            Pourcentage (%)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPocketAllocType("fixed");
                              if (
                                pocketOwnership === "dossier" &&
                                (pocketSplitMethod === "50_50" ||
                                  pocketSplitMethod === "proportional") &&
                                pocketSubItems.length > 0
                              ) {
                                const synced = syncSubItemsToDossierSplit(
                                  pocketSplitMethod,
                                  "fixed",
                                  pocketAllocVal,
                                  pocketSubItems,
                                );
                                setPocketSubItems(synced);
                                const p1Amt = synced
                                  .filter((s) => s.personId === "person1")
                                  .reduce((sum, it) => sum + it.amount, 0);
                                const p2Amt = synced
                                  .filter((s) => s.personId === "person2")
                                  .reduce((sum, it) => sum + it.amount, 0);
                                setPocketPerson1Amount(p1Amt.toString());
                                setPocketPerson2Amount(p2Amt.toString());
                              }
                            }}
                            className={`flex-1 py-2 font-medium transition ${
                              pocketAllocType === "fixed"
                                ? "bg-[#c8a55e] text-white"
                                : "bg-[#1a1a1a] bg-[#161616] text-[#8a8a8a] hover:bg-[#1a1a1a] dark:hover:bg-[#2a2a2a]"
                            }`}
                          >
                            Montant fixe (€)
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                          {pocketAllocType === "percent"
                            ? "Pourcentage des entrées (%)"
                            : "Montant mensuel total (€)"}{" "}
                          *
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            required
                            placeholder={
                              pocketAllocType === "percent" ? "10" : "800"
                            }
                            value={pocketAllocVal}
                            onChange={(e) => {
                              const newVal = e.target.value;
                              setPocketAllocVal(newVal);
                              if (
                                pocketOwnership === "dossier" &&
                                (pocketSplitMethod === "50_50" ||
                                  pocketSplitMethod === "proportional") &&
                                pocketSubItems.length > 0
                              ) {
                                const synced = syncSubItemsToDossierSplit(
                                  pocketSplitMethod,
                                  pocketAllocType,
                                  newVal,
                                  pocketSubItems,
                                );
                                setPocketSubItems(synced);
                                const p1Amt = synced
                                  .filter((s) => s.personId === "person1")
                                  .reduce((sum, it) => sum + it.amount, 0);
                                const p2Amt = synced
                                  .filter((s) => s.personId === "person2")
                                  .reduce((sum, it) => sum + it.amount, 0);
                                setPocketPerson1Amount(p1Amt.toString());
                                setPocketPerson2Amount(p2Amt.toString());
                              }
                            }}
                            className="input-field pr-8 text-xs"
                          />
                          <span className="absolute right-3 top-2.5 text-xs text-[#555555] font-semibold">
                            {pocketAllocType === "percent" ? "%" : "€"}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Section Sous-sections / Sous-postes (ex: 670€ loyer, 20€ eau, 80€ elec ou PEA P1 / PEA P2) */}
                <div className="p-4 rounded-xl bg-[#111111] dark:bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] pb-2">
                    <div>
                      <h5 className="text-xs font-bold text-[#f5f5f5]">
                        {pocketOwnership === "dossier"
                          ? "Comptes individuels du dossier"
                          : "Sous-sections & Décomposition des dépenses"}
                      </h5>
                      <p className="text-[11px] text-[#555555]">
                        {pocketOwnership === "dossier"
                          ? pocketSplitMethod === "custom"
                            ? `Ajoutez ici les comptes de chacun (ex : PEA ${p1.name}, PEA ${p2.name}). Ils définissent directement les versements de chacun.`
                            : `Comptes synchronisés avec la formule choisie (${pocketSplitMethod === "50_50" ? "50/50" : "Prorata"}).`
                          : "Ex : Loyer (670€), Eau (20€), Électricité (80€), Internet (30€)..."}
                      </p>
                    </div>
                    {pocketOwnership === "dossier" &&
                    pocketSubItems.length > 0 ? (
                      pocketSplitMethod === "custom" ? (
                        <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 self-start sm:self-auto bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1 rounded-lg">
                          <CheckCircle2 size={13} />
                          Calculé via les sous-comptes (
                          {formatEur(currentSubItemsTotal)})
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const synced = syncSubItemsToDossierSplit(
                              pocketSplitMethod,
                              pocketAllocType,
                              pocketAllocVal,
                              pocketSubItems,
                            );
                            setPocketSubItems(synced);
                            const p1Amt = synced
                              .filter((s) => s.personId === "person1")
                              .reduce((sum, it) => sum + it.amount, 0);
                            const p2Amt = synced
                              .filter((s) => s.personId === "person2")
                              .reduce((sum, it) => sum + it.amount, 0);
                            setPocketPerson1Amount(p1Amt.toString());
                            setPocketPerson2Amount(p2Amt.toString());
                          }}
                          className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 self-start sm:self-auto bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-1 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition cursor-pointer"
                          title="Cliquer pour forcer la synchronisation avec la répartition choisie"
                        >
                          <CheckCircle2 size={13} />
                          Synchronisé avec la formule (
                          {formatEur(currentSubItemsTotal)})
                        </button>
                      )
                    ) : (
                      pocketSubItems.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSyncPocketAmountFromSubItems}
                          className="text-[11px] font-semibold text-[#c8a55e] text-[#c8a55e] hover:underline flex items-center gap-1 self-start sm:self-auto"
                        >
                          <CheckCircle2 size={13} />
                          Aligner le total de la poche (
                          {formatEur(currentSubItemsTotal)})
                        </button>
                      )
                    )}
                  </div>

                  {/* Liste des sous-postes existants */}
                  {pocketSubItems.length > 0 && (
                    <div className="space-y-2">
                      {pocketSubItems.map((sub) => {
                        const isEditing = editingSubItemId === sub.id;

                        if (isEditing) {
                          return (
                            <div
                              key={sub.id}
                              className="p-2.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-300 dark:border-indigo-700/70 text-xs flex flex-wrap sm:flex-nowrap items-center gap-2 animate-fade-in"
                            >
                              <input
                                type="text"
                                value={editSubName}
                                onChange={(e) => setEditSubName(e.target.value)}
                                className="flex-1 min-w-[120px] px-2.5 py-1.5 text-xs rounded-md border border-[rgba(255,255,255,0.08)] bg-[#111111] bg-[#161616] text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-primary-500"
                                placeholder="Nom du compte ou poste"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleSaveEditSubItem(sub.id);
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    handleCancelEditSubItem();
                                  }
                                }}
                              />

                              {pocketOwnership === "dossier" && (
                                <select
                                  value={editSubPersonId}
                                  onChange={(e) =>
                                    setEditSubPersonId(
                                      e.target.value as
                                        | "person1"
                                        | "person2"
                                        | "shared",
                                    )
                                  }
                                  className="px-2 py-1.5 text-xs rounded-md border border-[rgba(255,255,255,0.08)] bg-[#111111] bg-[#161616] text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-primary-500"
                                >
                                  <option value="person1">{p1.name}</option>
                                  <option value="person2">{p2.name}</option>
                                </select>
                              )}

                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editSubAmount}
                                  onChange={(e) =>
                                    setEditSubAmount(e.target.value)
                                  }
                                  className="w-24 px-2.5 py-1.5 text-xs rounded-md border border-[rgba(255,255,255,0.08)] bg-[#111111] bg-[#161616] text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-primary-500 font-bold"
                                  placeholder="Montant"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      handleSaveEditSubItem(sub.id);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      handleCancelEditSubItem();
                                    }
                                  }}
                                />
                                <span className="text-[#555555] font-medium text-xs">
                                  €/m
                                </span>
                              </div>

                              {pocketOwnership === "dossier" && (
                                <>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editSubCurrent}
                                    onChange={(e) => setEditSubCurrent(e.target.value)}
                                    className="w-24 px-2.5 py-1.5 text-xs rounded-md border border-[rgba(255,255,255,0.08)] bg-[#111111] bg-[#161616] text-[#f5f5f5]"
                                    placeholder="Capital"
                                    title="Capital actuel"
                                  />
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editSubTarget}
                                    onChange={(e) => setEditSubTarget(e.target.value)}
                                    className="w-24 px-2.5 py-1.5 text-xs rounded-md border border-[rgba(255,255,255,0.08)] bg-[#111111] bg-[#161616] text-[#f5f5f5]"
                                    placeholder="Objectif"
                                    title="Objectif individuel"
                                  />
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editSubReturnRate}
                                    onChange={(e) => setEditSubReturnRate(e.target.value)}
                                    className="w-20 px-2.5 py-1.5 text-xs rounded-md border border-[rgba(255,255,255,0.08)] bg-[#111111] bg-[#161616] text-[#f5f5f5]"
                                    placeholder="Rdt %"
                                    title="Rendement annuel (%)"
                                  />
                                </>
                              )}

                              <div className="flex items-center gap-1 ml-auto sm:ml-0">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditSubItem(sub.id)}
                                  className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-sm flex items-center justify-center"
                                  title="Valider la modification (Entrée)"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEditSubItem}
                                  className="p-1.5 rounded-md bg-[#1a1a1a] bg-[#1a1a1a] hover:bg-gray-300 dark:hover:bg-gray-600 text-[#8a8a8a] transition flex items-center justify-center"
                                  title="Annuler (Échap)"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={sub.id}
                            className="flex items-center justify-between p-2 rounded-lg bg-[#0a0a0a] bg-[#161616]/60 border border-[rgba(255,255,255,0.06)] text-xs hover:border-[rgba(255,255,255,0.08)] dark:hover:border-[rgba(255,255,255,0.06)] transition"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-[#f5f5f5]  truncate">
                                {sub.name}
                              </span>
                              {pocketOwnership === "dossier" &&
                                sub.personId && (
                                  <span
                                    style={
                                      sub.personId === "person1"
                                        ? p1Theme.badgeStyle
                                        : sub.personId === "person2"
                                          ? p2Theme.badgeStyle
                                          : undefined
                                    }
                                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                                      sub.personId !== "person1" &&
                                      sub.personId !== "person2"
                                        ? "bg-[#1a1a1a] text-[#8a8a8a] bg-[#1a1a1a] text-[#8a8a8a]"
                                        : ""
                                    }`}
                                  >
                                    {sub.personId === "person1"
                                      ? p1.name
                                      : sub.personId === "person2"
                                        ? p2.name
                                        : "Partagé"}
                                  </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="font-bold text-[#f5f5f5]">
                                {formatEur(sub.amount)} / mois
                              </span>
                              <button
                                type="button"
                                onClick={() => handleStartEditSubItem(sub)}
                                className="text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 transition p-1 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.06)]"
                                title="Modifier ce compte / sous-poste"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSubItem(sub.id)}
                                className="text-[#555555] hover:text-danger-500 transition p-1 rounded hover:bg-[#1a1a1a] hover:bg-[rgba(255,255,255,0.06)]"
                                title="Supprimer ce compte / sous-poste"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                            {pocketOwnership === "dossier" && (
                              <div className="flex gap-3 text-[10px] text-[#555555]">
                                <span>Capital : {formatEur(sub.currentAmount || 0)}</span>
                                <span>
                                  Objectif : {sub.targetAmount ? formatEur(sub.targetAmount) : "—"}
                                </span>
                                <span>
                                  Rendement : {sub.expectedReturnRate != null ? `${sub.expectedReturnRate}%` : "—"}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Résumé de ventilation */}
                      <div className="flex justify-between items-center text-[11px] pt-1 text-[#555555] font-medium">
                        <span>
                          Total des sous-sections :{" "}
                          {formatEur(currentSubItemsTotal)}
                        </span>
                        {pocketOwnership !== "dossier" &&
                          pocketAllocType === "fixed" &&
                          pocketAllocVal && (
                            <span>
                              {parseFloat(pocketAllocVal) -
                                currentSubItemsTotal ===
                              0 ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                  ✓ 100% ventilé
                                </span>
                              ) : parseFloat(pocketAllocVal) -
                                  currentSubItemsTotal >
                                0 ? (
                                <span className="text-amber-600 dark:text-amber-400">
                                  Reste non ventilé :{" "}
                                  {formatEur(
                                    parseFloat(pocketAllocVal) -
                                      currentSubItemsTotal,
                                  )}
                                </span>
                              ) : (
                                <span className="text-rose-600 dark:text-rose-400">
                                  Dépassement :{" "}
                                  {formatEur(
                                    currentSubItemsTotal -
                                      parseFloat(pocketAllocVal),
                                  )}
                                </span>
                              )}
                            </span>
                          )}
                      </div>
                    </div>
                  )}

                  {/* Ajout d'une sous-section */}
                  <div
                    className={`grid grid-cols-1 ${
                      pocketOwnership === "dossier"
                        ? "sm:grid-cols-4 lg:grid-cols-7"
                        : "sm:grid-cols-3"
                    } gap-2 pt-2`}
                  >
                    <input
                      type="text"
                      placeholder={
                        pocketOwnership === "dossier"
                          ? `Nom (ex: PEA ${p1.name})`
                          : "Nom du sous-poste (ex: Loyer)"
                      }
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      className="input-field text-xs"
                    />
                    {pocketOwnership === "dossier" && (
                      <>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Capital actuel (€)"
                          value={newSubCurrent}
                          onChange={(e) => setNewSubCurrent(e.target.value)}
                          className="input-field text-xs"
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Objectif (€)"
                          value={newSubTarget}
                          onChange={(e) => setNewSubTarget(e.target.value)}
                          className="input-field text-xs"
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Rendement %"
                          value={newSubReturnRate}
                          onChange={(e) => setNewSubReturnRate(e.target.value)}
                          className="input-field text-xs"
                        />
                      </>
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Montant en € (ex: 600)"
                      value={newSubAmount}
                      onChange={(e) => setNewSubAmount(e.target.value)}
                      className="input-field text-xs"
                    />
                    {pocketOwnership === "dossier" && (
                      <select
                        value={newSubPersonId}
                        onChange={(e) =>
                          setNewSubPersonId(
                            e.target.value as "person1" | "person2" | "shared",
                          )
                        }
                        className="input-field text-xs"
                      >
                        <option value="person1">Pour {p1.name}</option>
                        <option value="person2">Pour {p2.name}</option>
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={handleAddSubItem}
                      className="btn btn-secondary text-xs py-2 px-3 flex items-center justify-center gap-1 rounded-lg"
                    >
                      <Plus size={14} />
                      Ajouter sous-poste
                    </button>
                  </div>
                </div>

                {/* Déjà épargné, Objectif, Rendement, Couleur, Notes */}
                {pocketOwnership === "dossier" ? (
                  <div className="space-y-3 p-4 rounded-xl bg-[#1a1a1a]/70 bg-[#161616]/40 border border-[rgba(255,255,255,0.06)]">
                    <h5 className="text-xs font-bold text-[#f5f5f5]">
                      Capitaux et Objectifs individuels du Dossier
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* P1 Capital & Target */}
                      <div
                        style={p1Theme.cardStyle}
                        className="p-3 rounded-lg border space-y-2"
                      >
                        <span
                          style={p1Theme.textStyle}
                          className="text-xs font-bold block"
                        >
                          Comptes de {p1.name}
                        </span>
                        <div>
                          <label className="text-[11px] font-semibold text-[#8a8a8a] block mb-0.5">
                            Capital actuel (€)
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Ex: 8000"
                            value={pocketPerson1Current}
                            onChange={(e) => {
                              setPocketPerson1Current(e.target.value);
                              const p1Cur =
                                parseFloat(e.target.value.replace(",", ".")) ||
                                0;
                              const p2Cur =
                                parseFloat(
                                  pocketPerson2Current.replace(",", "."),
                                ) || 0;
                              setPocketCurrent((p1Cur + p2Cur).toString());
                            }}
                            className="input-field text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-[#8a8a8a] block mb-0.5">
                            Objectif cible (€)
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Optionnel (ex: 50000)"
                            value={pocketPerson1Target}
                            onChange={(e) => {
                              setPocketPerson1Target(e.target.value);
                              const p1Tgt =
                                parseFloat(e.target.value.replace(",", ".")) ||
                                0;
                              const p2Tgt =
                                parseFloat(
                                  pocketPerson2Target.replace(",", "."),
                                ) || 0;
                              setPocketTarget((p1Tgt + p2Tgt).toString());
                            }}
                            className="input-field text-xs"
                          />
                        </div>
                      </div>

                      {/* P2 Capital & Target */}
                      <div
                        style={p2Theme.cardStyle}
                        className="p-3 rounded-lg border space-y-2"
                      >
                        <span
                          style={p2Theme.textStyle}
                          className="text-xs font-bold block"
                        >
                          Comptes de {p2.name}
                        </span>
                        <div>
                          <label className="text-[11px] font-semibold text-[#8a8a8a] block mb-0.5">
                            Capital actuel (€)
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Ex: 5000"
                            value={pocketPerson2Current}
                            onChange={(e) => {
                              setPocketPerson2Current(e.target.value);
                              const p1Cur =
                                parseFloat(
                                  pocketPerson1Current.replace(",", "."),
                                ) || 0;
                              const p2Cur =
                                parseFloat(e.target.value.replace(",", ".")) ||
                                0;
                              setPocketCurrent((p1Cur + p2Cur).toString());
                            }}
                            className="input-field text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-[#8a8a8a] block mb-0.5">
                            Objectif cible (€)
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Optionnel (ex: 20000)"
                            value={pocketPerson2Target}
                            onChange={(e) => {
                              setPocketPerson2Target(e.target.value);
                              const p1Tgt =
                                parseFloat(
                                  pocketPerson1Target.replace(",", "."),
                                ) || 0;
                              const p2Tgt =
                                parseFloat(e.target.value.replace(",", ".")) ||
                                0;
                              setPocketTarget((p1Tgt + p2Tgt).toString());
                            }}
                            className="input-field text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-1">
                      <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                        Rendement annuel estimé pour ce dossier (%)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="Optionnel (ex: 7)"
                        value={pocketReturnRate}
                        onChange={(e) => setPocketReturnRate(e.target.value)}
                        className="input-field text-xs"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                        Déjà épargné (€)
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0"
                        value={pocketCurrent}
                        onChange={(e) => setPocketCurrent(e.target.value)}
                        className="input-field text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                        Objectif cible (€)
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="Optionnel (ex: 15000)"
                        value={pocketTarget}
                        onChange={(e) => setPocketTarget(e.target.value)}
                        className="input-field text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                        Rendement annuel (%)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="Optionnel (ex: 7)"
                        value={pocketReturnRate}
                        onChange={(e) => setPocketReturnRate(e.target.value)}
                        className="input-field text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* Couleur et Notes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                      Couleur du badge
                    </label>
                    <div className="flex items-center gap-2 pt-1">
                      {COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setPocketColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-6 h-6 rounded-full transition-transform ${
                            pocketColor === c
                              ? "ring-2 ring-offset-2 ring-primary-500 scale-110"
                              : ""
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#f5f5f5] block mb-1">
                      Notes / Description
                    </label>
                    <input
                      type="text"
                      placeholder="Détails, priorité, projet..."
                      value={pocketNotes}
                      onChange={(e) => setPocketNotes(e.target.value)}
                      className="input-field text-xs"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingPocket(false);
                      setEditingPocketId(null);
                      setEditingSubItemId(null);
                    }}
                    className="btn btn-secondary text-xs py-1.5 px-3"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary text-xs py-1.5 px-4 flex items-center gap-1"
                  >
                    <Check size={14} />
                    {editingPocketId ? "Enregistrer" : "Créer la poche"}
                  </button>
                </div>
              </form>
            )}

            {/* Liste des poches existantes */}
            <div className="space-y-4">
              {strategy.pockets.map((p) => {
                const pocketBreakdown = householdSummary.pocketBreakdowns[p.id];
                const monthlyEur =
                  pocketBreakdown?.monthlyAmount ??
                  getPocketMonthlyAmount(p, totalMonthlyIncome);
                const percentVal = getPocketPercent(p, totalMonthlyIncome);
                const catLabel = CATEGORY_META[p.category]?.label || p.category;
                const ownership = p.ownership || "shared";
                const isDossierPocket =
                  household.enabled && ownership === "dossier";
                const hasDossierTargets =
                  isDossierPocket &&
                  ((p.person1Target != null && p.person1Target > 0) ||
                    (p.person2Target != null && p.person2Target > 0));
                const hasTarget =
                  (p.targetAmount != null && p.targetAmount > 0) ||
                  hasDossierTargets;
                const progressPct =
                  hasTarget && p.targetAmount! > 0
                    ? Math.min(
                        100,
                        ((p.currentAmount || 0) / p.targetAmount!) * 100,
                      )
                    : null;

                const p1SubTotal = (p.subItems || [])
                  .filter((s) => s.personId === "person1")
                  .reduce((sum, s) => sum + (s.amount || 0), 0);
                const p2SubTotal = (p.subItems || [])
                  .filter((s) => s.personId === "person2")
                  .reduce((sum, s) => sum + (s.amount || 0), 0);

                const breakdown = pocketBreakdown || {
                  monthlyAmount: monthlyEur,
                  paidByP1: monthlyEur * 0.5,
                  paidByP2: monthlyEur * 0.5,
                  ownership: "shared" as PocketOwnership,
                  subItemsTotal: 0,
                };

                const isExpanded = !!expandedPockets[p.id];
                const hasSubItems = p.subItems && p.subItems.length > 0;

                // View filter highlights
                const isDimmed =
                  ownership !== "dossier" &&
                  ((viewFilter === "person1" && ownership === "person2") ||
                    (viewFilter === "person2" && ownership === "person1"));

                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-xl transition ${
                      isDimmed
                        ? "opacity-45 bg-[#0a0a0a]/40 bg-[#161616]/20"
                        : "bg-[#0a0a0a]/80 bg-[#161616]/50 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
                          style={{ backgroundColor: p.color }}
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-[#f5f5f5]">
                              {p.name}
                            </h4>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#1a1a1a]/80 bg-[#1a1a1a] text-[#8a8a8a]">
                              {catLabel}
                            </span>
                            {/* Ownership Badge */}
                            {household.enabled && (
                              <span
                                style={
                                  ownership === "person1"
                                    ? p1Theme.badgeStyle
                                    : ownership === "person2"
                                      ? p2Theme.badgeStyle
                                      : ownership === "shared"
                                        ? p1Theme.badgeStyle
                                        : undefined
                                }
                                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                  ownership === "dossier"
                                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                                    : ""
                                }`}
                              >
                                {ownership === "dossier" ? (
                                  <span className="flex items-center gap-1">
                                    <Folder size={11} /> Dossier (
                                    {p.splitMethod === "50_50"
                                      ? "50/50"
                                      : p.splitMethod === "proportional"
                                        ? "Prorata"
                                        : "Personnalisé"}
                                    )
                                  </span>
                                ) : ownership === "shared" ? (
                                  p.splitMethod === "50_50" ? (
                                    <span className="flex items-center gap-1">
                                      <Split size={11} /> 50/50
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-1">
                                      <Scale size={11} /> Prorata
                                    </span>
                                  )
                                ) : (
                                  `Personnel ${
                                    ownership === "person1" ? p1.name : p2.name
                                  }`
                                )}
                              </span>
                            )}
                            {p.expectedReturnRate ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                                +{p.expectedReturnRate}% / an
                              </span>
                            ) : null}
                          </div>
                          {p.notes && (
                            <p className="text-xs text-[#555555] mt-0.5">
                              {p.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Montants & Actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-4">
                        <div className="text-right">
                          <p className="text-base font-bold text-[#f5f5f5]">
                            {formatEur(monthlyEur)}{" "}
                            <span className="text-xs font-normal text-[#555555]">
                              / mois
                            </span>
                          </p>
                          <p
                            className="text-xs font-semibold"
                            style={{ color: p.color }}
                          >
                            {percentVal.toFixed(1)}% des revenus
                          </p>
                          {/* Details by person if shared */}
                          {household.enabled && ownership === "shared" && (
                            <p className="text-[11px] text-[#555555] mt-0.5">
                              {viewFilter === "person1" ? (
                                <strong style={p1Theme.textStyle}>
                                  Votre part : {formatEur(breakdown.paidByP1)} /
                                  mois
                                </strong>
                              ) : viewFilter === "person2" ? (
                                <strong style={p2Theme.textStyle}>
                                  Votre part : {formatEur(breakdown.paidByP2)} /
                                  mois
                                </strong>
                              ) : (
                                <>
                                  <span
                                    style={p1Theme.textStyle}
                                    className="font-medium"
                                  >
                                    {p1.name}: {formatEur(breakdown.paidByP1)}
                                  </span>{" "}
                                  •{" "}
                                  <span
                                    style={p2Theme.textStyle}
                                    className="font-medium"
                                  >
                                    {p2.name}: {formatEur(breakdown.paidByP2)}
                                  </span>
                                </>
                              )}
                            </p>
                          )}
                          {/* Details by person if dossier */}
                          {household.enabled && ownership === "dossier" && (
                            <p className="text-[11px] text-[#555555] mt-0.5">
                              {viewFilter === "person1" ? (
                                <strong style={p1Theme.textStyle}>
                                  Votre part :{" "}
                                  {formatEur(
                                    householdSummary.pocketBreakdowns[p.id]
                                      ?.paidByP1 ??
                                      (p.person1Amount || 0),
                                  )}{" "}
                                  / mois
                                </strong>
                              ) : viewFilter === "person2" ? (
                                <strong style={p2Theme.textStyle}>
                                  Votre part :{" "}
                                  {formatEur(
                                    householdSummary.pocketBreakdowns[p.id]
                                      ?.paidByP2 ??
                                      (p.person2Amount || 0),
                                  )}{" "}
                                  / mois
                                </strong>
                              ) : (
                                <>
                                  <span
                                    style={p1Theme.textStyle}
                                    className="font-medium"
                                  >
                                    {p1.name}:{" "}
                                    {formatEur(
                                      householdSummary.pocketBreakdowns[p.id]
                                        ?.paidByP1 ??
                                        (p.person1Amount || 0),
                                    )}
                                  </span>{" "}
                                  •{" "}
                                  <span
                                    style={p2Theme.textStyle}
                                    className="font-medium"
                                  >
                                    {p2.name}:{" "}
                                    {formatEur(
                                      householdSummary.pocketBreakdowns[p.id]
                                        ?.paidByP2 ??
                                        (p.person2Amount || 0),
                                    )}
                                  </span>
                                </>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditPocket(p)}
                            className="p-1.5 text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 transition rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
                            title="Modifier"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePocket(p.id)}
                            className="p-1.5 text-[#555555] hover:text-danger-500 transition rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
                            title="Supprimer"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Sub-sections toggle button */}
                    {hasSubItems && (
                      <div className="mt-3 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                        <button
                          type="button"
                          onClick={() => toggleExpandPocket(p.id)}
                          className="text-xs font-semibold text-[#8a8a8a] hover:text-[#c8a55e] dark:hover:text-primary-400 flex items-center gap-1.5 transition"
                        >
                          <Layers size={13} className="text-primary-500" />
                          <span>
                            {p.subItems!.length} sous-section
                            {p.subItems!.length > 1 ? "s" : ""} (
                            {p.subItems!.map((s) => s.name).join(", ")})
                          </span>
                          {isExpanded ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>

                        {/* Accordion content */}
                        {isExpanded && (
                          <div className="mt-3 space-y-2.5 pl-4 border-l-2 border-[#c8a55e]/40 animate-fade-in">
                            {/* Barres pour les sous-sections : 2 barres distinctes pour les dossiers */}
                            {ownership === "dossier" ? (
                              <div className="space-y-1.5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <div
                                      className="flex justify-between text-[11px] mb-0.5 font-medium"
                                      style={p1Theme.textStyle}
                                    >
                                      <span>
                                        {p1.name} : {formatEur(p1SubTotal)} /
                                        mois
                                      </span>
                                      <span>
                                        {monthlyEur > 0
                                          ? (
                                              (p1SubTotal / monthlyEur) *
                                              100
                                            ).toFixed(0)
                                          : 0}
                                        %
                                      </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-[#1a1a1a] bg-[#1a1a1a] rounded-full overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{
                                          ...p1Theme.barStyle,
                                          width: `${monthlyEur > 0 ? Math.min(100, (p1SubTotal / monthlyEur) * 100) : 0}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <div
                                      className="flex justify-between text-[11px] mb-0.5 font-medium"
                                      style={p2Theme.textStyle}
                                    >
                                      <span>
                                        {p2.name} : {formatEur(p2SubTotal)} /
                                        mois
                                      </span>
                                      <span>
                                        {monthlyEur > 0
                                          ? (
                                              (p2SubTotal / monthlyEur) *
                                              100
                                            ).toFixed(0)
                                          : 0}
                                        %
                                      </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-[#1a1a1a] bg-[#1a1a1a] rounded-full overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{
                                          ...p2Theme.barStyle,
                                          width: `${monthlyEur > 0 ? Math.min(100, (p2SubTotal / monthlyEur) * 100) : 0}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* Stacked mini progress bar */
                              <div className="h-2 w-full bg-[#1a1a1a] bg-[#1a1a1a] rounded-full overflow-hidden flex">
                                {p.subItems!.map((sub, sIdx) => {
                                  const subPct =
                                    monthlyEur > 0
                                      ? (sub.amount / monthlyEur) * 100
                                      : 0;
                                  const subColors = [
                                    "#3b82f6",
                                    "#10b981",
                                    "#f59e0b",
                                    "#8b5cf6",
                                    "#ec4899",
                                    "#06b6d4",
                                  ];
                                  const barColor =
                                    subColors[sIdx % subColors.length];
                                  return (
                                    <div
                                      key={sub.id}
                                      title={`${sub.name}: ${formatEur(sub.amount)} (${subPct.toFixed(1)}%)`}
                                      style={{
                                        width: `${subPct}%`,
                                        backgroundColor: barColor,
                                      }}
                                      className="h-full"
                                    />
                                  );
                                })}
                              </div>
                            )}

                            {/* Sub items list */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              {p.subItems!.map((sub, sIdx) => {
                                const subPct =
                                  monthlyEur > 0
                                    ? (sub.amount / monthlyEur) * 100
                                    : 0;
                                const subColors = [
                                  "#3b82f6",
                                  "#10b981",
                                  "#f59e0b",
                                  "#8b5cf6",
                                  "#ec4899",
                                  "#06b6d4",
                                ];
                                const dotColor =
                                  subColors[sIdx % subColors.length];

                                // Split calculation for this sub-item
                                const pocketSplitMode: SplitMode =
                                  p.splitMethod ||
                                  household.splitMode ||
                                  "proportional";
                                const pocketSplitRatioP1 =
                                  pocketSplitMode === "50_50"
                                    ? 0.5
                                    : householdSummary.splitRatioP1;
                                const pocketSplitRatioP2 =
                                  pocketSplitMode === "50_50"
                                    ? 0.5
                                    : householdSummary.splitRatioP2;

                                const p1Sub =
                                  ownership === "dossier"
                                    ? sub.personId === "person1"
                                      ? sub.amount
                                      : sub.personId === "person2"
                                        ? 0
                                        : sub.amount * pocketSplitRatioP1
                                    : ownership === "person1"
                                      ? sub.amount
                                      : ownership === "person2"
                                        ? 0
                                        : sub.personId === "person1"
                                          ? sub.amount
                                          : sub.personId === "person2"
                                            ? 0
                                            : sub.amount * pocketSplitRatioP1;

                                const p2Sub =
                                  ownership === "dossier"
                                    ? sub.personId === "person2"
                                      ? sub.amount
                                      : sub.personId === "person1"
                                        ? 0
                                        : sub.amount * pocketSplitRatioP2
                                    : ownership === "person2"
                                      ? sub.amount
                                      : ownership === "person1"
                                        ? 0
                                        : sub.personId === "person2"
                                          ? sub.amount
                                          : sub.personId === "person1"
                                            ? 0
                                            : sub.amount * pocketSplitRatioP2;

                                return (
                                  <div
                                    key={sub.id}
                                    className="flex items-center justify-between p-2 rounded-lg bg-[#111111] bg-[#161616] border border-[rgba(255,255,255,0.06)]"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: dotColor }}
                                      />
                                      <span className="font-semibold text-[#f5f5f5] ">
                                        {sub.name}
                                      </span>
                                      {ownership === "dossier" &&
                                        sub.personId && (
                                          <span
                                            style={
                                              sub.personId === "person1"
                                                ? p1Theme.badgeStyle
                                                : sub.personId === "person2"
                                                  ? p2Theme.badgeStyle
                                                  : undefined
                                            }
                                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                                              sub.personId !== "person1" &&
                                              sub.personId !== "person2"
                                                ? "bg-[#1a1a1a] text-[#8a8a8a] bg-[#161616] text-[#555555]"
                                                : ""
                                            }`}
                                          >
                                            {sub.personId === "person1"
                                              ? p1.name
                                              : p2.name}
                                          </span>
                                        )}
                                    </div>
                                    <div className="text-right">
                                      <span className="font-bold text-[#f5f5f5]">
                                        {formatEur(sub.amount)}
                                      </span>
                                      <span className="text-[10px] text-[#555555] block">
                                        {subPct.toFixed(0)}% de la poche
                                        {household.enabled &&
                                          ownership === "shared" && (
                                            <>
                                              {" "}
                                              • {p1.name.slice(0, 3)}:{" "}
                                              {formatEur(p1Sub)} /{" "}
                                              {p2.name.slice(0, 3)}:{" "}
                                              {formatEur(p2Sub)}
                                            </>
                                          )}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bouton rapide d'ajout de sous-sections si vide */}
                    {!hasSubItems && (
                      <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                        <button
                          type="button"
                          onClick={() => openEditPocket(p)}
                          className="text-[11px] text-[#555555] hover:text-[#c8a55e] dark:hover:text-primary-400 flex items-center gap-1 transition"
                        >
                          <Plus size={12} />
                          Détailler cette poche en sous-sections (ex : Loyer,
                          Eau, Électricité...)
                        </button>
                      </div>
                    )}

                    {/* Progression si objectif cible défini */}
                    {hasTarget && (
                      <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                        {isDossierPocket &&
                        (p.person1Target || p.person2Target) ? (
                          /* Pour les dossiers : 2 barres individuelles au lieu d'une barre commune */
                          <div className="space-y-2.5">
                            {/* Barre Personne 1 */}
                            {(!viewFilter ||
                              viewFilter === "all" ||
                              viewFilter === "person1") &&
                            p.person1Target != null &&
                            p.person1Target > 0 ? (
                              <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="w-2 h-2 rounded-full"
                                      style={p1Theme.dotStyle}
                                    />
                                    <span
                                      className="font-semibold"
                                      style={p1Theme.textStyle}
                                    >
                                      {p1.name}
                                    </span>
                                    <span className="text-[#555555] text-[11px]">
                                      (Actuel :{" "}
                                      {formatEur(p.person1Current || 0)} /
                                      Objectif : {formatEur(p.person1Target)})
                                    </span>
                                  </div>
                                  <span
                                    className="font-bold"
                                    style={p1Theme.textStyle}
                                  >
                                    {(
                                      ((p.person1Current || 0) /
                                        p.person1Target) *
                                      100
                                    ).toFixed(1)}
                                    %
                                  </span>
                                </div>
                                <div className="w-full bg-[#1a1a1a] bg-[#1a1a1a] h-2 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      ...p1Theme.barStyle,
                                      width: `${Math.min(
                                        100,
                                        ((p.person1Current || 0) /
                                          p.person1Target) *
                                          100,
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ) : null}

                            {/* Barre Personne 2 */}
                            {(!viewFilter ||
                              viewFilter === "all" ||
                              viewFilter === "person2") &&
                            p.person2Target != null &&
                            p.person2Target > 0 ? (
                              <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="w-2 h-2 rounded-full"
                                      style={p2Theme.dotStyle}
                                    />
                                    <span
                                      className="font-semibold"
                                      style={p2Theme.textStyle}
                                    >
                                      {p2.name}
                                    </span>
                                    <span className="text-[#555555] text-[11px]">
                                      (Actuel :{" "}
                                      {formatEur(p.person2Current || 0)} /
                                      Objectif : {formatEur(p.person2Target)})
                                    </span>
                                  </div>
                                  <span
                                    className="font-bold"
                                    style={p2Theme.textStyle}
                                  >
                                    {(
                                      ((p.person2Current || 0) /
                                        p.person2Target) *
                                      100
                                    ).toFixed(1)}
                                    %
                                  </span>
                                </div>
                                <div className="w-full bg-[#1a1a1a] bg-[#1a1a1a] h-2 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      ...p2Theme.barStyle,
                                      width: `${Math.min(
                                        100,
                                        ((p.person2Current || 0) /
                                          p.person2Target) *
                                          100,
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          /* Barre commune standard pour les poches partagées ou solo */
                          <div>
                            <div className="flex items-center justify-between text-xs text-[#555555] mb-1">
                              <span>
                                Objectif :{" "}
                                <strong className="text-[#f5f5f5] ">
                                  {formatEur(p.targetAmount!)}
                                </strong>{" "}
                                (Actuel : {formatEur(p.currentAmount || 0)})
                              </span>
                              <span className="font-semibold text-[#8a8a8a]">
                                {progressPct!.toFixed(1)}%
                              </span>
                            </div>
                            <div className="w-full bg-[#1a1a1a] bg-[#1a1a1a] h-2 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  width: `${progressPct}%`,
                                  backgroundColor: p.color,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Section Simulateur & Projections dans le temps (masquée : projections non nécessaires ici) */}
      {showProjections && (
        <div className="card p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-[#f5f5f5]">
                Simulateur & Prévisions d'Évolution de l'Épargne
              </h2>
              <p className="text-xs text-[#555555] mt-0.5">
                Visualisez le capital accumulé dans le temps grâce à vos
                versements réguliers et aux intérêts composés.
              </p>
            </div>

            {/* Horizon Pills */}
            <div className="flex items-center gap-1.5 p-1 bg-[#1a1a1a] bg-[#161616] rounded-xl border border-[rgba(255,255,255,0.06)] self-start md:self-auto">
              {HORIZON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSelectedHorizon(opt.value);
                    updateStrategy({ ...strategy, horizonYears: opt.value });
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                    selectedHorizon === opt.value
                      ? "bg-[#c8a55e] text-white shadow-sm"
                      : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Projection KPI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-[#0a0a0a]/70 bg-[#161616]/40 p-4 rounded-xl border border-[rgba(255,255,255,0.06)]">
            <div>
              <p className="text-xs text-[#555555]">
                Total projeté à {selectedHorizon} an
                {selectedHorizon > 1 ? "s" : ""}
              </p>
              <p className="text-xl font-bold text-[#c8a55e] text-[#c8a55e] mt-0.5">
                {formatEur(projection.totalProjectedAtHorizon)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#555555]">
                Épargne & Investissement accumulé
              </p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {formatEur(projection.totalSavingsPocketsAtHorizon)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#555555]">
                Effort d'épargne mensuel
              </p>
              <p className="text-xl font-bold text-[#f5f5f5] mt-0.5">
                {formatEur(householdSummary.totalSavingsEur)}{" "}
                <span className="text-xs font-normal text-[#555555]">
                  / mois
                </span>
              </p>
            </div>
          </div>

          {/* Area Chart Projection */}
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={projection.dataPoints}
                margin={{ top: 10, right: 20, left: 20, bottom: 0 }}
              >
                <defs>
                  {projection.series.map((series) => (
                    <linearGradient
                      key={`grad-${series.id}`}
                      id={`grad-${series.id}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={series.color} stopOpacity={0.6} />
                      <stop
                        offset="95%"
                        stopColor={series.color}
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#374151"
                  opacity={0.2}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  axisLine={{ stroke: "#4b5563", opacity: 0.3 }}
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  axisLine={{ stroke: "#4b5563", opacity: 0.3 }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(0)}k€`}
                />
                <RechartsTooltip
                  formatter={(val: number, name: string) => [
                    formatEur(Number(val)),
                    name,
                  ]}
                  labelFormatter={(label) => `Échéance : ${label}`}
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: "10px",
                    color: "#f8fafc",
                    fontSize: "12px",
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.4)",
                  }}
                />
                {projection.series.map((series) => (
                  <Area
                    key={series.id}
                    type="monotone"
                    dataKey={series.id}
                    name={series.name}
                    stroke={series.color}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill={`url(#grad-${series.id})`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Estimation de la réalisation des Objectifs (Poches avec cibles) */}
          {(() => {
            const formatGoalDuration = (
              monthsNeeded: number | null,
            ): string => {
              if (monthsNeeded == null) return "";
              if (monthsNeeded < 12) return `${monthsNeeded} mois`;
              const years = Math.floor(monthsNeeded / 12);
              const rem = monthsNeeded % 12;
              return `${years} an${years > 1 ? "s" : ""}${rem > 0 ? ` et ${rem} mois` : ""}`;
            };

            const visibleGoals = projection.goalEstimations.filter((g) => {
              if (!viewFilter || viewFilter === "all") return true;
              if (g.isDossier) {
                if (viewFilter === "person1") {
                  return (g.dossierDetails?.person1.targetAmount || 0) > 0;
                }
                if (viewFilter === "person2") {
                  return (g.dossierDetails?.person2.targetAmount || 0) > 0;
                }
              }
              if (viewFilter === "person1") {
                return (
                  g.personId === "person1" ||
                  g.personId === "shared" ||
                  !g.personId
                );
              }
              if (viewFilter === "person2") {
                return (
                  g.personId === "person2" ||
                  g.personId === "shared" ||
                  !g.personId
                );
              }
              return true;
            });

            if (visibleGoals.length === 0) return null;

            return (
              <div className="pt-4 border-t border-[rgba(255,255,255,0.06)]">
                <h3 className="text-sm font-bold text-[#f5f5f5] mb-3">
                  Échéancier Prévisionnel des Objectifs Cibles
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleGoals.map((g) => {
                    if (g.isDossier && g.dossierDetails) {
                      const showP1 =
                        (!viewFilter ||
                          viewFilter === "all" ||
                          viewFilter === "person1") &&
                        g.dossierDetails.person1.targetAmount > 0;
                      const showP2 =
                        (!viewFilter ||
                          viewFilter === "all" ||
                          viewFilter === "person2") &&
                        g.dossierDetails.person2.targetAmount > 0;

                      return (
                        <div
                          key={g.pocketId}
                          className={`p-4 rounded-xl bg-[#0a0a0a]/90 bg-[#161616]/60 border border-[rgba(255,255,255,0.06)] flex flex-col justify-between ${
                            showP1 && showP2
                              ? "md:col-span-2 lg:col-span-2"
                              : ""
                          }`}
                        >
                          <div>
                            {/* En-tête du Dossier Groupé */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[rgba(255,255,255,0.06)]">
                              <div className="flex items-center gap-2 min-w-0">
                                <h4 className="text-sm font-bold text-[#f5f5f5] truncate">
                                  {g.pocketName}
                                </h4>
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 flex-shrink-0">
                                  Dossier ({p1.name} & {p2.name})
                                </span>
                                {g.expectedReturnRate > 0 && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 flex-shrink-0">
                                    +{g.expectedReturnRate}% / an
                                  </span>
                                )}
                              </div>
                              <div className="text-right flex-shrink-0 text-xs">
                                <span className="text-[#555555]">
                                  Total cible :{" "}
                                  <strong className="text-[#f5f5f5] font-bold">
                                    {formatEur(g.targetAmount)}
                                  </strong>
                                </span>
                                <span className="text-[#555555] ml-1.5 font-medium">
                                  ({formatEur(g.monthlySavings)} / mois)
                                </span>
                              </div>
                            </div>

                            {/* Décomposition individuelle des comptes du dossier dans ce même bloc */}
                            <div
                              className={`grid grid-cols-1 ${
                                showP1 && showP2 ? "sm:grid-cols-2" : ""
                              } gap-3 mt-3`}
                            >
                              {/* Compte Personne 1 */}
                              {showP1 && (
                                <div
                                  style={p1Theme.cardStyle}
                                  className="p-3.5 rounded-xl border flex flex-col justify-between space-y-2.5"
                                >
                                  <div>
                                    <div className="flex items-center justify-between gap-1.5 mb-2">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span
                                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                          style={p1Theme.dotStyle}
                                        />
                                        <h5 className="text-xs font-bold text-[#f5f5f5] truncate">
                                          {g.dossierDetails.person1
                                            .subItemName ||
                                            `${g.pocketName} ${p1.name}`}
                                        </h5>
                                        <span
                                          style={p1Theme.badgeStyle}
                                          className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                                        >
                                          {p1.name}
                                        </span>
                                      </div>
                                      <span
                                        style={
                                          !g.dossierDetails.person1.isReached &&
                                          g.dossierDetails.person1
                                            .monthsNeeded != null
                                            ? p1Theme.badgeStyle
                                            : undefined
                                        }
                                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                                          g.dossierDetails.person1.isReached
                                            ? "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300"
                                            : g.dossierDetails.person1
                                                  .monthsNeeded != null
                                              ? ""
                                              : "bg-[#1a1a1a] text-[#8a8a8a] bg-[#1a1a1a] text-[#8a8a8a]"
                                        }`}
                                      >
                                        {g.dossierDetails.person1.isReached
                                          ? "Atteint !"
                                          : g.dossierDetails.person1
                                                .monthsNeeded != null
                                            ? g.dossierDetails.person1
                                                .projectedDate
                                            : "Non atteignable"}
                                      </span>
                                    </div>

                                    <div className="text-xs text-[#8a8a8a] space-y-1">
                                      <div className="flex justify-between">
                                        <span className="text-[#555555]">
                                          Objectif :
                                        </span>
                                        <strong className="text-[#f5f5f5] font-semibold">
                                          {formatEur(
                                            g.dossierDetails.person1
                                              .targetAmount,
                                          )}
                                        </strong>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-[#555555]">
                                          Capital actuel :
                                        </span>
                                        <span className="text-[#f5f5f5]  font-semibold">
                                          {formatEur(
                                            g.dossierDetails.person1
                                              .currentAmount,
                                          )}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-[#555555]">
                                          Épargne mensuelle :
                                        </span>
                                        <strong className="text-[#f5f5f5] font-semibold">
                                          {formatEur(
                                            g.dossierDetails.person1
                                              .monthlySavings,
                                          )}{" "}
                                          / mois
                                        </strong>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="pt-2 border-t border-[rgba(255,255,255,0.06)]">
                                    <p
                                      className="text-[11px] flex items-center gap-1 font-medium"
                                      style={p1Theme.textStyle}
                                    >
                                      <Info
                                        size={13}
                                        className="flex-shrink-0"
                                        style={p1Theme.textStyle}
                                      />
                                      {g.dossierDetails.person1.isReached
                                        ? "Objectif déjà complété !"
                                        : g.dossierDetails.person1
                                              .monthsNeeded != null
                                          ? `Atteint dans environ ${formatGoalDuration(g.dossierDetails.person1.monthsNeeded)}`
                                          : "Augmentez le versement mensuel"}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Compte Personne 2 */}
                              {showP2 && (
                                <div
                                  style={p2Theme.cardStyle}
                                  className="p-3.5 rounded-xl border flex flex-col justify-between space-y-2.5"
                                >
                                  <div>
                                    <div className="flex items-center justify-between gap-1.5 mb-2">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span
                                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                          style={p2Theme.dotStyle}
                                        />
                                        <h5 className="text-xs font-bold text-[#f5f5f5] truncate">
                                          {g.dossierDetails.person2
                                            .subItemName ||
                                            `${g.pocketName} ${p2.name}`}
                                        </h5>
                                        <span
                                          style={p2Theme.badgeStyle}
                                          className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                                        >
                                          {p2.name}
                                        </span>
                                      </div>
                                      <span
                                        style={
                                          !g.dossierDetails.person2.isReached &&
                                          g.dossierDetails.person2
                                            .monthsNeeded != null
                                            ? p2Theme.badgeStyle
                                            : undefined
                                        }
                                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                                          g.dossierDetails.person2.isReached
                                            ? "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300"
                                            : g.dossierDetails.person2
                                                  .monthsNeeded != null
                                              ? ""
                                              : "bg-[#1a1a1a] text-[#8a8a8a] bg-[#1a1a1a] text-[#8a8a8a]"
                                        }`}
                                      >
                                        {g.dossierDetails.person2.isReached
                                          ? "Atteint !"
                                          : g.dossierDetails.person2
                                                .monthsNeeded != null
                                            ? g.dossierDetails.person2
                                                .projectedDate
                                            : "Non atteignable"}
                                      </span>
                                    </div>

                                    <div className="text-xs text-[#8a8a8a] space-y-1">
                                      <div className="flex justify-between">
                                        <span className="text-[#555555]">
                                          Objectif :
                                        </span>
                                        <strong className="text-[#f5f5f5] font-semibold">
                                          {formatEur(
                                            g.dossierDetails.person2
                                              .targetAmount,
                                          )}
                                        </strong>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-[#555555]">
                                          Capital actuel :
                                        </span>
                                        <span className="text-[#f5f5f5]  font-semibold">
                                          {formatEur(
                                            g.dossierDetails.person2
                                              .currentAmount,
                                          )}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-[#555555]">
                                          Épargne mensuelle :
                                        </span>
                                        <strong className="text-[#f5f5f5] font-semibold">
                                          {formatEur(
                                            g.dossierDetails.person2
                                              .monthlySavings,
                                          )}{" "}
                                          / mois
                                        </strong>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="pt-2 border-t border-[rgba(255,255,255,0.06)]">
                                    <p
                                      className="text-[11px] flex items-center gap-1 font-medium"
                                      style={p2Theme.textStyle}
                                    >
                                      <Info
                                        size={13}
                                        className="flex-shrink-0"
                                        style={p2Theme.textStyle}
                                      />
                                      {g.dossierDetails.person2.isReached
                                        ? "Objectif déjà complété !"
                                        : g.dossierDetails.person2
                                              .monthsNeeded != null
                                          ? `Atteint dans environ ${formatGoalDuration(g.dossierDetails.person2.monthsNeeded)}`
                                          : "Augmentez le versement mensuel"}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Carte de poche standard (individuelle ou partagée)
                    return (
                      <div
                        key={g.pocketId}
                        className="p-4 rounded-xl bg-[#0a0a0a]/90 bg-[#161616]/60 border border-[rgba(255,255,255,0.06)] flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <h4 className="text-sm font-bold text-[#f5f5f5] truncate">
                                {g.pocketName}
                              </h4>
                              {household.enabled && g.personId && (
                                <span
                                  style={
                                    g.personId === "person1"
                                      ? p1Theme.badgeStyle
                                      : g.personId === "person2"
                                        ? p2Theme.badgeStyle
                                        : p1Theme.badgeStyle
                                  }
                                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                                >
                                  {g.personId === "person1"
                                    ? p1.name
                                    : g.personId === "person2"
                                      ? p2.name
                                      : "Commun"}
                                </span>
                              )}
                            </div>
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                                g.isReached
                                  ? "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300"
                                  : g.monthsNeeded != null
                                    ? "bg-[rgba(200,165,94,0.12)] text-[#c8a55e] dark:bg-primary-900/40 text-[#c8a55e]"
                                    : "bg-[#1a1a1a] text-[#8a8a8a] bg-[#1a1a1a] text-[#8a8a8a]"
                              }`}
                            >
                              {g.isReached
                                ? "Atteint !"
                                : g.monthsNeeded != null
                                  ? g.projectedDate
                                  : "Non atteignable"}
                            </span>
                          </div>

                          <div className="mt-2 text-xs text-[#555555] space-y-1">
                            <div className="flex justify-between">
                              <span>Objectif :</span>
                              <strong className="text-[#f5f5f5] ">
                                {formatEur(g.targetAmount)}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span>Capital actuel :</span>
                              <span className="text-[#8a8a8a] font-semibold">
                                {formatEur(g.currentAmount)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Épargne mensuelle :</span>
                              <strong className="text-[#f5f5f5] ">
                                {formatEur(g.monthlySavings)} / mois
                              </strong>
                            </div>
                            {g.expectedReturnRate > 0 && (
                              <div className="flex justify-between">
                                <span>Rendement composé :</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                  +{g.expectedReturnRate}% / an
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                          <p className="text-[11px] text-[#8a8a8a] flex items-center gap-1 font-medium">
                            <Info
                              size={13}
                              className="text-primary-500 flex-shrink-0"
                            />
                            {g.isReached
                              ? "Objectif déjà complété avec succès !"
                              : g.monthsNeeded != null
                                ? `Atteint dans environ ${formatGoalDuration(g.monthsNeeded)}`
                                : "Augmentez le versement mensuel pour atteindre cette cible."}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default SavingsStrategyPage;
