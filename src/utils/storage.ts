import {
  Investment,
  WatchlistItem,
  Wallet,
  PortfolioStats,
  BankCsvUpload,
  BankCsvUploadMeta,
} from "../types";
import { getAllStocks } from "./stockDatabase";
import { getAllCryptos } from "./cryptoDatabase";
import { migrateOldWallet } from "./walletMigration"; // Still used for old localStorage format if any
import databaseService from "./databaseService"; // NEW IMPORT

const INVESTMENTS_KEY = "portfolio_investments";
const WATCHLIST_KEY = "portfolio_watchlist";
const WALLETS_KEY = "portfolio_wallets";

// Fonction pour valider et migrer un wallet
const validateAndMigrateWallet = (wallet: any): Wallet => {
  // Si le wallet n'a pas la propriété blockchains ou si ce n'est pas un tableau
  if (!wallet.blockchains || !Array.isArray(wallet.blockchains)) {
    console.log(
      `🔄 Migration du wallet ${wallet.name}: ajout de la propriété blockchains`
    );

    // Déterminer les blockchains basées sur le walletType
    let defaultBlockchains: string[] = [];

    switch (wallet.walletType) {
      case "binance":
        defaultBlockchains = ["binance"];
        break;
      case "metamask":
      case "phantom":
      case "coinbase":
      case "trust":
      case "exodus":
      case "ledger":
      case "trezor":
        // Pour les wallets génériques, on peut scanner plusieurs blockchains
        defaultBlockchains = ["ethereum", "polygon", "bsc"];
        break;
      default:
        defaultBlockchains = ["ethereum"];
        break;
    }

    return {
      ...wallet,
      blockchains: defaultBlockchains,
      assets: wallet.assets || [],
      nfts: wallet.nfts || [], // Ajouter la propriété nfts
      totalValue: wallet.totalValue || 0,
      lastUpdated: wallet.lastUpdated || new Date().toISOString(),
      addedAt: wallet.addedAt || new Date().toISOString(),
    };
  }

  // Si le wallet a déjà la bonne structure, s'assurer qu'il a la propriété nfts
  if (!wallet.nfts) {
    return {
      ...wallet,
      nfts: [],
    } as Wallet;
  }

  // Si le wallet a déjà la bonne structure, le retourner tel quel
  return wallet as Wallet;
};

// Fonction pour valider si un symbole existe dans nos bases de données
const isValidSymbol = (symbol: string, type: string): boolean => {
  if (type === "crypto") {
    const cryptos = getAllCryptos();
    return cryptos.some(
      (crypto) => crypto.symbol.toUpperCase() === symbol.toUpperCase()
    );
  } else {
    const stocks = getAllStocks();
    return stocks.some(
      (stock) => stock.symbol.toUpperCase() === symbol.toUpperCase()
    );
  }
};

// Fonction pour nettoyer les données invalides du localStorage
export const cleanupLocalStorage = async (): Promise<void> => {
  console.log(
    "🧹 Nettoyage du localStorage - suppression des symboles invalides..."
  );

  // Nettoyer les investissements
  const investments = await getStoredInvestments();
  const validInvestments = investments.filter((inv) => {
    const isValid = isValidSymbol(inv.symbol, inv.type);
    if (!isValid) {
      console.log(
        `❌ Suppression de l'investissement invalide: ${inv.symbol} (${inv.type})`
      );
    }
    return isValid;
  });

  if (validInvestments.length !== investments.length) {
    await saveInvestments(validInvestments);
    console.log(
      `✅ ${
        investments.length - validInvestments.length
      } investissements invalides supprimés`
    );
  }

  // Nettoyer la watchlist
  const watchlist = await getStoredWatchlist();
  const validWatchlist = watchlist.filter((item) => {
    const isValid = isValidSymbol(item.symbol, item.type);
    if (!isValid) {
      console.log(
        `❌ Suppression du symbole watchlist invalide: ${item.symbol} (${item.type})`
      );
    }
    return isValid;
  });

  if (validWatchlist.length !== watchlist.length) {
    await saveWatchlist(validWatchlist);
    console.log(
      `✅ ${
        watchlist.length - validWatchlist.length
      } symboles watchlist invalides supprimés`
    );
  }

  console.log("🧹 Nettoyage terminé !");
};

export const clearAllStoredData = async (): Promise<void> => {
  await databaseService.clearAllStoredData();
  console.log("🗑️ Toutes les données de la base de données ont été supprimées");
};

