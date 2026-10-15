import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deleteUserData } from "../utils/storage";
import { applyUserTheme, getUserAccentColor } from "../utils/theme";

interface UserContextType {
  currentUser: string;
  setCurrentUser: (user: string) => void;
  availableUsers: string[];
  addUser: (userName: string) => void;
  deleteUser: (userName: string) => void;
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
        // Rediriger vers les paramètres de l'utilisateur actuel
        navigate(`/settings/${currentUser}`, { replace: true });
      }
    }
  }, [currentUser, location.pathname, navigate]);

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

      // Supprimer l'utilisateur de la liste
      setAvailableUsers((prev) => prev.filter((user) => user !== userName));

      // Si l'utilisateur supprimé était l'utilisateur actuel, changer vers le premier utilisateur disponible
      if (currentUser === userName) {
        const remainingUsers = availableUsers.filter(
          (user) => user !== userName
        );
        if (remainingUsers.length > 0) {
          setCurrentUser(remainingUsers[0]);
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
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
