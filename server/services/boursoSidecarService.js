// Service d'intégration du sidecar BoursoBank (bourso-cli).
// Permet d'extraire l'ensemble des comptes (Courants, Livrets, PEA, CTO, Assurance-Vie)
// ainsi que les positions de trading et l'historique complet des transactions
// sans les restrictions de la DSP2 (qui limite à 90 jours et exclut le PEA/CTO).

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { decryptJson } from "../lib/secrets.js";
import { nowIso, round2 } from "../lib/validate.js";
import { PROVIDERS } from "../connectors/types.js";
import { convertBoursoSymbolToYahoo } from "./marketData.js";
import {
  deleteUserSecret,
  getUserSecret,
  setUserSecret,
} from "./userSecretsService.js";

export const BOURSO_PROVIDER = PROVIDERS.BOURSO_SIDECAR || "bourso-sidecar";
const BOURSO_CUSTOMER_ID_KEY = "boursoCustomerId";
const BOURSO_PASSWORD_KEY = "boursoPassword";

export const resolveBoursoCliPath = () => {
  const candidates = [
    process.env.BOURSO_CLI_PATH,
    path.resolve(process.cwd(), "../bourso-api/target/release/bourso-cli"),
    path.resolve(process.cwd(), "../bourso-api/target/debug/bourso-cli"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
      } catch {
        throw new Error(
          `bourso-cli non exécutable: ${candidate}. Vérifiez les permissions (chmod +x).`,
        );
      }
      return candidate;
    }
  }

  throw new Error(
    "bourso-cli introuvable. Définissez BOURSO_CLI_PATH ou compilez bourso-api (cargo build --release).",
  );
};

export const isBoursoCliAvailable = () => {
  try {
    resolveBoursoCliPath();
    return true;
  } catch {
    return false;
  }
};

const createBoursoSandboxHome = (customerId, password) => {
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "bourso-home-"));
  const boursoDir = path.join(sandboxHome, ".bourso");
  fs.mkdirSync(boursoDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(boursoDir, "settings.json"),
    JSON.stringify({ clientId: customerId, password }, null, 2),
    { mode: 0o600 },
  );
  return sandboxHome;
};

const removeBoursoSandboxHome = (sandboxHome) => {
  try {
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  } catch (error) {
    console.warn("⚠️ Impossible de nettoyer le HOME temporaire bourso:", error);
  }
};

const BOURSO_TIMEOUT_MS =
  Number(process.env.BOURSO_TIMEOUT_MS) > 0
    ? Number(process.env.BOURSO_TIMEOUT_MS)
    : 120_000;
const BOURSO_MAX_OUTPUT_BYTES =
  Number(process.env.BOURSO_MAX_OUTPUT_BYTES) > 0
    ? Number(process.env.BOURSO_MAX_OUTPUT_BYTES)
    : 10 * 1024 * 1024;

const BOURSO_ENV_ALLOWLIST = new Set([
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "RUST_LOG",
  "RUST_BACKTRACE",
]);

// Le CLI ne doit pas hériter des secrets du serveur (clé de coffre, secret de
// session, mot de passe Basic, clés d'intégration…). On ne transmet que le
// strict nécessaire, plus les variables propres au CLI Bourso.
const buildBoursoEnv = (sandboxHome) => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      BOURSO_ENV_ALLOWLIST.has(key) ||
      key.startsWith("BOURSO_") ||
      key.startsWith("LC_")
    ) {
      env[key] = value;
    }
  }
  env.HOME = sandboxHome || process.env.HOME || os.tmpdir();
  return env;
};

