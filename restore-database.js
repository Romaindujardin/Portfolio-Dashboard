#!/usr/bin/env node
// Restauration d'une sauvegarde SQLite.
//
// Sécurités :
// - refuse de restaurer si un serveur semble encore utiliser la base
//   (fichiers -wal/-shm présents), sauf avec --force ;
// - valide l'intégrité de la sauvegarde avant de toucher à la base ;
// - crée une sauvegarde de sécurité de la base actuelle ;
// - écrit la base restaurée en 0600 et supprime les anciens -wal/-shm.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Ce script vit à la racine du dépôt (contrairement à scripts/backup-database.js).
const REPO_ROOT = __dirname;
const dbPath = path.resolve(
  process.env.DATABASE_PATH || path.join(REPO_ROOT, "portfolio.db"),
);
const backupDir = path.resolve(
  process.env.BACKUP_DIR || path.join(REPO_ROOT, "backups"),
);

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = args.find((arg) => !arg.startsWith("--"));

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const removeSidecars = (basePath) => {
  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(`${basePath}${suffix}`, { force: true });
  }
};

const validateDatabase = (filepath) => {
  if (!fs.existsSync(filepath)) fail(`Fichier introuvable : ${filepath}`);
  const db = new Database(filepath, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma("integrity_check", { simple: true });
    if (result !== "ok") fail(`Sauvegarde corrompue : ${result}`);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    if (!tables.some((table) => table.name === "user_settings")) {
      fail("Ce fichier ne ressemble pas à une base Portfolio-Dashboard.");
    }
  } finally {
    db.close();
  }
};

console.log("🔄 Restauration de la base de données...");

if (!force && (fs.existsSync(`${dbPath}-wal`) || fs.existsSync(`${dbPath}-shm`))) {
  fail(
    "Des fichiers -wal/-shm indiquent que le serveur utilise encore la base. " +
      "Arrêtez le serveur, puis relancez. Utilisez --force uniquement si vous " +
      "êtes certain que personne n'écrit dans la base.",
  );
}

fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(backupDir, 0o700);
} catch {}

let selectedBackup;
if (requested) {
  selectedBackup = path.resolve(requested);
} else {
  const files = fs
    .readdirSync(backupDir)
    .filter((file) => file.endsWith(".db"))
    .map((file) => {
      const filepath = path.join(backupDir, file);
      return { file, filepath, time: fs.statSync(filepath).mtime.getTime() };
    })
    .sort((a, b) => b.time - a.time);

  if (!files.length) fail(`Aucune sauvegarde trouvée dans ${backupDir}`);

  console.log("📋 Sauvegardes disponibles :");
  files.forEach((file, index) => {
    const date = new Date(file.time).toLocaleString();
    const size = (fs.statSync(file.filepath).size / (1024 * 1024)).toFixed(2);
    console.log(`  ${index + 1}. ${file.file} (${date}) - ${size} MB`);
  });
  selectedBackup = files[0].filepath;
}

console.log(`\n🔄 Sauvegarde sélectionnée : ${selectedBackup}`);
validateDatabase(selectedBackup);

// Sauvegarde de sécurité de la base actuelle avant remplacement.
if (fs.existsSync(dbPath)) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safety = path.join(backupDir, `portfolio-before-restore-${timestamp}.db`);
  const current = new Database(dbPath, { fileMustExist: true });
  try {
    current.pragma("wal_checkpoint(TRUNCATE)");
    await current.backup(safety);
  } finally {
    current.close();
  }
  removeSidecars(safety);
  try {
    fs.chmodSync(safety, 0o600);
  } catch {}
  console.log(`💾 Base actuelle sauvegardée : ${safety}`);
}

const tempPath = `${dbPath}.restore-${process.pid}.tmp`;
fs.rmSync(tempPath, { force: true });
const source = new Database(selectedBackup, {
  readonly: true,
  fileMustExist: true,
});
try {
  await source.backup(tempPath);
} finally {
  source.close();
}
try {
  fs.chmodSync(tempPath, 0o600);
} catch {}
validateDatabase(tempPath);
removeSidecars(tempPath);
fs.renameSync(tempPath, dbPath);
try {
  fs.chmodSync(dbPath, 0o600);
} catch {}
removeSidecars(dbPath);

validateDatabase(dbPath);
removeSidecars(dbPath);
const restoredSize = (fs.statSync(dbPath).size / (1024 * 1024)).toFixed(2);
console.log("✅ Restauration terminée");
console.log(`📊 Taille restaurée : ${restoredSize} MB`);
