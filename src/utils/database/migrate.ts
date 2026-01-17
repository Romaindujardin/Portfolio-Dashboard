import DatabaseManager from "./database.js";
import {
  Investment,
  WatchlistItem,
  Wallet,
  WalletAsset,
} from "../../types/index.js";

// Script de migration depuis localStorage vers SQLite
export async function migrateFromLocalStorage(): Promise<void> {
  console.log("🔄 Début de la migration depuis localStorage vers SQLite...");

  const dbManager = DatabaseManager.getInstance();

  try {
    // Initialiser les tables
    dbManager.initializeTables();

    // Migration des investissements
    await migrateInvestments(dbManager);

    // Migration de la watchlist
    await migrateWatchlist(dbManager);

    // Migration des wallets
    await migrateWallets(dbManager);

    console.log("✅ Migration terminée avec succès !");

    // Afficher les statistiques
    const stats = dbManager.getDatabaseStats();
    console.log("📊 Statistiques de la base de données:", stats);
  } catch (error) {
    console.error("❌ Erreur lors de la migration:", error);
    throw error;
  }
}

async function migrateInvestments(dbManager: DatabaseManager): Promise<void> {
  console.log("📊 Migration des investissements...");

  try {
    // Récupérer les investissements depuis localStorage
    const stored = localStorage.getItem("portfolio_investments");
    if (!stored) {
      console.log("ℹ️ Aucun investissement trouvé dans localStorage");
      return;
    }

    const investments: Investment[] = JSON.parse(stored);
    console.log(`📈 ${investments.length} investissements trouvés`);

    let migratedCount = 0;
    for (const investment of investments) {
      try {
        // Convertir le format localStorage vers le format DB
        const dbInvestment = {
          name: investment.name,
          type: investment.type,
          symbol: investment.symbol,
          quantity: investment.quantity,
          purchase_price: investment.purchasePrice,
          current_price: investment.currentPrice,
          purchase_date: investment.purchaseDate,
          notes: investment.notes || null,
          account_type: investment.accountType || null,
        };

        dbManager.createInvestment(dbInvestment);
        migratedCount++;
      } catch (error) {
        console.error(
          `❌ Erreur migration investissement ${investment.symbol}:`,
          error
        );
      }
    }

    console.log(`✅ ${migratedCount} investissements migrés`);
  } catch (error) {
    console.error("❌ Erreur migration investissements:", error);
  }
}

async function migrateWatchlist(dbManager: DatabaseManager): Promise<void> {
  console.log("📋 Migration de la watchlist...");

  try {
    // Récupérer la watchlist depuis localStorage
    const stored = localStorage.getItem("portfolio_watchlist");
    if (!stored) {
      console.log("ℹ️ Aucun élément watchlist trouvé dans localStorage");
      return;
    }

    const watchlistItems: WatchlistItem[] = JSON.parse(stored);
    console.log(`👀 ${watchlistItems.length} éléments watchlist trouvés`);

    let migratedCount = 0;
    for (const item of watchlistItems) {
      try {
        // Convertir le format localStorage vers le format DB
        const dbWatchlistItem = {
          symbol: item.symbol,
          name: item.name,
          type: item.type,
        };

        dbManager.createWatchlistItem(dbWatchlistItem);
        migratedCount++;
      } catch (error) {
        console.error(`❌ Erreur migration watchlist ${item.symbol}:`, error);
      }
    }

    console.log(`✅ ${migratedCount} éléments watchlist migrés`);
  } catch (error) {
    console.error("❌ Erreur migration watchlist:", error);
  }
}

