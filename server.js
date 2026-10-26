import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import DatabaseManager from "./src/utils/database/database.js";
import { initializePortfolioSchema } from "./server/db/portfolioSchema.js";
import { createPortfolioRouter } from "./server/routes/portfolio.js";

// En local, `.env` est chargé par Vite pour le frontend ; on fait de même pour
// le backend afin que PORT, APP_URL, BASIC_AUTH_* ou DATABASE_PATH soient
// cohérents. Docker injecte déjà les variables via `env_file`.
const envFile = path.resolve(process.cwd(), ".env");
if (typeof process.loadEnvFile === "function" && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "127.0.0.1";
const APP_URL = (process.env.APP_URL || "https://localhost:5173").replace(/\/+$/, "");
const SERVE_STATIC =
  process.env.SERVE_STATIC === "true" || process.env.NODE_ENV === "production";
const DIST_DIR = path.resolve(process.cwd(), "dist");

// Derrière Caddy/Nginx/Traefik, les en-têtes X-Forwarded-* doivent être pris
// en compte. En local, on reste sur le comportement d'origine.
const trustProxy = process.env.TRUST_PROXY;
if (
  trustProxy === "true" ||
  trustProxy === "1" ||
  (trustProxy === undefined && process.env.NODE_ENV === "production")
) {
  app.set("trust proxy", 1);
}
app.disable("x-powered-by");

// Middleware — CORS : origines locales + origine publique configurée.
// Les requêtes sans Origin (curl, clients natifs) restent autorisées.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const configuredOrigins = String(process.env.CORS_ORIGINS || APP_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const isAllowedOrigin = (origin) =>
  !origin || LOCAL_ORIGIN.test(origin) || configuredOrigins.includes(origin);
app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  }),
);

// Authentification HTTP Basic optionnelle mais fortement recommandée dès que
// l'application est exposée sur Internet. Elle protège aussi les fichiers
// statiques et l'API, pas seulement la page d'accueil.
const BASIC_AUTH_USER = String(process.env.BASIC_AUTH_USER || "");
const BASIC_AUTH_PASSWORD = String(process.env.BASIC_AUTH_PASSWORD || "");
const authEnabled = Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASSWORD);
const requireAuth = process.env.REQUIRE_AUTH === "true";
const PLACEHOLDER_PASSWORD = "change-me-with-a-long-random-password";

if (BASIC_AUTH_PASSWORD === PLACEHOLDER_PASSWORD) {
  console.error(
    "❌ BASIC_AUTH_PASSWORD utilise encore la valeur d'exemple. " +
      "Choisissez un mot de passe unique avant de démarrer.",
  );
  process.exit(1);
}

if (requireAuth && !authEnabled) {
  console.error(
    "❌ REQUIRE_AUTH=true mais BASIC_AUTH_USER / BASIC_AUTH_PASSWORD ne sont pas définis.",
  );
  process.exit(1);
}
if (!authEnabled && process.env.NODE_ENV === "production") {
  console.warn(
    "⚠️  Application en production sans authentification applicative. " +
      "Définissez BASIC_AUTH_USER et BASIC_AUTH_PASSWORD, ou protégez-la par un VPN/reverse proxy.",
  );
}
if (process.env.NODE_ENV === "production" && !process.env.APP_URL) {
  console.warn(
    "⚠️  APP_URL n'est pas défini : le retour OAuth utilisera https://localhost:5173. " +
      "Définissez APP_URL avec l'origine HTTPS publique.",
  );
}
if (
  process.env.NODE_ENV === "production" &&
  !process.env.ENABLE_BANKING_REDIRECT_URI &&
  !process.env.ENABLEBANKING_REDIRECT_URI
) {
  console.warn(
    "⚠️  ENABLE_BANKING_REDIRECT_URI n'est pas défini : la configuration stockée en base sera utilisée. " +
      "En production, définissez l'URL HTTPS exacte de callback.",
  );
}

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

if (authEnabled) {
  app.use((req, res, next) => {
    if (req.method === "OPTIONS") return next();
    if (req.path === "/api/health" || req.path === "/healthz") return next();

    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Basic ")) {
      res.set("WWW-Authenticate", 'Basic realm="Portfolio", charset="UTF-8"');
      return res.status(401).send("Authentification requise");
    }

    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const user = separator >= 0 ? decoded.slice(0, separator) : "";
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (safeEqual(user, BASIC_AUTH_USER) && safeEqual(password, BASIC_AUTH_PASSWORD)) {
      return next();
    }

    res.set("WWW-Authenticate", 'Basic realm="Portfolio", charset="UTF-8"');
    return res.status(401).send("Identifiants invalides");
  });
}

// Protection CSRF simple : les navigateurs envoient Origin sur les requêtes
// mutantes. Une origine inconnue est refusée avant même de lire le corps.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  return next();
});

app.use(express.json({ limit: "10mb" }));

// Initialiser la base de données
const dbManager = DatabaseManager.getInstance();
dbManager.initializeTables();

// Tables additives du patrimoine connecté (connecteurs, immobilier, prêts…).
// Aucune table historique n'est modifiée : la logique CSV/budget/épargne reste
// strictement inchangée.
initializePortfolioSchema(dbManager.getDatabase());

// Endpoint de santé pour Docker/Caddy et les vérifications de déploiement.
// Volontairement accessible sans authentification.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "portfolio-dashboard",
    uptime: Math.round(process.uptime()),
    static: SERVE_STATIC,
  });
});
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// ===== PERSISTANCE DE SECOURS SUR DISQUE (DOUBLE PROTECTION) =====
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Sécurité : n'accepte que des noms de fichiers simples, confinés dans DATA_DIR.
// Empêche toute traversée de chemin via userId ou nom de fichier.
const DATA_DIR_RESOLVED = path.resolve(DATA_DIR);
const resolveBackupPath = (filename) => {
  if (typeof filename !== "string" || !/^[A-Za-z0-9_.-]+\.json$/.test(filename)) {
    return null;
  }
  const filepath = path.resolve(DATA_DIR_RESOLVED, filename);
  if (!filepath.startsWith(DATA_DIR_RESOLVED + path.sep)) return null;
  return filepath;
};

// Un userId ne peut contenir que lettres, chiffres, "_" et "-" (utilisé dans
// les noms de fichiers de secours et comme identifiant en base).
const sanitizeUserId = (value) => {
  const candidate = String(value ?? "").trim();
  if (!candidate) return "Romain";
  return /^[A-Za-z0-9_-]{1,64}$/.test(candidate) ? candidate : null;
};

