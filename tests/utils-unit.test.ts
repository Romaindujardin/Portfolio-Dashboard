// Tests unitaires des utilitaires purs : CSV, analyse bancaire, thèmes,
// types de wallets, parsing des blockchains et base crypto (fallback EUR).
import "./shims";
import { describe, it, expect } from "vitest";
import { parseCsv, stringifyCsv } from "../src/utils/csv";
import {
  parseFrenchNumber,
  parseAnyDate,
  getTimeBucketKey,
  sumNumericColumn,
  parseBankCsvTransactions,
  aggregateByCategory,
  latestBalance,
} from "../src/utils/csvAnalytics";
import {
  WALLET_TYPES,
  getWalletTypeConfig,
  getWalletIcon,
  getWalletColor,
} from "../src/utils/walletTypes";
import {
  DEFAULT_ACCENT_COLOR,
  getAccentColorDef,
  getPersonTheme,
  getUserAccentColor,
} from "../src/utils/theme";
import { parseBlockchains } from "../src/utils/databaseService";
import {
  getCryptoById,
  getCryptoBySymbol,
  getDatabaseStats,
  getTopCryptos,
  searchCryptos,
  updateCryptoDatabase,
} from "../src/utils/cryptoDatabase";

describe("csv (parsing/écriture)", () => {
  it("gère vide, BOM, CRLF, délimiteur et guillemets échappés", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], delimiter: ";" });

    const csv =
      "\uFEFFDate;Libellé;Montant\r\n" +
      '2026-10-01;"Café; pain";-4,50\r\n' +
      '2026-10-02;"Il a dit ""bonjour""";12\r\n';
    const parsed = parseCsv(csv);
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Date", "Libellé", "Montant"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]["Libellé"]).toBe("Café; pain");
    expect(parsed.rows[1]["Libellé"]).toBe('Il a dit "bonjour"');
  });

  it("détecte le délimiteur virgule", () => {
    const parsed = parseCsv("a,b\n1,2");
    expect(parsed.delimiter).toBe(",");
    expect(parsed.rows[0].a).toBe("1");
  });

  it("gère les colonnes manquantes/surnuméraires et les en-têtes vides", () => {
    const parsed = parseCsv(" ;b\n1;2;3");
    expect(parsed.headers).toEqual(["col_1", "b", "extra_3"]);
    expect(parsed.rows[0].col_1).toBe("1");
    expect(parsed.rows[0].extra_3).toBe("3");
  });

  it("stringifyCsv échappe puis reparse à l'identique", () => {
    const text = stringifyCsv({
      headers: ["a", "b"],
      rows: [{ a: 'x"y', b: "1;2" }],
      delimiter: ";",
    });
    expect(text).toContain('"x""y"');
    expect(text).toContain('"1;2"');

    const back = parseCsv(text);
    expect(back.rows[0].a).toBe('x"y');
    expect(back.rows[0].b).toBe("1;2");
  });
});

describe("csvAnalytics (nombres, dates, agrégations)", () => {
  it("parseFrenchNumber : formats français et cas limites", () => {
    expect(parseFrenchNumber("1 234,56 €")).toBeCloseTo(1234.56, 2);
    expect(parseFrenchNumber("\u00A01\u00A0234,56")).toBeCloseTo(1234.56, 2);
    expect(parseFrenchNumber("-12,50")).toBeCloseTo(-12.5, 2);
    expect(parseFrenchNumber("")).toBeNull();
    expect(parseFrenchNumber(null)).toBeNull();
    expect(parseFrenchNumber("abc")).toBeNull();
  });

  it("parseAnyDate : ISO accepté, texte invalide rejeté", () => {
    const date = parseAnyDate("2026-10-01");
    expect(date).toBeTruthy();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(9);
    expect(parseAnyDate("pas une date")).toBeNull();
    expect(parseAnyDate(null)).toBeNull();
  });

  it("getTimeBucketKey : jour/mois/semaine/année", () => {
    const date = new Date(2026, 9, 15); // 15 octobre 2026
    expect(getTimeBucketKey(date, "day")).toBe("2026-10-15");
    expect(getTimeBucketKey(date, "month")).toBe("2026-10");
    expect(getTimeBucketKey(date, "year")).toBe("2026");
    expect(getTimeBucketKey(date, "week")).toMatch(/^2026-W\d{2}$/);
  });

  it("sumNumericColumn : somme avec multiplicateur optionnel", () => {
    const csv = "a;b\n1,5;2\n2,5;3\n";
    expect(sumNumericColumn(csv, "a")).toBeCloseTo(4, 2);
    expect(sumNumericColumn(csv, "a", "b")).toBeCloseTo(10.5, 2);
    expect(sumNumericColumn(csv)).toBeNull();
    expect(sumNumericColumn("", "a")).toBeNull();
  });

  it("parseBankCsvTransactions : lignes valides, tri, catégories", () => {
    const csv = [
      "dateOp;label;amount;aiCategory;aiSubCategory;accountBalance;reference",
      "2026-10-01;CASINO;-42,50;Alimentation;Courses;950,00;refA",
      "2026-10-02;VIR SALAIRE;2000,00;Revenus;Salaire;2950,00;refB",
      "date invalide;IGNORÉ;-10,00;X;Y;100,00;refC",
    ].join("\n");

    const txs = parseBankCsvTransactions(csv);
    expect(txs).toHaveLength(2);
    expect(txs[0].amount).toBeCloseTo(-42.5, 2);
    expect(txs[0].category).toBe("Alimentation");
    expect(txs[0].subCategory).toBe("Courses");
    expect(txs[0].accountBalance).toBeCloseTo(950, 2);
    expect(txs[1].amount).toBeCloseTo(2000, 2);
    expect(txs[1].label).toBe("VIR SALAIRE");

    expect(latestBalance(txs)).toBeCloseTo(2950, 2);

    const byCategory = aggregateByCategory(txs);
    const food = byCategory.find((c) => c.category === "Alimentation");
    expect(food).toBeTruthy();
    expect(food!.expenses).toBeCloseTo(42.5, 2);
    expect(food!.net).toBeCloseTo(-42.5, 2);
    const income = byCategory.find((c) => c.category === "Revenus");
    expect(income!.income).toBeCloseTo(2000, 2);
  });
});