export const testLocalStorage = (): boolean => {
  try {
    const isWorking = databaseService.testLocalStorage();
    console.log(
      "🔧 Test de la base de données SQLite:",
      isWorking ? "✅ Fonctionne" : "❌ Ne fonctionne pas"
    );
    if (isWorking) {
      // Note: getDatabaseStats est maintenant async, mais on garde la compatibilité
      console.log("📦 Base de données SQLite opérationnelle");
    }
    return isWorking;
  } catch (error) {
    console.error("❌ Erreur lors du test de la base de données:", error);
    return false;
  }
};

export const getStoredInvestments = async (
  userId: string = "Romain"
): Promise<Investment[]> => {
  try {
    const investments = await databaseService.getStoredInvestments(userId);
    console.log(
      "📖 Chargement des investissements:",
      investments.length,
      "trouvés pour l'utilisateur",
      userId
    );
    return investments;
  } catch (error) {
    console.error("❌ Erreur lors du chargement des investissements:", error);
    return [];
  }
};

export const saveInvestments = async (
  investments: Investment[],
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.saveInvestments(investments, userId);
    console.log(
      "💾 Sauvegarde des investissements:",
      investments.length,
      "éléments pour l'utilisateur",
      userId
    );
  } catch (error) {
    console.error(
      "❌ Erreur lors de la sauvegarde des investissements:",
      error
    );
  }
};

export const addInvestment = async (
  investment: Investment,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.addInvestment(investment, userId);
    console.log(
      "➕ Ajout d'un nouvel investissement:",
      investment.name,
      investment.symbol,
      "pour l'utilisateur",
      userId
    );
    console.log("📡 Émission de l'événement investmentsUpdated");
    window.dispatchEvent(new CustomEvent("investmentsUpdated"));
  } catch (error) {
    console.error("❌ Erreur lors de l'ajout de l'investissement:", error);
  }
};

export const updateInvestment = async (
  updatedInvestment: Investment,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.updateInvestment(updatedInvestment, userId);
    console.log(
      "✏️ Mise à jour de l'investissement:",
      updatedInvestment.name,
      updatedInvestment.symbol,
      "pour l'utilisateur",
      userId
    );
    console.log("📡 Émission de l'événement investmentsUpdated");
    window.dispatchEvent(new CustomEvent("investmentsUpdated"));
  } catch (error) {
    console.error(
      "❌ Erreur lors de la mise à jour de l'investissement:",
      error
    );
  }
};

export const deleteInvestment = async (
  id: string,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.deleteInvestment(id);
    console.log(
      "🗑️ Suppression de l'investissement:",
      id,
      "pour l'utilisateur",
      userId
    );
    console.log("📡 Émission de l'événement investmentsUpdated");
    window.dispatchEvent(new CustomEvent("investmentsUpdated"));
  } catch (error) {
    console.error(
      "❌ Erreur lors de la suppression de l'investissement:",
      error
    );
  }
};

// calculatePortfolioStats logic updated to reflect new data source and calculation
export const calculatePortfolioStats = (
  investments: Investment[],
  wallets: Wallet[]
): PortfolioStats => {
  let totalValue = 0;
  let totalGainLoss = 0;
  let totalGainLossPercent = 0;
  let topPerformer: Investment | null = null;
  let worstPerformer: Investment | null = null;

  investments.forEach((investment) => {
    if (investment.currentPrice) {
      const currentValue = investment.quantity * investment.currentPrice;
      const purchaseValue = investment.quantity * investment.purchasePrice;
      const gainLoss = currentValue - purchaseValue;
      const gainLossPercent = (gainLoss / purchaseValue) * 100;

      totalValue += currentValue;
      totalGainLoss += gainLoss;

      if (
        !topPerformer ||
        gainLossPercent >
          ((topPerformer.currentPrice! - topPerformer.purchasePrice) /
            topPerformer.purchasePrice) *
            100
      ) {
        topPerformer = investment;
      }
      if (
        !worstPerformer ||
        gainLossPercent <
          ((worstPerformer.currentPrice! - worstPerformer.purchasePrice) /
            worstPerformer.purchasePrice) *
            100
      ) {
        worstPerformer = investment;
      }
    }
  });

  if (totalValue > 0) {
    const totalPurchaseValue = investments.reduce(
      (sum, inv) => sum + inv.quantity * inv.purchasePrice,
      0
    );
    totalGainLossPercent = (totalGainLoss / totalPurchaseValue) * 100;
  }

  // Ajouter la valeur des wallets (excluant les assets masqués et incluant les NFTs)
  wallets.forEach((wallet) => {
    totalValue += wallet.assets
      .filter((asset) => !asset.isHidden)
      .reduce((sum, asset) => sum + (asset.value || 0), 0);
    // Ajouter la valeur des NFTs
    totalValue += (wallet.nfts || []).reduce(
      (sum, nft) => sum + (nft.value || 0),
      0
    );
  });

  return {
    totalValue,
    totalGainLoss,
    totalGainLossPercent,
    topPerformer,
    worstPerformer,
  };
};

