import { Wallet } from "../types";

// Fonction de migration pour les anciens wallets
export const migrateOldWallet = (walletData: any): Wallet => {
  const wallet = { ...walletData };

  // Si c'est un ancien wallet avec 'blockchain' au lieu de 'blockchains'
  if (wallet.blockchain && !wallet.blockchains) {
    const oldBlockchain = wallet.blockchain;
    return {
      id: wallet.id,
      name: wallet.name,
      address: wallet.address,
      walletType: wallet.walletType || "neutral",
      blockchains: [oldBlockchain],
      assets: (wallet.assets || []).map((asset: any) => ({
        ...asset,
        blockchain: asset.blockchain || oldBlockchain,
      })),
      totalValue: wallet.totalValue || 0,
      lastUpdated: wallet.lastUpdated,
      addedAt: wallet.addedAt,
    };
  }

  // Vérifier que tous les assets ont une blockchain
  const migratedAssets = (wallet.assets || []).map((asset: any) => ({
    ...asset,
    blockchain: asset.blockchain || "ethereum", // Fallback par défaut
  }));

  // S'assurer que blockchains existe
  const blockchains = wallet.blockchains || [];

  return {
    id: wallet.id,
    name: wallet.name,
    address: wallet.address,
    walletType: wallet.walletType || "neutral",
    blockchains,
    assets: migratedAssets,
    totalValue: wallet.totalValue || 0,
    lastUpdated: wallet.lastUpdated,
    addedAt: wallet.addedAt,
  };
};

// Fonction pour nettoyer le localStorage des anciens wallets
export const clearOldWallets = (): void => {
  localStorage.removeItem("portfolio_wallets");
  console.log("🧹 Anciens wallets supprimés du localStorage");
};
