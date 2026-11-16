#!/usr/bin/env node
// Purge des sauvegardes SQLite selon la politique de rétention.
//
// Usage :
//   npm run db:prune-backups            # rétention par défaut (30 jours)
//   npm run db:prune-backups -- --days 7
//   npm run db:prune-backups -- --dry-run
//
// Variables d'environnement : BACKUP_DIR, BACKUP_RETENTION_DAYS.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  pruneBackups,
} from "./backup-retention.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const backupDir = path.resolve(
  process.env.BACKUP_DIR || path.join(REPO_ROOT, "backups"),
);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysIndex = args.indexOf("--days");
const requestedDays =
  daysIndex >= 0 ? args[daysIndex + 1] : process.env.BACKUP_RETENTION_DAYS;
const parsedDays = Number(requestedDays);
const retentionDays =
  requestedDays !== undefined && Number.isFinite(parsedDays) && parsedDays >= 0
    ? Math.floor(parsedDays)
    : DEFAULT_BACKUP_RETENTION_DAYS;

const result = pruneBackups({
  backupDir,
  retentionDays,
  dryRun,
});

const action = dryRun ? "à supprimer" : "supprimée(s)";
console.log(
  `🧹 Rétention ${result.retentionDays} jour(s) — ${result.removed.length} sauvegarde(s) ${action}, ` +
    `${result.kept.length} conservée(s) dans ${backupDir}`,
);
for (const file of result.removed) {
  console.log(`   - ${file}`);
}
