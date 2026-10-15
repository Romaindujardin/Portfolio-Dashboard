import { Wallet, BankCsvUpload, BankCsvUploadMeta } from "../types";
import databaseService from "./databaseService";

// Fonction pour valider et migrer un wallet
const validateAndMigrateWallet = (wallet: any): Wallet => {
  // Si le wallet n'a pas la propriété blockchains ou si ce n'est pas un tableau
  if (!wallet.blockchains || !Array.isArray(wallet.blockchains)) {
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
      nfts: wallet.nfts || [],
      totalValue: wallet.totalValue || 0,
      lastUpdated: wallet.lastUpdated || new Date().toISOString(),
      addedAt: wallet.addedAt || new Date().toISOString(),
    };
  }

  // S'assurer que la propriété nfts existe
  if (!wallet.nfts) {
    return {
      ...wallet,
      nfts: [],
    } as Wallet;
  }

  return wallet as Wallet;
};

// ===== GESTION DES WALLETS =====

export const getStoredWallets = async (
  userId: string = "Romain"
): Promise<Wallet[]> => {
  try {
    const wallets = await databaseService.getStoredWallets(userId);
    return wallets.map(validateAndMigrateWallet);
  } catch (error) {
    console.error("❌ Erreur lors du chargement des wallets:", error);
    return [];
  }
};

export const addWallet = async (
  wallet: Wallet,
  userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.addWallet(wallet, userId);
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
    window.dispatchEvent(new CustomEvent("walletsUpdated"));
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour de la visibilité:", error);
  }
};

export const updateWalletNFTVisibility = async (
  walletId: string,
  nftIndex: number,
  isHidden: boolean
): Promise<void> => {
  try {
    await databaseService.updateWalletNFTVisibility(
      walletId,
      nftIndex,
      isHidden
    );
    window.dispatchEvent(new CustomEvent("walletsUpdated"));
  } catch (error) {
    console.error(
      "❌ Erreur lors de la mise à jour de la visibilité du NFT:",
      error
    );
  }
};

export const deleteWallet = async (
  id: string,
  _userId: string = "Romain"
): Promise<void> => {
  try {
    await databaseService.deleteWallet(id);
    window.dispatchEvent(new CustomEvent("walletsUpdated"));
  } catch (error) {
    console.error("❌ Erreur lors de la suppression du wallet:", error);
  }
};

// ===== SUPPRESSION D'UTILISATEUR =====

export const deleteUserData = async (userId: string): Promise<void> => {
  try {
    // Supprimer tous les wallets de l'utilisateur
    const wallets = await getStoredWallets(userId);
    for (const wallet of wallets) {
      await deleteWallet(wallet.id, userId);
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
    return await databaseService.getBankCsvUploads(userId, section);
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
    return await databaseService.createBankCsvUpload({
      user_id: userId,
      section: params.section,
      source_label: params.sourceLabel || params.filename,
      filename: params.filename,
      content: params.content,
      size_bytes: params.sizeBytes,
    });
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
