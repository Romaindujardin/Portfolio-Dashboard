// Environnement navigateur minimal pour exécuter les modules front sous Node :
// - localStorage / window factices
// - redirection des appels "http://localhost:3001" vers le serveur de test isolé
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
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

// Shim minimal (idempotent) des globals navigateur.
Object.assign(globalThis, { window: windowStub, localStorage: appStorage });

// Redirection transparente des appels API des modules front vers le serveur de test.
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = ((input: unknown, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith(APP_SERVER_URL)) {
    input = TEST_SERVER.baseUrl + input.slice(APP_SERVER_URL.length);
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;
