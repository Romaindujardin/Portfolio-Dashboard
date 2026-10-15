// Conseiller IA (Gemini) : envoie la question de l'utilisateur avec le contexte
// patrimonial (comptes, lignes, crypto, stratégie) en systemInstruction,
// puis gère la conversation multi-tours.
import { getGeminiApiKey } from "./userSettings";

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

export const ADVISOR_MODEL = "gemini-2.5-flash";

export const getAdvisorApiUrl = (username: string): string => {
  const apiKey = getGeminiApiKey(username);
  if (!apiKey) {
    throw new Error(
      "Clé API Gemini non configurée. Renseignez-la dans les paramètres pour utiliser le Conseiller IA.",
    );
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${ADVISOR_MODEL}:generateContent?key=${apiKey}`;
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
  ].join("\n");

const extractCandidateText = (data: unknown): string => {
  const candidates = (data as { candidates?: unknown[] } | null)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const content = (candidates[0] as { content?: { parts?: unknown[] } })
    ?.content;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (p as { text?: string } | null)?.text || "")
    .join("")
    .trim();
};

export const askGeminiAdvisor = async ({
  username,
  contextText,
  history,
  question,
}: AskAdvisorParams): Promise<string> => {
  const trimmedQuestion = (question || "").trim();
  if (!trimmedQuestion) {
    throw new Error("Votre question est vide.");
  }

  const url = getAdvisorApiUrl(username);

  const contents = [
    ...history
      .filter((m) => m.text && m.text.trim())
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
    { role: "user", parts: [{ text: trimmedQuestion }] },
  ];

  const body = {
    systemInstruction: {
      parts: [{ text: buildAdvisorSystemPrompt(contextText) }],
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  };

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
    throw new Error(
      `Erreur Gemini (${response.status})${
        detail ? ` : ${detail}` : ". Vérifiez votre clé API et réessayez."
      }`,
    );
  }

  const data: unknown = await response.json();
  const text = extractCandidateText(data);
  if (!text) {
    const finishReason = (
      (data as { candidates?: Array<{ finishReason?: string }> } | null)
        ?.candidates?.[0]?.finishReason || ""
    ).toUpperCase();
    const blockReason = (
      data as { promptFeedback?: { blockReason?: string } } | null
    )?.promptFeedback?.blockReason;
    if (finishReason === "SAFETY" || blockReason) {
      throw new Error(
        "La réponse a été bloquée par les filtres de sécurité de Gemini. Reformulez votre question.",
      );
    }
    throw new Error(
      "Gemini n'a renvoyé aucune réponse exploitable. Réessayez dans un instant.",
    );
  }

  return text;
};