export const runBoursoCli = ({ args, customerId, password }) => {
  const cliPath = resolveBoursoCliPath();
  const sandboxHome = password
    ? createBoursoSandboxHome(customerId, password)
    : null;

  const execCommand = () =>
    new Promise((resolve, reject) => {
      const child = spawn(cliPath, args, {
        cwd: process.cwd(),
        env: buildBoursoEnv(sandboxHome),
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let outputLimitReached = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, BOURSO_TIMEOUT_MS);
      timer.unref?.();

      const append = (current, chunk, stream) => {
        const bytes = Buffer.byteLength(chunk);
        const nextBytes =
          stream === "stdout" ? stdoutBytes + bytes : stderrBytes + bytes;
        if (stream === "stdout") stdoutBytes = nextBytes;
        else stderrBytes = nextBytes;
        if (nextBytes > BOURSO_MAX_OUTPUT_BYTES) {
          outputLimitReached = true;
          child.kill("SIGKILL");
          return current;
        }
        return current + chunk;
      };

      child.stdout.on("data", (data) => {
        stdout = append(stdout, data.toString(), "stdout");
      });
      child.stderr.on("data", (data) => {
        stderr = append(stderr, data.toString(), "stderr");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          return reject(
            new Error(`bourso-cli n'a pas répondu en ${BOURSO_TIMEOUT_MS} ms`),
          );
        }
        if (outputLimitReached) {
          return reject(
            new Error(
              `bourso-cli a dépassé la limite de ${BOURSO_MAX_OUTPUT_BYTES} octets`,
            ),
          );
        }
        if (code !== 0) {
          return reject(
            new Error(stderr || stdout || `bourso-cli exit ${code}`),
          );
        }
        return resolve({ stdout, stderr });
      });
    });

  return execCommand()
    .catch((error) => {
      let message = String(error?.message || error);
      if (password) message = message.split(password).join("***");
      if (customerId) message = message.split(customerId).join("***");
      throw new Error(message);
    })
    .finally(() => {
      if (sandboxHome) removeBoursoSandboxHome(sandboxHome);
    });
};

export const decodeHtmlEntities = (str) => {
  if (!str) return "";
  return String(str)
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
};

export const parseAccountsFromOutput = (stdout) => {
  const accounts = [];
  const matches = (stdout || "").matchAll(/Account\s*\{([\s\S]*?)\}/g);

  for (const match of matches) {
    const block = match[1];
    const idMatch = block.match(/id:\s*"([^"]+)"/);
    const nameMatch = block.match(/name:\s*"([^"]+)"/);
    const balanceMatch = block.match(/balance:\s*([0-9.-]+)/);
    const bankMatch = block.match(/bank_name:\s*"([^"]+)"/);
    const kindMatch = block.match(/kind:\s*([A-Za-z]+)/);
    if (!idMatch || !nameMatch || !balanceMatch || !bankMatch || !kindMatch) {
      continue;
    }

    const rawBalStr = balanceMatch[1];
    let balanceEuros = Number(rawBalStr) || 0;
    // In bourso-api, `Account.balance: isize` is an integer count of cents (centimes).
    // If output is an integer without decimal point, divide by 100 to convert to euros.
    if (!rawBalStr.includes(".")) {
      balanceEuros = round2(balanceEuros / 100);
    }

    accounts.push({
      id: idMatch[1],
      name: decodeHtmlEntities(nameMatch[1]),
      balance: balanceEuros,
      bankName: decodeHtmlEntities(bankMatch[1]),
      kind: kindMatch[1],
    });
  }

  return accounts;
};

const parseCsvLine = (line, delimiter) => {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out.map((v) => v.trim());
};

export const parseCsvText = (text) => {
  const cleaned = (text || "").replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], delimiter: ";" };

  const sample = lines[0];
  const delimiter = sample.includes(";") ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map(
    (h, idx) => h || `col_${idx}`,
  );
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows, delimiter };
};

export const extractCsvFromOutput = (stdout, headerStartsWith) => {
  const lines = (stdout || "").split(/\r?\n/);
  const idx = lines.findIndex((line) =>
    line.trim().startsWith(headerStartsWith),
  );
  if (idx === -1) {
    throw new Error(`CSV introuvable dans la sortie bourso-cli (en-tête attendu commençant par: ${headerStartsWith})`);
  }
  return lines.slice(idx).join("\n").trim();
};

export const getBoursoSavedCredentials = (repository, userId) => {
  if (!userId) return null;
  const customerId = getUserSecret(
    repository.db,
    userId,
    BOURSO_CUSTOMER_ID_KEY,
  );
  const password = getUserSecret(repository.db, userId, BOURSO_PASSWORD_KEY);
  if (!customerId || !password) return null;
  return { customerId, password };
};

