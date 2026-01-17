// Service d'analyse de portefeuille avec Gemini AI
import { Investment, Wallet } from "../types";
import { getCryptoBySymbol, getAllCryptos } from "./cryptoDatabase";
import { getGeminiApiKey } from "./userSettings";

// Fonction pour obtenir l'URL de l'API Gemini avec la clé de l'utilisateur
const getGeminiApiUrl = (username: string): string => {
  const apiKey = getGeminiApiKey(username);
  if (!apiKey) {
    throw new Error(
      "Clé API Gemini non configurée. Veuillez la configurer dans les paramètres."
    );
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
};

// Fonction pour enrichir l'analyse avec des données web
const getMarketContext = async (
  investments: Investment[],
  wallets: Wallet[]
): Promise<string> => {
  try {
    // Récupérer des infos de marché récentes pour les principales positions
    const allAssets = [
      ...investments.map((inv) => ({
        symbol: inv.symbol,
        name: inv.name,
        value: inv.quantity * (inv.currentPrice ?? 0),
        type: inv.type,
      })),
      ...wallets.flatMap((wallet) =>
        wallet.assets
          .filter((asset) => !asset.isHidden && asset.value && asset.value > 0)
          .map((asset) => ({
            symbol: asset.symbol,
            name: asset.name,
            value: asset.value || 0,
            type: "crypto",
          }))
      ),
    ];

    const majorPositions = allAssets
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);

    const marketInfo = majorPositions
      .map((asset) => {
        if (asset.type === "crypto") {
          const crypto = getCryptoBySymbol(asset.symbol);
          if (crypto) {
            return `${asset.symbol}: Prix actuel $${
              crypto.current_price
            }, Rang #${
              crypto.market_cap_rank
            }, Variation 24h: ${crypto.price_change_percentage_24h?.toFixed(
              2
            )}%`;
          }
        }
        return `${
          asset.symbol
        }: Valeur actuelle $${asset.value.toLocaleString()}`;
      })
      .join("\n");

    return `
CONTEXTE MARCHÉ EN TEMPS RÉEL:
${marketInfo}

TENDANCES GÉNÉRALES (Décembre 2024):
- Bitcoin maintient ses niveaux élevés autour de 97k-100k USD
- Altcoins montrent une volatilité accrue
- Secteur tech sous pression avec les taux d'intérêt
- Rotation sectorielle vers la value et les dividendes
- Incertitudes géopolitiques affectant les marchés
`;
  } catch (error) {
    console.warn("Erreur lors de la récupération du contexte marché:", error);
    return "Contexte marché: Données non disponibles";
  }
};

export interface PortfolioAnalysis {
  overallAssessment: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  riskLevel: "Faible" | "Modéré" | "Élevé" | "Très Élevé";
  diversificationScore: number;
  marketSentiment: string;
  nextSteps: string[];
}

