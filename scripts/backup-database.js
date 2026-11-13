#!/usr/bin/env node
// Sauvegarde SQLite cohérente (API backup de SQLite) sans arrêter le serveur.
// La base et la sauvegarde sont limitées au propriétaire (0600).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const dbPath = path.resolve(
  process.env.DATABASE_PATH || path.join(REPO_ROOT, "portfolio.db"),
);
const backupDir = path.resolve(
  process.env.BACKUP_DIR || path.join(REPO_ROOT, "backups"),
);

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Base introuvable : ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(backupDir, 0o700);
} catch {}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(
  backupDir,
  `portfolio-backup-${timestamp}.db`,
);

const db = new Database(dbPath, { fileMustExist: true });
try {
  db.pragma("wal_checkpoint(TRUNCATE)");
  await db.backup(destination);
} catch (error) {
  fs.rmSync(destination, { force: true });
  throw error;
} finally {
  db.close();
}

// La copie hérite du mode WAL : on force un checkpoint puis on supprime les
// fichiers annexes pour que la sauvegarde reste un unique fichier .db.
try {
  const copy = new Database(destination);
  try {
    copy.pragma("wal_checkpoint(TRUNCATE)");
    const integrity = copy.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`Sauvegarde corrompue : ${integrity}`);
    }
  } finally {
    copy.close();
  }
} catch (error) {
  fs.rmSync(destination, { force: true });
  fs.rmSync(`${destination}-wal`, { force: true });
  fs.rmSync(`${destination}-shm`, { force: true });
  throw error;
}
for (const suffix of ["-wal", "-shm"]) {
  fs.rmSync(`${destination}${suffix}`, { force: true });
}

try {
  fs.chmodSync(destination, 0o600);
} catch {}

const sizeMb = (fs.statSync(destination).size / (1024 * 1024)).toFixed(2);
console.log(`✅ Sauvegarde créée : ${destination} (${sizeMb} MB)`);