export const saveBoursoCredentials = (
  repository,
  userId,
  { customerId, password },
) => {
  if (!userId) throw new Error("Profil requis pour les identifiants BoursoBank");
  if (!customerId || !password) {
    throw new Error("Identifiant client et mot de passe requis");
  }
  setUserSecret(repository.db, userId, BOURSO_CUSTOMER_ID_KEY, customerId);
  setUserSecret(repository.db, userId, BOURSO_PASSWORD_KEY, password);
};

export const deleteBoursoCredentials = (repository, userId) => {
  if (!userId) return false;
  const customerIdDeleted = deleteUserSecret(
    repository.db,
    userId,
    BOURSO_CUSTOMER_ID_KEY,
  );
  const passwordDeleted = deleteUserSecret(
    repository.db,
    userId,
    BOURSO_PASSWORD_KEY,
  );
  return customerIdDeleted || passwordDeleted;
};

export const getBoursoStatus = (repository, userId) => {
  const available = isBoursoCliAvailable();
  const creds = getBoursoSavedCredentials(repository, userId);
  return {
    available,
    configured: Boolean(creds?.customerId && creds?.password),
  };
};

/**
 * Migre les identifiants BoursoBank historiquement stockés dans
 * integration_settings (global) vers le coffre du profil propriétaire.
 * La migration n'est faite que si un seul profil possède une connexion
 * BoursoBank, pour ne jamais attribuer un mot de passe au mauvais profil.
 */
export const migrateLegacyBoursoCredentials = (db) => {
  try {
    const row = db
      .prepare(
        "SELECT encrypted_json FROM integration_settings WHERE provider = ?",
      )
      .get(BOURSO_PROVIDER);
    if (!row?.encrypted_json) return 0;

    let legacy = null;
    try {
      legacy = decryptJson(row.encrypted_json);
    } catch (error) {
      console.warn(
        `⚠️ Identifiants BoursoBank historiques illisibles: ${error.message}`,
      );
      return 0;
    }
    const customerId =
      typeof legacy?.customerId === "string" ? legacy.customerId.trim() : "";
    const password =
      typeof legacy?.password === "string" ? legacy.password.trim() : "";
    if (!customerId || !password) return 0;

    const owners = db
      .prepare(
        "SELECT DISTINCT user_id FROM connectors WHERE provider = ?",
      )
      .all(BOURSO_PROVIDER)
      .map((owner) => owner.user_id)
      .filter(Boolean);
    if (owners.length !== 1) {
      console.warn(
        "⚠️ Identifiants BoursoBank historiques non migrés : propriétaire ambigu.",
      );
      return 0;
    }

    const userId = owners[0];
    if (!getUserSecret(db, userId, BOURSO_CUSTOMER_ID_KEY)) {
      setUserSecret(db, userId, BOURSO_CUSTOMER_ID_KEY, customerId);
    }
    if (!getUserSecret(db, userId, BOURSO_PASSWORD_KEY)) {
      setUserSecret(db, userId, BOURSO_PASSWORD_KEY, password);
    }
    db.prepare("DELETE FROM integration_settings WHERE provider = ?").run(
      BOURSO_PROVIDER,
    );
    return 1;
  } catch (error) {
    console.warn(
      `⚠️ Migration des identifiants BoursoBank impossible: ${error.message}`,
    );
    return 0;
  }
};

/**
 * Retire les identifiants en clair des métadonnées de connexions BoursoBank.
 * Les valeurs encore présentes sont d'abord migrées vers le coffre du profil.
 */
