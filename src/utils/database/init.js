#!/usr/bin/env node

import DatabaseManager from "./database.js";

async function initializeDatabase() {
  console.log("🚀 Initialisation de la base de données SQLite...");

  try {
    const dbManager = DatabaseManager.getInstance();

    // Initialiser les tables
    console.log("📋 Création des tables...");
    dbManager.initializeTables();

    // Afficher les statistiques finales
    const stats = dbManager.getDatabaseStats();
    console.log("\n📊 Statistiques de la base de données:");
    console.log(`   📈 Investissements: ${stats.investments}`);
    console.log(`   👀 Watchlist: ${stats.watchlist}`);
    console.log(`   👛 Wallets: ${stats.wallets}`);
    console.log(`   🪙 Assets: ${stats.assets}`);
    console.log(`   📁 Fichier: ${stats.databasePath}`);

    console.log("\n✅ Base de données initialisée avec succès !");
    console.log(
      "💡 Pour migrer des données localStorage, utilisez: npm run db:migrate"
    );
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation:", error);
    process.exit(1);
  }
}

// Exécuter si appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase();
}

export { initializeDatabase };
