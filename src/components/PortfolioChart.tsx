import React from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { Investment, Wallet } from "../types";

interface PortfolioChartProps {
  investments: Investment[];
  wallets?: Wallet[];
  chartType: "pie" | "line" | "column" | "area";
  title: string;
  subtitle?: string;
  height?: number;
  isAnonymous?: boolean;
}

const PortfolioChart: React.FC<PortfolioChartProps> = ({
  investments,
  wallets = [],
  chartType,
  title,
  subtitle,
  height = 400,
  isAnonymous = false,
}) => {
  // Palette de couleurs pour les assets individuels
  const assetColors = [
    "#3b82f6", // Bleu
    "#10b981", // Vert
    "#f59e0b", // Orange
    "#ef4444", // Rouge
    "#8b5cf6", // Violet
    "#06b6d4", // Cyan
    "#84cc16", // Lime
    "#f97316", // Orange foncé
    "#ec4899", // Rose
    "#6366f1", // Indigo
    "#14b8a6", // Teal
    "#f43f5e", // Rose foncé
    "#a855f7", // Violet foncé
    "#22c55e", // Vert foncé
    "#eab308", // Jaune
    "#06b6d4", // Bleu clair
    "#f97316", // Orange
    "#8b5cf6", // Violet
    "#ef4444", // Rouge
    "#10b981", // Vert
  ];

  // Fonction pour obtenir une couleur unique pour un asset
  const getAssetColor = (symbol: string, index: number): string => {
    // Essayer de maintenir une cohérence pour les cryptos populaires
    const cryptoColors: Record<string, string> = {
      BTC: "#f7931a", // Orange Bitcoin
      ETH: "#627eea", // Bleu Ethereum
      BNB: "#f3ba2f", // Jaune Binance
      ADA: "#0033ad", // Bleu Cardano
      SOL: "#9945ff", // Violet Solana
      DOT: "#e6007a", // Rose Polkadot
      MATIC: "#8247e5", // Violet Polygon
      LINK: "#2a5ada", // Bleu Chainlink
      UNI: "#ff007a", // Rose Uniswap
      AVAX: "#e84142", // Rouge Avalanche
    };

    const upperSymbol = symbol.toUpperCase();
    if (cryptoColors[upperSymbol]) {
      return cryptoColors[upperSymbol];
    }

    // Pour les autres assets, utiliser la palette rotative
    return assetColors[index % assetColors.length];
  };

  // Fonction pour obtenir tous les assets (investissements + wallets)
  const getAllAssets = () => {
    const assetsMap = new Map<
      string,
      {
        name: string;
        symbol: string;
        value: number;
        type: string;
        source: "investment" | "wallet";
        walletName?: string;
        quantity?: number;
      }
    >();

    // Ajouter les investissements
    investments.forEach((inv) => {
      const currentPrice = inv.currentPrice ?? 0;
      const value = inv.quantity * currentPrice;
      if (value > 0) {
        const key = inv.symbol.toUpperCase();
        if (assetsMap.has(key)) {
          // Si l'asset existe déjà, ajouter la valeur
          const existing = assetsMap.get(key)!;
          existing.value += value;
          if (existing.quantity) {
            existing.quantity += inv.quantity;
          } else {
            existing.quantity = inv.quantity;
          }
        } else {
          // Nouvel asset
          assetsMap.set(key, {
            name: inv.name,
            symbol: inv.symbol,
            value,
            type: inv.type,
            source: "investment",
            quantity: inv.quantity,
          });
        }
      }
    });

    // Ajouter les assets des wallets
    wallets.forEach((wallet) => {
      wallet.assets.forEach((asset) => {
        if (!asset.isHidden && asset.value && asset.value > 0) {
          const key = asset.symbol.toUpperCase();
          if (assetsMap.has(key)) {
            // Si l'asset existe déjà, ajouter la valeur
            const existing = assetsMap.get(key)!;
            existing.value += asset.value;
            if (existing.quantity) {
              existing.quantity += asset.balance;
            } else {
              existing.quantity = asset.balance;
            }
            // Mettre à jour le type si c'est un crypto (priorité aux cryptos)
            if (asset.blockchain) {
              existing.type = "crypto";
            }
          } else {
            // Nouvel asset
            assetsMap.set(key, {
              name: asset.name,
              symbol: asset.symbol,
              value: asset.value,
              type: "crypto",
              source: "wallet",
              walletName: wallet.name,
              quantity: asset.balance,
            });
          }
        }
      });

      // Ajouter les NFTs des wallets
      if (wallet.nfts) {
        wallet.nfts.forEach((nft) => {
          if (nft.value && nft.value > 0) {
            const key = `NFT-${nft.symbol}-${nft.tokenId || "unknown"}`;
            assetsMap.set(key, {
              name: nft.name,
              symbol: nft.symbol,
              value: nft.value,
              type: "nft",
              source: "wallet",
              walletName: wallet.name,
              quantity: nft.balance,
            });
          }
        });
      }
    });

    return Array.from(assetsMap.values());
  };

  // Detect dark mode
  const isDark =
    typeof window !== "undefined" &&
    document.documentElement.classList.contains("dark");

  const maskDigits = (text: string) =>
    isAnonymous ? text.replace(/[0-9]/g, "*") : text;
  const formatNumber = (value: number) =>
    maskDigits(
      Number(value || 0).toLocaleString("fr-FR", {
        maximumFractionDigits: 0,
      }),
    );
  const formatCurrency = (value: number) => `$${formatNumber(value)}`;
  const formatPercent = (value: number, digits: number = 1) =>
    `${maskDigits(Number(value || 0).toFixed(digits))}%`;

  // Configuration de base pour tous les graphiques
  const baseOptions: Highcharts.Options = {
    chart: {
      height,
      backgroundColor: isDark ? "#111111" : "transparent",
      style: {
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      },
    },
    title: {
      text: title,
      style: {
        fontSize: "18px",
        fontWeight: "600",
        color: isDark ? "#fff" : "#111827",
      },
    },
    subtitle: {
      text: subtitle,
      style: {
        fontSize: "14px",
        color: isDark ? "#fff" : "#6b7280",
      },
    },
    credits: {
      enabled: false,
    },
    legend: {
      itemStyle: {
        fontSize: "12px",
        color: isDark ? "#fff" : "#374151",
      },
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
    },
    xAxis: {
      labels: {
        style: {
          fontSize: "11px",
          color: isDark ? "#fff" : undefined,
        },
      },
    },
    yAxis: {
      title: {
        text: "Valeur ($)",
        style: {
          fontSize: "11px",
          color: isDark ? "#fff" : undefined,
        },
      },
      labels: {
        formatter: function () {
          return formatCurrency(this.value as number);
        },
        style: {
          fontSize: "11px",
          color: isDark ? "#fff" : undefined,
        },
      },
    },
  };

  // Générer les options spécifiques selon le type de graphique
  const generateChartOptions = (): Highcharts.Options => {
    switch (chartType) {
      case "pie":
        return generatePieChartOptions();
      case "line":
        return generateLineChartOptions();
      case "column":
        return generateColumnChartOptions();
      case "area":
        return generateAreaChartOptions();
      default:
        return baseOptions;
    }
  };

  // Graphique en secteurs - Répartition du portfolio
  const generatePieChartOptions = (): Highcharts.Options => {
    const allAssets = getAllAssets();

    // Créer les données pour chaque investissement individuel
    const pieData = allAssets
      .map((asset, index) => {
        const value = asset.value;
        return {
          name: asset.name, // Utiliser le nom (ETH, LVMH, BTC, etc.)
          y: value,
          fullName: asset.name, // Garder le nom complet pour le tooltip
          color: getAssetColor(asset.symbol, index), // Utiliser la couleur unique
          source: asset.source,
          walletName: asset.walletName,
        };
      })
      .filter((item) => item.y > 0) // Exclure les investissements sans valeur
      .sort((a, b) => b.y - a.y); // Trier par valeur décroissante

    return {
      ...baseOptions,
      chart: {
        ...baseOptions.chart,
        type: "pie",
      },
      plotOptions: {
        pie: {
          allowPointSelect: true,
          cursor: "pointer",
          dataLabels: {
            enabled: true,
            formatter: function () {
              const point = (this as any).point as Highcharts.Point;
              const value = point.y as number;
              const pct = (point.percentage as number) || 0;
              return `<b>${point.name}</b>: ${formatCurrency(value)} (${formatPercent(pct, 1)})`;
            },
            style: {
              fontSize: "11px",
            },
          },
          showInLegend: true,
        },
      },
      series: [
        {
          name: "Valeur",
          type: "pie",
          data: pieData,
        },
      ],
      tooltip: {
        ...baseOptions.tooltip,
        formatter: function () {
          const point = (this as any).point as Highcharts.Point as
            | (Highcharts.Point & { fullName?: string; percentage?: number })
            | undefined;
          const value = (point?.y as number) || 0;
          const pct = (point?.percentage as number) || 0;
          const name = point?.fullName || point?.name || "";
          return `<b>${name}</b><br/><b>${formatCurrency(value)}</b> (${formatPercent(pct, 1)})`;
        },
      },
    };
  };

  // Graphique linéaire - Performance dans le temps
  const generateLineChartOptions = (): Highcharts.Options => {
    // Simulation de données historiques (dans un vrai projet, cela viendrait d'une API)
    const today = new Date();
    const timeSeriesData = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (29 - i));

      const totalValue = getAllAssets().reduce((sum, asset) => {
        // Ajouter une petite variation pour simuler l'évolution
        const variation =
          1 + Math.sin(i * 0.2) * 0.05 + (Math.random() - 0.5) * 0.02;
        return sum + asset.value * variation;
      }, 0);

      return [date.getTime(), totalValue];
    });

    return {
      ...baseOptions,
      chart: {
        ...baseOptions.chart,
        type: "line",
      },
      title: {
        ...baseOptions.title,
        style: {
          ...baseOptions.title?.style,
          color: isDark ? "#fff" : baseOptions.title?.style?.color,
        },
      },
      subtitle: {
        ...baseOptions.subtitle,
        style: {
          ...baseOptions.subtitle?.style,
          color: isDark ? "#fff" : baseOptions.subtitle?.style?.color,
        },
      },
      legend: {
        ...baseOptions.legend,
        itemStyle: {
          ...baseOptions.legend?.itemStyle,
          color: isDark ? "#fff" : baseOptions.legend?.itemStyle?.color,
        },
      },
      xAxis: {
        type: "datetime",
        title: {
          text: "Date",
          style: {
            color: isDark ? "#fff" : undefined,
          },
        },
        labels: {
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        lineColor: isDark ? "#fff" : undefined,
        tickColor: isDark ? "#fff" : undefined,
        gridLineColor: isDark ? "#fff" : undefined,
      },
      yAxis: {
        title: {
          text: "Valeur ($)",
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        labels: {
          formatter: function () {
            return formatCurrency(this.value as number);
          },
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        lineColor: isDark ? "#fff" : undefined,
        tickColor: isDark ? "#fff" : undefined,
        gridLineColor: isDark ? "#fff" : undefined,
      },
      series: [
        {
          name: "Valeur du Portfolio",
          type: "line",
          data: timeSeriesData,
          color: "#3b82f6",
          lineWidth: 2,
          marker: {
            radius: 3,
          },
        },
      ],
      tooltip: {
        ...baseOptions.tooltip,
        xDateFormat: "%A, %b %e, %Y",
        formatter: function () {
          const date = this.x
            ? new Date(this.x as number).toLocaleDateString("fr-FR")
            : "";
          const value = this.y as number;
          return `${date ? `${maskDigits(date)}<br/>` : ""}<b>${formatCurrency(value)}</b>`;
        },
        style: {
          ...baseOptions.tooltip?.style,
          color: isDark ? "#fff" : undefined,
        },
      },
    };
  };

  // Graphique en colonnes - Comparaison des investissements
  const generateColumnChartOptions = (): Highcharts.Options => {
    const allAssets = getAllAssets();

    const topInvestments = allAssets
      .map((asset, index) => ({
        name: asset.name,
        symbol: asset.symbol,
        currentValue: asset.value,
        gainLoss: 0, // Pour les wallets, on ne peut pas calculer le gain/perte facilement
        type: asset.type,
        source: asset.source,
        walletName: asset.walletName,
        color: getAssetColor(asset.symbol, index), // Utiliser la couleur unique
      }))
      .sort((a, b) => b.currentValue - a.currentValue)
      .slice(0, 10);

    return {
      ...baseOptions,
      chart: {
        ...baseOptions.chart,
        type: "column",
      },
      title: {
        ...baseOptions.title,
        style: {
          ...baseOptions.title?.style,
          color: isDark ? "#fff" : baseOptions.title?.style?.color,
        },
      },
      subtitle: {
        ...baseOptions.subtitle,
        style: {
          ...baseOptions.subtitle?.style,
          color: isDark ? "#fff" : baseOptions.subtitle?.style?.color,
        },
      },
      legend: {
        ...baseOptions.legend,
        itemStyle: {
          ...baseOptions.legend?.itemStyle,
          color: isDark ? "#fff" : baseOptions.legend?.itemStyle?.color,
        },
      },
      xAxis: {
        categories: topInvestments.map((asset) => asset.symbol),
        title: {
          text: "Investissements",
          style: {
            color: isDark ? "#fff" : undefined,
          },
        },
        labels: {
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        lineColor: isDark ? "#fff" : undefined,
        tickColor: isDark ? "#fff" : undefined,
        gridLineColor: isDark ? "#fff" : undefined,
      },
      yAxis: {
        title: {
          text: "Valeur ($)",
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        labels: {
          formatter: function () {
            return formatCurrency(this.value as number);
          },
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        lineColor: isDark ? "#fff" : undefined,
        tickColor: isDark ? "#fff" : undefined,
        gridLineColor: isDark ? "#fff" : undefined,
      },
      series: [
        {
          name: "Valeur Actuelle",
          type: "column",
          data: topInvestments.map((asset) => ({
            y: asset.currentValue,
            color: asset.color,
          })),
        },
      ],
      tooltip: {
        ...baseOptions.tooltip,
        shared: true,
        formatter: function () {
          const header = this.x
            ? `<b>${maskDigits(String(this.x))}</b><br/>`
            : "";
          const points = this.points || [];
          const lines = points
            .map((point) => {
              const color = point.color || point.series.color;
              const name = point.series.name;
              return `<span style="color:${color}">●</span> ${name}: <b>${formatCurrency(
                point.y as number,
              )}</b><br/>`;
            })
            .join("");
          return header + lines;
        },
        style: {
          ...baseOptions.tooltip?.style,
          color: isDark ? "#fff" : undefined,
        },
      },
    };
  };

  // Graphique en aires - Performance cumulative
  const generateAreaChartOptions = (): Highcharts.Options => {
    const allAssets = getAllAssets();

    // Créer des données empilées pour l'effet de zone avec couleurs uniques
    const areaSeriesData = allAssets.map((asset, index) => ({
      name: asset.symbol,
      type: "area" as const,
      data: [asset.value],
      color: getAssetColor(asset.symbol, index),
    }));

    return {
      ...baseOptions,
      chart: {
        ...baseOptions.chart,
        type: "area",
      },
      title: {
        ...baseOptions.title,
        style: {
          ...baseOptions.title?.style,
          color: isDark ? "#fff" : baseOptions.title?.style?.color,
        },
      },
      subtitle: {
        ...baseOptions.subtitle,
        style: {
          ...baseOptions.subtitle?.style,
          color: isDark ? "#fff" : baseOptions.subtitle?.style?.color,
        },
      },
      legend: {
        ...baseOptions.legend,
        itemStyle: {
          ...baseOptions.legend?.itemStyle,
          color: isDark ? "#fff" : baseOptions.legend?.itemStyle?.color,
        },
      },
      xAxis: {
        ...baseOptions.xAxis,
        categories: ["Portfolio"],
        title: {
          text: "",
          style: {
            color: isDark ? "#fff" : undefined,
          },
        },
        labels: {
          ...(baseOptions.xAxis as any)?.labels,
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        lineColor: isDark ? "#fff" : undefined,
        tickColor: isDark ? "#fff" : undefined,
        gridLineColor: isDark ? "#fff" : undefined,
      },
      yAxis: {
        ...baseOptions.yAxis,
        title: {
          text: "Valeur ($)",
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        labels: {
          formatter: function () {
            return formatCurrency(this.value as number);
          },
          style: {
            fontSize: "11px",
            color: isDark ? "#fff" : undefined,
          },
        },
        lineColor: isDark ? "#fff" : undefined,
        tickColor: isDark ? "#fff" : undefined,
        gridLineColor: isDark ? "#fff" : undefined,
      },
      plotOptions: {
        area: {
          stacking: "normal",
          lineColor: "#ffffff",
          lineWidth: 1,
          marker: {
            lineWidth: 1,
            lineColor: "#ffffff",
          },
          dataLabels: {
            enabled: false,
            style: {
              color: isDark ? "#fff" : undefined,
            },
          },
        },
      },
      series: areaSeriesData,
      tooltip: {
        ...baseOptions.tooltip,
        shared: true,
        formatter: function () {
          const header = this.x
            ? `<b>${maskDigits(String(this.x))}</b><br/>`
            : "";
          const points = this.points || [];
          const lines = points
            .map((point) => {
              const color = point.color || point.series.color;
              const name = point.series.name;
              return `<span style="color:${color}">●</span> ${name}: <b>${formatCurrency(
                point.y as number,
              )}</b><br/>`;
            })
            .join("");
          return header + lines;
        },
        style: {
          ...baseOptions.tooltip?.style,
          color: isDark ? "#fff" : undefined,
        },
      },
    };
  };

  const chartOptions = generateChartOptions();

  if (getAllAssets().length === 0) {
    return (
      <div className="card flex items-center justify-center" style={{ height }}>
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">Aucune donnée à afficher</p>
          <p className="text-sm mt-1">
            Ajoutez des investissements ou des wallets pour voir les graphiques
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <HighchartsReact highcharts={Highcharts} options={chartOptions} />
    </div>
  );
};

export default PortfolioChart;
