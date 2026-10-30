// Conseiller IA (Gemini) : envoie la question de l'utilisateur avec le contexte
// patrimonial complet en systemInstruction, dispose d'outils d'analyse de marché
// et de calcul financier, puis gère la conversation multi-tours.
import { getGeminiApiKey } from "./userSettings";
import {
  ADVISOR_TOOL_DECLARATIONS,
  executeAdvisorTool,
} from "./aiTools";

export type AdvisorRole = "user" | "assistant";

export interface AdvisorMessage {
  role: AdvisorRole;
  text: string;
}

export interface AskAdvisorParams {
  username: string;
  /** Contexte patrimonial complet (voir aiContext.ts). */
  contextText: string;
  /** Historique de la conversation, SANS la question courante. */
  history: AdvisorMessage[];
  /** Question courante de l'utilisateur. */
  question: string;
}

export interface AskAdvisorOptions {
  /** Modèles essayés dans l'ordre. Défaut : flash → flash-lite → 2.0-flash. */
  models?: string[];
  /** Délais de backoff entre deux tentatives sur un même modèle. Défaut : [900]. */
  retryDelaysMs?: number[];
  /** Activer les outils de marché et calculs (function calling). Défaut : true. */
  enableTools?: boolean;
  /** Notification lors de l'appel d'un outil par le modèle. */
  onToolCall?: (tool: { name: string; args: Record<string, any> }) => void;
  /** Notification lorsque le résultat de l'outil est disponible. */
  onToolResult?: (tool: { name: string; result: any }) => void;
}

export const ADVISOR_MODEL = "gemini-2.5-flash";
// Modèles de repli si le principal est momentanément surchargé (503) ou limité (429).
export const ADVISOR_FALLBACK_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];
export const ADVISOR_MODELS = [ADVISOR_MODEL, ...ADVISOR_FALLBACK_MODELS];

// Statuts retentables : surcharge / limite de débit / erreurs transitoires.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [900];

const HTTP_ERROR_HINTS: Record<number, string> = {
  400: "requête refusée par Gemini, vérifiez votre clé API et réessayez.",
  401: "clé API invalide, vérifiez-la dans les paramètres.",
  403: "accès refusé par Gemini, vérifiez votre clé API.",
  404: "modèle Gemini introuvable.",
  429: "limite de requêtes atteinte, patientez quelques secondes puis réessayez.",
  500: "erreur interne de Gemini, réessayez dans quelques instants.",
  502: "Gemini est momentanément indisponible, réessayez dans quelques instants.",
  503: "le modèle est momentanément surchargé, réessayez dans quelques instants.",
  504: "Gemini n'a pas répondu à temps, réessayez dans quelques instants.",
};

