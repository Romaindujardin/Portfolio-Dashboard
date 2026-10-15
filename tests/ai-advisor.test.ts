// Tests du Conseiller IA : collecte du contexte patrimonial (comptes, lignes,
// crypto, stratégie et poches réelles), prompt système, appel Gemini
// (fetch stubbé) et parseur de texte enrichi.
import "./shims";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { postJson } from "./helpers";
import {
  createBankCsvUpload,
  getStoredWallets,
} from "../src/utils/storage";
import { saveSavingsStrategy } from "../src/utils/savingsStorage";
import {
  addOrUpdateExpense,
  addOrUpdateIncome,
  getCurrentMonthKey,
} from "../src/utils/tricountStorage";
import {
  collectAiContext,
  DEFAULT_AI_CONTEXT_SELECTION,
  formatEur,
  formatPercent,
  formatSignedEur,
  getAiContextPreview,
} from "../src/utils/aiContext";
import {
  askGeminiAdvisor,
  buildAdvisorSystemPrompt,
} from "../src/utils/geminiAI";
import { parseRichText, splitBoldSegments } from "../src/utils/richText";
import { getUserSettings, saveUserSettings } from "../src/utils/userSettings";
import type { UserSettings } from "../src/utils/userSettings";
import type { SavingsStrategy } from "../src/types";

const USER = "TestAiUser";
const MONTH = getCurrentMonthKey();

const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const PEA_CSV = [
  "Nom;ISIN;Quantite;PrixAchat;DernierPrix;Montant",
  "Amundi MSCI World;LU1681043599;12;480;512,3;6147,60",
  "ETF Europe Stoxx;FR0000000001;10;100;110;1100",
].join("\n");

const BANK_CSV = [
  "Date;Libelle;Montant;Solde",
  `${daysAgo(40)};Salaire;2000,00;4800,00`,
  `${daysAgo(20)};Courses;-350,50;4449,50`,
  `${daysAgo(10)};Salaire;2000,00;6449,50`,
].join("\n");

const buildStrategy = (): SavingsStrategy =>
  ({
    household: {
      enabled: true,
      splitMode: "proportional",
      person1: { id: "person1", name: "Alex", color: "#3b82f6" },
      person2: { id: "person2", name: "Camille", color: "#10b981" },
    },
    incomes: [
      {
        id: "ai-inc-1",
        name: "Salaire Alex",
        amount: 3000,
        frequency: "monthly",
        personId: "person1",
      },
      {
        id: "ai-inc-2",
        name: "Prime Camille",
        amount: 12000,
        frequency: "yearly",
        personId: "person2",
      },
    ],
    pockets: [
      {
        id: "ai-pocket-1",
        name: "Livret de précaution",
        category: "emergency",
        allocationType: "fixed",
        allocationValue: 300,
        currentAmount: 5000,
        targetAmount: 10000,
        expectedReturnRate: 3,
        color: "#3b82f6",
        ownership: "shared",
        pocketType: "placement",
      },
      {
        id: "ai-pocket-2",
        name: "Courses du foyer",
        category: "fixed_expense",
        allocationType: "fixed",
        allocationValue: 600,
        currentAmount: 0,
        color: "#f97316",
        ownership: "shared",
        pocketType: "expense",
      },
    ],
    horizonYears: 10,
  }) as SavingsStrategy;

// Le localStorage est vidé avant chaque test : on re-sème la configuration
// (paramètres + stratégie + réalité du mois), les CSV et le wallet restent en base.
const seedUser = () => {
  // Profils de l'outil : la normalisation de la stratégie s'aligne sur ces
  // utilisateurs pour nommer les membres du foyer.
  localStorage.setItem("portfolio_users", JSON.stringify(["Alex", "Camille"]));

  const settings: UserSettings = {
    ...getUserSettings(USER),
    geminiApiKey: "test-gemini-key",
    accountSections: [
      { id: "pea-test", label: "PEA Test", kind: "investment" },
      { id: "bank-test", label: "Compte courant Test", kind: "bank" },
    ],
    csvColumnMappings: {
      "pea-test": {
        name: "Nom",
        isin: "ISIN",
        quantity: "Quantite",
        buyingPrice: "PrixAchat",
        lastPrice: "DernierPrix",
        amount: "Montant",
      },
      "bank-test": {
        date: "Date",
        amount: "Montant",
        balance: "Solde",
        label: "Libelle",
      },
    },
  };
  saveUserSettings(USER, settings);
  saveSavingsStrategy(USER, buildStrategy());

  addOrUpdateIncome({
    id: "ai-inc-real-1",
    month: MONTH,
    date: `${MONTH}-05`,
    label: "Salaire Alex",
    amount: 3000,
    beneficiaryPersonId: "person1",
  });
  addOrUpdateIncome({
    id: "ai-inc-real-2",
    month: MONTH,
    date: `${MONTH}-05`,
    label: "Salaire Camille",
    amount: 2000,
    beneficiaryPersonId: "person2",
  });
  addOrUpdateExpense({
    id: "ai-exp-1",
    month: MONTH,
    date: `${MONTH}-03`,
    label: "Courses",
    amount: 720,
    payerPersonId: "person1",
    pocketId: "ai-pocket-2",
    pocketName: "Courses du foyer",
    splitMethod: "proportional",
    nature: "expense",
    source: "manual",
  });
  addOrUpdateExpense({
    id: "ai-exp-2",
    month: MONTH,
    date: `${MONTH}-04`,
    label: "Virement livret",
    amount: 300,
    payerPersonId: "person1",
    pocketId: "ai-pocket-1",
    pocketName: "Livret de précaution",
    splitMethod: "proportional",
    nature: "placement",
    source: "manual",
  });
};