export const sanitizeBoursoConnectorMetadata = (db) => {
  let sanitized = 0;
  try {
    const rows = db
      .prepare(
        "SELECT id, user_id, metadata_json FROM connectors WHERE provider = ?",
      )
      .all(BOURSO_PROVIDER);
    for (const row of rows) {
      let metadata;
      try {
        metadata = JSON.parse(row.metadata_json || "{}");
      } catch {
        continue;
      }
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        continue;
      }
      const hasCustomerId = Object.prototype.hasOwnProperty.call(
        metadata,
        "customerId",
      );
      const hasPassword = Object.prototype.hasOwnProperty.call(
        metadata,
        "password",
      );
      if (!hasCustomerId && !hasPassword) continue;
      const customerId =
        typeof metadata.customerId === "string"
          ? metadata.customerId.trim()
          : "";
      const password =
        typeof metadata.password === "string" ? metadata.password.trim() : "";

      if (row.user_id) {
        try {
          if (
            customerId &&
            !getUserSecret(db, row.user_id, BOURSO_CUSTOMER_ID_KEY)
          ) {
            setUserSecret(db, row.user_id, BOURSO_CUSTOMER_ID_KEY, customerId);
          }
          if (password && !getUserSecret(db, row.user_id, BOURSO_PASSWORD_KEY)) {
            setUserSecret(db, row.user_id, BOURSO_PASSWORD_KEY, password);
          }
        } catch (error) {
          console.warn(
            `⚠️ Migration des métadonnées BoursoBank impossible: ${error.message}`,
          );
        }
      }

      delete metadata.customerId;
      delete metadata.password;
      db.prepare(
        "UPDATE connectors SET metadata_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      ).run(JSON.stringify(metadata), nowIso(), row.id, row.user_id);
      sanitized += 1;
    }
  } catch (error) {
    console.warn(
      `⚠️ Nettoyage des métadonnées BoursoBank impossible: ${error.message}`,
    );
  }
  return sanitized;
};

/**
 * Synchronise les comptes BoursoBank via le sidecar CLI
 * - Extrait comptes bancaires, livrets, PEA, CTO, Assurance-Vie
 * - Met à jour les comptes dans la table `accounts` (provider: 'bourso-sidecar')
 * - Extrait les positions de titres pour les comptes de trading (PEA/CTO) et les enregistre dans `holdings`
 * - Extrait les transactions historiques complètes et les insère dans `transactions`
 */
