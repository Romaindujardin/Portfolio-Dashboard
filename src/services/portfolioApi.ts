// Client HTTP de la couche patrimoine connecté.
// Toutes les routes sont additives : /api/portfolio/*.

import type {
  Connection,
  Holding,
  Institution,
  IntegrationStatus,
  Loan,
  LoanSchedule,
  Overview,
  Ownership,
  PortfolioAccount,
  PortfolioAccountType,
  Property,
  PropertyValuation,
  Quote,
  Security,
  Snapshot,
  SyncResult,
  Transaction,
} from "../types/portfolio";
import { API_BASE } from "../utils/apiBase";

const PORTFOLIO_API_BASE = `${API_BASE}/portfolio`;

export class PortfolioApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "PortfolioApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const request = async <T>(
  path: string,
  options: RequestInit & { query?: Record<string, unknown> } = {},
): Promise<T> => {
  const { query, ...init } = options;
  const runtimeOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost";
  const url = new URL(`${PORTFOLIO_API_BASE}${path}`, runtimeOrigin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw new PortfolioApiError(
      "Impossible de joindre le serveur. Vérifiez que le backend est démarré et que l'URL de l'API est correcte.",
      0,
      "NETWORK_ERROR",
      error,
    );
  }
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new PortfolioApiError(
      payload?.error || `Erreur serveur (HTTP ${response.status})`,
      response.status,
      payload?.code,
      payload?.details,
    );
  }
  return payload as T;
};

const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

// ─── Vue d'ensemble ─────────────────────────────────────────────────────────

export const getOverview = (userId: string) =>
  request<Overview>("/overview", { query: { user_id: userId } });

export const getHealth = (userId: string) =>
  request<{
    ok: boolean;
    enableBanking: IntegrationStatus;
    counts: Overview["counts"];
  }>("/health", { query: { user_id: userId } });

// ─── Comptes ────────────────────────────────────────────────────────────────

export const getAccounts = (userId: string, includeArchived = false) =>
  request<{ accounts: PortfolioAccount[] }>("/accounts", {
    query: { user_id: userId, include_archived: includeArchived ? 1 : undefined },
  }).then((data) => data.accounts);

export const createAccount = (
  userId: string,
  payload: {
    name: string;
    type: PortfolioAccountType;
    balance: number;
    cash_balance?: number | null;
    currency?: string;
    color?: string;
    metadata?: Record<string, unknown>;
  },
) =>
  request<{ account: PortfolioAccount }>("/accounts", {
    ...json({ user_id: userId, ...payload }),
  }).then((data) => data.account);

export const updateAccount = (
  accountId: string,
  userId: string,
  payload: Partial<{
    name: string;
    type: PortfolioAccountType;
    balance: number;
    cash_balance: number | null;
    currency: string;
    color: string | null;
    is_archived: boolean;
    metadata: Record<string, unknown>;
  }>,
) =>
  request<{ account: PortfolioAccount }>(`/accounts/${accountId}`, {
    method: "PATCH",
    body: JSON.stringify({ user_id: userId, ...payload }),
  }).then((data) => data.account);

export const deleteAccount = (accountId: string, userId: string) =>
  request<{ deleted: boolean }>(`/accounts/${accountId}`, {
    method: "DELETE",
    query: { user_id: userId },
  });

export const getTransactions = (
  accountId: string,
  userId: string,
  options: { from?: string; to?: string; limit?: number } = {},
) =>
  request<{ transactions: Transaction[] }>(`/accounts/${accountId}/transactions`, {
    query: { user_id: userId, ...options },
  }).then((data) => data.transactions);

export const createTransaction = (
  accountId: string,
  userId: string,
  payload: {
    date: string;
    amount: number;
    label: string;
    category?: string;
    counterparty?: string;
    notes?: string;
  },
) =>
  request<{ transaction: Transaction }>(
    `/accounts/${accountId}/transactions`,
    json({ user_id: userId, ...payload }),
  ).then((data) => data.transaction);

