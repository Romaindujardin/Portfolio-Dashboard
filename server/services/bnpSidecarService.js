// Service d'intégration du sidecar BNP Paribas (bnp-cli / bnp-direct).
//
// Le code secret BNP n'est jamais stocké : il est transmis une fois sur stdin
// au CLI et n'apparaît ni dans argv, ni dans l'environnement, ni dans les
// journaux. La validation forte utilise un broker de fichiers privés (0700 /
// 0600) exposé par les routes /sidecar/bnp/jobs.

import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { PROVIDERS } from "../connectors/types.js";
import { nowIso } from "../lib/validate.js";
import {
  deleteUserSecret,
  getUserSecret,
  setUserSecret,
} from "./userSecretsService.js";
import {
  SIDECAR_BANKS,
  markSidecarPriority,
} from "./sidecarPriority.js";
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
  nullableNumber,
} from "./sidecarFormat.js";

export const BNP_PROVIDER = PROVIDERS.BNP_SIDECAR || "bnp-sidecar";
const BNP_CUSTOMER_ID_KEY = "bnpCustomerId";
const BNP_LEGACY_PASSWORD_KEY = "bnpPassword";
const CUSTOMER_ID_RE = /^[0-9]{7,10}$/;
const PASSWORD_RE = /^[0-9]{6}$/;
const SINCE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MFA_REQUEST_SCHEMA = "bnp-sidecar/mfa-request/v1";
const MFA_RESPONSE_SCHEMA = "bnp-sidecar/mfa-response/v1";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(MODULE_DIR, "../..");
const WORKSPACE_DIR = path.resolve(PROJECT_DIR, "..");

const positiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const BNP_MFA_TIMEOUT_SECONDS = Math.min(
  Math.max(positiveNumber(process.env.BNP_MFA_TIMEOUT_SECONDS, 180), 10),
  900,
);
const BNP_TIMEOUT_MS = Math.max(
  positiveNumber(
    process.env.BNP_TIMEOUT_MS,
    (BNP_MFA_TIMEOUT_SECONDS + 120) * 1000,
  ),
  30_000,
);
const BNP_JOB_TTL_MS = 15 * 60 * 1000;

const bnpError = (
  message,
  { status = 502, code = "BNP_SIDECAR_ERROR", details = null } = {},
) => {
  const error = new Error(message);
  error.name = "BnpSidecarError";
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
};

export const resolveBnpCliPath = () => {
  const candidates = [
    process.env.BNP_CLI_PATH,
    process.env.BNP_DIRECT_PATH,
    path.join(WORKSPACE_DIR, "bnp-cli/.venv/bin/bnp-direct"),
    path.join(WORKSPACE_DIR, "bnp-sidecar/.venv/bin/bnp-direct"),
    path.join(os.homedir(), ".local/bin/bnp-direct"),
    findOnPath("bnp-direct"),
  ];
  return resolveExecutable(candidates, "bnp-direct", "BNP_CLI_PATH");
};

export const isBnpCliAvailable = () => {
  try {
    resolveBnpCliPath();
    return true;
  } catch {
    return false;
  }
};

export const getBnpSavedCredentials = (repository, userId) => {
  if (!userId) return null;
  const customerId = getUserSecret(
    repository.db,
    userId,
    BNP_CUSTOMER_ID_KEY,
  );
  if (!customerId) return null;
  return { customerId };
};

export const saveBnpCustomerId = (repository, userId, customerId) => {
  if (!userId) throw bnpError("Profil requis pour le numéro client BNP.", {
    status: 400,
    code: "USER_REQUIRED",
  });
  const value = String(customerId || "").trim();
  if (!CUSTOMER_ID_RE.test(value)) {
    throw bnpError(
      "Le numéro client BNP doit contenir 7 à 10 chiffres.",
      { status: 400, code: "INVALID_CUSTOMER_ID" },
    );
  }
  setUserSecret(repository.db, userId, BNP_CUSTOMER_ID_KEY, value);
  return value;
};

export const deleteBnpCredentials = (repository, userId) => {
  if (!userId) return false;
  const customerDeleted = deleteUserSecret(
    repository.db,
    userId,
    BNP_CUSTOMER_ID_KEY,
  );
  const legacyPasswordDeleted = deleteUserSecret(
    repository.db,
    userId,
    BNP_LEGACY_PASSWORD_KEY,
  );
  return customerDeleted || legacyPasswordDeleted;
};

export const getBnpStatus = (repository, userId) => {
  const saved = getBnpSavedCredentials(repository, userId);
  return {
    available: isBnpCliAvailable(),
    configured: Boolean(saved?.customerId),
    customerIdSaved: Boolean(saved?.customerId),
    passwordRequired: true,
    mfa: "file-broker",
  };
};

