import React from "react";
import {
  Edit,
  Trash2,
  TrendingUp,
  TrendingDown,
  RefreshCw,
} from "lucide-react";
import { Investment } from "../types";
import { format } from "date-fns";

interface InvestmentCardProps {
  investment: Investment;
  onEdit: () => void;
  onDelete: () => void;
}

const InvestmentCard: React.FC<InvestmentCardProps> = ({
  investment,
  onEdit,
  onDelete,
}) => {
  // Gérer les cas où currentPrice est null/undefined
  const currentPrice = investment.currentPrice ?? 0;
  const hasValidPrice =
    investment.currentPrice !== null && investment.currentPrice !== undefined;

  const currentValue = investment.quantity * currentPrice;
  const purchaseValue = investment.quantity * investment.purchasePrice;
  const gainLoss = currentValue - purchaseValue;
  const gainLossPercent =
    purchaseValue > 0 ? (gainLoss / purchaseValue) * 100 : 0;

  const typeColors = {
    stock: "bg-blue-100 text-blue-800",
    crypto: "bg-orange-100 text-orange-800",
    etf: "bg-green-100 text-green-800",
    bond: "bg-purple-100 text-purple-800",
    other: "bg-gray-100 text-gray-800",
  };

  return (
    <div className="card hover:shadow-lg transition-shadow duration-200">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {investment.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {investment.symbol}
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={onEdit}
            className="p-2 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            <Edit size={16} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-gray-400 hover:text-danger-600 dark:hover:text-danger-400 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Alerte si le prix n'est pas disponible */}
      {!hasValidPrice && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900 dark:border-yellow-700">
          <div className="flex items-center space-x-2">
            <RefreshCw
              size={16}
              className="text-yellow-600 dark:text-yellow-300"
            />
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Prix non disponible - Veuillez mettre à jour manuellement
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span
            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
              typeColors[investment.type]
            }`}
          >
            {investment.type.toUpperCase()}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {format(new Date(investment.purchaseDate), "MMM d, yyyy")}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Quantité</p>
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {investment.quantity}
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Prix d'achat</p>
            <p className="font-medium text-gray-900 dark:text-gray-100">
              ${investment.purchasePrice.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Prix actuel</p>
            <p
              className={`font-medium ${
                !hasValidPrice
                  ? "text-gray-400 dark:text-gray-500"
                  : "text-gray-900 dark:text-gray-100"
              }`}
            >
              {hasValidPrice
                ? `$${currentPrice.toLocaleString()}`
                : "Non disponible"}
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Valeur actuelle</p>
            <p
              className={`font-medium ${
                !hasValidPrice
                  ? "text-gray-400 dark:text-gray-500"
                  : "text-gray-900 dark:text-gray-100"
              }`}
            >
              {hasValidPrice
                ? `$${currentValue.toLocaleString()}`
                : "Non calculable"}
            </p>
          </div>
        </div>

        <div className="border-t pt-3 border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Gain/Perte
            </span>
            {hasValidPrice ? (
              <div
                className={`flex items-center space-x-1 text-sm font-medium ${
                  gainLoss >= 0
                    ? "text-success-600 dark:text-success-400"
                    : "text-danger-600 dark:text-danger-400"
                }`}
              >
                {gainLoss >= 0 ? (
                  <TrendingUp size={16} />
                ) : (
                  <TrendingDown size={16} />
                )}
                <span>
                  ${gainLoss.toLocaleString()} ({gainLossPercent.toFixed(2)}%)
                </span>
              </div>
            ) : (
              <span className="text-sm text-gray-400 dark:text-gray-500">
                Non calculable
              </span>
            )}
          </div>
        </div>

        {investment.notes && (
          <div className="border-t pt-3 border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">Notes</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              {investment.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvestmentCard;
