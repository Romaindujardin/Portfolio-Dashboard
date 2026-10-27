import { describe, it, expect } from "vitest";
import {
  resolveHoldingProfile,
  computePortfolioEtfBreakdown,
  ETF_CATALOG,
} from "../server/services/etfService.js";

describe("etfService — Look-Through & Décomposition sectorielle", () => {
  it("résout l'ETF S&P 500 par son ticker PE500 ou son ISIN", () => {
    const profileTicker = resolveHoldingProfile({ ticker: "PE500.PA", name: "Amundi PEA S&P 500" });
    expect(profileTicker.identified).toBe(true);
    expect(profileTicker.id).toBe("SP500");
    expect(profileTicker.sectors["Technologie de l'information"]).toBeGreaterThan(25);
    expect(profileTicker.countries["États-Unis"]).toBe(100);

    const profileIsin = resolveHoldingProfile({ isin: "FR0013412285", name: "AMUNDI ETF" });
    expect(profileIsin.identified).toBe(true);
    expect(profileIsin.id).toBe("SP500");
  });

  it("résout l'ETF MSCI World par ticker CW8 ou motif de nom", () => {
    const profile = resolveHoldingProfile({ ticker: "CW8.PA", name: "Amundi MSCI World UCITS" });
    expect(profile.identified).toBe(true);
    expect(profile.id).toBe("MSCI_WORLD");
    expect(profile.sectors["Technologie de l'information"]).toBeGreaterThan(20);
    expect(profile.sectors["Santé"]).toBeGreaterThan(10);
    expect(profile.countries["États-Unis"]).toBe(71);
    expect(profile.countries["Japon"]).toBe(5.8);
  });

  it("classe les cryptomonnaies à 100% dans Crypto-actifs", () => {
    const eth = resolveHoldingProfile({ ticker: "ETH", name: "Ethereum" });
    expect(eth.identified).toBe(true);
    expect(eth.category).toBe("CRYPTO");
    expect(eth.sectors["Crypto-actifs"]).toBe(100);
    expect(eth.countries["Décentralisé / Crypto"]).toBe(100);
  });

  it("calcule la consolidation complète (Look-Through) d'un portefeuille multi-actifs", () => {
    const holdings = [
      {
        id: "h1",
        accountId: "acc1",
        ticker: "PE500.PA",
        isin: "FR0013412285",
        name: "Amundi S&P 500",
        quantity: 10,
        price: 50, // 500 €
      },
      {
        id: "h2",
        accountId: "acc1",
        ticker: "FR0000983561",
        name: "STRATEGIE SANTE",
        quantity: 5,
        price: 100, // 500 € (100% Santé)
      },
    ];

    const breakdown = computePortfolioEtfBreakdown(holdings);

    expect(breakdown.totalValue).toBe(1000);
    expect(breakdown.assetCount).toBe(2);

    // Secteurs : S&P 500 a ~11.4% de santé (57€) + Stratégie Santé a 100% de santé (500€) = ~557€ soit ~55.7%
    const santeSector = breakdown.sectors.find((s) => s.sector === "Santé");
    expect(santeSector).toBeDefined();
    expect(santeSector?.value).toBeGreaterThan(500);

    const techSector = breakdown.sectors.find((s) => s.sector === "Technologie de l'information");
    expect(techSector).toBeDefined();
    expect(techSector?.value).toBeGreaterThan(100);

    // Top holdings look-through : contient les entreprises sous-jacentes
    expect(breakdown.topHoldings.length).toBeGreaterThan(0);
    const hasAppleOrMicrosoft = breakdown.topHoldings.some(
      (h) => h.name.includes("Apple") || h.name.includes("Microsoft"),
    );
    expect(hasAppleOrMicrosoft).toBe(true);

    const hasEliLilly = breakdown.topHoldings.some((h) => h.name.includes("Eli Lilly"));
    expect(hasEliLilly).toBe(true);
  });

  it("tolère une liste vide de positions sans erreur", () => {
    const breakdown = computePortfolioEtfBreakdown([]);
    expect(breakdown.totalValue).toBe(0);
    expect(breakdown.sectors).toEqual([]);
    expect(breakdown.countries).toEqual([]);
    expect(breakdown.topHoldings).toEqual([]);
  });
});
