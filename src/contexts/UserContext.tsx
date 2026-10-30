import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useCallback,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deleteUserData } from "../utils/storage";
import { applyUserTheme, getUserAccentColor } from "../utils/theme";
import { getAuthStatus } from "../services/portfolioApi";

export interface UserContextType {
  currentUser: string;
  setCurrentUser: (user: string) => void;
  availableUsers: string[];
  addUser: (userName: string) => void;
  deleteUser: (userName: string) => void;

  // Sécurité et verrouillage de session
  isLocked: boolean;
  isUnlocked: boolean;
  authTargetUser: string;
  authMode: "setup" | "unlock" | null;
  isCheckingAuth: boolean;
  unlockUser: (user: string) => void;
  lockUser: (user?: string) => void;
  lockAll: () => void;
  requestUserSwitch: (targetUser: string) => Promise<void>;
  openAuthModal: (user: string, mode: "setup" | "unlock") => void;
  cancelAuthModal: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};

interface UserProviderProps {
  children: ReactNode;
}

const isSessionUnlocked = (username: string): boolean => {
  try {
    return sessionStorage.getItem(`portfolio_auth_unlocked_${username}`) === "true";
  } catch {
    return false;
  }
};

const markSessionUnlocked = (username: string) => {
  try {
    sessionStorage.setItem(`portfolio_auth_unlocked_${username}`, "true");
  } catch {}
};

const clearSessionUnlocked = (username?: string) => {
  try {
    if (username) {
      sessionStorage.removeItem(`portfolio_auth_unlocked_${username}`);
    } else {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("portfolio_auth_unlocked_")) {
          sessionStorage.removeItem(key);
        }
      }
    }
  } catch {}
};

