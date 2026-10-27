import { describe, it, expect, beforeEach } from "vitest";
import {
  formatMoney,
  maskDigits,
  formatPercent,
  formatEur,
} from "../src/contexts/CurrencyContext";

describe("CurrencyContext and formatters", () => {
  it("formate correctement en EUR par défaut", () => {
    const formatted = formatMoney(1234.5, {}, "EUR", false, 1.08);
    expect(formatted).toContain("1");
    expect(formatted).toContain("234,50");
    expect(formatted).toContain("€");
  });

  it("convertit automatiquement en USD selon le taux de change", () => {
    // 100 EUR * 1.10 = 110 USD
    const formatted = formatMoney(100, {}, "USD", false, 1.1);
    expect(formatted).toContain("110,00");
    expect(formatted).toContain("$");
  });

  it("masque tous les chiffres quand le mode anonyme / masqué est actif", () => {
    const maskedEur = formatMoney(1234.56, {}, "EUR", true, 1.08);
    // Vérifie qu'aucun chiffre de 0 à 9 n'est présent
    expect(/[0-9]/.test(maskedEur)).toBe(false);
    expect(maskedEur).toContain("*");
    expect(maskedEur).toContain("€");

    const maskedUsd = formatMoney(1234.56, {}, "USD", true, 1.08);
    expect(/[0-9]/.test(maskedUsd)).toBe(false);
    expect(maskedUsd).toContain("*");
    expect(maskedUsd).toContain("$");
  });

  it("prend en charge les formats compacts et signés", () => {
    const compactEur = formatMoney(150000, { compact: true }, "EUR", false, 1.0);
    expect(compactEur).toContain("k");
    expect(compactEur).toContain("€");

    const signedEur = formatMoney(50, { signed: true }, "EUR", false, 1.0);
    expect(signedEur).toContain("+");
  });

  it("gère les valeurs nulles, undefined ou NaN proprement", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(NaN)).toBe("—");
    expect(formatMoney(null, { fallback: "0,00 €" })).toBe("0,00 €");
  });

  it("formatEur est un alias rétrocompatible de formatMoney", () => {
    const res = formatEur(200, { fallback: "0,00 €" });
    expect(res).toBeTruthy();
    expect(res).toContain("€");
  });

  it("maskDigits masque les chiffres d'une chaîne arbitraire", () => {
    expect(maskDigits("Compte 12345 : 678,90 €", true)).toBe("Compte ***** : ***,** €");
    expect(maskDigits("Compte 12345 : 678,90 €", false)).toBe("Compte 12345 : 678,90 €");
  });

  it("formatPercent formate et respecte le masquage", () => {
    const pct = formatPercent(15.5);
    expect(pct).toContain("15,5 %");
  });
});
