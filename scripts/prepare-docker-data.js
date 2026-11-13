#!/usr/bin/env node
// Prépare data/portfolio.db pour Docker à partir de la base locale portfolio.db.
//
// Docker utilise /app/data/portfolio.db (volume ./data:/app/data). Sans cette
// étape, le conteneur démarre sur une base vide. La copie passe par l'API
// backup de SQLite : elle est cohérente même si la base est en mode WAL, et
// elle n'écrit jamais dans la base source.
//
// Le script refuse d'écraser une base Docker non vide sans --force.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const source = path.resolve(
  process.env.SOURCE_DATABASE_PATH || path.join(REPO_ROOT, "portfolio.db"),
);
const destination = path.resolve(
  process.env.DOCKER_DATABASE_PATH ||
    path.join(REPO_ROOT, "data", "portfolio.db"),
);
const force = process.argv.includes("--force");

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

if (source === destination) {
  fail("La source et la destination sont identiques.");
}
if (!fs.existsSync(source)) {
  fail(`Base source introuvable : ${source}`);
}
if (fs.statSync(source).size === 0) {
  fail(`La base source est vide : ${source}`);
}
if (fs.existsSync(destination)) {
  const destinationSize = fs.statSync(destination).size;
  if (destinationSize > 0 && !force) {
    fail(
      `La base Docker existe déjà et contient des données : ${destination}. ` +
        "Utilisez --force uniquement si vous êtes certain de vouloir la remplacer.",
    );
  }
}
if (
  !force &&
  (fs.existsSync(`${destination}-wal`) || fs.existsSync(`${destination}-shm`))
) {
  fail(
    `Des fichiers -wal/-shm existent pour ${destination} : un conteneur ou un ` +
      "serveur utilise probablement cette base. Arrêtez-le, puis relancez. " +
      "Utilisez --force uniquement si vous êtes certain que personne n'écrit dedans.",
  );
}
if (fs.existsSync(`${source}-wal`) || fs.existsSync(`${source}-shm`)) {
  console.warn(
    "⚠️  La base source a des fichiers -wal/-shm : la copie SQLite reste " +
      "cohérente, mais arrêtez l'application locale pour une sauvegarde au repos.",
  );
}

fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(path.dirname(destination), 0o700);
} catch {}

// Une ancienne copie peut avoir laissé des fichiers WAL/SHM : on les retire
// avant de créer la nouvelle base.
for (const suffix of ["-wal", "-shm"]) {
  fs.rmSync(`${destination}${suffix}`, { force: true });
}

const db = new Database(source, { fileMustExist: true });
try {
  await db.backup(destination);
} finally {
  db.close();
}

const copy = new Database(destination, {
  readonly: true,
  fileMustExist: true,
});
try {
  const integrity = copy.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    fail(`Copie corrompue : ${integrity}`);
  }
  const tables = new Set(
    copy
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  for (const required of ["accounts", "transactions", "user_settings"]) {
    if (!tables.has(required)) {
      fail(`La copie ne contient pas la table ${required}.`);
    }
  }
  const counts = {};
  for (const table of [
    "accounts",
    "transactions",
    "user_credentials",
    "user_secrets",
  ]) {
    counts[table] = copy
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get().n;
  }
  console.log("📊 Copie vérifiée :", counts);
} finally {
  copy.close();
}

for (const suffix of ["-wal", "-shm"]) {
  fs.rmSync(`${destination}${suffix}`, { force: true });
}
try {
  fs.chmodSync(destination, 0o600);
} catch {}

const sizeMb = (fs.statSync(destination).size / (1024 * 1024)).toFixed(2);
console.log(`✅ Base Docker prête : ${destination} (${sizeMb} MB)`);
console.log(
  "   Pensez aussi à copier data/.portfolio-secret et data/.portfolio-session-secret.",
);
