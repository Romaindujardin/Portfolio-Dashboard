// Service d'intégration du sidecar Fortuneo (fortuneo-sidecar / Woob).
//
// Le mot de passe Fortuneo n'est jamais enregistré : il est transmis sur stdin
// au CLI à chaque synchronisation. L'identifiant peut être mémorisé dans le
// coffre chiffré du profil. Un éventuel code 2FA est écrit dans un fichier
// privé éphémère (0600) puis supprimé.

import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { PROVIDERS } from "../connectors/types.js";
import { nowIso, round2 } from "../lib/validate.js";
import {
  deleteUserSecret,
  getUserSecret,
  setUserSecret,
} from "./userSecretsService.js";
import { SIDECAR_BANKS, markSidecarPriority } from "./sidecarPriority.js";
import {
  buildSidecarEnv,
  createPrivateTempDir,
  findOnPath,
  redactSecrets,
  removePrivateDir,
  resolveExecutable,
  runSidecarProcess,
} from "./sidecarProcess.js";
import {
  decodeHtmlEntities,
  finiteNumber,
  isoDate,
  mapAssetClass,
  nullableNumber,
} from "./sidecarFormat.js";

export const FORTUNEO_PROVIDER =
  PROVIDERS.FORTUNEO_SIDECAR || "fortuneo-sidecar";
const FORTUNEO_LOGIN_KEY = "fortuneoLogin";
const FORTUNEO_LEGACY_PASSWORD_KEY = "fortuneoPassword";
const SINCE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{10}$/i;
const OTP_REQUEST_SCHEMA = "fortuneo-sidecar/otp-request/v1";
const OTP_RESPONSE_SCHEMA = "fortuneo-sidecar/otp-response/v1";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(MODULE_DIR, "../..");
const WORKSPACE_DIR = path.resolve(PROJECT_DIR, "..");

const positiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const FORTUNEO_OTP_TIMEOUT_SECONDS = Math.min(
  Math.max(positiveNumber(process.env.FORTUNEO_OTP_TIMEOUT_SECONDS, 180), 10),
  900,
);
const FORTUNEO_TIMEOUT_MS = Math.max(
  positiveNumber(
    process.env.FORTUNEO_TIMEOUT_MS,
    (FORTUNEO_OTP_TIMEOUT_SECONDS + 120) * 1000,
  ),
  30_000,
);
const FORTUNEO_JOB_TTL_MS = 15 * 60 * 1000;

const fortuneoError = (
  message,
  { status = 502, code = "FORTUNEO_SIDECAR_ERROR", details = null } = {},
) => {
  const error = new Error(message);
  error.name = "FortuneoSidecarError";
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
};

export const resolveFortuneoCliPath = () => {
  const candidates = [
    process.env.FORTUNEO_CLI_PATH,
    process.env.FORTUNEO_SIDECAR_PATH,
    path.join(
      WORKSPACE_DIR,
      "fortuneo-sidecar/.venv/bin/fortuneo-sidecar",
    ),
    path.join(os.homedir(), ".local/bin/fortuneo-sidecar"),
    findOnPath("fortuneo-sidecar"),
  ];
  return resolveExecutable(
    candidates,
    "fortuneo-sidecar",
    "FORTUNEO_CLI_PATH",
  );
};

export const isFortuneoCliAvailable = () => {
  try {
    resolveFortuneoCliPath();
    return true;
  } catch {
    return false;
  }
};

export const getFortuneoSavedCredentials = (repository, userId) => {
  if (!userId) return null;
  const login = getUserSecret(repository.db, userId, FORTUNEO_LOGIN_KEY);
  if (!login) return null;
  return { login };
};

export const saveFortuneoLogin = (repository, userId, login) => {
  if (!userId) {
    throw fortuneoError("Profil requis pour l'identifiant Fortuneo.", {
      status: 400,
      code: "USER_REQUIRED",
    });
  }
  const value = String(login || "").trim();
  if (!value || value.length > 120) {
    throw fortuneoError("Identifiant Fortuneo invalide.", {
      status: 400,
      code: "INVALID_LOGIN",
    });
  }
  setUserSecret(repository.db, userId, FORTUNEO_LOGIN_KEY, value);
  return value;
};

