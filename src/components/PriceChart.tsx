import React, { useState, useEffect } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { getCryptoBySymbol } from "../utils/cryptoDatabase";
import { getStockBySymbol } from "../utils/stockDatabase";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface PriceChartProps {
  symbol: string;
  name: string;
  currentPrice: number;
  high24h?: number;
  low24h?: number;
  height?: number;
}

const PriceChart: React.FC<PriceChartProps> = ({
  symbol,
  name,
  currentPrice,
  high24h,
  low24h,
  height = 300,
}) => {
  const [priceData, setPriceData] = useState<number[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistoricalData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Déterminer si c'est un crypto ou une action
        const isCrypto = getCryptoBySymbol(symbol) !== undefined;

        let data: number[][];

        if (isCrypto) {
          // Pour les cryptos, générer des données fictives basées sur high/low 24h
          data = generateCryptoSimulatedData(currentPrice, high24h, low24h);
        } else {
          data = await fetchStockHistoricalData(symbol);
        }

        setPriceData(data);
      } catch (err) {
        console.error(
          "Erreur lors de la récupération des données historiques:",
          err
        );
        setError("Impossible de charger les données historiques");
        // Fallback vers des données simulées
        setPriceData(generateFallbackData());
      } finally {
        setLoading(false);
      }
    };

    fetchHistoricalData();
  }, [symbol, currentPrice, high24h, low24h]);

  // Générer des données crypto simulées basées sur les high/low 24h
  const generateCryptoSimulatedData = (
    price: number,
    high?: number,
    low?: number
  ): number[][] => {
    const today = new Date();
    const data = [];

    // Utiliser les vraies valeurs high/low si disponibles, sinon estimer
    const dailyHigh = high || price * 1.1;
    const dailyLow = low || price * 0.9;

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      // Créer une variation simple entre low et high
      const progress = (30 - i) / 30; // De 0 à 1

      // Oscillation simple entre low et high avec quelques variations aléatoires
      const baseRange = dailyHigh - dailyLow;
      const cyclePosition = Math.sin(progress * Math.PI * 2) * 0.5 + 0.5; // De 0 à 1
      const randomVariation = (Math.random() - 0.5) * 0.2; // ±10%

      let simulatedPrice =
        dailyLow + baseRange * (cyclePosition + randomVariation);

      // S'assurer que le prix reste dans une fourchette raisonnable
      simulatedPrice = Math.max(simulatedPrice, dailyLow * 0.8);
      simulatedPrice = Math.min(simulatedPrice, dailyHigh * 1.2);

      // Le dernier point doit être le prix actuel
      if (i === 0) {
        simulatedPrice = price;
      }

      data.push([date.getTime(), simulatedPrice]);
    }

    return data;
  };

  // Récupérer les données historiques actions via Yahoo Finance
  const fetchStockHistoricalData = async (
    symbol: string
  ): Promise<number[][]> => {
    try {
      // Essayer d'abord avec notre serveur proxy
      const response = await fetch(
        `${API_BASE_URL}/api/history/${symbol}?days=30`
      );

      if (response.ok) {
        const data = await response.json();
        if (data.prices && Array.isArray(data.prices)) {
          return data.prices;
        }
      }
    } catch (error) {
      console.warn(
        "Serveur proxy non disponible, utilisation de Yahoo Finance direct"
      );
    }

    // Fallback : Yahoo Finance avec proxy CORS
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - 30 * 24 * 60 * 60; // 30 jours

    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`
    )}`;

    const response = await fetch(proxyUrl);

    if (!response.ok) {
      throw new Error("Erreur API Yahoo Finance");
    }

    const proxyData = await response.json();
    const data = JSON.parse(proxyData.contents);

    const result = data.chart?.result?.[0];
    if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
      const timestamps = result.timestamp;
      const prices = result.indicators.quote[0].close;

      return timestamps
        .map((timestamp: number, index: number) => [
          timestamp * 1000, // Convertir en millisecondes
          prices[index] || currentPrice,
        ])
        .filter((item: number[]) => item[1] !== null);
    }

    throw new Error("Données historiques actions invalides");
  };

  // Générer des données de fallback si les APIs échouent
  const generateFallbackData = (): number[][] => {
    const today = new Date();
    const data = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      // Créer une variation plus réaliste basée sur le prix actuel
      const baseVariation = Math.sin(i * 0.1) * 0.1;
      const randomVariation = (Math.random() - 0.5) * 0.05;
      const dailyVariation = 1 + baseVariation + randomVariation;

      const progressFactor = (30 - i) / 30;
      const targetPrice = currentPrice * (0.85 + progressFactor * 0.15);
      const price = targetPrice * dailyVariation;

      data.push([date.getTime(), Math.max(price, 0.01)]);
    }

    return data;
  };

  const isCrypto = getCryptoBySymbol(symbol) !== undefined;

  // Detect dark mode
  const isDark =
    typeof window !== "undefined" &&
    document.documentElement.classList.contains("dark");

  const options: Highcharts.Options = {
    chart: {
      type: "line",
      height,
      backgroundColor: isDark ? "#111111" : "transparent",
      margin: [10, 10, 50, 60],
      style: {
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      },
    },
    title: {
      text: undefined,
    },
    credits: {
      enabled: false,
    },
    legend: {
      enabled: false,
    },
    xAxis: {
      type: "datetime",
      labels: {
        format: "{value:%m/%d}",
        style: {
          fontSize: "10px",
          color: isDark ? "#fff" : "#6b7280",
        },
      },
      lineColor: isDark ? "#fff" : "#e5e7eb",
      tickColor: isDark ? "#fff" : "#e5e7eb",
    },
    yAxis: {
      title: {
        text: "Prix ($)",
        style: {
          fontSize: "11px",
          color: isDark ? "#fff" : "#6b7280",
        },
      },
      labels: {
        formatter: function () {
          return (
            "$" +
            Highcharts.numberFormat(
              this.value as number,
              currentPrice > 1 ? 0 : 4
            )
          );
        },
        style: {
          fontSize: "10px",
          color: isDark ? "#fff" : "#6b7280",
        },
      },
      gridLineColor: isDark ? "#333" : "#f3f4f6",
    },
    tooltip: {
      backgroundColor: isDark ? "#222" : "rgba(255, 255, 255, 0.95)",
      borderColor: isDark ? "#444" : "#e5e7eb",
      borderRadius: 8,
      shadow: true,
      style: {
        fontSize: "12px",
        color: isDark ? "#fff" : undefined,
      },
      formatter: function () {
        return `
          <b>${symbol}</b><br/>
          ${Highcharts.dateFormat("%A, %b %e, %Y", this.x as number)}<br/>
          Prix: <b>$${Highcharts.numberFormat(
            this.y as number,
            currentPrice > 1 ? 2 : 4
          )}</b>
        `;
      },
    },
    plotOptions: {
      line: {
        lineWidth: 2,
        marker: {
          enabled: false,
          states: {
            hover: {
              enabled: true,
              radius: 4,
            },
          },
        },
        states: {
          hover: {
            lineWidth: 3,
          },
        },
      },
    },
    series: [
      {
        name: symbol,
        type: "line",
        data: priceData,
        color: isCrypto ? "#f59e0b" : "#3b82f6", // Orange pour crypto, bleu pour actions
        zones:
          priceData.length > 0
            ? [
                {
                  value: currentPrice * 0.95,
                  color: "#ef4444", // Rouge pour les prix bas
                },
                {
                  color: isCrypto ? "#10b981" : "#10b981", // Vert pour les prix élevés
                },
              ]
            : [],
      },
    ],
  };

  if (loading) {
    return (
      <div className="price-chart">
        <div className="mb-2">
          <h4 className="text-sm font-medium text-gray-500">
            Évolution sur 30 jours - {name}
          </h4>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <span className="ml-2 text-gray-600">Chargement des données...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="price-chart">
        <div className="mb-2">
          <h4 className="text-sm font-medium text-gray-500">
            Évolution sur 30 jours - {name}
          </h4>
        </div>
        <div className="flex items-center justify-center h-64 text-orange-600">
          <div className="text-center">
            <p className="text-sm">{error}</p>
            <p className="text-xs mt-1">Données simulées affichées</p>
          </div>
        </div>
        <HighchartsReact highcharts={Highcharts} options={options} />
      </div>
    );
  }

  return (
    <div className="price-chart">
      <div className="mb-2">
        <h4 className="text-sm font-medium text-gray-500">
          Évolution sur 30 jours - {name}
          {isCrypto ? "🪙" : "📈"}
          {isCrypto && (
            <span className="text-xs text-gray-500 ml-1">
              (données simulées basées sur 24h high/low)
            </span>
          )}
        </h4>
      </div>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  );
};

export default PriceChart;
