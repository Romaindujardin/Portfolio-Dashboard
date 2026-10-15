import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  BarChart3,
  PiggyBank,
  Sparkles,
  ChevronDown,
  X,
  Plus,
  Settings,
  Landmark,
  Eye,
  EyeOff,
  Receipt,
  Menu,
  Wallet2,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";

const Sidebar: React.FC = () => {
  const location = useLocation();
  const { currentUser, setCurrentUser, availableUsers, addUser, deleteUser } =
    useUser();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
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
      name: "Synthèse",
      path: "/",
      icon: LayoutGrid,
    },
    {
      name: "Portefeuille",
      path: "/investments",
      icon: BarChart3,
    },
    {
      name: "Banque",
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
      name: "Conseiller IA",
      path: "/ai-analysis",
      icon: Sparkles,
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

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-5 py-6 flex items-center gap-2.5">
        <Wallet2
          className="w-6 h-6 flex-shrink-0 text-[#c8a55e]"
          strokeWidth={2.2}
        />
        <span className="text-xl font-bold tracking-tight text-[#f5f5f5]">
          Portfolio
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              to={item.path}
              onClick={() => setIsMobileOpen(false)}
              className={`sidebar-link ${isActive ? "active" : ""}`}
            >
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom section: User + Controls */}
      <div className="mt-auto border-t border-[rgba(255,255,255,0.06)]">
        {/* Anonymous toggle */}
        <div className="px-4 pt-3 pb-1">
          <button
            type="button"
            onClick={toggleAnonymous}
            className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)] transition-all duration-200"
            title={isAnonymous ? "Afficher les chiffres" : "Masquer les chiffres"}
          >
            {isAnonymous ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            <span className="text-xs">{isAnonymous ? "Afficher" : "Masquer"}</span>
          </button>
        </div>

        {/* User selector */}
        <div className="px-4 pb-4">
          <div className="relative">
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-3 w-full px-2 py-2.5 rounded-lg hover:bg-[rgba(255,255,255,0.04)] transition-all duration-200"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{ background: 'linear-gradient(135deg, #c8a55e 0%, #b8944e 100%)', color: '#0a0a0a' }}
              >
                {getInitials(currentUser)}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-[#f5f5f5] truncate">{currentUser}</p>
              </div>
              <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${isUserMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isUserMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl shadow-2xl border border-[rgba(255,255,255,0.08)] overflow-hidden bg-[#161616]">
                <div className="py-1">
                  {availableUsers.map((user) => (
                    <div
                      key={user}
                      className="flex items-center justify-between px-3 py-2 hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-200"
                    >
                      <button
                        onClick={() => {
                          setCurrentUser(user);
                          setIsUserMenuOpen(false);
                        }}
                        className={`flex items-center gap-2 flex-1 text-left text-sm transition-colors duration-200 ${
                          currentUser === user
                            ? "text-[#c8a55e]"
                            : "text-[#8a8a8a] hover:text-[#f5f5f5]"
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
                          style={
                            currentUser === user
                              ? { background: 'linear-gradient(135deg, #c8a55e 0%, #b8944e 100%)', color: '#0a0a0a' }
                              : { backgroundColor: '#2a2a2a', color: '#8a8a8a' }
                          }
                        >
                          {getInitials(user)}
                        </div>
                        {user}
                      </button>
                      <div className="flex items-center gap-1">
                        <Link
                          to={`/settings/${user}`}
                          onClick={() => setIsUserMenuOpen(false)}
                          className="p-1 text-[#555555] hover:text-[#f5f5f5] transition-colors duration-200"
                          title={`Paramètres de ${user}`}
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </Link>
                        {availableUsers.length > 1 && (
                          <button
                            onClick={() => handleDeleteUser(user)}
                            className="p-1 text-[#555555] hover:text-[#ef4444] transition-colors duration-200"
                            title={`Supprimer ${user}`}
                          >
                            <X className="h-3.5 w-3.5" />
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
                        className="flex items-center w-full px-3 py-2 text-sm text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-200"
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
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#111111] border border-[rgba(255,255,255,0.08)]"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
      >
        <Menu className="w-5 h-5 text-[#f5f5f5]" />
      </button>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileOpen ? "open" : ""}`}>
        {sidebarContent}
      </aside>

      {/* Modal pour ajouter un utilisateur */}
      {isAddUserModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
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
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setIsAddUserModalOpen(false);
                  setNewUserName("");
                }}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button
                onClick={handleAddUser}
                disabled={!newUserName.trim()}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
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

export default Sidebar;
