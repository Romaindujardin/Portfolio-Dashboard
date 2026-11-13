// Coffre de secrets d'intégration par profil.
//
// Les clés API (Gemini, Binance, Etherscan, CoinGecko, OpenSea) ne sont plus
// stockées dans user_settings / localStorage. Elles sont chiffrées au repos
// avec AES-256-GCM (server/lib/secrets.js) et ne sont jamais renvoyées au
// navigateur : l'API expose uniquement un état « configuré / non configuré ».

import fs from "fs";
import path from "path";
import { decryptJson, encryptJson } from "../lib/secrets.js";
import { nowIso } from "../lib/validate.js";

export const SECRET_KEYS = Object.freeze({
  geminiApiKey: "Google Gemini",
  binanceApiKey: "Binance (clé API)",
  binanceSecretKey: "Binance (secret)",
  etherscanApiKey: "Etherscan",
  coinGeckoApiKey: "CoinGecko",
  openSeaApiKey: "OpenSea",
  boursoCustomerId: "BoursoBank (identifiant client)",
  boursoPassword: "BoursoBank (mot de passe)",
});

export const SECRET_KEY_NAMES = Object.keys(SECRET_KEYS);

// Ancien nom utilisé dans les paramètres pour l'identifiant client BoursoBank.
// Il est migré vers boursoCustomerId puis supprimé des paramètres.
const LEGACY_SECRET_ALIASES = Object.freeze({
  boursoClientId: "boursoCustomerId",
});

export const isSecretKey = (key) =>
  Object.prototype.hasOwnProperty.call(SECRET_KEYS, String(key || ""));

const ensureTable = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_secrets (
      user_id        TEXT NOT NULL,
      key_name       TEXT NOT NULL,
      encrypted_json TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      PRIMARY KEY (user_id, key_name)
    );
  `);
};

const readSecretRow = (db, userId, keyName) => {
  ensureTable(db);
  return (
    db
      .prepare(
        "SELECT encrypted_json, updated_at FROM user_secrets WHERE user_id = ? AND key_name = ?",
      )
      .get(userId, keyName) || null
  );
};

export const getUserSecret = (db, userId, keyName) => {
  if (!userId || !isSecretKey(keyName)) return null;
  const row = readSecretRow(db, userId, keyName);
  if (!row) return null;
  try {
    const payload = decryptJson(row.encrypted_json);
    const value = payload?.value;
    return typeof value === "string" && value ? value : null;
  } catch (error) {
    console.warn(
      `⚠️ Secret ${keyName} illisible pour ${userId}: ${error.message}`,
    );
    return null;
  }
};

export const setUserSecret = (db, userId, keyName, value) => {
  if (!userId) throw new Error("Utilisateur requis");
  if (!isSecretKey(keyName)) throw new Error("Clé de secret inconnue");
  if (typeof value !== "string") throw new Error("Valeur du secret invalide");
  const clean = value.trim();
  if (!clean) throw new Error("Valeur du secret vide");
  if (clean.length > 20_000) throw new Error("Valeur du secret trop longue");

  ensureTable(db);
  const encrypted = encryptJson({ value: clean });
  db.prepare(
    `INSERT INTO user_secrets (user_id, key_name, encrypted_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, key_name) DO UPDATE SET
       encrypted_json = excluded.encrypted_json,
       updated_at = excluded.updated_at`,
  ).run(userId, keyName, encrypted, nowIso());
  return { success: true, key: keyName, configured: true };
};

export const deleteUserSecret = (db, userId, keyName) => {
  if (!userId || !isSecretKey(keyName)) return false;
  ensureTable(db);
  const result = db
    .prepare("DELETE FROM user_secrets WHERE user_id = ? AND key_name = ?")
    .run(userId, keyName);
  return result.changes > 0;
};

export const deleteUserSecrets = (db, userId) => {
  if (!userId) return;
  ensureTable(db);
  db.prepare("DELETE FROM user_secrets WHERE user_id = ?").run(userId);
};

export const getUserSecretStatuses = (db, userId) => {
  ensureTable(db);
  const rows = db
    .prepare(
      "SELECT key_name, updated_at FROM user_secrets WHERE user_id = ?",
    )
    .all(userId);
  const byKey = new Map(rows.map((row) => [row.key_name, row.updated_at]));
  const statuses = {};
  for (const keyName of SECRET_KEY_NAMES) {
    statuses[keyName] = {
      configured: byKey.has(keyName),
      updatedAt: byKey.get(keyName) || null,
      label: SECRET_KEYS[keyName],
    };
  }
  return statuses;
};

export const extractSecretsFromSettings = (settings) => {
  if (!settings || typeof settings !== "object") return {};
  const secrets = {};
  for (const keyName of SECRET_KEY_NAMES) {
    const value = settings[keyName];
    if (typeof value === "string" && value.trim()) {
      secrets[keyName] = value.trim();
    }
  }
  for (const [alias, keyName] of Object.entries(LEGACY_SECRET_ALIASES)) {
    const value = settings[alias];
    if (typeof value === "string" && value.trim() && !secrets[keyName]) {
      secrets[keyName] = value.trim();
    }
  }
  return secrets;
};

export const sanitizeUserSettings = (settings) => {
  if (!settings || typeof settings !== "object") return settings;
  const sanitized = { ...settings };
  for (const keyName of SECRET_KEY_NAMES) {
    delete sanitized[keyName];
  }
  for (const alias of Object.keys(LEGACY_SECRET_ALIASES)) {
    delete sanitized[alias];
  }
  return sanitized;
};

/**
 * Migre les secrets éventuellement présents en clair dans un objet settings
 * vers le coffre chiffré, puis renvoie une copie assainie.
 */
export const migrateUserSettingsSecrets = (db, userId, settings) => {
  if (!settings || typeof settings !== "object") return settings;
  const secrets = extractSecretsFromSettings(settings);
  for (const [keyName, value] of Object.entries(secrets)) {
    const existing = readSecretRow(db, userId, keyName);
    if (!existing) {
      setUserSecret(db, userId, keyName, value);
    }
  }
  return sanitizeUserSettings(settings);
};

const writeJsonSecure = (filepath, data) => {
  const tmp = `${filepath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {}
  fs.renameSync(tmp, filepath);
  try {
    fs.chmodSync(filepath, 0o600);
  } catch {}
};