// ===== GESTION DE LA WATCHLIST =====

export const getStoredWatchlist = async (
  userId: string = "Romain"
): Promise<WatchlistItem[]> => {
  try {
    const watchlist = await databaseService.getStoredWatchlist(userId);
    console.log(
      "📖 Chargement de la watchlist:",
      watchlist.length,
      "éléments pour l'utilisateur",
      userId
    );
    return watchlist;
  } catch (error) {
    console.error("Error loading watchlist:", error);
    return [];
  }
};

export const saveWatchlist = async (
  watchlist: WatchlistItem[],
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.saveWatchlist(watchlist, userId);
    console.log(
      "💾 Sauvegarde de la watchlist:",
      watchlist.length,
      "éléments pour l'utilisateur",
      userId
    );
  } catch (error) {
    console.error("Error saving watchlist:", error);
  }
};

export const addToWatchlist = async (
  item: WatchlistItem,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.addToWatchlist(item, userId);
    console.log(
      "➕ Ajout à la watchlist:",
      item.symbol,
      "pour l'utilisateur",
      userId
    );
  } catch (error) {
    console.error("❌ Erreur lors de l'ajout à la watchlist:", error);
  }
};

export const removeFromWatchlist = async (
  symbol: string,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.removeFromWatchlist(symbol, userId);
    console.log(
      "🗑️ Suppression de la watchlist:",
      symbol,
      "pour l'utilisateur",
      userId
    );
  } catch (error) {
    console.error("❌ Erreur lors de la suppression de la watchlist:", error);
  }
};

// ===== GESTION DES WALLETS =====

export const getStoredWallets = async (
  userId: string = "Romain"
): Promise<Wallet[]> => {
  try {
    const wallets = await databaseService.getStoredWallets(userId);

    // Valider et migrer chaque wallet
    const validatedWallets = wallets.map(validateAndMigrateWallet);

    console.log(
      "📖 Chargement des wallets:",
      validatedWallets.length,
      "trouvés pour l'utilisateur",
      userId
    );

    return validatedWallets;
  } catch (error) {
    console.error("❌ Erreur lors du chargement des wallets:", error);
    return [];
  }
};

export const saveWallets = async (
  wallets: Wallet[],
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.saveWallets(wallets, userId);
    console.log(
      "💾 Sauvegarde des wallets:",
      wallets.length,
      "éléments pour l'utilisateur",
      userId
    );
  } catch (error) {
    console.error("❌ Erreur lors de la sauvegarde des wallets:", error);
  }
};

export const addWallet = async (
  wallet: Wallet,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.addWallet(wallet, userId);
    console.log(
      "➕ Ajout d'un nouveau wallet:",
      wallet.name,
      wallet.address,
      "pour l'utilisateur",
      userId
    );
    window.dispatchEvent(new CustomEvent("walletsUpdated"));
  } catch (error) {
    console.error("❌ Erreur lors de l'ajout du wallet:", error);
  }
};

export const updateWallet = async (
  updatedWallet: Wallet,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.updateWallet(updatedWallet, userId);
    console.log(
      "✏️ Mise à jour du wallet:",
      updatedWallet.name,
      updatedWallet.address,
      "pour l'utilisateur",
      userId
    );
    window.dispatchEvent(new CustomEvent("walletsUpdated"));
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour du wallet:", error);
  }
};

export const updateWalletAssetVisibility = async (
  walletId: string,
  assetIndex: number,
  isHidden: boolean,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.updateWalletAssetVisibility(
      walletId,
      assetIndex,
      isHidden,
      userId
    );
    console.log(
      "👁️ Visibilité de l'asset mise à jour:",
      walletId,
      assetIndex,
      isHidden ? "masqué" : "visible",
      "pour l'utilisateur",
      userId
    );
    window.dispatchEvent(new CustomEvent("walletsUpdated"));
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour de la visibilité:", error);
  }
};

export const deleteWallet = async (
  id: string,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.deleteWallet(id);
    console.log("🗑️ Suppression du wallet:", id, "pour l'utilisateur", userId);
    window.dispatchEvent(new CustomEvent("walletsUpdated"));
  } catch (error) {
    console.error("❌ Erreur lors de la suppression du wallet:", error);
  }
};