describe("walletTypes", () => {
  it("configs connues + repli neutre", () => {
    expect(Object.keys(WALLET_TYPES).length).toBeGreaterThanOrEqual(8);
    expect(getWalletTypeConfig("metamask").name).toBe("MetaMask");
    expect(getWalletTypeConfig("inconnu").id).toBe("neutral");
    expect(getWalletIcon("metamask")).toBe(getWalletTypeConfig("metamask").icon);
    expect(getWalletColor("phantom")).toContain("purple");
  });
});

describe("theme (couleurs d'accent et thèmes par personne)", () => {
  it("résolution des couleurs (id, hex, repli)", () => {
    expect(DEFAULT_ACCENT_COLOR).toBe("blue");
    expect(getAccentColorDef("blue").hex).toBe("#3b82f6");
    expect(getAccentColorDef(undefined).id).toBe("blue");
    const custom = getAccentColorDef("#ff0000");
    expect(custom.id).toBe("custom");
    expect(custom.hex).toBe("#ff0000");
  });

  it("getPersonTheme expose bien hex/styles (régression .color → .hex)", () => {
    const theme = getPersonTheme("blue", "Romain");
    expect(theme.hex).toBe("#3b82f6");
    expect(theme.name).toBe("Romain");
    expect(theme.cardStyle.backgroundColor).toContain("rgba");
    expect(theme.badgeStyle.color).toBe("#3b82f6");
  });

  it("getUserAccentColor : défauts Sophie/Romain et préférence enregistrée", () => {
    expect(getUserAccentColor("TestSophie")).toBe("emerald");
    expect(getUserAccentColor("TestRomain")).toBe("blue");

    localStorage.setItem(
      "user_settings_TestPrenom",
      JSON.stringify({ accentColor: "purple" }),
    );
    expect(getUserAccentColor("TestPrenom")).toBe("purple");
  });
});

describe("parseBlockchains (régression multi-encodage)", () => {
  it("JSON simple, double encodage, tableau direct et cas limites", () => {
    expect(parseBlockchains('["ethereum","polygon"]')).toEqual([
      "ethereum",
      "polygon",
    ]);
    expect(parseBlockchains(JSON.stringify(JSON.stringify(["ethereum"])))).toEqual(
      ["ethereum"],
    );
    expect(parseBlockchains(["bitcoin"])).toEqual(["bitcoin"]);
    expect(parseBlockchains("ethereum")).toEqual([]);
    expect(parseBlockchains(null)).toEqual([]);
    expect(parseBlockchains(undefined)).toEqual([]);
  });
});

describe("cryptoDatabase (fallback EUR hors-ligne)", () => {
  it("cache initial vide avant toute mise à jour", () => {
    const stats = getDatabaseStats();
    expect(stats.totalCryptos).toBe(0);
    expect(stats.isUpdated).toBe(false);
  });

  it("charge le fallback EUR quand CoinGecko est injoignable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error("test : réseau coupé"))) as typeof fetch;
    try {
      await updateCryptoDatabase();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const stats = getDatabaseStats();
    expect(stats.isUpdated).toBe(true);
    expect(stats.totalCryptos).toBeGreaterThanOrEqual(4);
  });

  it("recherche BTC/ETH avec valeurs du fallback (en EUR)", () => {
    const btc = getCryptoBySymbol("btc");
    expect(btc).toBeTruthy();
    expect(btc!.name).toBe("Bitcoin");
    expect(btc!.current_price).toBe(90000);

    const eth = getCryptoBySymbol("ETH");
    expect(eth).toBeTruthy();
    expect(eth!.name).toBe("Ethereum");

    expect(searchCryptos("bit").some((c) => c.id === "bitcoin")).toBe(true);
    expect(getCryptoById("ethereum")).toBeTruthy();
    expect(getTopCryptos(10)).toHaveLength(5); // les 5 cryptos du fallback (rangs 1,2,4,5,7)
  });
});
