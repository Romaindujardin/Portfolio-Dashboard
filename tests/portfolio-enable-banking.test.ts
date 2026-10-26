// Test d'intégration du flux Enable Banking complet, sans réseau externe :
// un faux serveur PSD2 local répond à /auth, /sessions et /accounts. Le routeur
// réel est monté sur un serveur Express éphémère avec une base SQLite mémoire.
import "./shims";
import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { createPortfolioRouter } from "../server/routes/portfolio.js";

const listen = (server: Server) =>
  new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

const close = (server: Server | null) =>
  new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });

const readJsonBody = async (req: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const sessionPayload = () => ({
  session_id: "session-1",
  status: "AUTHORIZED",
  access: { valid_until: "2027-01-01T00:00:00Z" },
  aspsp: { name: "Banque Test", country: "FR" },
  accounts: [{ uid: "account-1", identification_hash: "hash-1" }],
  accounts_data: [{ uid: "account-1", identification_hash: "hash-1" }],
});

let fakeServer: Server | null = null;
let appServer: Server | null = null;
let db: Database.Database | null = null;
let appBase = "";
let fakeBase = "";
let lastSessionCode: string | null = null;
let lastAuthState: string | null = null;

const api = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${appBase}/api/portfolio${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
};

beforeAll(async () => {
  fakeServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    try {
      if (req.method === "GET" && url.pathname === "/application") {
        return send(200, { countries: ["FR", "DE"] });
      }
      if (req.method === "GET" && url.pathname === "/aspsps") {
        return send(200, {
          aspsps: [
            {
              name: "Banque Test",
              country: "FR",
              bic: "TESTFRPP",
              psu_types: ["personal"],
            },
          ],
        });
      }
      if (req.method === "POST" && url.pathname === "/auth") {
        const body = await readJsonBody(req);
        lastAuthState = body.state || null;
        return send(200, {
          url: "http://localhost/authorize",
          authorization_id: "authorization-1",
        });
      }
      if (req.method === "POST" && url.pathname === "/sessions") {
        const body = await readJsonBody(req);
        lastSessionCode = body.code || null;
        return send(200, sessionPayload());
      }
      if (req.method === "GET" && url.pathname === "/sessions/session-1") {
        return send(200, sessionPayload());
      }
      if (req.method === "DELETE" && url.pathname === "/sessions/session-1") {
        return send(200, {});
      }
      if (req.method === "GET" && url.pathname === "/accounts/account-1/details") {
        return send(200, {
          name: "Compte courant test",
          product: "Compte de dépôt",
          currency: "EUR",
          identification_hash: "hash-1",
          cash_account_type: "CACC",
          account_id: { iban: "FR7630006000011234567890189" },
        });
      }
      if (req.method === "GET" && url.pathname === "/accounts/account-1/balances") {
        return send(200, {
          balances: [
            {
              balance_type: "CLBD",
              balance_amount: { amount: "1234.56", currency: "EUR" },
            },
          ],
        });
      }
      if (
        req.method === "GET" &&
        url.pathname === "/accounts/account-1/transactions"
      ) {
        return send(200, {
          transactions: [
            {
              status: "BOOK",
              entry_reference: "tx-1",
              booking_date: "2026-10-20",
              transaction_amount: { amount: "12.34", currency: "EUR" },
              credit_debit_indicator: "DBIT",
              remittance_information: ["Café de la place"],
              creditor: { name: "Café de la place" },
            },
          ],
          continuation_key: null,
        });
      }
      return send(404, { message: `Route factice inconnue: ${req.method} ${url.pathname}` });
    } catch (error) {
      return send(500, { message: error instanceof Error ? error.message : "Erreur" });
    }
  });
  await listen(fakeServer);
  fakeBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  db = new Database(":memory:");
  initializePortfolioSchema(db);

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api/portfolio",
    createPortfolioRouter({ db, enableBankingBaseUrl: fakeBase }),
  );
  appServer = createServer(app);
  await listen(appServer);
  appBase = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await close(appServer);
  await close(fakeServer);
  db?.close();
});

describe("Enable Banking — flux OAuth et synchronisation", () => {
  it("configure le connecteur, échange le code et importe les comptes", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const user = "ebintegration";

    const settings = await api("PUT", "/connections/settings", {
      applicationId: "application-test",
      privateKey,
      redirectUri: "http://localhost:9999/callback",
    });
    expect(settings.status).toBe(200);
    expect(settings.body.status.configured).toBe(true);

    const institutions = await api(
      "GET",
      "/connections/institutions?country=FR&query=Banque",
    );
    expect(institutions.status).toBe(200);
    expect(institutions.body.institutions).toHaveLength(1);
    const institution = institutions.body.institutions[0];

    const started = await api("POST", "/connections/enable-banking/start", {
      user_id: user,
      institution_id: institution.id,
      label: "Banque Test",
    });
    expect(started.status).toBe(201);
    expect(lastAuthState).toBe(started.body.state);
    expect(started.body.url).toBe("http://localhost/authorize");

    const state = encodeURIComponent(started.body.state);
    const completed = await api("POST", "/connections/enable-banking/complete", {
      user_id: user,
      callback_url: `http://localhost/callback?code=good-code&state=${state}`,
    });
    expect(completed.status).toBe(200);
    expect(lastSessionCode).toBe("good-code");
    expect(completed.body.sync.status).toBe("OK");
    expect(completed.body.sync.accountsSynced).toBe(1);
    expect(completed.body.sync.transactionsImported).toBe(1);

    const overview = await api("GET", `/overview?user_id=${user}`);
    expect(overview.status).toBe(200);
    expect(overview.body.totals.assets).toBe(1234.56);
    expect(overview.body.counts).toMatchObject({
      accounts: 1,
      holdings: 0,
    });
    expect(overview.body.accounts[0]).toMatchObject({
      provider: "enable-banking",
      externalId: "hash-1",
      type: "CHECKING",
      balance: 1234.56,
      isManual: false,
    });

    const accountId = overview.body.accounts[0].id as string;
    const transactions = await api(
      "GET",
      `/accounts/${accountId}/transactions?user_id=${user}`,
    );
    expect(transactions.status).toBe(200);
    expect(transactions.body.transactions).toHaveLength(1);
    expect(transactions.body.transactions[0]).toMatchObject({
      externalId: "tx-1",
      amount: -12.34,
      label: "Café de la place",
    });

    const connectionId = completed.body.connection.id as string;
    const connections = await api("GET", `/connections?user_id=${user}`);
    expect(connections.body.connections[0]).toMatchObject({
      id: connectionId,
      status: "active",
      accountCount: 1,
    });

    const again = await api("POST", `/connections/${connectionId}/sync`, {
      user_id: user,
      force: true,
    });
    expect(again.status).toBe(200);
    expect(again.body.transactionsImported).toBe(0);
    expect(again.body.errors).toEqual([]);

    const disconnected = await api(
      "DELETE",
      `/connections/${connectionId}?user_id=${user}`,
    );
    expect(disconnected.status).toBe(200);
    const kept = await api("GET", `/overview?user_id=${user}`);
    expect(kept.body.accounts[0]).toMatchObject({
      isArchived: false,
      connectionId: null,
    });
    const remainingConnections = await api(
      "GET",
      `/connections?user_id=${user}`,
    );
    expect(remainingConnections.body.connections).toHaveLength(0);
  });
});
