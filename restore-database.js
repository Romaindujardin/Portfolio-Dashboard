#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "portfolio.db");
const backupDir = path.join(__dirname, "backups");

console.log("🔄 Restauration de la base de données...");

try {
  // Vérifier si le dossier de sauvegarde existe
  if (!fs.existsSync(backupDir)) {
    console.log("❌ Dossier de sauvegarde non trouvé");
    process.exit(1);
  }

  // Lister les sauvegardes disponibles
  const files = fs.readdirSync(backupDir)
    .filter(file => file.startsWith('portfolio-backup-'))
    .map(file => ({
      name: file,
      path: path.join(backupDir, file),
      time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  if (files.length === 0) {
    console.log("❌ Aucune sauvegarde trouvée");
    process.exit(1);
  }

  console.log("📋 Sauvegardes disponibles:");
  files.forEach((file, index) => {
    const date = new Date(file.time).toLocaleString();
    const size = (fs.statSync(file.path).size / (1024 * 1024)).toFixed(2);
    console.log(`  ${index + 1}. ${file.name} (${date}) - ${size} MB`);
  });

  // Utiliser la sauvegarde la plus récente par défaut
  const selectedBackup = files[0];
  console.log(`\n🔄 Restauration depuis: ${selectedBackup.name}`);

  // Créer une sauvegarde de la base actuelle avant restauration
  if (fs.existsSync(dbPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const currentBackup = path.join(backupDir, `portfolio-before-restore-${timestamp}.db`);
    fs.copyFileSync(dbPath, currentBackup);
    console.log(`💾 Sauvegarde de la base actuelle: ${currentBackup}`);
  }

  // Restaurer la base de données
  fs.copyFileSync(selectedBackup.path, dbPath);
  
  const restoredSize = (fs.statSync(dbPath).size / (1024 * 1024)).toFixed(2);
  console.log(`✅ Restauration terminée`);
  console.log(`📊 Taille restaurée: ${restoredSize} MB`);

} catch (error) {
  console.error("❌ Erreur lors de la restauration:", error.message);
  process.exit(1);
} 