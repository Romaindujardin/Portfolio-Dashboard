import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import Investments from "./pages/Investments";
import MarketTracking from "./pages/MarketTracking";
import News from "./pages/News";
import AIAnalysis from "./pages/AIAnalysis";
import Settings from "./pages/Settings";
import Banking from "./pages/Banking";
import GeminiChatBubble from "./components/GeminiChatBubble";
import { UserProvider } from "./contexts/UserContext";
import { initializePriceUpdateManager } from "./utils/priceUpdateManager";
import { initializeCryptoDatabase } from "./utils/cryptoDatabase";
import { initializeStockDatabase } from "./utils/stockDatabase";
import "./utils/blockchainTest"; // Charger les fonctions de test

function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const initializeDatabases = async () => {
      console.log("🚀 Initialisation des bases de données...");

      try {
        // Initialiser les deux bases de données en parallèle
        await Promise.all([
          initializeCryptoDatabase(),
          initializeStockDatabase(),
        ]);

        // Initialiser le gestionnaire de mise à jour des prix
        initializePriceUpdateManager();

        setIsReady(true);
        console.log("🚀 Application prête avec bases de données initialisées");
      } catch (error) {
        console.error(
          "❌ Erreur lors de l'initialisation des bases de données:",
          error
        );
        // Continuer même en cas d'erreur pour que l'app reste utilisable
        setIsReady(true);
      }
    };

    initializeDatabases();
  }, []);

  if (!isReady) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">
            Chargement des données de marché...
          </p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <UserProvider>
        <div className="min-h-screen bg-gray-50 dark:bg-black">
          <Navbar />
          <main className="container mx-auto px-4 py-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/investments" element={<Investments />} />
              <Route path="/market-tracking" element={<MarketTracking />} />
              <Route path="/news" element={<News />} />
              <Route path="/ai-analysis" element={<AIAnalysis />} />
              <Route path="/banking" element={<Banking />} />
              <Route path="/settings/:username" element={<Settings />} />
            </Routes>
          </main>
          <GeminiChatBubble />
        </div>
      </UserProvider>
    </Router>
  );
}

export default App;
