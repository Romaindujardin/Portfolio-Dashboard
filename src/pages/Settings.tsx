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
  Lock,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { ACCENT_COLORS, applyUserTheme, getAccentColorDef } from "../utils/theme";
import {
  getUserSettings,
  saveUserSettings,
  UserSettings,
} from "../utils/userSettings";
import { getBinanceAccountInfo } from "../utils/binanceService";
import { addWallet, getStoredWallets } from "../utils/storage";
import {
  changePassword,
  deleteSecret,
  getSecretsStatus,
  saveSecret,
  type SecretStatus,
} from "../services/portfolioApi";
import { scorePassword } from "../utils/passwordStrength";

type StringSettingKeys = {
  [K in keyof UserSettings]-?: UserSettings[K] extends string ? K : never;
}[keyof UserSettings];

const Settings: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { currentUser, lockUser, isUnlocked } = useUser();
  const [settings, setSettings] = useState<UserSettings>({
    customApiEndpoint: "",
    accountSections: [
      { id: "bank", label: "Compte bancaire", kind: "bank" },
      { id: "pea", label: "PEA", kind: "investment" },
      { id: "pee", label: "PEE", kind: "investment" },
    ],
    csvColumnMappings: {},
    boursoAccountMappings: [],
    theme: "auto",
    currency: "EUR",
    language: "fr",
    accentColor: "blue",
  });

  // Les secrets ne sont jamais préremplis : on ne reçoit que leur état.
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [secretStatuses, setSecretStatuses] = useState<
    Record<string, SecretStatus>
  >({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [secretMessage, setSecretMessage] = useState<string | null>(null);

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

  // États pour le changement de mot de passe
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const newPwStrength = scorePassword(newPassword);
  const newPwMatches = newPassword.length > 0 && newPassword === confirmNewPassword;
  const canSubmitPasswordChange =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPwMatches &&
    !isChangingPassword;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !canSubmitPasswordChange) return;

    if (newPassword !== confirmNewPassword) {
      setPasswordFeedback({
        type: "error",
        text: "Les nouveaux mots de passe ne correspondent pas.",
      });
      return;
    }

    setIsChangingPassword(true);
    setPasswordFeedback(null);

    try {
      await changePassword(username, currentPassword, newPassword);
      setPasswordFeedback({
        type: "success",
        text: "Mot de passe modifié avec succès !",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setTimeout(() => setPasswordFeedback(null), 4000);
    } catch (err: any) {
      setPasswordFeedback({
        type: "error",
        text:
          err.status === 401 || err.message?.toLowerCase().includes("incorrect")
            ? "Le mot de passe actuel est incorrect."
            : err.message || "Erreur lors du changement de mot de passe.",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const refreshSecretStatuses = async () => {
    try {
      const data = await getSecretsStatus();
      setSecretStatuses(data.secrets || {});
    } catch (error) {
      console.warn("Impossible de charger l'état des clés API:", error);
    }
  };

  useEffect(() => {
    if (username) {
      const userSettings = getUserSettings(username);
      setSettings(userSettings);
      if (isUnlocked) void refreshSecretStatuses();
    }
  }, [username, isUnlocked]);

  const persistSecretInputs = async () => {
    const entries = Object.entries(secretInputs).filter(
      ([, value]) => value.trim().length > 0,
    );
    for (const [key, value] of entries) {
      await saveSecret(key, value.trim());
    }
    if (entries.length > 0) {
      setSecretInputs({});
      await refreshSecretStatuses();
      setSecretMessage(
        `${entries.length} clé(s) enregistrée(s) dans le coffre chiffré.`,
      );
      setTimeout(() => setSecretMessage(null), 4000);
    }
    return entries.length;
  };

  const saveSettings = async () => {
    if (!username) return;

    setIsLoading(true);
    try {
      saveUserSettings(username, settings);
      if (settings.accentColor) {
        applyUserTheme(settings.accentColor);
      }
      await persistSecretInputs();
      setMessage("Paramètres sauvegardés avec succès !");
      setTimeout(() => setMessage(""), 3000);
    } catch (error: any) {
      setMessage(
        error?.message || "Erreur lors de la sauvegarde des paramètres",
      );
      setTimeout(() => setMessage(""), 4000);
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
    const apiKey = secretInputs.binanceApiKey?.trim() || "";
    const secretKey = secretInputs.binanceSecretKey?.trim() || "";
    const hasStoredKeys =
      secretStatuses.binanceApiKey?.configured &&
      secretStatuses.binanceSecretKey?.configured;

    if ((!apiKey || !secretKey) && !hasStoredKeys) {
      setBinanceConnectionStatus({
        type: "error",
        message:
          "Saisissez la clé API et le secret Binance, ou enregistrez-les d'abord.",
      });
      return;
    }
    if ((apiKey && !secretKey) || (!apiKey && secretKey)) {
      setBinanceConnectionStatus({
        type: "error",
        message: "La clé API et le secret Binance doivent être fournis ensemble.",
      });
      return;
    }

    setIsConnectingBinance(true);
    setBinanceConnectionStatus({ type: null, message: "" });

    try {
      if (apiKey && secretKey) {
        await saveSecret("binanceApiKey", apiKey);
        await saveSecret("binanceSecretKey", secretKey);
        setSecretInputs((prev) => {
          const next = { ...prev };
          delete next.binanceApiKey;
          delete next.binanceSecretKey;
          return next;
        });
        await refreshSecretStatuses();
      }

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

      // Tester la connexion et récupérer les assets (clés lues côté serveur)
      const assets = await getBinanceAccountInfo();

      // Calculer la valeur totale
      const totalValue = assets.reduce(
        (sum, asset) => sum + (asset.value || 0),
        0,
      );

      // Créer le wallet Binance
      const wallet = {
        id: `binance-${Date.now()}`,
        name: "Compte Binance",
        address: "Binance API",
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

      // Rediriger vers l'onglet Crypto du Patrimoine après 2 secondes
      setTimeout(() => {
        navigate("/patrimoine?tab=crypto");
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

  const renderSecretField = (
    label: string,
    secretKey: string,
    placeholder: string,
  ) => {
    const status = secretStatuses[secretKey];
    const value = secretInputs[secretKey] || "";
    const isVisible = Boolean(showSecret[secretKey]);

    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-[#8a8a8a]">
            {label}
          </label>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              status?.configured
                ? "bg-green-950/50 text-green-400 border border-green-500/20"
                : "bg-[#1a1a1a] text-[#777] border border-white/5"
            }`}
          >
            {status?.configured ? "Configurée" : "Non configurée"}
          </span>
        </div>
        <div className="relative">
          <input
            type={isVisible ? "text" : "password"}
            value={value}
            onChange={(e) =>
              setSecretInputs((prev) => ({
                ...prev,
                [secretKey]: e.target.value,
              }))
            }
            placeholder={
              status?.configured
                ? "Clé configurée — laisser vide pour conserver"
                : placeholder
            }
            className="input-field pr-20"
            autoComplete="new-password"
          />
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex space-x-1">
            <button
              type="button"
              onClick={() =>
                setShowSecret((prev) => ({
                  ...prev,
                  [secretKey]: !prev[secretKey],
                }))
              }
              className="p-1 text-[#555555] hover:text-[#f5f5f5] transition-colors"
              title={isVisible ? "Masquer" : "Afficher"}
            >
              {isVisible ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
            {status?.configured && (
              <button
                type="button"
                onClick={async () => {
                  await deleteSecret(secretKey);
                  await refreshSecretStatuses();
                }}
                className="p-1 text-[#555555] hover:text-red-400 transition-colors"
                title="Supprimer la clé"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-[#555555] mt-1">
          Chiffrée côté serveur (AES-256-GCM), jamais renvoyée au navigateur.
        </p>
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
            className="p-2 text-[#8a8a8a] hover:text-[#f5f5f5] transition-colors duration-200"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[#f5f5f5]">
              Paramètres de {username}
            </h1>
            <p className="text-[#8a8a8a]">
              Configurez vos clés API et préférences d'application
            </p>
          </div>
        </div>
        <button
          onClick={saveSettings}
          disabled={isLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-[#c8a55e] text-white rounded-md hover:bg-[#d4b06a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 shadow-sm"
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
      {secretMessage && (
        <div className="mb-6 p-4 rounded-md bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
          {secretMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Colonne de gauche */}
        <div className="space-y-6">
          {/* Section Couleur du profil */}
          <div className="bg-[#111111] rounded-lg p-6 border border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#f5f5f5]">
                Couleur du profil
              </h2>
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[#1a1a1a] text-[#8a8a8a]">
                {getAccentColorDef(settings.accentColor).name}
              </span>
            </div>

            <p className="text-xs text-[#555555] mb-4">
              Choisissez la couleur principale d'accentuation pour {username} :
            </p>

            <div className="flex flex-wrap items-center gap-3">
              {ACCENT_COLORS.map((color) => {
                const isSelected = (settings.accentColor || "blue") === color.id;
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => {
                      setSettings((prev) => ({ ...prev, accentColor: color.id }));
                      applyUserTheme(color.id);
                      if (username) {
                        saveUserSettings(username, {
                          ...settings,
                          accentColor: color.id,
                        });
                      }
                    }}
                    title={color.name}
                    className={`w-9 h-9 rounded-full transition-all flex items-center justify-center ${
                      isSelected
                        ? "ring-2 ring-offset-2 ring-[#c8a55e] dark:ring-offset-[#111111] scale-110"
                        : "hover:scale-105 opacity-80 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: color.hex }}
                  >
                    {isSelected && (
                      <Check size={16} className="text-white stroke-[3] drop-shadow-sm" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section Compte CEX */}
          <div className="bg-[#111111] rounded-lg p-6 border border-[rgba(255,255,255,0.06)]">
            <h2 className="text-lg font-semibold text-[#f5f5f5] mb-4">
              Compte Binance (CEX)
            </h2>

            <div className="space-y-4">
              {/* Binance API Key */}
              {renderSecretField(
                "Clé API Binance",
                "binanceApiKey",
                "Votre clé API Binance",
              )}

              {/* Binance Secret Key */}
              {renderSecretField(
                "Clé secrète Binance",
                "binanceSecretKey",
                "Votre clé secrète Binance",
              )}

              {/* Bouton de connexion Binance */}
              <div className="pt-2">
                <button
                  onClick={handleConnectBinance}
                  disabled={isConnectingBinance}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-[#c8a55e] hover:bg-[#d4b06a] disabled:bg-gray-400 text-white rounded-md transition-colors duration-200 disabled:cursor-not-allowed"
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
        </div>

        {/* Colonne de droite */}
        <div className="space-y-6">
          {/* Section Sécurité & Mot de passe */}
          <div className="bg-[#111111] rounded-lg p-6 border border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-[#c8a55e]" />
                <h2 className="text-lg font-semibold text-[#f5f5f5]">
                  Sécurité & Mot de passe
                </h2>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[#1a1a1a] text-[#c8a55e] border border-[rgba(200,165,94,0.2)]">
                Chiffré scrypt
              </span>
            </div>

            <p className="text-xs text-[#8a8a8a] mb-4">
              Modifiez le mot de passe d'accès pour la session de {username}.
            </p>

            {passwordFeedback && (
              <div
                className={`mb-4 p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
                  passwordFeedback.type === "success"
                    ? "bg-green-950/40 text-green-300 border border-green-500/30"
                    : "bg-red-950/40 text-red-300 border border-red-500/30"
                }`}
              >
                {passwordFeedback.type === "success" ? (
                  <Check className="h-4 w-4 flex-shrink-0 text-green-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
                )}
                <span>{passwordFeedback.text}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              {/* Mot de passe actuel */}
              <div>
                <label className="block text-xs font-medium text-[#8a8a8a] mb-1.5">
                  Mot de passe actuel
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="input-field pr-10 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#555555] hover:text-[#f5f5f5] transition-colors"
                    tabIndex={-1}
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Nouveau mot de passe */}
              <div>
                <label className="block text-xs font-medium text-[#8a8a8a] mb-1.5">
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="input-field pr-10 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#555555] hover:text-[#f5f5f5] transition-colors"
                    tabIndex={-1}
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {newPassword.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#8a8a8a]">Force :</span>
                      <span style={{ color: newPwStrength.color }} className="font-medium">
                        {newPwStrength.label}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[#252525] rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-300 rounded-full"
                        style={{
                          width: `${newPwStrength.percent}%`,
                          backgroundColor: newPwStrength.color,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Confirmer le nouveau mot de passe */}
              <div>
                <label className="block text-xs font-medium text-[#8a8a8a] mb-1.5">
                  Confirmer le nouveau mot de passe
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="input-field pr-10 text-sm"
                  />
                  {newPwMatches && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400">
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </div>
                {confirmNewPassword.length > 0 && !newPwMatches && (
                  <p className="text-xs text-red-400 mt-1">
                    Les mots de passe ne correspondent pas.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => lockUser(username)}
                  className="px-3 py-2 text-xs font-medium text-[#8a8a8a] hover:text-[#f5f5f5] bg-[#1a1a1a] hover:bg-[#252525] rounded-md transition-colors flex items-center gap-1.5"
                  title="Verrouiller la session maintenant"
                >
                  <Lock className="h-3.5 w-3.5 text-[#c8a55e]" />
                  <span>Verrouiller</span>
                </button>

                <button
                  type="submit"
                  disabled={!canSubmitPasswordChange}
                  className="px-4 py-2 text-xs font-medium bg-[#c8a55e] text-[#0a0a0a] rounded-md hover:bg-[#d4b06a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isChangingPassword ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Modification...</span>
                    </>
                  ) : (
                    <span>Changer le mot de passe</span>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Section IA et API Personnalisée */}
          <div className="bg-[#111111] rounded-lg p-6 border border-[rgba(255,255,255,0.06)]">
            <h2 className="text-lg font-semibold text-[#f5f5f5] mb-4">
              IA & Conseiller Financier
            </h2>

            <div className="space-y-4">
              {/* Gemini API Key */}
              {renderSecretField(
                "Clé API Google Gemini",
                "geminiApiKey",
                "Votre clé API Gemini (pour l'assistant IA)",
              )}

              {/* Custom API Endpoint */}
              <div>
                <label className="block text-sm font-medium text-[#8a8a8a] mb-2">
                  Endpoint API personnalisé (optionnel)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={settings.customApiEndpoint}
                    onChange={(e) =>
                      handleInputChange("customApiEndpoint", e.target.value)
                    }
                    placeholder="https://api.example.com"
                    className="input-field pr-12"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        settings.customApiEndpoint,
                        "customApiEndpoint",
                      )
                    }
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-[#555555] hover:text-[#f5f5f5] transition-colors"
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

          {/* Clés API Web3 & Marchés */}
          <div className="bg-[#111111] rounded-lg p-6 border border-[rgba(255,255,255,0.06)]">
            <h2 className="text-lg font-semibold text-[#f5f5f5] mb-4">
              Données Marchés & Web3
            </h2>

            <div className="space-y-4">
              {/* Etherscan API Key */}
              {renderSecretField(
                "Clé API Etherscan",
                "etherscanApiKey",
                "Votre clé API Etherscan (optionnel)",
              )}

              {/* CoinGecko API Key */}
              {renderSecretField(
                "Clé API CoinGecko",
                "coinGeckoApiKey",
                "Votre clé API CoinGecko Pro (optionnel)",
              )}

              {/* OpenSea API Key */}
              {renderSecretField(
                "Clé API OpenSea",
                "openSeaApiKey",
                "Votre clé API OpenSea (pour les NFTs)",
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
