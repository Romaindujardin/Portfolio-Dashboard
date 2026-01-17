import { Wallet } from "lucide-react";

export interface WalletTypeConfig {
  id: string;
  name: string;
  description: string;
  icon: string; // URL de l'icône ou nom de l'icône Lucide
  color: string; // Couleur de fond pour l'icône
}

export const WALLET_TYPES: Record<string, WalletTypeConfig> = {
  neutral: {
    id: "neutral",
    name: "Wallet Générique",
    description: "Wallet standard",
    icon: "👛",
    color: "bg-gray-100 text-gray-600",
  },
  binance: {
    id: "binance",
    name: "Compte Binance",
    description: "Compte d'exchange Binance",
    icon: "🟡",
    color: "bg-yellow-100 text-yellow-600",
  },
  metamask: {
    id: "metamask",
    name: "MetaMask",
    description: "Extension de navigateur populaire",
    icon: "🦊",
    color: "bg-orange-100 text-orange-600",
  },
  phantom: {
    id: "phantom",
    name: "Phantom",
    description: "Wallet Solana principal",
    icon: "👻",
    color: "bg-purple-100 text-purple-600",
  },
  coinbase: {
    id: "coinbase",
    name: "Coinbase Wallet",
    description: "Wallet de l'exchange Coinbase",
    icon: "🪙",
    color: "bg-blue-100 text-blue-600",
  },
  trust: {
    id: "trust",
    name: "Trust Wallet",
    description: "Wallet mobile de Binance",
    icon: "🛡️",
    color: "bg-green-100 text-green-600",
  },
  exodus: {
    id: "exodus",
    name: "Exodus",
    description: "Wallet desktop multi-crypto",
    icon: "🚀",
    color: "bg-indigo-100 text-indigo-600",
  },
  ledger: {
    id: "ledger",
    name: "Ledger",
    description: "Wallet hardware sécurisé",
    icon: "🔒",
    color: "bg-gray-100 text-gray-700",
  },
  trezor: {
    id: "trezor",
    name: "Trezor",
    description: "Wallet hardware Trezor",
    icon: "🔐",
    color: "bg-blue-100 text-blue-700",
  },
};

export const getWalletTypeConfig = (type: string): WalletTypeConfig => {
  return WALLET_TYPES[type] || WALLET_TYPES.neutral;
};

export const getWalletIcon = (type: string): string => {
  const config = getWalletTypeConfig(type);
  return config.icon;
};

export const getWalletColor = (type: string): string => {
  const config = getWalletTypeConfig(type);
  return config.color;
};
