import type {
  BoursoAccount,
  BoursoAccountMapping,
  BoursoSyncResult,
} from "../types";

const apiBase = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api`;

export async function fetchBoursoAccounts(params: {
  customerId: string;
  password: string;
}): Promise<BoursoAccount[]> {
  const response = await fetch(`${apiBase}/bourso/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Impossible de récupérer les comptes Bourso");
  }

  const data = await response.json();
  return data.accounts as BoursoAccount[];
}

export async function syncBoursoAccounts(params: {
  customerId: string;
  password: string;
  mappings: BoursoAccountMapping[];
  pages?: number;
  userId?: string;
  dryRun?: boolean;
}): Promise<BoursoSyncResult> {
  const response = await fetch(`${apiBase}/bourso/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Échec de la synchronisation Bourso");
  }

  return (await response.json()) as BoursoSyncResult;
}
