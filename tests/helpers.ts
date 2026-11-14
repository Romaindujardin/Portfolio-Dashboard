// Petits utilitaires partagés par les fichiers de test.
import { TEST_SERVER, ensureTestSession } from "./shims";

export const API_BASE = `${TEST_SERVER.baseUrl}/api`;

export const api = (pathname: string, init?: RequestInit): Promise<Response> =>
  fetch(`${API_BASE}${pathname}`, init);

/** Appelle l'API avec la session explicite d'un profil (tests IDOR). */
export const apiAs = async (
  user: string,
  pathname: string,
  init?: RequestInit,
): Promise<Response> => {
  const cookie = await ensureTestSession(user);
  const headers = new Headers(init?.headers);
  headers.set("Cookie", cookie);
  return fetch(`${API_BASE}${pathname}`, { ...init, headers });
};

/** Appelle l'API sans cookie, pour vérifier le refus des routes protégées. */
export const apiWithoutSession = (
  pathname: string,
  init?: RequestInit,
): Promise<Response> => {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", "");
  return fetch(`${API_BASE}${pathname}`, { ...init, headers });
};

export async function apiJson<T = unknown>(
  pathname: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await api(pathname, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: body as T };
}

export const postJson = (
  pathname: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  api(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

export const putJson = (pathname: string, payload: unknown): Promise<Response> =>
  api(pathname, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const randomAddress = (prefix = "0xtest"): string =>
  `${prefix}${Math.random().toString(16).slice(2, 12)}`;

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 4000,
  stepMs = 50,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}
