// Base commune des appels API.
//
// - En développement, le frontend passe par le proxy Vite (`/api` -> :3001).
// - En production, Express sert le frontend et l'API sur la même origine.
// - VITE_API_URL permet de séparer les deux (ex. frontend statique + backend
//   dédié). Il doit contenir l'origine seule, sans `/api`.
const configuredOrigin = String(import.meta.env.VITE_API_URL || "")
  .trim()
  .replace(/\/+$/, "");
const isBrowser = typeof window !== "undefined";

// Dans un navigateur sans VITE_API_URL, on garde une URL relative : Vite la
// proxyfie en développement, et Express sert la même origine en production.
// Les tests Node n'ont pas de base d'URL : ils utilisent le backend local.
export const API_ORIGIN = configuredOrigin || (isBrowser ? "" : "http://localhost:3001");
export const API_BASE = `${API_ORIGIN}/api`;

export const apiUrl = (path: string): string => {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${suffix}`;
};

/**
 * Origine du backend, utilisée uniquement pour afficher la bonne URL de
 * retour OAuth par défaut. En production, le frontend et l'API partagent la
 * même origine ; en développement, le backend est sur :3001.
 */
export const getBackendOrigin = (): string => {
  if (API_ORIGIN) return API_ORIGIN;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://localhost:5173";
};

export const getDefaultEnableBankingCallbackUrl = (): string =>
  `${getBackendOrigin()}/api/portfolio/connections/enable-banking/callback`;
