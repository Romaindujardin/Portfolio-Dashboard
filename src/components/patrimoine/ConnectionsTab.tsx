import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Landmark,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  Zap,
} from "lucide-react";
import type {
  Connection,
  Institution,
  IntegrationStatus,
} from "../../types/portfolio";
import {
  BoursoSidecarStatus,
  BnpSidecarJob,
  BnpSidecarStatus,
  FortuneoSidecarStatus,
  PortfolioApiError,
  cancelBnpSidecarJob,
  completeConnection,
  connectBoursoSidecar,
  deleteBnpSidecarCredentials,
  deleteBoursoSidecarCredentials,
  deleteFortuneoSidecarCredentials,
  deleteIntegrationSettings,
  disconnect,
  getBnpSidecarJob,
  getBnpSidecarStatus,
  getBoursoSidecarStatus,
  getCountries,
  getFortuneoSidecarStatus,
  saveIntegrationSettings,
  searchInstitutions,
  startBnpSidecarSync,
  startConnection,
  submitBnpSidecarMfa,
  syncAllConnections,
  syncConnection,
  syncFortuneoSidecar,
} from "../../services/portfolioApi";
import { getDefaultEnableBankingCallbackUrl } from "../../utils/apiBase";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  SectionHeader,
  Spinner,
  cn,
  connectionStatusLabel,
  formatDate,
} from "./shared";

type Notify = (kind: "success" | "error", message: string) => void;

interface ConnectionsTabProps {
  userId: string;
  connections: Connection[];
  status: IntegrationStatus | null;
  onReload: () => Promise<void>;
  notify: Notify;
}

const statusTone = (status: string) => {
  if (status === "active") return "green" as const;
  if (status === "pending") return "gold" as const;
  return "red" as const;
};

const defaultCallbackUrl = getDefaultEnableBankingCallbackUrl();