const writeDiskBackup = (filename, data) => {
  try {
    const filepath = resolveBackupPath(filename);
    if (!filepath) {
      console.warn(`⚠️ Nom de backup disque refusé: ${filename}`);
      return;
    }
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`⚠️ Erreur écriture backup disque ${filename}:`, err);
  }
};

const readDiskBackup = (filename) => {
  try {
    const filepath = resolveBackupPath(filename);
    if (filepath && fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`⚠️ Erreur lecture backup disque ${filename}:`, err);
  }
  return null;
};

const resolveBoursoCliPath = () => {
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
          `bourso-cli non exécutable: ${candidate}. Vérifie les permissions (chmod +x) ou Gatekeeper.`,
        );
      }
      return candidate;
    }
  }

  throw new Error(
    "bourso-cli introuvable. Définis BOURSO_CLI_PATH ou compile bourso-api.",
  );
};

// Le CLI Bourso lit ses identifiants dans ~/.bourso/settings.json (via $HOME).
// Pour ne JAMAIS écrire le mot de passe en clair sur le disque de l'utilisateur,
// on exécute le CLI dans un HOME temporaire jetable qui ne contient que les
// identifiants, et on supprime ce répertoire après chaque appel.
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

const runBoursoCli = ({ args, customerId, password }) => {
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
      // Ne jamais laisser fuiter le mot de passe dans un message d'erreur
      let message = String(error?.message || error);
      if (password) message = message.split(password).join("***");
      throw new Error(message);
    })
    .finally(() => {
      if (sandboxHome) removeBoursoSandboxHome(sandboxHome);
    });
};

