import React from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import type { PortfolioAccountType } from "../../types/portfolio";
import {
  formatMoney as formatMoneyUtil,
  formatPercent as formatPercentUtil,
} from "../../contexts/CurrencyContext";

export const INVESTMENT_ACCOUNT_TYPES = new Set<PortfolioAccountType>([
  "PEA",
  "SECURITIES",
  "CRYPTO",
  "EMPLOYEE_SAVINGS",
]);

export const formatEur = (
  value: number | null | undefined,
  options: { compact?: boolean; signed?: boolean; digits?: number; fallback?: string } = {},
): string => {
  return formatMoneyUtil(value, options);
};

export const formatPercent = (
  value: number | null | undefined,
  digits = 2,
): string => {
  return formatPercentUtil(value, digits);
};

export const formatDate = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

export const todayInput = (): string => new Date().toISOString().slice(0, 10);

export const cn = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(" ");

// ─── Carte ──────────────────────────────────────────────────────────────────

export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div
    className={cn(
      "rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#111111]",
      className,
    )}
  >
    {children}
  </div>
);

export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, action }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="text-base font-semibold text-[#f5f5f5]">{title}</h2>
      {subtitle && <p className="mt-1 text-xs text-[#8a8a8a]">{subtitle}</p>}
    </div>
    {action}
  </div>
);

// ─── Boutons ────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[#c8a55e] text-[#0a0a0a] hover:bg-[#d4b56e] border border-transparent font-semibold",
  secondary:
    "bg-transparent text-[#d4d4d4] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)]",
  danger:
    "bg-transparent text-[#ef4444] hover:bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.25)]",
  ghost:
    "bg-transparent text-[#8a8a8a] hover:text-[#f5f5f5] border border-transparent",
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "sm" | "md";
    loading?: boolean;
  }
> = ({ variant = "secondary", size = "md", loading, className, children, ...props }) => (
  <button
    type="button"
    {...props}
    disabled={props.disabled || loading}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
      buttonStyles[variant],
      className,
    )}
  >
    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    {children}
  </button>
);

// ─── Champs ─────────────────────────────────────────────────────────────────

const fieldClass =
  "w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-3 py-2 text-sm text-[#f5f5f5] outline-none transition-colors placeholder:text-[#555555] focus:border-[#c8a55e] disabled:opacity-50";

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({
  className,
  ...props
}) => <input {...props} className={cn(fieldClass, className)} />;

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({
  className,
  children,
  ...props
}) => (
  <select {...props} className={cn(fieldClass, "appearance-none", className)}>
    {children}
  </select>
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({
  className,
  ...props
}) => <textarea {...props} className={cn(fieldClass, "min-h-[90px]", className)} />;

export const Field: React.FC<{
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ label, hint, required, children, className }) => (
  <label className={cn("block", className)}>
    <span className="mb-1.5 block text-xs font-medium text-[#b0b0b0]">
      {label}
      {required && <span className="ml-0.5 text-[#c8a55e]">*</span>}
    </span>
    {children}
    {hint && <span className="mt-1 block text-[11px] text-[#6a6a6a]">{hint}</span>}
  </label>
);

// ─── Badge ──────────────────────────────────────────────────────────────────

type BadgeTone = "gold" | "green" | "red" | "gray" | "blue";

const badgeTones: Record<BadgeTone, string> = {
  gold: "border-[rgba(200,165,94,0.3)] bg-[rgba(200,165,94,0.1)] text-[#d4b56e]",
  green: "border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] text-[#34d399]",
  red: "border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] text-[#f87171]",
  gray: "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] text-[#8a8a8a]",
  blue: "border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.1)] text-[#60a5fa]",
};

export const Badge: React.FC<{
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}> = ({ children, tone = "gray", className }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
      badgeTones[tone],
      className,
    )}
  >
    {children}
  </span>
);

// ─── États ──────────────────────────────────────────────────────────────────

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8a8a8a]">
    <Loader2 className="h-4 w-4 animate-spin text-[#c8a55e]" />
    {label || "Chargement…"}
  </div>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[rgba(255,255,255,0.08)] px-6 py-10 text-center">
    {icon && <div className="mb-3 text-[#c8a55e]">{icon}</div>}
    <p className="text-sm font-medium text-[#d4d4d4]">{title}</p>
    {description && <p className="mt-1 max-w-md text-xs text-[#8a8a8a]">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorBanner: React.FC<{ message: string; onClose?: () => void }> = ({
  message,
  onClose,
}) => (
  <div className="flex items-start gap-2 rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[#fca5a5]">
    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
    <span className="flex-1">{message}</span>
    {onClose && (
      <button type="button" onClick={onClose} className="text-[#fca5a5] hover:text-white">
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);

export const SuccessBanner: React.FC<{ message: string; onClose?: () => void }> = ({
  message,
  onClose,
}) => (
  <div className="flex items-start gap-2 rounded-lg border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.08)] px-3 py-2 text-xs text-[#6ee7b7]">
    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
    <span className="flex-1">{message}</span>
    {onClose && (
      <button type="button" onClick={onClose} className="text-[#6ee7b7] hover:text-white">
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);

// ─── Modale ─────────────────────────────────────────────────────────────────

export const Modal: React.FC<{
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}> = ({ open, title, onClose, children, footer, wide }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div
        className={cn(
          "w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#141414] shadow-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.07)] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[#f5f5f5]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#f5f5f5]"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[rgba(255,255,255,0.07)] px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Ligne de statistique ───────────────────────────────────────────────────

export const StatRow: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  emphasis?: boolean;
}> = ({ label, value, hint, emphasis }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <span className="text-xs text-[#8a8a8a]">{label}</span>
    <span
      className={cn(
        "text-right text-sm tabular-nums",
        emphasis ? "font-semibold text-[#d4b56e]" : "text-[#e5e5e5]",
      )}
    >
      {value}
      {hint && <span className="ml-1 text-[10px] text-[#6a6a6a]">{hint}</span>}
    </span>
  </div>
);

export const accountTypeLabel: Record<string, string> = {
  CHECKING: "Compte courant",
  SAVINGS: "Épargne",
  PEA: "PEA",
  SECURITIES: "Compte-titres",
  CRYPTO: "Crypto",
  REAL_ESTATE: "Immobilier",
  LOAN: "Prêt",
  EMPLOYEE_SAVINGS: "Épargne salariale",
  OTHER: "Autre",
};

export const connectionStatusLabel: Record<string, string> = {
  pending: "En attente",
  active: "Active",
  expired: "À reconnecter",
  error: "Erreur",
};

export const confidenceLabel: Record<string, string> = {
  HIGH: "Élevée",
  MEDIUM: "Moyenne",
  LOW: "Faible",
};

export const propertyTypeLabel: Record<string, string> = {
  HOUSE: "Maison",
  APARTMENT: "Appartement",
  OTHER: "Autre",
};
