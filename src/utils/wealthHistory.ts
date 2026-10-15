// Historique du patrimoine net : relevés périodiques pour la courbe
// « Patrimoine net » de la page Synthèse.
// Un seul relevé par jour est conservé (le dernier écrase celui du jour).

export interface WealthSnapshot {
  /** Horodatage ISO du relevé */
  t: string;
  /** Patrimoine net en euros au moment du relevé */
  v: number;
}

export type WealthPeriod = "1J" | "7J" | "1M" | "1A" | "YTD" | "ALL";

export interface WealthChartPoint {
  /** Libellé affiché sur l'axe X (date courte ou heure pour 1J) */
  dateLabel: string;
  /** Montant du patrimoine net en euros */
  balance: number;
}

/** Nombre maximum de relevés conservés (~2 ans de relevés quotidiens) */
export const MAX_WEALTH_SNAPSHOTS = 730;

const storageKey = (username: string) => `wealth_history_${username}`;

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Lit l'historique d'un utilisateur (trié du plus ancien au plus récent). */
export function getWealthHistory(username: string): WealthSnapshot[] {
  if (!username) return [];
  try {
    const raw = localStorage.getItem(storageKey(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is { t: string; v: number } =>
          p &&
          typeof p.t === "string" &&
          Number.isFinite(Number(p.v)) &&
          Number.isFinite(new Date(p.t).getTime()),
      )
      .map((p) => ({ t: p.t, v: Number(p.v) }))
      .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  } catch (error) {
    console.error("❌ Erreur de lecture de l'historique de patrimoine:", error);
    return [];
  }
}

/**
 * Enregistre le patrimoine net du jour.
 * Si un relevé existe déjà pour la journée, il est mis à jour (dernier écrase),
 * sinon un nouveau relevé est ajouté. Retourne l'historique à jour.
 */
export function recordWealthSnapshot(
  username: string,
  value: number,
  now: Date = new Date(),
): WealthSnapshot[] {
  const history = getWealthHistory(username);
  if (!username || !Number.isFinite(value) || value <= 0) return history;

  const last = history[history.length - 1];
  if (last && isSameDay(new Date(last.t), now)) {
    last.t = now.toISOString();
    last.v = value;
  } else {
    history.push({ t: now.toISOString(), v: value });
  }

  const sorted = history
    .slice()
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  const trimmed = sorted.slice(-MAX_WEALTH_SNAPSHOTS);
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(trimmed));
  } catch (error) {
    console.error("❌ Erreur d'enregistrement de l'historique de patrimoine:", error);
  }
  return trimmed;
}

/** Début de la fenêtre correspondant à la période sélectionnée. */
function periodStart(period: WealthPeriod, now: Date): Date {
  const start = new Date(now);
  switch (period) {
    case "1J":
      start.setDate(start.getDate() - 1);
      break;
    case "7J":
      start.setDate(start.getDate() - 7);
      break;
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "1A":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "YTD":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "ALL":
      break;
  }
  return start;
}

/** Filtre l'historique selon la période sélectionnée (1J, 7J, 1M, 1A, YTD, ALL). */
export function filterWealthHistory(
  history: WealthSnapshot[],
  period: WealthPeriod,
  now: Date = new Date(),
): WealthSnapshot[] {
  if (period === "ALL") return history;
  const start = periodStart(period, now);
  return history.filter((p) => new Date(p.t).getTime() >= start.getTime());
}

function formatPointLabel(date: Date, period: WealthPeriod, now: Date): string {
  if (period === "1J") {
    return date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const label = date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
  return date.getFullYear() === now.getFullYear()
    ? label
    : date.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/**
 * Construit les points à tracer pour la période sélectionnée.
 * S'il n'y a qu'un seul relevé, une ligne plate est renvoyée (du début de la
 * période jusqu'au relevé) afin que la courbe reste visible.
 */
export function buildWealthChartSeries(
  history: WealthSnapshot[],
  period: WealthPeriod,
  now: Date = new Date(),
): WealthChartPoint[] {
  const filtered = filterWealthHistory(history, period, now);
  const points: WealthChartPoint[] = filtered.map((p) => ({
    dateLabel: formatPointLabel(new Date(p.t), period, now),
    balance: p.v,
  }));

  if (points.length === 0) return [];
  if (points.length === 1) {
    const start = period === "ALL" ? new Date(filtered[0].t) : periodStart(period, now);
    return [
      { dateLabel: formatPointLabel(start, period, now), balance: points[0].balance },
      points[0],
    ];
  }
  return points;
}