beforeAll(async () => {
  await createBankCsvUpload(
    { filename: "pea.csv", content: PEA_CSV, section: "pea-test" },
    USER,
  );
  await createBankCsvUpload(
    { filename: "bank.csv", content: BANK_CSV, section: "bank-test" },
    USER,
  );

  const res = await postJson("/database/wallets", {
    user_id: USER,
    name: "Ledger Test",
    address: "0xtestaiwallet000001",
    wallet_type: "ledger",
    blockchains: JSON.stringify(["ethereum"]),
    total_value: 6000,
    last_updated: new Date().toISOString(),
    assets: [
      {
        symbol: "BTC",
        name: "Bitcoin",
        balance: 0.05,
        decimals: 8,
        blockchain: "ethereum",
        price: 60000,
        value: 3000,
      },
      {
        symbol: "ETH",
        name: "Ethereum",
        balance: 1.2,
        decimals: 18,
        blockchain: "ethereum",
        price: 2500,
        value: 3000,
      },
    ],
    nfts: [],
  });
  expect(res.status).toBe(200);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiContext — collecte du contexte patrimonial", () => {
  it("rassemble comptes, lignes, crypto, stratégie et poches réelles", async () => {
    seedUser();
    const { text, meta } = await collectAiContext(
      USER,
      DEFAULT_AI_CONTEXT_SELECTION,
      MONTH,
    );

    // Comptes & lignes (PEA importé)
    expect(text).toContain("PEA Test");
    expect(text).toContain("Amundi MSCI World");
    expect(text).toContain("LU1681043599");
    expect(text).toContain("6 147,60 €");
    expect(text).toContain("+487,60 €");
    expect(text).toContain("poids");

    // Compte bancaire (solde + flux)
    expect(text).toContain("Compte courant Test");
    expect(text).toContain("Solde : 6 449,50 €");
    expect(text).toMatch(
      /Flux des \d derniers mois : revenus 4 000,00 € · dépenses 350,50 €/,
    );

    // Crypto
    expect(text).toContain("PORTEFEUILLE CRYPTO");
    expect(text).toContain("Bitcoin (BTC) : 0,05 → 3 000,00 €");
    expect(text).toContain("Ethereum (ETH) : 1,2 → 3 000,00 €");

    // Stratégie et poches réelles
    expect(text).toContain("STRATÉGIE D'ÉPARGNE");
    expect(text).toContain("Alex");
    expect(text).toContain("Camille");
    expect(text).toContain("Livret de précaution");
    expect(text).toContain("Courses du foyer");
    expect(text).toContain("300,00 €/mois");
    expect(text).toContain("600,00 €/mois");
    expect(text).toContain("Revenus réels perçus : 5 000,00 €");
    expect(text).toContain("capacité d'épargne réelle : 4 280,00 €");
    expect(text).toContain("planifié 600,00 € → réel 720,00 €");
    expect(text).toContain("(au-dessus du plan)");
    expect(text).toContain("planifié 300,00 € → réel 300,00 €");
    expect(text).toContain("(conforme au plan)");

    // Contrainte projet : tout est en euros
    expect(text).not.toContain("$");

    // Métadonnées
    expect(meta.lines).toBe(2);
    expect(meta.sections).toBe(2);
    expect(meta.bankAccounts).toBe(1);
    expect(meta.wallets).toBe(1);
    expect(meta.cryptoAssets).toBe(2);
    expect(meta.pockets).toBe(2);
    expect(meta.monthKey).toBe(MONTH);
    expect(meta.totalValue).toBeCloseTo(7247.6 + 6449.5 + 6000, 1);
  });

  it("respecte la sélection (exclusion des comptes et de la stratégie)", async () => {
    seedUser();
    const { text, meta } = await collectAiContext(
      USER,
      { accounts: false, crypto: true, strategy: false },
      MONTH,
    );
    expect(text).toContain("PORTEFEUILLE CRYPTO");
    expect(text).not.toContain("PEA Test");
    expect(text).not.toContain("STRATÉGIE D'ÉPARGNE");
    expect(meta.lines).toBe(0);
    expect(meta.pockets).toBe(0);
    expect(meta.wallets).toBe(1);
  });

  it("sans aucune donnée jointe, le contexte le signale", async () => {
    seedUser();
    const { text } = await collectAiContext(
      USER,
      { accounts: false, crypto: false, strategy: false },
      MONTH,
    );
    expect(text).toContain("(Aucune donnée n'a été jointe à la question.)");
  });

  it("aperçu des données disponibles pour les cartes de sélection", async () => {
    seedUser();
    const preview = await getAiContextPreview(USER);
    expect(preview.accounts).toBe("2 enveloppe(s) configurée(s)");
    expect(preview.crypto).toContain("1 wallet(s)");
    expect(preview.strategy).toContain("2 poche(s)");
  });

  it("formate les montants en français et en euros", () => {
    expect(formatEur(1234.5)).toBe("1 234,50 €");
    expect(formatEur(0)).toBe("0,00 €");
    expect(formatSignedEur(387.6)).toBe("+387,60 €");
    expect(formatSignedEur(-10)).toBe("-10,00 €");
    expect(formatPercent(39.6)).toBe("39,6 %");
  });
});

