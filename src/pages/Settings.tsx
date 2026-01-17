import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "../contexts/UserContext";
import {
  Save,
  ArrowLeft,
  Eye,
  EyeOff,
  Copy,
  Check,
  Wallet,
  Loader2,
} from "lucide-react";
import {
  getUserSettings,
  saveUserSettings,
  UserSettings,
} from "../utils/userSettings";
import { getBinanceAccountInfo } from "../utils/binanceService";
import { addWallet, getStoredWallets } from "../utils/storage";

const Settings: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const [settings, setSettings] = useState<UserSettings>({
    binanceApiKey: "",
    binanceSecretKey: "",
    geminiApiKey: "",
    etherscanApiKey: "",
    coinGeckoApiKey: "",
    openSeaApiKey: "",
    customApiEndpoint: "",
    theme: "auto",
    currency: "USD",
    language: "fr",
  });

  // États pour gérer la visibilité des clés
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);
  const [showBinanceApi, setShowBinanceApi] = useState(false);
  const [showGeminiApi, setShowGeminiApi] = useState(false);
  const [showEtherscanApi, setShowEtherscanApi] = useState(false);
  const [showCoinGeckoApi, setShowCoinGeckoApi] = useState(false);
  const [showOpenSeaApi, setShowOpenSeaApi] = useState(false);

  // États pour gérer les boutons de copie
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // États pour la connexion Binance
  const [isConnectingBinance, setIsConnectingBinance] = useState(false);
  const [binanceConnectionStatus, setBinanceConnectionStatus] = useState<{
    type: "success" | "error" | "info" | null;
    message: string;
  }>({ type: null, message: "" });

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSettings();
  }, [username]);

  const loadSettings = () => {
    if (username) {
      const userSettings = getUserSettings(username);
      setSettings(userSettings);
    }
  };

  const saveSettings = async () => {
    if (!username) return;

    setIsLoading(true);
    try {
      saveUserSettings(username, settings);
      setMessage("Paramètres sauvegardés avec succès !");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      setMessage("Erreur lors de la sauvegarde des paramètres");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: keyof UserSettings, value: string) => {
    setSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error("Erreur lors de la copie:", error);
    }
  };

  const handleConnectBinance = async () => {
    if (!settings.binanceApiKey || !settings.binanceSecretKey) {
      setBinanceConnectionStatus({
        type: "error",
        message: "Veuillez d'abord saisir votre clé API et secret Binance",
      });
      return;
    }

    setIsConnectingBinance(true);
    setBinanceConnectionStatus({ type: null, message: "" });

    try {
      // Vérifier si un wallet Binance existe déjà
      const existingWallets = await getStoredWallets(username || currentUser);
      const existingBinanceWallet = existingWallets.find(
        (wallet) => wallet.walletType === "binance"
      );

      if (existingBinanceWallet) {
        setBinanceConnectionStatus({
          type: "error",
          message:
            "Un compte Binance est déjà connecté. Veuillez d'abord le supprimer depuis l'onglet Investissements.",
        });
        return;
      }

      // Tester la connexion et récupérer les assets
      const assets = await getBinanceAccountInfo(
        settings.binanceApiKey,
        settings.binanceSecretKey
      );

      // Calculer la valeur totale
      const totalValue = assets.reduce(
        (sum, asset) => sum + (asset.value || 0),
        0
      );

      // Créer le wallet Binance
      const wallet = {
        id: `binance-${Date.now()}`,
        name: "Compte Binance",
        address: settings.binanceApiKey.slice(0, 8) + "...",
        walletType: "binance" as const,
        blockchains: ["binance"],
        assets,
        totalValue,
        lastUpdated: new Date().toISOString(),
        addedAt: new Date().toISOString(),
      };

      // Ajouter le wallet
      await addWallet(wallet, username || currentUser);

      // Sauvegarder automatiquement les paramètres utilisateur
      if (username) {
        try {
          saveUserSettings(username, settings);
          console.log("✅ Paramètres utilisateur sauvegardés automatiquement");
        } catch (error) {
          console.error(
            "❌ Erreur lors de la sauvegarde automatique des paramètres:",
            error
          );
        }
      }

      setBinanceConnectionStatus({
        type: "success",
        message: `Compte Binance connecté avec succès ! ${
          assets.length
        } assets trouvés ($${totalValue.toLocaleString()}) - Paramètres sauvegardés`,
      });

      // Rediriger vers l'onglet Investissements après 2 secondes
      setTimeout(() => {
        navigate("/investments");
      }, 2000);
    } catch (error: any) {
      setBinanceConnectionStatus({
        type: "error",
        message: error.message || "Erreur lors de la connexion à Binance",
      });
    } finally {
      setIsConnectingBinance(false);
    }
  };

  const renderApiKeyField = (
    label: string,
    field: keyof UserSettings,
    showState: boolean,
    setShowState: (show: boolean) => void,
    placeholder: string,
    isPassword: boolean = true
  ) => {
    const value = settings[field];
    const fieldName = field.toString();

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
        </label>
        <div className="relative">
          <input
            type={isPassword && !showState ? "password" : "text"}
            value={value}
            onChange={(e) => handleInputChange(field, e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 pr-20 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
          />
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex space-x-1">
            {isPassword && (
              <button
                type="button"
                onClick={() => setShowState(!showState)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                title={showState ? "Masquer" : "Afficher"}
              >
                {showState ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => copyToClipboard(value, fieldName)}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title="Copier"
            >
              {copiedField === fieldName ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!username) {
    return <div>Utilisateur non trouvé</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-200"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Paramètres de {username}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Configurez vos clés API et préférences
            </p>
          </div>
        </div>
        <button
          onClick={saveSettings}
          disabled={isLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
        >
          <Save className="h-4 w-4" />
          <span>{isLoading ? "Sauvegarde..." : "Sauvegarder"}</span>
        </button>
      </div>

      {/* Message de confirmation */}
      {message && (
        <div
          className={`mb-6 p-4 rounded-md ${
            message.includes("succès")
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
          }`}
        >
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Colonne de gauche */}
        <div className="space-y-6">
          {/* Section Compte CEX */}
          <div className="bg-white dark:bg-[#111111] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Compte CEX
            </h2>

            <div className="space-y-4">
              {/* Binance API Key */}
              {renderApiKeyField(
                "Clé API Binance",
                "binanceApiKey",
                showBinanceApi,
                setShowBinanceApi,
                "Votre clé API Binance",
                false
              )}

              {/* Binance Secret Key */}
              {renderApiKeyField(
                "Clé secrète Binance",
                "binanceSecretKey",
                showBinanceSecret,
                setShowBinanceSecret,
                "Votre clé secrète Binance"
              )}

              {/* Bouton de connexion Binance */}
              <div className="pt-2">
                <button
                  onClick={handleConnectBinance}
                  disabled={
                    isConnectingBinance ||
                    !settings.binanceApiKey ||
                    !settings.binanceSecretKey
                  }
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-400 text-white rounded-md transition-colors duration-200 disabled:cursor-not-allowed"
                >
                  {isConnectingBinance ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Connexion en cours...</span>
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      <span>Connecter le compte Binance</span>
                    </>
                  )}
                </button>
              </div>

              {/* Status de connexion Binance */}
              {binanceConnectionStatus.type && (
                <div
                  className={`p-3 rounded-md text-sm ${
                    binanceConnectionStatus.type === "success"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : binanceConnectionStatus.type === "error"
                      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                      : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                  }`}
                >
                  {binanceConnectionStatus.message}
                </div>
              )}
            </div>
          </div>

          {/* Section IA et API Personnalisée */}
          <div className="bg-white dark:bg-[#111111] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              IA et API Personnalisée
            </h2>

            <div className="space-y-4">
              {/* Gemini API Key */}
              {renderApiKeyField(
                "Clé API Gemini",
                "geminiApiKey",
                showGeminiApi,
                setShowGeminiApi,
                "Votre clé API Gemini"
              )}

              {/* Custom API Endpoint */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Endpoint API personnalisé
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={settings.customApiEndpoint}
                    onChange={(e) =>
                      handleInputChange("customApiEndpoint", e.target.value)
                    }
                    placeholder="https://api.example.com"
                    className="w-full px-3 py-2 pr-12 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        settings.customApiEndpoint,
                        "customApiEndpoint"
                      )
                    }
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    title="Copier"
                  >
                    {copiedField === "customApiEndpoint" ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Colonne de droite - Clé API Etherscan */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111111] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Clé API Etherscan
            </h2>

            <div className="space-y-4">
              {/* Etherscan API Key */}
              {renderApiKeyField(
                "Clé API Etherscan",
                "etherscanApiKey",
                showEtherscanApi,
                setShowEtherscanApi,
                "Votre clé API Etherscan (pour toutes les chaînes)"
              )}

              {/* CoinGecko API Key */}
              {renderApiKeyField(
                "Clé API CoinGecko",
                "coinGeckoApiKey",
                showCoinGeckoApi,
                setShowCoinGeckoApi,
                "Votre clé API CoinGecko (optionnel)"
              )}

              {/* OpenSea API Key */}
              {renderApiKeyField(
                "Clé API OpenSea",
                "openSeaApiKey",
                showOpenSeaApi,
                setShowOpenSeaApi,
                "Votre clé API OpenSea (pour les NFTs)"
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
