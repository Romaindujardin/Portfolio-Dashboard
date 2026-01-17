import React from "react";
import { WalletAsset } from "../types";

interface NFTCardProps {
  nft: WalletAsset;
  onToggleVisibility?: () => void;
}

const NFTCard: React.FC<NFTCardProps> = ({ nft, onToggleVisibility }) => {
  const formatValue = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatBalance = (balance: number, decimals: number) => {
    if (decimals === 0) {
      return balance.toString();
    }
    return (balance / Math.pow(10, decimals)).toFixed(4);
  };

  const getBlockchainColor = (blockchain: string) => {
    const colors: { [key: string]: string } = {
      ethereum: "bg-blue-500",
      bsc: "bg-yellow-500",
      polygon: "bg-purple-500",
      arbitrum: "bg-blue-600",
      optimism: "bg-red-500",
      avalanche: "bg-red-600",
    };
    return colors[blockchain.toLowerCase()] || "bg-gray-500";
  };

  const getBlockchainName = (blockchain: string) => {
    const names: { [key: string]: string } = {
      ethereum: "Ethereum",
      bsc: "Binance Smart Chain",
      polygon: "Polygon",
      arbitrum: "Arbitrum",
      optimism: "Optimism",
      avalanche: "Avalanche",
    };
    return names[blockchain.toLowerCase()] || blockchain;
  };

  return (
    <div className="rounded-lg shadow-sm p-3 flex items-start space-x-3">
      {/* Image du NFT - Petite taille */}
      <div className="flex-shrink-0">
        <img
          src={nft.logo || "/placeholder-nft.png"}
          alt={nft.name}
          className="w-16 h-16 object-contain rounded-md bg-gray-100 dark:bg-gray-700"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = "/placeholder-nft.png";
          }}
        />
      </div>

      {/* Informations du NFT - À droite */}
      <div className="flex-1 min-w-0">
        {/* Nom et collection */}
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {nft.name}
          </h3>
          {nft.nftData && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {nft.nftData.collection}
            </p>
          )}
        </div>

        {/* Blockchain et valeur */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${getBlockchainColor(
                nft.blockchain
              )}`}
            ></span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {getBlockchainName(nft.blockchain)}
            </span>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {formatValue(nft.value || 0)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatBalance(nft.balance, nft.decimals)} NFT
            </p>
          </div>
        </div>

        {/* Actions minimales */}
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100 dark:border-gray-600">
          {nft.nftData?.permalink && (
            <a
              href={nft.nftData.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              OpenSea
            </a>
          )}
          {onToggleVisibility && (
            <button
              onClick={onToggleVisibility}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {nft.isHidden ? "Afficher" : "Masquer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NFTCard;