/**
 * Migre les identifiants Binance historiquement stockés dans
 * accounts.metadata_json (chiffrés via credentialsEncrypted ou, plus
 * anciennement, en clair via apiKey/apiSecret) vers le coffre par profil.
 * Les métadonnées sensibles sont ensuite retirées du compte.
 */
export const migrateLegacyBinanceCredentials = (db) => {
  let migrated = 0;
  try {
    const rows = db
      .prepare(
        "SELECT id, user_id, metadata_json FROM accounts WHERE provider = 'binance' AND metadata_json IS NOT NULL",
      )
      .all();
    for (const row of rows) {
      let metadata = null;
      try {
        metadata = JSON.parse(row.metadata_json);
      } catch {
        continue;
      }
      if (!metadata || typeof metadata !== "object") continue;

      const encrypted =
        typeof metadata.credentialsEncrypted === "string"
          ? metadata.credentialsEncrypted.trim()
          : "";
      const plainApiKey =
        typeof metadata.apiKey === "string" ? metadata.apiKey.trim() : "";
      const plainApiSecret =
        typeof metadata.apiSecret === "string"
          ? metadata.apiSecret.trim()
          : "";
      if (!encrypted && !plainApiKey && !plainApiSecret) continue;

      let legacy = null;
      let decrypted = false;
      if (encrypted) {
        try {
          legacy = decryptJson(encrypted);
          decrypted = true;
        } catch (error) {
          // On conserve la métadonnée chiffrée : une clé de coffre restaurée
          // pourra encore permettre de récupérer les identifiants. Les clés en
          // clair éventuellement présentes sont tout de même migrées.
          console.warn(
            `⚠️ Identifiants Binance historiques illisibles pour le compte ${row.id}: ${error.message}`,
          );
          if (!plainApiKey && !plainApiSecret) continue;
        }
      }
      if (!legacy || typeof legacy !== "object") legacy = {};

      const apiKey =
        plainApiKey ||
        (typeof legacy.apiKey === "string" ? legacy.apiKey.trim() : "");
      const apiSecret =
        plainApiSecret ||
        (typeof legacy.apiSecret === "string" ? legacy.apiSecret.trim() : "");
      if (apiKey && !getUserSecret(db, row.user_id, "binanceApiKey")) {
        setUserSecret(db, row.user_id, "binanceApiKey", apiKey);
      }
      if (apiSecret && !getUserSecret(db, row.user_id, "binanceSecretKey")) {
        setUserSecret(db, row.user_id, "binanceSecretKey", apiSecret);
      }

      const cleaned = { ...metadata };
      delete cleaned.apiKeyMasked;
      delete cleaned.apiKey;
      delete cleaned.apiSecret;
      if (decrypted) delete cleaned.credentialsEncrypted;
      db.prepare(
        "UPDATE accounts SET metadata_json = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(cleaned), nowIso(), row.id);
      migrated += 1;
    }
  } catch (error) {
    console.warn(
      `⚠️ Migration des identifiants Binance impossible: ${error.message}`,
    );
  }
  return migrated;
};

/**
 * Migration au démarrage : purge les secrets en clair de user_settings (DB)
 * et des miroirs data/user_settings_*.json. Ne journalise jamais les valeurs.
 */
export const migrateLegacyUserSecrets = (db, dataDir = path.join(process.cwd(), "data")) => {
  ensureTable(db);
  let dbMigrated = 0;
  let filesMigrated = 0;
  const binanceMigrated = migrateLegacyBinanceCredentials(db);

  try {
    const rows = db
      .prepare("SELECT user_id, settings_json FROM user_settings")
      .all();
    for (const row of rows) {
      let parsed = null;
      try {
        parsed = JSON.parse(row.settings_json);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      const secrets = extractSecretsFromSettings(parsed);
      if (Object.keys(secrets).length === 0) continue;
      const sanitized = migrateUserSettingsSecrets(db, row.user_id, parsed);
      db.prepare(
        "UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?",
      ).run(JSON.stringify(sanitized), nowIso(), row.user_id);
      dbMigrated += 1;
    }
  } catch (error) {
    console.warn(`⚠️ Migration des secrets DB impossible: ${error.message}`);
  }

  try {
    if (fs.existsSync(dataDir)) {
      for (const filename of fs.readdirSync(dataDir)) {
        const match = /^user_settings_([A-Za-z0-9_-]{1,64})\.json$/.exec(filename);
        if (!match) continue;
        const userId = match[1];
        const filepath = path.join(dataDir, filename);
        let parsed = null;
        try {
          parsed = JSON.parse(fs.readFileSync(filepath, "utf8"));
        } catch {
          continue;
        }
        const secrets = extractSecretsFromSettings(parsed);
        if (Object.keys(secrets).length === 0) continue;
        const sanitized = migrateUserSettingsSecrets(db, userId, parsed);
        writeJsonSecure(filepath, sanitized);
        filesMigrated += 1;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Migration des secrets disque impossible: ${error.message}`);
  }

  if (dbMigrated || filesMigrated || binanceMigrated) {
    console.log(
      `🔐 Secrets migrés vers le coffre chiffré : ${dbMigrated} profil(s) DB, ${filesMigrated} fichier(s), ${binanceMigrated} compte(s) Binance.`,
    );
  }
  return { dbMigrated, filesMigrated, binanceMigrated };
};

export default {
  SECRET_KEYS,
  SECRET_KEY_NAMES,
  isSecretKey,
  getUserSecret,
  setUserSecret,
  deleteUserSecret,
  deleteUserSecrets,
  getUserSecretStatuses,
  extractSecretsFromSettings,
  sanitizeUserSettings,
  migrateUserSettingsSecrets,
  migrateLegacyBinanceCredentials,
  migrateLegacyUserSecrets,
};
