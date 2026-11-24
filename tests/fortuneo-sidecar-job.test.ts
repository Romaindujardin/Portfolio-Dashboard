import "./shims";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializePortfolioSchema } from "../server/db/portfolioSchema.js";
import { PortfolioRepository } from "../server/services/portfolioRepository.js";
import { syncFortuneoSidecar } from "../server/services/fortuneoSidecarService.js";

const USER = "TestFortuneoJob";
const LOGIN = "mon-login-fortuneo";
const PASSWORD = "mot-de-passe-fortuneo";

const fakeCli = `#!/usr/bin/env node
const fs = require("fs");
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
  const otpIndex = args.indexOf("--otp-file");
  if (otpIndex < 0) fail("OTP_REQUIRED", "validation 2FA requise");
  const otpPath = args[otpIndex + 1];
  const content = fs.readFileSync(otpPath, "utf8").trim();
  if (content !== "123456") fail("OTP_REQUIRED", "code 2FA invalide");
  const mode = fs.statSync(otpPath).mode & 0o777;
  if (mode !== 0o600) fail("UNSAFE_OTP_FILE", "fichier OTP non privé");
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
});
`;

describe("Fortuneo Sidecar sync", () => {
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
    delete process.env.FORTUNEO_CLI_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("transmet le mot de passe sur stdin et le code 2FA via un fichier 0600", async () => {
    const result = await syncFortuneoSidecar({
      repository,
      userId: USER,
      login: LOGIN,
      password: PASSWORD,
      otp: "123456",
      saveLogin: true,
    });

    expect(result).toMatchObject({
      accountsSynced: 1,
      transactionsImported: 1,
      errors: [],
    });
    const accounts = repository.listAccounts(USER);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe("Compte Fortuneo");
  });

  it("propage OTP_REQUIRED avec un statut 428", async () => {
    await expect(
      syncFortuneoSidecar({
        repository,
        userId: USER,
        login: LOGIN,
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({
      status: 428,
      code: "OTP_REQUIRED",
    });
    expect(repository.listAccounts(USER)).toHaveLength(0);
  });
});
