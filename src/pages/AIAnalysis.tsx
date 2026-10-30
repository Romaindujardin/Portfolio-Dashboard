// Conseiller IA : l'utilisateur joint ses comptes, ses lignes, son portefeuille
// crypto, son immobilier, son budget réel, ses placements réels, sa stratégie
// et l'analyse look-through de ses ETF. L'IA dispose d'outils (tools) en direct
// pour interroger les cours, décomposer des ETF, simuler des placements et rééquilibrer.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Check,
  Clock,
  Coins,
  Copy,
  Database,
  Landmark,
  Loader2,
  PiggyBank,
  Receipt,
  RotateCcw,
  Send,
  Sparkles,
  TrendingUp,
  User,
  Wrench,
  X,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { useCurrency, formatMoney } from "../contexts/CurrencyContext";
import { getGeminiApiKey } from "../utils/userSettings";
import {
  collectAiContext,
  DEFAULT_AI_CONTEXT_SELECTION,
  getAiContextPreview,
  type AiContextMeta,
  type AiContextPreview,
  type AiContextSelection,
} from "../utils/aiContext";
import {
  askGeminiAdvisor,
  type AdvisorMessage,
} from "../utils/geminiAI";
import type { LucideIcon } from "lucide-react";
import RichText from "../components/RichText";

const SELECTION_STORAGE_PREFIX = "ai_context_selection_";
const CONVERSATION_STORAGE_PREFIX = "ai_advisor_conversation_";

interface StoredConversation {
  messages: AdvisorMessage[];
  selection: AiContextSelection;
}

const loadSelection = (username: string): AiContextSelection => {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_PREFIX + username);
    if (!raw) return { ...DEFAULT_AI_CONTEXT_SELECTION };
    const parsed = JSON.parse(raw) as Partial<AiContextSelection>;
    return {
      accounts: parsed.accounts !== false,
      properties_loans: parsed.properties_loans !== false,
      crypto: parsed.crypto !== false,
      budget: parsed.budget !== false,
      savings: parsed.savings !== false,
      strategy: parsed.strategy !== false,
      market_lookthrough: parsed.market_lookthrough !== false,
      history_performance: parsed.history_performance !== false,
    };
  } catch {
    return { ...DEFAULT_AI_CONTEXT_SELECTION };
  }
};

const saveSelection = (
  username: string,
  selection: AiContextSelection,
): void => {
  try {
    localStorage.setItem(
      SELECTION_STORAGE_PREFIX + username,
      JSON.stringify(selection),
    );
  } catch {
    // stockage indisponible : la sélection reste en mémoire
  }
};

const loadConversation = (username: string): StoredConversation | null => {
  try {
    const raw = localStorage.getItem(CONVERSATION_STORAGE_PREFIX + username);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConversation> | null;
    const messages = Array.isArray(parsed?.messages)
      ? parsed!.messages.filter(
          (m): m is AdvisorMessage =>
            (m?.role === "user" || m?.role === "assistant") &&
            typeof m?.text === "string",
        )
      : [];
    return {
      messages,
      selection: {
        accounts: parsed?.selection?.accounts !== false,
        properties_loans: parsed?.selection?.properties_loans !== false,
        crypto: parsed?.selection?.crypto !== false,
        budget: parsed?.selection?.budget !== false,
        savings: parsed?.selection?.savings !== false,
        strategy: parsed?.selection?.strategy !== false,
        market_lookthrough: parsed?.selection?.market_lookthrough !== false,
        history_performance: parsed?.selection?.history_performance !== false,
      },
    };
  } catch {
    return null;
  }
};

const saveConversation = (
  username: string,
  conversation: StoredConversation,
): void => {
  try {
    localStorage.setItem(
      CONVERSATION_STORAGE_PREFIX + username,
      JSON.stringify(conversation),
    );
  } catch {
    // stockage indisponible : la conversation reste en mémoire
  }
};

