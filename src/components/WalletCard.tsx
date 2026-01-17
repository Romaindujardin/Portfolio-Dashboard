import React, { useState } from "react";
import {
  Wallet,
  ExternalLink,
  Copy,
  RefreshCw,
  Edit,
  Trash2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  EyeOff,
  Eye,
} from "lucide-react";
import { Wallet as WalletType } from "../types";
import {
  getExplorerUrl,
  getSupportedBlockchains,
} from "../utils/blockchainService";
import { getWalletTypeConfig } from "../utils/walletTypes";
import NFTCard from "./NFTCard";

interface WalletCardProps {
  wallet: WalletType;
  onUpdate: (wallet: WalletType) => void;
  onDelete: (id: string) => void;
  onRefresh: (wallet: WalletType) => void;
  onToggleAssetVisibility: (walletId: string, assetIndex: number) => void;
  isLoading?: boolean;
}

const WalletCard: React.FC<WalletCardProps> = ({
  wallet,
  onUpdate,
  onDelete,
  onRefresh,
  onToggleAssetVisibility,
  isLoading = false,
}) => {
  const [showAssets, setShowAssets] = useState(false);
  const [showHiddenAssets, setShowHiddenAssets] = useState(false);
  const [showNFTs, setShowNFTs] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Erreur lors de la copie:", err);
    }
  };

  const handleExplorerLink = () => {
    // Utiliser la première blockchain pour l'explorer link (généralement Ethereum)
    const primaryBlockchain = wallet.blockchains[0] || "ethereum";
    const url = getExplorerUrl(wallet.address, primaryBlockchain);
    if (url) {
      window.open(url, "_blank");
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatValue = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  const getBlockchainColor = (blockchain: string) => {
    const colors = {
      ethereum: "bg-blue-100 text-blue-800",
      bsc: "bg-yellow-100 text-yellow-800",
      polygon: "bg-purple-100 text-purple-800",
      arbitrum: "bg-blue-100 text-blue-800",
      optimism: "bg-red-100 text-red-800",
      avalanche: "bg-red-100 text-red-800",
    };
    return (
      colors[blockchain as keyof typeof colors] || "bg-gray-100 text-gray-800"
    );
  };

  return (
    <div className="card hover:shadow-lg transition-shadow duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start space-x-3">
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              getWalletTypeConfig(wallet.walletType || "neutral").color
            }`}
          >
            <span className="text-xl">
              {getWalletTypeConfig(wallet.walletType || "neutral").icon}
            </span>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {wallet.name}
            </h3>
            <div className="flex items-center space-x-2 mb-2">
              <div className="flex flex-wrap gap-1">
                {Array.isArray(wallet.blockchains) &&
                  wallet.blockchains.map((blockchain) => (
                    <span
                      key={blockchain}
                      className={`px-2 py-1 rounded-full text-xs font-medium ${getBlockchainColor(
                        blockchain
                      )}`}
                    >
                      {blockchain.toUpperCase()}
                    </span>
                  ))}
                {(!Array.isArray(wallet.blockchains) ||
                  wallet.blockchains.length === 0) && (
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                    MIGRATION REQUISE
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(wallet.lastUpdated).toLocaleDateString()}
              </span>
            </div>
            {/* Ne pas afficher l'adresse pour les wallets Binance */}
            {wallet.walletType !== "binance" && (
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600 font-mono">
                  {formatAddress(wallet.address)}
                </span>
                <button
                  onClick={handleCopyAddress}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                  title="Copier l'adresse"
                >
                  <Copy
                    size={14}
                    className={copySuccess ? "text-green-500" : "text-gray-400"}
                  />
                </button>
                <button
                  onClick={handleExplorerLink}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                  title="Voir sur l'explorateur"
                >
                  <ExternalLink size={14} className="text-gray-400" />
                </button>
              </div>
            )}

            {/* Message informatif pour les wallets Binance */}
            {wallet.walletType === "binance" && (
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500">
                  Compte connecté via API Binance
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onRefresh(wallet)}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Actualiser"
          >
            <RefreshCw
              size={16}
              className={`text-gray-400 ${isLoading ? "animate-spin" : ""}`}
            />
          </button>
          <button
            onClick={() => onUpdate(wallet)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Modifier"
          >
            <Edit size={16} className="text-gray-400" />
          </button>
          <button
            onClick={() => onDelete(wallet.id)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Supprimer"
          >
            <Trash2 size={16} className="text-red-400" />
          </button>
        </div>
      </div>

      {/* Total Value */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-primary-600 dark:text-white font-medium">
              Valeur totale
            </p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatValue(
                wallet.assets
                  .filter((asset) => !asset.isHidden)
                  .reduce((sum, asset) => sum + (asset.value || 0), 0) +
                  (wallet.nfts || []).reduce(
                    (sum, nft) => sum + (nft.value || 0),
                    0
                  )
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Assets Toggle */}
      <button
        onClick={() => setShowAssets(!showAssets)}
        className="w-full flex items-center justify-between p-3 rounded-lg transition-colors"
      >
        <span className="font-medium text-gray-700 dark:text-gray-200">
          Assets ({wallet.assets.filter((asset) => !asset.isHidden).length})
        </span>
        {showAssets ? (
          <ChevronUp size={20} className="text-gray-400" />
        ) : (
          <ChevronDown size={20} className="text-gray-400" />
        )}
      </button>

      {/* Assets List */}
      {showAssets && (
        <div className="mt-2 space-y-2">
          {wallet.assets
            .filter((asset) => !asset.isHidden)
            .map((asset, index) => {
              const originalIndex = wallet.assets.findIndex(
                (a) =>
                  a.symbol === asset.symbol &&
                  a.blockchain === asset.blockchain &&
                  a.contractAddress === asset.contractAddress
              );
              return (
                <div
                  key={`visible-${wallet.id}-${index}`}
                  className="flex items-center justify-between p-3 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-white dark:bg-gray-900 rounded-full flex items-center justify-center border border-gray-200 dark:border-gray-700">
                      <span className="text-xs font-bold text-gray-600 dark:text-gray-200">
                        {asset.symbol.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {asset.symbol}
                        </p>
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${getBlockchainColor(
                            asset.blockchain
                          )}`}
                        >
                          {asset.blockchain.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {asset.name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {formatValue(asset.value || 0)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {asset.balance} {asset.symbol}
                    </p>
                    <button
                      onClick={() =>
                        onToggleAssetVisibility(wallet.id, originalIndex)
                      }
                      className="ml-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                      title="Masquer l'asset"
                    >
                      <EyeOff size={16} className="text-gray-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          {/* Hidden Assets Toggle */}
          {wallet.assets.filter((asset) => asset.isHidden).length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setShowHiddenAssets((v) => !v)}
                className="flex items-center text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 mb-2"
              >
                <EyeOff size={16} className="mr-1" />
                {showHiddenAssets
                  ? "Masquer les assets masqués"
                  : `Afficher les assets masqués (${
                      wallet.assets.filter((a) => a.isHidden).length
                    })`}
                {showHiddenAssets ? (
                  <ChevronUp size={16} className="ml-1" />
                ) : (
                  <ChevronDown size={16} className="ml-1" />
                )}
              </button>
              {showHiddenAssets && (
                <div className="space-y-2">
                  {wallet.assets
                    .filter((asset) => asset.isHidden)
                    .map((asset, index) => {
                      const originalIndex = wallet.assets.findIndex(
                        (a) =>
                          a.symbol === asset.symbol &&
                          a.blockchain === asset.blockchain &&
                          a.contractAddress === asset.contractAddress
                      );
                      return (
                        <div
                          key={`hidden-${wallet.id}-${index}`}
                          className="flex items-center justify-between p-3 border border-red-200 rounded-lg dark:border-red-700"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-white dark:bg-gray-900 rounded-full flex items-center justify-center border border-gray-200 dark:border-gray-700">
                              <span className="text-xs font-bold text-gray-600 dark:text-gray-200">
                                {asset.symbol.slice(0, 2).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <p className="font-medium text-red-600 dark:text-red-300">
                                  {asset.symbol}
                                </p>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs font-medium ${getBlockchainColor(
                                    asset.blockchain
                                  )}`}
                                >
                                  {asset.blockchain.toUpperCase()}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                  MASQUÉ
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {asset.name}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-medium text-red-600 dark:text-red-300">
                              {formatValue(asset.value || 0)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {asset.balance} {asset.symbol}
                            </p>
                            <button
                              onClick={() =>
                                onToggleAssetVisibility(
                                  wallet.id,
                                  originalIndex
                                )
                              }
                              className="ml-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                              title="Rendre l'asset visible"
                            >
                              <Eye size={16} className="text-gray-400" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* No Assets */}
      {showAssets && wallet.assets.length === 0 && (
        <div className="mt-4 text-center py-6 text-gray-500">
          <Wallet size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun asset trouvé</p>
        </div>
      )}

      {/* NFTs Toggle */}
      {wallet.nfts && wallet.nfts.length > 0 && (
        <button
          onClick={() => setShowNFTs(!showNFTs)}
          className="w-full flex items-center justify-between p-3 rounded-lg transition-colors"
        >
          <span className="font-medium text-gray-700 dark:text-gray-200">
            NFTs ({wallet.nfts.length})
          </span>
          {showNFTs ? (
            <ChevronUp size={20} className="text-gray-400" />
          ) : (
            <ChevronDown size={20} className="text-gray-400" />
          )}
        </button>
      )}

      {/* NFTs List */}
      {showNFTs && wallet.nfts && wallet.nfts.length > 0 && (
        <div className="mt-2 space-y-2">
          {wallet.nfts.map((nft, index) => (
            <NFTCard
              key={`nft-${wallet.id}-${index}`}
              nft={nft}
              onToggleVisibility={() =>
                onToggleAssetVisibility(wallet.id, index)
              }
            />
          ))}
        </div>
      )}

      {/* Copy Success Message */}
      {copySuccess && (
        <div className="absolute top-2 right-2 bg-green-500 text-white px-3 py-1 rounded text-xs">
          Adresse copiée!
        </div>
      )}
    </div>
  );
};

export default WalletCard;
