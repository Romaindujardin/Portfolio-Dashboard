import { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import TopHeader from "./components/TopHeader";
import Dashboard from "./pages/Dashboard";
import BudgetTricount from "./pages/BudgetTricount";
import Strategy from "./pages/Strategy";
import Savings from "./pages/Savings";
import AIAnalysis from "./pages/AIAnalysis";
import Settings from "./pages/Settings";
import Banking from "./pages/Banking";
import Patrimoine from "./pages/Patrimoine";
import ErrorBoundary from "./components/ErrorBoundary";
import { UserProvider } from "./contexts/UserContext";
import { initializeCryptoDatabase } from "./utils/cryptoDatabase";

function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const initializeDatabases = async () => {
      console.log("🚀 Initialisation des bases de données...");

      try {
        // Initialiser la base de données crypto (noms/logos des cryptos)
        await initializeCryptoDatabase();

        setIsReady(true);
        console.log("🚀 Application prête");
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
            Chargement de l'application...
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
                  <Route path="/investments" element={<Navigate to="/patrimoine?tab=crypto" replace />} />
                  <Route path="/budget" element={<BudgetTricount />} />
                  <Route path="/strategy" element={<Strategy />} />
                  <Route path="/savings" element={<Savings />} />
                  <Route path="/ai-analysis" element={<AIAnalysis />} />
                  <Route path="/banking" element={<Banking />} />
                  <Route path="/patrimoine" element={<Patrimoine />} />
                  <Route path="/settings/:username" element={<Settings />} />
                </Routes>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </UserProvider>
    </Router>
  );
}

export default App;
