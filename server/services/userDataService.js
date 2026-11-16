// Suppression complète et atomique des données d'un profil.
//
// L'ancienne suppression ne retirait que les wallets et les CSV, en laissant
// les identifiants, les secrets, les transactions bancaires, l'immobilier,
// les prêts et les sauvegardes disque. Ce service centralise le nettoyage.

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const TABLES_WITH_USER_ID = [
  "transactions",
  "holdings",
  "balance_snapshots",
  "sync_runs",
  "properties",
  "loans",
  "connectors",
  "accounts",
  "bank_csv_uploads",
  "tricount_expenses",
  "tricount_incomes",
  "tricount_configs",
  "savings_strategies",
  "savings_monthly_strategies",
  "user_settings",
];

// Tables historiques présentes dans certaines bases seulement. Leur absence
// ne doit pas empêcher la suppression d'un profil.
const OPTIONAL_TABLES_WITH_USER_ID = ["investments", "watchlist"];

const BACKUP_FILE_RE = /^portfolio-(?:backup|before-restore)-.+\.db$/;

const resolveBackupDir = (backupDir) =>
  path.resolve(backupDir || process.env.BACKUP_DIR || path.join(process.cwd(), "backups"));

const tableExists = (db, table) =>
  Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(table),
  );

const safeUserId = (value) => {
  const clean = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(clean) ? clean : null;
};

const removeDiskMirrors = (userId) => {
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) return 0;
  let removed = 0;
  for (const filename of fs.readdirSync(dataDir)) {
    const isUserFile =
      filename === `user_settings_${userId}.json` ||
      filename === `tricount_${userId}.json` ||
      filename === `savings_strategy_${userId}.json` ||
      filename === `savings_monthly_${userId}.json`;
    if (!isUserFile) continue;
    try {
      fs.unlinkSync(path.join(dataDir, filename));
      removed += 1;
    } catch {}
  }
  return removed;
};

/**
 * Transfère les comptes partagés dont le profil supprimé est propriétaire vers
 * un co-owner, afin que la suppression ne détruise pas les données des autres
 * profils via les cascades de clés étrangères.
 *
 * Les lignes rattachées au compte (transactions, holdings, snapshots) sont
 * réattribuées au nouveau propriétaire. Une connexion bancaire appartenant au
 * profil supprimé est détachée : le compte reste consultable en manuel.
 */
const transferSharedAccounts = (db, userId) => {
  if (!tableExists(db, "accounts") || !tableExists(db, "account_ownerships")) {
    return 0;
  }
  const hasConnectors = tableExists(db, "connectors");
  const accounts = db
    .prepare(
      `SELECT a.id,
              (SELECT o.owner_name
                 FROM account_ownerships o
                WHERE o.account_id = a.id
                  AND o.owner_name <> ?
                  AND o.share_percent > 0
                ORDER BY o.share_percent DESC, o.created_at ASC, o.owner_name ASC
                LIMIT 1) AS new_owner
         FROM accounts a
        WHERE a.user_id = ?`,
    )
    .all(userId, userId)
    .filter((row) => row.id && row.new_owner);

  if (accounts.length === 0) return 0;

  const now = new Date().toISOString();
  const updateAccount = db.prepare(
    hasConnectors
      ? `UPDATE accounts
            SET user_id = ?, updated_at = ?,
                connection_id = CASE
                  WHEN connection_id IN (SELECT id FROM connectors WHERE user_id = ?)
                    THEN NULL
                  ELSE connection_id
                END
          WHERE id = ?`
      : `UPDATE accounts SET user_id = ?, updated_at = ? WHERE id = ?`,
  );
  const reassign = (table) =>
    tableExists(db, table)
      ? db.prepare(
          `UPDATE ${table} SET user_id = ? WHERE account_id = ? AND user_id = ?`,
        )
      : null;

  const updateTransactions = reassign("transactions");
  const updateHoldings = reassign("holdings");
  const updateSnapshots = reassign("balance_snapshots");

  for (const account of accounts) {
    updateTransactions?.run(account.new_owner, account.id, userId);
    updateHoldings?.run(account.new_owner, account.id, userId);
    updateSnapshots?.run(account.new_owner, account.id, userId);
    if (hasConnectors) {
      updateAccount.run(account.new_owner, now, userId, account.id);
    } else {
      updateAccount.run(account.new_owner, now, account.id);
    }
  }
  return accounts.length;
};

/**
 * Supprime les lignes personnelles d'un profil dans une base donnée (live ou
 * copie de sauvegarde). Les tables absentes des anciennes sauvegardes sont
 * ignorées : la purge d'une copie ne doit jamais échouer sur un schéma ancien.
 */
