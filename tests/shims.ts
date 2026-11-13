// Environnement navigateur minimal pour exécuter les modules front sous Node :
// - localStorage / window factices
// - redirection des appels "http://localhost:3001" vers le serveur de test isolé
// - sessions serveur automatiques par profil (cookies HttpOnly simulés)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const INFO_PATH = path.join(REPO_ROOT, ".test-tmp", "test-server.json");

export interface TestServerInfo {
  port: number;
  baseUrl: string;
  dbPath: string;
  tmpDir: string;
}

if (!fs.existsSync(INFO_PATH)) {
  throw new Error(
    "Informations du serveur de test introuvables (.test-tmp/test-server.json). " +
      "Lancez la suite via `npm test`.",
  );
}

export const TEST_SERVER: TestServerInfo = JSON.parse(
  fs.readFileSync(INFO_PATH, "utf-8"),
);

const APP_SERVER_URL = "http://localhost:3001";

class MemoryStorage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.has(String(key)) ? this.store.get(String(key))! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.store.delete(String(key));
  }

  clear(): void {
    this.store.clear();
  }
}

export const appStorage = new MemoryStorage();

export const resetAppStorage = (): void => {
  appStorage.clear();
};

const windowStub = {
  localStorage: appStorage,
  location: {
    origin: TEST_SERVER.baseUrl,
    href: TEST_SERVER.baseUrl,
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

// Shim minimal (idempotent) des globals navigateur.
Object.assign(globalThis, { window: windowStub, localStorage: appStorage });

// Redirection transparente des appels API des modules front vers le serveur de test.
// Les URLs relatives (`/api/...`, utilisées en production) sont résolues vers
// le backend local, comme le ferait le navigateur.
const realFetch = globalThis.fetch.bind(globalThis);

const sessionCookies = new Map<string, string>();
const sessionPromises = new Map<string, Promise<string>>();

const extractSetCookie = (response: Response): string => {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const list =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const raw = list.length
    ? list
    : [response.headers.get("set-cookie")].filter(Boolean);
  return raw
    .map((cookie) => String(cookie).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
};

const testPasswordFor = (user: string) => `Test-${user}-Password-123!`;

/**
 * Crée (ou récupère) une session serveur pour un profil de test.
 * Le mot de passe est déterministe et n'est utilisé que dans la base isolée.
 */
export const ensureTestSession = async (user = "Romain"): Promise<string> => {
  const clean = String(user || "Romain").trim() || "Romain";
  const cached = sessionCookies.get(clean);
  if (cached) return cached;

  const pending = sessionPromises.get(clean);
  if (pending) return pending;

  const promise = (async () => {
    const password = testPasswordFor(clean);
    const headers = { "Content-Type": "application/json" };
    let response = await realFetch(
      `${TEST_SERVER.baseUrl}/api/portfolio/auth/setup`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ username: clean, password }),
      },
    );
    if (!response.ok) {
      response = await realFetch(
        `${TEST_SERVER.baseUrl}/api/portfolio/auth/verify`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ username: clean, password }),
        },
      );
    }
    if (!response.ok) {
      throw new Error(
        `Impossible de créer une session de test pour ${clean} (HTTP ${response.status})`,
      );
    }
    const cookie = extractSetCookie(response);
    if (!cookie) {
      throw new Error(`Le serveur n'a pas renvoyé de cookie de session pour ${clean}`);
    }
    sessionCookies.set(clean, cookie);
    return cookie;
  })();

  sessionPromises.set(clean, promise);
  try {
    return await promise;
  } finally {
    sessionPromises.delete(clean);
  }
};

export const getTestSessionCookie = (user = "Romain"): string | undefined =>
  sessionCookies.get(String(user || "Romain").trim() || "Romain");

const requestUrl = (input: unknown): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
};

const parseJsonBody = (init?: RequestInit): Record<string, any> | null => {
  if (!init?.body || typeof init.body !== "string") return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
};

const isAuthPath = (pathname: string) =>
  pathname.startsWith("/api/portfolio/auth/");

const VALID_TEST_USER = /^[A-Za-z0-9_-]{1,64}$/;

const isSessionEstablishingPath = (pathname: string) =>
  pathname.endsWith("/api/portfolio/auth/setup") ||
  pathname.endsWith("/api/portfolio/auth/verify");

const userForRequest = (
  pathname: string,
  searchParams: URLSearchParams,
  body: Record<string, any> | null,
): string | null => {
  if (isSessionEstablishingPath(pathname)) return null;
  if (pathname.endsWith("/api/portfolio/auth/status")) return null;
  if (pathname.endsWith("/api/portfolio/auth/logout")) return null;
  if (pathname.endsWith("/api/portfolio/auth/change-password")) {
    const username = body?.username ? String(body.username) : "";
    return VALID_TEST_USER.test(username) ? username : null;
  }
  if (isAuthPath(pathname)) return null;
  const requested =
    body?.user_id ||
    body?.userId ||
    searchParams.get("user_id") ||
    "Romain";
  // Les tests d'entrée invalide doivent atteindre la validation métier (400)
  // avec une session valide, plutôt que d'échouer à créer une session.
  return VALID_TEST_USER.test(String(requested)) ? String(requested) : "Romain";
};

globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  let url = requestUrl(input);
  if (url.startsWith("/")) {
    url = APP_SERVER_URL + url;
  }
  if (url.startsWith(APP_SERVER_URL)) {
    url = TEST_SERVER.baseUrl + url.slice(APP_SERVER_URL.length);
  }

  const parsed = new URL(url);
  const body = parseJsonBody(init);
  const headers = new Headers(init?.headers);
  const onTestServer = url.startsWith(TEST_SERVER.baseUrl);

  if (onTestServer && !headers.has("Cookie")) {
    const user = userForRequest(parsed.pathname, parsed.searchParams, body);
    if (user) {
      headers.set("Cookie", await ensureTestSession(user));
    }
  }

  const response = await realFetch(url, {
    ...init,
    headers,
  });

  if (onTestServer && isSessionEstablishingPath(parsed.pathname)) {
    const username = body?.username ? String(body.username) : "";
    const cookie = extractSetCookie(response);
    if (username && cookie) sessionCookies.set(username, cookie);
  }

  return response;
}) as typeof fetch;
