import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SavingsStrategy } from "../types";
import {
  calculateSavingsProjection,
  isProjectedSavingsPocket,
} from "../utils/savingsStorage";

const HORIZONS = [1, 2, 3, 5, 10, 20];

const formatEur = (value: number): string =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);

interface SavingsProjectionPanelProps {
  strategy: SavingsStrategy;
}

const SavingsProjectionPanel: React.FC<SavingsProjectionPanelProps> = ({
  strategy,
}) => {
  const [years, setYears] = useState(strategy.horizonYears || 5);
  const projection = useMemo(
    () => calculateSavingsProjection(strategy, years),
    [strategy, years],
  );
  const placementPockets = strategy.pockets.filter(isProjectedSavingsPocket);
  const goalGroups = useMemo(() => {
    const groups = new Map<
      string,
      { name: string; goals: typeof projection.goalEstimations }
    >();
    projection.goalEstimations.forEach((goal) => {
      const id = goal.dossierId || goal.pocketId;
      const group = groups.get(id) || {
        name: goal.dossierName || goal.pocketName,
        goals: [],
      };
      group.goals.push(goal);
      groups.set(id, group);
    });
    return Array.from(groups.values());
  }, [projection.goalEstimations]);

  return (
    <section className="bg-[#111111] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-2xl p-5 shadow-xs space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] pb-3">
        <div>
          <h2 className="text-base font-bold text-[#f5f5f5]">
            Projection à partir du réel
          </h2>
          <p className="text-xs text-[#555555] mt-0.5">
            Chaque sous-compte suit son propre capital, versement et rendement.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-[#1a1a1a] bg-[#161616]/80 p-1 rounded-xl">
          {HORIZONS.map((horizon) => (
            <button
              key={horizon}
              type="button"
              onClick={() => setYears(horizon)}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition ${
                years === horizon
                  ? "bg-[#111111] dark:bg-[#1a1a1a] text-[#f5f5f5] shadow-xs"
                  : "text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5]"
              }`}
            >
              {horizon} an{horizon > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] p-3">
          <p className="text-xs text-[#555555]">
            Capital réel aujourd'hui
          </p>
          <p className="mt-1 text-xl font-bold text-[#f5f5f5]">
            {formatEur(projection.dataPoints[0]?.total || 0)}
          </p>
        </div>
        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] p-3">
          <p className="text-xs text-[#555555]">
            Capital projeté
          </p>
          <p className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatEur(projection.totalProjectedAtHorizon)}
          </p>
        </div>
        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] p-3">
          <p className="text-xs text-[#555555]">
            Épargne mensuelle prévue
          </p>
          <p className="mt-1 text-xl font-bold text-[#c8a55e] text-[#c8a55e]">
            {formatEur(
              placementPockets.reduce((total, pocket) => {
                const amount =
                  pocket.allocationType === "fixed"
                    ? Number(pocket.allocationValue) || 0
                    : 0;
                return total + amount;
              }, 0),
            )}
          </p>
        </div>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={projection.dataPoints}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              {projection.series.map((series) => (
                <linearGradient
                  key={series.id}
                  id={`savings-${series.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={series.color}
                    stopOpacity={0.45}
                  />
                  <stop
                    offset="95%"
                    stopColor={series.color}
                    stopOpacity={0.04}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              opacity={0.15}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ opacity: 0.2 }}
            />
            <YAxis
              tickFormatter={(value) => `${Math.round(value / 1000)}k€`}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <RechartsTooltip
              content={({ active, label, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111111] p-3 text-xs shadow-xl border-[rgba(255,255,255,0.06)] dark:bg-[#1a1a1a]">
                    <p className="mb-2 font-bold text-[#f5f5f5]">
                      {label}
                    </p>
                    <div className="space-y-1.5">
                      {payload.map((entry) => (
                        <div key={entry.dataKey} className="flex items-center justify-between gap-5">
                          <span className="flex items-center gap-1.5 text-[#8a8a8a]">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                            {entry.name}
                          </span>
                          <strong className="text-[#f5f5f5]">
                            {formatEur(Number(entry.value))}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
            />
            {projection.series.map((series) => (
              <Area
                key={series.id}
                type="monotone"
                dataKey={series.id}
                name={series.name}
                stroke={series.color}
                fill={`url(#savings-${series.id})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {goalGroups.length > 0 && (
        <div className="border-t border-[rgba(255,255,255,0.06)] pt-4 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-[#f5f5f5]">
              Échéancier des objectifs
            </h3>
            <p className="text-xs text-[#555555] mt-0.5">
              Dates estimées selon la stratégie actuellement reconduite.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {goalGroups.map((group) => (
              <div
                key={group.name}
                className="rounded-xl border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] p-3 space-y-2"
              >
                <h4 className="text-sm font-semibold text-[#f5f5f5] truncate">
                  {group.name}
                </h4>
                <div className="space-y-3">
                  {group.goals.map((goal) => {
                    const progress = goal.targetAmount > 0
                      ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)
                      : 0;
                    return (
                      <div key={goal.pocketId} className="space-y-1.5 border-t border-[rgba(255,255,255,0.06)] pt-2 first:border-t-0 first:pt-0 border-[rgba(255,255,255,0.06)]">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-[#f5f5f5]  truncate">
                            {goal.pocketName}
                          </span>
                          <span className="font-bold text-[#c8a55e] text-[#c8a55e] whitespace-nowrap">
                            {goal.targetAmount <= 0
                              ? "Sans objectif"
                              : goal.isReached
                                ? "Atteint"
                                : goal.projectedDate || "Non défini"}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-[#484848] overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] text-[#555555]">
                          <span>{formatEur(goal.currentAmount)}{goal.targetAmount > 0 ? ` / ${formatEur(goal.targetAmount)}` : ""}</span>
                          <span>{formatEur(goal.monthlySavings)} / mois</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default SavingsProjectionPanel;
