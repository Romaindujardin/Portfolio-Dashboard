import React, { useState, useEffect } from "react";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Target,
  Lightbulb,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Investment, Wallet } from "../types";
import { getStoredInvestments, getStoredWallets } from "../utils/storage";
import { analyzePortfolio, PortfolioAnalysis } from "../utils/geminiAI";
import { useUser } from "../contexts/UserContext";

const AIAnalysis: React.FC = () => {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const { currentUser } = useUser();

  useEffect(() => {
    const loadData = async () => {
      try {
        const storedInvestments = await getStoredInvestments(currentUser);
        setInvestments(storedInvestments);

        const storedWallets = await getStoredWallets(currentUser);
        setWallets(storedWallets);
      } catch (error) {
        console.error("❌ Erreur lors du chargement des données:", error);
        setInvestments([]);
        setWallets([]);
      }
    };

    loadData();
  }, [currentUser]);

  const handleAnalyze = async () => {
    const totalAssets =
      investments.length +
      wallets.reduce(
        (sum, wallet) =>
          sum + wallet.assets.filter((asset) => !asset.isHidden).length,
        0
      );

    if (totalAssets === 0) {
      setError(
        "Aucun asset à analyser. Ajoutez d'abord des investissements ou des wallets."
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await analyzePortfolio(investments, wallets, currentUser);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'analyse");
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case "Faible":
        return "text-green-600 bg-green-100";
      case "Modéré":
        return "text-yellow-600 bg-yellow-100";
      case "Élevé":
        return "text-orange-600 bg-orange-100";
      case "Très Élevé":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return "text-green-600";
    if (score >= 6) return "text-yellow-600";
    if (score >= 4) return "text-orange-600";
    return "text-red-600";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-6 text-white">
        <div className="flex items-center space-x-3 mb-4">
          <Brain size={32} />
          <h1 className="text-2xl font-bold">Analyse IA du Portefeuille</h1>
        </div>
        <p className="text-blue-100">
          Obtenez une analyse détaillée de votre portefeuille par l'intelligence
          artificielle Gemini
        </p>
      </div>

      {/* Statistiques du portefeuille */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Assets Totaux</p>
              <p className="text-2xl font-bold text-gray-900">
                {investments.length +
                  wallets.reduce(
                    (sum, wallet) =>
                      sum +
                      wallet.assets.filter((asset) => !asset.isHidden).length,
                    0
                  )}
              </p>
            </div>
            <BarChart3 className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Valeur Totale</p>
              <p className="text-2xl font-bold text-gray-900">
                $
                {(
                  investments.reduce(
                    (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
                    0
                  ) +
                  wallets.reduce(
                    (sum, wallet) =>
                      sum +
                      wallet.assets
                        .filter((asset) => !asset.isHidden)
                        .reduce(
                          (assetSum, asset) => assetSum + (asset.value || 0),
                          0
                        ) +
                      (wallet.nfts || []).reduce(
                        (nftSum, nft) => nftSum + (nft.value || 0),
                        0
                      ),
                    0
                  )
                ).toLocaleString()}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Wallets</p>
              <p className="text-2xl font-bold text-gray-900">
                {wallets.length}
              </p>
            </div>
            <Target className="h-8 w-8 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Bouton d'analyse */}
      <div className="text-center">
        <button
          onClick={handleAnalyze}
          disabled={loading || investments.length === 0}
          className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
              Analyse en cours...
            </>
          ) : (
            <>
              <Brain className="-ml-1 mr-3 h-5 w-5" />
              Analyser mon portefeuille
            </>
          )}
        </button>
      </div>

      {/* Erreur */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Résultats de l'analyse */}
      {analysis && (
        <div className="space-y-6">
          {/* Scores et métriques */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Niveau de Risque
              </h3>
              <div
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getRiskColor(
                  analysis.riskLevel
                )}`}
              >
                {analysis.riskLevel}
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Score de Diversification
              </h3>
              <div className="flex items-center space-x-2">
                <span
                  className={`text-3xl font-bold ${getScoreColor(
                    analysis.diversificationScore
                  )}`}
                >
                  {analysis.diversificationScore}
                </span>
                <span className="text-gray-500">/ 10</span>
              </div>
            </div>
          </div>

          {/* Évaluation globale */}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <BarChart3 className="mr-2" />
              Évaluation Globale
            </h3>
            <p className="text-gray-700 leading-relaxed">
              {analysis.overallAssessment}
            </p>
          </div>

          {/* Forces et Faiblesses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center text-green-600">
                <TrendingUp className="mr-2" />
                Forces du Portefeuille
              </h3>
              <ul className="space-y-2">
                {analysis.strengths.map((strength, index) => (
                  <li key={index} className="flex items-start">
                    <span className="text-green-500 mr-2">✓</span>
                    <span className="text-gray-700">{strength}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center text-orange-600">
                <AlertTriangle className="mr-2" />
                Points d'Amélioration
              </h3>
              <ul className="space-y-2">
                {analysis.weaknesses.map((weakness, index) => (
                  <li key={index} className="flex items-start">
                    <span className="text-orange-500 mr-2">⚠</span>
                    <span className="text-gray-700">{weakness}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recommandations */}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center text-blue-600">
              <Lightbulb className="mr-2" />
              Recommandations
            </h3>
            <ul className="space-y-3">
              {analysis.recommendations.map((recommendation, index) => (
                <li key={index} className="flex items-start">
                  <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium mr-3 mt-0.5">
                    {index + 1}
                  </span>
                  <span className="text-gray-700">{recommendation}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Sentiment de marché */}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Target className="mr-2" />
              Sentiment de Marché
            </h3>
            <p className="text-gray-700 leading-relaxed">
              {analysis.marketSentiment}
            </p>
          </div>

          {/* Prochaines étapes */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-6 border border-purple-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center text-purple-600">
              <Target className="mr-2" />
              Prochaines Étapes Prioritaires
            </h3>
            <ul className="space-y-2">
              {analysis.nextSteps.map((step, index) => (
                <li key={index} className="flex items-start">
                  <span className="bg-purple-100 text-purple-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium mr-3 mt-0.5">
                    {index + 1}
                  </span>
                  <span className="text-gray-700">{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Note sur l'IA */}
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <div className="flex">
          <Brain className="h-5 w-5 text-blue-400" />
          <div className="ml-3">
            <p className="text-sm text-blue-800">
              <strong>Analyse propulsée par Gemini AI</strong> - Cette analyse
              est générée par l'intelligence artificielle et doit être
              considérée comme un outil d'aide à la décision. Consultez toujours
              un conseiller financier pour des décisions d'investissement
              importantes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIAnalysis;
