import "./shims";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import {
  getBnpJob,
  resetBnpJobsForTests,
  startBnpSidecarSync,
  submitBnpMfa,
} from "../server/services/bnpSidecarService.js";

const USER = "TestBnpJob";
const PASSWORD = "654321";
const CUSTOMER_ID = "12345678";

const waitForJob = async (
  predicate: (job: any) => boolean,
  timeoutMs = 5000,
): Promise<any> => {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const job = getBnpJob(USER, currentJobId);
    last = job;
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(
    `La tâche BNP n'a pas atteint l'état attendu (dernier état: ${JSON.stringify(last)}).`,
  );
};

let currentJobId = "";

const fakeCli = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  if (!input.trim()) {
    console.error(JSON.stringify({ error: { code: "PASSWORD_REQUIRED", message: "mot de passe absent" } }));
    process.exit(3);
  }
  if (input.trim() !== ${JSON.stringify(PASSWORD)}) {
    console.error(JSON.stringify({ error: { code: "AUTH_FAILED", message: "mot de passe invalide" } }));
    process.exit(4);
  }
  if (process.env.BNP_PASSWORD || args.some((arg) => arg.includes(${JSON.stringify(PASSWORD)}))) {
    console.error(JSON.stringify({ error: { code: "SECRET_LEAK", message: "secret exposé" } }));
    process.exit(5);
  }
  if (process.env.BNP_CUSTOMER_ID !== ${JSON.stringify(CUSTOMER_ID)}) {
    console.error(JSON.stringify({ error: { code: "CUSTOMER_MISSING", message: "numéro client absent" } }));
    process.exit(6);
  }

  const mfaIndex = args.indexOf("--mfa-dir");
  const mfaDir = mfaIndex >= 0 ? args[mfaIndex + 1] : null;
  const finish = () => {
    process.stdout.write(JSON.stringify({
      schema: "bnp-sidecar/export/v1",
      source: "direct",
      status: "ok",
      accounts: [{
        uid: "checking-1",
        externalId: "bnp_checking-1",
        name: "Compte courant BNP",
        product: "Compte courant",
        kind: "banking",
        currency: "EUR",
        balance: 1234.56,
        availableBalance: 1200,
        iban: null,
        transactions: [{
          id: "tx-1",
          dedupKey: "bnp:checking-1:tx-1",
          bookingDate: "2026-03-01",
          valueDate: "2026-03-01",
          amount: -10,
          currency: "EUR",
          description: "Test BNP"
        }]
      }],
      errors: []
    }));
  };

  if (mfaDir) {
    const requestPath = path.join(mfaDir, "mfa-request.json");
    fs.writeFileSync(requestPath, JSON.stringify({
      schema: "bnp-sidecar/mfa-request/v1",
      id: "req-1",
      kind: "sms",
      page: { host: "mabanque.bnpparibas", path: "/validation", queryKeys: [] },
      codeRequired: true,
      actions: []
    }), { mode: 0o600 });
    const deadline = Date.now() + 5000;
    const wait = () => {
      const responsePath = path.join(mfaDir, "mfa-response.json");
      if (fs.existsSync(responsePath)) {
        const response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
        if (response.id !== "req-1" || response.code !== "123456") process.exit(7);
        finish();
        return;
      }
      if (Date.now() > deadline) process.exit(8);
      setTimeout(wait, 40);
    };
    wait();
    return;
  }
  finish();
});
`;

describe("BNP Sidecar job", () => {
  let db: any;
  let repository: any;
  let tempDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initializePortfolioSchema(db);
    repository = new PortfolioRepository(db);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-bnp-test-"));
    const cliPath = path.join(tempDir, "bnp-direct");
    fs.writeFileSync(cliPath, fakeCli, { mode: 0o700 });
    process.env.BNP_CLI_PATH = cliPath;
  });

  afterEach(() => {
    resetBnpJobsForTests();
    delete process.env.BNP_CLI_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("exécute le CLI, échange la MFA et importe l'export sans exposer le secret", async () => {
    const { jobId } = startBnpSidecarSync({
      repository,
      userId: USER,
      customerId: CUSTOMER_ID,
      password: PASSWORD,
      saveCustomerId: true,
    });
    currentJobId = jobId;

    const challenge = await waitForJob((job) => job.status === "mfa_required");
    expect(challenge.challenge).toMatchObject({
      kind: "sms",
      codeRequired: true,
      page: { host: "mabanque.bnpparibas", path: "/validation" },
    });

    expect(submitBnpMfa(USER, jobId, { code: "123456" })).toMatchObject({
      accepted: true,
    });

    const success = await waitForJob((job) => job.status === "success");
    expect(success.result).toMatchObject({
      accountsSynced: 1,
      transactionsImported: 1,
    });
    expect(repository.listAccounts(USER)).toHaveLength(1);
    expect(repository.listAccounts(USER)[0].name).toBe("Compte courant BNP");
  });

  it("rejette un mot de passe invalide sans créer de compte", async () => {
    const { jobId } = startBnpSidecarSync({
      repository,
      userId: USER,
      customerId: CUSTOMER_ID,
      password: "111111",
      saveCustomerId: false,
    });
    currentJobId = jobId;

    const failed = await waitForJob((job) => job.status === "error");
    expect(failed.code).toBe("AUTH_FAILED");
    expect(repository.listAccounts(USER)).toHaveLength(0);
  });
});
