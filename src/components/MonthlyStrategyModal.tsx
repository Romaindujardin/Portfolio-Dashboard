import React, { useEffect } from "react";
import SavingsStrategyPage from "../pages/SavingsStrategy";
import { SavingsStrategy } from "../types";

export interface MonthlyStrategyModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthKey: string;
  onStrategySaved?: (strategy: SavingsStrategy) => void;
}

export const MonthlyStrategyModal: React.FC<MonthlyStrategyModalProps> = ({
  isOpen,
  onClose,
  monthKey,
  onStrategySaved,
}) => {
  // Gestion de la touche Échap pour fermer la modale
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Conteneur de la modale */}
      <div
        className="bg-[#111111] dark:bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.06)] rounded-2xl w-full max-w-7xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto flex-1">
          <SavingsStrategyPage
            monthKey={monthKey}
            isModal={true}
            onClose={onClose}
            onStrategySaved={onStrategySaved}
          />
        </div>
      </div>
    </div>
  );
};

export default MonthlyStrategyModal;
