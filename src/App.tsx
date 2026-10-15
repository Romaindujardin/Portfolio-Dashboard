import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import TopHeader from "./components/TopHeader";
import Dashboard from "./pages/Dashboard";
import Investments from "./pages/Investments";
import MarketTracking from "./pages/MarketTracking";
import BudgetTricount from "./pages/BudgetTricount";
import Savings from "./pages/Savings";
import AIAnalysis from "./pages/AIAnalysis";
import Settings from "./pages/Settings";
import Banking from "./pages/Banking";
import GeminiChatBubble from "./components/GeminiChatBubble";
import ErrorBoundary from "./components/ErrorBoundary";
import { UserProvider } from "./contexts/UserContext";
import { initializePriceUpdateManager } from "./utils/priceUpdateManager";
import { initializeCryptoDatabase } from "./utils/cryptoDatabase";
import { initializeStockDatabase } from "./utils/stockDatabase";

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
          error,
        );
        // Continuer même en cas d'erreur pour que l'app reste utilisable
        setIsReady(true);
      }
    };

    initializeDatabases();
  }, []);

  if (!isReady) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full border-2 border-[rgba(255,255,255,0.06)]"></div>
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#c8a55e] animate-spin"></div>
          </div>
          <p className="text-[#8a8a8a] text-sm">
            Chargement des données de marché...
          </p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <UserProvider>
        <div className="min-h-screen bg-[#0a0a0a]">
          <Sidebar />
          <main className="main-content">
            <TopHeader />
            <div className="max-w-[1400px] mx-auto px-6 py-8">
              <ErrorBoundary fallbackTitle="Erreur de chargement de la page">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/investments" element={<Investments />} />
                  <Route path="/budget" element={<BudgetTricount />} />
                  <Route path="/budget-tracking" element={<BudgetTricount />} />
                  <Route path="/tricount" element={<BudgetTricount />} />
                  <Route path="/market-tracking" element={<BudgetTricount />} />
                  <Route path="/savings" element={<Savings />} />
                  <Route path="/news" element={<Savings />} />
                  <Route path="/ai-analysis" element={<AIAnalysis />} />
                  <Route path="/banking" element={<Banking />} />
                  <Route path="/settings/:username" element={<Settings />} />
                </Routes>
              </ErrorBoundary>
            </div>
          </main>
          <GeminiChatBubble />
        </div>
      </UserProvider>
    </Router>
  );
}

export default App;