const parseAccountsFromOutput = (stdout) => {
  const accounts = [];
  const matches = stdout.matchAll(/Account\s*\{([\s\S]*?)\}/g);

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

const parseCsvText = (text) => {
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

const escapeCsvValue = (value, delimiter) => {
  const v = String(value ?? "");
  const needs =
    v.includes('"') ||
    v.includes("\n") ||
    v.includes("\r") ||
    v.includes(delimiter);
  if (!needs) return v;
  return `"${v.replace(/"/g, '""')}"`;
};

const stringifyCsvText = ({ headers, rows, delimiter = ";" }) => {
  const headerLine = headers
    .map((h) => escapeCsvValue(h, delimiter))
    .join(delimiter);
  const lines = [headerLine];
  for (const row of rows) {
    const line = headers
      .map((h) => escapeCsvValue((row?.[h] ?? "").toString(), delimiter))
      .join(delimiter);
    lines.push(line);
  }
  return lines.join("\n");
};

const extractCsvFromOutput = (stdout, headerStartsWith) => {
  const lines = (stdout || "").split(/\r?\n/);
  const idx = lines.findIndex((line) =>
    line.trim().startsWith(headerStartsWith),
  );
  if (idx === -1) {
    throw new Error("CSV introuvable dans la sortie bourso-cli");
  }
  return lines.slice(idx).join("\n").trim();
};

// Routes existantes
app.get("/api/test", (req, res) => {
  res.json({
    message: "Portfolio Dashboard API server is running!",
    timestamp: new Date().toISOString(),
    database: "SQLite initialized",
  });
});

// Proxy Binance API
app.post("/api/binance/account", async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret)
    return res.status(400).json({ error: "Missing API key or secret" });

  const timestamp = Date.now();
  const recvWindow = 5000;
  const queryString = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");
  const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": apiKey },
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy OpenSea API pour les NFTs
app.get("/api/opensea/nfts/:address", async (req, res) => {
  const { address } = req.params;
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "Missing OpenSea API key" });
  }

  try {
    console.log(`🔍 [Server] Récupération des NFTs OpenSea pour ${address}...`);

    // Utiliser l'API v2 d'OpenSea
    const url = `https://api.opensea.io/api/v2/chain/ethereum/account/${address}/nfts?limit=50`;

    const response = await fetch(url, {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `OpenSea API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    console.log(
      `✅ [Server] ${data.nfts?.length || 0} NFTs trouvés pour ${address}`,
    );

    res.json(data);
  } catch (error) {
    console.error(`❌ [Server] Erreur OpenSea pour ${address}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy OpenSea API pour la valeur d'un NFT spécifique
app.get("/api/opensea/nft/:contract/:tokenId", async (req, res) => {
  const { contract, tokenId } = req.params;
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "Missing OpenSea API key" });
  }

  try {
    console.log(
      `🔍 [Server] Récupération de la valeur NFT ${contract}/${tokenId}...`,
    );

    // Utiliser l'API v2 d'OpenSea pour un NFT spécifique
    const url = `https://api.opensea.io/api/v2/chain/ethereum/contract/${contract}/nfts/${tokenId}`;

    const response = await fetch(url, {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `OpenSea API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    console.log(`✅ [Server] Valeur NFT récupérée pour ${contract}/${tokenId}`);

    res.json(data);
  } catch (error) {
    console.error(
      `❌ [Server] Erreur OpenSea pour ${contract}/${tokenId}:`,
      error,
    );
    res.status(500).json({ error: error.message });
  }
});

// Proxy OpenSea API pour le floor price d'une collection
app.get("/api/opensea/collection/:collection/floor", async (req, res) => {
  const { collection } = req.params;
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "Missing OpenSea API key" });
  }

  try {
    console.log(
      `🔍 [Server] Récupération du floor price pour la collection ${collection}...`,
    );

    // Utiliser l'API v2 d'OpenSea pour les statistiques de collection
    const url = `https://api.opensea.io/api/v2/collections/${collection}/stats`;

    const response = await fetch(url, {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `OpenSea API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    console.log(
      `✅ [Server] Floor price récupéré pour ${collection}: ${
        data.total?.floor_price !== undefined ? data.total.floor_price : "N/A"
      }`,
    );

    res.json(data);
  } catch (error) {
    console.error(
      `❌ [Server] Erreur OpenSea pour la collection ${collection}:`,
      error,
    );
    res.status(500).json({ error: error.message });
  }
});

// ===== BOURSO / BOURSORAMA =====

/**
 * Detect authorization duplicate rows.
 * An "authorization" row is an existing row whose category contains "Autorisation"
 * that matches a newer row by: same amount, similar label, close date (≤7 days).
 */
const isAuthorizationRow = (r) => {
  const cat = `${r?.category || ""} ${r?.aiCategory || ""}`.toLowerCase();
  const label = (r?.label || "").toLowerCase();
  return (
    cat.includes("autorisation") ||
    cat.includes("authorization") ||
    label.includes("autorisation") ||
    label.includes("authorization")
  );
};

const detectAuthorizationDuplicates = (existingRows, allFetchedRows) => {
  const duplicates = [];
  // Only consider existing rows that look like pending authorizations
  const authRows = existingRows.filter((r) => isAuthorizationRow(r));

  if (authRows.length === 0) return duplicates;

  // For each fetched row that is NOT an authorization, check if it supersedes an auth row
  const finalRows = allFetchedRows.filter((r) => !isAuthorizationRow(r));

  for (const authRow of authRows) {
    const authAmount = parseFloat((authRow.amount || "0").replace(",", "."));
    const authDate = Date.parse(authRow.dateOp || authRow.dateVal || "");
    const authLabel = (authRow.label || "").toLowerCase().trim();
    // Extract significant words (≥3 chars) from auth label
    const authWords = authLabel
      .split(/[\s\-_/.,;:!?'"()]+/)
      .filter((w) => w.length >= 3)
      .filter(
        (w) =>
          ![
            "les",
            "des",
            "une",
            "par",
            "pour",
            "sur",
            "dans",
            "eur",
            "avec",
          ].includes(w),
      );

    for (const finalRow of finalRows) {
      const finalAmount = parseFloat(
        (finalRow.amount || "0").replace(",", "."),
      );
      const finalDate = Date.parse(finalRow.dateOp || finalRow.dateVal || "");
      const finalLabel = (finalRow.label || "").toLowerCase().trim();
      const compactAuth = authLabel.replace(/\s+/g, "");
      const compactFinal = finalLabel.replace(/\s+/g, "");

      // 1. Same amount
      if (Math.abs(authAmount - finalAmount) > 0.01) continue;

      // 2. Close dates (within 7 days)
      if (isNaN(authDate) || isNaN(finalDate)) continue;
      const daysDiff = Math.abs(finalDate - authDate) / (1000 * 60 * 60 * 24);
      if (daysDiff > 7) continue;

      // 3. Label similarity: at least one significant word from authLabel appears in finalLabel,
      //    or finalLabel appears in authLabel (also without spaces: TOOGOODTOGO vs TOO GOOD TO GO)
      const labelMatch =
        finalLabel.includes(authLabel) ||
        authLabel.includes(finalLabel) ||
        compactFinal.includes(compactAuth) ||
        compactAuth.includes(compactFinal) ||
        authWords.some((w) => finalLabel.includes(w) || compactFinal.includes(w));
      if (!labelMatch) continue;

      // Found a match
      const reason = `Même montant (${authAmount}), dates proches (${authRow.dateOp} → ${finalRow.dateOp}), libellé similaire`;
      duplicates.push({
        newRow: finalRow,
        existingRow: authRow,
        reason,
      });
      break; // one match per auth row is enough
    }
  }

  return duplicates;
};

app.post("/api/bourso/accounts", async (req, res) => {
  try {
    const { customerId, password } = req.body || {};
    if (!customerId || !password) {
      return res.status(400).json({ error: "customerId et password requis" });
    }

    const { stdout } = await runBoursoCli({
      args: ["accounts"],
      customerId,
      password,
    });
    const accounts = parseAccountsFromOutput(stdout);

    if (!accounts.length) {
      return res
        .status(500)
        .json({ error: "Aucun compte détecté dans la sortie bourso-cli" });
    }

    res.json({ accounts });
  } catch (error) {
    console.error("Error fetching bourso accounts:", error);
    res.status(500).json({ error: error.message || "Erreur Bourso" });
  }
});

app.post("/api/bourso/sync", async (req, res) => {
  try {
    const {
      customerId,
      password,
      mappings,
      pages = 10,
      userId: rawUserId = "Romain",
      dryRun = false,
      duplicateRefsToRemove = [],
    } = req.body || {};

    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });

    if (!customerId || !password) {
      return res.status(400).json({ error: "customerId et password requis" });
    }
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ error: "Aucune configuration de comptes" });
    }

    const results = [];

    for (const mapping of mappings) {
      if (!mapping || mapping.section === "ignore") continue;

      if (mapping.section === "bank") {
        const { stdout } = await runBoursoCli({
          args: [
            "transactions",
            "--account",
            mapping.accountId,
            "--pages",
            `${pages}`,
            "--format",
            "csv",
          ],
          customerId,
          password,
        });

        const rawCsv = extractCsvFromOutput(stdout, "date,");
        const parsed = parseCsvText(rawCsv);
        const rows = parsed.rows.map((row) => {
          let dateOp = row.date || row.date_op || "";
          let dateVal = row.value_date || row.valueDate || "";
          const ref = row.reference || "";

          // Fallback: If date is missing or set to today's date when reference has a Boursorama MongoDB ObjectId (24 hex characters)
          if (ref && /^[0-9a-f]{24}$/i.test(ref)) {
            const ts = parseInt(ref.substring(0, 8), 16) * 1000;
            const refDate = new Date(ts);
            if (!isNaN(refDate.getTime())) {
              const refIso = refDate.toISOString().split("T")[0];
              if (!dateOp) {
                dateOp = refIso;
                if (!dateVal) dateVal = refIso;
              } else {
                const opTime = new Date(dateOp).getTime();
                if (Math.abs(opTime - refDate.getTime()) > 2 * 24 * 3600 * 1000) {
                  const todayIso = new Date().toISOString().split("T")[0];
                  if (dateOp === todayIso) {
                    dateOp = refIso;
                    if (!dateVal) dateVal = refIso;
                  }
                }
              }
            }
          }

          return {
            dateOp,
            dateVal,
            label: row.label || "",
            amount: row.amount || "",
            currency: row.currency || "EUR",
            category: row.category || "",
            reference: ref,
            accountbalance: row.balance || "",
            accountLabel: mapping.accountName || "",
            supplierFound: "",
            comment: "",
            aiCategory: row.category || "Non catégorisé",
            aiSubCategory: "Non catégorisé",
          };
        });

        const headers = [
          "dateOp",
          "dateVal",
          "label",
          "amount",
          "currency",
          "category",
          "reference",
          "accountbalance",
          "accountLabel",
          "supplierFound",
          "comment",
          "aiCategory",
          "aiSubCategory",
        ];

        const sourceLabel = `bourso:${mapping.accountId}`;
        const existing = dbManager
          .getAllBankCsvUploadsMeta(userId, "bank")
          .find((u) => u.source_label === sourceLabel);
        let existingRows = [];

        if (existing) {
          const existingUpload = dbManager.getBankCsvUploadById(
            existing.id,
            userId,
          );
          if (existingUpload?.content) {
            const parsedExisting = parseCsvText(existingUpload.content);
            existingRows = parsedExisting.rows || [];
          }
        }

        const existingKeys = new Set(
          existingRows.map((r) =>
            r.reference
              ? `ref:${r.reference}`
              : `key:${r.dateOp}|${r.label}|${r.amount}|${r.accountbalance}`,
          ),
        );

        const newRows = rows.filter((r) => {
          const key = r.reference
            ? `ref:${r.reference}`
            : `key:${r.dateOp}|${r.label}|${r.amount}|${r.accountbalance}`;
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        });

        // Detect authorization duplicates (pending → final payment),
        // including same-batch auth + settlement on first sync.
        const duplicateRows = [
          ...detectAuthorizationDuplicates(existingRows, rows),
          ...detectAuthorizationDuplicates(rows, rows),
        ].filter((dup, idx, arr) => {
          const key = `${dup.existingRow?.reference || ""}|${dup.newRow?.reference || ""}`;
          return (
            arr.findIndex(
              (other) =>
                `${other.existingRow?.reference || ""}|${other.newRow?.reference || ""}` ===
                key,
            ) === idx
          );
        });

        // On confirm (not dryRun), remove accepted authorization duplicates
        const refsToRemoveSet = new Set(
          Array.isArray(duplicateRefsToRemove) ? duplicateRefsToRemove : [],
        );
        let filteredExistingRows = existingRows;
        let filteredNewRows = newRows;
        if (!dryRun && refsToRemoveSet.size > 0) {
          filteredExistingRows = existingRows.filter(
            (r) => !refsToRemoveSet.has(r.reference || ""),
          );
          filteredNewRows = newRows.filter(
            (r) => !refsToRemoveSet.has(r.reference || ""),
          );
        }

        const combinedRows = [...filteredExistingRows, ...filteredNewRows];
        combinedRows.sort((a, b) => {
          const da = Date.parse(a.dateOp || "") || 0;
          const db = Date.parse(b.dateOp || "") || 0;
          if (da !== db) return da - db;

          const bala = parseFloat(a.accountbalance);
          const balb = parseFloat(b.accountbalance);
          const amta = parseFloat(a.amount);
          const amtb = parseFloat(b.amount);

          if (!isNaN(bala) && !isNaN(balb) && !isNaN(amta) && !isNaN(amtb)) {
            if (Math.abs(Math.round((bala + amtb) * 100) - Math.round(balb * 100)) <= 1) {
              return -1;
            }
            if (Math.abs(Math.round((balb + amta) * 100) - Math.round(bala * 100)) <= 1) {
              return 1;
            }
          }

          if (a.reference && b.reference && /^[0-9a-f]{24}$/i.test(a.reference) && /^[0-9a-f]{24}$/i.test(b.reference)) {
            return a.reference.localeCompare(b.reference);
          }
          return 0;
        });

        const csvContent = stringifyCsvText({
          headers,
          rows: combinedRows,
          delimiter: ";",
        });
        const filename = `bourso-bank-${mapping.accountId}.csv`;

        if (!dryRun) {
          if (existing) {
            dbManager.updateBankCsvUpload(existing.id, userId, {
              filename,
              content: csvContent,
              size_bytes: csvContent.length,
            });
          } else {
            dbManager.createBankCsvUpload({
              user_id: userId,
              section: "bank",
              source_label: sourceLabel,
              filename,
              content: csvContent,
              size_bytes: csvContent.length,
            });
          }
        }

        results.push({
          accountId: mapping.accountId,
          accountName: mapping.accountName,
          section: "bank",
          addedCount: newRows.length,
          totalCount: combinedRows.length,
          newRows,
          duplicateRows,
          filename,
        });
      }

      if (mapping.section === "pea") {
        const { stdout } = await runBoursoCli({
          args: [
            "positions",
            "--account",
            mapping.accountId,
            "--format",
            "csv",
          ],
          customerId,
          password,
        });

        const rawCsv = extractCsvFromOutput(stdout, "symbol,");
        const parsed = parseCsvText(rawCsv);
        const rows = parsed.rows.map((row) => ({
          name: row.label || row.symbol || "",
          isin: row.symbol || "",
          quantity: row.quantity || "",
          buyingPrice: row.buying_price || "",
          lastPrice: row.last || "",
          amount: row.amount || "",
          amountVariation: row.gain_loss || "",
          variation: row.gain_loss_percent || "",
          lastMovementDate: row.last_movement_date || "",
        }));

        const headers = [
          "name",
          "isin",
          "quantity",
          "buyingPrice",
          "lastPrice",
          "amount",
          "amountVariation",
          "variation",
          "lastMovementDate",
        ];

        const sourceLabel = `bourso:${mapping.accountId}`;
        const existing = dbManager
          .getAllBankCsvUploadsMeta(userId, "pea")
          .find((u) => u.source_label === sourceLabel);

        let existingRows = [];
        if (existing) {
          const existingUpload = dbManager.getBankCsvUploadById(
            existing.id,
            userId,
          );
          if (existingUpload?.content) {
            const parsedExisting = parseCsvText(existingUpload.content);
            existingRows = parsedExisting.rows || [];
          }
        }

        const buildPeaKey = (row) => {
          const isin = (row.isin || row.symbol || row.name || "").toString();
          const quantity = (row.quantity || "").toString();
          const buyingPrice = (
            row.buyingPrice ||
            row.buying_price ||
            ""
          ).toString();
          const lastMovementDate = (
            row.lastMovementDate ||
            row.last_movement_date ||
            ""
          ).toString();
          return `${isin}|${quantity}|${buyingPrice}|${lastMovementDate}`;
        };

        const combinedMap = new Map();
        existingRows.forEach((row) => {
          const key = buildPeaKey(row);
          combinedMap.set(key, { ...row });
        });

        const newRows = [];
        rows.forEach((row) => {
          const key = buildPeaKey(row);
          if (combinedMap.has(key)) {
            // Update latest prices/amounts but don't count as new
            combinedMap.set(key, { ...combinedMap.get(key), ...row });
          } else {
            combinedMap.set(key, row);
            newRows.push(row);
          }
        });

        const combinedRows = Array.from(combinedMap.values());
        combinedRows.sort((a, b) => {
          const amountA = Number(a.amount || 0);
          const amountB = Number(b.amount || 0);
          return amountB - amountA;
        });

        const csvContent = stringifyCsvText({
          headers,
          rows: combinedRows,
          delimiter: ";",
        });
        const filename = `bourso-pea-${mapping.accountId}.csv`;

        if (!dryRun) {
          if (existing) {
            dbManager.updateBankCsvUpload(existing.id, userId, {
              filename,
              content: csvContent,
              size_bytes: csvContent.length,
            });
          } else {
            dbManager.createBankCsvUpload({
              user_id: userId,
              section: "pea",
              source_label: sourceLabel,
              filename,
              content: csvContent,
              size_bytes: csvContent.length,
            });
          }
        }

        results.push({
          accountId: mapping.accountId,
          accountName: mapping.accountName,
          section: "pea",
          addedCount: newRows.length,
          totalCount: combinedRows.length,
          newRows,
          duplicateRows: [],
          filename,
        });
      }
    }

    res.json({ items: results });
  } catch (error) {
    console.error("Error syncing bourso data:", error);
    res.status(500).json({ error: error.message || "Erreur Bourso" });
  }
});

// ===== NOUVELLES ROUTES POUR LA BASE DE DONNÉES =====

// Statistiques de la base de données
app.get("/api/database/stats", (req, res) => {
  try {
    const stats = dbManager.getDatabaseStats();
    res.json(stats);
  } catch (error) {
    console.error("Error getting database stats:", error);
    res.status(500).json({ error: "Failed to get database stats" });
  }
});

// ===== BANQUE / IMPORT CSV =====

// GET /api/database/bank-csv - Lister les CSV uploadés
app.get("/api/database/bank-csv", (req, res) => {
  try {
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    const section = req.query.section || null;
    // Ne pas renvoyer le contenu complet dans la liste
    const uploads = dbManager.getAllBankCsvUploadsMeta(userId, section);
    res.json(uploads);
  } catch (error) {
    console.error("Error getting bank csv uploads:", error);
    res.status(500).json({ error: "Failed to get bank csv uploads" });
  }
});

// POST /api/database/bank-csv - Créer un upload CSV
app.post("/api/database/bank-csv", (req, res) => {
  try {
    const id = dbManager.createBankCsvUpload(req.body);
    res.json({ id, message: "Bank CSV upload created successfully" });
  } catch (error) {
    console.error("Error creating bank csv upload:", error);
    res.status(500).json({ error: "Failed to create bank csv upload" });
  }
});

// GET /api/database/bank-csv/:id - Récupérer un upload CSV
app.get("/api/database/bank-csv/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    const upload = dbManager.getBankCsvUploadById(id, userId);
    if (!upload) return res.status(404).json({ error: "Upload not found" });
    res.json(upload);
  } catch (error) {
    console.error("Error getting bank csv upload:", error);
    res.status(500).json({ error: "Failed to get bank csv upload" });
  }
});

// DELETE /api/database/bank-csv/:id - Supprimer un upload CSV
app.delete("/api/database/bank-csv/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    const success = dbManager.deleteBankCsvUpload(id, userId);
    if (success) return res.json({ message: "Upload deleted successfully" });
    res.status(404).json({ error: "Upload not found" });
  } catch (error) {
    console.error("Error deleting bank csv upload:", error);
    res.status(500).json({ error: "Failed to delete bank csv upload" });
  }
});

// PUT /api/database/bank-csv/:id - Mettre à jour un upload CSV (content / filename)
app.put("/api/database/bank-csv/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = sanitizeUserId(req.query.user_id || req.body.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    const { filename, content, size_bytes } = req.body || {};

    let success = dbManager.updateBankCsvUpload(id, userId, {
      filename,
      content,
      size_bytes,
    });

    if (!success) {
      const db = dbManager.getDatabase();
      const row = db
        .prepare("SELECT user_id FROM bank_csv_uploads WHERE id = ?")
        .get(id);
      if (row) {
        success = dbManager.updateBankCsvUpload(id, row.user_id || "Romain", {
          filename,
          content,
          size_bytes,
        });
      }
    }

    if (success) return res.json({ message: "Upload updated successfully" });
    res.status(404).json({ error: "Upload not found" });
  } catch (error) {
    console.error("Error updating bank csv upload:", error);
    res.status(500).json({ error: "Failed to update bank csv upload" });
  }
});

// ===== GESTION TRICOUNT / BUDGET =====

// GET /api/database/tricount/data - Récupérer toutes les données Tricount (dépenses, revenus, configs)
app.get("/api/database/tricount/data", (req, res) => {
  try {
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    let rawExpenses = dbManager.getAllTricountExpenses(userId) || [];
    let expenses = rawExpenses.filter((e) => e && e.id !== "exp-1" && e.id !== "exp-2");
    // Si des dépenses de test étaient encore en base, les purger
    if (rawExpenses.length !== expenses.length) {
      try {
        dbManager.db.prepare("DELETE FROM tricount_expenses WHERE id IN ('exp-1', 'exp-2')").run();
      } catch {}
    }

    let incomes = dbManager.getAllTricountIncomes(userId) || [];
    let configs = dbManager.getAllTricountConfigs(userId) || {};

    // Si SQLite est vide, vérifier si une sauvegarde fichier existe pour auto-restaurer
    if (expenses.length === 0 && incomes.length === 0) {
      const backup = readDiskBackup(`tricount_${userId}.json`);
      if (backup) {
        const cleanBackupExpenses = (backup.expenses || []).filter((e) => e && e.id !== "exp-1" && e.id !== "exp-2");
        if (cleanBackupExpenses.length > 0) {
          dbManager.saveTricountExpensesBatch(cleanBackupExpenses, userId);
          expenses = cleanBackupExpenses;
        }
        if (Array.isArray(backup.incomes) && backup.incomes.length > 0) {
          dbManager.saveTricountIncomesBatch(backup.incomes, userId);
          incomes = backup.incomes;
        }
        if (backup.configs && typeof backup.configs === "object") {
          for (const m of Object.keys(backup.configs)) {
            if (m !== "2026-09" || expenses.some(e => e.month === "2026-09")) {
              dbManager.saveTricountConfig(backup.configs[m], userId);
            }
          }
          configs = dbManager.getAllTricountConfigs(userId);
        }
      }
    }

    // Supprimer la config 2026-09 si elle est vide
    if (configs["2026-09"] && !expenses.some(e => e.month === "2026-09") && !incomes.some(i => i.month === "2026-09")) {
      delete configs["2026-09"];
      try {
        dbManager.db.prepare("DELETE FROM tricount_configs WHERE month = '2026-09'").run();
      } catch {}
    }

    res.json({ expenses, incomes, configs });
  } catch (error) {
    console.error("Error fetching tricount data:", error);
    res.status(500).json({ error: "Failed to fetch tricount data" });
  }
});

// POST /api/database/tricount/sync - Synchroniser les dépenses, revenus et configs
app.post("/api/database/tricount/sync", (req, res) => {
  try {
    const { expenses, incomes, configs, userId: rawUserId } = req.body;
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    let expCount = 0;
    let incCount = 0;
    let confCount = 0;

    // Filtrer les dépenses de test résiduelles
    const cleanExpenses = Array.isArray(expenses)
      ? expenses.filter((e) => e && e.id !== "exp-1" && e.id !== "exp-2")
      : [];

    if (cleanExpenses.length > 0) {
      expCount = dbManager.saveTricountExpensesBatch(cleanExpenses, userId);
    }
    if (Array.isArray(incomes) && incomes.length > 0) {
      incCount = dbManager.saveTricountIncomesBatch(incomes, userId);
    }
    const cleanConfigs = { ...(configs || {}) };
    if (cleanConfigs["2026-09"] && !cleanExpenses.some(e => e.month === "2026-09") && (!incomes || !incomes.some(i => i.month === "2026-09"))) {
      delete cleanConfigs["2026-09"];
      try {
        dbManager.db.prepare("DELETE FROM tricount_configs WHERE month = '2026-09'").run();
      } catch {}
    }

    if (cleanConfigs && typeof cleanConfigs === "object") {
      for (const month of Object.keys(cleanConfigs)) {
        const cfg = cleanConfigs[month];
        if (cfg) {
          dbManager.saveTricountConfig(cfg, userId);
          confCount++;
        }
      }
    }

    // Sauvegarde de sécurité miroir immédiate sur disque en JSON
    writeDiskBackup(`tricount_${userId}.json`, {
      expenses: cleanExpenses,
      incomes: incomes || [],
      configs: cleanConfigs,
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Tricount data synced successfully",
      saved: { expenses: expCount, incomes: incCount, configs: confCount },
    });
  } catch (error) {
    console.error("Error syncing tricount data:", error);
    res.status(500).json({ error: "Failed to sync tricount data" });
  }
});

// POST /api/database/tricount/expenses - Sauvegarder une dépense
app.post("/api/database/tricount/expenses", (req, res) => {
  try {
    const { expense, userId: rawUserId } = req.body || {};
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    if (!expense) return res.status(400).json({ error: "Expense data required" });
    const id = dbManager.saveTricountExpense(expense, userId);
    // Rafraîchir backup disque
    const allExpenses = dbManager.getAllTricountExpenses(userId);
    const allIncomes = dbManager.getAllTricountIncomes(userId);
    const configs = dbManager.getAllTricountConfigs(userId);
    writeDiskBackup(`tricount_${userId}.json`, {
      expenses: allExpenses,
      incomes: allIncomes,
      configs,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, id });
  } catch (error) {
    console.error("Error saving tricount expense:", error);
    res.status(500).json({ error: "Failed to save tricount expense" });
  }
});

// DELETE /api/database/tricount/expenses/:id - Supprimer une dépense
app.delete("/api/database/tricount/expenses/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    const success = dbManager.deleteTricountExpense(id, userId);
    // Rafraîchir backup disque
    const allExpenses = dbManager.getAllTricountExpenses(userId);
    const allIncomes = dbManager.getAllTricountIncomes(userId);
    const configs = dbManager.getAllTricountConfigs(userId);
    writeDiskBackup(`tricount_${userId}.json`, {
      expenses: allExpenses,
      incomes: allIncomes,
      configs,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success });
  } catch (error) {
    console.error("Error deleting tricount expense:", error);
    res.status(500).json({ error: "Failed to delete tricount expense" });
  }
});

// POST /api/database/tricount/incomes - Sauvegarder un revenu
app.post("/api/database/tricount/incomes", (req, res) => {
  try {
    const { income, userId: rawUserId } = req.body || {};
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    if (!income) return res.status(400).json({ error: "Income data required" });
    const id = dbManager.saveTricountIncome(income, userId);
    // Rafraîchir backup disque
    const allExpenses = dbManager.getAllTricountExpenses(userId);
    const allIncomes = dbManager.getAllTricountIncomes(userId);
    const configs = dbManager.getAllTricountConfigs(userId);
    writeDiskBackup(`tricount_${userId}.json`, {
      expenses: allExpenses,
      incomes: allIncomes,
      configs,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, id });
  } catch (error) {
    console.error("Error saving tricount income:", error);
    res.status(500).json({ error: "Failed to save tricount income" });
  }
});

// DELETE /api/database/tricount/incomes/:id - Supprimer un revenu
app.delete("/api/database/tricount/incomes/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    const success = dbManager.deleteTricountIncome(id, userId);
    // Rafraîchir backup disque
    const allExpenses = dbManager.getAllTricountExpenses(userId);
    const allIncomes = dbManager.getAllTricountIncomes(userId);
    const configs = dbManager.getAllTricountConfigs(userId);
    writeDiskBackup(`tricount_${userId}.json`, {
      expenses: allExpenses,
      incomes: allIncomes,
      configs,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success });
  } catch (error) {
    console.error("Error deleting tricount income:", error);
    res.status(500).json({ error: "Failed to delete tricount income" });
  }
});

// POST /api/database/tricount/configs - Sauvegarder la config mensuelle
app.post("/api/database/tricount/configs", (req, res) => {
  try {
    const { config, userId: rawUserId } = req.body || {};
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    if (!config) return res.status(400).json({ error: "Config data required" });
    const id = dbManager.saveTricountConfig(config, userId);
    // Rafraîchir backup disque
    const allExpenses = dbManager.getAllTricountExpenses(userId);
    const allIncomes = dbManager.getAllTricountIncomes(userId);
    const configs = dbManager.getAllTricountConfigs(userId);
    writeDiskBackup(`tricount_${userId}.json`, {
      expenses: allExpenses,
      incomes: allIncomes,
      configs,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, id });
  } catch (error) {
    console.error("Error saving tricount config:", error);
    res.status(500).json({ error: "Failed to save tricount config" });
  }
});

// ===== GESTION PLAN D'ÉPARGNE & STRATÉGIE (SQLITE + DISQUE) =====

// GET /api/database/savings/strategy - Récupérer la stratégie d'épargne
app.get("/api/database/savings/strategy", (req, res) => {
  try {
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    let strategy = dbManager.getSavingsStrategy(userId);
    if (!strategy) {
      strategy = readDiskBackup(`savings_strategy_${userId}.json`);
      if (strategy) {
        dbManager.saveSavingsStrategy(userId, strategy);
      }
    }
    res.json({ strategy });
  } catch (error) {
    console.error("Error fetching savings strategy:", error);
    res.status(500).json({ error: "Failed to fetch savings strategy" });
  }
});

// POST /api/database/savings/strategy - Sauvegarder la stratégie d'épargne
app.post("/api/database/savings/strategy", (req, res) => {
  try {
    const { strategy, userId: rawUserId } = req.body || {};
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    if (!strategy) return res.status(400).json({ error: "Strategy data required" });
    dbManager.saveSavingsStrategy(userId, strategy);
    writeDiskBackup(`savings_strategy_${userId}.json`, strategy);
    res.json({ success: true, message: "Savings strategy saved successfully" });
  } catch (error) {
    console.error("Error saving savings strategy:", error);
    res.status(500).json({ error: "Failed to save savings strategy" });
  }
});

// GET /api/database/savings/monthly - Récupérer les stratégies mensuelles
app.get("/api/database/savings/monthly", (req, res) => {
  try {
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    let strategies = dbManager.getAllSavingsMonthlyStrategies(userId);
    if (!strategies || Object.keys(strategies).length === 0) {
      strategies = readDiskBackup(`savings_monthly_${userId}.json`) || {};
      if (Object.keys(strategies).length > 0) {
        dbManager.saveAllSavingsMonthlyStrategies(userId, strategies);
      }
    }
    res.json({ strategies });
  } catch (error) {
    console.error("Error fetching monthly savings strategies:", error);
    res.status(500).json({ error: "Failed to fetch monthly savings strategies" });
  }
});

// POST /api/database/savings/monthly - Sauvegarder la stratégie d'un mois spécifique
app.post("/api/database/savings/monthly", (req, res) => {
  try {
    const { month, strategy, userId: rawUserId } = req.body || {};
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    if (!month || !strategy) return res.status(400).json({ error: "Month and strategy required" });
    dbManager.saveSavingsStrategyForMonth(userId, month, strategy);
    const all = dbManager.getAllSavingsMonthlyStrategies(userId);
    writeDiskBackup(`savings_monthly_${userId}.json`, all);
    res.json({ success: true, message: `Monthly strategy for ${month} saved successfully` });
  } catch (error) {
    console.error("Error saving monthly strategy:", error);
    res.status(500).json({ error: "Failed to save monthly strategy" });
  }
});

// POST /api/database/savings/monthly/batch - Sauvegarder l'ensemble des stratégies mensuelles
app.post("/api/database/savings/monthly/batch", (req, res) => {
  try {
    const { strategies, userId: rawUserId } = req.body || {};
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    if (!strategies || typeof strategies !== "object") {
      return res.status(400).json({ error: "Strategies map required" });
    }
    dbManager.saveAllSavingsMonthlyStrategies(userId, strategies);
    writeDiskBackup(`savings_monthly_${userId}.json`, strategies);
    res.json({ success: true, message: "Batch monthly strategies saved successfully" });
  } catch (error) {
    console.error("Error saving batch monthly strategies:", error);
    res.status(500).json({ error: "Failed to save batch monthly strategies" });
  }
});

// ===== GESTION DES PARAMÈTRES UTILISATEUR (SQLITE + DISQUE) =====

// GET /api/database/user-settings - Récupérer les paramètres utilisateur
app.get("/api/database/user-settings", (req, res) => {
  try {
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    let settings = dbManager.getUserSettings(userId);
    if (!settings) {
      settings = readDiskBackup(`user_settings_${userId}.json`);
      if (settings) {
        dbManager.saveUserSettings(userId, settings);
      }
    }
    res.json({ settings });
  } catch (error) {
    console.error("Error fetching user settings:", error);
    res.status(500).json({ error: "Failed to fetch user settings" });
  }
});

// POST /api/database/user-settings - Sauvegarder les paramètres utilisateur
app.post("/api/database/user-settings", (req, res) => {
  try {
    const { settings, userId: rawUserId } = req.body || {};
    const userId = sanitizeUserId(rawUserId);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    if (!settings) return res.status(400).json({ error: "Settings required" });
    dbManager.saveUserSettings(userId, settings);
    writeDiskBackup(`user_settings_${userId}.json`, settings);
    res.json({ success: true, message: "User settings saved successfully" });
  } catch (error) {
    console.error("Error saving user settings:", error);
    res.status(500).json({ error: "Failed to save user settings" });
  }
});

// ===== GESTION DES WALLETS =====

// GET /api/database/wallets - Récupérer tous les wallets
app.get("/api/database/wallets", (req, res) => {
  try {
    const userId = sanitizeUserId(req.query.user_id);
    if (!userId)
      return res.status(400).json({ error: "user_id invalide" });
    const wallets = dbManager.getAllWallets(userId);

    // Ajouter les assets et NFTs pour chaque wallet
    const walletsWithAssets = wallets.map((wallet) => {
      const assets = dbManager.getWalletAssets(wallet.id);
      const nfts = dbManager.getWalletNFTs(wallet.id);
      return {
        ...wallet,
        assets,
        nfts,
      };
    });

    res.json(walletsWithAssets);
  } catch (error) {
    console.error("Error getting wallets:", error);
    res.status(500).json({ error: "Failed to get wallets" });
  }
});

// POST /api/database/wallets - Créer un wallet
app.post("/api/database/wallets", (req, res) => {
  try {
    const { assets, nfts, ...walletData } = req.body;
    const walletId = dbManager.createWallet(walletData);

    // Ajouter les assets du wallet
    if (assets && Array.isArray(assets)) {
      assets.forEach((asset) => {
        dbManager.createWalletAsset({
          ...asset,
          wallet_id: walletId,
        });
      });
    }

    // Ajouter les NFTs du wallet
    if (nfts && Array.isArray(nfts)) {
      nfts.forEach((nft, index) => {
        try {
          dbManager.createWalletNFT({
            ...nft,
            wallet_id: walletId,
          });
        } catch (nftError) {
          console.error(`Erreur NFT ${index + 1}:`, nftError.message);
        }
      });
    }

    res.json({ id: walletId, message: "Wallet created successfully" });
  } catch (error) {
    console.error("❌ Error creating wallet:", error);
    res.status(500).json({ error: "Failed to create wallet" });
  }
});

// PUT /api/database/wallets/:id - Mettre à jour un wallet
app.put("/api/database/wallets/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { assets, nfts, ...walletData } = req.body;

    // Le wallet doit exister — les champs fournis sont ensuite appliqués
    // (whitelist), même si le corps ne contient que des assets/NFTs.
    if (!dbManager.getWalletById(id)) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    dbManager.updateWallet(id, walletData);

    // Supprimer les anciens assets et NFTs
    dbManager.deleteWalletAssets(id);
    dbManager.deleteWalletNFTs(id);

    // Ajouter les nouveaux assets
    if (assets && Array.isArray(assets)) {
      assets.forEach((asset) => {
        dbManager.createWalletAsset({
          ...asset,
          wallet_id: id,
        });
      });
    }

    // Ajouter les nouveaux NFTs
    if (nfts && Array.isArray(nfts)) {
      nfts.forEach((nft) => {
        dbManager.createWalletNFT({
          ...nft,
          wallet_id: id,
        });
      });
    }

    res.json({ message: "Wallet updated successfully" });
  } catch (error) {
    console.error("Error updating wallet:", error);
    res.status(500).json({ error: "Failed to update wallet" });
  }
});

// DELETE /api/database/wallets/:id - Supprimer un wallet
app.delete("/api/database/wallets/:id", (req, res) => {
  try {
    const { id } = req.params;

    // Supprimer les assets et NFTs du wallet
    dbManager.deleteWalletAssets(id);
    dbManager.deleteWalletNFTs(id);

    // Supprimer le wallet
    const success = dbManager.deleteWallet(id);

    if (success) {
      res.json({ message: "Wallet deleted successfully" });
    } else {
      res.status(404).json({ error: "Wallet not found" });
    }
  } catch (error) {
    console.error("Error deleting wallet:", error);
    res.status(500).json({ error: "Failed to delete wallet" });
  }
});

// PUT /api/database/wallets/:id/assets/:index/visibility - Mettre à jour la visibilité d'un asset
app.put("/api/database/wallets/:id/assets/:index/visibility", (req, res) => {
  try {
    const { id, index } = req.params;
    const { isHidden } = req.body;

    const assets = dbManager.getWalletAssets(id);
    if (assets[index]) {
      const success = dbManager.updateWalletAssetVisibility(
        assets[index].id,
        isHidden,
      );

      if (success) {
        res.json({ message: "Asset visibility updated successfully" });
      } else {
        res.status(404).json({ error: "Asset not found" });
      }
    } else {
      res.status(404).json({ error: "Asset not found" });
    }
  } catch (error) {
    console.error("Error updating asset visibility:", error);
    res.status(500).json({ error: "Failed to update asset visibility" });
  }
});

// PUT /api/database/wallets/:id/nfts/:index/visibility - Mettre à jour la visibilité d'un NFT
app.put("/api/database/wallets/:id/nfts/:index/visibility", (req, res) => {
  try {
    const { id, index } = req.params;
    const { isHidden } = req.body;

    const nftIndex = Number.parseInt(index, 10);
    const nfts = dbManager.getWalletNFTs(id);
    if (Number.isNaN(nftIndex) || !nfts[nftIndex]) {
      return res.status(404).json({ error: "NFT not found" });
    }

    const success = dbManager.updateWalletNFTVisibility(
      nfts[nftIndex].id,
      isHidden,
    );

    if (success) {
      res.json({ message: "NFT visibility updated successfully" });
    } else {
      res.status(404).json({ error: "NFT not found" });
    }
  } catch (error) {
    console.error("Error updating NFT visibility:", error);
    res.status(500).json({ error: "Failed to update NFT visibility" });
  }
});

// ===== PATRIMOINE CONNECTÉ (connecteurs, immobilier, prêts, marché) =====
app.use(
  "/api/portfolio",
  createPortfolioRouter({
    db: dbManager.getDatabase(),
    enableBankingBaseUrl:
      process.env.ENABLE_BANKING_BASE_URL ||
      process.env.ENABLEBANKING_BASE_URL ||
      null,
  }),
);

// Toute route /api non trouvée doit renvoyer du JSON, jamais index.html.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// En production, Express sert le build Vite et l'API sur la même origine.
// C'est ce qui permet d'utiliser des URLs relatives côté navigateur et
// d'éviter les problèmes de CORS/mixed-content sur mobile.
const indexHtmlPath = path.join(DIST_DIR, "index.html");
if (SERVE_STATIC && fs.existsSync(indexHtmlPath)) {
  app.use(
    express.static(DIST_DIR, {
      index: false,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    return res.sendFile(indexHtmlPath);
  });
  console.log(`🖥️  Frontend servi depuis ${DIST_DIR}`);
} else if (SERVE_STATIC) {
  console.warn(
    `⚠️  SERVE_STATIC activé mais ${indexHtmlPath} est absent. Lancez \`npm run build\`.`,
  );
}

app.use((err, req, res, next) => {
  console.error("Erreur serveur non gérée:", err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`🚀 Server running on http://${displayHost}:${PORT}`);
  console.log(`📊 Database: SQLite initialized`);
  console.log(`🌐 APP_URL: ${APP_URL}`);
  console.log(
    `🔐 Authentification applicative: ${authEnabled ? "activée" : "désactivée"}`,
  );
  console.log(
    `🔒 CORS: origines locales${configuredOrigins.length ? ` + ${configuredOrigins.join(", ")}` : ""}`,
  );
});
