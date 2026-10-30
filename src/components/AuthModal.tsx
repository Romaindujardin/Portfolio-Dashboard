import React, { useState, useEffect, useRef } from "react";
import { Lock, Shield, Eye, EyeOff, Loader2, Check, AlertCircle, ArrowLeftRight } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { verifyPassword, setupPassword } from "../services/portfolioApi";
import { scorePassword } from "../utils/passwordStrength";

export const AuthModal: React.FC = () => {
  const {
    currentUser,
    availableUsers,
    isLocked,
    authTargetUser,
    authMode,
    unlockUser,
    cancelAuthModal,
    requestUserSwitch,
  } = useUser();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus automatique du champ mot de passe
  useEffect(() => {
    if (authMode || isLocked) {
      setPassword("");
      setConfirmPassword("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [authMode, isLocked, authTargetUser]);

  const targetUser = authTargetUser || currentUser;
  const isSetup = authMode === "setup";
  const isOpen = Boolean(authMode) || isLocked;

  if (!isOpen) return null;

  const strength = scorePassword(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = isSetup
    ? password.length >= 4 && passwordsMatch && !isSubmitting
    : password.length > 0 && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setIsSubmitting(true);

    try {
      if (isSetup) {
        if (password.length < 4) {
          setError("Le mot de passe doit comporter au moins 4 caractères.");
          setIsSubmitting(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Les deux mots de passe ne correspondent pas.");
          setIsSubmitting(false);
          return;
        }
        await setupPassword(targetUser, password);
        unlockUser(targetUser);
      } else {
        await verifyPassword(targetUser, password);
        unlockUser(targetUser);
      }
    } catch (err: any) {
      console.error("Erreur d'authentification:", err);
      if (err.status === 401 || err.message?.toLowerCase().includes("incorrect")) {
        setError("Mot de passe incorrect. Veuillez réessayer.");
      } else {
        setError(err.message || "Une erreur est survenue lors de l'authentification.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Possibilité d'annuler uniquement si on essayait de basculer vers un autre utilisateur
  const canCancel = authTargetUser !== null && authTargetUser !== currentUser;

  // Autres utilisateurs disponibles pour basculer facilement
  const otherUsers = availableUsers.filter((u) => u !== targetUser);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-all duration-300"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-[#121212] border border-[rgba(255,255,255,0.08)] rounded-2xl shadow-2xl p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200">
        {/* Header avec Avatar */}
        <div className="text-center mb-6">
          <div className="relative inline-block mb-3">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mx-auto shadow-lg"
              style={{
                background:
                  "linear-gradient(135deg, #c8a55e 0%, #b8944e 100%)",
                color: "#0a0a0a",
              }}
            >
              {getInitials(targetUser)}
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#1b1b1b] border border-[rgba(255,255,255,0.12)] flex items-center justify-center text-[#c8a55e]">
              {isSetup ? (
                <Shield className="w-3.5 h-3.5" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
            </div>
          </div>

          <h2 className="text-xl font-bold text-[#f5f5f5]">
            {isSetup
              ? "Sécuriser votre profil"
              : authTargetUser && authTargetUser !== currentUser
                ? `Accès au profil de ${targetUser}`
                : "Profil Verrouillé"}
          </h2>
          <p className="text-sm text-[#8a8a8a] mt-1">
            {isSetup
              ? `Définissez un mot de passe pour le profil de ${targetUser}`
              : authTargetUser && authTargetUser !== currentUser
                ? `Ce compte est protégé. Saisissez le mot de passe de ${targetUser} pour y accéder.`
                : `Saisissez votre mot de passe pour accéder à ${targetUser}`}
          </p>
        </div>

        {/* Message d'erreur */}
        {error && (
          <div className="mb-5 p-3 rounded-xl bg-red-950/40 border border-red-500/30 flex items-center gap-2.5 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
            <p className="flex-1">{error}</p>
          </div>
        )}

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#8a8a8a] mb-1.5">
              {isSetup ? "Nouveau mot de passe" : "Mot de passe"}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-3 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] focus:border-[#c8a55e] focus:outline-none rounded-xl text-[#f5f5f5] placeholder-[#555555] transition-all duration-200 pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#666666] hover:text-[#f5f5f5] p-1 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Indicateur de force du mot de passe en mode setup */}
          {isSetup && password.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#8a8a8a]">Force du mot de passe :</span>
                <span style={{ color: strength.color }} className="font-medium">
                  {strength.label}
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#252525] rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    width: `${strength.percent}%`,
                    backgroundColor: strength.color,
                  }}
                />
              </div>
            </div>
          )}

          {/* Confirmation du mot de passe en mode setup */}
          {isSetup && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#8a8a8a] mb-1.5">
                Confirmer le mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-3 bg-[#1a1a1a] border border-[rgba(255,255,255,0.08)] focus:border-[#c8a55e] focus:outline-none rounded-xl text-[#f5f5f5] placeholder-[#555555] transition-all duration-200 pr-11"
                />
                {passwordsMatch && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 p-1">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </div>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-400 mt-1">
                  Les mots de passe ne correspondent pas.
                </p>
              )}
            </div>
          )}

          {/* Boutons d'action */}
          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3 px-4 rounded-xl font-medium text-sm text-[#0a0a0a] transition-all duration-200 shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: canSubmit
                  ? "linear-gradient(135deg, #c8a55e 0%, #b8944e 100%)"
                  : "#2a2a2a",
                color: canSubmit ? "#0a0a0a" : "#666666",
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isSetup ? "Enregistrement..." : "Vérification..."}</span>
                </>
              ) : (
                <span>
                  {isSetup
                    ? "Définir mon mot de passe"
                    : authTargetUser && authTargetUser !== currentUser
                      ? `Déverrouiller et accéder à ${targetUser}`
                      : "Déverrouiller"}
                </span>
              )}
            </button>

            {canCancel && (
              <button
                type="button"
                onClick={cancelAuthModal}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-medium text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)] transition-all duration-200"
              >
                Annuler et rester sur {currentUser}
              </button>
            )}
          </div>
        </form>

        {/* Changer d'utilisateur si profil bloqué */}
        {otherUsers.length > 0 && (
          <div className="mt-6 pt-5 border-t border-[rgba(255,255,255,0.06)] text-center">
            <p className="text-xs text-[#8a8a8a] mb-2.5">
              Ce n'est pas vous ?
            </p>
            <div className="flex justify-center gap-2">
              {otherUsers.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => requestUserSwitch(u)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.06)] text-xs font-medium text-[#c8a55e] transition-colors"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  <span>Accéder à {u}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthModal;