describe("geminiAI — conseiller contextualisé", () => {
  it("construit un prompt système qui embarque le contexte et le cadre", () => {
    const prompt = buildAdvisorSystemPrompt("PEA Test · Amundi MSCI World");
    expect(prompt).toContain("=== DONNÉES DE L'UTILISATEUR ===");
    expect(prompt).toContain("=== FIN DES DONNÉES ===");
    expect(prompt).toContain("PEA Test · Amundi MSCI World");
    expect(prompt).toContain("euros (€)");
    expect(prompt).toContain("gestion de patrimoine français");
  });

  it("refuse l'appel sans clé API Gemini", async () => {
    // Pas de seed : la clé est vide par défaut.
    await expect(
      askGeminiAdvisor({
        username: USER,
        contextText: "contexte",
        history: [],
        question: "Où investir ?",
      }),
    ).rejects.toThrow(/Clé API Gemini/);
  });

  it("envoie contexte + historique + question et renvoie la réponse", async () => {
    seedUser();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "Priorité : renforcer le **fonds d'urgence**." },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const answer = await askGeminiAdvisor({
      username: USER,
      contextText: "PEA Test — 7 247,60 €",
      history: [
        { role: "user", text: "Première question" },
        { role: "assistant", text: "Première réponse" },
      ],
      question: "Et pour un achat immobilier ?",
    });

    expect(answer).toContain("**fonds d'urgence**");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
    expect(calls[0].url).toContain("test-gemini-key");

    const body = JSON.parse(String(calls[0].init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(body.systemInstruction.parts[0].text).toContain(
      "PEA Test — 7 247,60 €",
    );
    expect(body.contents).toHaveLength(3);
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[1].role).toBe("model");
    expect(body.contents[2].role).toBe("user");
    expect(body.contents[2].parts[0].text).toBe(
      "Et pour un achat immobilier ?",
    );
  });

  it("remonte les erreurs HTTP de Gemini", async () => {
    seedUser();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota exceeded", { status: 429 })),
    );
    await expect(
      askGeminiAdvisor({
        username: USER,
        contextText: "contexte",
        history: [],
        question: "Question",
      }),
    ).rejects.toThrow(/Erreur Gemini \(429\)/);
  });

  it("gère une réponse vide et le blocage sécurité", async () => {
    seedUser();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(
      askGeminiAdvisor({
        username: USER,
        contextText: "contexte",
        history: [],
        question: "Question",
      }),
    ).rejects.toThrow(/aucune réponse exploitable/);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ finishReason: "SAFETY", content: { parts: [] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      askGeminiAdvisor({
        username: USER,
        contextText: "contexte",
        history: [],
        question: "Question",
      }),
    ).rejects.toThrow(/filtres de sécurité/);
  });
});

describe("richText — mise en forme des réponses IA", () => {
  it("découpe titres, listes et paragraphes", () => {
    const blocks = parseRichText(
      "## Synthèse\n\nVotre situation est **solide**.\n\n- Premier point\n- Second point\n\n1. Étape une\n2. Étape deux\n",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bullets",
      "ordered",
    ]);
    expect(blocks[0]).toMatchObject({
      type: "heading",
      level: 2,
      text: "Synthèse",
    });
    expect(blocks[1]).toMatchObject({
      type: "paragraph",
      text: "Votre situation est **solide**.",
    });
    expect(blocks[2]).toMatchObject({
      type: "bullets",
      items: ["Premier point", "Second point"],
    });
    expect(blocks[3]).toMatchObject({
      type: "ordered",
      items: ["Étape une", "Étape deux"],
    });
  });

  it("gère un texte vide et les segments gras", () => {
    expect(parseRichText("")).toEqual([]);
    expect(splitBoldSegments("a **b** c")).toEqual([
      { bold: false, text: "a " },
      { bold: true, text: "b" },
      { bold: false, text: " c" },
    ]);
    expect(splitBoldSegments("sans gras")).toEqual([
      { bold: false, text: "sans gras" },
    ]);
  });
});

describe("storage wallets (rappel de cohérence)", () => {
  it("le wallet de test est bien relu depuis le serveur", async () => {
    const wallets = await getStoredWallets(USER);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].assets.length).toBeGreaterThanOrEqual(2);
  });
});