async function migrateWallets(dbManager: DatabaseManager): Promise<void> {
  console.log("💼 Migration des wallets...");

  try {
    // Récupérer les wallets depuis localStorage
    const stored = localStorage.getItem("portfolio_wallets");
    if (!stored) {
      console.log("ℹ️ Aucun wallet trouvé dans localStorage");
      return;
    }

    const wallets: Wallet[] = JSON.parse(stored);
    console.log(`👛 ${wallets.length} wallets trouvés`);

    let migratedCount = 0;
    for (const wallet of wallets) {
      try {
        // Convertir le format localStorage vers le format DB
        const dbWallet = {
          name: wallet.name,
          address: wallet.address,
          wallet_type: wallet.walletType,
          blockchains: JSON.stringify(wallet.blockchains), // Stocker comme JSON string
          total_value: wallet.totalValue,
          last_updated: wallet.lastUpdated,
        };

        const walletId = dbManager.createWallet(dbWallet);

        // Migrer les assets du wallet
        await migrateWalletAssets(dbManager, walletId, wallet.assets);

        migratedCount++;
      } catch (error) {
        console.error(`❌ Erreur migration wallet ${wallet.name}:`, error);
      }
    }

    console.log(`✅ ${migratedCount} wallets migrés`);
  } catch (error) {
    console.error("❌ Erreur migration wallets:", error);
  }
}

async function migrateWalletAssets(
  dbManager: DatabaseManager,
  walletId: string,
  assets: WalletAsset[]
): Promise<void> {
  console.log(`🪙 Migration des assets pour le wallet ${walletId}...`);

  let migratedCount = 0;
  for (const asset of assets) {
    try {
      // Convertir le format localStorage vers le format DB
      const dbWalletAsset = {
        wallet_id: walletId,
        symbol: asset.symbol,
        name: asset.name,
        balance: asset.balance,
        decimals: asset.decimals,
        blockchain: asset.blockchain,
        contract_address: asset.contractAddress || null,
        price: asset.price || null,
        value: asset.value || null,
        logo: asset.logo || null,
        is_hidden: asset.isHidden || false,
      };

      dbManager.createWalletAsset(dbWalletAsset);
      migratedCount++;
    } catch (error) {
      console.error(`❌ Erreur migration asset ${asset.symbol}:`, error);
    }
  }

  console.log(`✅ ${migratedCount} assets migrés pour le wallet ${walletId}`);
}

// Fonction pour nettoyer localStorage après migration réussie
export function cleanupLocalStorage(): void {
  console.log("🧹 Nettoyage du localStorage...");

  try {
    localStorage.removeItem("portfolio_investments");
    localStorage.removeItem("portfolio_watchlist");
    localStorage.removeItem("portfolio_wallets");

    console.log("✅ localStorage nettoyé");
  } catch (error) {
    console.error("❌ Erreur nettoyage localStorage:", error);
  }
}

// Fonction pour vérifier si la migration est nécessaire
export function needsMigration(): boolean {
  const hasInvestments = localStorage.getItem("portfolio_investments") !== null;
  const hasWatchlist = localStorage.getItem("portfolio_watchlist") !== null;
  const hasWallets = localStorage.getItem("portfolio_wallets") !== null;

  return hasInvestments || hasWatchlist || hasWallets;
}

// Fonction pour afficher les données localStorage
export function showLocalStorageData(): void {
  console.log("📊 Données localStorage actuelles:");

  const investments = localStorage.getItem("portfolio_investments");
  const watchlist = localStorage.getItem("portfolio_watchlist");
  const wallets = localStorage.getItem("portfolio_wallets");

  if (investments) {
    const parsed = JSON.parse(investments);
    console.log(`📈 Investissements: ${parsed.length} éléments`);
  }

  if (watchlist) {
    const parsed = JSON.parse(watchlist);
    console.log(`👀 Watchlist: ${parsed.length} éléments`);
  }

  if (wallets) {
    const parsed = JSON.parse(wallets);
    console.log(`👛 Wallets: ${parsed.length} éléments`);
  }

  if (!investments && !watchlist && !wallets) {
    console.log("ℹ️ Aucune donnée localStorage trouvée");
  }
}