// Fonction pour préparer les données du portefeuille pour l'IA
const preparePortfolioData = (investments: Investment[], wallets: Wallet[]) => {
  // Calculer la valeur totale incluant les wallets
  const investmentsValue = investments.reduce(
    (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
    0
  );

  const walletsValue = wallets.reduce(
    (sum, wallet) =>
      sum +
      wallet.assets
        .filter((asset) => !asset.isHidden)
        .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
      (wallet.nfts || []).reduce((nftSum, nft) => nftSum + (nft.value || 0), 0),
    0
  );

  const totalValue = investmentsValue + walletsValue;

  const portfolioSummary = [
    // Investissements
    ...investments.map((inv) => {
      const currentValue = inv.quantity * (inv.currentPrice ?? 0);
      const purchaseValue = inv.quantity * inv.purchasePrice;
      const profitLoss = currentValue - purchaseValue;
      const profitLossPercent = ((profitLoss / purchaseValue) * 100).toFixed(2);

      // Récupérer des infos supplémentaires pour les cryptos
      let additionalInfo = "";
      if (inv.type === "crypto") {
        const cryptoData = getCryptoBySymbol(inv.symbol);
        if (cryptoData) {
          additionalInfo = `Market Cap Rank: #${
            cryptoData.market_cap_rank
          }, 24h Change: ${cryptoData.price_change_percentage_24h?.toFixed(
            2
          )}%`;
        }
      }

      return {
        name: inv.name,
        symbol: inv.symbol,
        type: inv.type,
        quantity: inv.quantity,
        purchasePrice: inv.purchasePrice,
        currentPrice: inv.currentPrice,
        currentValue: currentValue,
        profitLoss: profitLoss,
        profitLossPercent: profitLossPercent,
        weightInPortfolio: ((currentValue / totalValue) * 100).toFixed(2),
        purchaseDate: inv.purchaseDate,
        notes: inv.notes || "",
        additionalInfo,
        source: "investment",
      };
    }),
    // Assets des wallets
    ...wallets.flatMap((wallet) =>
      wallet.assets
        .filter((asset) => !asset.isHidden && asset.value && asset.value > 0)
        .map((asset) => ({
          name: asset.name,
          symbol: asset.symbol,
          type: "crypto",
          quantity: asset.balance,
          purchasePrice: 0, // Pas de données d'achat pour les wallets
          currentPrice: asset.price || 0,
          currentValue: asset.value || 0,
          profitLoss: 0, // Pas de données de gain/perte pour les wallets
          profitLossPercent: "0.00",
          weightInPortfolio: (((asset.value || 0) / totalValue) * 100).toFixed(
            2
          ),
          purchaseDate: wallet.addedAt,
          notes: `Wallet: ${wallet.name}`,
          additionalInfo: `Blockchain: ${asset.blockchain}`,
          source: "wallet",
        }))
    ),
  ];

  // Statistiques globales du portefeuille
  const totalProfitLoss = portfolioSummary
    .filter((item) => item.source === "investment")
    .reduce((sum, inv) => sum + inv.profitLoss, 0);

  const totalPurchaseValue = investments.reduce(
    (sum, inv) => sum + inv.quantity * inv.purchasePrice,
    0
  );

  const overallReturn =
    totalPurchaseValue > 0
      ? ((totalProfitLoss / totalPurchaseValue) * 100).toFixed(2)
      : "0.00";

  // Répartition par type d'actif
  const assetAllocation = portfolioSummary.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + item.currentValue;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalValue: totalValue.toFixed(2),
    totalProfitLoss: totalProfitLoss.toFixed(2),
    overallReturn: overallReturn,
    numberOfPositions: portfolioSummary.length,
    assetAllocation: Object.entries(assetAllocation).map(([type, value]) => ({
      type,
      value: value.toFixed(2),
      percentage: ((value / totalValue) * 100).toFixed(2),
    })),
    positions: portfolioSummary,
  };
};

// Fonction pour générer le prompt d'analyse
const generateAnalysisPrompt = (portfolioData: any, marketContext: string) => {
  const currentMarketContext = marketContext;

  const portfolioDetails = `
RÉSUMÉ DU PORTEFEUILLE:
- Valeur totale: $${portfolioData.totalValue}
- Profit/Perte total: $${portfolioData.totalProfitLoss} (${
    portfolioData.overallReturn
  }%)
- Nombre de positions: ${portfolioData.numberOfPositions}

RÉPARTITION PAR TYPE D'ACTIF:
${portfolioData.assetAllocation
  .map(
    (allocation: any) =>
      `- ${allocation.type}: $${allocation.value} (${allocation.percentage}%)`
  )
  .join("\n")}

POSITIONS DÉTAILLÉES:
${portfolioData.positions
  .map(
    (pos: any) =>
      `- ${pos.name} (${pos.symbol}): ${pos.quantity} unités
    ${
      pos.source === "investment"
        ? `Prix d'achat: $${pos.purchasePrice} | Prix actuel: $${pos.currentPrice}
    Valeur: $${pos.currentValue} | P&L: $${pos.profitLoss} (${pos.profitLossPercent}%)`
        : `Valeur: $${pos.currentValue} | Source: ${pos.notes}`
    }
    Poids: ${pos.weightInPortfolio}% | ${
        pos.source === "investment"
          ? `Acheté le: ${new Date(pos.purchaseDate).toLocaleDateString()}`
          : `Ajouté le: ${new Date(pos.purchaseDate).toLocaleDateString()}`
      }
    ${pos.notes ? `Note: "${pos.notes}"` : ""}
    ${pos.additionalInfo ? `Info: ${pos.additionalInfo}` : ""}
  `
  )
  .join("\n\n")}
`;

  return `${currentMarketContext}${portfolioDetails}

En tant qu'analyste financier expert, analyse ce portefeuille d'investissement (incluant investissements traditionnels et assets blockchain) et fournis:

1. **ÉVALUATION GLOBALE**: Une analyse générale de la performance et de la composition du portefeuille

2. **FORCES**: Les points positifs du portefeuille (diversification, choix d'actifs, timing, etc.)

3. **FAIBLESSES**: Les points d'amélioration (concentration excessive, actifs risqués, etc.)

4. **RECOMMANDATIONS**: 3-5 actions concrètes pour optimiser le portefeuille

5. **NIVEAU DE RISQUE**: Évalue le risque global (Faible/Modéré/Élevé/Très Élevé) avec justification

6. **SCORE DE DIVERSIFICATION**: Note sur 10 avec explication

7. **SENTIMENT DE MARCHÉ**: Comment ce portefeuille est positionné par rapport au marché actuel

8. **PROCHAINES ÉTAPES**: Actions prioritaires à court terme (1-3 mois)

IMPORTANT: 
- Prends en compte les notes personnelles de l'investisseur pour comprendre sa stratégie
- Considère les assets blockchain comme des cryptomonnaies dans l'analyse
- Les assets des wallets n'ont pas de données de gain/perte historiques, concentre-toi sur leur valeur actuelle et leur poids dans le portefeuille
- Évalue la diversification globale incluant investissements traditionnels et cryptomonnaies

Sois précis, constructif et base tes analyses sur les données fournies et le contexte économique actuel.`;
};