const clearStoredConversation = (username: string): void => {
  try {
    localStorage.removeItem(CONVERSATION_STORAGE_PREFIX + username);
  } catch {
    // ignoré
  }
};

const QUESTION_PRESETS = [
  "Vers quoi devrais-je investir mon épargne résiduelle mensuelle ?",
  "Quelle est mon exposition réelle à la Tech US et à l'Europe à travers mes ETF ?",
  "Simule un versement de 300 €/mois à 7% sur 15 ans avec mon capital actuel.",
  "Analyse mon budget réel de ce mois et dis-moi si je tiens mes objectifs de sécurité.",
  "Comment me conseilles-tu d'arbitrer mon patrimoine pour acheter un bien d'ici 10 ans ?",
];

const summarizeContext = (meta: AiContextMeta): string => {
  const bits: string[] = [];
  if (meta.sections > 0) bits.push(`${meta.sections} compte(s)`);
  if (meta.lines > 0) bits.push(`${meta.lines} ligne(s)`);
  if (meta.wallets > 0) bits.push(`${meta.wallets} wallet(s)`);
  if (meta.pockets > 0) bits.push(`${meta.pockets} poche(s)`);
  if (meta.totalValue > 0) bits.push(formatMoney(meta.totalValue));
  return bits.length > 0 ? bits.join(" · ") : "données sélectionnées";
};

interface ContextCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  hint?: string;
  active: boolean;
  onToggle: () => void;
}

