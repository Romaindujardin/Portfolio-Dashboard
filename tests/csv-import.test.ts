import { describe, it, expect } from "vitest";
import {
  detectCsvDialect,
  detectCsvMode,
  suggestColumnMapping,
  convertMappedRows,
  parseRawCsv,
  parseNumericValue,
  parseDateValue,
} from "../src/utils/csvParserOptimized";

describe("Optimized CSV Parser (Picsou method)", () => {
  it("détecte correctement un export français (point-virgule, virgule décimale, format DD/MM/YYYY)", () => {
    const csv = `Fonds;Code ISIN;Parts;Valeur liquidative;Valorisation
Impact ISR Rendement;QS0009099876;15,50;45,20 €;700,60 €
Natixis Avenir Mixte;QS0009123456;10,00;120,50 €;1 205,00 €`;

    const dialect = detectCsvDialect(csv);
    expect(dialect.delimiter).toBe(";");
    expect(dialect.decimalStyle).toBe("COMMA");
    expect(dialect.hasHeader).toBe(true);
  });

  it("nettoie fidèlement les montants avec espaces insécables et devises", () => {
    expect(parseNumericValue("1 205,50 €", "COMMA")).toBe(1205.5);
    expect(parseNumericValue("1\u00A0205,50 €", "COMMA")).toBe(1205.5);
    expect(parseNumericValue("-45,20", "COMMA")).toBe(-45.2);
    expect(parseNumericValue("(100,50)", "COMMA")).toBe(-100.5);
    expect(parseNumericValue("1,234.56 $", "DOT")).toBe(1234.56);
  });

  it("convertit les dates au format ISO", () => {
    expect(parseDateValue("15/04/2026", "DD/MM/YYYY")).toBe("2026-04-15");
    expect(parseDateValue("2026-04-15", "YYYY-MM-DD")).toBe("2026-04-15");
    expect(parseDateValue("15.04.2026", "DD.MM.YYYY")).toBe("2026-04-15");
  });

  it("identifie le mode HOLDINGS et mappe les colonnes d'un PEE Natixis", () => {
    const csv = `Nom du support;Code ISIN;Nombre de parts;Cours;Montant
Impact ISR Rendement Solidaire;QS0009099876;12,450;55,10;686,00
Natixis Actions Euro;FR0010123456;5,000;240,00;1 200,00`;

    const dialect = detectCsvDialect(csv);
    const rows = parseRawCsv(csv, dialect.delimiter);
    const headers = rows[0];
    const dataRows = rows.slice(1);

    const mode = detectCsvMode(headers);
    expect(mode).toBe("HOLDINGS");

    const mapping = suggestColumnMapping(headers, mode);
    expect(mapping.name).toBe("Nom du support");
    expect(mapping.isin).toBe("Code ISIN");
    expect(mapping.quantity).toBe("Nombre de parts");
    expect(mapping.price).toBe("Cours");
    expect(mapping.amount).toBe("Montant");

    const holdings = convertMappedRows(dataRows, headers, mapping, dialect, mode);
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({
      name: "Impact ISR Rendement Solidaire",
      isin: "QS0009099876",
      quantity: 12.45,
      price: 55.1,
      value: 686,
    });
    expect(holdings[1]).toMatchObject({
      name: "Natixis Actions Euro",
      isin: "FR0010123456",
      quantity: 5,
      price: 240,
      value: 1200,
    });
  });

  it("identifie le mode TRANSACTIONS et prend en charge débit et crédit séparés", () => {
    const csv = `Date operation;Libelle;Debit;Credit;Categorie
15/04/2026;Virement reçu;;2500,00;Salaire
16/04/2026;Carrefour;45,20;;Alimentation`;

    const dialect = detectCsvDialect(csv);
    const rows = parseRawCsv(csv, dialect.delimiter);
    const headers = rows[0];
    const dataRows = rows.slice(1);

    const mode = detectCsvMode(headers);
    expect(mode).toBe("TRANSACTIONS");

    const mapping = suggestColumnMapping(headers, mode);
    expect(mapping.date).toBe("Date operation");
    expect(mapping.label).toBe("Libelle");
    expect(mapping.debit).toBe("Debit");
    expect(mapping.credit).toBe("Credit");

    const transactions = convertMappedRows(dataRows, headers, mapping, dialect, mode);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: "2026-04-15",
      label: "Virement reçu",
      amount: 2500,
    });
    expect(transactions[1]).toMatchObject({
      date: "2026-04-16",
      label: "Carrefour",
      amount: -45.2,
    });
  });
});
