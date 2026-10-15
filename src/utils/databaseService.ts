import { Wallet, WalletAsset, BankCsvUpload } from "../types/index.js";

// Normalise un champ "blockchains" potentiellement multi-encodé (JSON dans JSON)
const parseBlockchains = (raw: unknown): string[] => {
  let value: unknown = raw;
  for (let i = 0; i < 5 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return Array.isArray(value) ? (value as string[]) : [];
};

// Service de base de données qui utilise l'API REST
class DatabaseService {
  private apiBase = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api`;

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
          blockchains: parseBlockchains(dbWallet.blockchains),
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

  public async addWallet(
    wallet: Wallet,
    userId: string = "Romain"
  ): Promise<void> {
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
  }

  public async updateWallet(
    wallet: Wallet,
    userId: string = "Romain"
  ): Promise<void> {
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
  }

  public async updateWalletAssetVisibility(
    walletId: string,
    assetIndex: number,
    isHidden: boolean,
    userId: string = "Romain"
  ): Promise<void> {
    const response = await fetch(
      `${this.apiBase}/database/wallets/${walletId}/assets/${assetIndex}/visibility`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden }),
      }
    );

    if (!response.ok) throw new Error("Failed to update asset visibility");
  }

  public async updateWalletNFTVisibility(
    walletId: string,
    nftIndex: number,
    isHidden: boolean
  ): Promise<void> {
    const response = await fetch(
      `${this.apiBase}/database/wallets/${walletId}/nfts/${nftIndex}/visibility`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden }),
      }
    );

    if (!response.ok) throw new Error("Failed to update NFT visibility");
  }

  public async deleteWallet(
    id: string,
    userId: string = "Romain"
  ): Promise<void> {
    const response = await fetch(
      `${this.apiBase}/database/wallets/${id}?user_id=${encodeURIComponent(
        userId
      )}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) throw new Error("Failed to delete wallet");
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
