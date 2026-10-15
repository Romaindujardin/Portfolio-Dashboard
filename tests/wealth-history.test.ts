// Tests de l'historique du patrimoine net (courbe « Patrimoine net » de la Synthèse) :
// relevés quotidiens, filtrage par période et construction de la série du graphique.
import "./shims";
import { describe, it, expect } from "vitest";
import { appStorage } from "./shims";
import {
  MAX_WEALTH_SNAPSHOTS,
  buildWealthChartSeries,
  filterWealthHistory,
  getWealthHistory,
  recordWealthSnapshot,
  type WealthSnapshot,
} from "../src/utils/wealthHistory";

const USER = "TestWealthUser";
const key = `wealth_history_${USER}`;

describe("wealthHistory (relevés du patrimoine net)", () => {
  it("enregistre un premier relevé et le relit", () => {
    const now = new Date("2026-10-15T10:00:00");
    const history = recordWealthSnapshot(USER, 75000, now);
    expect(history).toHaveLength(1);
    expect(history[0].v).toBe(75000);
    expect(getWealthHistory(USER)).toEqual(history);
  });

  it("remplace le relevé du jour (un seul relevé par jour)", () => {
    recordWealthSnapshot(USER, 75000, new Date("2026-10-15T09:00:00"));
    const history = recordWealthSnapshot(
      USER,
      76200,
      new Date("2026-10-15T18:00:00"),
    );
    expect(history).toHaveLength(1);
    expect(history[0].v).toBe(76200);
    expect(new Date(history[0].t).getTime()).toBe(
      new Date("2026-10-15T18:00:00").getTime(),
    );
  });

  it("ajoute un relevé par nouveau jour, trié du plus ancien au plus récent", () => {
    recordWealthSnapshot(USER, 77000, new Date("2026-10-15T10:00:00"));
    recordWealthSnapshot(USER, 75000, new Date("2026-10-13T10:00:00"));
    const history = recordWealthSnapshot(
      USER,
      76000,
      new Date("2026-10-14T10:00:00"),
    );
    expect(history.map((p) => p.v)).toEqual([75000, 76000, 77000]);
  });

  it("ignore les valeurs invalides (0, négatif, NaN) sans écraser l'existant", () => {
    recordWealthSnapshot(USER, 75000, new Date("2026-10-12T10:00:00"));
    expect(recordWealthSnapshot(USER, 0)).toHaveLength(1);
    expect(recordWealthSnapshot(USER, -5)).toHaveLength(1);
    expect(recordWealthSnapshot(USER, NaN)).toHaveLength(1);
    expect(getWealthHistory(USER)).toHaveLength(1);
  });

  it("tolère un contenu corrompu ou partiel dans le localStorage", () => {
    appStorage.setItem(key, "pas du json");
    expect(getWealthHistory(USER)).toEqual([]);

    appStorage.setItem(
      key,
      JSON.stringify([
        { t: "date-invalide", v: 100 },
        { t: "2026-10-15T10:00:00", v: "75000" },
        null,
        { v: 42000 },
      ]),
    );
    expect(getWealthHistory(USER)).toEqual([
      { t: "2026-10-15T10:00:00", v: 75000 },
    ]);

    expect(getWealthHistory("")).toEqual([]);
  });

  it("évince les relevés les plus anciens au-delà de la limite", () => {
    const seeded: WealthSnapshot[] = Array.from(
      { length: MAX_WEALTH_SNAPSHOTS },
      (_, i) => ({
        t: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(),
        v: 1000 + i,
      }),
    );
    appStorage.setItem(key, JSON.stringify(seeded));

    const after = recordWealthSnapshot(
      USER,
      99999,
      new Date(Date.UTC(2026, 0, 1)),
    );
    expect(after).toHaveLength(MAX_WEALTH_SNAPSHOTS);
    expect(after[0].v).toBe(1001); // le plus ancien (1000) a été évincé
    expect(after[after.length - 1].v).toBe(99999);
  });

  it("filtre l'historique selon la période sélectionnée", () => {
    const now = new Date(2026, 9, 15, 12, 0, 0); // 15 oct. 2026 12:00 (local)
    const daysAgo = (n: number) =>
      new Date(now.getTime() - n * 86400000).toISOString();
    const history: WealthSnapshot[] = [
      { t: new Date(2025, 8, 20, 10, 0, 0).toISOString(), v: 60000 },
      { t: new Date(2026, 0, 5, 10, 0, 0).toISOString(), v: 65000 },
      { t: daysAgo(40), v: 66000 },
      { t: daysAgo(3), v: 70000 },
      { t: now.toISOString(), v: 75000 },
    ];

    expect(filterWealthHistory(history, "ALL", now)).toHaveLength(5);
    expect(filterWealthHistory(history, "1A", now).map((p) => p.v)).toEqual([
      65000, 66000, 70000, 75000,
    ]);
    expect(filterWealthHistory(history, "YTD", now).map((p) => p.v)).toEqual([
      65000, 66000, 70000, 75000,
    ]);
    expect(filterWealthHistory(history, "1M", now).map((p) => p.v)).toEqual([
      70000, 75000,
    ]);
    expect(filterWealthHistory(history, "7J", now).map((p) => p.v)).toEqual([
      70000, 75000,
    ]);
    expect(filterWealthHistory(history, "1J", now).map((p) => p.v)).toEqual([
      75000,
    ]);
  });

  it("construit la série du graphique (libellés dates et heures)", () => {
    const now = new Date(2026, 9, 15, 12, 0, 0);
    const history: WealthSnapshot[] = [
      { t: new Date(now.getTime() - 3 * 86400000).toISOString(), v: 70000 },
      { t: now.toISOString(), v: 75000 },
    ];

    const series = buildWealthChartSeries(history, "ALL", now);
    expect(series.map((p) => p.balance)).toEqual([70000, 75000]);
    expect(series[1].dateLabel).toMatch(/15/);

    const intraday = buildWealthChartSeries(history, "1J", now);
    // Un seul relevé dans la fenêtre 1J → ligne plate de deux points.
    expect(intraday).toHaveLength(2);
    expect(intraday.every((p) => p.balance === 75000)).toBe(true);
  });

  it("affiche une ligne plate quand un seul relevé existe", () => {
    const now = new Date(2026, 9, 15, 12, 0, 0);
    const history: WealthSnapshot[] = [{ t: now.toISOString(), v: 75000 }];

    const series = buildWealthChartSeries(history, "1M", now);
    expect(series).toHaveLength(2);
    expect(series[0].balance).toBe(75000);
    expect(series[1].balance).toBe(75000);
    expect(series[0].dateLabel).not.toBe(series[1].dateLabel);

    expect(buildWealthChartSeries([], "1M", now)).toEqual([]);
  });

  it("formate les libellés en heures sur la période 1J", () => {
    const now = new Date(2026, 9, 15, 12, 0, 0);
    const history: WealthSnapshot[] = [
      { t: new Date(now.getTime() - 3 * 3600000).toISOString(), v: 70000 },
      { t: now.toISOString(), v: 75000 },
    ];
    const series = buildWealthChartSeries(history, "1J", now);
    expect(series).toHaveLength(2);
    for (const point of series) {
      expect(point.dateLabel).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
