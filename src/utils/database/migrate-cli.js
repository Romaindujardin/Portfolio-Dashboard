#!/usr/bin/env node

import {
  migrateFromLocalStorage,
  cleanupLocalStorage,
  needsMigration,
  showLocalStorageData,
} from "./migrate.js";

async function runMigration() {
  console.log("🔄 Script de migration localStorage → SQLite");

  try {
    // Vérifier s'il y a des données à migrer
    if (!needsMigration()) {
      console.log("ℹ️ Aucune donnée localStorage trouvée à migrer");
      return;
    }

    // Afficher les données actuelles
    showLocalStorageData();

    // Exécuter la migration
    console.log("\n🔄 Début de la migration...");
    await migrateFromLocalStorage();

    // Demander si on veut nettoyer localStorage
    console.log(
      "\n❓ Voulez-vous nettoyer le localStorage après migration ? (y/N)"
    );
    console.log("✅ Nettoyage automatique...");
    cleanupLocalStorage();

    console.log("\n✅ Migration terminée avec succès !");
    console.log("📊 Vos données sont maintenant stockées dans SQLite");
  } catch (error) {
    console.error("❌ Erreur lors de la migration:", error);
    process.exit(1);
  }
}

// Exécuter si appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration();
}

export { runMigration };
