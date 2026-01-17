import React, { useState } from "react";

interface BinanceConnectModalProps {
  open: boolean;
  onClose: () => void;
  onConnect: (apiKey: string, apiSecret: string) => Promise<void>;
}

const BinanceConnectModal: React.FC<BinanceConnectModalProps> = ({
  open,
  onClose,
  onConnect,
}) => {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onConnect(apiKey.trim(), apiSecret.trim());
      setApiKey("");
      setApiSecret("");
      onClose();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la connexion à Binance");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-[#111111] rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          Connecter un compte Binance
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
              Clé API Binance
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="input-field"
              placeholder="API Key"
              required
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-white mb-1">
              Secret API Binance
            </label>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              className="input-field"
              placeholder="API Secret"
              required
              disabled={loading}
            />
          </div>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div className="flex space-x-3 pt-2">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={loading}
            >
              {loading ? "Connexion..." : "Connecter"}
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={onClose}
              disabled={loading}
            >
              Annuler
            </button>
          </div>
        </form>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
          <strong>Note :</strong> Seules les permissions de lecture (Read Only)
          sont nécessaires. Ne partagez jamais une clé API avec droits de
          retrait ou de trading.
        </p>
      </div>
    </div>
  );
};

export default BinanceConnectModal;
