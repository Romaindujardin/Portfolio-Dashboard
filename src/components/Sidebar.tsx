import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  PiggyBank,
  Sparkles,
  ChevronDown,
  X,
  Plus,
  Settings,
  Building2,
  Receipt,
  Menu,
  Wallet2,
  TrendingUp,
  Lock,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import type { LucideIcon } from "lucide-react";

interface NavChild {
  name: string;
  path: string;
}

interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  children?: NavChild[];
}

const navItems: NavItem[] = [
  {
    name: "Synthèse",
    path: "/",
    icon: LayoutGrid,
  },
  {
    name: "Patrimoine",
    path: "/patrimoine",
    icon: Building2,
  },
  {
    name: "Marché",
    path: "/market",
    icon: TrendingUp,
  },
  {
    name: "Budget",
    path: "/budget",
    icon: Receipt,
    children: [{ name: "Stratégie", path: "/strategy" }],
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

const Sidebar: React.FC = () => {
  const location = useLocation();
  const {
    currentUser,
    availableUsers,
    addUser,
    deleteUser,
    lockUser,
    requestUserSwitch,
  } = useUser();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Fermer le menu utilisateur lors d'un clic extérieur, changement d'URL ou touche Échap
  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setIsUserMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUserMenuOpen]);

  useEffect(() => {
    setIsUserMenuOpen(false);
  }, [location.pathname]);

  // Sous-page(s) dépliée(s) : « Budget › Stratégie » s'ouvre automatiquement sur sa route
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  React.useEffect(() => {
    const activeGroup = navItems.find((item) =>
      item.children?.some((child) => location.pathname === child.path),
    );
    if (activeGroup) {
      setOpenGroups((prev) =>
        prev[activeGroup.name] ? prev : { ...prev, [activeGroup.name]: true },
      );
    }
  }, [location.pathname]);

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
          const hasChildren = Boolean(item.children?.length);
          const isGroupOpen = hasChildren
            ? Boolean(openGroups[item.name])
            : false;
          return (
            <React.Fragment key={item.name}>
              <div className="flex items-center gap-0.5">
                <Link
                  to={item.path}
                  onClick={() => setIsMobileOpen(false)}
                  className={`sidebar-link flex-1 min-w-0 ${isActive ? "active" : ""}`}
                >
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                  <span>{item.name}</span>
                </Link>
                {hasChildren && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((prev) => ({
                        ...prev,
                        [item.name]: !isGroupOpen,
                      }))
                    }
                    className="p-1.5 rounded-md text-[#555555] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)] transition-all duration-200 flex-shrink-0"
                    title={
                      isGroupOpen
                        ? "Masquer la sous-page"
                        : "Afficher la sous-page"
                    }
                    aria-label={
                      isGroupOpen
                        ? `Masquer la sous-page ${item.children![0].name}`
                        : `Afficher la sous-page ${item.children![0].name}`
                    }
                    aria-expanded={isGroupOpen}
                  >
                    <ChevronDown
                      size={14}
                      className={`transition-transform duration-200 ${
                        isGroupOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                )}
              </div>
              {hasChildren && isGroupOpen && (
                <div className="relative -mt-0.5 ml-[25px] space-y-0.5">
                  {item.children!.map((child, childIndex) => {
                    const isChildActive =
                      location.pathname === child.path;
                    const isLastChild =
                      childIndex === item.children!.length - 1;
                    return (
                      <div key={child.path} className="group relative">
                        {/* Connecteur d'arborescence : descente depuis l'icône du parent puis coude vers la sous-page */}
                        <span
                          aria-hidden="true"
                          className={`absolute left-0 top-0 w-[18px] border-l transition-colors duration-200 ${
                            isLastChild
                              ? "h-1/2 rounded-bl-md border-b"
                              : "bottom-0"
                          } ${
                            isChildActive
                              ? "border-[#c8a55e]"
                              : "border-[#8a8a8a] group-hover:border-[#f5f5f5]"
                          }`}
                        />
                        <Link
                          to={child.path}
                          onClick={() => setIsMobileOpen(false)}
                          className={`flex items-center py-2 pl-[21px] pr-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                            isChildActive
                              ? "text-[#c8a55e]"
                              : "text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)]"
                          }`}
                        >
                          <span>{child.name}</span>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Bottom section: User selector */}
      <div className="mt-auto border-t border-[rgba(255,255,255,0.06)]">
        {/* User selector */}
        <div className="px-4 py-4">
          <div className="relative" ref={userMenuRef}>
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
                          requestUserSwitch(user);
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

                  {/* Option Verrouiller la session */}
                  <div className="border-t border-[rgba(255,255,255,0.06)] pt-1">
                    <button
                      onClick={() => {
                        lockUser(currentUser);
                        setIsUserMenuOpen(false);
                      }}
                      className="flex items-center w-full px-3 py-2 text-sm text-[#8a8a8a] hover:text-[#f5f5f5] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-200"
                    >
                      <Lock className="h-3.5 w-3.5 mr-2 text-[#c8a55e]" />
                      Verrouiller la session
                    </button>
                  </div>

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
