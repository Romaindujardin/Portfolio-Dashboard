// Conseiller IA : l'utilisateur joint ses comptes, ses lignes, son portefeuille
// crypto et sa stratégie d'épargne, puis pose une question libre à Gemini
// (projet immobilier, rééquilibrage, fiscalité, capacité d'épargne...).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  Copy,
  Landmark,
  Loader2,
  PiggyBank,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { getGeminiApiKey } from "../utils/userSettings";
import {
  collectAiContext,
  DEFAULT_AI_CONTEXT_SELECTION,
  formatEur,
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
      crypto: parsed.crypto !== false,
      strategy: parsed.strategy !== false,
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
        crypto: parsed?.selection?.crypto !== false,
        strategy: parsed?.selection?.strategy !== false,
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
  "J'aimerais acheter une maison d'ici 10 ans : comment m'y préparer ?",
  "Je veux réduire mon exposition à l'Europe, comment rééquilibrer mes investissements ?",
  "Comment améliorer ma capacité d'épargne mensuelle ?",
  "Mon allocation entre PEA, PEE et assurance vie est-elle optimale ?",
  "Suis-je suffisamment diversifié entre mes différents actifs ?",
];

const summarizeContext = (meta: AiContextMeta): string => {
  const bits: string[] = [];
  if (meta.sections > 0) bits.push(`${meta.sections} compte(s)`);
  if (meta.lines > 0) bits.push(`${meta.lines} ligne(s)`);
  if (meta.wallets > 0) bits.push(`${meta.wallets} wallet(s)`);
  if (meta.pockets > 0) bits.push(`${meta.pockets} poche(s)`);
  if (meta.totalValue > 0) bits.push(formatEur(meta.totalValue));
  return bits.length > 0 ? bits.join(" · ") : "aucune donnée disponible";
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
    className={`rounded-lg border p-4 text-left transition ${
      active
        ? "border-blue-500/60 bg-blue-500/10"
        : "border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] hover:bg-[#161616]"
    }`}
  >
    <div className="flex items-center justify-between">
      <Icon
        size={22}
        className={active ? "text-blue-400" : "text-[#555555]"}
      />
      <span
        className={`flex h-5 w-5 items-center justify-center rounded border ${
          active ? "border-blue-500 bg-blue-600" : "border-[#333333]"
        }`}
      >
        {active && <Check size={14} className="text-white" />}
      </span>
    </div>
    <p className="mt-3 text-sm font-medium text-[#f5f5f5]">{title}</p>
    <p className="mt-1 text-xs leading-relaxed text-[#8a8a8a]">
      {description}
    </p>
    {hint && <p className="mt-2 text-xs font-medium text-blue-400">{hint}</p>}
  </button>
);