export const syncBoursoSidecar = async ({
  repository,
  userId,
  customerId: directCustomerId = null,
  password: directPassword = null,
  pages = 10,
  connectionId = null,
  saveCredentials = false,
}) => {
  if (!userId) throw new Error("user_id requis pour la synchronisation");

  let customerId = directCustomerId;
  let password = directPassword;

  if (!customerId || !password) {
    const creds = getBoursoSavedCredentials(repository, userId);
    if (creds?.customerId && creds?.password) {
      customerId = creds.customerId;
      password = creds.password;
    }
  }

  if (!customerId || !password) {
    throw new Error(
      "Identifiant client et mot de passe BoursoBank requis (non configurés ou non fournis).",
    );
  }

  if (saveCredentials && directPassword) {
    saveBoursoCredentials(repository, userId, { customerId, password });
  }

  // Trouver ou créer la connexion dans la table `connections`
  let connection = connectionId
    ? repository.getConnector(connectionId, userId)
    : repository.listConnectors(userId).find((c) => c.provider === BOURSO_PROVIDER);

  if (!connection) {
    connection = repository.createConnector(userId, {
      provider: BOURSO_PROVIDER,
      label: "BoursoBank (Sidecar)",
      status: "active",
      aspspName: "BoursoBank",
      aspspCountry: "FR",
      psuType: "personal",
      metadata: {
        type: "sidecar",
        createdAt: nowIso(),
      },
    });
  } else {
    // L'identifiant client est un secret : il reste exclusivement dans le
    // coffre chiffré, jamais dans les métadonnées de la connexion.
    const metadata = { ...(connection.metadata || {}) };
    for (const key of [
      "customerId",
      "password",
      "credentialsEncrypted",
      "apiKey",
      "apiSecret",
      "privateKey",
    ]) {
      delete metadata[key];
    }
    repository.updateConnector(connection.id, userId, {
      status: "active",
      lastSyncAt: nowIso(),
      lastError: null,
      metadata,
    });
  }

  const runId = repository.startSyncRun(userId, connection.id, BOURSO_PROVIDER);
  let accountsSynced = 0;
  let transactionsImported = 0;
  let holdingsSynced = 0;
  const errors = [];

  try {
    // 1. Lister les comptes via bourso-cli accounts
    const { stdout: accStdout } = await runBoursoCli({
      args: ["accounts"],
      customerId,
      password,
    });

    const rawAccounts = parseAccountsFromOutput(accStdout);
    if (!rawAccounts.length) {
      throw new Error("Aucun compte détecté dans la sortie bourso-cli.");
    }

    for (const rawAcc of rawAccounts) {
      try {
        // Mappage du type de compte
        let accountType = "CHECKING";
        const kind = String(rawAcc.kind || "").toLowerCase();
        const nameUpper = String(rawAcc.name || "").toUpperCase();

        if (kind === "banking") {
          accountType = "CHECKING";
        } else if (kind === "savings" || kind === "saving") {
          accountType = "SAVINGS";
        } else if (kind === "trading") {
          if (nameUpper.includes("PEA")) {
            accountType = "PEA";
          } else {
            accountType = "SECURITIES";
          }
        } else if (kind === "loans" || kind === "loan") {
          accountType = "LOAN";
        } else {
          if (
            nameUpper.includes("LIVRET") ||
            nameUpper.includes("LDDS") ||
            nameUpper.includes("EPARGNE") ||
            nameUpper.includes("ÉPARGNE") ||
            nameUpper.includes("CSL")
          ) {
            accountType = "SAVINGS";
          } else if (nameUpper.includes("PEA")) {
            accountType = "PEA";
          } else if (
            nameUpper.includes("ASSURANCE") ||
            nameUpper.includes("VIE") ||
            nameUpper.includes("PER") ||
            nameUpper.includes("CTO") ||
            nameUpper.includes("TITRES")
          ) {
            accountType = "SECURITIES";
          } else {
            accountType = "CHECKING";
          }
        }

        const syncedAccount = repository.upsertSyncedAccount(userId, {
          provider: BOURSO_PROVIDER,
          externalId: `bourso-${rawAcc.id}`,
          connectionId: connection.id,
          name: decodeHtmlEntities(rawAcc.name),
          type: accountType,
          currency: "EUR",
          balance: rawAcc.balance,
          cashBalance: kind === "trading" ? rawAcc.balance : null,
          lastSyncAt: nowIso(),
          metadata: {
            boursoId: rawAcc.id,
            kind: rawAcc.kind,
            bankName: rawAcc.bankName,
          },
        });

        accountsSynced++;

        // 2. Si compte de trading (PEA / CTO) : extraire les positions
        if (kind === "trading") {
          try {
            const { stdout: posStdout } = await runBoursoCli({
              args: ["positions", "--account", rawAcc.id, "--format", "csv"],
              customerId,
              password,
            });
            const posCsv = extractCsvFromOutput(posStdout, "symbol,");
            const parsedPos = parseCsvText(posCsv);

            let totalHoldingsValue = 0;
            for (const row of parsedPos.rows) {
              const qty = Number(row.quantity) || 0;
              const lastPrice = Number(row.last) || 0;
              const buyingPrice = Number(row.buying_price) || 0;
              const amount = Number(row.amount) || qty * lastPrice;
              const costBasis = buyingPrice > 0 ? buyingPrice * qty : null;
              const rawSymbol = (row.symbol || "").trim();
              const yahooTicker = convertBoursoSymbolToYahoo(rawSymbol);

              repository.upsertHolding(userId, syncedAccount.id, {
                isin: /^[A-Z]{2}[A-Z0-9]{10}$/i.test(rawSymbol) ? rawSymbol.toUpperCase() : null,
                ticker: yahooTicker || rawSymbol || null,
                name: decodeHtmlEntities(row.label || row.symbol),
                quantity: qty,
                costBasis,
                price: lastPrice,
                value: amount,
                assetClass: "EQUITY",
              });
              holdingsSynced++;
              totalHoldingsValue += amount;
            }

            // Mettre à jour la poche liquidités (espèces) du PEA / compte titres
            if (holdingsSynced > 0) {
              const cashPart = Math.max(0, round2(rawAcc.balance - totalHoldingsValue));
              repository.updateAccount(syncedAccount.id, userId, {
                cashBalance: cashPart,
              });
            }
          } catch (posErr) {
            console.warn(`Positions non extraites pour le compte ${rawAcc.name}:`, posErr.message);
          }
        }

        // 3. Si compte bancaire (Courant) : extraire les transactions
        if (kind === "banking") {
          try {
            const { stdout: txStdout } = await runBoursoCli({
              args: [
                "transactions",
                "--account",
                rawAcc.id,
                "--pages",
                String(Math.min(Math.max(pages, 1), 50)),
                "--format",
                "csv",
              ],
              customerId,
              password,
            });
            const txCsv = extractCsvFromOutput(txStdout, "date,");
            const parsedTx = parseCsvText(txCsv);

            const items = parsedTx.rows.map((row) => {
              let dateOp = (row.date || row.date_op || "").trim();
              let dateVal = (row.value_date || row.valueDate || "").trim();
              const ref = (row.reference || "").trim();
              const label = decodeHtmlEntities(row.label || "");

              // 1. Extraire la date réelle encodée dans l'ObjectId MongoDB de BoursoBank
              let refIso = null;
              let refTimestamp = null;
              if (ref && /^[0-9a-f]{24}$/i.test(ref)) {
                refTimestamp = parseInt(ref.substring(0, 8), 16) * 1000;
                const refDate = new Date(refTimestamp);
                if (
                  !isNaN(refDate.getTime()) &&
                  refDate.getFullYear() >= 2010 &&
                  refDate.getFullYear() <= 2040
                ) {
                  refIso = refDate.toISOString().split("T")[0];
                }
              }

              // 2. Extraire la date de carte bancaire si présente dans le libellé
              let labelDateIso = null;
              const cardDateMatch = label.match(
                /(?:CARTE|Carte|Avoir|AVOIR|Retrait|RETRAIT)\s+(\d{2})\/(\d{2})\/(\d{2,4})/,
              );
              if (cardDateMatch) {
                const day = cardDateMatch[1];
                const month = cardDateMatch[2];
                let year = cardDateMatch[3];
                if (year.length === 2) year = `20${year}`;
                labelDateIso = `${year}-${month}-${day}`;
              }

              // 3. bourso-cli attribue par défaut la date du jour (chrono::Utc::now())
              // si l'en-tête de section n'a pas pu être lu.
              // Si la date opération est absente, ou si elle est égale à aujourd'hui alors que
              // l'opération date d'avant, ou si l'écart dépasse 30 jours, on utilise refIso.
              const todayIso = new Date().toISOString().split("T")[0];
              if (!dateOp || (dateOp === todayIso && refIso && refIso !== todayIso)) {
                if (refIso) {
                  dateOp = refIso;
                } else if (labelDateIso) {
                  dateOp = labelDateIso;
                }
              } else if (refIso && refTimestamp) {
                const opTimestamp = new Date(dateOp).getTime();
                const diffDays = Math.abs(opTimestamp - refTimestamp) / (24 * 3600 * 1000);
                if (diffDays > 30) {
                  dateOp = refIso;
                }
              }

              if (!dateVal && labelDateIso) {
                dateVal = labelDateIso;
              } else if (!dateVal && refIso) {
                dateVal = refIso;
              }

              return {
                externalId: ref || null,
                dedupKey: ref
                  ? `bourso:${ref}`
                  : `bourso:${rawAcc.id}:${dateOp}:${label}:${row.amount}:${row.balance}`,
                date: dateOp,
                valueDate: dateVal || null,
                amount: Number(row.amount) || 0,
                currency: row.currency || "EUR",
                label,
                category: decodeHtmlEntities(row.category || "") || null,
              };
            });

            const inserted = repository.insertTransactions(
              userId,
              syncedAccount.id,
              BOURSO_PROVIDER,
              items,
            );
            transactionsImported += inserted;

            // Nettoyage automatique des autorisations en cours remplacées par un débit réel
            repository.cleanAuthorizationDuplicates(syncedAccount.id, userId);
          } catch (txErr) {
            console.warn(`Transactions non extraites pour le compte ${rawAcc.name}:`, txErr.message);
          }
        }
      } catch (accErr) {
        errors.push({ accountId: rawAcc.id, name: rawAcc.name, error: accErr.message });
      }
    }

    repository.finishSyncRun(runId, {
      status: errors.length > 0 ? "partial" : "success",
      accountsSynced,
      transactionsImported,
      errors: errors.length > 0 ? errors : null,
    });

    return {
      status: "OK",
      accountsSynced,
      transactionsImported,
      holdingsSynced,
      errors,
      connection: repository.getConnector(connection.id, userId),
    };
  } catch (err) {
    repository.finishSyncRun(runId, {
      status: "error",
      accountsSynced,
      transactionsImported,
      errors: [{ error: err.message }],
    });
    repository.updateConnector(connection.id, userId, {
      status: "error",
      lastError: err.message,
    });
    throw err;
  }
};