export const getSnapshots = (
  accountId: string,
  userId: string,
  options: { from?: string; to?: string } = {},
) =>
  request<{ snapshots: Snapshot[] }>(`/accounts/${accountId}/snapshots`, {
    query: { user_id: userId, ...options },
  }).then((data) => data.snapshots);

// ─── Holdings ───────────────────────────────────────────────────────────────

export const getHoldings = (accountId: string, userId: string) =>
  request<{ holdings: Holding[] }>(`/accounts/${accountId}/holdings`, {
    query: { user_id: userId },
  }).then((data) => data.holdings);

export const createHolding = (
  accountId: string,
  userId: string,
  payload: {
    isin?: string;
    ticker?: string;
    name?: string;
    quantity: number;
    cost_basis?: number;
    price?: number;
    currency?: string;
    cash_balance?: number;
  },
) =>
  request<{ holding: Holding; account: PortfolioAccount }>(
    `/accounts/${accountId}/holdings`,
    json({ user_id: userId, ...payload }),
  );

export const deleteHolding = (accountId: string, holdingId: string, userId: string) =>
  request<{ deleted: boolean }>(`/accounts/${accountId}/holdings/${holdingId}`, {
    method: "DELETE",
    query: { user_id: userId },
  });

export const getAllHoldings = (userId: string) =>
  request<{ holdings: Holding[] }>("/market/holdings", {
    query: { user_id: userId },
  }).then((data) => data.holdings);

// ─── Parts ──────────────────────────────────────────────────────────────────

export const getOwnership = (accountId: string, userId: string) =>
  request<{ ownerships: Ownership[] }>(`/accounts/${accountId}/ownership`, {
    query: { user_id: userId },
  }).then((data) => data.ownerships);

export const setOwnership = (
  accountId: string,
  userId: string,
  shares: Array<{ ownerName: string; sharePercent: number }>,
) =>
  request<{ ownerships: Ownership[] }>(`/accounts/${accountId}/ownership`, {
    method: "PUT",
    body: JSON.stringify({ user_id: userId, shares }),
  }).then((data) => data.ownerships);

// ─── Connexions ─────────────────────────────────────────────────────────────

export const getConnections = (userId: string) =>
  request<{ connections: Connection[]; status: IntegrationStatus }>("/connections", {
    query: { user_id: userId },
  });

export const getIntegrationStatus = () =>
  request<{ status: IntegrationStatus }>("/connections/status").then((data) => data.status);

export const getCountries = () =>
  request<{ countries: string[] }>("/connections/countries").then((data) => data.countries);

export const searchInstitutions = (query: string, country = "FR") =>
  request<{ institutions: Institution[] }>("/connections/institutions", {
    query: { query, country },
  }).then((data) => data.institutions);

