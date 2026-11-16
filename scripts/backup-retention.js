// Politique de rétention des sauvegardes SQLite.
//
// Les sauvegardes sont des copies immuables : supprimer un profil dans la base
// live ne peut pas effacer les copies déjà écrites. On applique donc une
// rétention explicite (30 jours par défaut) et on fournit un script de purge.

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_BACKUP_RETENTION_DAYS = 30;

const BACKUP_FILE_RE = /^portfolio-(?:backup|before-restore)-.+\.db$/;

const parseRetentionDays = (value, fallback = DEFAULT_BACKUP_RETENTION_DAYS) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

/**
 * Supprime les sauvegardes plus anciennes que `retentionDays`.
 * `retentionDays = 0` purge toutes les sauvegardes.
 */
export const pruneBackups = ({
  backupDir,
  retentionDays = DEFAULT_BACKUP_RETENTION_DAYS,
  now = Date.now(),
  dryRun = false,
} = {}) => {
  if (!backupDir || !fs.existsSync(backupDir)) {
    return { removed: [], kept: [], retentionDays };
  }
  const days = parseRetentionDays(retentionDays);
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const removed = [];
  const kept = [];

  for (const file of fs.readdirSync(backupDir)) {
    if (!BACKUP_FILE_RE.test(file)) continue;
    const filepath = path.join(backupDir, file);
    let stat;
    try {
      stat = fs.statSync(filepath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.mtimeMs >= cutoff) {
      kept.push(file);
      continue;
    }
    if (!dryRun) {
      fs.rmSync(filepath, { force: true });
      for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${filepath}${suffix}`, { force: true });
      }
    }
    removed.push(file);
  }

  removed.sort();
  kept.sort();
  return { removed, kept, retentionDays: days };
};

export default { pruneBackups, DEFAULT_BACKUP_RETENTION_DAYS };
