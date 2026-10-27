// Service d'import CSV optimisé pour comptes et portefeuilles (style Picsou).
// Permet d'importer des positions/titres (PEE Natixis, Assurance-vie Gresham, PEA...)
// ou des transactions bancaires, en créant ou alimentant un compte.

import { nowIso, round2, todayIso } from "../lib/validate.js";
import { convertBoursoSymbolToYahoo } from "./marketData.js";

/**
 * Normalise un code ISIN ou symbole d'actif.
 */
export const cleanIsinOrTicker = (raw) => {
  if (!raw || typeof raw !== "string") return { isin: null, ticker: null };
  const val = raw.trim().toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9A-Z]$/.test(val)) {
    return { isin: val, ticker: convertBoursoSymbolToYahoo(val) || val };
  }
  const yahoo = convertBoursoSymbolToYahoo(val);
  return { isin: null, ticker: yahoo || val };
};

/**
 * Exécute l'import CSV sur un compte existant ou nouvellement créé.
 */
export const executeCsvImport = async ({
  userId,
  repository,
  market,
  accountId,
  newAccount,
  mode, // "HOLDINGS" | "TRANSACTIONS"
  items,
  resolveLogo,
}) => {
  if (!userId) throw new Error("userId requis");
  if (!repository) throw new Error("repository requis");
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Aucune donnée à importer");
  }

  let targetAccountId = accountId;
  let createdAccount = null;

  // 1. Si création d'un nouveau compte
  if (!targetAccountId && newAccount) {
    const name = String(newAccount.name || "").trim();
    if (!name) throw new Error("Le nom du nouveau compte est requis");
    const type = newAccount.type || "EMPLOYEE_SAVINGS";
    const currency = (newAccount.currency || "EUR").toUpperCase();
    const logo =
      newAccount.logo || (typeof resolveLogo === "function" ? resolveLogo({ name, provider: "csv" }) : null);

    createdAccount = repository.createAccount(userId, {
      name,
      type,
      currency,
      balance: 0,
      cashBalance: mode === "HOLDINGS" ? 0 : null,
      provider: "csv",
      isManual: true,
      color: newAccount.color || "#c8a55e",
      metadata: {
        logo,
        importedVia: "csv",
        importedAt: nowIso(),
      },
    });
    targetAccountId = createdAccount.id;
  }

  const account = repository.getAccount(targetAccountId, userId);
  if (!account) throw new Error("Compte cible introuvable");

  let importedCount = 0;
  let totalValue = 0;

  // 2. Import des positions d'investissement (Holdings) — Cas Natixis PEE, Gresham, PEA...
  if (mode === "HOLDINGS") {
    for (const item of items) {
      const name = String(item.name || item.label || "Titre").trim();
      const rawCode = item.isin || item.ticker || null;
      const { isin, ticker } = cleanIsinOrTicker(rawCode);
      const quantity = Math.max(0, Number(item.quantity) || 0);
      const price = Math.max(0, Number(item.price) || 0);
      const costBasis = item.costBasis != null && item.costBasis !== "" ? Number(item.costBasis) : null;
      const val = item.value != null && item.value !== "" ? Number(item.value) : quantity * price;

      if (!name && !ticker && !isin) continue;

      repository.upsertHolding(userId, targetAccountId, {
        name,
        isin,
        ticker: ticker || (isin ? null : name),
        quantity: quantity || (price > 0 && val > 0 ? round2(val / price) : 1),
        price: price || (quantity > 0 && val > 0 ? round2(val / quantity) : 0),
        costBasis,
        currency: account.currency || "EUR",
        lastPriceAt: nowIso(),
        assetClass: item.assetClass || "EQUITY",
      });

      importedCount++;
      totalValue += val || quantity * price;
    }

    // Recalcul de la valorisation globale du compte
    if (market && typeof market.recomputeInvestmentAccount === "function") {
      market.recomputeInvestmentAccount(targetAccountId, userId);
    } else {
      const holdings = repository.listHoldings(targetAccountId, userId);
      const hSum = holdings.reduce(
        (sum, h) => sum + (h.quantity || 0) * (h.price || 0),
        0,
      );
      const total = round2((account.cashBalance || 0) + hSum);
      repository.updateAccount(targetAccountId, userId, { balance: total });
    }

    const updatedAccount = repository.getAccount(targetAccountId, userId);
    repository.saveSnapshot(
      userId,
      targetAccountId,
      todayIso(),
      updatedAccount.balance,
      updatedAccount.currency,
      "csv",
    );

    return {
      success: true,
      mode: "HOLDINGS",
      accountId: targetAccountId,
      account: updatedAccount,
      importedCount,
      totalValue: round2(totalValue),
    };
  }

  // 3. Import des transactions bancaires
  if (mode === "TRANSACTIONS") {
    const txItems = items.map((item, idx) => {
      const date = String(item.date || todayIso()).trim();
      const label = String(item.label || "Opération").trim();
      const amount = Number(item.amount) || 0;
      const category = item.category ? String(item.category).trim() : null;
      return {
        externalId: item.externalId || null,
        dedupKey: item.dedupKey || `csv:${targetAccountId}:${date}:${label}:${amount}:${idx}`,
        date,
        valueDate: item.valueDate || null,
        amount,
        currency: account.currency || "EUR",
        label,
        category,
      };
    });

    importedCount = repository.insertTransactions(
      userId,
      targetAccountId,
      "csv",
      txItems,
    );

    // Si nouveau compte ou solde nul, on initialise avec la somme des transactions
    if (createdAccount && account.balance === 0) {
      const sum = txItems.reduce((acc, t) => acc + (t.amount || 0), 0);
      repository.updateAccount(targetAccountId, userId, { balance: round2(sum) });
    }

    const updatedAccount = repository.getAccount(targetAccountId, userId);
    repository.saveSnapshot(
      userId,
      targetAccountId,
      todayIso(),
      updatedAccount.balance,
      updatedAccount.currency,
      "csv",
    );

    return {
      success: true,
      mode: "TRANSACTIONS",
      accountId: targetAccountId,
      account: updatedAccount,
      importedCount,
      totalValue: updatedAccount.balance,
    };
  }

  throw new Error(`Mode d'import invalide : ${mode}`);
};