const deleteUserRows = (db, userId, counts = {}) => {
  const deleteFrom = (table) => {
    if (!tableExists(db, table)) return 0;
    return db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId)
      .changes;
  };

  // Les tables enfants sans user_id doivent être supprimées avant leurs
  // parents. Les clés étrangères font le reste en cascade.
  if (tableExists(db, "wallets")) {
    if (tableExists(db, "wallet_assets")) {
      db.prepare(
        "DELETE FROM wallet_assets WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ?)",
      ).run(userId);
    }
    if (tableExists(db, "wallet_nfts")) {
      db.prepare(
        "DELETE FROM wallet_nfts WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ?)",
      ).run(userId);
    }
    counts.wallets = db.prepare("DELETE FROM wallets WHERE user_id = ?").run(userId)
      .changes;
  }

  if (tableExists(db, "properties") && tableExists(db, "property_valuations")) {
    db.prepare(
      "DELETE FROM property_valuations WHERE property_id IN (SELECT id FROM properties WHERE user_id = ?)",
    ).run(userId);
  }

  // Un compte partagé ne doit jamais être emporté par la cascade FK quand
  // son propriétaire supprime son profil : on transfère d'abord la propriété.
  counts.accountsTransferred = transferSharedAccounts(db, userId);

  // Les parts de propriété ne portent pas de user_id mais un owner_name :
  // elles doivent aussi disparaître quand le profil est supprimé.
  if (tableExists(db, "account_ownerships")) {
    counts.account_ownerships = db
      .prepare("DELETE FROM account_ownerships WHERE owner_name = ?")
      .run(userId).changes;
  }

  const tables = [
    ...TABLES_WITH_USER_ID,
    ...OPTIONAL_TABLES_WITH_USER_ID.filter((table) => tableExists(db, table)),
  ];
  for (const table of tables) {
    counts[table] = deleteFrom(table);
  }

  if (tableExists(db, "user_secrets")) {
    counts.user_secrets = db
      .prepare("DELETE FROM user_secrets WHERE user_id = ?")
      .run(userId).changes;
  }
  if (tableExists(db, "user_credentials")) {
    counts.user_credentials = db
      .prepare("DELETE FROM user_credentials WHERE username = ?")
      .run(userId).changes;
  }
  return counts;
};

const backupContainsUser = (db, userId) => {
  const checks = [
    ["user_credentials", "username"],
    ["user_secrets", "user_id"],
    ["wallets", "user_id"],
    ...TABLES_WITH_USER_ID.map((table) => [table, "user_id"]),
    ...OPTIONAL_TABLES_WITH_USER_ID.map((table) => [table, "user_id"]),
    ["account_ownerships", "owner_name"],
  ];
  for (const [table, column] of checks) {
    if (!tableExists(db, table)) continue;
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(userId)) {
      return true;
    }
  }
  return false;
};

/**
 * Purge immédiatement le profil des sauvegardes SQLite accessibles.
 *
 * Les sauvegardes sont normalement des copies immuables ; pour respecter la
 * suppression d'un profil, on y applique la même suppression logique avant de
 * compacter la copie. La date de modification d'origine est restaurée afin que
 * la politique de rétention continue de s'appliquer normalement.
 */
const scrubBackupsOfUser = (userId, { backupDir } = {}) => {
  const dir = resolveBackupDir(backupDir);
  const result = { dir, scanned: 0, scrubbed: [], failed: [] };
  if (!fs.existsSync(dir)) return result;

  for (const filename of fs.readdirSync(dir)) {
    if (!BACKUP_FILE_RE.test(filename)) continue;
    const filepath = path.join(dir, filename);
    let stat;
    try {
      stat = fs.statSync(filepath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    result.scanned += 1;

    let backupDb = null;
    try {
      backupDb = new Database(filepath);
      backupDb.pragma("busy_timeout = 2000");
      if (!backupContainsUser(backupDb, userId)) continue;

      backupDb.pragma("secure_delete = ON");
      const scrub = backupDb.transaction(() =>
        deleteUserRows(backupDb, userId),
      );
      scrub();
      try {
        backupDb.pragma("wal_checkpoint(TRUNCATE)");
      } catch {}
      try {
        backupDb.exec("VACUUM");
      } catch {}
      backupDb.close();
      backupDb = null;

      for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${filepath}${suffix}`, { force: true });
      }
      try {
        fs.utimesSync(filepath, stat.atime, stat.mtime);
      } catch {}
      result.scrubbed.push(filename);
    } catch (error) {
      result.failed.push({ file: filename, error: error.message });
      console.warn(
        `⚠️ Purge du profil ${userId} dans la sauvegarde ${filename}: ${error.message}`,
      );
    } finally {
      try {
        backupDb?.close();
      } catch {}
    }
  }

  return result;
};

/**
 * Supprime toutes les lignes rattachées au profil et ses miroirs disque.
 * Les tables partagées (price_cache, security_master, integration_settings)
 * ne sont jamais touchées : elles ne contiennent pas de données personnelles.
 */
export const deleteUserData = (db, username, { backupDir } = {}) => {
  const userId = safeUserId(username);
  if (!userId) throw new Error("Nom d'utilisateur invalide");

  const counts = {};
  // secure_delete zéroïse les pages libérées ; le checkpoint + VACUUM évite
  // qu'elles restent récupérables dans le fichier SQLite ou son WAL.
  try {
    db.pragma("secure_delete = ON");
  } catch {}

  const run = db.transaction(() => {
    deleteUserRows(db, userId, counts);
  });
  run();

  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {}
  try {
    db.exec("VACUUM");
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    console.warn(`⚠️ VACUUM après suppression du profil ${userId}: ${error.message}`);
  }

  const diskFiles = removeDiskMirrors(userId);
  const backups = scrubBackupsOfUser(userId, { backupDir });
  const failedNote =
    backups.failed.length > 0
      ? ` ${backups.failed.length} sauvegarde(s) n'ont pas pu être purgées ; relancez la suppression ou npm run db:prune-backups.`
      : "";
  return {
    success: true,
    username: userId,
    counts,
    diskFiles,
    backups,
    backupsNote:
      (backups.scrubbed.length > 0
        ? `Les ${backups.scrubbed.length} sauvegarde(s) serveur accessible(s) ont été purgées de ce profil. `
        : "Aucune sauvegarde serveur accessible ne contenait ce profil. ") +
      "Les copies externes restent soumises à la rétention (npm run db:prune-backups)." +
      failedNote,
  };
};

export default { deleteUserData };
