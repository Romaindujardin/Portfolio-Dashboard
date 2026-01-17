import React, { useState, useEffect } from "react";
import { X, Wallet, AlertCircle, Loader } from "lucide-react";
import { Wallet as WalletType } from "../types";
import { createWallet, isValidAddress } from "../utils/blockchainService";
import { WALLET_TYPES, getWalletTypeConfig } from "../utils/walletTypes";

interface WalletFormProps {
  wallet?: WalletType; // Prop optionnel pour l'édition
  onSubmit: (wallet: WalletType) => void;
  onCancel: () => void;
}

const WalletForm: React.FC<WalletFormProps> = ({
  wallet,
  onSubmit,
  onCancel,
}) => {
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    walletType: "neutral" as
      | "neutral"
      | "metamask"
      | "phantom"
      | "coinbase"
      | "trust"
      | "exodus"
      | "ledger"
      | "trezor"
      | "binance",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Pré-remplir le formulaire quand on édite un wallet
  useEffect(() => {
    if (wallet) {
      setFormData({
        name: wallet.name,
        address: wallet.address,
        walletType: wallet.walletType || "neutral",
      });
    } else {
      setFormData({
        name: "",
        address: "",
        walletType: "neutral",
      });
    }
  }, [wallet]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    // Réinitialiser l'erreur quand l'utilisateur tape
    if (error) setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError("Le nom du wallet est requis");
      return;
    }

    // Pour les wallets Binance, on ne valide pas l'adresse
    if (formData.walletType !== "binance") {
      if (!formData.address.trim()) {
        setError("L'adresse du wallet est requise");
        return;
      }

      if (!isValidAddress(formData.address)) {
        setError(
          "Adresse de wallet invalide (doit commencer par 0x et contenir 40 caractères hexadécimaux)"
        );
        return;
      }
    }

    setLoading(true);
    setError("");

    try {
      let walletResult: WalletType;

      if (wallet) {
        // Mode édition : mettre à jour le wallet existant
        walletResult = {
          ...wallet,
          name: formData.name.trim(),
          address: formData.address.trim(),
          walletType: formData.walletType,
          // Garder les autres propriétés existantes (assets, blockchains, etc.)
        };
      } else {
        // Mode création : créer un nouveau wallet
        walletResult = await createWallet(
          formData.name.trim(),
          formData.address.trim(),
          formData.walletType
        );
      }

      onSubmit(walletResult);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Erreur lors de ${
              wallet ? "la modification" : "la création"
            } du wallet`
      );
    } finally {
      setLoading(false);
    }
  };

  // Vérifier si c'est un wallet Binance
  const isBinanceWallet = formData.walletType === "binance";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#111111] rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <Wallet className="text-primary-600" size={24} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {wallet ? "Modifier" : "Ajouter"} un Portefeuille
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            disabled={loading}
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="text-red-500" size={20} />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Nom du portefeuille *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Mon portefeuille principal"
              className="input-field"
              disabled={loading}
            />
          </div>

          <div>
            <label
              htmlFor="walletType"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Type de wallet
            </label>
            <select
              id="walletType"
              name="walletType"
              value={formData.walletType}
              onChange={(e) =>
                setFormData({ ...formData, walletType: e.target.value as any })
              }
              className="input-field"
              disabled={loading}
            >
              {Object.values(WALLET_TYPES).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          {/* Masquer le champ adresse pour les wallets Binance */}
          {!isBinanceWallet && (
            <div>
              <label
                htmlFor="address"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Adresse du portefeuille *
              </label>
              <input
                type="text"
                id="address"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                placeholder="0x..."
                className="input-field font-mono text-sm"
                disabled={loading}
              />
              <p className="text-xs text-gray-500 mt-1">
                L'adresse publique de votre portefeuille (ex:
                0x742d35Cc6493C0532a588d0e51D7AC44e0E2b48F)
              </p>
            </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 btn-secondary"
              disabled={loading}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary flex items-center justify-center space-x-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader className="animate-spin" size={20} />
                  <span>Chargement...</span>
                </>
              ) : (
                <>
                  <Wallet size={20} />
                  <span>{wallet ? "Modifier" : "Ajouter"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WalletForm;
