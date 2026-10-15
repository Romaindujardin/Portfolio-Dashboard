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

export type PersonId = "person1" | "person2" | "shared";

export interface IncomeSource {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "yearly";
  personId?: PersonId;
}

export type PocketCategory =
  | "fixed_expense"
  | "savings_goal"
  | "investment"
  | "emergency"
  | "leisure";

export interface PocketSubItem {
  id: string;
  name: string;
  amount: number; // in € monthly
  personId?: "person1" | "person2" | "shared";
  currentAmount?: number; // capital initial déjà présent
  targetAmount?: number; // objectif propre au sous-compte
  expectedReturnRate?: number; // rendement annuel propre au sous-compte
}

export type PocketOwnership = "shared" | "person1" | "person2" | "dossier";
export type SplitMode = "50_50" | "proportional" | "custom";

export interface HouseholdPerson {
  id: "person1" | "person2";
  name: string;
  color?: string;
}

export interface HouseholdConfig {
  enabled: boolean;
  person1: HouseholdPerson;
  person2: HouseholdPerson;
  splitMode: SplitMode;
}

export interface SavingsPocket {
  id: string;
  name: string;
  category: PocketCategory;
  allocationType: "percent" | "fixed";
  allocationValue: number; // % or €
  currentAmount: number;
  targetAmount?: number;
  expectedReturnRate?: number; // annual %
  color: string;
  notes?: string;
  subItems?: PocketSubItem[];
  ownership?: PocketOwnership;
  splitMethod?: SplitMode; // "50_50" | "proportional" (pour les poches communes)
  pocketType?: "expense" | "placement"; // Distinction explicite dépense de vie vs placement/épargne

  // Pour le mode Dossier (Chacun de son côté / comptes individuels groupés)
  person1Amount?: number; // Montant mensuel € pour Personne 1
  person2Amount?: number; // Montant mensuel € pour Personne 2
  person1Current?: number; // Capital actuel € Personne 1
  person2Current?: number; // Capital actuel € Personne 2
  person1Target?: number; // Objectif cible € Personne 1
  person2Target?: number; // Objectif cible € Personne 2
}