// Fonction principale pour analyser le portefeuille
export const analyzePortfolio = async (
  investments: Investment[],
  wallets: Wallet[],
  username: string = "Romain"
): Promise<PortfolioAnalysis> => {
  if (investments.length === 0) {
    throw new Error("Aucun investissement à analyser");
  }

  try {
    console.log("🤖 Analyse du portefeuille avec Gemini AI...");

    const portfolioData = preparePortfolioData(investments, wallets);
    const marketContext = await getMarketContext(investments, wallets);
    const prompt = generateAnalysisPrompt(portfolioData, marketContext);

    const response = await fetch(getGeminiApiUrl(username), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Réponse API Gemini:", errorText);
      throw new Error(`Erreur API Gemini: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (
      !data.candidates ||
      !data.candidates[0] ||
      !data.candidates[0].content
    ) {
      throw new Error("Réponse API invalide");
    }

    const analysisText = data.candidates[0].content.parts[0].text;

    // Parser la réponse de l'IA pour extraire les sections
    const analysis = parseAIResponse(analysisText, portfolioData);

    console.log("✅ Analyse terminée avec succès");
    return analysis;
  } catch (error) {
    console.error("❌ Erreur lors de l'analyse:", error);
    throw new Error(
      "Impossible d'analyser le portefeuille. Veuillez réessayer."
    );
  }
};

// Fonction pour parser la réponse de l'IA
const parseAIResponse = (
  text: string,
  portfolioData: any
): PortfolioAnalysis => {
  console.log("Réponse IA brute:", text); // Pour debug

  // Calcul du score de diversification basé sur les données
  const diversificationScore = calculateDiversificationScore(portfolioData);

  // Détermination du niveau de risque basé sur la composition
  const riskLevel = calculateRiskLevel(portfolioData);

  // Extraction de l'évaluation globale
  const overallAssessment =
    extractBetweenSections(
      text,
      [
        "**1. ÉVALUATION GLOBALE:**",
        "1. ÉVALUATION GLOBALE:",
        "ÉVALUATION GLOBALE",
      ],
      ["**2. FORCES:**", "2. FORCES:", "FORCES"]
    ) ||
    "Votre portefeuille présente une composition intéressante avec des opportunités d'optimisation.";

  // Extraction des forces
  const strengths = extractListItems(
    text,
    ["**2. FORCES:**", "2. FORCES:", "FORCES"],
    ["**3. FAIBLESSES:**", "3. FAIBLESSES:", "FAIBLESSES"]
  ) || ["Présence d'actifs en croissance", "Exposition aux marchés émergents"];

  // Extraction des faiblesses
  const weaknesses = extractListItems(
    text,
    ["**3. FAIBLESSES:**", "3. FAIBLESSES:", "FAIBLESSES"],
    ["**4. RECOMMANDATIONS:**", "4. RECOMMANDATIONS:", "RECOMMANDATIONS"]
  ) || [
    "Concentration excessive sur un seul actif",
    "Manque de diversification",
    "Niveau de risque très élevé",
  ];

  // Extraction des recommandations
  const recommendations = extractListItems(
    text,
    ["**4. RECOMMANDATIONS:**", "4. RECOMMANDATIONS:", "RECOMMANDATIONS"],
    ["**5. NIVEAU DE RISQUE:**", "5. NIVEAU DE RISQUE:", "NIVEAU DE RISQUE"]
  ) || [
    "Diversifier immédiatement le portefeuille",
    "Réduire l'exposition aux actifs très volatils",
    "Ajouter des actifs plus stables",
    "Établir une stratégie de gestion des risques",
  ];

  // Extraction du sentiment de marché
  const marketSentiment =
    extractBetweenSections(
      text,
      [
        "**7. SENTIMENT DE MARCHÉ:**",
        "7. SENTIMENT DE MARCHÉ:",
        "SENTIMENT DE MARCHÉ",
      ],
      ["**8. PROCHAINES ÉTAPES", "8. PROCHAINES ÉTAPES", "PROCHAINES ÉTAPES"]
    ) ||
    "Le marché des cryptomonnaies présente une forte volatilité avec des opportunités mais aussi des risques importants.";

  // Extraction des prochaines étapes
  const nextSteps = extractListItems(
    text,
    ["**8. PROCHAINES ÉTAPES", "8. PROCHAINES ÉTAPES", "PROCHAINES ÉTAPES"],
    ["**Conclusion:**", "Conclusion:", "CONCLUSION"]
  ) || [
    "Diversifier immédiatement en ajoutant d'autres actifs",
    "Définir une stratégie d'allocation d'actifs",
    "Surveiller étroitement les positions existantes",
  ];

  return {
    overallAssessment: cleanText(overallAssessment),
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    recommendations: recommendations.slice(0, 5),
    riskLevel,
    diversificationScore,
    marketSentiment: cleanText(marketSentiment),
    nextSteps: nextSteps.slice(0, 4),
  };
};

// Fonction pour extraire du texte entre deux sections
const extractBetweenSections = (
  text: string,
  startMarkers: string[],
  endMarkers: string[]
): string => {
  for (const startMarker of startMarkers) {
    const startIndex = text.indexOf(startMarker);
    if (startIndex !== -1) {
      let content = text.substring(startIndex + startMarker.length);

      // Trouver la fin de la section
      let endIndex = content.length;
      for (const endMarker of endMarkers) {
        const markerIndex = content.indexOf(endMarker);
        if (markerIndex !== -1 && markerIndex < endIndex) {
          endIndex = markerIndex;
        }
      }

      content = content.substring(0, endIndex).trim();
      if (content.length > 0) {
        return content;
      }
    }
  }
  return "";
};

// Fonction pour extraire les éléments de liste
const extractListItems = (
  text: string,
  startMarkers: string[],
  endMarkers: string[]
): string[] => {
  const sectionText = extractBetweenSections(text, startMarkers, endMarkers);
  if (!sectionText) return [];

  const items: string[] = [];
  const lines = sectionText.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Ignorer les lignes vides
    if (trimmedLine.length === 0) continue;

    // Extraire les éléments avec numérotation (1., 2., etc.) ou puces (* )
    let cleanItem = "";

    if (/^\d+\./.test(trimmedLine)) {
      // Ligne numérotée (1., 2., etc.)
      cleanItem = trimmedLine.replace(/^\d+\.\s*/, "").trim();
    } else if (trimmedLine.startsWith("* ")) {
      // Ligne avec puce
      cleanItem = trimmedLine.replace(/^\*\s*/, "").trim();
    } else if (trimmedLine.startsWith("**") && trimmedLine.includes(":**")) {
      // Ligne avec titre en gras suivi de deux points
      cleanItem = trimmedLine.replace(/^\*\*([^*]+)\*\*:\s*/, "$1: ").trim();
    }

    // Ajouter l'élément s'il est substantiel
    if (cleanItem.length > 15) {
      items.push(cleanItem);
    }
  }

  return items;
};

// Fonction pour nettoyer le texte
const cleanText = (text: string): string => {
  return text
    .replace(/\*\*/g, "") // Supprimer les astérisques
    .replace(/^\s*[\*\-]\s*/gm, "") // Supprimer les puces en début de ligne
    .replace(/^\d+\.\s*/gm, "") // Supprimer la numérotation
    .trim();
};

// Fonction utilitaire pour échapper les caractères spéciaux regex
const escapeRegex = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Calcul du score de diversification
const calculateDiversificationScore = (portfolioData: any): number => {
  const assetTypes = portfolioData.assetAllocation.length;
  const positions = portfolioData.numberOfPositions;

  // Score basé sur le nombre de types d'actifs et de positions
  let score = Math.min(assetTypes * 2, 6); // Max 6 points pour la diversification par type
  score += Math.min(positions * 0.5, 4); // Max 4 points pour le nombre de positions

  // Pénalité si une position représente plus de 50% du portefeuille
  const maxWeight = Math.max(
    ...portfolioData.positions.map((p: any) => parseFloat(p.weightInPortfolio))
  );
  if (maxWeight > 50) score -= 2;
  if (maxWeight > 70) score -= 2;

  return Math.max(0, Math.min(10, Math.round(score)));
};

// Calcul du niveau de risque
const calculateRiskLevel = (
  portfolioData: any
): "Faible" | "Modéré" | "Élevé" | "Très Élevé" => {
  const cryptoWeight =
    portfolioData.assetAllocation.find((a: any) => a.type === "crypto")
      ?.percentage || 0;
  const stockWeight =
    portfolioData.assetAllocation.find((a: any) => a.type === "stock")
      ?.percentage || 0;

  if (parseFloat(cryptoWeight) > 70) return "Très Élevé";
  if (parseFloat(cryptoWeight) > 40) return "Élevé";
  if (parseFloat(stockWeight) > 80) return "Modéré";
  return "Faible";
};
