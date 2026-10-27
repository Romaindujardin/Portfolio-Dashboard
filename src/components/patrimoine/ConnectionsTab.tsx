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
  completeConnection,
  connectBoursoSidecar,
  deleteIntegrationSettings,
  disconnect,
  getBoursoSidecarStatus,
  getCountries,
  saveIntegrationSettings,
  searchInstitutions,
  startConnection,
  syncAllConnections,
  syncConnection,
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

  const reloadBoursoStatus = () => {
    void getBoursoSidecarStatus()
      .then((st) => {
        setBoursoStatus(st);
        if (st.customerId) {
          setBoursoForm((prev) => ({ ...prev, customerId: st.customerId || "" }));
        }
      })
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

  const handleConnectBourso = async () => {
    if (!boursoForm.customerId.trim()) {
      setBoursoError("Identifiant client requis.");
      return;
    }
    setBoursoBusy(true);
    setBoursoError("");
    try {
      const res = await connectBoursoSidecar(userId, {
        customerId: boursoForm.customerId.trim(),
        password: boursoForm.password,
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
    if (!status.configured) setConfigOpen(true);
  }, [status]);

  const configured = Boolean(status?.configured);

  const runSearch = async () => {
    if (!configured) {
      setConfigOpen(true);
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

    // Détection d'un sidecar disponible pour BoursoBank :
    // On propose directement le sidecar natif pour éviter les limitations DSP2 (PEA, livrets, 90j)
    if (isBoursoInstitution(institution)) {
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
      const failed = results.length - ok;
      notify(
        failed > 0 ? "error" : "success",
        `${ok} connexion(s) synchronisée(s)${
          failed ? `, ${failed} à vérifier` : ""
        }.`,
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
          subtitle="Agrégation PSD2 multi-banques (BNP, BoursoBank, Crédit Agricole, Société Générale…). Les identifiants bancaires sont saisis chez la banque ; seule la clé privée de l'application est chiffrée localement."
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
              <Button size="sm" onClick={() => setConfigOpen((open) => !open)}>
                {configOpen ? "Fermer" : configured ? "Modifier" : "Configurer"}
              </Button>
              {configured && (
                <Button size="sm" variant="danger" onClick={removeConfig}>
                  <Trash2 className="h-3.5 w-3.5" /> Identifiants
                </Button>
              )}
            </div>
          }
        />

        {!configured && !configOpen && (
          <div className="mt-3 rounded-lg border border-[rgba(200,165,94,0.2)] bg-[rgba(200,165,94,0.05)] px-3 py-2 text-xs text-[#b0b0b0]">
            Renseignez l'application ID et la clé privée de votre application Enable
            Banking. Aucune donnée bancaire ne transite par un service tiers autre
            qu'Enable Banking.
          </div>
        )}

        {configOpen && (
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
              required
              hint="Collez le contenu du fichier .pem téléchargé lors de la création de l'application. La clé est chiffrée en AES-256-GCM et n'est jamais renvoyée au navigateur."
            >
              <textarea
                value={configForm.privateKey}
                onChange={(event) =>
                  setConfigForm({ ...configForm, privateKey: event.target.value })
                }
                placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
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
                  setBoursoModalOpen(true);
                }}
              >
                <Zap className="h-3.5 w-3.5 text-[#c8a55e]" /> Sidecar BoursoBank
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
              const hasSidecar = isBoursoInstitution(institution);
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
                        ? "PEA, livrets & historique complet"
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
              const isSidecar = connection.provider === "bourso-sidecar";
              const isBourso =
                isSidecar ||
                (connection.aspspName || "").toLowerCase().includes("bourso") ||
                (connection.label || "").toLowerCase().includes("bourso");
              return (
                <div
                  key={connection.id}
                  className="rounded-lg border border-[rgba(255,255,255,0.07)] bg-[#0d0d0d] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(200,165,94,0.08)]">
                      {isSidecar ? (
                        <Zap className="h-4 w-4 text-[#c8a55e]" />
                      ) : (
                        <Landmark className="h-4 w-4 text-[#c8a55e]" />
                      )}
                    </div>
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
                          ? "Sidecar local BoursoBank"
                          : `Consentement jusqu'au ${formatDate(connection.validUntil)}`}{" "}
                        · dernière synchro {connection.lastSyncAt ? formatDate(connection.lastSyncAt) : "jamais"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isBourso && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setTargetConnectionId(connection.id);
                            if (connection.metadata?.customerId) {
                              setBoursoForm((prev) => ({
                                ...prev,
                                customerId: String(connection.metadata?.customerId || prev.customerId),
                              }));
                            }
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
              disabled={!boursoForm.customerId.trim()}
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