interface GeminiHttpError extends Error {
  status?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const buildHttpErrorMessage = (status: number, detail: string): string => {
  const hint = HTTP_ERROR_HINTS[status];
  const suffix = hint ?? (detail || "vérifiez votre clé API et réessayez.");
  return `Erreur Gemini (${status}) : ${suffix}`;
};

export const getAdvisorApiUrl = (
  username: string,
  model: string = ADVISOR_MODEL,
): string => {
  const apiKey = getGeminiApiKey(username);
  if (!apiKey) {
    throw new Error(
      "Clé API Gemini non configurée. Renseignez-la dans les paramètres pour utiliser le Conseiller IA.",
    );
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
};

export const buildAdvisorSystemPrompt = (contextText: string): string =>
  [
    "Tu es un conseiller en gestion de patrimoine français expérimenté, pédagogue et rigoureux.",
    "Tu réponds toujours en français et tu exprimes tous les montants en euros (€).",
    "",
    "Tu reçois ci-dessous les données réelles de l'utilisateur (comptes, enveloppes PEA/PEE/assurance vie, lignes, portefeuille crypto, stratégie d'épargne, poches et réalité du mois en cours). Ces données proviennent de son application locale ; tu ne peux pas les modifier.",
    "",
    "=== DONNÉES DE L'UTILISATEUR ===",
    contextText,
    "=== FIN DES DONNÉES ===",
    "",
    "Règles de réponse :",
    "1. Appuie-toi uniquement sur les données fournies : cite les montants, lignes et poches concernés. Si une information manque pour répondre, dis-le clairement au lieu d'inventer.",
    "2. Structure ta réponse : une courte synthèse, ton analyse détaillée chiffrée (en t'appuyant sur les données), puis des actions concrètes numérotées et priorisées.",
    "3. Tiens compte du contexte fiscal français quand c'est pertinent (plafonds PEA, assurance vie après 8 ans, PEE, livrets, prélèvements sociaux) et de l'horizon temporel mentionné par l'utilisateur.",
    "4. Précise les hypothèses et les risques de tes recommandations. Tu n'es pas un conseiller financier réglementé : rappelle-le brièvement lorsque tu recommandes des investissements.",
    "5. Sois concret : pour un rééquilibrage, donne des ordres de grandeur (montants en € et pourcentages) calculés à partir des données fournies.",
    "6. Si la demande est ambiguë, commence par 1 à 3 questions de clarification avant de conclure.",
    "7. Pense à la cohérence d'ensemble entre les poches réelles du mois, la stratégie d'épargne et les enveloppes d'investissement.",
    "8. Tu disposes d'outils (tools) intégrés pour rechercher des cours d'actifs en direct (get_asset_price_quote, search_market_asset), analyser la décomposition réelle sous-jacente des ETF (get_etf_lookthrough), consulter les indices mondiaux (get_market_indices), simuler des intérêts composés avec précision (simulate_compound_interest) et calculer des rééquilibrages de portefeuille (calculate_rebalancing). Utilise-les activement dès que pertinent.",
  ].join("\n");

const extractCandidateText = (data: unknown): string => {
  const candidates = (data as { candidates?: unknown[] } | null)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const content = (candidates[0] as { content?: { parts?: unknown[] } })
    ?.content;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    // Les éventuels segments de "réflexion interne" (thought) ne font pas
    // partie de la réponse visible.
    .filter((p) => !(p as { thought?: boolean } | null)?.thought)
    .map((p) => (p as { text?: string } | null)?.text || "")
    .join("")
    .trim();
};

export const askGeminiAdvisor = async (
  {
    username,
    contextText,
    history,
    question,
  }: AskAdvisorParams,
  options: AskAdvisorOptions = {},
): Promise<string> => {
  const trimmedQuestion = (question || "").trim();
  if (!trimmedQuestion) {
    throw new Error("Votre question est vide.");
  }

  const enableTools = options.enableTools !== false;
  const tools = enableTools
    ? [{ functionDeclarations: ADVISOR_TOOL_DECLARATIONS }]
    : undefined;

  const currentContents: any[] = [
    ...history
      .filter((m) => m.text && m.text.trim())
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
    { role: "user", parts: [{ text: trimmedQuestion }] },
  ];

  const models =
    options.models && options.models.length > 0
      ? options.models
      : ADVISOR_MODELS;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  const requestModel = async (url: string): Promise<string> => {
    let loopCount = 0;
    const maxIterations = 5;

    while (loopCount < maxIterations) {
      loopCount++;

      const body: any = {
        systemInstruction: {
          parts: [{ text: buildAdvisorSystemPrompt(contextText) }],
        },
        contents: currentContents,
        generationConfig: {
          temperature: 0.7,
          // 8192 = maximum sûr commun aux trois modèles de la cascade
          maxOutputTokens: 8192,
        },
      };

      if (tools) {
        body.tools = tools;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let detail = "";
        try {
          detail = (await response.text()).slice(0, 300);
        } catch {
          detail = "";
        }
        const error = new Error(
          buildHttpErrorMessage(response.status, detail),
        ) as GeminiHttpError;
        error.status = response.status;
        throw error;
      }

      const data: any = await response.json();
      const candidate = data?.candidates?.[0];
      const finishReason = (candidate?.finishReason || "").toUpperCase();
      const parts = candidate?.content?.parts || [];

      // Vérifier si Gemini demande d'exécuter un outil (Function Call)
      const functionCallPart = parts.find(
        (p: any) => p && typeof p === "object" && p.functionCall,
      );

      if (functionCallPart && functionCallPart.functionCall) {
        const { name, args } = functionCallPart.functionCall;
        const safeArgs = args || {};

        options.onToolCall?.({ name, args: safeArgs });

        let result: any = null;
        try {
          result = await executeAdvisorTool(name, safeArgs, username);
        } catch (toolErr) {
          result = {
            error:
              toolErr instanceof Error
                ? toolErr.message
                : "Erreur lors de l'exécution de l'outil.",
          };
        }

        options.onToolResult?.({ name, result });

        // Ajouter l'appel et le résultat dans la conversation multi-tours
        currentContents.push({
          role: "model",
          parts: [{ functionCall: functionCallPart.functionCall }],
        });
        currentContents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name,
                response: { name, content: result },
              },
            },
          ],
        });

        // Poursuit la boucle pour laisser Gemini formuler sa réponse avec le résultat
        continue;
      }

      // Réponse textuelle finale
      const text = extractCandidateText(data);

      if (!text) {
        const blockReason = data?.promptFeedback?.blockReason;
        if (finishReason === "SAFETY" || blockReason) {
          throw new Error(
            "La réponse a été bloquée par les filtres de sécurité de Gemini. Reformulez votre question.",
          );
        }
        throw new Error(
          "Gemini n'a renvoyé aucune réponse exploitable. Réessayez dans un instant.",
        );
      }

      if (finishReason === "MAX_TOKENS") {
        return `${text}\n\n---\n⚠️ Réponse tronquée : la limite de longueur du modèle a été atteinte. Répondez « continue » pour obtenir la suite.`;
      }

      return text;
    }

    throw new Error(
      "Limite d'itérations d'outils atteinte sans réponse finale.",
    );
  };

  // Cascade de modèles : en cas de surcharge (503/429...), on réessaie le même
  // modèle après un court délai puis on bascule sur les modèles de repli.
  let lastError: Error | null = null;
  for (const model of models) {
    const url = getAdvisorApiUrl(username, model);
    const attempts = retryDelays.length + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await requestModel(url);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status = (error as GeminiHttpError).status;

        // Erreur non HTTP (réponse vide, sécurité...) : inutile de réessayer.
        if (status === undefined) throw error;

        // Modèle introuvable : on passe directement au suivant.
        if (status === 404) break;

        // Erreur non transitoire (clé invalide, requête refusée...) : on remonte.
        if (!RETRYABLE_STATUSES.has(status)) throw error;

        if (attempt < attempts - 1) {
          await sleep(retryDelays[attempt] ?? DEFAULT_RETRY_DELAYS_MS[0]);
        }
      }
    }
  }

  throw lastError ?? new Error("Erreur inconnue lors de l'appel à Gemini.");
};