export interface SavingsStrategy {
  incomes: IncomeSource[];
  pockets: SavingsPocket[];
  horizonYears: number;
  household?: HouseholdConfig;
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

// ===== SECTIONS COMPTES CSV =====
export type AccountSectionKind = "bank" | "investment";

export interface AccountSectionConfig {
  id: string;
  label: string;
  kind: AccountSectionKind;
}

export type BankCsvColumnMapping = {
  date?: string;
  amount?: string;
  balance?: string;
  category?: string;
  subCategory?: string;
  label?: string;
  supplierFound?: string;
  comment?: string;
};

export type InvestmentCsvColumnMapping = {
  name?: string;
  isin?: string;
  quantity?: string;
  amount?: string;
  buyingPrice?: string;
  lastPrice?: string;
  amountVariation?: string;
  variation?: string;
  lastMovementDate?: string;
  currentValueColumn?: string;
  currentValueMultiplierColumn?: string;
  initialValueColumn?: string;
  initialValueMultiplierColumn?: string;
  pnlColumn?: string;
};

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

export type BoursoAccountSection = string;

export interface BoursoAccountMapping {
  accountId: string;
  accountName: string;
  kind: BoursoAccountKind;
  section: BoursoAccountSection;
}

export interface BoursoSyncDuplicate {
  newRow: Record<string, string>;
  existingRow: Record<string, string>;
  reason: string;
}

export interface BoursoSyncItem {
  accountId: string;
  accountName: string;
  section: BoursoAccountSection;
  addedCount: number;
  totalCount: number;
  newRows: Array<Record<string, string>>;
  duplicateRows: BoursoSyncDuplicate[];
  filename: string;
}

export interface BoursoSyncResult {
  items: BoursoSyncItem[];
}

// Types pour le Budget Réel et Tricount
export type TricountPayer = "person1" | "person2";
export type TricountSplitMethod =
  | "50_50"
  | "proportional"
  | "100_person1"
  | "100_person2";

export type TricountOperationNature = "expense" | "placement";

export interface TricountExpense {
  id: string;
  month: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  label: string;
  amount: number; // Montant en € (positif)
  payerPersonId: TricountPayer; // Qui a payé
  pocketId: string; // ID de la poche de Stratégie associée, ou "unallocated" / "autre"
  pocketName?: string;
  subPocketId?: string; // ID de la sous-poche / sous-poste
  subPocketName?: string; // Nom de la sous-poche / sous-poste
  splitMethod: TricountSplitMethod; // Méthode de répartition (50/50, prorata, ou 100% à l'un)
  nature?: TricountOperationNature; // "expense" (dépense de vie) ou "placement" (virement d'épargne/investissement)
  source?: "manual" | "bank_import";
  bankAccount?: string;
  bankReference?: string;
  bankRowId?: string;
  notes?: string;
  createdAt: number;
}

export type TricountBeneficiary = "person1" | "person2" | "shared";

export interface TricountIncome {
  id: string;
  month: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  label: string;
  amount: number; // Montant en € (positif)
  beneficiaryPersonId: TricountBeneficiary; // Qui a perçu ce revenu (Romain, Sophie, ou Commun)
  source?: "manual" | "bank_import";
  bankAccount?: string;
  bankReference?: string;
  bankRowId?: string;
  notes?: string;
  createdAt: number;
}

export interface MonthlyTricountConfig {
  month: string; // YYYY-MM
  p1Income: number; // Salaire / revenu net réel Romain
  p2Income: number; // Salaire / revenu net réel Sophie
  notes?: string;
  isStrategyApplied?: boolean;
  appliedStrategyDate?: string;
  targetSavingsRate?: number; // Taux d'épargne cible (%)
}

export interface TricountBalanceSummary {
  totalSpent: number;
  totalP1Paid: number;
  totalP2Paid: number;
  p1ShouldPay: number;
  p2ShouldPay: number;
  debtor: "person1" | "person2" | "none";
  creditor: "person1" | "person2" | "none";
  transferAmount: number;
  sharedExpensesCount: number;
  p1PersonalSpent: number;
  p2PersonalSpent: number;
}

export interface MonthlyPocketComparison {
  pocketId: string;
  pocketName: string;
  category: PocketCategory | "other";
  pocketType?: "expense" | "placement";
  color: string;
  ownership?: PocketOwnership;
  plannedAmount: number; // Prévu dans la stratégie (€)
  realSpent: number; // Dépensé ou placé réellement (€)
  difference: number; // plannedAmount - realSpent (positif = sous le budget, négatif = dépassement)
  status: "under_budget" | "over_budget" | "exact";
  allocatedFromReal?: number; // Montant allouable calculé sur le reste disponible réel (€)
  remainingToPlace?: number; // Montant restant à placer ce mois-ci (€)
  p1Planned?: number;
  p2Planned?: number;
  p1Allocated?: number;
  p2Allocated?: number;
  p1Placed?: number;
  p2Placed?: number;
  p1Remaining?: number;
  p2Remaining?: number;
  splitRuleLabel?: string;
}

export interface MonthlyBudgetSummary {
  month: string;
  totalIncome: number;
  p1Income: number;
  p2Income: number;
  totalExpenses: number; // Dépenses réelles de vie courante
  realSavingsAmount: number; // totalIncome - totalExpenses (Capacité réelle d'épargne)
  realSavingsRate: number; // (realSavingsAmount / totalIncome) * 100
  p1SavingsAmount?: number; // Capacité réelle d'épargne de Personne 1
  p2SavingsAmount?: number; // Capacité réelle d'épargne de Personne 2
  p1LivingDue?: number;
  p2LivingDue?: number;
  totalPlacements: number; // Total déjà réellement placé / viré vers les placements
  unplacedSavings: number; // realSavingsAmount - totalPlacements (Reste non encore placé)
  p1UnplacedSavings?: number;
  p2UnplacedSavings?: number;
  targetSavingsAmount?: number;
  targetSavingsRate?: number;
  balance: TricountBalanceSummary;
  pocketComparisons: MonthlyPocketComparison[];
  expenseComparisons: MonthlyPocketComparison[]; // Poches de dépenses de vie
  placementComparisons: MonthlyPocketComparison[]; // Poches de placement / investissement
  incomesCount?: number;
  p1TotalAllocated?: number;
  p2TotalAllocated?: number;
  p1TotalPlaced?: number;
  p2TotalPlaced?: number;
  p1TotalRemaining?: number;
  p2TotalRemaining?: number;
}
