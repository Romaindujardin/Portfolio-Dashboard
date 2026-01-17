import React, { useState, useEffect } from "react";
import { Plus, Edit, Trash2, Search, RefreshCw, Wallet } from "lucide-react";
import { Investment, Wallet as WalletType } from "../types";
import {
  getStoredInvestments,
  addInvestment,
  updateInvestment,
  deleteInvestment,
  testLocalStorage,
  clearAllStoredData,
  getStoredWallets,
  addWallet,
  updateWallet,
  deleteWallet,
  updateWalletAssets,
  updateWalletAssetVisibility,
} from "../utils/storage";
import { updateWallet as updateSingleWallet } from "../utils/blockchainService";
import InvestmentForm from "../components/InvestmentForm";
import InvestmentCard from "../components/InvestmentCard";
import PriceRefreshButton from "../components/PriceRefreshButton";
import WalletForm from "../components/WalletForm";
import WalletCard from "../components/WalletCard";

import { useUser } from "../contexts/UserContext";

const Investments = () => {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [wallets, setWallets] = useState<WalletType[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isWalletFormOpen, setIsWalletFormOpen] = useState(false);
  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(
    null
  );
  const [editingWallet, setEditingWallet] = useState<WalletType | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [refreshingWallets, setRefreshingWallets] = useState<Set<string>>(
    new Set()
  );
  const [isWalletsSectionCollapsed, setIsWalletsSectionCollapsed] =
    useState(false);
  const [isInvestmentsSectionCollapsed, setIsInvestmentsSectionCollapsed] =
    useState(false);
  const [isCryptoCollapsed, setIsCryptoCollapsed] = useState(false);
  const [isPEACollapsed, setIsPEACollapsed] = useState(false);
  const [isCTOCollapsed, setIsCTOCollapsed] = useState(false);
  const [isOtherCollapsed, setIsOtherCollapsed] = useState(false);
  const [isTradfiCollapsed, setIsTradfiCollapsed] = useState(false);

  const { currentUser } = useUser();

  // Séparer les wallets Binance des autres wallets
  const binanceWallets = wallets.filter(
    (wallet) => wallet.walletType === "binance"
  );
  const blockchainWallets = wallets.filter(
    (wallet) => wallet.walletType !== "binance"
  );

  // Calculer les valeurs totales (excluant les assets masqués)
  const binanceWalletValue = binanceWallets.reduce(
    (sum, wallet) =>
      sum +
      wallet.assets
        .filter((asset) => !asset.isHidden)
        .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
      (wallet.nfts || []).reduce((nftSum, nft) => nftSum + (nft.value || 0), 0),
    0
  );
  const blockchainWalletValue = blockchainWallets.reduce(
    (sum, wallet) =>
      sum +
      wallet.assets
        .filter((asset) => !asset.isHidden)
        .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
      (wallet.nfts || []).reduce((nftSum, nft) => nftSum + (nft.value || 0), 0),
    0
  );
  const walletValue = wallets.reduce(
    (sum, wallet) =>
      sum +
      wallet.assets
        .filter((asset) => !asset.isHidden)
        .reduce((assetSum, asset) => assetSum + (asset.value || 0), 0) +
      (wallet.nfts || []).reduce((nftSum, nft) => nftSum + (nft.value || 0), 0),
    0
  );

  useEffect(() => {
    const loadData = async () => {
      await loadInvestments();
      await loadWallets();
    };
    loadData();

    // Écouter les mises à jour de prix
    const handlePriceUpdate = async () => {
      console.log(
        "🔄 Rechargement des investissements après mise à jour des prix"
      );
      await loadInvestments();
    };

    // Écouter les mises à jour des wallets
    const handleWalletUpdate = async () => {
      console.log("🔄 Rechargement des wallets après mise à jour des assets");
      await loadWallets();
    };

    // Écouter les mises à jour des investissements
    const handleInvestmentUpdate = async () => {
      console.log("🔄 Rechargement des investissements après modification");
      await loadInvestments();
    };

    window.addEventListener("investmentPricesUpdated", handlePriceUpdate);
    window.addEventListener("walletsUpdated", handleWalletUpdate);
    window.addEventListener("investmentsUpdated", handleInvestmentUpdate);

    return () => {
      window.removeEventListener("investmentPricesUpdated", handlePriceUpdate);
      window.removeEventListener("walletsUpdated", handleWalletUpdate);
      window.removeEventListener("investmentsUpdated", handleInvestmentUpdate);
    };
  }, [currentUser]);

  const loadInvestments = async () => {
    try {
      const stored = await getStoredInvestments(currentUser);
      setInvestments(stored);
    } catch (error) {
      console.error("❌ Erreur lors du chargement des investissements:", error);
      setInvestments([]);
    }
  };

  const loadWallets = async () => {
    try {
      const stored = await getStoredWallets(currentUser);
      setWallets(stored);
    } catch (error) {
      console.error("❌ Erreur lors du chargement des wallets:", error);
      setWallets([]);
    }
  };

  const handleAddInvestment = async (investment: Investment) => {
    await addInvestment(investment, currentUser);
    // Petit délai pour s'assurer que la base de données est mise à jour
    await new Promise((resolve) => setTimeout(resolve, 100));
    await loadInvestments();
    setIsFormOpen(false);
  };

  const handleUpdateInvestment = async (investment: Investment) => {
    await updateInvestment(investment, currentUser);
    // Petit délai pour s'assurer que la base de données est mise à jour
    await new Promise((resolve) => setTimeout(resolve, 100));
    await loadInvestments();
    setEditingInvestment(null);
    setIsFormOpen(false);
  };

  const handleDeleteInvestment = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this investment?")) {
      await deleteInvestment(id, currentUser);
      // Petit délai pour s'assurer que la base de données est mise à jour
      await new Promise((resolve) => setTimeout(resolve, 100));
      await loadInvestments();
    }
  };

  const handleEditInvestment = (investment: Investment) => {
    setEditingInvestment(investment);
    setIsFormOpen(true);
  };

  // === GESTION DES WALLETS ===

  const handleAddWallet = async (wallet: WalletType) => {
    await addWallet(wallet, currentUser);
    await loadWallets();
    setIsWalletFormOpen(false);
  };

  const handleUpdateWallet = async (wallet: WalletType) => {
    await updateWallet(wallet, currentUser);
    await loadWallets();
    setEditingWallet(null);
    setIsWalletFormOpen(false);
  };

  const handleDeleteWallet = async (id: string) => {
    if (
      window.confirm("Êtes-vous sûr de vouloir supprimer ce portefeuille ?")
    ) {
      await deleteWallet(id, currentUser);
      await loadWallets();
    }
  };

  const handleRefreshWallet = async (wallet: WalletType) => {
    setRefreshingWallets((prev) => new Set(prev).add(wallet.id));

    try {
      const updatedWallet = await updateSingleWallet(wallet);
      updateWallet(updatedWallet, currentUser);
      loadWallets();
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
      console.log(
        `👁️ Asset ${asset.symbol} ${newIsHidden ? "masqué" : "rendu visible"}`
      );
    } catch (error) {
      console.error(
        "❌ Erreur lors de la mise à jour de la visibilité:",
        error
      );
      // Recharger les wallets en cas d'erreur
      await loadWallets();
    }
  };

  const handleCleanupStorage = () => {
    if (
      window.confirm("Supprimer tous les symboles invalides du portefeuille ?")
    ) {
      // Désactivé pour éviter la suppression accidentelle des cryptos
      // cleanupLocalStorage();
      console.log(
        "⚠️ Fonction de nettoyage désactivée pour préserver les actifs crypto"
      );
      loadInvestments();
    }
  };

  const handleResetAllData = () => {
    if (
      window.confirm(
        "⚠️ ATTENTION: Supprimer TOUTES les données sauvegardées ? Cette action est irréversible !"
      )
    ) {
      clearAllStoredData();
      loadInvestments();
    }
  };

  const filteredInvestments = investments.filter(
    (investment) =>
      investment.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      investment.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      investment.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filtrer les wallets selon l'onglet actif
  const filteredWallets = wallets.map((wallet) => ({
    ...wallet,
    assets: wallet.assets, // Afficher tous les assets
    totalValue: wallet.assets
      .filter((asset) => !asset.isHidden)
      .reduce((sum, asset) => sum + (asset.value || 0), 0),
  }));

  const investmentValue = investments.reduce(
    (sum, inv) => sum + inv.quantity * (inv.currentPrice ?? 0),
    0
  );
  const totalValue = investmentValue + walletValue;

  const totalGainLoss = investments.reduce((sum, inv) => {
    const currentPrice = inv.currentPrice ?? 0;
    const currentValue = inv.quantity * currentPrice;
    const purchaseValue = inv.quantity * inv.purchasePrice;
    return sum + (currentValue - purchaseValue);
  }, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            My Investments
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Total Value:{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              ${totalValue.toLocaleString()}
            </span>{" "}
            | Total Gain/Loss:{" "}
            <span
              className={`font-semibold ${
                totalGainLoss >= 0
                  ? "text-success-600 dark:text-success-400"
                  : "text-danger-600 dark:text-danger-400"
              }`}
            >
              ${totalGainLoss.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex flex-col space-y-3">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleCleanupStorage}
              className="btn-secondary flex items-center space-x-2"
              title="Nettoyer les symboles invalides"
            >
              <RefreshCw size={20} />
              <span>Nettoyer</span>
            </button>

            <button
              onClick={() => {
                setEditingWallet(null);
                setIsWalletFormOpen(true);
              }}
              className="btn-primary flex items-center space-x-2 bg-purple-600 hover:bg-purple-700"
            >
              <Wallet size={20} />
              <span>Add Wallet</span>
            </button>
            <button
              onClick={() => {
                setEditingInvestment(null);
                setIsFormOpen(true);
              }}
              className="btn-primary flex items-center space-x-2"
            >
              <Plus size={20} />
              <span>Add Investment</span>
            </button>
          </div>
          <div className="flex justify-end">
            <PriceRefreshButton
              variant="primary"
              size="sm"
              showCountdown={true}
            />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={20}
        />
        <input
          type="text"
          placeholder="Search investments..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 w-full rounded-lg py-2 bg-white dark:bg-[#111111] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
        />
      </div>

      {/* Wallets Blockchain Section */}
      {blockchainWallets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Wallets Blockchain
              </h2>
              <button
                onClick={() =>
                  setIsWalletsSectionCollapsed(!isWalletsSectionCollapsed)
                }
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title={
                  isWalletsSectionCollapsed
                    ? "Afficher les portefeuilles"
                    : "Masquer les portefeuilles"
                }
              >
                <svg
                  className={`w-5 h-5 transform transition-transform ${
                    isWalletsSectionCollapsed ? "rotate-90" : "-rotate-90"
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            <span className="text-sm text-gray-500">
              {blockchainWallets.length} portefeuille
              {blockchainWallets.length > 1 ? "s" : ""} • $
              {blockchainWalletValue.toLocaleString()}
            </span>
          </div>

          {!isWalletsSectionCollapsed && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {blockchainWallets
                .filter(
                  (wallet) =>
                    wallet.name
                      .toLowerCase()
                      .includes(searchTerm.toLowerCase()) ||
                    wallet.address
                      .toLowerCase()
                      .includes(searchTerm.toLowerCase())
                )
                .map((wallet) => (
                  <WalletCard
                    key={wallet.id}
                    wallet={wallet}
                    onUpdate={handleEditWallet}
                    onDelete={handleDeleteWallet}
                    onRefresh={handleRefreshWallet}
                    onToggleAssetVisibility={handleToggleAssetVisibility}
                    isLoading={refreshingWallets.has(wallet.id)}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {/* Investments Section */}
      <div className="space-y-4">
        {(investments.length > 0 || binanceWallets.length > 0) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Investissements sur DEX/CEX
              </h2>
              <button
                onClick={() =>
                  setIsInvestmentsSectionCollapsed(
                    !isInvestmentsSectionCollapsed
                  )
                }
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title={
                  isInvestmentsSectionCollapsed
                    ? "Afficher les investissements"
                    : "Masquer les investissements"
                }
              >
                <svg
                  className={`w-5 h-5 transform transition-transform ${
                    isInvestmentsSectionCollapsed ? "rotate-90" : "-rotate-90"
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            <span className="text-sm text-gray-500">
              {investments.length + binanceWallets.length} élément
              {investments.length + binanceWallets.length > 1 ? "s" : ""} • $
              {(investmentValue + binanceWalletValue).toLocaleString()}
            </span>
          </div>
        )}

        {/* Investments Grid avec sous-sections */}
        {!isInvestmentsSectionCollapsed && (
          <>
            {/* Sous-section Crypto */}
            {(filteredInvestments.filter((inv) => inv.type === "crypto")
              .length > 0 ||
              binanceWallets.length > 0) && (
              <div className="mb-2">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-lg font-semibold text-orange-600">
                    Crypto
                  </h3>
                  <button
                    onClick={() => setIsCryptoCollapsed((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={isCryptoCollapsed ? "Afficher" : "Masquer"}
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        isCryptoCollapsed ? "rotate-90" : "-rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                {!isCryptoCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Wallets Binance */}
                    {binanceWallets
                      .filter((wallet) =>
                        wallet.name
                          .toLowerCase()
                          .includes(searchTerm.toLowerCase())
                      )
                      .map((wallet) => (
                        <WalletCard
                          key={wallet.id}
                          wallet={wallet}
                          onUpdate={handleEditWallet}
                          onDelete={handleDeleteWallet}
                          onRefresh={handleRefreshWallet}
                          onToggleAssetVisibility={handleToggleAssetVisibility}
                          isLoading={refreshingWallets.has(wallet.id)}
                        />
                      ))}
                    {/* Investissements crypto */}
                    {filteredInvestments
                      .filter((inv) => inv.type === "crypto")
                      .map((investment) => (
                        <InvestmentCard
                          key={investment.id}
                          investment={investment}
                          onEdit={() => handleEditInvestment(investment)}
                          onDelete={() => handleDeleteInvestment(investment.id)}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
            {/* Sous-section PEA */}
            {filteredInvestments.filter(
              (inv) => inv.type === "stock" && inv.accountType === "PEA"
            ).length > 0 && (
              <div className="mb-2">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-lg font-semibold text-blue-700">PEA</h3>
                  <button
                    onClick={() => setIsPEACollapsed((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={isPEACollapsed ? "Afficher" : "Masquer"}
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        isPEACollapsed ? "rotate-90" : "-rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                {!isPEACollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredInvestments
                      .filter(
                        (inv) =>
                          inv.type === "stock" && inv.accountType === "PEA"
                      )
                      .map((investment) => (
                        <InvestmentCard
                          key={investment.id}
                          investment={investment}
                          onEdit={() => handleEditInvestment(investment)}
                          onDelete={() => handleDeleteInvestment(investment.id)}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
            {/* Sous-section CTO */}
            {filteredInvestments.filter(
              (inv) => inv.type === "stock" && inv.accountType === "CTO"
            ).length > 0 && (
              <div className="mb-2">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-lg font-semibold text-green-700">CTO</h3>
                  <button
                    onClick={() => setIsCTOCollapsed((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={isCTOCollapsed ? "Afficher" : "Masquer"}
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        isCTOCollapsed ? "rotate-90" : "-rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                {!isCTOCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredInvestments
                      .filter(
                        (inv) =>
                          inv.type === "stock" && inv.accountType === "CTO"
                      )
                      .map((investment) => (
                        <InvestmentCard
                          key={investment.id}
                          investment={investment}
                          onEdit={() => handleEditInvestment(investment)}
                          onDelete={() => handleDeleteInvestment(investment.id)}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
            {/* Investissements TradFi (stock sans compte spécifique) */}
            {filteredInvestments.filter(
              (inv) =>
                inv.type === "stock" &&
                inv.accountType !== "PEA" &&
                inv.accountType !== "CTO"
            ).length > 0 && (
              <div className="mb-2">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-lg font-semibold text-purple-700">
                    TradFi
                  </h3>
                  <button
                    onClick={() => setIsTradfiCollapsed((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={isTradfiCollapsed ? "Afficher" : "Masquer"}
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        isTradfiCollapsed ? "rotate-90" : "-rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                {!isTradfiCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredInvestments
                      .filter(
                        (inv) =>
                          inv.type === "stock" &&
                          inv.accountType !== "PEA" &&
                          inv.accountType !== "CTO"
                      )
                      .map((investment) => (
                        <InvestmentCard
                          key={investment.id}
                          investment={investment}
                          onEdit={() => handleEditInvestment(investment)}
                          onDelete={() => handleDeleteInvestment(investment.id)}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
            {/* Autres types d'investissements (ETF, bond, etc.) */}
            {filteredInvestments.filter(
              (inv) => inv.type !== "crypto" && inv.type !== "stock"
            ).length > 0 && (
              <div className="mb-2">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-lg font-semibold text-gray-700">
                    Autres
                  </h3>
                  <button
                    onClick={() => setIsOtherCollapsed((v) => !v)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title={isOtherCollapsed ? "Afficher" : "Masquer"}
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${
                        isOtherCollapsed ? "rotate-90" : "-rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                {!isOtherCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredInvestments
                      .filter(
                        (inv) => inv.type !== "crypto" && inv.type !== "stock"
                      )
                      .map((investment) => (
                        <InvestmentCard
                          key={investment.id}
                          investment={investment}
                          onEdit={() => handleEditInvestment(investment)}
                          onDelete={() => handleDeleteInvestment(investment.id)}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
            {/* Message si aucune correspondance */}
            {filteredInvestments.length === 0 &&
              filteredWallets.length === 0 &&
              searchTerm && (
                <div className="card text-center py-12">
                  <div className="text-gray-500 mb-4">
                    Aucun investissement ou portefeuille trouvé.
                  </div>
                </div>
              )}
            {filteredInvestments.length === 0 &&
              filteredWallets.length === 0 &&
              !searchTerm &&
              investments.length === 0 &&
              wallets.length === 0 && (
                <div className="card text-center py-12">
                  <div className="text-gray-500 mb-4">
                    Aucun investissement ou portefeuille trouvé.
                  </div>
                  <div className="space-x-3">
                    <button
                      onClick={() => setIsFormOpen(true)}
                      className="btn-primary"
                    >
                      Add Your First Investment
                    </button>
                    <button
                      onClick={() => setIsWalletFormOpen(true)}
                      className="btn-secondary"
                    >
                      Add Wallet
                    </button>
                  </div>
                </div>
              )}
          </>
        )}
      </div>

      {/* Investment Form Modal */}
      {isFormOpen && (
        <InvestmentForm
          investment={editingInvestment}
          onSubmit={
            editingInvestment ? handleUpdateInvestment : handleAddInvestment
          }
          onCancel={() => {
            setIsFormOpen(false);
            setEditingInvestment(null);
          }}
        />
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