export const deleteFortuneoCredentials = (repository, userId) => {
  if (!userId) return false;
  const loginDeleted = deleteUserSecret(
    repository.db,
    userId,
    FORTUNEO_LOGIN_KEY,
  );
  const legacyPasswordDeleted = deleteUserSecret(
    repository.db,
    userId,
    FORTUNEO_LEGACY_PASSWORD_KEY,
  );
  return loginDeleted || legacyPasswordDeleted;
};

export const getFortuneoStatus = (repository, userId) => {
  const saved = getFortuneoSavedCredentials(repository, userId);
  return {
    available: isFortuneoCliAvailable(),
    configured: Boolean(saved?.login),
    loginSaved: Boolean(saved?.login),
    passwordRequired: true,
    otpSupported: true,
    otp: "file-broker",
  };
};

export const mapFortuneoAccountType = (account = {}) => {
  const kind = String(account.kind || account.type || "").toLowerCase();
  const label = `${account.label || account.name || ""} ${
    account.typeLabel || ""
  }`.toUpperCase();
  if (kind === "loan") return "LOAN";
  if (kind === "trading") {
    return label.includes("PEA") ? "PEA" : "SECURITIES";
  }
  if (kind === "insurance") return "SECURITIES";
  if (kind === "savings" || kind === "deposit") {
    return label.includes("PEA") ? "PEA" : "SAVINGS";
  }
  if (kind === "banking" || kind === "checking") return "CHECKING";
  if (label.includes("PEA")) return "PEA";
  if (
    label.includes("LIVRET") ||
    label.includes("LDDS") ||
    label.includes("EPARGNE") ||
    label.includes("ÉPARGNE")
  ) {
    return "SAVINGS";
  }
  if (
    label.includes("ASSURANCE") ||
    label.includes("VIE") ||
    label.includes("PER") ||
    label.includes("TITRES") ||
    label.includes("CTO")
  ) {
    return "SECURITIES";
  }
  if (
    label.includes("CREDIT") ||
    label.includes("CRÉDIT") ||
    label.includes("PRET") ||
    label.includes("PRÊT")
  ) {
    return "LOAN";
  }
  return "OTHER";
};

export const mapFortuneoTransaction = (transaction = {}, accountId = "") => {
  const date =
    isoDate(transaction.date) ||
    isoDate(transaction.rdate) ||
    isoDate(transaction.vdate) ||
    isoDate(transaction.bdate) ||
    null;
  const externalId = transaction.id ? String(transaction.id) : null;
  const label =
    decodeHtmlEntities(transaction.label) ||
    decodeHtmlEntities(transaction.raw) ||
    "Transaction Fortuneo";
  const amount = finiteNumber(transaction.amount, 0);
  const dedupKey =
    transaction.dedupKey ||
    (externalId
      ? `fortuneo:${accountId}:${externalId}`
      : `fortuneo:${accountId}:${date}:${amount}:${label}`);
  return {
    externalId,
    dedupKey,
    date,
    valueDate: isoDate(transaction.vdate || transaction.rdate),
    amount,
    currency: transaction.currency || "EUR",
    label,
    counterparty: transaction.counterparty || null,
    category: transaction.category || null,
    pending: Boolean(transaction.coming),
  };
};

/**
 * La ligne « Liquidités » de Woob (code XX-liquidity) est une position
 * synthétique sans quantité ni prix : elle représente le cash non investi.
 * Elle ne doit pas être importée comme un instrument.
 */