export const UserProvider: React.FC<UserProviderProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // Charger les utilisateurs depuis le localStorage ou utiliser la liste par défaut (limité à 2 utilisateurs max)
  const getInitialUsers = (): string[] => {
    const stored = localStorage.getItem("portfolio_users");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, 2);
        }
      } catch (error) {
        console.error("Erreur lors du chargement des utilisateurs:", error);
      }
    }
    return ["Romain", "Sophie"];
  };

  const [currentUser, setCurrentUser] = useState<string>(() => {
    const stored = localStorage.getItem("portfolio_current_user");
    return stored || "Romain";
  });

  const [availableUsers, setAvailableUsers] =
    useState<string[]>(getInitialUsers);

  // États de sécurité & authentification
  const [isLocked, setIsLocked] = useState<boolean>(() => !isSessionUnlocked(currentUser));
  const [authTargetUser, setAuthTargetUser] = useState<string>(currentUser);
  const [authMode, setAuthMode] = useState<"setup" | "unlock" | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);

  // Vérification de l'état d'authentification pour un utilisateur donné
  const checkUserAuth = useCallback(async (user: string) => {
    if (isSessionUnlocked(user)) {
      setIsLocked(false);
      setAuthMode(null);
      setIsCheckingAuth(false);
      return;
    }

    setIsCheckingAuth(true);
    try {
      const status = await getAuthStatus(user);
      if (!status.hasPassword) {
        // Premier accès ou aucun mot de passe configuré
        setIsLocked(true);
        setAuthTargetUser(user);
        setAuthMode("setup");
      } else {
        // Mot de passe configuré : session verrouillée
        setIsLocked(true);
        setAuthTargetUser(user);
        setAuthMode("unlock");
      }
    } catch (err) {
      console.warn("Impossible de vérifier l'état d'authentification:", err);
      // En cas d'erreur réseau, ne pas bloquer si la session est déjà ouverte
      if (!isSessionUnlocked(user)) {
        setIsLocked(true);
        setAuthTargetUser(user);
        setAuthMode("unlock");
      }
    } finally {
      setIsCheckingAuth(false);
    }
  }, []);

  // Vérifier l'authentification au démarrage de l'app ou si currentUser change
  useEffect(() => {
    checkUserAuth(currentUser);
  }, [currentUser, checkUserAuth]);

  // Sauvegarder les utilisateurs dans le localStorage quand ils changent (toujours borné à 2)
  useEffect(() => {
    localStorage.setItem("portfolio_users", JSON.stringify(availableUsers.slice(0, 2)));
  }, [availableUsers]);

  // Sauvegarder l'utilisateur actuel dans le localStorage quand il change
  useEffect(() => {
    localStorage.setItem("portfolio_current_user", currentUser);
  }, [currentUser]);

  // Appliquer dynamiquement la couleur d'accent de l'utilisateur actif
  useEffect(() => {
    const applyTheme = () => {
      const color = getUserAccentColor(currentUser);
      applyUserTheme(color);
    };

    applyTheme();

    const handleSettingsUpdated = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (!customEvent.detail || customEvent.detail.username === currentUser) {
        applyTheme();
      }
    };

    window.addEventListener("userSettingsUpdated", handleSettingsUpdated);
    return () => {
      window.removeEventListener("userSettingsUpdated", handleSettingsUpdated);
    };
  }, [currentUser]);

  // Rediriger automatiquement si on est sur une page Settings d'un autre utilisateur
  useEffect(() => {
    const settingsMatch = location.pathname.match(/^\/settings\/(.+)$/);
    if (settingsMatch) {
      const settingsUser = settingsMatch[1];
      if (settingsUser !== currentUser) {
        navigate(`/settings/${currentUser}`, { replace: true });
      }
    }
  }, [currentUser, location.pathname, navigate]);

  const unlockUser = (user: string) => {
    markSessionUnlocked(user);
    setCurrentUser(user);
    setAuthTargetUser(user);
    setIsLocked(false);
    setAuthMode(null);
  };

  const lockUser = (user?: string) => {
    const target = user || currentUser;
    clearSessionUnlocked(target);
    if (target === currentUser) {
      setIsLocked(true);
      setAuthTargetUser(target);
      setAuthMode("unlock");
    }
  };

  const lockAll = () => {
    clearSessionUnlocked();
    setIsLocked(true);
    setAuthTargetUser(currentUser);
    setAuthMode("unlock");
  };

  const requestUserSwitch = async (targetUser: string) => {
    if (targetUser === currentUser) {
      if (isLocked) {
        await checkUserAuth(currentUser);
      }
      return;
    }

    if (isSessionUnlocked(targetUser)) {
      // Déjà déverrouillé dans l'onglet
      setCurrentUser(targetUser);
      setAuthTargetUser(targetUser);
      setIsLocked(false);
      setAuthMode(null);
      return;
    }

    // Demander le mot de passe pour targetUser
    setAuthTargetUser(targetUser);
    try {
      const status = await getAuthStatus(targetUser);
      setAuthMode(status.hasPassword ? "unlock" : "setup");
    } catch {
      setAuthMode("unlock");
    }
  };

  const openAuthModal = (user: string, mode: "setup" | "unlock") => {
    setAuthTargetUser(user);
    setAuthMode(mode);
  };

  const cancelAuthModal = () => {
    if (authTargetUser !== currentUser) {
      // Annule la bascule vers l'autre utilisateur
      setAuthTargetUser(currentUser);
      setAuthMode(isSessionUnlocked(currentUser) ? null : "unlock");
    }
  };

  const addUser = (userName: string) => {
    if (availableUsers.length >= 2) return;
    const trimmed = userName.trim();
    if (trimmed && !availableUsers.includes(trimmed)) {
      setAvailableUsers((prev) => [...prev, trimmed].slice(0, 2));
    }
  };

  const deleteUser = async (userName: string) => {
    if (availableUsers.length > 1) {
      // Supprimer toutes les données de l'utilisateur
      await deleteUserData(userName);
      clearSessionUnlocked(userName);

      // Supprimer l'utilisateur de la liste
      setAvailableUsers((prev) => prev.filter((user) => user !== userName));

      // Si l'utilisateur supprimé était l'utilisateur actuel, changer vers le premier utilisateur disponible
      if (currentUser === userName) {
        const remainingUsers = availableUsers.filter(
          (user) => user !== userName,
        );
        if (remainingUsers.length > 0) {
          const nextUser = remainingUsers[0];
          setCurrentUser(nextUser);
          checkUserAuth(nextUser);
        }
      }
    }
  };

  return (
    <UserContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        availableUsers,
        addUser,
        deleteUser,
        isLocked,
        isUnlocked: !isLocked,
        authTargetUser,
        authMode,
        isCheckingAuth,
        unlockUser,
        lockUser,
        lockAll,
        requestUserSwitch,
        openAuthModal,
        cancelAuthModal,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
