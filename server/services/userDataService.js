// Suppression complète et atomique des données d'un profil.
//
// L'ancienne suppression ne retirait que les wallets et les CSV, en laissant
// les identifiants, les secrets, les transactions bancaires, l'immobilier,
// les prêts et les sauvegardes disque. Ce service centralise le nettoyage.

import fs from "fs";
import path from "path";
import { deleteUserCredential } from "./authService.js";
import { deleteUserSecrets } from "./userSecretsService.js";

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
 * Supprime toutes les lignes rattachées au profil et ses miroirs disque.
 * Les tables partagées (price_cache, security_master, integration_settings)
 * ne sont jamais touchées : elles ne contiennent pas de données personnelles.
 */
export const deleteUserData = (db, username) => {
  const userId = safeUserId(username);
  if (!userId) throw new Error("Nom d'utilisateur invalide");

  const counts = {};
  const run = db.transaction(() => {
    // Les tables enfants sans user_id doivent être supprimées avant leurs
    // parents. Les clés étrangères font le reste en cascade.
    db.prepare(
      "DELETE FROM wallet_assets WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ?)",
    ).run(userId);
    db.prepare(
      "DELETE FROM wallet_nfts WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ?)",
    ).run(userId);
    counts.wallets = db
      .prepare("DELETE FROM wallets WHERE user_id = ?")
      .run(userId).changes;

    db.prepare(
      "DELETE FROM property_valuations WHERE property_id IN (SELECT id FROM properties WHERE user_id = ?)",
    ).run(userId);

    // Les parts de propriété ne portent pas de user_id mais un owner_name :
    // elles doivent aussi disparaître quand le profil est supprimé.
    counts.account_ownerships = db
      .prepare("DELETE FROM account_ownerships WHERE owner_name = ?")
      .run(userId).changes;

    for (const table of TABLES_WITH_USER_ID) {
      const result = db
        .prepare(`DELETE FROM ${table} WHERE user_id = ?`)
        .run(userId);
      counts[table] = result.changes;
    }

    deleteUserSecrets(db, userId);
    deleteUserCredential(db, userId);
  });
  run();

  const diskFiles = removeDiskMirrors(userId);
  return { success: true, username: userId, counts, diskFiles };
};

export default { deleteUserData };
