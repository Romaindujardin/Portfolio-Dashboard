import { useState, useEffect } from "react";
import { Plus, Search, Wallet, ChevronDown } from "lucide-react";
import { Wallet as WalletType } from "../types";
import {
  getStoredWallets,
  addWallet,
  updateWallet,
  deleteWallet,
  updateWalletAssetVisibility,
  updateWalletNFTVisibility,
} from "../utils/storage";
import { updateWallet as updateSingleWallet } from "../utils/blockchainService";
import WalletForm from "../components/WalletForm";
import WalletCard from "../components/WalletCard";

import { useUser } from "../contexts/UserContext";

const Investments = () => {
  const [wallets, setWallets] = useState<WalletType[]>([]);
  const [isWalletFormOpen, setIsWalletFormOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState<WalletType | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [refreshingWallets, setRefreshingWallets] = useState<Set<string>>(
    new Set()
  );
  const [isBlockchainSectionCollapsed, setIsBlockchainSectionCollapsed] =
    useState(false);
  const [isCeXSectionCollapsed, setIsCeXSectionCollapsed] = useState(false);

  const { currentUser } = useUser();

  // Séparer les wallets Binance (CEX) des wallets blockchain
  const binanceWallets = wallets.filter(
    (wallet) => wallet.walletType === "binance"
  );
  const blockchainWallets = wallets.filter(
    (wallet) => wallet.walletType !== "binance"
  );

  // Calculer la valeur d'une liste de wallets (assets masqués exclus)
  const computeWalletsValue = (list: WalletType[]) =>
    list.reduce(
      (sum, wallet) =>
        sum +
        wallet.assets
          .filter((asset) => !asset.isHidden)
          .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
        (wallet.nfts || []).reduce(
          (nftSum, nft) => nftSum + (nft.value || 0),
          0
        ),
      0
    );

  const blockchainWalletValue = computeWalletsValue(blockchainWallets);
  const binanceWalletValue = computeWalletsValue(binanceWallets);
  const walletValue = computeWalletsValue(wallets);

  const loadingWallets = async () => {
    try {
      const stored = await getStoredWallets(currentUser);
      setWallets(stored);
    } catch (error) {
      console.error("❌ Erreur lors du chargement des wallets:", error);
      setWallets([]);
    }
  };

  useEffect(() => {
    loadingWallets();

    const handleWalletUpdate = async () => {
      await loadingWallets();
    };

    window.addEventListener("walletsUpdated", handleWalletUpdate);

    return () => {
      window.removeEventListener("walletsUpdated", handleWalletUpdate);
    };
  }, [currentUser]);

  // === GESTION DES WALLETS ===

  const handleAddWallet = async (wallet: WalletType) => {
    await addWallet(wallet, currentUser);
    await loadingWallets();
    setIsWalletFormOpen(false);
  };

  const handleUpdateWallet = async (wallet: WalletType) => {
    await updateWallet(wallet, currentUser);
    await loadingWallets();
    setEditingWallet(null);
    setIsWalletFormOpen(false);
  };

  const handleDeleteWallet = async (id: string) => {
    if (
      window.confirm("Êtes-vous sûr de vouloir supprimer ce portefeuille ?")
    ) {
      await deleteWallet(id, currentUser);
      await loadingWallets();
    }
  };

  const handleRefreshWallet = async (wallet: WalletType) => {
    setRefreshingWallets((prev) => new Set(prev).add(wallet.id));

    try {
      const updatedWallet = await updateSingleWallet(wallet);
      await updateWallet(updatedWallet, currentUser);
      await loadingWallets();
    } catch (error) {
      console.error("Erreur lors de la mise à jour du wallet:", error);
    } finally {
      setRefreshingWallets((prev) => {
        const next = new Set(prev);
        next.delete(wallet.id);
        return next;
      });
    }
  };

  const handleEditWallet = (wallet: WalletType) => {
    setEditingWallet(wallet);
    setIsWalletFormOpen(true);
  };

  const handleToggleAssetVisibility = async (
    walletId: string,
    assetIndex: number
  ) => {
    const wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) return;

    const asset = wallet.assets[assetIndex];
    if (!asset) return;

    const newIsHidden = !asset.isHidden;

    // Mettre à jour l'état local immédiatement
    const updatedWallets = wallets.map((w) => {
      if (w.id === walletId) {
        const updatedAssets = [...w.assets];
        updatedAssets[assetIndex] = {
          ...updatedAssets[assetIndex],
          isHidden: newIsHidden,
        };

        // Recalculer la valeur totale en excluant les assets cachés
        const totalValue = updatedAssets
          .filter((asset) => !asset.isHidden)
          .reduce((sum, asset) => sum + (asset.value || 0), 0);

        return {
          ...w,
          assets: updatedAssets,
          totalValue,
        };
      }
      return w;
    });

    setWallets(updatedWallets);

    // Sauvegarder les changements dans la base de données
    try {
      await updateWalletAssetVisibility(
        walletId,
        assetIndex,
        newIsHidden,
        currentUser
      );
    } catch (error) {
      console.error(
        "❌ Erreur lors de la mise à jour de la visibilité:",
        error
      );
      // Recharger les wallets en cas d'erreur
      await loadingWallets();
    }
  };

  const handleToggleNftVisibility = async (
    walletId: string,
    nftIndex: number
  ) => {
    const wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) return;

    const nft = wallet.nfts[nftIndex];
    if (!nft) return;

    const newIsHidden = !nft.isHidden;

    // Mettre à jour l'état local immédiatement
    setWallets((prev) =>
      prev.map((w) => {
        if (w.id !== walletId) return w;
        const updatedNfts = [...w.nfts];
        updatedNfts[nftIndex] = {
          ...updatedNfts[nftIndex],
          isHidden: newIsHidden,
        };
        return { ...w, nfts: updatedNfts };
      })
    );

    // Sauvegarder les changements dans la base de données
    try {
      await updateWalletNFTVisibility(walletId, nftIndex, newIsHidden);
    } catch (error) {
      console.error(
        "❌ Erreur lors de la mise à jour de la visibilité du NFT:",
        error
      );
      await loadingWallets();
    }
  };

  const matchesSearch = (wallet: WalletType) => {
    const term = searchTerm.toLowerCase();
    return (
      wallet.name.toLowerCase().includes(term) ||
      wallet.address.toLowerCase().includes(term)
    );
  };

  const filteredBlockchainWallets = blockchainWallets.filter(matchesSearch);
  const filteredBinanceWallets = binanceWallets.filter(matchesSearch);
  const totalFilteredWallets =
    filteredBlockchainWallets.length + filteredBinanceWallets.length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f5f5]">
            Portefeuille
          </h1>
          <p className="text-[#8a8a8a] text-sm mt-1">
            Valeur totale :{" "}
            <span className="font-semibold text-[#f5f5f5]">
              {walletValue.toLocaleString("fr-FR")} €
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => {
              setEditingWallet(null);
              setIsWalletFormOpen(true);
            }}
            className="btn-primary flex items-center gap-2 text-xs"
          >
            <Plus size={15} />
            <span>Ajouter un wallet</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-[#555555]"
          size={18}
        />
        <input
          type="text"
          placeholder="Rechercher un portefeuille (nom, adresse)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 pr-4 py-2.5 w-full rounded-xl bg-[#141414] border border-[rgba(255,255,255,0.06)] text-sm text-[#f5f5f5] placeholder-[#555555] focus:outline-none focus:border-[#c8a55e]/50 transition-colors"
        />
      </div>

      {/* Wallets Blockchain Section */}
      {blockchainWallets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-semibold text-[#f5f5f5]">
                Wallets Blockchain
              </h2>
              <button
                onClick={() =>
                  setIsBlockchainSectionCollapsed(!isBlockchainSectionCollapsed)
                }
                className="text-[#555555] hover:text-[#f5f5f5] transition-colors"
                title={
                  isBlockchainSectionCollapsed ? "Afficher" : "Masquer"
                }
              >
                <ChevronDown
                  className={`w-5 h-5 transform transition-transform ${
                    isBlockchainSectionCollapsed ? "-rotate-90" : "rotate-0"
                  }`}
                />
              </button>
            </div>
            <span className="text-sm text-[#555555]">
              {blockchainWallets.length} portefeuille
              {blockchainWallets.length > 1 ? "s" : ""} •{" "}
              {blockchainWalletValue.toLocaleString("fr-FR")} €
            </span>
          </div>

          {!isBlockchainSectionCollapsed && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredBlockchainWallets.map((wallet) => (
                <WalletCard
                  key={wallet.id}
                  wallet={wallet}
                  onUpdate={handleEditWallet}
                  onDelete={handleDeleteWallet}
                  onRefresh={handleRefreshWallet}
                  onToggleAssetVisibility={handleToggleAssetVisibility}
                  onToggleNftVisibility={handleToggleNftVisibility}
                  isLoading={refreshingWallets.has(wallet.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wallets Binance (CEX) Section */}
      {binanceWallets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-semibold text-[#f5f5f5]">
                Wallets Binance (CEX)
              </h2>
              <button
                onClick={() =>
                  setIsCeXSectionCollapsed(!isCeXSectionCollapsed)
                }
                className="text-[#555555] hover:text-[#f5f5f5] transition-colors"
                title={isCeXSectionCollapsed ? "Afficher" : "Masquer"}
              >
                <ChevronDown
                  className={`w-5 h-5 transform transition-transform ${
                    isCeXSectionCollapsed ? "-rotate-90" : "rotate-0"
                  }`}
                />
              </button>
            </div>
            <span className="text-sm text-[#555555]">
              {binanceWallets.length} portefeuille
              {binanceWallets.length > 1 ? "s" : ""} •{" "}
              {binanceWalletValue.toLocaleString("fr-FR")} €
            </span>
          </div>

          {!isCeXSectionCollapsed && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredBinanceWallets.map((wallet) => (
                <WalletCard
                  key={wallet.id}
                  wallet={wallet}
                  onUpdate={handleEditWallet}
                  onDelete={handleDeleteWallet}
                  onRefresh={handleRefreshWallet}
                  onToggleAssetVisibility={handleToggleAssetVisibility}
                  onToggleNftVisibility={handleToggleNftVisibility}
                  isLoading={refreshingWallets.has(wallet.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message si aucun portefeuille */}
      {wallets.length === 0 && (
        <div className="card text-center py-12">
          <div className="text-[#555555] mb-4">
            Aucun portefeuille pour le moment.
          </div>
          <button
            onClick={() => setIsWalletFormOpen(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Wallet size={15} />
            <span>Ajouter un wallet</span>
          </button>
        </div>
      )}

      {wallets.length > 0 && totalFilteredWallets === 0 && searchTerm && (
        <div className="card text-center py-12">
          <div className="text-[#555555]">
            Aucun portefeuille ne correspond à la recherche.
          </div>
        </div>
      )}

      {/* Wallet Form Modal */}
      {isWalletFormOpen && (
        <WalletForm
          wallet={editingWallet || undefined}
          onSubmit={editingWallet ? handleUpdateWallet : handleAddWallet}
          onCancel={() => {
            setIsWalletFormOpen(false);
            setEditingWallet(null);
          }}
        />
      )}
    </div>
  );
};

export default Investments;