const ContextCard: React.FC<ContextCardProps> = ({
  icon: Icon,
  title,
  description,
  hint,
  active,
  onToggle,
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={active}
    className={`rounded-xl border p-3.5 text-left transition-all duration-200 flex flex-col justify-between ${
      active
        ? "border-[#c8a55e]/50 bg-[#c8a55e]/10 shadow-[0_0_15px_rgba(200,165,94,0.06)]"
        : "border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] hover:border-[rgba(255,255,255,0.12)]"
    }`}
  >
    <div>
      <div className="flex items-center justify-between">
        <Icon size={20} className={active ? "text-[#c8a55e]" : "text-[#555555]"} />
        <span
          className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
            active ? "border-[#c8a55e] bg-[#c8a55e]" : "border-[#333333]"
          }`}
        >
          {active && <Check size={11} className="text-[#0a0a0a] stroke-[3]" />}
        </span>
      </div>
      <p className="mt-2.5 text-xs font-semibold text-[#f5f5f5] tracking-tight">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#8a8a8a] line-clamp-2">
        {description}
      </p>
    </div>
    {hint && (
      <div className="mt-2.5 pt-2 border-t border-[rgba(255,255,255,0.04)]">
        <p className="text-[10px] font-medium text-[#c8a55e] truncate">{hint}</p>
      </div>
    )}
  </button>
);

const AIAnalysis: React.FC = () => {
  const { currentUser } = useUser();
  useCurrency();

  const [selection, setSelection] = useState<AiContextSelection>(() =>
    loadSelection(currentUser),
  );
  const [conversationSelection, setConversationSelection] =
    useState<AiContextSelection | null>(null);
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [contextText, setContextText] = useState<string | null>(null);
  const [contextMeta, setContextMeta] = useState<AiContextMeta | null>(null);
  const [preview, setPreview] = useState<AiContextPreview | null>(null);
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<"idle" | "context" | "asking">("idle");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [hasApiKey, setHasApiKey] = useState(() =>
    Boolean(getGeminiApiKey(currentUser)),
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loading = phase !== "idle";

  // Changement d'utilisateur : recharge sélection, conversation et aperçus.
  useEffect(() => {
    setSelection(loadSelection(currentUser));
    const stored = loadConversation(currentUser);
    setMessages(stored?.messages ?? []);
    setConversationSelection(stored ? stored.selection : null);
    setContextText(null);
    setContextMeta(null);
    setQuestion("");
    setError("");
    setShowContext(false);
    setToolStatus(null);

    let cancelled = false;
    getAiContextPreview(currentUser)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Suit la présence de la clé API Gemini (paramètres).
  useEffect(() => {
    const refresh = () => setHasApiKey(Boolean(getGeminiApiKey(currentUser)));
    refresh();
    window.addEventListener("userSettingsUpdated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("userSettingsUpdated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [currentUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase, toolStatus]);

  const toggleSelection = (key: keyof AiContextSelection) => {
    setSelection((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSelection(currentUser, next);
      return next;
    });
  };

  const selectAll = () => {
    const next: AiContextSelection = {
      accounts: true,
      properties_loans: true,
      crypto: true,
      budget: true,
      savings: true,
      strategy: true,
      market_lookthrough: true,
      history_performance: true,
    };
    setSelection(next);
    saveSelection(currentUser, next);
  };

  const deselectAll = () => {
    const next: AiContextSelection = {
      accounts: false,
      properties_loans: false,
      crypto: false,
      budget: false,
      savings: false,
      strategy: false,
      market_lookthrough: false,
      history_performance: false,
    };
    setSelection(next);
    saveSelection(currentUser, next);
  };

  const activeModulesCount = useMemo(
    () => Object.values(selection).filter(Boolean).length,
    [selection],
  );

  const selectionChanged =
    messages.length > 0 &&
    conversationSelection != null &&
    (selection.accounts !== conversationSelection.accounts ||
      selection.properties_loans !== conversationSelection.properties_loans ||
      selection.crypto !== conversationSelection.crypto ||
      selection.budget !== conversationSelection.budget ||
      selection.savings !== conversationSelection.savings ||
      selection.strategy !== conversationSelection.strategy ||
      selection.market_lookthrough !== conversationSelection.market_lookthrough ||
      selection.history_performance !== conversationSelection.history_performance);

  const startNewConversation = () => {
    setMessages([]);
    setConversationSelection(null);
    setContextText(null);
    setContextMeta(null);
    setError("");
    setShowContext(false);
    setToolStatus(null);
    clearStoredConversation(currentUser);
  };

  const sendQuestion = useCallback(
    async (rawText: string, includeUserMessage: boolean) => {
      const text = (rawText || "").trim();
      if (!text || loading) return;

      setError("");
      setToolStatus(null);
      const activeSelection = conversationSelection ?? { ...selection };
      let context = contextText;

      if (!context) {
        setPhase("context");
        try {
          const result = await collectAiContext(currentUser, activeSelection);
          context = result.text;
          setContextText(result.text);
          setContextMeta(result.meta);
          if (!conversationSelection) setConversationSelection(activeSelection);
        } catch (err) {
          console.error("Conseiller IA : collecte du contexte impossible", err);
          setError(
            "Impossible de rassembler vos données patrimoniales. Réessayez.",
          );
          setPhase("idle");
          return;
        }
      }

      const nextMessages: AdvisorMessage[] = includeUserMessage
        ? [...messages, { role: "user", text }]
        : [...messages];
      const history = includeUserMessage ? messages : messages.slice(0, -1);

      setMessages(nextMessages);
      saveConversation(currentUser, {
        messages: nextMessages,
        selection: activeSelection,
      });
      setQuestion("");
      setPhase("asking");

      try {
        const answer = await askGeminiAdvisor(
          {
            username: currentUser,
            contextText: context,
            history,
            question: text,
          },
          {
            onToolCall: ({ name, args }) => {
              if (name === "search_market_asset") {
                setToolStatus(`Recherche de "${args.query}" sur les marchés...`);
              } else if (name === "get_asset_price_quote") {
                setToolStatus(`Consultation du cours en direct pour ${args.ticker}...`);
              } else if (name === "get_etf_lookthrough") {
                setToolStatus(`Analyse de la composition sous-jacente de ${args.ticker}...`);
              } else if (name === "get_market_indices") {
                setToolStatus("Actualisation des grands indices mondiaux...");
              } else if (name === "simulate_compound_interest") {
                setToolStatus("Calcul de projection d'intérêts composés...");
              } else if (name === "calculate_rebalancing") {
                setToolStatus("Calcul des arbitrages de rééquilibrage...");
              } else {
                setToolStatus(`Exécution de l'outil ${name}...`);
              }
            },
            onToolResult: () => {
              setToolStatus(null);
            },
          },
        );
        const withAnswer: AdvisorMessage[] = [
          ...nextMessages,
          { role: "assistant", text: answer },
        ];
        setMessages(withAnswer);
        saveConversation(currentUser, {
          messages: withAnswer,
          selection: activeSelection,
        });
      } catch (err) {
        console.error("Conseiller IA : appel Gemini en échec", err);
        setError(
          err instanceof Error
            ? err.message
            : "Erreur inattendue lors de l'appel à Gemini.",
        );
      } finally {
        setPhase("idle");
        setToolStatus(null);
      }
    },
    [
      currentUser,
      loading,
      conversationSelection,
      selection,
      contextText,
      messages,
    ],
  );

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user"),
    [messages],
  );
  const canRetry =
    Boolean(error) &&
    Boolean(lastUserMessage) &&
    messages[messages.length - 1]?.role === "user";

  const openContextModal = async () => {
    if (!contextText) {
      setPhase("context");
      try {
        const activeSelection = conversationSelection ?? selection;
        const result = await collectAiContext(currentUser, activeSelection);
        setContextText(result.text);
        setContextMeta(result.meta);
      } catch (err) {
        console.error("Conseiller IA : chargement du contexte impossible", err);
        setError("Impossible de charger les données envoyées.");
        setPhase("idle");
        return;
      }
      setPhase("idle");
    }
    setShowContext(true);
  };

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // presse-papiers indisponible : on ignore
    }
  };

  const contextCards: ContextCardProps[] = [
    {
      icon: Landmark,
      title: "Comptes & Lignes",
      description:
        "PEA, CTO, PEE, assurance vie, comptes courants et les positions détaillées associées.",
      hint: preview?.accounts,
      active: selection.accounts,
      onToggle: () => toggleSelection("accounts"),
    },
    {
      icon: Building2,
      title: "Immobilier & Emprunts",
      description:
        "Biens immobiliers (estimations, adresses), prêts en cours (capital restant, taux) et quotes-parts.",
      hint: preview?.properties_loans,
      active: selection.properties_loans,
      onToggle: () => toggleSelection("properties_loans"),
    },
    {
      icon: Coins,
      title: "Portefeuille Crypto",
      description: "Wallets connectés, tokens, actifs et valeurs estimées en euros.",
      hint: preview?.crypto,
      active: selection.crypto,
      onToggle: () => toggleSelection("crypto"),
    },
    {
      icon: Receipt,
      title: "Budget réel (Tricount)",
      description:
        "Dépenses réelles du mois en cours, catégories, payeurs, équilibre du foyer et reste à vivre.",
      hint: preview?.budget,
      active: selection.budget,
      onToggle: () => toggleSelection("budget"),
    },
    {
      icon: Clock,
      title: "Épargne & Versements",
      description:
        "Suivi concret des versements d'épargne réels constatés par rapport aux objectifs.",
      hint: preview?.savings,
      active: selection.savings,
      onToggle: () => toggleSelection("savings"),
    },
    {
      icon: PiggyBank,
      title: "Stratégie d'épargne",
      description:
        "Revenus déclarés du foyer, charges incompressibles, budget cible et poches prévues.",
      hint: preview?.strategy,
      active: selection.strategy,
      onToggle: () => toggleSelection("strategy"),
    },
    {
      icon: TrendingUp,
      title: "Look-Through ETF",
      description:
        "Décomposition géographique et sectorielle réelle des ETF (méthode Picsou) et cours des indices mondiaux.",
      hint: preview?.market_lookthrough,
      active: selection.market_lookthrough,
      onToggle: () => toggleSelection("market_lookthrough"),
    },
    {
      icon: BarChart3,
      title: "Historique Patrimoine",
      description:
        "Évolution historique journalière du patrimoine net, records (ATH), point bas et plus/moins-values.",
      hint: preview?.history_performance,
      active: selection.history_performance,
      onToggle: () => toggleSelection("history_performance"),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-bold text-[#f5f5f5]">
              Conseiller IA
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[rgba(255,255,255,0.05)] text-[#a3a3a3] border border-[rgba(255,255,255,0.08)]">
              <User className="w-3.5 h-3.5 text-[#c8a55e]" /> Profil de {currentUser}
            </span>
          </div>
          <p className="text-sm text-[#8a8a8a] mt-1">
            Vision complète à 360° sur votre patrimoine, votre budget et votre stratégie. Posez n'importe quelle question financière : l'IA dispose d'outils en direct pour consulter les cours de marché, décomposer vos ETF et simuler vos investissements.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(200,165,94,0.12)] text-[#c8a55e] border border-[rgba(200,165,94,0.25)]">
            <Wrench size={12} /> Tools intégrés
          </span>
          <span className="badge badge-gold inline-flex items-center gap-1.5">
            <Sparkles size={12} /> Gemini
          </span>
        </div>
      </div>

      {/* Clé API manquante */}
      {!hasApiKey && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm text-amber-200">
            <p className="font-medium">Clé API Gemini non configurée</p>
            <p className="mt-1 text-amber-200/80">
              Renseignez votre clé API Gemini dans les{" "}
              <Link
                to={`/settings/${currentUser}`}
                className="font-medium text-[#c8a55e] underline hover:text-[#d4b06a]"
              >
                paramètres
              </Link>{" "}
              pour interroger le conseiller.
            </p>
          </div>
        </div>
      )}

      {/* Étape 1 — données à joindre */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#c8a55e] text-xs font-semibold text-[#0a0a0a]">
              1
            </span>
            <h2 className="section-title">Données à joindre à votre question</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[#8a8a8a]">
              {activeModulesCount} / 8 actifs
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="text-xs text-[#8a8a8a] hover:text-[#f5f5f5] px-2.5 py-1 rounded-md hover:bg-white/5 transition-colors"
            >
              Tout cocher
            </button>
            <span className="text-white/20">|</span>
            <button
              type="button"
              onClick={deselectAll}
              className="text-xs text-[#8a8a8a] hover:text-[#f5f5f5] px-2.5 py-1 rounded-md hover:bg-white/5 transition-colors"
            >
              Tout décocher
            </button>
          </div>
        </div>

        <p className="mb-4 text-xs text-[#8a8a8a]">
          Le conseiller n'analyse que les volets cochés. Vous gardez un contrôle total sur les informations partagées.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {contextCards.map((card, index) => (
            <ContextCard key={index} {...card} />
          ))}
        </div>

        {contextMeta && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#8a8a8a]">
            <span className="badge badge-gold">
              Contexte joint : {summarizeContext(contextMeta)}
            </span>
            <button
              type="button"
              onClick={openContextModal}
              className="inline-flex items-center gap-1 text-[#c8a55e] transition-colors hover:text-[#d4b06a]"
            >
              <Database size={14} /> Voir le texte complet transmis
            </button>
          </div>
        )}

        {selectionChanged && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[#c8a55e]/30 bg-[#c8a55e]/10 p-3 text-sm text-[#e8d5ab]">
            <span>
              La conversation en cours utilise les données sélectionnées au
              départ. Lancez une nouvelle conversation pour appliquer vos
              changements.
            </span>
            <button
              type="button"
              onClick={startNewConversation}
              className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
            >
              <RotateCcw size={14} /> Nouvelle conversation
            </button>
          </div>
        )}
      </div>

      {/* Étape 2 — question */}
      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#c8a55e] text-xs font-semibold text-[#0a0a0a]">
            2
          </span>
          <h2 className="section-title">Votre question</h2>
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              sendQuestion(question, true);
            }
          }}
          rows={3}
          placeholder="Ex. : analyse mon portefeuille, vers quoi investir mes 500 € d'épargne résiduelle ce mois-ci ? Vérifie les cours des ETF monde et simule la projection."
          className="input resize-y"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {QUESTION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setQuestion(preset)}
              className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0d0d0d] px-3 py-1.5 text-xs text-[#8a8a8a] transition hover:border-[#c8a55e]/40 hover:text-[#f5f5f5]"
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => sendQuestion(question, true)}
            disabled={loading || !question.trim() || !hasApiKey}
            className="btn-primary inline-flex items-center gap-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {toolStatus || (phase === "context" ? "Préparation des données..." : "Le conseiller réfléchit...")}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Demander conseil
              </>
            )}
          </button>
          <span className="text-xs text-[#555555]">
            Ctrl/Cmd + Entrée pour envoyer
          </span>
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="flex-1 text-sm text-red-200">
            <p>{error}</p>
          </div>
          {canRetry && !loading && (
            <button
              type="button"
              onClick={() =>
                lastUserMessage && sendQuestion(lastUserMessage.text, false)
              }
              className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
            >
              <RotateCcw size={14} /> Réessayer
            </button>
          )}
        </div>
      )}

      {/* Conversation */}
      {messages.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Conversation</h2>
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex items-center gap-1 text-xs text-[#8a8a8a] transition-colors hover:text-[#c8a55e]"
            >
              <RotateCcw size={14} /> Nouvelle conversation
            </button>
          </div>

          <div className="space-y-4">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={index} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl bg-gradient-to-br from-[#c8a55e] to-[#b8944e] px-4 py-3 text-sm text-[#0a0a0a]">
                    {message.text}
                  </div>
                </div>
              ) : (
                <div key={index} className="card">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#c8a55e]">
                      <Sparkles size={16} /> Conseiller IA
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(message.text, index)}
                      className="inline-flex items-center gap-1 text-xs text-[#8a8a8a] transition-colors hover:text-[#c8a55e]"
                    >
                      {copiedIndex === index ? (
                        <>
                          <Check size={14} /> Copié
                        </>
                      ) : (
                        <>
                          <Copy size={14} /> Copier
                        </>
                      )}
                    </button>
                  </div>
                  <RichText text={message.text} />
                </div>
              ),
            )}

            {loading && (
              <div className="card flex items-center gap-3 text-sm text-[#8a8a8a]">
                <Loader2 className="h-5 w-5 animate-spin text-[#c8a55e]" />
                <div>
                  <p className="font-medium text-[#f5f5f5]">
                    {toolStatus
                      ? `⚡ ${toolStatus}`
                      : phase === "context"
                        ? "Agrégation des données patrimoniales..."
                        : "Analyse et formulation de la recommandation..."}
                  </p>
                  <p className="text-xs text-[#8a8a8a]">
                    {toolStatus
                      ? "Outil en cours d'exécution sur votre application"
                      : "Interrogation du modèle Gemini..."}
                  </p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Modal affichage du contexte brut */}
      {showContext && contextText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="card max-h-[85vh] w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] pb-3">
              <div>
                <h3 className="text-base font-semibold text-[#f5f5f5]">
                  Données transmises au Conseiller IA
                </h3>
                <p className="text-xs text-[#8a8a8a]">
                  Texte exact inclus dans le prompt système envoyé à Gemini.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowContext(false)}
                className="rounded p-1 text-[#8a8a8a] hover:bg-white/5 hover:text-[#f5f5f5]"
              >
                <X size={18} />
              </button>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] p-4 text-xs leading-relaxed text-[#8a8a8a]">
              {contextText}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowContext(false)}
                className="btn-secondary"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIAnalysis;
