import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BarChart3,
  PiggyBank,
  Brain,
  PlusCircle,
  Activity,
  ChevronDown,
  X,
  Plus,
  Settings,
  Landmark,
  Eye,
  EyeOff,
  Receipt,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";

const Navbar: React.FC = () => {
  const location = useLocation();
  const { currentUser, setCurrentUser, availableUsers, addUser, deleteUser } =
    useUser();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dashboardAnonymous") === "1";
  });

  const toggleAnonymous = () => {
    const next = !isAnonymous;
    setIsAnonymous(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboardAnonymous", next ? "1" : "0");
      window.dispatchEvent(
        new CustomEvent("dashboardAnonymousChanged", {
          detail: { value: next },
        }),
      );
    }
  };

  React.useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "dashboardAnonymous") return;
      setIsAnonymous(event.newValue === "1");
    };
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as
        | { value?: boolean }
        | undefined;
      if (typeof detail?.value === "boolean") {
        setIsAnonymous(detail.value);
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "dashboardAnonymousChanged",
      handleCustom as EventListener,
    );
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "dashboardAnonymousChanged",
        handleCustom as EventListener,
      );
    };
  }, []);

  const navItems = [
    {
      name: "Dashboard",
      path: "/",
      icon: BarChart3,
    },
    {
      name: "Investissements",
      path: "/investments",
      icon: PlusCircle,
    },
    {
      name: "Compte bancaire",
      path: "/banking",
      icon: Landmark,
    },
    {
      name: "Budget",
      path: "/budget",
      icon: Receipt,
    },
    {
      name: "Épargne",
      path: "/savings",
      icon: PiggyBank,
    },
    {
      name: "Analyse IA",
      path: "/ai-analysis",
      icon: Brain,
    },
  ];

  const handleAddUser = () => {
    if (newUserName.trim() && availableUsers.length < 2) {
      addUser(newUserName.trim());
      setNewUserName("");
      setIsAddUserModalOpen(false);
    }
  };

  const handleDeleteUser = (userName: string) => {
    if (
      window.confirm(
        `Êtes-vous sûr de vouloir supprimer l'utilisateur "${userName}" ? Toutes ses données seront supprimées.`,
      )
    ) {
      deleteUser(userName);
    }
  };

  return (
    <>
      <nav className="bg-[#111111]  border-b border-[rgba(255,255,255,0.06)] bg-[#111111] border-[rgba(255,255,255,0.06)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <span className="ml-2 text-xl font-bold text-[#f5f5f5]">
                  Portfolio
                </span>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navItems.map((item) => {
                  const isActive =
                    location.pathname === item.path ||
                    (item.path === "/budget" &&
                      (location.pathname === "/budget-tracking" ||
                        location.pathname === "/tricount"));
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      className={`${
                        isActive
                          ? "border-[#c8a55e] text-[#c8a55e] text-[#c8a55e]"
                          : "border-transparent text-[#555555] hover:border-[rgba(255,255,255,0.08)] hover:text-[#8a8a8a] hover:text-[#f5f5f5] "
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200`}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* User Selector */}
            <div className="flex items-center">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAnonymous}
                  className="p-2 rounded-md text-[#555555] hover:text-[#8a8a8a] text-[#555555] hover:text-[#f5f5f5] transition-colors"
                  title={
                    isAnonymous
                      ? "Afficher les chiffres"
                      : "Masquer les chiffres"
                  }
                  aria-label={
                    isAnonymous
                      ? "Afficher les chiffres"
                      : "Masquer les chiffres"
                  }
                >
                  {isAnonymous ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-[#8a8a8a] transition-colors duration-200"
                  >
                    <span>{currentUser}</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>

                  {isUserMenuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-[#111111] rounded-md  border border-[rgba(255,255,255,0.06)] z-50">
                      <div className="py-1">
                        {availableUsers.map((user) => (
                          <div
                            key={user}
                            className="flex items-center justify-between px-4 py-2 text-sm transition-colors duration-200"
                          >
                            <button
                              onClick={() => {
                                setCurrentUser(user);
                                setIsUserMenuOpen(false);
                              }}
                              className={`${
                                currentUser === user
                                  ? "text-[#c8a55e] text-[#c8a55e]"
                                  : "text-[#8a8a8a]"
                              } flex-1 text-left transition-colors duration-200`}
                            >
                              {user}
                            </button>
                            <div className="flex items-center space-x-1">
                              <Link
                                to={`/settings/${user}`}
                                onClick={() => setIsUserMenuOpen(false)}
                                className="p-1 text-[#555555] hover:text-[#f5f5f5] hover:text-[#f5f5f5] transition-colors duration-200"
                                title={`Paramètres de ${user}`}
                              >
                                <Settings className="h-4 w-4" />
                              </Link>
                              {availableUsers.length > 1 && (
                                <button
                                  onClick={() => handleDeleteUser(user)}
                                  className="p-1 text-[#555555] hover:text-rose-500 dark:hover:text-rose-400 transition-colors duration-200"
                                  title={`Supprimer ${user}`}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Bouton pour ajouter un utilisateur (limité à 2 utilisateurs max) */}
                        {availableUsers.length < 2 && (
                          <div className="border-t border-[rgba(255,255,255,0.06)] pt-1">
                            <button
                              onClick={() => {
                                setIsAddUserModalOpen(true);
                                setIsUserMenuOpen(false);
                              }}
                              className="flex items-center w-full px-4 py-2 text-sm text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-200"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Ajouter un utilisateur
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        <div className="sm:hidden">
          <div className="pt-2 pb-3 space-y-1">
            {navItems.map((item) => {
              const isActive =
                location.pathname === item.path ||
                (item.path === "/budget" &&
                  (location.pathname === "/budget-tracking" ||
                    location.pathname === "/tricount"));
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={`${
                    isActive
                      ? "bg-primary-50 border-[#c8a55e] text-[#c8a55e] dark:bg-primary-900 text-[#c8a55e]"
                      : "border-transparent text-[#555555] hover:bg-[#0a0a0a] hover:border-[rgba(255,255,255,0.08)] hover:text-[#8a8a8a] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#f5f5f5] "
                  } block pl-3 pr-4 py-2 border-l-4 text-base font-medium transition-colors duration-200`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Modal pour ajouter un utilisateur */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[#111111] rounded-lg p-6 w-96 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-[#f5f5f5] mb-4">
              Ajouter un nouvel utilisateur
            </h3>
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Nom de l'utilisateur"
              className="input-field"
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  handleAddUser();
                }
              }}
            />
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setIsAddUserModalOpen(false);
                  setNewUserName("");
                }}
                className="px-4 py-2 text-[#8a8a8a] hover:text-[#f5f5f5] hover:text-[#f5f5f5] transition-colors duration-200"
              >
                Annuler
              </button>
              <button
                onClick={handleAddUser}
                disabled={!newUserName.trim()}
                className="px-4 py-2 bg-[#c8a55e] text-white rounded-md hover:bg-[#d4b06a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