export const mapBnpAccountType = (account = {}) => {
  const kind = String(account.kind || account.type || "").toLowerCase();
  const label = `${account.name || ""} ${account.product || ""}`.toUpperCase();
  if (kind === "loan") return "LOAN";
  if (kind === "trading" || kind === "securities") {
    return label.includes("PEA") ? "PEA" : "SECURITIES";
  }
  if (kind === "insurance" || kind === "life_insurance") {
    return "SECURITIES";
  }
  if (kind === "savings" || kind === "deposit") {
    return label.includes("PEA") ? "PEA" : "SAVINGS";
  }
  if (kind === "banking" || kind === "checking") return "CHECKING";
  if (label.includes("PEA")) return "PEA";
  if (
    label.includes("LIVRET") ||
    label.includes("LDDS") ||
    label.includes("EPARGNE") ||
    label.includes("ÉPARGNE") ||
    label.includes("CSL")
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

export const mapBnpTransaction = (transaction = {}, accountKey = "bnp") => {
  const date =
    isoDate(transaction.bookingDate) ||
    isoDate(transaction.transactionDate) ||
    isoDate(transaction.valueDate) ||
    null;
  const externalId =
    transaction.id ||
    transaction.entryReference ||
    transaction.transactionId ||
    null;
  const label =
    decodeHtmlEntities(transaction.description) ||
    (Array.isArray(transaction.descriptionLines)
      ? decodeHtmlEntities(transaction.descriptionLines.join(" "))
      : "") ||
    "Transaction BNP";
  const amount = finiteNumber(transaction.amount, 0);
  const dedupKey =
    transaction.dedupKey ||
    (externalId
      ? `bnp:${accountKey}:${externalId}`
      : `bnp:${accountKey}:${date}:${amount}:${label}`);
  const counterparty =
    typeof transaction.counterparty === "string"
      ? transaction.counterparty
      : transaction.counterparty?.name || null;

  return {
    externalId,
    dedupKey,
    date,
    valueDate: isoDate(transaction.valueDate),
    amount,
    currency: transaction.currency || "EUR",
    label,
    counterparty,
    category: transaction.category || null,
    pending: String(transaction.status || "").toUpperCase() === "PDNG",
  };
};

/**
 * Applique un export bnp-sidecar/export/v1 au portefeuille.
 * Les transactions de tous les comptes (courants, épargne, titres) sont
 * importées, pas seulement celles du compte courant.
 */
export const applyBnpExport = ({
  repository,
  userId,
  connection,
  payload,
  runId = null,
}) => {
  if (!payload || !Array.isArray(payload.accounts)) {
    throw bnpError("Export BNP invalide : liste de comptes absente.", {
      status: 502,
      code: "BNP_INVALID_PAYLOAD",
    });
  }
  if (payload.schema && payload.schema !== "bnp-sidecar/export/v1") {
    throw bnpError(`Schéma d'export BNP non pris en charge : ${payload.schema}`, {
      status: 502,
      code: "BNP_INVALID_SCHEMA",
    });
  }
  if (payload.accounts.length === 0) {
    throw bnpError("Aucun compte BNP détecté dans l'export.", {
      status: 502,
      code: "BNP_NO_ACCOUNTS",
    });
  }

  let accountsSynced = 0;
  let transactionsImported = 0;
  const errors = [];

  for (const rawAccount of payload.accounts) {
    try {
      const accountKey = String(rawAccount.uid || rawAccount.externalId || "");
      if (!accountKey) {
        throw new Error("Compte BNP sans identifiant.");
      }
      const externalId =
        rawAccount.externalId || `bnp_${String(rawAccount.uid)}`;
      const account = repository.upsertSyncedAccount(userId, {
        provider: BNP_PROVIDER,
        externalId,
        connectionId: connection.id,
        name:
          decodeHtmlEntities(rawAccount.name) ||
          decodeHtmlEntities(rawAccount.product) ||
          "Compte BNP",
        type: mapBnpAccountType(rawAccount),
        currency: rawAccount.currency || "EUR",
        balance: finiteNumber(rawAccount.balance, 0),
        availableBalance: nullableNumber(rawAccount.availableBalance),
        iban: rawAccount.iban || null,
        lastSyncAt: nowIso(),
        metadata: {
          bnpKey: rawAccount.uid || null,
          product: rawAccount.product || null,
          kind: rawAccount.kind || null,
          maskedNumber: rawAccount.maskedNumber || null,
          balanceDate: rawAccount.balanceDate || null,
          bankName: "BNP Paribas",
          sidecar: BNP_PROVIDER,
        },
      });
      accountsSynced += 1;

      const transactions = Array.isArray(rawAccount.transactions)
        ? rawAccount.transactions
        : [];
      const items = transactions
        .map((transaction) => mapBnpTransaction(transaction, accountKey))
        .filter((item) => Boolean(item.date));
      if (items.length > 0) {
        transactionsImported += repository.insertTransactions(
          userId,
          account.id,
          BNP_PROVIDER,
          items,
        );
        repository.cleanAuthorizationDuplicates(account.id, userId);
      }
      if (rawAccount.transactionsTruncated) {
        errors.push({
          account: account.name,
          error:
            "Historique des opérations incomplet pour ce compte (export BNP tronqué).",
          code: "TRANSACTIONS_TRUNCATED",
        });
      }
    } catch (error) {
      errors.push({
        account:
          decodeHtmlEntities(rawAccount.name) ||
          String(rawAccount.uid || "compte BNP"),
        error: error.message,
      });
    }
  }

  for (const entry of Array.isArray(payload.errors) ? payload.errors : []) {
    errors.push({
      account: String(entry.account || entry.accountId || "BNP"),
      error: entry.message || entry.code || "Erreur BNP",
      code: entry.code || undefined,
    });
  }

  const archived =
    accountsSynced > 0
      ? markSidecarPriority({
          repository,
          userId,
          bankKey: "bnp",
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
        ? `${errors.length} anomalie(s) BNP : ${errors[0].error}`
        : null,
    metadata: {
      ...(connection.metadata || {}),
      type: "sidecar",
      bankKey: "bnp",
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
    holdingsSynced: 0,
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

const ensureBnpConnection = ({ repository, userId, connectionId }) => {
  const definition = SIDECAR_BANKS.bnp;
  let connection = connectionId
    ? repository.getConnector(connectionId, userId)
    : null;
  if (connection && connection.provider !== BNP_PROVIDER) connection = null;
  if (!connection) {
    connection = repository
      .listConnectors(userId)
      .find((candidate) => candidate.provider === BNP_PROVIDER);
  }
  if (!connection) {
    return repository.createConnector(userId, {
      provider: BNP_PROVIDER,
      label: definition.connectionLabel,
      status: "active",
      aspspName: definition.label,
      aspspCountry: "FR",
      psuType: "personal",
      metadata: {
        type: "sidecar",
        bankKey: "bnp",
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
      bankKey: "bnp",
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

const readMfaRequestFile = (directory) => {
  if (!directory) return null;
  const requestPath = path.join(directory, "mfa-request.json");
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
  if (!parsed || parsed.schema !== MFA_REQUEST_SCHEMA || !parsed.id) {
    return null;
  }
  const page =
    parsed.page && typeof parsed.page === "object" ? parsed.page : {};
  return {
    id: String(parsed.id),
    kind: String(parsed.kind || "unknown"),
    page: {
      host: String(page.host || ""),
      path: String(page.path || ""),
      queryKeys: Array.isArray(page.queryKeys)
        ? page.queryKeys.map(String)
        : [],
    },
    codeRequired: Boolean(parsed.codeRequired),
    actions: Array.isArray(parsed.actions)
      ? parsed.actions
          .filter((action) => Number.isInteger(action?.index))
          .map((action) => ({
            index: action.index,
            label: String(action.label || "").slice(0, 200),
            kind: String(action.kind || ""),
          }))
      : [],
  };
};

const writeMfaResponseFile = (directory, payload) => {
  const target = path.join(directory, "mfa-response.json");
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw bnpError("Fichier de réponse MFA non sûr.", {
      status: 400,
      code: "UNSAFE_MFA_FILE",
    });
  }
  const temporary = path.join(directory, `.mfa-response-${randomUUID()}.tmp`);
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

const publicMfaChallenge = (challenge) => {
  if (!challenge) return null;
  return {
    kind: challenge.kind,
    page: challenge.page,
    codeRequired: challenge.codeRequired,
    actions: challenge.actions,
  };
};

const bnpJobs = new Map();
const activeJobsByUser = new Map();

const pruneJobs = () => {
  const now = Date.now();
  for (const [id, job] of bnpJobs.entries()) {
    if (job.status === "running") continue;
    const updated = new Date(job.updatedAt || job.createdAt).getTime();
    if (Number.isFinite(updated) && now - updated > BNP_JOB_TTL_MS) {
      bnpJobs.delete(id);
    }
  }
};

const executeBnpJob = async ({
  job,
  repository,
  userId,
  connection,
  customerId,
  password,
  since,
}) => {
  const runId = repository.startSyncRun(userId, connection.id, BNP_PROVIDER);
  let runFinished = false;
  let secret = password;
  try {
    const cliPath = resolveBnpCliPath();
    const args = [
      "export",
      "--password-stdin",
      "--mfa-dir",
      job.dir,
      "--mfa-timeout",
      String(BNP_MFA_TIMEOUT_SECONDS),
    ];
    if (since) args.push("--since", since);

    const home = path.join(job.dir, "home");
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const env = buildSidecarEnv({
      extraEnv: { BNP_CUSTOMER_ID: customerId },
      home,
    });

    const result = await runSidecarProcess({
      command: cliPath,
      args,
      env,
      input: `${secret}\n`,
      timeoutMs: BNP_TIMEOUT_MS,
      redact: [secret, customerId],
      onSpawn: (child) => {
        job.child = child;
      },
    });
    secret = "";
    job.child = null;

    if (result.code !== 0) {
      const parsed = parseSidecarError(result.stderr);
      throw bnpError(
        redactSecrets(
          parsed?.message ||
            redactSecrets(result.stderr, [customerId]).trim() ||
            `bnp-direct exit ${result.code}`,
          [password, customerId],
        ),
        {
          status: parsed?.code === "AUTH_FAILED" ? 401 : 502,
          code: parsed?.code || "BNP_SIDECAR_ERROR",
          details: parsed?.details || null,
        },
      );
    }

    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      throw bnpError(
        "Sortie JSON invalide du sidecar BNP (export interrompu ou illisible).",
        { status: 502, code: "BNP_INVALID_OUTPUT" },
      );
    }

    const summary = applyBnpExport({
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
    job.code = job.cancelled ? "CANCELLED" : error.code || "BNP_SYNC_ERROR";
    job.error = job.cancelled ? "Synchronisation BNP annulée." : error.message;
  } finally {
    secret = "";
    job.child = null;
    job.updatedAt = nowIso();
    activeJobsByUser.delete(userId);
    removePrivateDir(job.dir);
    job.dir = null;
    const timer = setTimeout(() => bnpJobs.delete(job.id), BNP_JOB_TTL_MS);
    timer.unref?.();
  }
};

/**
 * Démarre une synchronisation BNP en tâche de fond.
 * Retourne immédiatement un identifiant de job : la validation forte est
 * récupérée par polling puis soumise via `submitBnpMfa`.
 */
export const startBnpSidecarSync = ({
  repository,
  userId,
  customerId = null,
  password = null,
  connectionId = null,
  saveCustomerId = true,
  since = null,
}) => {
  if (!userId) {
    throw bnpError("Profil requis pour la synchronisation BNP.", {
      status: 400,
      code: "USER_REQUIRED",
    });
  }
  pruneJobs();

  const saved = getBnpSavedCredentials(repository, userId);
  const resolvedCustomerId = String(customerId || saved?.customerId || "").trim();
  if (!resolvedCustomerId) {
    throw bnpError(
      "Numéro client BNP requis (7 à 10 chiffres).",
      { status: 400, code: "CUSTOMER_ID_REQUIRED" },
    );
  }
  if (!CUSTOMER_ID_RE.test(resolvedCustomerId)) {
    throw bnpError(
      "Le numéro client BNP doit contenir 7 à 10 chiffres.",
      { status: 400, code: "INVALID_CUSTOMER_ID" },
    );
  }

  const secret = String(password || "").trim();
  if (!secret) {
    throw bnpError(
      "Code secret BNP requis pour chaque synchronisation (il n'est jamais enregistré).",
      { status: 400, code: "PASSWORD_REQUIRED" },
    );
  }
  if (!PASSWORD_RE.test(secret)) {
    throw bnpError("Le code secret BNP doit contenir exactement 6 chiffres.", {
      status: 400,
      code: "INVALID_PASSWORD",
    });
  }

  if (saveCustomerId && customerId) {
    saveBnpCustomerId(repository, userId, resolvedCustomerId);
  }

  const sinceValue = since == null || since === "" ? null : String(since).trim();
  if (sinceValue && !SINCE_RE.test(sinceValue)) {
    throw bnpError("La date de début BNP doit être au format YYYY-MM-DD.", {
      status: 400,
      code: "INVALID_SINCE",
    });
  }

  if (activeJobsByUser.has(userId)) {
    throw bnpError(
      "Une synchronisation BNP est déjà en cours pour ce profil. Terminez-la ou annulez-la avant de réessayer.",
      { status: 409, code: "JOB_ALREADY_RUNNING" },
    );
  }

  const connection = ensureBnpConnection({ repository, userId, connectionId });
  const job = {
    id: randomUUID(),
    userId,
    connectionId: connection.id,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    dir: createPrivateTempDir("portfolio-bnp-mfa-"),
    child: null,
    result: null,
    error: null,
    code: null,
    cancelled: false,
  };
  bnpJobs.set(job.id, job);
  activeJobsByUser.set(userId, job.id);

  void executeBnpJob({
    job,
    repository,
    userId,
    connection,
    customerId: resolvedCustomerId,
    password: secret,
    since: sinceValue,
  }).catch((error) => {
    // Filet de sécurité : executeBnpJob gère déjà ses erreurs, mais une erreur
    // inattendue ne doit jamais laisser le job bloqué en "running".
    job.status = "error";
    job.code = job.code || "BNP_SYNC_ERROR";
    job.error = job.error || error.message;
    job.updatedAt = nowIso();
    activeJobsByUser.delete(userId);
    removePrivateDir(job.dir);
    job.dir = null;
    console.warn("⚠️ Synchronisation BNP interrompue:", error.message);
  });

  return { jobId: job.id, status: "PENDING" };
};

export const getBnpJob = (userId, jobId) => {
  pruneJobs();
  const job = bnpJobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) return null;
  const challenge =
    job.status === "running" && job.dir
      ? readMfaRequestFile(job.dir)
      : null;
  return {
    id: job.id,
    status: challenge ? "mfa_required" : job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    challenge: publicMfaChallenge(challenge),
    result: job.result,
    error: job.error,
    code: job.code,
  };
};

export const submitBnpMfa = (userId, jobId, payload = {}) => {
  const job = bnpJobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) {
    throw bnpError("Tâche de synchronisation BNP introuvable.", {
      status: 404,
      code: "JOB_NOT_FOUND",
    });
  }
  if (job.status !== "running" || !job.dir) {
    throw bnpError("La synchronisation BNP n'attend plus de validation.", {
      status: 409,
      code: "JOB_NOT_RUNNING",
    });
  }
  const challenge = readMfaRequestFile(job.dir);
  if (!challenge) {
    throw bnpError("Aucune demande de validation BNP en attente.", {
      status: 409,
      code: "MFA_NOT_REQUESTED",
    });
  }

  if (payload.cancel) {
    writeMfaResponseFile(job.dir, {
      schema: MFA_RESPONSE_SCHEMA,
      id: challenge.id,
      cancel: true,
    });
    job.cancelled = true;
    return { accepted: true, cancelled: true, jobId: job.id };
  }

  if (payload.code != null) {
    const code = String(payload.code).trim();
    if (!/^[0-9]{4,10}$/.test(code)) {
      throw bnpError(
        "Le code de validation BNP doit contenir 4 à 10 chiffres.",
        { status: 400, code: "INVALID_MFA_CODE" },
      );
    }
    writeMfaResponseFile(job.dir, {
      schema: MFA_RESPONSE_SCHEMA,
      id: challenge.id,
      code,
    });
    return { accepted: true, jobId: job.id };
  }

  if (Number.isInteger(payload.action)) {
    if (
      payload.action < 0 ||
      payload.action >= challenge.actions.length
    ) {
      throw bnpError("Action de validation BNP introuvable.", {
        status: 400,
        code: "INVALID_MFA_ACTION",
      });
    }
    writeMfaResponseFile(job.dir, {
      schema: MFA_RESPONSE_SCHEMA,
      id: challenge.id,
      action: payload.action,
    });
    return { accepted: true, jobId: job.id };
  }

  throw bnpError("Code ou action de validation BNP requis.", {
    status: 400,
    code: "MFA_RESPONSE_REQUIRED",
  });
};

export const cancelBnpJob = (userId, jobId) => {
  const job = bnpJobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) {
    throw bnpError("Tâche de synchronisation BNP introuvable.", {
      status: 404,
      code: "JOB_NOT_FOUND",
    });
  }
  if (job.status !== "running") {
    return { cancelled: false, status: job.status };
  }
  job.cancelled = true;
  try {
    const challenge = job.dir ? readMfaRequestFile(job.dir) : null;
    if (challenge) {
      writeMfaResponseFile(job.dir, {
        schema: MFA_RESPONSE_SCHEMA,
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

export const resetBnpJobsForTests = () => {
  for (const job of bnpJobs.values()) {
    try {
      job.child?.kill("SIGKILL");
    } catch {
      // Ignore.
    }
    removePrivateDir(job.dir);
  }
  bnpJobs.clear();
  activeJobsByUser.clear();
};