const ConnectionLogo: React.FC<{ connection: Connection }> = ({ connection }) => {
  const [logoError, setLogoError] = useState(false);
  const isSidecar = connection.provider.endsWith("-sidecar");
  const bankName = `${connection.aspspName || ""} ${connection.label || ""}`.toLowerCase();
  const isBourso =
    (isSidecar && connection.provider === "bourso-sidecar") ||
    bankName.includes("bourso");
  const isBnp = bankName.includes("bnp") || bankName.includes("paribas");
  const isFortuneo = bankName.includes("fortuneo");

  const logoUrl =
    connection.logo ||
    (isBourso
      ? "https://enablebanking.com/brands/FR/Boursorama%20Banque/"
      : isBnp
        ? "https://enablebanking.com/brands/FR/BNP%20Paribas/"
        : isFortuneo
          ? "https://enablebanking.com/brands/FR/Fortuneo/"
          : connection.aspspName
            ? `https://enablebanking.com/brands/${encodeURIComponent(connection.aspspCountry || "FR")}/${encodeURIComponent(connection.aspspName)}/`
            : null);

  if (logoUrl && !logoError) {
    return (
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/95 p-1 shadow-sm">
        <img
          src={logoUrl}
          alt={connection.label || connection.aspspName || "Banque"}
          className="h-7 w-7 object-contain"
          onError={() => setLogoError(true)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(200,165,94,0.08)]">
      {isSidecar ? (
        <Zap className="h-4 w-4 text-[#c8a55e]" />
      ) : (
        <Landmark className="h-4 w-4 text-[#c8a55e]" />
      )}
    </div>
  );
};

const ConnectionsTab: React.FC<ConnectionsTabProps> = ({
  userId,
  connections,
  status,
  onReload,
  notify,
}) => {
  const [countries, setCountries] = useState<string[]>(["FR"]);
  const [country, setCountry] = useState("FR");
  const [query, setQuery] = useState("");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [configForm, setConfigForm] = useState({
    applicationId: "",
    privateKey: "",
    redirectUri: "",
  });
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Connection | null>(null);

  // ===== Sidecar BoursoBank =====
  const [boursoStatus, setBoursoStatus] = useState<BoursoSidecarStatus | null>(null);
  const [boursoModalOpen, setBoursoModalOpen] = useState(false);
  const [targetConnectionId, setTargetConnectionId] = useState<string | null>(null);
  const [boursoForm, setBoursoForm] = useState({
    customerId: "",
    password: "",
    saveCredentials: true,
    pages: 10,
  });
  const [boursoBusy, setBoursoBusy] = useState(false);
  const [boursoError, setBoursoError] = useState("");

  // ===== Sidecar BNP Paribas =====
  const [bnpStatus, setBnpStatus] = useState<BnpSidecarStatus | null>(null);
  const [bnpModalOpen, setBnpModalOpen] = useState(false);
  const [bnpTargetConnectionId, setBnpTargetConnectionId] = useState<string | null>(null);
  const [bnpForm, setBnpForm] = useState({
    customerId: "",
    password: "",
    saveCustomerId: true,
    since: "",
  });
  const [bnpBusy, setBnpBusy] = useState(false);
  const [bnpError, setBnpError] = useState("");
  const [bnpJobId, setBnpJobId] = useState<string | null>(null);
  const [bnpJob, setBnpJob] = useState<BnpSidecarJob | null>(null);
  const [bnpMfaCode, setBnpMfaCode] = useState("");

  // ===== Sidecar Fortuneo =====
  const [fortuneoStatus, setFortuneoStatus] = useState<FortuneoSidecarStatus | null>(null);
  const [fortuneoModalOpen, setFortuneoModalOpen] = useState(false);
  const [fortuneoTargetConnectionId, setFortuneoTargetConnectionId] = useState<string | null>(null);
  const [fortuneoForm, setFortuneoForm] = useState({
    login: "",
    password: "",
    otp: "",
    saveLogin: true,
    since: "",
  });
  const [fortuneoBusy, setFortuneoBusy] = useState(false);
  const [fortuneoError, setFortuneoError] = useState("");
  const [fortuneoOtpRequired, setFortuneoOtpRequired] = useState(false);

  const reloadBnpStatus = () => {
    void getBnpSidecarStatus()
      .then((st) => setBnpStatus(st))
      .catch(() => {});
  };

  const reloadFortuneoStatus = () => {
    void getFortuneoSidecarStatus()
      .then((st) => setFortuneoStatus(st))
      .catch(() => {});
  };

  useEffect(() => {
    reloadBnpStatus();
    reloadFortuneoStatus();
  }, []);

  // Polling du job BNP : la validation forte peut survenir plusieurs minutes
  // après le lancement. Le mot de passe n'est jamais renvoyé au navigateur.
  useEffect(() => {
    if (!bnpJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const job = await getBnpSidecarJob(bnpJobId);
        if (!active) return;
        setBnpJob(job);
        if (job.status === "success") {
          setBnpBusy(false);
          setBnpJobId(null);
          setBnpModalOpen(false);
          setBnpForm((prev) => ({ ...prev, password: "" }));
          setBnpMfaCode("");
          setBnpTargetConnectionId(null);
          reloadBnpStatus();
          await onReload();
          const result = job.result;
          notify(
            "success",
            `BNP Paribas synchronisée via le sidecar ! ${result?.accountsSynced ?? 0} compte(s), ${result?.transactionsImported ?? 0} transaction(s).`,
          );
          return;
        }
        if (job.status === "error") {
          setBnpBusy(false);
          setBnpJobId(null);
          setBnpError(job.error || "Synchronisation BNP interrompue.");
          return;
        }
        timer = setTimeout(tick, job.status === "mfa_required" ? 1500 : 900);
      } catch (err) {
        if (!active) return;
        setBnpError(
          err instanceof Error ? err.message : "Impossible de suivre la synchronisation BNP.",
        );
        timer = setTimeout(tick, 2500);
      }
    };
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // Le polling ne doit pas redémarrer si les callbacks du parent changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bnpJobId]);

  const reloadBoursoStatus = () => {
    void getBoursoSidecarStatus()
      .then((st) => setBoursoStatus(st))
      .catch(() => {});
  };

  useEffect(() => {
    reloadBoursoStatus();
  }, []);

  const isBoursoInstitution = (inst: Institution) => {
    const name = (inst.name || "").toLowerCase();
    const id = (inst.id || "").toLowerCase();
    return name.includes("bourso") || id.includes("bourso");
  };

  const isBnpInstitution = (inst: Institution) => {
    const name = (inst.name || "").toLowerCase();
    const id = (inst.id || "").toLowerCase();
    return (
      name.includes("bnp") ||
      name.includes("paribas") ||
      id.includes("bnp") ||
      id.includes("paribas")
    );
  };

  const isFortuneoInstitution = (inst: Institution) => {
    const name = (inst.name || "").toLowerCase();
    const id = (inst.id || "").toLowerCase();
    return name.includes("fortuneo") || id.includes("fortuneo");
  };

  const sidecarKindForInstitution = (
    inst: Institution,
  ): "bourso" | "bnp" | "fortuneo" | null => {
    if (isBnpInstitution(inst)) return "bnp";
    if (isFortuneoInstitution(inst)) return "fortuneo";
    if (isBoursoInstitution(inst)) return "bourso";
    return null;
  };

  const sidecarKindForConnection = (
    connection: Connection,
  ): "bourso" | "bnp" | "fortuneo" | null => {
    if (connection.provider === "bnp-sidecar") return "bnp";
    if (connection.provider === "fortuneo-sidecar") return "fortuneo";
    if (connection.provider === "bourso-sidecar") return "bourso";
    const bank = `${connection.aspspName || ""} ${connection.label || ""}`.toLowerCase();
    if (bank.includes("bnp") || bank.includes("paribas")) return "bnp";
    if (bank.includes("fortuneo")) return "fortuneo";
    if (bank.includes("bourso")) return "bourso";
    return null;
  };

  const handleConnectBourso = async () => {
    const customerId = boursoForm.customerId.trim();
    const password = boursoForm.password;
    if (!boursoStatus?.configured && (!customerId || !password)) {
      setBoursoError("Identifiant client et mot de passe requis.");
      return;
    }
    if (boursoStatus?.configured && Boolean(customerId) !== Boolean(password)) {
      setBoursoError(
        "Saisissez l'identifiant et le mot de passe, ou laissez les deux vides pour réutiliser les identifiants enregistrés.",
      );
      return;
    }
    setBoursoBusy(true);
    setBoursoError("");
    try {
      const res = await connectBoursoSidecar(userId, {
        customerId,
        password,
        saveCredentials: boursoForm.saveCredentials,
        pages: Number(boursoForm.pages) || 10,
        connectionId: targetConnectionId || undefined,
      });
      setBoursoModalOpen(false);
      setBoursoForm((prev) => ({ ...prev, password: "" }));
      setTargetConnectionId(null);
      reloadBoursoStatus();
      await onReload();
      notify(
        "success",
        `BoursoBank synchronisée via le sidecar ! ${res.accountsSynced} compte(s) (courant, livrets, PEA), ${res.transactionsImported} transaction(s), ${res.holdingsSynced} position(s).`,
      );
    } catch (err) {
      setBoursoError(err instanceof Error ? err.message : "Erreur de connexion BoursoBank.");
    } finally {
      setBoursoBusy(false);
    }
  };

  const handleForgetBoursoCredentials = async () => {
    if (
      !window.confirm(
        "Supprimer les identifiants BoursoBank enregistrés pour ce profil ?",
      )
    ) {
      return;
    }
    try {
      await deleteBoursoSidecarCredentials();
      setBoursoStatus((prev) =>
        prev ? { ...prev, configured: false } : prev,
      );
      setBoursoForm((prev) => ({ ...prev, customerId: "", password: "" }));
      notify("success", "Identifiants BoursoBank supprimés.");
    } catch (err) {
      notify(
        "error",
        err instanceof Error
          ? err.message
          : "Impossible de supprimer les identifiants BoursoBank.",
      );
    }
  };

  const openBnpModal = (connectionId: string | null = null) => {
    setBnpTargetConnectionId(connectionId);
    setBnpError("");
    reloadBnpStatus();
    setBnpModalOpen(true);
  };

  const closeBnpModal = async () => {
    if (bnpJobId) {
      try {
        await cancelBnpSidecarJob(bnpJobId);
      } catch {
        // La tâche est peut-être déjà terminée.
      }
    }
    setBnpJobId(null);
    setBnpJob(null);
    setBnpBusy(false);
    setBnpModalOpen(false);
    setBnpError("");
    setBnpMfaCode("");
    setBnpForm((prev) => ({ ...prev, password: "" }));
  };

  const handleStartBnp = async () => {
    const customerId = bnpForm.customerId.trim();
    const password = bnpForm.password;
    if (!bnpStatus?.configured && !customerId) {
      setBnpError("Numéro client BNP requis (7 à 10 chiffres).");
      return;
    }
    if (customerId && !/^[0-9]{7,10}$/.test(customerId)) {
      setBnpError("Le numéro client BNP doit contenir 7 à 10 chiffres.");
      return;
    }
    if (!/^[0-9]{6}$/.test(password)) {
      setBnpError("Le code secret BNP doit contenir exactement 6 chiffres.");
      return;
    }
    setBnpBusy(true);
    setBnpError("");
    setBnpJob(null);
    setBnpMfaCode("");
    try {
      const job = await startBnpSidecarSync(userId, {
        customerId: customerId || undefined,
        password,
        saveCustomerId: bnpForm.saveCustomerId,
        since: bnpForm.since || undefined,
        connectionId: bnpTargetConnectionId || undefined,
      });
      setBnpJobId(job.jobId);
      setBnpForm((prev) => ({ ...prev, password: "" }));
    } catch (err) {
      setBnpBusy(false);
      setBnpError(
        err instanceof Error ? err.message : "Impossible de lancer la synchronisation BNP.",
      );
    }
  };

  const handleBnpMfaSubmit = async (payload: {
    code?: string;
    action?: number;
  }) => {
    if (!bnpJobId) return;
    if (payload.code != null && !/^[0-9]{4,10}$/.test(payload.code.trim())) {
      setBnpError("Le code de validation BNP doit contenir 4 à 10 chiffres.");
      return;
    }
    setBnpError("");
    try {
      await submitBnpSidecarMfa(bnpJobId, {
        ...(payload.code != null ? { code: payload.code.trim() } : {}),
        ...(payload.action != null ? { action: payload.action } : {}),
      });
      if (payload.code != null) setBnpMfaCode("");
    } catch (err) {
      setBnpError(
        err instanceof Error ? err.message : "Validation BNP impossible.",
      );
    }
  };

  const handleForgetBnpCredentials = async () => {
    if (
      !window.confirm(
        "Supprimer le numéro client BNP enregistré ? Le code secret n'a jamais été conservé.",
      )
    ) {
      return;
    }
    try {
      await deleteBnpSidecarCredentials();
      setBnpStatus((prev) => (prev ? { ...prev, configured: false } : prev));
      setBnpForm((prev) => ({ ...prev, customerId: "" }));
      notify("success", "Numéro client BNP supprimé.");
    } catch (err) {
      notify(
        "error",
        err instanceof Error
          ? err.message
          : "Impossible de supprimer le numéro client BNP.",
      );
    }
  };

  const openFortuneoModal = (connectionId: string | null = null) => {
    setFortuneoTargetConnectionId(connectionId);
    setFortuneoError("");
    setFortuneoOtpRequired(false);
    reloadFortuneoStatus();
    setFortuneoModalOpen(true);
  };

  const closeFortuneoModal = () => {
    setFortuneoModalOpen(false);
    setFortuneoError("");
    setFortuneoOtpRequired(false);
    setFortuneoForm((prev) => ({ ...prev, password: "", otp: "" }));
  };

  const handleSyncFortuneo = async () => {
    const login = fortuneoForm.login.trim();
    if (!fortuneoStatus?.configured && !login) {
      setFortuneoError("Identifiant Fortuneo requis.");
      return;
    }
    if (!fortuneoForm.password) {
      setFortuneoError("Mot de passe Fortuneo requis pour chaque synchronisation.");
      return;
    }
    const otp = fortuneoForm.otp.trim();
    if (otp && !/^[0-9]{4,8}$/.test(otp)) {
      setFortuneoError("Le code de validation Fortuneo doit contenir 4 à 8 chiffres.");
      return;
    }
    setFortuneoBusy(true);
    setFortuneoError("");
    try {
      const res = await syncFortuneoSidecar(userId, {
        login: login || undefined,
        password: fortuneoForm.password,
        otp: otp || undefined,
        saveLogin: fortuneoForm.saveLogin,
        since: fortuneoForm.since || undefined,
        connectionId: fortuneoTargetConnectionId || undefined,
      });
      setFortuneoModalOpen(false);
      setFortuneoOtpRequired(false);
      setFortuneoForm((prev) => ({ ...prev, password: "", otp: "" }));
      setFortuneoTargetConnectionId(null);
      reloadFortuneoStatus();
      await onReload();
      notify(
        "success",
        `Fortuneo synchronisé via le sidecar ! ${res.accountsSynced} compte(s), ${res.transactionsImported} transaction(s), ${res.holdingsSynced ?? 0} position(s).`,
      );
    } catch (err) {
      const code = err instanceof PortfolioApiError ? err.code : undefined;
      if (code === "OTP_REQUIRED" || code === "ACTION_REQUIRED" || code === "UNSUPPORTED_AUTH") {
        setFortuneoOtpRequired(true);
      }
      setFortuneoError(
        err instanceof Error ? err.message : "Synchronisation Fortuneo impossible.",
      );
    } finally {
      setFortuneoBusy(false);
    }
  };

  const handleForgetFortuneoCredentials = async () => {
    if (
      !window.confirm(
        "Supprimer l'identifiant Fortuneo enregistré ? Le mot de passe n'a jamais été conservé.",
      )
    ) {
      return;
    }
    try {
      await deleteFortuneoSidecarCredentials();
      setFortuneoStatus((prev) => (prev ? { ...prev, configured: false } : prev));
      setFortuneoForm((prev) => ({ ...prev, login: "" }));
      notify("success", "Identifiant Fortuneo supprimé.");
    } catch (err) {
      notify(
        "error",
        err instanceof Error
          ? err.message
          : "Impossible de supprimer l'identifiant Fortuneo.",
      );
    }
  };

  useEffect(() => {
    void getCountries()
      .then((list) => {
        if (list.length > 0) {
          setCountries(list);
          setCountry((current) => (list.includes(current) ? current : list[0]));
        }
      })
      .catch(() => {
        setCountries(["FR"]);
      });
  }, []);

  useEffect(() => {
    if (!status) return;
    setConfigForm((prev) => ({
      ...prev,
      redirectUri: prev.redirectUri || status.redirectUri || "",
    }));
    if (status.canManage === false) setConfigOpen(false);
    else if (!status.configured) setConfigOpen(true);
  }, [status]);

  const configured = Boolean(status?.configured);
  // Tant que le statut n'est pas chargé, aucun contrôle d'administration n'est
  // affiché : le serveur reste seul juge des permissions.
  const canManage = Boolean(status) && status?.canManage !== false;

  const runSearch = async () => {
    if (!configured) {
      if (canManage) {
        setConfigOpen(true);
      } else {
        setSearchError(
          "Aucune configuration Enable Banking n'est disponible. Contactez l'administrateur.",
        );
      }
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      setInstitutions(await searchInstitutions(query, country));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Recherche impossible.");
    } finally {
      setSearching(false);
    }
  };

  const connect = async (institution: Institution) => {
    if (connectingId) return;
    setSearchError("");

    // Détection d'un sidecar disponible pour BoursoBank, BNP ou Fortuneo :
    // On propose directement le sidecar natif pour éviter les limitations DSP2
    // (PEA, livrets, historique limité à 90 jours).
    if (isBnpInstitution(institution)) {
      openBnpModal();
      return;
    }
    if (isFortuneoInstitution(institution)) {
      openFortuneoModal();
      return;
    }
    if (isBoursoInstitution(institution)) {
      setTargetConnectionId(null);
      reloadBoursoStatus();
      setBoursoModalOpen(true);
      return;
    }

    setConnectingId(institution.id);
    try {
      const result = await startConnection(userId, institution.id, institution.name);
      notify("success", "Redirection vers la banque…");
      window.location.assign(result.url);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Connexion impossible.");
      setConnectingId(null);
    }
  };

  const saveConfig = async () => {
    if (!canManage) return;
    setConfigBusy(true);
    setConfigError("");
    try {
      await saveIntegrationSettings({
        applicationId: configForm.applicationId.trim(),
        privateKey: configForm.privateKey.trim(),
        redirectUri: configForm.redirectUri.trim(),
      });
      setConfigOpen(false);
      setConfigForm((prev) => ({ ...prev, privateKey: "" }));
      await onReload();
      notify("success", "Configuration Enable Banking enregistrée (clé chiffrée localement).");
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally {
      setConfigBusy(false);
    }
  };

  const removeConfig = async () => {
    if (!canManage) return;
    if (!window.confirm("Supprimer les identifiants Enable Banking enregistrés ?")) return;
    try {
      await deleteIntegrationSettings();
      setInstitutions([]);
      await onReload();
      notify("success", "Identifiants supprimés.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Suppression impossible.");
    }
  };

  const finishManual = async () => {
    setManualBusy(true);
    setManualError("");
    try {
      await completeConnection(userId, manualUrl.trim());
      setManualOpen(false);
      setManualUrl("");
      await onReload();
      notify("success", "Connexion bancaire finalisée.");
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Finalisation impossible.");
    } finally {
      setManualBusy(false);
    }
  };

  const syncOne = async (connection: Connection) => {
    const sidecarKind = sidecarKindForConnection(connection);
    if (sidecarKind === "bnp") {
      openBnpModal(connection.id);
      return;
    }
    if (sidecarKind === "fortuneo") {
      openFortuneoModal(connection.id);
      return;
    }
    if (sidecarKind === "bourso" && connection.provider !== "bourso-sidecar") {
      setTargetConnectionId(connection.id);
      reloadBoursoStatus();
      setBoursoModalOpen(true);
      return;
    }
    setSyncingId(connection.id);
    try {
      const result = await syncConnection(connection.id, userId, true);
      await onReload();
      if (result.status === "OK") {
        const errors = result.errors?.length ?? 0;
        notify(
          errors > 0 ? "error" : "success",
          `${result.accountsSynced ?? 0} compte(s) synchronisé(s), ${result.transactionsImported ?? 0} nouvelle(s) transaction(s)` +
            (errors > 0 ? ` · ${errors} compte(s) en erreur` : "."),
        );
      } else if (result.status === "SKIPPED") {
        notify("success", result.message || "Synchronisation récente, rien à faire.");
      } else {
        notify("error", result.message || "Synchronisation incomplète.");
      }
    } catch (error) {
      await onReload();
      notify("error", error instanceof Error ? error.message : "Synchronisation impossible.");
    } finally {
      setSyncingId(null);
    }
  };

  const syncEverything = async () => {
    setSyncingAll(true);
    try {
      const results = await syncAllConnections(userId, true);
      await onReload();
      const ok = results.filter(
        (result) => result.status === "OK" && (result.errors?.length ?? 0) === 0,
      ).length;
      const credentialsRequired = results.filter(
        (result) => result.status === "CREDENTIALS_REQUIRED",
      ).length;
      const failed = results.length - ok - credentialsRequired;
      notify(
        failed > 0 || credentialsRequired > 0 ? "error" : "success",
        `${ok} connexion(s) synchronisée(s)` +
          (credentialsRequired
            ? `, ${credentialsRequired} sidecar(s) en attente de votre code secret (BNP/Fortuneo)`
            : "") +
          (failed ? `, ${failed} à vérifier` : "") +
          ".",
      );
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Synchronisation impossible.");
    } finally {
      setSyncingAll(false);
    }
  };

  const removeConnection = async (connection: Connection) => {
    try {
      const archive = window.confirm(
        "Archiver également les comptes liés ?\n\nOK = archiver les comptes (ils sortent de la synthèse).\nAnnuler = conserver les comptes avec leur dernier solde.",
      );
      await disconnect(connection.id, userId, archive);
      setConfirmDelete(null);
      await onReload();
      notify("success", "Connexion supprimée.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Suppression impossible.");
    }
  };

  const activeCount = useMemo(
    () => connections.filter((connection) => connection.status === "active").length,
    [connections],
  );

  return (
    <div className="space-y-4">
      {/* Configuration Enable Banking */}
      <Card className="p-4">
        <SectionHeader
          title="Connexion bancaire — Enable Banking"
          subtitle="Agrégation PSD2 multi-banques (BNP, BoursoBank, Crédit Agricole, Société Générale…). Les identifiants bancaires sont saisis chez la banque ; seule la clé privée de l'application est chiffrée côté serveur."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {configured ? (
                <Badge tone="green">
                  <ShieldCheck className="h-3 w-3" /> Configuré
                </Badge>
              ) : (
                <Badge tone="gold">
                  <KeyRound className="h-3 w-3" /> À configurer
                </Badge>
              )}
              {canManage && (
                <Button size="sm" onClick={() => setConfigOpen((open) => !open)}>
                  {configOpen ? "Fermer" : configured ? "Modifier" : "Configurer"}
                </Button>
              )}
              {canManage && configured && (
                <Button size="sm" variant="danger" onClick={removeConfig}>
                  <Trash2 className="h-3.5 w-3.5" /> Identifiants
                </Button>
              )}
            </div>
          }
        />

        {status && !canManage && (
          <div className="mt-3 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs text-[#b0b0b0]">
            La configuration Enable Banking est globale et réservée à
            l'administrateur de l'application. Vous pouvez utiliser une
            configuration existante, mais pas la modifier ni la supprimer.
          </div>
        )}

        {!configured && !configOpen && canManage && (
          <div className="mt-3 rounded-lg border border-[rgba(200,165,94,0.2)] bg-[rgba(200,165,94,0.05)] px-3 py-2 text-xs text-[#b0b0b0]">
            Renseignez l'application ID et la clé privée de votre application Enable
            Banking. Aucune donnée bancaire ne transite par un service tiers autre
            qu'Enable Banking.
          </div>
        )}

        {configOpen && canManage && (
          <div className="mt-4 space-y-3">
            {configError && (
              <ErrorBanner message={configError} onClose={() => setConfigError("")} />
            )}
            <Field
              label="Application ID"
              required
              hint="Visible dans le portail Enable Banking, section Applications. Il sert aussi de key ID (kid) dans le JWT."
            >
              <Input
                value={configForm.applicationId}
                onChange={(event) =>
                  setConfigForm({ ...configForm, applicationId: event.target.value })
                }
                placeholder={status?.applicationId || "xxxxxxxx-xxxx-…"}
              />
            </Field>
            <Field
              label="Clé privée (PEM)"
              required={!configured}
              hint={
                configured
                  ? "Clé privée déjà enregistrée et chiffrée. Laissez vide pour conserver la clé actuelle."
                  : "Collez le contenu du fichier .pem téléchargé lors de la création de l'application. La clé est chiffrée en AES-256-GCM et n'est jamais renvoyée au navigateur."
              }
            >
              <textarea
                value={configForm.privateKey}
                onChange={(event) =>
                  setConfigForm({ ...configForm, privateKey: event.target.value })
                }
                placeholder={
                  configured
                    ? "•••••••• (clé existante conservée si vide)"
                    : "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
                }
                className="min-h-[110px] w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-3 py-2 font-mono text-[11px] text-[#f5f5f5] outline-none focus:border-[#c8a55e]"
              />
            </Field>
            <Field
              label="URL de retour"
              required
              hint="À enregistrer à l'identique dans Enable Banking. En production, utilisez l'URL HTTPS publique de l'application (voir docs/deployment.md)."
            >
              <Input
                value={configForm.redirectUri}
                onChange={(event) =>
                  setConfigForm({ ...configForm, redirectUri: event.target.value })
                }
                placeholder={defaultCallbackUrl}
              />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a
                href="https://enablebanking.com/docs/api/reference/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-[#c8a55e] hover:underline"
              >
                Documentation Enable Banking <ExternalLink className="h-3 w-3" />
              </a>
              <div className="flex gap-2">
                <Button onClick={() => setConfigOpen(false)}>Annuler</Button>
                <Button variant="primary" onClick={saveConfig} loading={configBusy}>
                  Enregistrer
                </Button>
              </div>
            </div>
          </div>
        )}

        {configured && !configOpen && status && (
          <div className="mt-3 grid gap-2 text-[11px] text-[#8a8a8a] sm:grid-cols-2">
            <div>
              <span className="text-[#6a6a6a]">Application</span>
              <p className="font-mono text-[#d4d4d4]">{status.applicationId || "—"}</p>
            </div>
            <div>
              <span className="text-[#6a6a6a]">URL de retour</span>
              <p className="truncate font-mono text-[#d4d4d4]">{status.redirectUri || "—"}</p>
            </div>
          </div>
        )}
      </Card>

      {/* Ajouter une banque */}
      <Card className="p-4">
        <SectionHeader
          title="Ajouter une banque"
          subtitle="La banque vous redirige vers son propre écran de connexion. Aucun mot de passe bancaire n'est stocké ici."
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setTargetConnectionId(null);
                  reloadBoursoStatus();
                  setBoursoModalOpen(true);
                }}
              >
                <Zap className="h-3.5 w-3.5 text-[#c8a55e]" /> Sidecar BoursoBank
              </Button>
              <Button size="sm" onClick={() => openBnpModal()}>
                <Zap className="h-3.5 w-3.5 text-[#c8a55e]" /> Sidecar BNP
              </Button>
              <Button size="sm" onClick={() => openFortuneoModal()}>
                <Zap className="h-3.5 w-3.5 text-[#c8a55e]" /> Sidecar Fortuneo
              </Button>
              <Button size="sm" onClick={() => setManualOpen(true)}>
                <Link2 className="h-3.5 w-3.5" /> J'ai déjà l'URL de retour
              </Button>
            </div>
          }
        />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Pays" className="w-24">
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#0d0d0d] px-2 py-2 text-sm text-[#f5f5f5] outline-none focus:border-[#c8a55e]"
            >
              {countries.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rechercher une banque" className="min-w-[220px] flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6a6a6a]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                placeholder="BNP, BoursoBank, Crédit Agricole…"
                className="pl-9"
              />
            </div>
          </Field>
          <Button variant="primary" onClick={runSearch} loading={searching}>
            <Search className="h-3.5 w-3.5" /> Chercher
          </Button>
        </div>

        {searchError && (
          <div className="mt-3">
            <ErrorBanner message={searchError} onClose={() => setSearchError("")} />
          </div>
        )}

        {searching ? (
          <Spinner label="Interrogation du catalogue Enable Banking…" />
        ) : institutions.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {institutions.map((institution) => {
              const sidecarKind = sidecarKindForInstitution(institution);
              const hasSidecar = Boolean(sidecarKind);
              const sidecarDescription =
                sidecarKind === "bnp"
                  ? "Tous les comptes & historique complet"
                  : sidecarKind === "fortuneo"
                    ? "Comptes, titres & historique complet"
                    : "PEA, livrets & historique complet";
              return (
                <div
                  key={institution.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-2.5",
                    hasSidecar
                      ? "border-[#c8a55e]/30 bg-[#0d0d0d]"
                      : "border-[rgba(255,255,255,0.07)] bg-[#0d0d0d]",
                  )}
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#161616]">
                    {institution.logo ? (
                      <img
                        src={institution.logo}
                        alt=""
                        className="h-7 w-7 object-contain"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <Landmark className="h-4 w-4 text-[#c8a55e]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="truncate text-xs font-medium text-[#f5f5f5]">
                        {institution.name}
                      </p>
                      {hasSidecar && (
                        <Badge tone="gold">
                          <Sparkles className="h-2.5 w-2.5 mr-0.5" /> Sidecar
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-[#6a6a6a]">
                      {hasSidecar
                        ? sidecarDescription
                        : `${institution.country}${institution.psuType === "business" ? " · pro" : ""}${institution.beta ? " · bêta" : ""}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={hasSidecar ? "primary" : "secondary"}
                    onClick={() => connect(institution)}
                    loading={connectingId === institution.id}
                    disabled={Boolean(connectingId)}
                  >
                    {hasSidecar ? (
                      <>
                        <Zap className="h-3.5 w-3.5 mr-0.5" /> Sidecar
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" /> Lier
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : institutions.length === 0 && query ? (
          <p className="mt-3 text-xs text-[#6a6a6a]">
            Aucune banque trouvée. Essayez un autre nom ou changez de pays.
          </p>
        ) : null}
      </Card>

      {/* Connexions existantes */}
      <Card className="p-4">
        <SectionHeader
          title="Connexions actives"
          subtitle={`${connections.length} connexion(s), ${activeCount} active(s). Synchronisation manuelle à la demande.`}
          action={
            <Button
              size="sm"
              onClick={syncEverything}
              loading={syncingAll}
              disabled={connections.length === 0}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Tout synchroniser
            </Button>
          }
        />

        {connections.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Unplug className="h-7 w-7" />}
              title="Aucune banque connectée"
              description="Recherchez votre banque ci-dessus. Enable Banking couvre la plupart des établissements français ; les enveloppes non couvertes (PEA, CTO, épargne salariale) restent gérables en comptes manuels ou via CSV."
            />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {connections.map((connection) => {
              const isSidecar = connection.provider.endsWith("-sidecar");
              const sidecarKind = sidecarKindForConnection(connection);
              const isBnp = sidecarKind === "bnp";
              const isFortuneo = sidecarKind === "fortuneo";
              const isBourso = sidecarKind === "bourso";
              const sidecarLabel = isBnp
                ? "BNP Paribas"
                : isFortuneo
                  ? "Fortuneo"
                  : "BoursoBank";
              return (
                <div
                  key={connection.id}
                  className="rounded-lg border border-[rgba(255,255,255,0.07)] bg-[#0d0d0d] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ConnectionLogo connection={connection} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#f5f5f5]">
                          {connection.label || connection.aspspName || "Banque"}
                        </span>
                        {isSidecar && (
                          <Badge tone="gold">
                            <Zap className="h-2.5 w-2.5 mr-0.5" /> Sidecar natif
                          </Badge>
                        )}
                        {Boolean(connection.metadata?.sidecarLinked) && !isSidecar && (
                          <Badge tone="gold">
                            <Zap className="h-2.5 w-2.5 mr-0.5" /> Sidecar lié
                          </Badge>
                        )}
                        <Badge tone={statusTone(connection.status)}>
                          {connectionStatusLabel[connection.status] || connection.status}
                        </Badge>
                        {connection.accountCount != null && (
                          <Badge tone="gray">{connection.accountCount} compte(s)</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#6a6a6a]">
                        {isSidecar
                          ? `Sidecar local ${sidecarLabel}`
                          : `Consentement jusqu'au ${formatDate(connection.validUntil)}`}{" "}
                        · dernière synchro {connection.lastSyncAt ? formatDate(connection.lastSyncAt) : "jamais"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isBnp && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openBnpModal(connection.id)}
                          title="Synchroniser BNP Paribas via le Sidecar"
                        >
                          <Zap className="h-3.5 w-3.5" /> Sidecar
                        </Button>
                      )}
                      {isFortuneo && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openFortuneoModal(connection.id)}
                          title="Synchroniser Fortuneo via le Sidecar"
                        >
                          <Zap className="h-3.5 w-3.5" /> Sidecar
                        </Button>
                      )}
                      {isBourso && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setTargetConnectionId(connection.id);
                            reloadBoursoStatus();
                            setBoursoModalOpen(true);
                          }}
                          title="Extraire comptes, PEA & historique complet via le Sidecar"
                        >
                          <Zap className="h-3.5 w-3.5" /> Sidecar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => syncOne(connection)}
                        loading={syncingId === connection.id}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Synchroniser
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setConfirmDelete(connection)}
                      >
                        <Unplug className="h-3.5 w-3.5" /> Retirer
                      </Button>
                    </div>
                  </div>
                  {connection.lastError && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.06)] px-2.5 py-1.5 text-[11px] text-[#fca5a5]">
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>{connection.lastError}</span>
                    </div>
                  )}
                  {connection.status === "expired" && (
                    <p className="mt-2 text-[11px] text-[#f87171]">
                      Le consentement a expiré. Retirez la connexion puis reliez la banque pour
                      renouveler l'accès.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Finalisation manuelle */}
      <Modal
        open={manualOpen}
        title="Finaliser une connexion bancaire"
        onClose={() => setManualOpen(false)}
        footer={
          <>
            <Button onClick={() => setManualOpen(false)}>Annuler</Button>
            <Button
              variant="primary"
              onClick={finishManual}
              loading={manualBusy}
              disabled={!manualUrl.trim()}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Finaliser
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {manualError && (
            <ErrorBanner message={manualError} onClose={() => setManualError("")} />
          )}
          <p className="text-xs text-[#8a8a8a]">
            Si la redirection automatique n'a pas ramené l'application sur Patrimoine, collez
            ici l'URL complète de la page de retour (elle contient <code>code</code> et{" "}
            <code>state</code>).
          </p>
          <Field label="URL de retour" required>
            <Input
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
              placeholder={`${defaultCallbackUrl}?code=…&state=…`}
            />
          </Field>
        </div>
      </Modal>

      {/* Modal Sidecar BoursoBank */}
      <Modal
        open={boursoModalOpen}
        title="Connexion Sidecar BoursoBank"
        onClose={() => {
          setBoursoModalOpen(false);
          setBoursoError("");
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setBoursoModalOpen(false);
                setBoursoError("");
              }}
            >
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={handleConnectBourso}
              loading={boursoBusy}
              disabled={
                !boursoStatus?.configured &&
                (!boursoForm.customerId.trim() || !boursoForm.password)
              }
            >
              <Zap className="h-3.5 w-3.5" /> Synchroniser via Sidecar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {boursoError && (
            <ErrorBanner message={boursoError} onClose={() => setBoursoError("")} />
          )}
          <div className="rounded-lg border border-[#c8a55e]/25 bg-[#c8a55e]/5 p-3 text-xs text-[#d4d4d4]">
            <p className="font-semibold text-[#c8a55e] flex items-center gap-1.5 mb-1">
              <Sparkles className="h-3.5 w-3.5" />
              Accès complet à vos enveloppes BoursoBank
            </p>
            <p className="text-[11px] text-[#a0a0a0]">
              Contrairement à l'agrégation DSP2 (Enable Banking) qui est légalement bridée à 90 jours et exclut le PEA/CTO, le sidecar local extrait l'intégralité de vos comptes (Courants, Livrets, PEA, CTO, Assurance-Vie) et toutes vos transactions.
            </p>
          </div>

          <Field label="Identifiant client BoursoBank" required>
            <Input
              value={boursoForm.customerId}
              onChange={(e) => setBoursoForm({ ...boursoForm, customerId: e.target.value })}
              placeholder="Ex: 12345678"
            />
          </Field>

          <Field
            label="Mot de passe"
            hint={
              boursoStatus?.configured
                ? "Identifiants déjà mémorisés. Laissez vide pour réutiliser le mot de passe enregistré."
                : "Votre mot de passe est utilisé dans un sandbox temporaire sans être conservé en clair."
            }
            required={!boursoStatus?.configured}
          >
            <Input
              type="password"
              value={boursoForm.password}
              onChange={(e) => setBoursoForm({ ...boursoForm, password: e.target.value })}
              placeholder={boursoStatus?.configured ? "•••••••• (laisser vide pour conserver)" : "Mot de passe BoursoBank"}
            />
          </Field>

          {boursoStatus?.configured && (
            <button
              type="button"
              onClick={handleForgetBoursoCredentials}
              className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Oublier les identifiants enregistrés
            </button>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label="Historique à extraire (pages)" hint="1 page ≈ 20 transactions">
              <Input
                type="number"
                min="1"
                max="50"
                value={boursoForm.pages}
                onChange={(e) =>
                  setBoursoForm({ ...boursoForm, pages: Math.max(1, parseInt(e.target.value) || 1) })
                }
              />
            </Field>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#d4d4d4]">
                <input
                  type="checkbox"
                  checked={boursoForm.saveCredentials}
                  onChange={(e) =>
                    setBoursoForm({ ...boursoForm, saveCredentials: e.target.checked })
                  }
                  className="rounded border-[rgba(255,255,255,0.2)] bg-[#141414] text-[#c8a55e] focus:ring-0"
                />
                Mémoriser de façon chiffrée
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal Sidecar BNP Paribas */}
      <Modal
        open={bnpModalOpen}
        title="Connexion Sidecar BNP Paribas"
        onClose={() => {
          void closeBnpModal();
        }}
        footer={
          <>
            <Button
              onClick={() => {
                void closeBnpModal();
              }}
            >
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={handleStartBnp}
              loading={bnpBusy}
              disabled={bnpBusy || Boolean(bnpJobId)}
            >
              <Zap className="h-3.5 w-3.5" /> Synchroniser via Sidecar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {bnpError && (
            <ErrorBanner message={bnpError} onClose={() => setBnpError("")} />
          )}
          {bnpStatus && !bnpStatus.available && (
            <ErrorBanner message="CLI bnp-cli introuvable sur le serveur. Installez-le ou définissez BNP_CLI_PATH." />
          )}
          <div className="rounded-lg border border-[#c8a55e]/25 bg-[#c8a55e]/5 p-3 text-xs text-[#d4d4d4]">
            <p className="font-semibold text-[#c8a55e] flex items-center gap-1.5 mb-1">
              <Sparkles className="h-3.5 w-3.5" />
              Accès complet aux comptes BNP Paribas
            </p>
            <p className="text-[11px] text-[#a0a0a0]">
              Le sidecar local extrait tous les comptes (courants, livrets, PEA, titres,
              assurance-vie) et tout l'historique disponible. Le code secret est saisi à
              chaque exécution et n'est jamais enregistré.
            </p>
          </div>

          <Field
            label="Numéro client BNP"
            hint={
              bnpStatus?.configured
                ? "Numéro client déjà mémorisé. Laissez vide pour le réutiliser."
                : "7 à 10 chiffres, visible sur vos relevés BNP."
            }
            required={!bnpStatus?.configured}
          >
            <Input
              value={bnpForm.customerId}
              onChange={(e) => setBnpForm({ ...bnpForm, customerId: e.target.value })}
              placeholder={bnpStatus?.customerIdSaved ? "•••••••• (mémorisé)" : "Ex: 12345678"}
              autoComplete="username"
            />
          </Field>

          <Field
            label="Code secret BNP"
            hint="Exactement 6 chiffres. Jamais enregistré, jamais réutilisé entre deux connexions."
            required
          >
            <Input
              type="password"
              value={bnpForm.password}
              onChange={(e) => setBnpForm({ ...bnpForm, password: e.target.value })}
              placeholder="6 chiffres"
              autoComplete="off"
              inputMode="numeric"
            />
          </Field>

          {bnpStatus?.configured && (
            <button
              type="button"
              onClick={handleForgetBnpCredentials}
              className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Oublier le numéro client enregistré
            </button>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label="Historique depuis" hint="Facultatif (défaut : 1 an)">
              <Input
                type="date"
                value={bnpForm.since}
                onChange={(e) => setBnpForm({ ...bnpForm, since: e.target.value })}
              />
            </Field>
            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#d4d4d4]">
                <input
                  type="checkbox"
                  checked={bnpForm.saveCustomerId}
                  onChange={(e) =>
                    setBnpForm({ ...bnpForm, saveCustomerId: e.target.checked })
                  }
                  className="rounded border-[rgba(255,255,255,0.2)] bg-[#141414] text-[#c8a55e] focus:ring-0"
                />
                Mémoriser le numéro client
              </label>
            </div>
          </div>

          {bnpJobId && !bnpJob?.challenge && (
            <Spinner label="Connexion BNP et extraction des comptes en cours…" />
          )}

          {bnpJob?.challenge && (
            <div className="rounded-lg border border-[#c8a55e]/30 bg-[#141414] p-3">
              <p className="text-xs font-semibold text-[#c8a55e]">
                Validation forte demandée par BNP
              </p>
              <p className="mt-0.5 text-[11px] text-[#8a8a8a]">
                {bnpJob.challenge.page?.host}
                {bnpJob.challenge.page?.path}
              </p>
              {bnpJob.challenge.codeRequired ? (
                <div className="mt-2 flex items-end gap-2">
                  <Field label="Code reçu par SMS" className="flex-1">
                    <Input
                      value={bnpMfaCode}
                      onChange={(e) => setBnpMfaCode(e.target.value)}
                      placeholder="4 à 10 chiffres"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                  </Field>
                  <Button
                    variant="primary"
                    onClick={() => handleBnpMfaSubmit({ code: bnpMfaCode })}
                  >
                    Valider
                  </Button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {bnpJob.challenge.actions.map((action) => (
                    <Button
                      key={action.index}
                      variant={action.index === 0 ? "primary" : "secondary"}
                      onClick={() => handleBnpMfaSubmit({ action: action.index })}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  void closeBnpModal();
                }}
                className="mt-2 text-[11px] text-red-400 hover:text-red-300"
              >
                Annuler cette synchronisation
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Sidecar Fortuneo */}
      <Modal
        open={fortuneoModalOpen}
        title="Connexion Sidecar Fortuneo"
        onClose={closeFortuneoModal}
        footer={
          <>
            <Button onClick={closeFortuneoModal}>Annuler</Button>
            <Button
              variant="primary"
              onClick={handleSyncFortuneo}
              loading={fortuneoBusy}
              disabled={
                !fortuneoForm.password ||
                (!fortuneoStatus?.configured && !fortuneoForm.login.trim())
              }
            >
              <Zap className="h-3.5 w-3.5" /> Synchroniser via Sidecar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {fortuneoError && (
            <ErrorBanner
              message={fortuneoError}
              onClose={() => setFortuneoError("")}
            />
          )}
          {fortuneoStatus && !fortuneoStatus.available && (
            <ErrorBanner message="CLI fortuneo-sidecar introuvable sur le serveur. Installez-le ou définissez FORTUNEO_CLI_PATH." />
          )}
          <div className="rounded-lg border border-[#c8a55e]/25 bg-[#c8a55e]/5 p-3 text-xs text-[#d4d4d4]">
            <p className="font-semibold text-[#c8a55e] flex items-center gap-1.5 mb-1">
              <Sparkles className="h-3.5 w-3.5" />
              Accès complet aux comptes Fortuneo
            </p>
            <p className="text-[11px] text-[#a0a0a0]">
              Le sidecar local extrait les comptes, l'historique des opérations et les
              positions (PEA, compte-titres, assurance-vie). Le mot de passe est saisi à
              chaque exécution et n'est jamais enregistré.
            </p>
          </div>

          <Field
            label="Identifiant Fortuneo"
            hint={
              fortuneoStatus?.configured
                ? "Identifiant déjà mémorisé. Laissez vide pour le réutiliser."
                : "Votre identifiant client Fortuneo."
            }
            required={!fortuneoStatus?.configured}
          >
            <Input
              value={fortuneoForm.login}
              onChange={(e) => setFortuneoForm({ ...fortuneoForm, login: e.target.value })}
              placeholder={
                fortuneoStatus?.loginSaved ? "•••••••• (mémorisé)" : "Identifiant Fortuneo"
              }
              autoComplete="username"
            />
          </Field>

          <Field
            label="Mot de passe Fortuneo"
            hint="Requis à chaque synchronisation, jamais enregistré."
            required
          >
            <Input
              type="password"
              value={fortuneoForm.password}
              onChange={(e) =>
                setFortuneoForm({ ...fortuneoForm, password: e.target.value })
              }
              placeholder="Mot de passe Fortuneo"
              autoComplete="off"
            />
          </Field>

          <Field
            label="Code de validation 2FA"
            hint="Facultatif. À saisir si Fortuneo envoie un code par SMS."
          >
            <Input
              value={fortuneoForm.otp}
              onChange={(e) => setFortuneoForm({ ...fortuneoForm, otp: e.target.value })}
              placeholder="4 à 8 chiffres"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </Field>

          {fortuneoOtpRequired && (
            <p className="rounded-lg border border-[#c8a55e]/25 bg-[#c8a55e]/5 px-3 py-2 text-[11px] text-[#d4d4d4]">
              Fortuneo a demandé une validation 2FA. Saisissez le code reçu par SMS,
              puis relancez la synchronisation avec votre mot de passe.
            </p>
          )}

          {fortuneoStatus?.configured && (
            <button
              type="button"
              onClick={handleForgetFortuneoCredentials}
              className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Oublier l'identifiant enregistré
            </button>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label="Historique depuis" hint="Facultatif">
              <Input
                type="date"
                value={fortuneoForm.since}
                onChange={(e) =>
                  setFortuneoForm({ ...fortuneoForm, since: e.target.value })
                }
              />
            </Field>
            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#d4d4d4]">
                <input
                  type="checkbox"
                  checked={fortuneoForm.saveLogin}
                  onChange={(e) =>
                    setFortuneoForm({ ...fortuneoForm, saveLogin: e.target.checked })
                  }
                  className="rounded border-[rgba(255,255,255,0.2)] bg-[#141414] text-[#c8a55e] focus:ring-0"
                />
                Mémoriser l'identifiant
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Confirmation suppression */}
      <Modal
        open={Boolean(confirmDelete)}
        title="Retirer la connexion bancaire"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Annuler</Button>
            <Button
              variant="danger"
              onClick={() => confirmDelete && removeConnection(confirmDelete)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Retirer
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-xs text-[#a0a0a0]">
          <p>
            La connexion <strong className="text-[#f5f5f5]">{confirmDelete?.label}</strong> et
            ses autorisations associées seront supprimées. Vous pourrez ensuite archiver les
            comptes liés pour les retirer de la synthèse tout en conservant l'historique.
          </p>
          <p className="flex items-center gap-1.5 text-[#c8a55e]">
            <Loader2 className="h-3 w-3" /> Vous pourrez choisir d'archiver les comptes à
            l'étape suivante.
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default ConnectionsTab;