const AIAnalysis: React.FC = () => {
  const { currentUser } = useUser();

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
  }, [messages, phase]);

  const toggleSelection = (key: keyof AiContextSelection) => {
    setSelection((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSelection(currentUser, next);
      return next;
    });
  };

  const selectionChanged =
    messages.length > 0 &&
    conversationSelection != null &&
    (selection.accounts !== conversationSelection.accounts ||
      selection.crypto !== conversationSelection.crypto ||
      selection.strategy !== conversationSelection.strategy);

  const startNewConversation = () => {
    setMessages([]);
    setConversationSelection(null);
    setContextText(null);
    setContextMeta(null);
    setError("");
    setShowContext(false);
    clearStoredConversation(currentUser);
  };

  const sendQuestion = useCallback(
    async (rawText: string, includeUserMessage: boolean) => {
      const text = (rawText || "").trim();
      if (!text || loading) return;

      setError("");
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
        const answer = await askGeminiAdvisor({
          username: currentUser,
          contextText: context,
          history,
          question: text,
        });
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

  const handleToggleContext = async () => {
    if (showContext) {
      setShowContext(false);
      return;
    }
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
      title: "Comptes & lignes",
      description:
        "PEA, PEE, assurance vie, comptes bancaires et les positions (lignes) associées à chacun.",
      hint: preview?.accounts,
      active: selection.accounts,
      onToggle: () => toggleSelection("accounts"),
    },
    {
      icon: Coins,
      title: "Portefeuille crypto",
      description: "Wallets, actifs et valeurs estimées, converties en euros.",
      hint: preview?.crypto,
      active: selection.crypto,
      onToggle: () => toggleSelection("crypto"),
    },
    {
      icon: PiggyBank,
      title: "Stratégie d'épargne",
      description:
        "Foyer, revenus, poches planifiées et réalité du mois en cours (poches réelles).",
      hint: preview?.strategy,
      active: selection.strategy,
      onToggle: () => toggleSelection("strategy"),
    },
  ];

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white">
        <div className="mb-2 flex items-center space-x-3">
          <Brain size={32} />
          <h1 className="text-2xl font-bold">Conseiller IA</h1>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">
            Gemini
          </span>
        </div>
        <p className="text-blue-100">
          Joignez vos comptes, vos lignes et votre stratégie d'épargne, puis
          posez votre question : projet immobilier, rééquilibrage, fiscalité,
          capacité d'épargne...
        </p>
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
                className="font-medium underline hover:text-white"
              >
                paramètres
              </Link>{" "}
              pour interroger le conseiller.
            </p>
          </div>
        </div>
      )}

      {/* Étape 1 — données à joindre */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-6">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            1
          </span>
          <h2 className="text-lg font-semibold text-[#f5f5f5]">
            Données à joindre à votre question
          </h2>
        </div>
        <p className="mb-4 text-sm text-[#8a8a8a]">
          Le conseiller ne voit que ce que vous cochez. Il reçoit les montants
          en euros et la réalité de vos poches du mois en cours.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {contextCards.map((card, index) => (
            <ContextCard key={index} {...card} />
          ))}
        </div>

        {contextMeta && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#8a8a8a]">
            <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0d0d0d] px-3 py-1">
              Contexte joint : {summarizeContext(contextMeta)}
            </span>
            <button
              type="button"
              onClick={handleToggleContext}
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"
            >
              {showContext ? (
                <>
                  Masquer les données <ChevronUp size={14} />
                </>
              ) : (
                <>
                  Voir les données envoyées <ChevronDown size={14} />
                </>
              )}
            </button>
          </div>
        )}

        {showContext && contextText && (
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] p-4 text-xs leading-relaxed text-[#8a8a8a]">
            {contextText}
          </pre>
        )}

        {selectionChanged && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200">
            <span>
              La conversation en cours utilise les données sélectionnées au
              départ. Lancez une nouvelle conversation pour appliquer vos
              changements.
            </span>
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              <RotateCcw size={14} /> Nouvelle conversation
            </button>
          </div>
        )}
      </div>

      {/* Étape 2 — question */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            2
          </span>
          <h2 className="text-lg font-semibold text-[#f5f5f5]">
            Votre question
          </h2>
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
          placeholder="Ex. : voici mon patrimoine, j'aimerais acheter une maison d'ici 10 ans. Comment me conseilles-tu d'agir ?"
          className="w-full resize-y rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0d0d0d] px-4 py-3 text-sm text-[#f5f5f5] placeholder-[#555555] focus:border-blue-500/60 focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {QUESTION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setQuestion(preset)}
              className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0d0d0d] px-3 py-1.5 text-xs text-[#8a8a8a] transition hover:border-blue-500/40 hover:text-[#f5f5f5]"
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => sendQuestion(question, true)}
            disabled={loading || !question.trim() || !hasApiKey}
            className="inline-flex items-center rounded-md bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-medium text-white transition hover:from-blue-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {phase === "context"
                  ? "Préparation de vos données..."
                  : "Le conseiller réfléchit..."}
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
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
              onClick={() => lastUserMessage && sendQuestion(lastUserMessage.text, false)}
              className="inline-flex items-center gap-1 rounded-md border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20"
            >
              <RotateCcw size={14} /> Réessayer
            </button>
          )}
        </div>
      )}

      {/* Conversation */}
      {messages.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#f5f5f5]">
              Conversation
            </h2>
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex items-center gap-1 text-xs text-[#8a8a8a] hover:text-[#f5f5f5]"
            >
              <RotateCcw size={14} /> Nouvelle conversation
            </button>
          </div>

          <div className="space-y-4">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={index} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-blue-600/90 px-4 py-3 text-sm text-white">
                    {message.text}
                  </div>
                </div>
              ) : (
                <div
                  key={index}
                  className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-5"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                      <Brain size={16} /> Conseiller IA
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(message.text, index)}
                      className="inline-flex items-center gap-1 text-xs text-[#8a8a8a] hover:text-[#f5f5f5]"
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
              <div className="flex items-center gap-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-5 text-sm text-[#8a8a8a]">
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                {phase === "context"
                  ? "Préparation de vos données patrimoniales..."
                  : "Le conseiller analyse votre situation..."}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[#f5f5f5]">
            <ShieldCheck size={20} className="text-blue-400" />
            Comment ça marche ?
          </h2>
          <ul className="space-y-2 text-sm text-[#8a8a8a]">
            <li>
              1. Cochez les données à joindre : comptes et lignes (PEA, PEE,
              assurance vie...), portefeuille crypto, stratégie d'épargne et
              poches réelles du mois.
            </li>
            <li>
              2. Posez votre question en langage naturel : « comment préparer un
              achat immobilier dans 10 ans ? », « comment réduire mes positions
              européennes ? »...
            </li>
            <li>
              3. Échangez avec le conseiller : vous pouvez poser des questions
              de suivi, il garde le contexte de votre patrimoine.
            </li>
          </ul>
        </div>
      )}

      {/* Note de prudence */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-4">
        <div className="flex items-start gap-3">
          <Brain className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <p className="text-xs leading-relaxed text-[#8a8a8a]">
            Les réponses sont générées par Gemini à partir des données que vous
            joignez (aucune donnée n'est envoyée tant que vous ne posez pas de
            question). Elles constituent une aide à la décision et ne
            remplacent pas un conseiller financier réglementé.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AIAnalysis;
