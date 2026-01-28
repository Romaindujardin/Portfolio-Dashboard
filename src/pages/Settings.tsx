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
import {
  addWallet,
  deleteBankCsvUpload,
  getStoredBankCsvUploads,
  getStoredWallets,
} from "../utils/storage";
import { fetchBoursoAccounts } from "../utils/boursoService";
import type {
  AccountSectionConfig,
  AccountSectionKind,
  BoursoAccount,
  BoursoAccountMapping,
  BoursoAccountSection,
} from "../types";

type StringSettingKeys = {
  [K in keyof UserSettings]: UserSettings[K] extends string ? K : never;
}[keyof UserSettings];

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
    accountSections: [
      { id: "bank", label: "Compte bancaire", kind: "bank" },
      { id: "pea", label: "PEA", kind: "investment" },
      { id: "pee", label: "PEE", kind: "investment" },
    ],
    boursoClientId: "",
    boursoAccountMappings: [],
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

  // Bourso account detection
  const [showBoursoModal, setShowBoursoModal] = useState(false);
  const [boursoPassword, setBoursoPassword] = useState("");
  const [boursoLoading, setBoursoLoading] = useState(false);
  const [boursoError, setBoursoError] = useState("");

  const [sectionLabelDraft, setSectionLabelDraft] = useState("");
  const [sectionKindDraft, setSectionKindDraft] =
    useState<AccountSectionKind>("bank");
  const [sectionError, setSectionError] = useState("");

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

  const handleInputChange = (field: StringSettingKeys, value: string) => {
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
        (wallet) => wallet.walletType === "binance",
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
        settings.binanceSecretKey,
      );

      // Calculer la valeur totale
      const totalValue = assets.reduce(
        (sum, asset) => sum + (asset.value || 0),
        0,
      );

      // Créer le wallet Binance
      const wallet = {
        id: `binance-${Date.now()}`,
        name: "Compte Binance",
        address: settings.binanceApiKey.slice(0, 8) + "...",
        walletType: "binance" as const,
        blockchains: ["binance"],
        assets,
        nfts: [],
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
            error,
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
    field: StringSettingKeys,
    showState: boolean,
    setShowState: (show: boolean) => void,
    placeholder: string,
    isPassword: boolean = true,
  ) => {
    const value = settings[field] ?? "";
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

  const inferBoursoSection = (account: BoursoAccount): BoursoAccountSection => {
    const name = account.name.toLowerCase();
    const kind = account.kind.toLowerCase();
    if (name.includes("pea") || kind.includes("trading")) {
      return "pea";
    }
    return "bank";
  };

  const handleDetectBoursoAccounts = async () => {
    if (!settings.boursoClientId) {
      setBoursoError("Veuillez renseigner votre identifiant client.");
      return;
    }
    if (!boursoPassword) {
      setBoursoError("Veuillez saisir votre mot de passe.");
      return;
    }

    setBoursoLoading(true);
    setBoursoError("");
    try {
      const accounts = await fetchBoursoAccounts({
        customerId: settings.boursoClientId,
        password: boursoPassword,
      });

      const existingById = new Map(
        settings.boursoAccountMappings.map((mapping) => [
          mapping.accountId,
          mapping,
        ]),
      );

      const nextMappings: BoursoAccountMapping[] = accounts.map((account) => {
        const existing = existingById.get(account.id);
        return {
          accountId: account.id,
          accountName: account.name,
          kind: account.kind,
          section: existing?.section ?? inferBoursoSection(account),
        };
      });

      setSettings((prev) => ({
        ...prev,
        boursoAccountMappings: nextMappings,
      }));
    } catch (error: any) {
      setBoursoError(
        error?.message || "Impossible de récupérer les comptes Bourso.",
      );
    } finally {
      setBoursoLoading(false);
    }
  };

  const updateBoursoMappingSection = (
    accountId: string,
    section: BoursoAccountSection,
  ) => {
    setSettings((prev) => ({
      ...prev,
      boursoAccountMappings: prev.boursoAccountMappings.map((mapping) =>
        mapping.accountId === accountId ? { ...mapping, section } : mapping,
      ),
    }));
  };

  const normalizeSectionId = (label: string) => {
    const base = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return base || `section-${Date.now()}`;
  };

  const handleAddSection = () => {
    setSectionError("");
    const label = sectionLabelDraft.trim();
    if (!label) {
      setSectionError("Nom requis.");
      return;
    }
    const id = normalizeSectionId(label);
    if (settings.accountSections.some((s) => s.id === id)) {
      setSectionError("Identifiant déjà utilisé.");
      return;
    }
    const nextSections: AccountSectionConfig[] = [
      ...settings.accountSections,
      { id, label, kind: sectionKindDraft },
    ];
    setSettings((prev) => ({ ...prev, accountSections: nextSections }));
    setSectionLabelDraft("");
  };

  const handleDeleteSection = async (section: AccountSectionConfig) => {
    if (!username) return;
    if (settings.accountSections.length <= 1) {
      setSectionError("Au moins un type doit rester actif.");
      return;
    }
    const confirmDelete = window.confirm(
      `Supprimer "${section.label}" ? Tous les CSV associés seront supprimés.`,
    );
    if (!confirmDelete) return;

    try {
      const uploads = await getStoredBankCsvUploads(
        username || currentUser,
        section.id,
      );
      await Promise.all(
        uploads.map((u) => deleteBankCsvUpload(u.id, username || currentUser)),
      );
    } catch (error) {
      console.error("Erreur lors de la suppression des CSV:", error);
    }

    const nextSections = settings.accountSections.filter(
      (s) => s.id !== section.id,
    );
    const nextSettings = { ...settings, accountSections: nextSections };
    setSettings(nextSettings);
    saveUserSettings(username, nextSettings);
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
                false,
              )}

              {/* Binance Secret Key */}
              {renderApiKeyField(
                "Clé secrète Binance",
                "binanceSecretKey",
                showBinanceSecret,
                setShowBinanceSecret,
                "Votre clé secrète Binance",
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
                "Votre clé API Gemini",
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
                        "customApiEndpoint",
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

          {/* Section BoursoBank */}
          <div className="bg-white dark:bg-[#111111] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              BoursoBank
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Identifiant client
                </label>
                <input
                  type="text"
                  value={settings.boursoClientId}
                  onChange={(e) =>
                    handleInputChange("boursoClientId", e.target.value)
                  }
                  placeholder="Votre identifiant client BoursoBank"
                  className="w-full px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                />
              </div>

              <div className="text-sm text-gray-600 dark:text-gray-400">
                {settings.boursoAccountMappings.length
                  ? `${settings.boursoAccountMappings.length} compte(s) configuré(s)`
                  : "Aucun compte configuré"}
              </div>

              <button
                type="button"
                onClick={() => setShowBoursoModal(true)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Détecter et mapper les comptes
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Le mot de passe n'est jamais stocké. Pensez à sauvegarder vos
                paramètres après la détection.
              </p>
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
                "Votre clé API Etherscan (pour toutes les chaînes)",
              )}

              {/* CoinGecko API Key */}
              {renderApiKeyField(
                "Clé API CoinGecko",
                "coinGeckoApiKey",
                showCoinGeckoApi,
                setShowCoinGeckoApi,
                "Votre clé API CoinGecko (optionnel)",
              )}

              {/* OpenSea API Key */}
              {renderApiKeyField(
                "Clé API OpenSea",
                "openSeaApiKey",
                showOpenSeaApi,
                setShowOpenSeaApi,
                "Votre clé API OpenSea (pour les NFTs)",
              )}
            </div>
          </div>

          {/* Section Gestion */}
          <div className="bg-white dark:bg-[#111111] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Gestion
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Nom du type
                  </label>
                  <input
                    type="text"
                    value={sectionLabelDraft}
                    onChange={(e) => setSectionLabelDraft(e.target.value)}
                    placeholder="Ex: Livret A"
                    className="w-full px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Type
                  </label>
                  <select
                    value={sectionKindDraft}
                    onChange={(e) =>
                      setSectionKindDraft(e.target.value as AccountSectionKind)
                    }
                    className="w-full px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                  >
                    <option value="bank">Compte bancaire</option>
                    <option value="investment">Investissement</option>
                  </select>
                </div>
              </div>

              {sectionError && (
                <div className="text-sm text-red-600 dark:text-red-400">
                  {sectionError}
                </div>
              )}

              <button
                type="button"
                onClick={handleAddSection}
                className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
              >
                Ajouter un type
              </button>

              <div className="space-y-2">
                {settings.accountSections.map((section) => (
                  <div
                    key={section.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-700 p-3"
                  >
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {section.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {section.kind === "investment"
                          ? "Investissement"
                          : "Compte bancaire"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSection(section)}
                      className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Supprimer
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showBoursoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#111111] rounded-lg shadow-lg">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Détection des comptes Bourso
              </h3>
              <button
                type="button"
                onClick={() => setShowBoursoModal(false)}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Fermer
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Mot de passe
                </label>
                <input
                  type="password"
                  value={boursoPassword}
                  onChange={(e) => setBoursoPassword(e.target.value)}
                  placeholder="Votre mot de passe BoursoBank"
                  className="w-full px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Le mot de passe sert uniquement à la détection et n'est pas
                  conservé.
                </p>
              </div>

              <button
                type="button"
                onClick={handleDetectBoursoAccounts}
                disabled={boursoLoading}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {boursoLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Détection en cours...</span>
                  </>
                ) : (
                  <span>Détecter les comptes</span>
                )}
              </button>

              {boursoError && (
                <div className="rounded-md bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 p-3 text-sm">
                  {boursoError}
                </div>
              )}

              <div className="space-y-3">
                {settings.boursoAccountMappings.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Aucun compte détecté pour le moment.
                  </div>
                )}

                {settings.boursoAccountMappings.map((mapping) => (
                  <div
                    key={mapping.accountId}
                    className="flex flex-col gap-2 rounded-md border border-gray-200 dark:border-gray-700 p-3"
                  >
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {mapping.accountName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {mapping.kind}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        Rubrique
                      </label>
                      <select
                        value={mapping.section}
                        onChange={(e) =>
                          updateBoursoMappingSection(
                            mapping.accountId,
                            e.target.value as BoursoAccountSection,
                          )
                        }
                        className="w-full px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-[#2f2f2f] dark:text-gray-100"
                      >
                        <option value="bank">Banque</option>
                        <option value="pea">PEA</option>
                        <option value="ignore">Ignorer</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                type="button"
                onClick={() => setShowBoursoModal(false)}
                className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-[#1a1a1a] dark:text-gray-200 dark:hover:bg-[#222222]"
              >
                Terminer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