export const saveIntegrationSettings = (payload: {
  applicationId: string;
  privateKey: string;
  redirectUri: string;
}) =>
  request<{ status: IntegrationStatus }>("/connections/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  }).then((data) => data.status);

export const deleteIntegrationSettings = () =>
  request<{ status: IntegrationStatus }>("/connections/settings", {
    method: "DELETE",
  }).then((data) => data.status);

export const startConnection = (
  userId: string,
  institutionId: string,
  label?: string,
) =>
  request<{ connection: Connection; url: string; state: string }>(
    "/connections/enable-banking/start",
    json({ user_id: userId, institution_id: institutionId, label }),
  );

export const completeConnection = (userId: string, callbackUrl: string) =>
  request<SyncResult>("/connections/enable-banking/complete", {
    ...json({ user_id: userId, callback_url: callbackUrl }),
  });

export const syncConnection = (connectionId: string, userId: string, force = false) =>
  request<SyncResult>(`/connections/${connectionId}/sync`, {
    ...json({ user_id: userId, force }),
  });

export const syncAllConnections = (userId: string, force = false) =>
  request<{ results: SyncResult[] }>("/connections/sync-all", {
    ...json({ user_id: userId, force }),
  }).then((data) => data.results);

export const disconnect = (
  connectionId: string,
  userId: string,
  archiveAccounts = false,
) =>
  request<{ deleted: boolean }>(`/connections/${connectionId}`, {
    method: "DELETE",
    query: { user_id: userId, archive_accounts: archiveAccounts ? 1 : undefined },
  });

export const getSyncRuns = (connectionId: string, userId: string) =>
  request<{ runs: unknown[] }>(`/connections/${connectionId}/runs`, {
    query: { user_id: userId },
  }).then((data) => data.runs);

// ─── Immobilier ─────────────────────────────────────────────────────────────

export const getProperties = (userId: string) =>
  request<{ properties: Property[] }>("/properties", {
    query: { user_id: userId },
  }).then((data) => data.properties);

export const getProperty = (propertyId: string, userId: string) =>
  request<{ property: Property; valuations: PropertyValuation[] }>(
    `/properties/${propertyId}`,
    { query: { user_id: userId } },
  );

export const createProperty = (userId: string, payload: Record<string, unknown>) =>
  request<{ property: Property; account: PortfolioAccount }>("/properties", {
    ...json({ user_id: userId, ...payload }),
  });

export const updateProperty = (
  propertyId: string,
  userId: string,
  payload: Record<string, unknown>,
) =>
  request<{ property: Property }>(`/properties/${propertyId}`, {
    method: "PATCH",
    body: JSON.stringify({ user_id: userId, ...payload }),
  }).then((data) => data.property);

export const deleteProperty = (propertyId: string, userId: string) =>
  request<{ deleted: boolean }>(`/properties/${propertyId}`, {
    method: "DELETE",
    query: { user_id: userId },
  });

export const geocodeProperty = (propertyId: string, userId: string) =>
  request<{ property: Property }>(`/properties/${propertyId}/geocode`, {
    ...json({ user_id: userId }),
  }).then((data) => data.property);

export const valuateProperty = (
  propertyId: string,
  userId: string,
  mode: "auto" | "manual" = "auto",
  value?: number,
) =>
  request<{
    status: string;
    message?: string;
    property?: Property;
    valuation?: PropertyValuation;
    reindexed?: boolean;
  }>(`/properties/${propertyId}/valuate`, {
    ...json({ user_id: userId, mode, value }),
  });

export const getValuations = (propertyId: string, userId: string) =>
  request<{ valuations: PropertyValuation[] }>(
    `/properties/${propertyId}/valuations`,
    { query: { user_id: userId } },
  ).then((data) => data.valuations);

// ─── Prêts ──────────────────────────────────────────────────────────────────

export const getLoans = (userId: string) =>
  request<{ loans: Loan[] }>("/loans", {
    query: { user_id: userId },
  }).then((data) => data.loans);

export const createLoan = (userId: string, payload: Record<string, unknown>) =>
  request<{ loan: Loan; account: PortfolioAccount; summary: unknown }>("/loans", {
    ...json({ user_id: userId, ...payload }),
  });

export const updateLoan = (
  loanId: string,
  userId: string,
  payload: Record<string, unknown>,
) =>
  request<{ loan: Loan }>(`/loans/${loanId}`, {
    method: "PATCH",
    body: JSON.stringify({ user_id: userId, ...payload }),
  }).then((data) => data.loan);

export const deleteLoan = (loanId: string, userId: string) =>
  request<{ deleted: boolean }>(`/loans/${loanId}`, {
    method: "DELETE",
    query: { user_id: userId },
  });

export const getLoanSchedule = (
  loanId: string,
  userId: string,
  asOf?: string,
) =>
  request<LoanSchedule>(`/loans/${loanId}/schedule`, {
    query: { user_id: userId, as_of: asOf },
  });

// ─── Marché ─────────────────────────────────────────────────────────────────

export const getQuote = (ticker: string, force = false) =>
  request<{ quote: Quote }>("/market/quote", {
    query: { ticker, force: force ? 1 : undefined },
  }).then((data) => data.quote);

export const searchSymbols = (query: string) =>
  request<{ results: Array<{ ticker: string; name: string; exchange: string | null }> }>(
    "/market/search",
    { query: { q: query } },
  ).then((data) => data.results);

export const resolveIsin = (isin: string) =>
  request<{ security: Security }>("/market/resolve-isin", {
    query: { isin },
  }).then((data) => data.security);

export const refreshPrices = (userId: string, force = true, accountId?: string) =>
  request<{
    updated: number;
    failed: Array<{ ticker: string; error: string }>;
    accounts: number;
  }>("/market/refresh", {
    ...json({ user_id: userId, force, account_id: accountId }),
  });

// ─── Crypto ─────────────────────────────────────────────────────────────────

export const getCryptoAccounts = (userId: string) =>
  request<{ accounts: PortfolioAccount[] }>("/crypto/accounts", {
    query: { user_id: userId },
  }).then((data) => data.accounts);

export const createCryptoAccount = (
  userId: string,
  payload: {
    name: string;
    provider: "binance" | "evm" | "bitcoin" | "solana" | "manual";
    address?: string;
    apiKey?: string;
    apiSecret?: string;
    color?: string;
    holdings?: Array<{ ticker: string; name?: string; quantity: number; price?: number }>;
  },
) =>
  request<{ account: PortfolioAccount; holdings: Holding[] }>("/crypto/accounts", {
    ...json({ user_id: userId, ...payload }),
  });

export const syncCryptoAccount = (accountId: string, userId: string) =>
  request<{ account: PortfolioAccount; holdings: Holding[] }>(
    `/crypto/sync/${accountId}`,
    json({ user_id: userId }),
  );

export const syncAllCryptoAccounts = (userId: string) =>
  request<{
    total: number;
    synced: number;
    results: Array<{ accountId: string; success: boolean; balance?: number; error?: string }>;
  }>("/crypto/sync-all", json({ user_id: userId }));

// ─── Synchronisation de compte individuel ───────────────────────────────────

export const syncAccount = (accountId: string, userId: string) =>
  request<{ result: unknown; account: PortfolioAccount }>(`/accounts/${accountId}/sync`, {
    ...json({ user_id: userId }),
  });

// ─── Sidecar BoursoBank ─────────────────────────────────────────────────────

export interface BoursoSidecarStatus {
  available: boolean;
  configured: boolean;
  customerId: string | null;
}

export const getBoursoSidecarStatus = () =>
  request<BoursoSidecarStatus>("/sidecar/bourso/status");

export const connectBoursoSidecar = (
  userId: string,
  payload: {
    connectionId?: string;
    customerId?: string;
    password?: string;
    saveCredentials?: boolean;
    pages?: number;
  },
) =>
  request<{
    status: string;
    accountsSynced: number;
    transactionsImported: number;
    holdingsSynced: number;
    connection: Connection;
    errors?: unknown[];
  }>("/sidecar/bourso/connect", {
    ...json({ user_id: userId, ...payload }),
  });

export const syncBoursoSidecar = (
  userId: string,
  payload?: { connectionId?: string; pages?: number },
) =>
  request<{
    status: string;
    accountsSynced: number;
    transactionsImported: number;
    holdingsSynced: number;
    connection: Connection;
    errors?: unknown[];
  }>("/sidecar/bourso/sync", {
    ...json({ user_id: userId, ...(payload || {}) }),
  });

export const deleteBoursoSidecarCredentials = () =>
  request<{ deleted: boolean }>("/sidecar/bourso/credentials", {
    method: "DELETE",
  });

export const importAccountCsv = (
  userId: string,
  payload: {
    accountId?: string;
    newAccount?: {
      name: string;
      type: string;
      currency?: string;
      color?: string;
      logo?: string;
    };
    mode: "HOLDINGS" | "TRANSACTIONS";
    items: unknown[];
  },
) =>
  request<{
    success: boolean;
    mode: "HOLDINGS" | "TRANSACTIONS";
    accountId: string;
    account: PortfolioAccount;
    importedCount: number;
    totalValue: number;
  }>("/accounts/import-csv", {
    ...json({ user_id: userId, ...payload }),
  });


