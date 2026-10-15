import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // Tous les fichiers partagent le même serveur API et la même base SQLite de
    // test : exécution séquentielle pour éviter toute interférence.
    threads: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      // Le serveur (server.js) tourne dans un processus séparé : il est couvert
      // par les tests d'intégration mais non mesurable ici.
      include: ["src/utils/**/*.ts", "src/utils/database/database.js"],
    },
  },
});
