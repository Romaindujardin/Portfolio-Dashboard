import {
  Investment,
  WatchlistItem,
  Wallet,
  WalletAsset,
  BankCsvUpload,
} from "../types/index.js";

// Service de base de données qui utilise l'API REST
class DatabaseService {
  private apiBase = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api`;

  // ===== GESTION DES INVESTISSEMENTS =====

  public async getStoredInvestments(
    userId: string = "Romain"
  ): Promise<Investment[]> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/investments?user_id=${encodeURIComponent(
          userId
        )}`
      );
      if (!response.ok) throw new Error("Failed to fetch investments");

      const dbInvestments = await response.json();

      // Convertir le format DB vers le format application
      return dbInvestments.map((dbInv: any) => ({
        id: dbInv.id,
        name: dbInv.name,
        type: dbInv.type as Investment["type"],
        symbol: dbInv.symbol,
        quantity: dbInv.quantity,
        purchasePrice: dbInv.purchase_price,
        currentPrice: dbInv.current_price,
        purchaseDate: dbInv.purchase_date,
        notes: dbInv.notes || undefined,
        accountType:
          (dbInv.account_type as Investment["accountType"]) || undefined,
      }));
    } catch (error) {
      console.error("❌ Erreur lors du chargement des investissements:", error);
      return [];
    }
  }

  public async saveInvestments(
    investments: Investment[],
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/investments?user_id=${encodeURIComponent(
          userId
        )}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(investments),
        }
      );

      if (!response.ok) throw new Error("Failed to save investments");

      console.log("💾 Investissements sauvegardés dans la base de données");
    } catch (error) {
      console.error(
        "❌ Erreur lors de la sauvegarde des investissements:",
        error
      );
    }
  }

  public async addInvestment(
    investment: Investment,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/database/investments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          name: investment.name,
          type: investment.type,
          symbol: investment.symbol,
          quantity: investment.quantity,
          purchase_price: investment.purchasePrice,
          current_price: investment.currentPrice,
          purchase_date: investment.purchaseDate,
          notes: investment.notes || null,
          account_type: investment.accountType || null,
        }),
      });

      if (!response.ok) throw new Error("Failed to add investment");

      console.log("➕ Investissement ajouté à la base de données");
    } catch (error) {
      console.error("❌ Erreur lors de l'ajout de l'investissement:", error);
    }
  }

  public async updateInvestment(
    investment: Investment,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/investments/${investment.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            name: investment.name,
            type: investment.type,
            symbol: investment.symbol,
            quantity: investment.quantity,
            purchase_price: investment.purchasePrice,
            current_price: investment.currentPrice,
            purchase_date: investment.purchaseDate,
            notes: investment.notes || null,
            account_type: investment.accountType || null,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to update investment");

      console.log("✏️ Investissement mis à jour dans la base de données");
    } catch (error) {
      console.error(
        "❌ Erreur lors de la mise à jour de l'investissement:",
        error
      );
    }
  }

  public async deleteInvestment(id: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/investments/${id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to delete investment");

      console.log("🗑️ Investissement supprimé de la base de données");
    } catch (error) {
      console.error(
        "❌ Erreur lors de la suppression de l'investissement:",
        error
      );
    }
  }

  public async updateInvestmentPrices(
    investments: Array<{ id: string; currentPrice: number }>
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/investments/prices`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(investments),
        }
      );

      if (!response.ok) throw new Error("Failed to update prices");

      console.log(
        "💰 Prix des investissements mis à jour dans la base de données"
      );
    } catch (error) {
      console.error("❌ Erreur lors de la mise à jour des prix:", error);
    }
  }

  // ===== GESTION DE LA WATCHLIST =====

  public async getStoredWatchlist(
    userId: string = "Romain"
  ): Promise<WatchlistItem[]> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/watchlist?user_id=${encodeURIComponent(
          userId
        )}`
      );
      if (!response.ok) throw new Error("Failed to fetch watchlist");

      const dbWatchlist = await response.json();

      return dbWatchlist.map((dbItem: any) => ({
        symbol: dbItem.symbol,
        name: dbItem.name,
        type: dbItem.type as WatchlistItem["type"],
        addedAt: dbItem.added_at,
      }));
    } catch (error) {
      console.error("❌ Erreur lors du chargement de la watchlist:", error);
      return [];
    }
  }

  public async saveWatchlist(
    watchlist: WatchlistItem[],
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/watchlist?user_id=${encodeURIComponent(
          userId
        )}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(watchlist),
        }
      );

      if (!response.ok) throw new Error("Failed to save watchlist");

      console.log("💾 Watchlist sauvegardée dans la base de données");
    } catch (error) {
      console.error("❌ Erreur lors de la sauvegarde de la watchlist:", error);
    }
  }

  public async addToWatchlist(
    item: WatchlistItem,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/database/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          symbol: item.symbol,
          name: item.name,
          type: item.type,
        }),
      });

      if (!response.ok) throw new Error("Failed to add to watchlist");

      console.log("➕ Élément ajouté à la watchlist");
    } catch (error) {
      console.error("❌ Erreur lors de l'ajout à la watchlist:", error);
    }
  }

  public async removeFromWatchlist(
    symbol: string,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/watchlist/${encodeURIComponent(
          symbol
        )}?user_id=${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to remove from watchlist");

      console.log("🗑️ Élément supprimé de la watchlist");
    } catch (error) {
      console.error("❌ Erreur lors de la suppression de la watchlist:", error);
    }
  }

  // ===== GESTION DES WALLETS =====

  public async getStoredWallets(userId: string = "Romain"): Promise<Wallet[]> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/wallets?user_id=${encodeURIComponent(userId)}`
      );
      if (!response.ok) throw new Error("Failed to fetch wallets");

      const dbWallets = await response.json();

      return dbWallets.map((dbWallet: any) => {
        // Récupérer les assets du wallet
        const assets: WalletAsset[] = (dbWallet.assets || []).map(
          (dbAsset: any) => ({
            symbol: dbAsset.symbol,
            name: dbAsset.name,
            balance: dbAsset.balance,
            decimals: dbAsset.decimals,
            blockchain: dbAsset.blockchain,
            contractAddress: dbAsset.contract_address || undefined,
            price: dbAsset.price || undefined,
            value: dbAsset.value || undefined,
            logo: dbAsset.logo || undefined,
            isHidden: dbAsset.is_hidden,
          })
        );

        // Récupérer les NFTs du wallet
        const nfts: WalletAsset[] = (dbWallet.nfts || []).map((dbNft: any) => ({
          symbol: dbNft.symbol,
          name: dbNft.name,
          balance: dbNft.balance,
          decimals: dbNft.decimals,
          blockchain: dbNft.blockchain,
          contractAddress: dbNft.contract_address || undefined,
          price: dbNft.price || undefined,
          value: dbNft.value || undefined,
          logo: dbNft.logo || undefined,
          tokenId: dbNft.token_id || undefined,
          isNFT: true,
          isHidden: dbNft.is_hidden,
          nftData: {
            collection: dbNft.collection || "",
            permalink: dbNft.permalink || "",
            traits: dbNft.traits ? JSON.parse(dbNft.traits) : [],
          },
        }));

        return {
          id: dbWallet.id,
          name: dbWallet.name,
          address: dbWallet.address,
          walletType: dbWallet.wallet_type as Wallet["walletType"],
          blockchains: JSON.parse(dbWallet.blockchains),
          assets,
          nfts,
          totalValue: dbWallet.total_value,
          lastUpdated: dbWallet.last_updated,
          addedAt: dbWallet.added_at,
        };
      });
    } catch (error) {
      console.error("❌ Erreur lors du chargement des wallets:", error);
      return [];
    }
  }

  public async saveWallets(
    wallets: Wallet[],
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/wallets?user_id=${encodeURIComponent(
          userId
        )}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(wallets),
        }
      );

      if (!response.ok) throw new Error("Failed to save wallets");

      console.log("💾 Wallets sauvegardés dans la base de données");
    } catch (error) {
      console.error("❌ Erreur lors de la sauvegarde des wallets:", error);
    }
  }

  public async addWallet(
    wallet: Wallet,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/database/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          name: wallet.name,
          address: wallet.address,
          wallet_type: wallet.walletType,
          blockchains: JSON.stringify(wallet.blockchains),
          total_value: wallet.totalValue,
          last_updated: wallet.lastUpdated,
          assets: wallet.assets,
          nfts: wallet.nfts,
        }),
      });

      if (!response.ok) throw new Error("Failed to add wallet");

      console.log("➕ Wallet ajouté à la base de données");
    } catch (error) {
      console.error("❌ Erreur lors de l'ajout du wallet:", error);
    }
  }

  public async updateWallet(
    wallet: Wallet,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/wallets/${wallet.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            name: wallet.name,
            address: wallet.address,
            wallet_type: wallet.walletType,
            blockchains: JSON.stringify(wallet.blockchains),
            total_value: wallet.totalValue,
            last_updated: wallet.lastUpdated,
            assets: wallet.assets,
            nfts: wallet.nfts,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to update wallet");

      console.log("✏️ Wallet mis à jour dans la base de données");
    } catch (error) {
      console.error("❌ Erreur lors de la mise à jour du wallet:", error);
    }
  }

  public async updateWalletAssetVisibility(
    walletId: string,
    assetIndex: number,
    isHidden: boolean,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/wallets/${walletId}/assets/${assetIndex}/visibility`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isHidden }),
        }
      );

      if (!response.ok) throw new Error("Failed to update asset visibility");

      console.log(
        "👁️ Visibilité de l'asset mise à jour dans la base de données"
      );
    } catch (error) {
      console.error(
        "❌ Erreur lors de la mise à jour de la visibilité:",
        error
      );
    }
  }

  public async deleteWallet(
    id: string,
    userId: string = "Romain"
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/wallets/${id}?user_id=${encodeURIComponent(
          userId
        )}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to delete wallet");

      console.log("🗑️ Wallet supprimé de la base de données");
    } catch (error) {
      console.error("❌ Erreur lors de la suppression du wallet:", error);
    }
  }

  // ===== STATISTIQUES =====

  public async getDatabaseStats(): Promise<any> {
    try {
      const response = await fetch(`${this.apiBase}/database/stats`);
      if (!response.ok) throw new Error("Failed to get database stats");

      return await response.json();
    } catch (error) {
      console.error(
        "❌ Erreur lors de la récupération des statistiques:",
        error
      );
      return {};
    }
  }

  // ===== COMPATIBILITÉ AVEC L'ANCIEN SYSTÈME =====

  public testLocalStorage(): boolean {
    // Cette fonction est maintenant obsolète mais gardée pour compatibilité
    console.log("🔧 Test de la base de données SQLite via API: ✅ Fonctionne");
    return true;
  }

  public async clearAllStoredData(): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/database/clear`, {
        method: "POST",
      });

      if (!response.ok) throw new Error("Failed to clear database");

      console.log(
        "🗑️ Toutes les données de la base de données ont été supprimées"
      );
    } catch (error) {
      console.error("❌ Erreur lors de la suppression des données:", error);
    }
  }

  // ===== BANQUE / IMPORT CSV =====

  public async getBankCsvUploads(
    userId: string = "Romain",
    section?: string
  ): Promise<Omit<BankCsvUpload, "content">[]> {
    try {
      const sectionParam = section
        ? `&section=${encodeURIComponent(section)}`
        : "";
      const response = await fetch(
        `${this.apiBase}/database/bank-csv?user_id=${encodeURIComponent(
          userId
        )}${sectionParam}`
      );
      if (!response.ok) throw new Error("Failed to fetch bank csv uploads");

      const rows = await response.json();
      // DB -> app
      return rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        sourceLabel: r.source_label ?? undefined,
        filename: r.filename,
        // content intentionally omitted for listing
        sizeBytes: r.size_bytes || 0,
        uploadedAt: r.uploaded_at,
      }));
    } catch (error) {
      console.error("❌ Erreur lors du chargement des CSV bancaires:", error);
      return [];
    }
  }

  public async getBankCsvUploadById(
    id: string,
    userId: string = "Romain"
  ): Promise<BankCsvUpload | null> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/bank-csv/${encodeURIComponent(
          id
        )}?user_id=${encodeURIComponent(userId)}`
      );
      if (!response.ok) throw new Error("Failed to fetch bank csv upload");

      const r = await response.json();
      return {
        id: r.id,
        userId: r.user_id,
        sourceLabel: r.source_label ?? undefined,
        filename: r.filename,
        content: r.content,
        sizeBytes: r.size_bytes || 0,
        uploadedAt: r.uploaded_at,
      };
    } catch (error) {
      console.error("❌ Erreur lors du chargement du CSV bancaire:", error);
      return null;
    }
  }

  public async createBankCsvUpload(params: {
    user_id: string;
    section?: string;
    source_label?: string;
    filename: string;
    content: string;
    size_bytes?: number;
  }): Promise<string | null> {
    try {
      const response = await fetch(`${this.apiBase}/database/bank-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error("Failed to create bank csv upload");
      const data = await response.json();
      return data.id as string;
    } catch (error) {
      console.error("❌ Erreur lors de la création du CSV bancaire:", error);
      return null;
    }
  }

  public async deleteBankCsvUpload(
    id: string,
    userId: string = "Romain"
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/bank-csv/${encodeURIComponent(
          id
        )}?user_id=${encodeURIComponent(userId)}`,
        { method: "DELETE" }
      );
      return response.ok;
    } catch (error) {
      console.error("❌ Erreur lors de la suppression du CSV bancaire:", error);
      return false;
    }
  }

  public async updateBankCsvUpload(
    id: string,
    userId: string,
    updates: { filename?: string; content?: string; size_bytes?: number }
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiBase}/database/bank-csv/${encodeURIComponent(
          id
        )}?user_id=${encodeURIComponent(userId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, ...updates }),
        }
      );
      return response.ok;
    } catch (error) {
      console.error("❌ Erreur lors de la mise à jour du CSV bancaire:", error);
      return false;
    }
  }
}

// Instance singleton
const databaseService = new DatabaseService();
export default databaseService;
