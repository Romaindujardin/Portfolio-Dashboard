import React from "react";

type SankeyNode = {
  id: string;
  label: string;
  side: "left" | "right";
  value: number;
  color: string;
};

type SankeyLink = {
  id: string;
  sourceId: string;
  targetId: string;
  value: number;
  color: string;
  title: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatEur(n: number, isAnonymous: boolean) {
  const raw = n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
  return isAnonymous ? raw.replace(/[0-9]/g, "*") : raw;
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function useSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}

export type CashflowSpaghettiInput = {
  incomeByCategory: Array<{ name: string; value: number }>; // value >= 0
  expenseByCategory: Array<{ name: string; value: number }>; // value >= 0
  colorsByCategory?: Record<string, string>;
  height?: number;
  maxIncomeCategories?: number;
  maxExpenseCategories?: number;
  isAnonymous?: boolean;
};

function topAndOthers(
  rows: Array<{ name: string; value: number }>,
  max: number,
  othersLabel: string,
) {
  const clean = rows
    .filter((r) => Number.isFinite(r.value) && r.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value);

  const top = clean.slice(0, Math.max(0, max));
  const rest = clean.slice(Math.max(0, max));
  const restSum = rest.reduce((s, r) => s + r.value, 0);
  if (restSum > 0) top.push({ name: othersLabel, value: restSum });
  return top;
}

export default function CashflowSpaghetti({
  incomeByCategory,
  expenseByCategory,
  colorsByCategory,
  height = 256,
  maxIncomeCategories = 6,
  maxExpenseCategories = 8,
  isAnonymous = false,
}: CashflowSpaghettiInput) {
  const { ref, width } = useSize<HTMLDivElement>();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = React.useState<{
    open: boolean;
    x: number;
    y: number;
    title: string;
    amount: number;
  }>({ open: false, x: 0, y: 0, title: "", amount: 0 });

  const showTooltip = React.useCallback(
    (e: React.MouseEvent, title: string, amount: number) => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      setTooltip({ open: true, x, y, title, amount });
    },
    [],
  );

  const hideTooltip = React.useCallback(() => {
    setTooltip((t) => (t.open ? { ...t, open: false } : t));
  }, []);

  const data = React.useMemo(() => {
    // We display only expense categories (right side), but totals must reflect all income/expense.
    const totalIncome = incomeByCategory
      .filter((r) => Number.isFinite(r.value) && r.value > 0)
      .reduce((s, r) => s + r.value, 0);

    const expenses = topAndOthers(
      expenseByCategory,
      maxExpenseCategories,
      "Autres sorties",
    );

    const totalExpenses = expenses.reduce((s, r) => s + r.value, 0);

    const nodes: SankeyNode[] = [];
    const links: SankeyLink[] = [];

    const getColor = (name: string, fallback: string) =>
      (colorsByCategory && colorsByCategory[name]) || fallback;

    // Deterministic fallback palette (only used when caller didn't provide a color)
    const palette = [
      "#3b82f6",
      "#10b981",
      "#f59e0b",
      "#ef4444",
      "#8b5cf6",
      "#06b6d4",
      "#f97316",
      "#22c55e",
      "#eab308",
      "#a855f7",
    ];
    const fallbackColor = (i: number) => palette[i % palette.length];

    // Edge cases
    if (totalIncome <= 0 && totalExpenses <= 0) {
      return { nodes, links, totalFlow: 0 };
    }

    // Flow is "checkpointed": left (income + optional balance) -> checkpoint -> right (expense categories + optional savings)
    const addLeftBalance =
      totalExpenses > totalIncome ? totalExpenses - totalIncome : 0;
    const addRightSavings =
      totalIncome > totalExpenses ? totalIncome - totalExpenses : 0;
    const totalFlow = Math.max(totalIncome, totalExpenses);

    // Left nodes (aggregated)
    if (totalIncome > 0) {
      nodes.push({
        id: "in:Entrées",
        label: "Entrées",
        side: "left",
        value: totalIncome,
        color: getColor("Entrées", "#10b981"),
      });
    }
    if (addLeftBalance > 0) {
      nodes.push({
        id: "in:Solde",
        label: "Solde (complément)",
        side: "left",
        value: addLeftBalance,
        color: getColor("Solde (complément)", "#94a3b8"),
      });
    }

    // Middle checkpoint node (stored as a "left" node but positioned in the center by layout code)
    nodes.push({
      id: "mid:Checkpoint",
      label: "Checkpoint",
      side: "left",
      value: totalFlow,
      color: getColor("Checkpoint", "#64748b"),
    });

    // Right nodes (expense categories)
    expenses.forEach((r, idx) => {
      nodes.push({
        id: `out:${r.name}`,
        label: r.name,
        side: "right",
        value: r.value,
        color: getColor(r.name, fallbackColor(idx + 3)),
      });
    });
    if (addRightSavings > 0) {
      nodes.push({
        id: "out:Épargne",
        label: "Épargne / reste",
        side: "right",
        value: addRightSavings,
        color: getColor("Épargne / reste", "#94a3b8"),
      });
    }

    const expenseNodes = expenses.map((r) => ({
      id: `out:${r.name}`,
      name: r.name,
      value: r.value,
    }));

    // Links: left -> checkpoint
    if (totalIncome > 0) {
      links.push({
        id: "l:in:Entrées->mid:Checkpoint",
        sourceId: "in:Entrées",
        targetId: "mid:Checkpoint",
        value: totalIncome,
        color: getColor("Entrées", "#10b981"),
        title: `Entrées → Checkpoint: ${formatEur(totalIncome, isAnonymous)}`,
      });
    }
    if (addLeftBalance > 0) {
      links.push({
        id: "l:in:Solde->mid:Checkpoint",
        sourceId: "in:Solde",
        targetId: "mid:Checkpoint",
        value: addLeftBalance,
        color: getColor("Solde (complément)", "#94a3b8"),
        title: `Solde → Checkpoint: ${formatEur(addLeftBalance, isAnonymous)}`,
      });
    }

    // Links: checkpoint -> categories (each link is colored by its category)
    for (const exp of expenseNodes) {
      const v = exp.value;
      if (v <= 0) continue;
      const c = getColor(exp.name, "#64748b");
      links.push({
        id: `l:mid:Checkpoint->${exp.id}`,
        sourceId: "mid:Checkpoint",
        targetId: exp.id,
        value: v,
        color: c,
        title: `Checkpoint → ${exp.name}: ${formatEur(v, isAnonymous)}`,
      });
    }
    if (addRightSavings > 0) {
      links.push({
        id: "l:mid:Checkpoint->out:Épargne",
        sourceId: "mid:Checkpoint",
        targetId: "out:Épargne",
        value: addRightSavings,
        color: getColor("Épargne / reste", "#94a3b8"),
        title: `Checkpoint → Épargne: ${formatEur(addRightSavings, isAnonymous)}`,
      });
    }

    // Filter tiny links to avoid hairlines
    const filteredLinks = links
      .filter((l) => Number.isFinite(l.value) && l.value > 0.0001)
      // stable visual: draw big flows first
      .sort((a, b) => b.value - a.value);

    return { nodes, links: filteredLinks, totalFlow };
  }, [
    incomeByCategory,
    expenseByCategory,
    colorsByCategory,
    maxIncomeCategories,
    maxExpenseCategories,
    isAnonymous,
  ]);

  const innerHeight = height;
  const w = width || 0;

  if (!w) {
    return <div ref={ref} style={{ height }} />;
  }

  if (data.nodes.length === 0 || data.links.length === 0) {
    return (
      <div
        ref={ref}
        style={{ height }}
        className="flex items-center justify-center"
      >
        <div className="text-sm text-gray-500 dark:text-gray-300">
          Pas assez de données pour afficher le spaghetti.
        </div>
      </div>
    );
  }

  const nodeW = 14;
  const padY = 10;
  const left = data.nodes.filter(
    (n) => n.side === "left" && !n.id.startsWith("mid:"),
  );
  const mid = data.nodes.filter((n) => n.id.startsWith("mid:"));
  const right = data.nodes.filter((n) => n.side === "right");

  const total = Math.max(data.totalFlow, 1);
  const maxCount = Math.max(left.length, mid.length, right.length);
  const availableH = Math.max(1, innerHeight - (maxCount - 1) * padY);
  const k = availableH / total;

  const layout = new Map<
    string,
    {
      x: number;
      y: number;
      h: number;
      outOffset: number;
      inOffset: number;
      node: SankeyNode;
    }
  >();

  const placeColumn = (nodes: SankeyNode[], col: "left" | "mid" | "right") => {
    let y = 0;
    const x =
      col === "left" ? 0 : col === "right" ? w - nodeW : w / 2 - nodeW / 2;
    for (const n of nodes) {
      const h = Math.max(1, n.value * k);
      layout.set(n.id, { x, y, h, outOffset: 0, inOffset: 0, node: n });
      y += h + padY;
    }
  };

  placeColumn(left, "left");
  placeColumn(mid, "mid");
  placeColumn(right, "right");

  const curve = Math.max(40, w * 0.22);
  const midX = w / 2;
  const clipPad = 2; // small overlap to avoid visible seams at the checkpoint

  return (
    <div
      ref={(el) => {
        // keep both refs
        (ref as any).current = el;
        containerRef.current = el;
      }}
      style={{ height }}
      className="w-full text-gray-900 dark:text-white relative"
    >
      <svg width={w} height={innerHeight} role="img">
        <defs>
          {/* Left side: show only up to the checkpoint (avoid “entrée” spilling to the right) */}
          <clipPath id="cfsp-left">
            <rect x={0} y={0} width={midX + clipPad} height={innerHeight} />
          </clipPath>
          {/* Right side: show only from the checkpoint (avoid “sorties” spilling to the left) */}
          <clipPath id="cfsp-right">
            <rect
              x={midX - clipPad}
              y={0}
              width={w - (midX - clipPad)}
              height={innerHeight}
            />
          </clipPath>
        </defs>

        <g>
          {data.links.map((l) => {
            const s = layout.get(l.sourceId);
            const t = layout.get(l.targetId);
            if (!s || !t) return null;
            const thickness = Math.max(1, l.value * k);

            const y0 = s.y + s.outOffset + thickness / 2;
            const y1 = t.y + t.inOffset + thickness / 2;

            s.outOffset += thickness;
            t.inOffset += thickness;

            const x0 = s.x + nodeW;
            const x1 = t.x;

            const d = `M ${x0} ${y0} C ${x0 + curve} ${y0}, ${x1 - curve} ${y1}, ${x1} ${y1}`;

            const isRightFlow = l.sourceId.startsWith("mid:");
            const clipPath = isRightFlow
              ? "url(#cfsp-right)"
              : "url(#cfsp-left)";
            const alpha = isRightFlow ? 0.55 : 0.25;

            const label = isRightFlow
              ? t.node.label // category (right side)
              : s.node.label; // Entrées / Solde (left side)

            return (
              <path
                key={l.id}
                d={d}
                fill="none"
                stroke={hexToRgba(l.color, alpha)}
                strokeWidth={thickness}
                strokeLinecap="round"
                clipPath={clipPath}
                onMouseMove={(e) => showTooltip(e, label, l.value)}
                onMouseLeave={hideTooltip}
              ></path>
            );
          })}
        </g>

        <g>
          {data.nodes.map((n) => {
            const p = layout.get(n.id);
            if (!p) return null;
            const hideLabel = n.id === "mid:Checkpoint";
            return (
              <g key={n.id}>
                <rect
                  x={p.x}
                  y={p.y}
                  width={nodeW}
                  height={p.h}
                  rx={4}
                  fill={n.color}
                  opacity={0.9}
                  onMouseMove={(e) => showTooltip(e, n.label, n.value)}
                  onMouseLeave={hideTooltip}
                ></rect>
                {!hideLabel && (
                  <text
                    x={n.side === "left" ? p.x + nodeW + 8 : p.x - 8}
                    y={p.y + Math.min(p.h - 2, Math.max(12, p.h / 2))}
                    textAnchor={n.side === "left" ? "start" : "end"}
                    fontSize={12}
                    fill="currentColor"
                    style={{ opacity: 0.85 }}
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {tooltip.open && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-gray-200/60 dark:border-gray-700/60 bg-white/95 dark:bg-gray-900/95 shadow-lg px-3 py-2"
          style={{
            left: Math.max(8, Math.min((width || 0) - 8, tooltip.x + 12)),
            top: Math.max(8, Math.min(innerHeight - 8, tooltip.y + 12)),
            transform: "translate(0, 0)",
            maxWidth: 260,
          }}
        >
          <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
            {tooltip.title}
          </div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatEur(tooltip.amount, isAnonymous)}
          </div>
        </div>
      )}
    </div>
  );
}
