import "./shims";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import {
  getFortuneoJob,
  resetFortuneoJobsForTests,
  startFortuneoSidecarSync,
  submitFortuneoOtp,
} from "../server/services/fortuneoSidecarService.js";

const USER = "TestFortuneoJob";
const LOGIN = "mon-login-fortuneo";
const PASSWORD = "mot-de-passe-fortuneo";
const OTP = "123456";

const fakeCli = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const fail = (code, message) => {
    console.error(JSON.stringify({ error: { code, message } }));
    process.exit(4);
  };
  if (input.trim() !== ${JSON.stringify(PASSWORD)}) fail("AUTH_FAILED", "mot de passe invalide");
  if (process.env.FORTUNEO_LOGIN !== ${JSON.stringify(LOGIN)}) fail("AUTH_FAILED", "identifiant absent");
  if (args.some((arg) => arg.includes(${JSON.stringify(PASSWORD)}))) fail("SECRET_LEAK", "secret dans argv");
  const dirIndex = args.indexOf("--otp-broker-dir");
  if (dirIndex < 0) fail("OTP_REQUIRED", "broker OTP absent");
  const dir = args[dirIndex + 1];
  if ((fs.statSync(dir).mode & 0o777) !== 0o700) fail("UNSAFE_OTP_DIR", "répertoire OTP non privé");

  const requestId = "req-" + process.pid;
  fs.writeFileSync(
    path.join(dir, "otp-request.json"),
    JSON.stringify({
      schema: "fortuneo-sidecar/otp-request/v1",
      id: requestId,
      kind: "sms",
      field: "code",
      label: "Code reçu par SMS",
      codeRequired: true
    }),
    { mode: 0o600, flag: "wx" }
  );

  const responsePath = path.join(dir, "otp-response.json");
  const deadline = Date.now() + 10000;
  const wait = () => {
    if (Date.now() > deadline) fail("OTP_REQUIRED", "délai OTP dépassé");
    if (!fs.existsSync(responsePath)) return setTimeout(wait, 20);
    if ((fs.statSync(responsePath).mode & 0o777) !== 0o600) fail("UNSAFE_OTP_FILE", "fichier OTP non privé");
    const response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
    if (response.id !== requestId) return setTimeout(wait, 20);
    if (response.cancel) fail("OTP_CANCELLED", "saisie annulée");
    if (response.code !== ${JSON.stringify(OTP)}) fail("AUTH_FAILED", "code SMS incorrect");
    fs.unlinkSync(responsePath);
    process.stdout.write(JSON.stringify({
      schema: "fortuneo-sidecar/export/v1",
      status: "ok",
      accounts: [{
        id: "fortuneo-checking-1",
        label: "Compte Fortuneo",
        kind: "banking",
        type: "checking",
        typeLabel: "Compte courant",
        balance: 500,
        currency: "EUR",
        transactions: [{
          id: "ftx-1",
          dedupKey: "fortuneo:fortuneo-checking-1:ftx-1",
          date: "2026-03-02",
          amount: -20,
          currency: "EUR",
          label: "Achat"
        }],
        positions: []
      }],
      errors: []
    }));
  };
  wait();
});
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForJob = async (
  jobId: string,
  predicate: (job: any) => boolean,
) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = getFortuneoJob(USER, jobId);
    if (!job) throw new Error("Tâche Fortuneo introuvable pendant le polling.");
    if (predicate(job)) return job;
    await sleep(20);
  }
  throw new Error("Délai de polling Fortuneo dépassé.");
};

describe("Fortuneo Sidecar job", () => {
  let db: any;
  let repository: any;
  let tempDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initializePortfolioSchema(db);
    repository = new PortfolioRepository(db);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-fortuneo-test-"));
    const cliPath = path.join(tempDir, "fortuneo-sidecar");
    fs.writeFileSync(cliPath, fakeCli, { mode: 0o700 });
    process.env.FORTUNEO_CLI_PATH = cliPath;
  });

  afterEach(() => {
    resetFortuneoJobsForTests();
    delete process.env.FORTUNEO_CLI_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("expose le challenge SMS puis applique l'export après validation", async () => {
    const started = startFortuneoSidecarSync({
      repository,
      userId: USER,
      login: LOGIN,
      password: PASSWORD,
      saveLogin: true,
    });
    expect(started.status).toBe("PENDING");

    const waiting = await waitForJob(
      started.jobId,
      (job) => job.status === "otp_required",
    );
    expect(waiting.challenge).toMatchObject({
      kind: "sms",
      label: "Code reçu par SMS",
      codeRequired: true,
    });

    const submitted = submitFortuneoOtp(USER, started.jobId, { code: OTP });
    expect(submitted.accepted).toBe(true);

    const finished = await waitForJob(
      started.jobId,
      (job) => job.status === "success" || job.status === "error",
    );
    expect(finished.status).toBe("success");
    expect(finished.error).toBeNull();
    expect(finished.result).toMatchObject({
      accountsSynced: 1,
      transactionsImported: 1,
      errors: [],
    });

    const accounts = repository.listAccounts(USER);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe("Compte Fortuneo");
  });

  it("annule la tâche sans créer de nouveau SMS", async () => {
    const started = startFortuneoSidecarSync({
      repository,
      userId: USER,
      login: LOGIN,
      password: PASSWORD,
      saveLogin: false,
    });
    await waitForJob(started.jobId, (job) => job.status === "otp_required");

    const cancelled = submitFortuneoOtp(USER, started.jobId, { cancel: true });
    expect(cancelled).toMatchObject({ accepted: true, cancelled: true });

    const finished = await waitForJob(
      started.jobId,
      (job) => job.status === "error",
    );
    expect(finished.code).toBe("CANCELLED");
    expect(finished.error).toBe("Synchronisation Fortuneo annulée.");
    expect(repository.listAccounts(USER)).toHaveLength(0);
  });

  it("refuse deux synchronisations simultanées pour le même profil", async () => {
    const started = startFortuneoSidecarSync({
      repository,
      userId: USER,
      login: LOGIN,
      password: PASSWORD,
      saveLogin: false,
    });
    await waitForJob(started.jobId, (job) => job.status === "otp_required");

    expect(() =>
      startFortuneoSidecarSync({
        repository,
        userId: USER,
        login: LOGIN,
        password: PASSWORD,
        saveLogin: false,
      }),
    ).toThrowError(/déjà en cours/);
  });

  it("refuse un code qui ne respecte pas le format SMS", async () => {
    const started = startFortuneoSidecarSync({
      repository,
      userId: USER,
      login: LOGIN,
      password: PASSWORD,
      saveLogin: false,
    });
    await waitForJob(started.jobId, (job) => job.status === "otp_required");

    expect(() =>
      submitFortuneoOtp(USER, started.jobId, { code: "12ab" }),
    ).toThrowError(/4 à 8 chiffres/);
  });
});
