export interface Investment {
  id: string;
  name: string;
  type: "crypto" | "stock" | "bond" | "etf" | "other";
  symbol: string;
  quantity: number;
  purchasePrice: number;
  currentPrice: number | null;
  purchaseDate: string;
  notes?: string;
  accountType?: "PEA" | "CTO" | "";
}

export interface MarketData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  high24h?: number;
  low24h?: number;
}

export interface NewsItem {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  urlToImage?: string;
}

export interface PortfolioStats {
  totalValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  topPerformer: Investment | null;
  worstPerformer: Investment | null;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  type: "crypto" | "stock";
  addedAt: string;
}

// Types pour les wallets blockchain
export interface WalletAsset {
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  blockchain: string;
  contractAddress?: string;
  price?: number;
  value?: number;
  logo?: string;
  isHidden?: boolean; // Nouveau champ pour masquer l'asset
  tokenId?: string; // Pour les NFTs
  isNFT?: boolean; // Indique si c'est un NFT
  nftData?: {
    collection: string;
    permalink: string;
    traits: any[];
  };
}

export interface Wallet {
  id: string;
  name: string;
  address: string;
  walletType:
    | "neutral"
    | "metamask"
    | "phantom"
    | "coinbase"
    | "trust"
    | "exodus"
    | "ledger"
    | "trezor"
    | "binance";
  blockchains: string[]; // Liste des blockchains scannées
  assets: WalletAsset[];
  nfts: WalletAsset[]; // NFTs séparés des assets
  totalValue: number;
  lastUpdated: string;
  addedAt: string;
}

export interface BlockchainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  apiUrl: string;
  apiKey?: string;
  nativeToken: {
    symbol: string;
    name: string;
    decimals: number;
  };
}

// ===== BANQUE / IMPORT CSV =====
export interface BankCsvUpload {
  id: string;
  userId: string;
  sourceLabel?: string;
  filename: string;
  content: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface BankCsvUploadMeta {
  id: string;
  userId: string;
  sourceLabel?: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
}

// ===== BOURSO / BOURSORAMA =====
export type BoursoAccountKind =
  | "Banking"
  | "Trading"
  | "Savings"
  | "Loans"
  | string;

export interface BoursoAccount {
  id: string;
  name: string;
  balance: number;
  bankName: string;
  kind: BoursoAccountKind;
}

export type BoursoAccountSection = "bank" | "pea" | "ignore";

export interface BoursoAccountMapping {
  accountId: string;
  accountName: string;
  kind: BoursoAccountKind;
  section: BoursoAccountSection;
}

export interface BoursoSyncItem {
  accountId: string;
  accountName: string;
  section: BoursoAccountSection;
  addedCount: number;
  totalCount: number;
  newRows: Array<Record<string, string>>;
  filename: string;
}

export interface BoursoSyncResult {
  items: BoursoSyncItem[];
}
