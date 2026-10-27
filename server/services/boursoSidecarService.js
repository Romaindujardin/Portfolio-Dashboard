// Service d'intégration du sidecar BoursoBank (bourso-cli).
// Permet d'extraire l'ensemble des comptes (Courants, Livrets, PEA, CTO, Assurance-Vie)
// ainsi que les positions de trading et l'historique complet des transactions
// sans les restrictions de la DSP2 (qui limite à 90 jours et exclut le PEA/CTO).

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { encryptJson, decryptJson, isEncryptionAvailable } from "../lib/secrets.js";
import { nowIso, round2 } from "../lib/validate.js";
import { PROVIDERS } from "../connectors/types.js";

export const BOURSO_PROVIDER = PROVIDERS.BOURSO_SIDECAR || "bourso-sidecar";

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

export const runBoursoCli = ({ args, customerId, password }) => {
  const cliPath = resolveBoursoCliPath();
  const sandboxHome = password
    ? createBoursoSandboxHome(customerId, password)
    : null;

  const execCommand = () =>
    new Promise((resolve, reject) => {
      const child = spawn(cliPath, args, {
        cwd: process.cwd(),
        env: sandboxHome ? { ...process.env, HOME: sandboxHome } : process.env,
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
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
      throw new Error(message);
    })
    .finally(() => {
      if (sandboxHome) removeBoursoSandboxHome(sandboxHome);
    });
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
    accounts.push({
      id: idMatch[1],
      name: nameMatch[1],
      balance: Number(balanceMatch[1]),
      bankName: bankMatch[1],
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

export const getBoursoSavedCredentials = (repository) => {
  const row = repository.getEncryptedIntegration(BOURSO_PROVIDER);
  if (!row?.encrypted_json) return null;
  try {
    return decryptJson(row.encrypted_json);
  } catch (err) {
    console.warn("⚠️ Impossible de déchiffrer les identifiants Bourso:", err);
    return null;
  }
};

export const saveBoursoCredentials = (repository, { customerId, password }) => {
  if (!customerId || !password) {
    throw new Error("Identifiant client et mot de passe requis");
  }
  const encrypted = encryptJson({ customerId, password });
  repository.saveEncryptedIntegration(BOURSO_PROVIDER, encrypted);
};

export const deleteBoursoCredentials = (repository) => {
  return repository.deleteIntegration(BOURSO_PROVIDER);
};

export const getBoursoStatus = (repository) => {
  const available = isBoursoCliAvailable();
  const creds = getBoursoSavedCredentials(repository);
  return {
    available,
    configured: Boolean(creds?.customerId && creds?.password),
    customerId: creds?.customerId || null,
  };
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
    const creds = getBoursoSavedCredentials(repository);
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
    saveBoursoCredentials(repository, { customerId, password });
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
        customerId,
        createdAt: nowIso(),
      },
    });
  } else {
    repository.updateConnector(connection.id, userId, {
      status: "active",
      lastSyncAt: nowIso(),
      lastError: null,
      metadata: {
        ...(connection.metadata || {}),
        customerId,
      },
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
        } else if (kind === "saving") {
          accountType = "SAVINGS";
        } else if (kind === "trading") {
          if (nameUpper.includes("PEA")) {
            accountType = "PEA";
          } else if (nameUpper.includes("ASSURANCE") || nameUpper.includes("VIE") || nameUpper.includes("PER")) {
            accountType = "SECURITIES";
          } else {
            accountType = "SECURITIES";
          }
        } else if (kind === "loan") {
          accountType = "LOAN";
        } else {
          accountType = "OTHER";
        }

        const syncedAccount = repository.upsertSyncedAccount(userId, {
          provider: BOURSO_PROVIDER,
          externalId: `bourso-${rawAcc.id}`,
          connectionId: connection.id,
          name: rawAcc.name,
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

            for (const row of parsedPos.rows) {
              const qty = Number(row.quantity) || 0;
              const lastPrice = Number(row.last) || 0;
              const buyingPrice = Number(row.buying_price) || 0;
              const amount = Number(row.amount) || qty * lastPrice;
              const costBasis = buyingPrice > 0 ? buyingPrice * qty : null;

              repository.upsertHolding(userId, syncedAccount.id, {
                isin: row.symbol || null,
                ticker: row.symbol || null,
                name: row.label || row.symbol,
                quantity: qty,
                costBasis,
                price: lastPrice,
                value: amount,
                assetClass: "EQUITY",
              });
              holdingsSynced++;
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
              let dateOp = row.date || row.date_op || "";
              let dateVal = row.value_date || row.valueDate || "";
              const ref = row.reference || "";

              // Fallback MongoDB ObjectId
              if (ref && /^[0-9a-f]{24}$/i.test(ref)) {
                const ts = parseInt(ref.substring(0, 8), 16) * 1000;
                const refDate = new Date(ts);
                if (!isNaN(refDate.getTime())) {
                  const refIso = refDate.toISOString().split("T")[0];
                  if (!dateOp) {
                    dateOp = refIso;
                    if (!dateVal) dateVal = refIso;
                  }
                }
              }

              return {
                externalId: ref || null,
                dedupKey: ref
                  ? `bourso:${ref}`
                  : `bourso:${rawAcc.id}:${dateOp}:${row.label}:${row.amount}:${row.balance}`,
                date: dateOp,
                valueDate: dateVal || null,
                amount: Number(row.amount) || 0,
                currency: row.currency || "EUR",
                label: row.label || "",
                category: row.category || null,
              };
            });

            const inserted = repository.insertTransactions(
              userId,
              syncedAccount.id,
              BOURSO_PROVIDER,
              items,
            );
            transactionsImported += inserted;
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