export const updateWalletAssets = async (): Promise<void> => {
  try {
    const wallets = await getStoredWallets();
    for (const wallet of wallets) {
      // Placeholder for actual asset update logic (e.g., scanning blockchains)
      console.log(`🔄 Mise à jour des assets pour le wallet: ${wallet.name}`);
    }
    console.log("✅ Mise à jour des assets terminée");
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour des assets:", error);
  }
};

// ===== MISE À JOUR DES PRIX =====

export const updateInvestmentPrices = async (): Promise<void> => {
  try {
    const investments = await getStoredInvestments();
    const updates: Array<{ id: string; currentPrice: number }> = [];

    for (const investment of investments) {
      try {
        // Placeholder for actual price fetching logic (e.g., Yahoo Finance, CoinGecko)
        console.log(`💰 Mise à jour du prix pour: ${investment.symbol}`);
        if (investment.currentPrice) {
          updates.push({
            id: investment.id,
            currentPrice: investment.currentPrice,
          });
        }
      } catch (error) {
        console.error(
          `❌ Erreur mise à jour prix ${investment.symbol}:`,
          error
        );
      }
    }

    if (updates.length > 0) {
      await databaseService.updateInvestmentPrices(updates);
      console.log(`✅ ${updates.length} prix mis à jour`);
      window.dispatchEvent(new CustomEvent("investmentPricesUpdated"));
    }
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour des prix:", error);
  }
};

// ===== SUPPRESSION D'UTILISATEUR =====

export const deleteUserData = async (userId: string): Promise<void> => {
  try {
    // Supprimer tous les investissements de l'utilisateur
    const investments = await getStoredInvestments(userId);
    for (const investment of investments) {
      await deleteInvestment(investment.id, userId);
    }

    // Supprimer tous les wallets de l'utilisateur
    const wallets = await getStoredWallets(userId);
    for (const wallet of wallets) {
      await deleteWallet(wallet.id, userId);
    }

    // Supprimer toute la watchlist de l'utilisateur
    const watchlist = await getStoredWatchlist(userId);
    for (const item of watchlist) {
      await removeFromWatchlist(item.symbol, userId);
    }

    // Supprimer tous les CSV bancaires de l'utilisateur
    const bankCsvUploads = await getStoredBankCsvUploads(userId);
    for (const upload of bankCsvUploads) {
      await deleteBankCsvUpload(upload.id, userId);
    }

    console.log(
      `🗑️ Toutes les données de l'utilisateur ${userId} ont été supprimées`
    );
  } catch (error) {
    console.error(
      `❌ Erreur lors de la suppression des données de l'utilisateur ${userId}:`,
      error
    );
  }
};

// ===== BANQUE / IMPORT CSV =====

export const getStoredBankCsvUploads = async (
  userId: string = "Romain",
  section?: string
): Promise<BankCsvUploadMeta[]> => {
  try {
    const uploads = await databaseService.getBankCsvUploads(userId, section);
    return uploads;
  } catch (error) {
    console.error("❌ Erreur lors du chargement des CSV bancaires:", error);
    return [];
  }
};

export const getBankCsvUploadById = async (
  id: string,
  userId: string = "Romain"
): Promise<BankCsvUpload | null> => {
  try {
    return await databaseService.getBankCsvUploadById(id, userId);
  } catch (error) {
    console.error("❌ Erreur lors du chargement du CSV bancaire:", error);
    return null;
  }
};

export const createBankCsvUpload = async (
  params: {
    filename: string;
    sourceLabel?: string;
    content: string;
    sizeBytes?: number;
    section?: string;
  },
  userId: string = "Romain"
): Promise<string | null> => {
  try {
    const id = await databaseService.createBankCsvUpload({
      user_id: userId,
      section: params.section,
      source_label: params.sourceLabel || params.filename,
      filename: params.filename,
      content: params.content,
      size_bytes: params.sizeBytes,
    });
    return id;
  } catch (error) {
    console.error("❌ Erreur lors de la création du CSV bancaire:", error);
    return null;
  }
};

export const deleteBankCsvUpload = async (
  id: string,
  userId: string = "Romain"
): Promise<boolean> => {
  try {
    return await databaseService.deleteBankCsvUpload(id, userId);
  } catch (error) {
    console.error("❌ Erreur lors de la suppression du CSV bancaire:", error);
    return false;
  }
};

export const updateBankCsvUpload = async (
  id: string,
  updates: { filename?: string; content?: string; sizeBytes?: number },
  userId: string = "Romain"
): Promise<boolean> => {
  try {
    return await databaseService.updateBankCsvUpload(id, userId, {
      filename: updates.filename,
      content: updates.content,
      size_bytes: updates.sizeBytes,
    });
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour du CSV bancaire:", error);
    return false;
  }
};