export const isFortuneoLiquidityPosition = (position = {}) => {
  const code = String(position.code || "").trim().toLowerCase();
  if (code === "xx-liquidity") return true;
  if (code) return false;
  const label = decodeHtmlEntities(position.label || position.description || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return label === "liquidites";
};

export const mapFortuneoPosition = (position = {}, account = {}) => {
  const code = position.code ? String(position.code).trim() : null;
  const codeType = String(position.codeType || "").toUpperCase();
  const stockSymbol = position.stockSymbol
    ? String(position.stockSymbol).trim()
    : null;
  const quantity = finiteNumber(position.quantity, 0);
  const unitPrice = nullableNumber(position.unitPrice);
  const unitValue =
    nullableNumber(position.unitValue) ?? nullableNumber(position.unitPrice);
  const value =
    nullableNumber(position.valuation) ??
    (unitValue == null ? null : round2(quantity * unitValue));
  const isinCandidate =
    codeType === "ISIN" && code && ISIN_RE.test(code)
      ? code.toUpperCase()
      : code && ISIN_RE.test(code)
        ? code.toUpperCase()
        : stockSymbol && ISIN_RE.test(stockSymbol)
          ? stockSymbol.toUpperCase()
          : null;
  return {
    isin: isinCandidate,
    ticker: stockSymbol || (codeType !== "ISIN" ? code : null),
    name:
      decodeHtmlEntities(position.label) ||
      decodeHtmlEntities(position.description) ||
      code ||
      "Position Fortuneo",
    quantity,
    costBasis:
      unitPrice == null ? null : round2(Math.max(0, quantity) * unitPrice),
    price: unitValue,
    value,
    currency:
      position.currency || position.originalCurrency || account.currency || "EUR",
    assetClass: mapAssetClass(position.assetCategory, "EQUITY"),
    metadata: {
      fortuneoCode: code,
      codeType: codeType || null,
      stockMarket: position.stockMarket || null,
    },
  };
};

/**
 * Applique un export fortuneo-sidecar/export/v1 au portefeuille.
 * Les transactions des comptes d'épargne, de trading et d'assurance-vie sont
 * importées, ainsi que les positions des comptes de trading/assurance-vie.
 */
export const applyFortuneoExport = ({
  repository,
  userId,
  connection,
  payload,
  runId = null,
}) => {
  if (!payload || !Array.isArray(payload.accounts)) {
    throw fortuneoError(
      "Export Fortuneo invalide : liste de comptes absente.",
      { status: 502, code: "FORTUNEO_INVALID_PAYLOAD" },
    );
  }
  if (
    payload.schema &&
    payload.schema !== "fortuneo-sidecar/export/v1"
  ) {
    throw fortuneoError(
      `Schéma d'export Fortuneo non pris en charge : ${payload.schema}`,
      { status: 502, code: "FORTUNEO_INVALID_SCHEMA" },
    );
  }
  if (payload.accounts.length === 0) {
    throw fortuneoError("Aucun compte Fortuneo détecté dans l'export.", {
      status: 502,
      code: "FORTUNEO_NO_ACCOUNTS",
    });
  }

  let accountsSynced = 0;
  let transactionsImported = 0;
  let holdingsSynced = 0;
  const errors = [];

  for (const rawAccount of payload.accounts) {
    try {
      const accountId = String(rawAccount.id || "").trim();
      if (!accountId) {
        throw new Error("Compte Fortuneo sans identifiant.");
      }
      const account = repository.upsertSyncedAccount(userId, {
        provider: FORTUNEO_PROVIDER,
        externalId: `fortuneo-${accountId}`,
        connectionId: connection.id,
        name:
          decodeHtmlEntities(rawAccount.label) ||
          decodeHtmlEntities(rawAccount.typeLabel) ||
          "Compte Fortuneo",
        type: mapFortuneoAccountType(rawAccount),
        currency: rawAccount.currency || "EUR",
        balance: finiteNumber(rawAccount.balance, 0),
        iban: rawAccount.iban || null,
        lastSyncAt: nowIso(),
        metadata: {
          fortuneoId: accountId,
          kind: rawAccount.kind || null,
          type: rawAccount.type || null,
          typeLabel: rawAccount.typeLabel || null,
          maskedNumber: rawAccount.number
            ? `••••${String(rawAccount.number).replace(/\s+/g, "").slice(-4)}`
            : null,
          bankName: rawAccount.bankName || "Fortuneo",
          sidecar: FORTUNEO_PROVIDER,
        },
      });
      accountsSynced += 1;

      const transactions = Array.isArray(rawAccount.transactions)
        ? rawAccount.transactions
        : [];
      const transactionItems = transactions
        .map((transaction) =>
          mapFortuneoTransaction(transaction, accountId),
        )
        .filter((item) => Boolean(item.date));
      if (transactionItems.length > 0) {
        transactionsImported += repository.insertTransactions(
          userId,
          account.id,
          FORTUNEO_PROVIDER,
          transactionItems,
        );
        repository.cleanAuthorizationDuplicates(account.id, userId);
      }

      const positions = Array.isArray(rawAccount.positions)
        ? rawAccount.positions
        : [];
      const investedPositions = positions.filter(
        (position) => !isFortuneoLiquidityPosition(position),
      );
      let totalHoldingsValue = 0;
      for (const rawPosition of investedPositions) {
        const holding = mapFortuneoPosition(rawPosition, rawAccount);
        repository.upsertHolding(userId, account.id, holding);
        holdingsSynced += 1;
        totalHoldingsValue += finiteNumber(holding.value, 0);
      }

      // Supprime l'ancienne ligne synthétique « XX-liquidity » importée par
      // les versions précédentes. Les liquidités sont désormais représentées
      // uniquement par le cash_balance du compte.
      for (const existing of repository.listHoldings(account.id, userId)) {
        if (String(existing.ticker || "").trim().toLowerCase() === "xx-liquidity") {
          repository.deleteHolding(existing.id, account.id, userId);
        }
      }

      if (positions.length > 0) {
        const cashPart = Math.max(
          0,
          round2(finiteNumber(rawAccount.balance, 0) - totalHoldingsValue),
        );
        repository.updateAccount(account.id, userId, {
          cashBalance: cashPart,
        });
      }
    } catch (error) {
      errors.push({
        account:
          decodeHtmlEntities(rawAccount.label) ||
          String(rawAccount.id || "compte Fortuneo"),
        error: error.message,
      });
    }
  }

  for (const entry of Array.isArray(payload.errors) ? payload.errors : []) {
    errors.push({
      account: String(entry.accountId || entry.account || "Fortuneo"),
      error: entry.message || entry.code || "Erreur Fortuneo",
      code: entry.code || undefined,
    });
  }

  const archived =
    accountsSynced > 0
      ? markSidecarPriority({
          repository,
          userId,
          bankKey: "fortuneo",
          sidecarConnectionId: connection.id,
          archiveAccounts: true,
        })
      : { linked: [], archivedAccounts: 0 };

  const status = errors.length > 0 ? "partial" : "success";
  repository.updateConnector(connection.id, userId, {
    status: accountsSynced > 0 ? "active" : "error",
    lastSyncAt: nowIso(),
    lastError:
      errors.length > 0
        ? `${errors.length} anomalie(s) Fortuneo : ${errors[0].error}`
        : null,
    metadata: {
      ...(connection.metadata || {}),
      type: "sidecar",
      bankKey: "fortuneo",
      lastSyncStatus: status,
      lastSyncAt: nowIso(),
    },
  });

  if (runId) {
    repository.finishSyncRun(runId, {
      status: accountsSynced > 0 ? status : "error",
      accountsSynced,
      transactionsImported,
      errors: errors.length > 0 ? errors : null,
    });
  }

  return {
    status: "OK",
    accountsSynced,
    transactionsImported,
    holdingsSynced,
    archivedAccounts: archived.archivedAccounts,
    errors,
    connection: repository.getConnector(connection.id, userId),
  };
};

const cleanConnectionMetadata = (metadata) => {
  const clean = { ...(metadata || {}) };
  for (const key of [
    "password",
    "customerId",
    "login",
    "credentialsEncrypted",
    "apiKey",
    "apiSecret",
    "privateKey",
  ]) {
    delete clean[key];
  }
  return clean;
};

const ensureFortuneoConnection = ({ repository, userId, connectionId }) => {
  const definition = SIDECAR_BANKS.fortuneo;
  let connection = connectionId
    ? repository.getConnector(connectionId, userId)
    : null;
  if (connection && connection.provider !== FORTUNEO_PROVIDER) {
    connection = null;
  }
  if (!connection) {
    connection = repository
      .listConnectors(userId)
      .find((candidate) => candidate.provider === FORTUNEO_PROVIDER);
  }
  if (!connection) {
    return repository.createConnector(userId, {
      provider: FORTUNEO_PROVIDER,
      label: definition.connectionLabel,
      status: "active",
      aspspName: definition.label,
      aspspCountry: "FR",
      psuType: "personal",
      metadata: {
        type: "sidecar",
        bankKey: "fortuneo",
        createdAt: nowIso(),
      },
    });
  }
  return repository.updateConnector(connection.id, userId, {
    status: "active",
    lastError: null,
    metadata: {
      ...cleanConnectionMetadata(connection.metadata),
      type: "sidecar",
      bankKey: "fortuneo",
    },
  });
};

const parseSidecarError = (stderr) => {
  const source = String(stderr || "").trim();
  for (
    let index = source.lastIndexOf("{");
    index >= 0;
    index = source.lastIndexOf("{", index - 1)
  ) {
    try {
      const parsed = JSON.parse(source.slice(index));
      if (parsed?.error) return parsed.error;
    } catch {
      // Essaie l'accolade précédente : les logs peuvent précéder le JSON.
    }
  }
  return null;
};

const errorStatusForCode = (code) => {
  if (code === "OTP_REQUIRED" || code === "ACTION_REQUIRED") return 428;
  if (code === "OTP_CANCELLED") return 409;
  if (code === "ACCOUNT_LOCKED") return 423;
  if (code === "PASSWORD_REQUIRED" || code === "CREDENTIALS_MISSING") {
    return 400;
  }
  if (code === "AUTH_FAILED" || code === "UNSUPPORTED_AUTH") return 401;
  return 502;
};

const readOtpRequestFile = (directory) => {
  if (!directory) return null;
  const requestPath = path.join(directory, "otp-request.json");
  let raw;
  try {
    raw = fs.readFileSync(requestPath, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.schema !== OTP_REQUEST_SCHEMA || !parsed.id) {
    return null;
  }
  return {
    id: String(parsed.id),
    kind: String(parsed.kind || "sms"),
    label: String(parsed.label || "Entrez le code reçu par SMS").slice(0, 200),
    codeRequired: parsed.codeRequired !== false,
  };
};

const writeOtpResponseFile = (directory, payload) => {
  const target = path.join(directory, "otp-response.json");
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw fortuneoError("Fichier de réponse OTP non sûr.", {
      status: 400,
      code: "UNSAFE_OTP_FILE",
    });
  }
  const temporary = path.join(directory, `.otp-response-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(payload), {
      mode: 0o600,
      flag: "wx",
    });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Nettoyage best-effort.
    }
    throw error;
  }
};

const publicOtpChallenge = (challenge) => {
  if (!challenge) return null;
  return {
    kind: challenge.kind,
    label: challenge.label,
    codeRequired: challenge.codeRequired,
  };
};

const fortuneoJobs = new Map();
const activeFortuneoJobsByUser = new Map();

const pruneJobs = () => {
  const now = Date.now();
  for (const [id, job] of fortuneoJobs.entries()) {
    if (job.status === "running") continue;
    const updated = new Date(job.updatedAt || job.createdAt).getTime();
    if (Number.isFinite(updated) && now - updated > FORTUNEO_JOB_TTL_MS) {
      fortuneoJobs.delete(id);
    }
  }
};

const executeFortuneoJob = async ({
  job,
  repository,
  userId,
  connection,
  login,
  password,
  since,
}) => {
  const runId = repository.startSyncRun(
    userId,
    connection.id,
    FORTUNEO_PROVIDER,
  );
  let runFinished = false;
  let secret = password;
  try {
    const cliPath = resolveFortuneoCliPath();
    // Le broker garde la même session Woob ouverte entre la demande SMS et la
    // soumission du code : le code saisi correspond donc à ce SMS précis.
    const args = [
      "export",
      "--password-stdin",
      "--no-interactive",
      "--otp-broker-dir",
      job.dir,
      "--otp-timeout",
      String(FORTUNEO_OTP_TIMEOUT_SECONDS),
    ];
    if (since) args.push("--since", since);

    const home = path.join(job.dir, "home");
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const env = buildSidecarEnv({
      extraEnv: { FORTUNEO_LOGIN: login },
      home,
    });

    const result = await runSidecarProcess({
      command: cliPath,
      args,
      env,
      input: `${secret}\n`,
      timeoutMs: FORTUNEO_TIMEOUT_MS,
      redact: [secret, login],
      onSpawn: (child) => {
        job.child = child;
      },
    });
    secret = "";
    job.child = null;

    if (result.code !== 0) {
      const parsed = parseSidecarError(result.stderr);
      throw fortuneoError(
        redactSecrets(
          parsed?.message ||
            redactSecrets(result.stderr, [login]).trim() ||
            `fortuneo-sidecar exit ${result.code}`,
          [password, login],
        ),
        {
          status: errorStatusForCode(parsed?.code),
          code: parsed?.code || "FORTUNEO_SIDECAR_ERROR",
          details: parsed?.details || null,
        },
      );
    }

    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      throw fortuneoError(
        "Sortie JSON invalide du sidecar Fortuneo (export interrompu ou illisible).",
        { status: 502, code: "FORTUNEO_INVALID_OUTPUT" },
      );
    }

    const summary = applyFortuneoExport({
      repository,
      userId,
      connection,
      payload,
      runId,
    });
    runFinished = true;
    job.status = "success";
    job.result = summary;
    job.error = null;
    job.code = null;
  } catch (error) {
    if (!runFinished) {
      repository.finishSyncRun(runId, {
        status: "error",
        error: error.message,
      });
    }
    repository.updateConnector(connection.id, userId, {
      status: "error",
      lastError: error.message,
    });
    job.status = "error";
    job.code = job.cancelled ? "CANCELLED" : error.code || "FORTUNEO_SYNC_ERROR";
    job.error = job.cancelled
      ? "Synchronisation Fortuneo annulée."
      : error.message;
  } finally {
    secret = "";
    job.child = null;
    job.updatedAt = nowIso();
    activeFortuneoJobsByUser.delete(userId);
    removePrivateDir(job.dir);
    job.dir = null;
    const timer = setTimeout(() => fortuneoJobs.delete(job.id), FORTUNEO_JOB_TTL_MS);
    timer.unref?.();
  }
};

/**
 * Démarre une synchronisation Fortuneo en tâche de fond.
 * Retourne immédiatement un identifiant de job : le challenge SMS est récupéré
 * par polling puis le code est soumis sans relancer de nouvelle session.
 */
export const startFortuneoSidecarSync = ({
  repository,
  userId,
  login = null,
  password = null,
  connectionId = null,
  saveLogin = true,
  since = null,
}) => {
  if (!userId) {
    throw fortuneoError("Profil requis pour la synchronisation Fortuneo.", {
      status: 400,
      code: "USER_REQUIRED",
    });
  }
  pruneJobs();

  const saved = getFortuneoSavedCredentials(repository, userId);
  const resolvedLogin = String(login || saved?.login || "").trim() || null;
  if (!resolvedLogin) {
    throw fortuneoError("Identifiant Fortuneo requis.", {
      status: 400,
      code: "LOGIN_REQUIRED",
    });
  }
  const secret = String(password || "").trim();
  if (!secret) {
    throw fortuneoError(
      "Mot de passe Fortuneo requis pour chaque synchronisation (il n'est jamais enregistré).",
      { status: 400, code: "PASSWORD_REQUIRED" },
    );
  }
  const sinceValue =
    since == null || since === "" ? null : String(since).trim();
  if (sinceValue && !SINCE_RE.test(sinceValue)) {
    throw fortuneoError(
      "La date de début Fortuneo doit être au format YYYY-MM-DD.",
      { status: 400, code: "INVALID_SINCE" },
    );
  }

  if (saveLogin && login) {
    saveFortuneoLogin(repository, userId, resolvedLogin);
  }

  if (activeFortuneoJobsByUser.has(userId)) {
    throw fortuneoError(
      "Une synchronisation Fortuneo est déjà en cours pour ce profil. Terminez-la ou annulez-la avant de réessayer.",
      { status: 409, code: "JOB_ALREADY_RUNNING" },
    );
  }

  const connection = ensureFortuneoConnection({
    repository,
    userId,
    connectionId,
  });
  const job = {
    id: randomUUID(),
    userId,
    connectionId: connection.id,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    dir: createPrivateTempDir("portfolio-fortuneo-otp-"),
    child: null,
    result: null,
    error: null,
    code: null,
    cancelled: false,
  };
  fortuneoJobs.set(job.id, job);
  activeFortuneoJobsByUser.set(userId, job.id);

  void executeFortuneoJob({
    job,
    repository,
    userId,
    connection,
    login: resolvedLogin,
    password: secret,
    since: sinceValue,
  }).catch((error) => {
    // Filet de sécurité : executeFortuneoJob gère déjà ses erreurs, mais une
    // erreur inattendue ne doit jamais laisser le job bloqué en "running".
    job.status = "error";
    job.code = job.code || "FORTUNEO_SYNC_ERROR";
    job.error = job.error || error.message;
    job.updatedAt = nowIso();
    activeFortuneoJobsByUser.delete(userId);
    removePrivateDir(job.dir);
    job.dir = null;
    console.warn("⚠️ Synchronisation Fortuneo interrompue:", error.message);
  });

  return { jobId: job.id, status: "PENDING" };
};

export const getFortuneoJob = (userId, jobId) => {
  pruneJobs();
  const job = fortuneoJobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) return null;
  const challenge =
    job.status === "running" && job.dir
      ? readOtpRequestFile(job.dir)
      : null;
  return {
    id: job.id,
    status: challenge ? "otp_required" : job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    challenge: publicOtpChallenge(challenge),
    result: job.result,
    error: job.error,
    code: job.code,
  };
};

export const submitFortuneoOtp = (userId, jobId, payload = {}) => {
  const job = fortuneoJobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) {
    throw fortuneoError("Tâche de synchronisation Fortuneo introuvable.", {
      status: 404,
      code: "JOB_NOT_FOUND",
    });
  }
  if (job.status !== "running" || !job.dir) {
    throw fortuneoError(
      "La synchronisation Fortuneo n'attend plus de code SMS.",
      { status: 409, code: "JOB_NOT_RUNNING" },
    );
  }
  const challenge = readOtpRequestFile(job.dir);
  if (!challenge) {
    throw fortuneoError("Aucune demande de code SMS Fortuneo en attente.", {
      status: 409,
      code: "OTP_NOT_REQUESTED",
    });
  }

  if (payload.cancel) {
    writeOtpResponseFile(job.dir, {
      schema: OTP_RESPONSE_SCHEMA,
      id: challenge.id,
      cancel: true,
    });
    job.cancelled = true;
    return { accepted: true, cancelled: true, jobId: job.id };
  }

  const code = String(payload.code || "").trim();
  if (!/^[0-9]{4,8}$/.test(code)) {
    throw fortuneoError(
      "Le code de validation Fortuneo doit contenir 4 à 8 chiffres.",
      { status: 400, code: "INVALID_OTP_CODE" },
    );
  }
  writeOtpResponseFile(job.dir, {
    schema: OTP_RESPONSE_SCHEMA,
    id: challenge.id,
    code,
  });
  return { accepted: true, jobId: job.id };
};

export const cancelFortuneoJob = (userId, jobId) => {
  const job = fortuneoJobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) {
    throw fortuneoError("Tâche de synchronisation Fortuneo introuvable.", {
      status: 404,
      code: "JOB_NOT_FOUND",
    });
  }
  if (job.status !== "running") {
    return { cancelled: false, status: job.status };
  }
  job.cancelled = true;
  try {
    const challenge = job.dir ? readOtpRequestFile(job.dir) : null;
    if (challenge) {
      writeOtpResponseFile(job.dir, {
        schema: OTP_RESPONSE_SCHEMA,
        id: challenge.id,
        cancel: true,
      });
    }
  } catch {
    // La tâche sera tuée ci-dessous.
  }
  const child = job.child;
  const timer = setTimeout(() => {
    try {
      child?.kill("SIGKILL");
    } catch {
      // Processus déjà terminé.
    }
  }, 500);
  timer.unref?.();
  return { cancelled: true, status: job.status };
};

export const resetFortuneoJobsForTests = () => {
  for (const job of fortuneoJobs.values()) {
    try {
      job.child?.kill("SIGKILL");
    } catch {
      // Ignore.
    }
    removePrivateDir(job.dir);
  }
  fortuneoJobs.clear();
  activeFortuneoJobsByUser.clear();
};
