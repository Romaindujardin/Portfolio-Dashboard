// Types de la couche « patrimoine connecté » (phases 1 & 2).
// Volontairement séparés des types historiques : les pages existantes ne
// dépendent pas de ces structures et continuent de fonctionner à l'identique.

export type PortfolioAccountType =
  | "CHECKING"
  | "SAVINGS"
  | "PEA"
  | "SECURITIES"
  | "CRYPTO"
  | "REAL_ESTATE"
  | "LOAN"
  | "EMPLOYEE_SAVINGS"
  | "OTHER";

export interface PortfolioAccount {
  id: string;
  userId: string;
  provider: string;
  externalId: string | null;
  connectionId: string | null;
  name: string;
  type: PortfolioAccountType;
  currency: string;
  balance: number;
  cashBalance: number | null;
  availableBalance: number | null;
  iban: string | null;
  isManual: boolean;
  isArchived: boolean;
  color: string | null;
  logo?: string | null;
  metadata: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  holdings?: Holding[];
  ownerships?: Ownership[];
}

export interface Transaction {
  id: string;
  accountId: string;
  provider: string;
  externalId: string | null;
  dedupKey?: string | null;
  date: string;
  valueDate: string | null;
  amount: number;
  currency: string;
  label: string;
  counterparty: string | null;
  category: string | null;
  pending: boolean;
  isTransfer: boolean;
}

export interface Holding {
  id: string;
  accountId: string;
  isin: string | null;
  ticker: string | null;
  name: string | null;
  quantity: number;
  costBasis: number | null;
  price: number | null;
  currency: string;
  lastPriceAt: string | null;
  value?: number;
  accountName?: string | null;
  accountType?: PortfolioAccountType | null;
}

export interface Snapshot {
  id: string;
  accountId: string;
  date: string;
  balance: number;
  currency: string;
  source: string | null;
}

export interface Ownership {
  id: string;
  accountId: string;
  ownerName: string;
  sharePercent: number;
}

export type ConnectionStatus = "pending" | "active" | "expired" | "error";

export interface Connection {
  id: string;
  provider: string;
  label: string;
  status: ConnectionStatus;
  sessionId: string | null;
  validUntil: string | null;
  aspspName: string | null;
  aspspCountry: string | null;
  psuType: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  accountCount?: number;
  createdAt: string;
}

export interface IntegrationStatus {
  configured: boolean;
  missing: string[];
  applicationId: string | null;
  redirectUri: string;
  baseUrl: string;
}

export interface Institution {
  id: string;
  name: string;
  bic: string | null;
  logo: string | null;
  country: string;
  psuType: string;
  beta: boolean;
}

export type PropertyType = "HOUSE" | "APARTMENT" | "OTHER";

export interface Property {
  id: string;
  userId: string;
  accountId: string | null;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  inseeCode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeScore: number | null;
  propertyType: PropertyType;
  surfaceM2: number | null;
  landM2: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floorNumber: number | null;
  floorsTotal: number | null;
  hasElevator: boolean;
  hasGarden: boolean;
  hasTerrace: boolean;
  hasBalcony: boolean;
  garageCount: number;
  parkingCount: number;
  constructionYear: number | null;
  energyClass: string | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  agencyFees: number | null;
  notaryFees: number | null;
  worksCost: number | null;
  rentalIncome: number;
  valuationMode: "ESTIMATED" | "MANUAL";
  currentValue: number | null;
  lastValuedAt: string | null;
  createdAt: string;
}

export interface PropertyValuation {
  id: string;
  propertyId: string;
  valuedAt: string;
  estimatedValue: number;
  lowValue: number | null;
  highValue: number | null;
  pricePerSqm: number | null;
  provider: string;
  confidence: string | null;
  sampleSize: number | null;
  sourceYear: number | null;
  detail: {
    scale?: string;
    series?: string;
    baseValue?: number;
    multiplier?: number;
    addedAmount?: number;
    adjustments?: Array<{
      code: string;
      factor: number | null;
      sqm: number | null;
      amount: number | null;
    }>;
    reindexRatio?: number | null;
    reindexed?: boolean;
  };
}

export interface Loan {
  id: string;
  userId: string;
  accountId: string | null;
  propertyId: string | null;
  name: string;
  lender: string | null;
  principal: number;
  annualRate: number;
  startDate: string | null;
  endDate: string | null;
  termMonths: number | null;
  monthlyPayment: number | null;
  insuranceMonthly: number;
  fileFees: number;
  createdAt: string;
}

export interface LoanInstallment {
  number: number;
  date: string;
  capital: number;
  interest: number;
  insurance: number;
  totalPayment: number;
  remainingBalance: number;
}

export interface LoanSummary {
  principal: number;
  annualRate: number;
  months: number;
  monthlyPayment: number;
  basePayment: number;
  insuranceMonthly: number;
  totalInterest: number;
  totalInsurance: number;
  totalCost: number;
  paidInstallments: number;
  remainingInstallments: number;
  remainingBalance: number;
  totalPaid: number;
  startDate: string;
  endDate: string | null;
  nextPaymentDate: string | null;
}

export interface LoanSchedule {
  installments: LoanInstallment[];
  summary: LoanSummary;
}

export interface Quote {
  ticker: string;
  price: number;
  nativePrice?: number;
  currency: string;
  fxRate?: number;
  name?: string;
  exchange?: string;
  instrumentType?: string | null;
  marketState?: string | null;
  fetchedAt?: string;
  source?: string;
  cached?: boolean;
  error?: string;
}

export interface Security {
  isin: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  resolved?: boolean;
  cached?: boolean;
}

export interface Overview {
  userId: string;
  totals: {
    assets: number;
    debts: number;
    netWorth: number;
  };
  byType: Partial<Record<PortfolioAccountType, number>>;
  perOwner: Record<string, number>;
  accounts: PortfolioAccount[];
  properties: Property[];
  loans: Loan[];
  counts: {
    accounts: number;
    properties: number;
    loans: number;
    holdings: number;
  };
}

export interface SyncResult {
  status: string;
  message?: string;
  accountsSynced?: number;
  transactionsImported?: number;
  errors?: Array<{ account: string; error: string; code?: string }>;
  connection?: Connection;
  lastSyncAt?: string;
}
