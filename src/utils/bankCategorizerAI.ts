import { getGeminiApiKey } from "./userSettings";

export type BankCategorySchema = Array<{
  category: string;
  subcategories: string[];
}>;

export type BankCategorization = {
  aiCategory: string;
  aiSubCategory: string;
};

type InputRow = {
  dateOp?: string;
  dateVal?: string;
  label?: string;
  supplierFound?: string;
  amount?: string;
  comment?: string;
  category?: string;
  categoryParent?: string;
  accountLabel?: string;
};

const getGeminiApiUrl = (username: string): string => {
  const apiKey = getGeminiApiKey(username);
  if (!apiKey) {
    throw new Error(
      "Clé API Gemini non configurée. Veuillez la configurer dans les paramètres."
    );
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGeminiWithRetry(
  username: string,
  body: unknown,
  opts?: { maxAttempts?: number }
): Promise<any> {
  const maxAttempts = opts?.maxAttempts ?? 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(getGeminiApiUrl(username), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (resp.ok) return await resp.json();

    const status = resp.status;
    const errorText = await resp.text();

    // Retry on rate limits / transient server errors
    const retryable =
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      /RESOURCE_EXHAUSTED|Too Many Requests/i.test(errorText);

    if (!retryable || attempt === maxAttempts) {
      throw new Error(`Erreur API Gemini: ${status} - ${errorText}`);
    }

    const retryAfterHeader = resp.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : NaN;

    // Exponential backoff with a bit of jitter
    const base = 1200 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    const waitMs = Number.isFinite(retryAfterMs) ? retryAfterMs : base + jitter;

    console.warn(
      `Gemini rate-limited/transient error (status ${status}). Retry ${attempt}/${maxAttempts} in ${waitMs}ms`
    );
    await sleep(waitMs);
  }

  // Should never reach here
  throw new Error("Erreur API Gemini: retries exhausted");
}

function stripCodeFences(text: string): string {
  const t = (text || "").trim();
  // Handles ```json ... ``` and ``` ... ```
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    // remove first fence line
    lines.shift();
    // remove last fence line if present
    if (lines.length && lines[lines.length - 1].trim().startsWith("```")) {
      lines.pop();
    }
    return lines.join("\n").trim();
  }
  return t;
}

function extractFirstJsonBlock(text: string): string | null {
  const s = stripCodeFences(text);
  const startArr = s.indexOf("[");
  const startObj = s.indexOf("{");
  const start =
    startArr !== -1 && startObj !== -1
      ? Math.min(startArr, startObj)
      : startArr !== -1
        ? startArr
        : startObj;
  if (start === -1) return null;

  const open = s[start];
  const close = open === "[" ? "]" : "}";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1).trim();
      }
    }
  }

  // No proper end found (likely truncated)
  return s.slice(start).trim();
}

function safeJsonParse<T>(text: string): T {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const extracted = extractFirstJsonBlock(cleaned);
    if (!extracted) throw new Error("Réponse IA non JSON");
    return JSON.parse(extracted) as T;
  }
}

function schemaToText(schema: BankCategorySchema): string {
  return schema
    .map((c) => {
      const subs = (c.subcategories || []).join(", ");
      return `- ${c.category}: ${subs}`;
    })
    .join("\n");
}

export async function categorizeBankRowsBatch(params: {
  rows: InputRow[];
  schema: BankCategorySchema;
  username: string;
}): Promise<BankCategorization[]> {
  const { rows, schema, username } = params;
  if (!rows.length) return [];
  if (!schema.length) {
    throw new Error("Schéma de catégories vide");
  }

  const allowed = schemaToText(schema);

  const prompt = `Tu es un assistant qui catégorise des transactions bancaires.

Tu DOIS choisir une catégorie et une sous-catégorie parmi la liste autorisée ci-dessous.
Si tu n'es pas sûr, choisis une catégorie générique (ex: "Autres") et sous-catégorie (ex: "Non catégorisé") SI elles existent dans la liste autorisée.

LISTE AUTORISÉE (catégorie -> sous-catégories):
${allowed}

Pour chaque transaction, retourne UNIQUEMENT un JSON strict (sans texte autour) au format:
[
  {"index": 0, "aiCategory": "…", "aiSubCategory": "…"},
  ...
]

Règles:
- "aiCategory" doit être exactement une des catégories autorisées.
- "aiSubCategory" doit être exactement une des sous-catégories de cette catégorie.
- Base-toi sur label, supplierFound, amount (signe + / -), et les champs category/categoryParent existants si utiles.

TRANSACTIONS:
${rows
  .map((r, idx) => {
    const compact = {
      dateOp: r.dateOp || "",
      dateVal: r.dateVal || "",
      label: r.label || "",
      supplierFound: r.supplierFound || "",
      amount: r.amount || "",
      comment: r.comment || "",
      category: r.category || "",
      categoryParent: r.categoryParent || "",
      accountLabel: r.accountLabel || "",
    };
    return `${idx}: ${JSON.stringify(compact)}`;
  })
  .join("\n")}
`;

  const data = await fetchGeminiWithRetry(username, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      topK: 20,
      topP: 0.8,
      // Slightly higher to handle larger batches safely
      maxOutputTokens: 8192,
      // Ask API to return JSON when supported by the model
      responseMimeType: "application/json",
    },
  });
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Réponse IA invalide");

  let decoded: Array<{ index: number; aiCategory: string; aiSubCategory: string }>;
  try {
    decoded = safeJsonParse<
      Array<{ index: number; aiCategory: string; aiSubCategory: string }>
    >(text);
  } catch (e: any) {
    // Fallback: ask Gemini to repair JSON if the response is malformed/truncated
    const repairPrompt = `Répare en JSON strict (sans texte autour) le JSON ci-dessous.
Tu dois retourner un tableau JSON au format:
[{"index":0,"aiCategory":"...","aiSubCategory":"..."}]

JSON À RÉPARER:
${text}
`;
    const repairData = await fetchGeminiWithRetry(username, {
      contents: [{ parts: [{ text: repairPrompt }] }],
      generationConfig: {
        temperature: 0,
        topK: 10,
        topP: 0.6,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });
    const repairedText = repairData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!repairedText)
      throw new Error("Réponse IA invalide (JSON) et réparation vide");
    decoded = safeJsonParse<
      Array<{ index: number; aiCategory: string; aiSubCategory: string }>
    >(repairedText);
  }

  const out: BankCategorization[] = new Array(rows.length).fill(null).map(() => ({
    aiCategory: "",
    aiSubCategory: "",
  }));

  for (const item of decoded) {
    if (
      typeof item?.index === "number" &&
      item.index >= 0 &&
      item.index < out.length
    ) {
      out[item.index] = {
        aiCategory: String(item.aiCategory || ""),
        aiSubCategory: String(item.aiSubCategory || ""),
      };
    }
  }

  return out;
}


