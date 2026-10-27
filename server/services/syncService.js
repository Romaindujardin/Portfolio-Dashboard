// Orchestration des synchronisations bancaires.
// Une connexion = une session Enable Banking. Les comptes sont appariés par
// identification_hash (stable entre reconnexions), pas par uid de session.

import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorError,
  PROVIDERS,
} from "../connectors/types.js";
import {
  computeWindowStart,
  mapEnableBankingTransactions,
  selectNewTransactions,
} from "./transactions.js";
import { todayIso } from "../lib/validate.js";
import { syncBoursoSidecar } from "./boursoSidecarService.js";

const SYNC_COOLDOWN_MS = 4 * 3600 * 1000;

export class SyncService {
  constructor({ repository, connector, now = () => new Date() }) {
    this.repository = repository;
    this.connector = connector;
    this.now = now;
  }

  async beginConnection({ userId, institutionId, label }) {
    // Le state porte l'utilisateur : le callback OAuth ne transporte que code+state.
    const state = `${userId}.${cryptoRandomState()}`;
    const auth = await this.connector.startAuth({ institutionId, state });
    const connection = this.repository.createConnector(userId, {
      provider: PROVIDERS.ENABLE_BANKING,
      label: label || auth.institution.name,
      status: "pending",
      aspspName: auth.institution.name,
      aspspCountry: auth.institution.country,
      psuType: auth.institution.psuType,
      metadata: {
        state,
        institutionId,
        authorizationId: auth.authorizationId,
      },
    });
    return { connection, url: auth.url, state };
  }

  async completeConnection({ userId, state, code, connectorId = null }) {
    if (!code) {
      throw new ConnectorError("Code d'autorisation manquant dans le retour de la banque.", {
        status: 400,
        code: "MISSING_CODE",
      });
    }
    const pending = connectorId
      ? this.repository.getConnector(connectorId, userId)
      : this.repository.findPendingConnectorByState(state, userId);
    if (!pending) {
      throw new ConnectorError(
        "Connexion en attente introuvable. Relancez l'autorisation depuis l'application.",
        { status: 404, code: "PENDING_CONNECTION_NOT_FOUND" },
      );
    }
    if (pending.metadata?.state && state && pending.metadata.state !== state) {
      throw new ConnectorError("État OAuth invalide (protection CSRF).", {
        status: 400,
        code: "INVALID_STATE",
      });
    }

    const session = await this.connector.exchangeCode(code);
    const accounts = this.extractSessionAccounts(session);
    const updated = this.repository.updateConnector(pending.id, userId, {
      status: accounts.length > 0 ? "active" : "pending",
      sessionId: session.session_id,
      validUntil:
        session.access?.valid_until || session.access?.validUntil || pending.validUntil,
      aspspName: session.aspsp?.name || pending.aspspName,
      aspspCountry: session.aspsp?.country || pending.aspspCountry,
      psuType: session.psu_type || pending.psuType,
      lastError: accounts.length > 0 ? null : "En attente de la liaison des comptes par la banque.",
      metadata: {
        ...(pending.metadata || {}),
        state: undefined,
        linkedAt: new Date().toISOString(),
      },
    });

    if (accounts.length === 0) {
      return {
        status: "PENDING",
        connection: updated,
        message:
          "La banque n'a pas encore renvoyé les comptes. Réessayez la synchronisation dans quelques instants.",
      };
    }

    const sync = await this.syncConnection(updated.id, userId, {
      sessionOverride: session,
      force: true,
    });
    return {
      status: sync.status,
      connection: this.repository.getConnector(updated.id, userId),
      sync,
    };
  }

  extractSessionAccounts(session) {
    // Import local pour éviter une dépendance circulaire au chargement.
    const hashes = new Map(
      (Array.isArray(session?.accounts_data) ? session.accounts_data : []).map(
        (entry) => [entry.uid, entry.identification_hash || null],
      ),
    );
    return (Array.isArray(session?.accounts) ? session.accounts : [])
      .map((entry) => {
        if (typeof entry === "string") {
          return { uid: entry, identificationHash: hashes.get(entry) || null };
        }
        if (entry?.uid) {
          return {
            uid: entry.uid,
            identificationHash:
              entry.identification_hash || hashes.get(entry.uid) || null,
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  async syncConnection(connectionId, userId, { force = false, sessionOverride = null } = {}) {
    const connection = this.repository.getConnector(connectionId, userId);
    if (!connection) {
      throw new ConnectorError("Connexion introuvable", { status: 404, code: "NOT_FOUND" });
    }

    if (connection.provider === PROVIDERS.BOURSO_SIDECAR || connection.provider === "bourso-sidecar") {
      return syncBoursoSidecar({
        repository: this.repository,
        userId,
        connectionId: connection.id,
      });
    }

    if (!connection.sessionId) {
      throw new ConnectorError(
        "Cette connexion n'a pas encore de session bancaire. Terminez l'autorisation.",
        { status: 400, code: "NO_SESSION" },
      );
    }

    if (!force && connection.lastSyncAt) {
      const elapsed = Date.now() - new Date(connection.lastSyncAt).getTime();
      if (elapsed >= 0 && elapsed < SYNC_COOLDOWN_MS) {
        return {
          status: "SKIPPED",
          message:
            "Synchronisation récente : par précaution vis-à-vis des banques, une seule synchronisation automatique est faite toutes les 4 heures.",
          lastSyncAt: connection.lastSyncAt,
        };
      }
    }

    const runId = this.repository.startSyncRun(
      userId,
      connection.id,
      PROVIDERS.ENABLE_BANKING,
    );

    let accountsSynced = 0;
    let transactionsImported = 0;
    const errors = [];

    try {
      let session = sessionOverride;
      if (!session) {
        session = await this.connector.getSession(connection.sessionId);
      }
      const sessionStatus = String(session?.status || "").toUpperCase();
      if (sessionStatus === "EXPIRED" || sessionStatus === "REVOKED") {
        throw new ConnectorAuthError(
          "Consentement bancaire expiré. Reconnectez la banque pour continuer.",
          { sessionStatus },
        );
      }

      const accounts = this.extractSessionAccounts(session);
      if (accounts.length === 0) {
        this.repository.updateConnector(connection.id, userId, {
          status: "pending",
          lastError:
            "La banque n'a pas encore lié les comptes. Une synchronisation ultérieure devrait suffire.",
        });
        this.repository.finishSyncRun(runId, {
          status: "pending",
          accountsSynced: 0,
          transactionsImported: 0,
        });
        return {
          status: "PENDING",
          message:
            "Comptes en cours de liaison chez la banque. Réessayez dans quelques instants.",
          connection: this.repository.getConnector(connection.id, userId),
        };
      }

      const today = todayIso();

      for (const sessionAccount of accounts) {
        try {
          const data = await this.connector.fetchAccountData(sessionAccount.uid);
          const account = this.repository.upsertSyncedAccount(userId, {
            provider: PROVIDERS.ENABLE_BANKING,
            externalId: data.externalId,
            connectionId: connection.id,
            name: data.name,
            type: data.type,
            currency: data.currency,
            balance: data.balance,
            availableBalance: data.availableBalance,
            iban: data.iban,
            lastSyncAt: new Date().toISOString(),
            metadata: {
              sessionAccountUid: sessionAccount.uid,
              identificationHash: data.identificationHash,
              product: data.product,
              connectionLabel: connection.label,
              aspspName: connection.aspspName,
            },
          });
          accountsSynced += 1;
          this.repository.saveSnapshot(
            userId,
            account.id,
            today,
            data.balance,
            data.currency,
            "enable-banking",
          );

          const latest = this.repository.getLatestTransactionDate(account.id);
          const dateFrom = computeWindowStart(latest, new Date());
          const fetched = await this.connector.fetchAllTransactions(sessionAccount.uid, {
            dateFrom,
          });
          const mapped = mapEnableBankingTransactions(fetched.transactions);
          const known = this.repository.listTransactionDedupKeys(account.id);
          const fresh = selectNewTransactions(known, mapped);
          if (fresh.length > 0) {
            transactionsImported += this.repository.insertTransactions(
              userId,
              account.id,
              PROVIDERS.ENABLE_BANKING,
              fresh,
            );
          }
        } catch (error) {
          if (error instanceof ConnectorAuthError) throw error;
          errors.push({
            account: dataLabel(sessionAccount),
            error: error.message,
            code: error.code || "ACCOUNT_SYNC_ERROR",
          });
        }
      }

      const hasErrors = errors.length > 0;
      this.repository.updateConnector(connection.id, userId, {
        status: hasErrors && accountsSynced === 0 ? "error" : "active",
        validUntil: session.access?.valid_until || connection.validUntil,
        lastSyncAt: new Date().toISOString(),
        lastError: hasErrors
          ? `${errors.length} compte(s) en erreur : ${errors[0].error}`
          : null,
        metadata: {
          ...(connection.metadata || {}),
          ...(session.aspsp ? { aspsp: session.aspsp } : {}),
          lastSessionStatus: session.status || null,
        },
      });
      this.repository.finishSyncRun(runId, {
        status: hasErrors ? "partial" : "success",
        accountsSynced,
        transactionsImported,
        error: hasErrors ? JSON.stringify(errors) : null,
      });

      return {
        status: "OK",
        accountsSynced,
        transactionsImported,
        errors,
        connection: this.repository.getConnector(connection.id, userId),
      };
    } catch (error) {
      if (error instanceof ConnectorAuthError) {
        this.repository.updateConnector(connection.id, userId, {
          status: "expired",
          lastError: error.message,
        });
      } else if (!(error instanceof ConnectorConfigError)) {
        this.repository.updateConnector(connection.id, userId, {
          status: "error",
          lastError: error.message,
        });
      }
      this.repository.finishSyncRun(runId, {
        status: "error",
        accountsSynced,
        transactionsImported,
        error: error.message,
      });
      throw error;
    }
  }

  async syncAll(userId, { force = false } = {}) {
    const connections = this.repository
      .listConnectors(userId)
      .filter((connection) => connection.provider === PROVIDERS.ENABLE_BANKING)
      .filter((connection) => connection.sessionId);
    const results = [];
    for (const connection of connections) {
      try {
        const result = await this.syncConnection(connection.id, userId, { force });
        results.push({ connectionId: connection.id, label: connection.label, ...result });
      } catch (error) {
        results.push({
          connectionId: connection.id,
          label: connection.label,
          status: "ERROR",
          error: error.message,
          code: error.code || "SYNC_ERROR",
        });
      }
    }
    return results;
  }

  async disconnect(connectionId, userId, { archiveAccounts = false } = {}) {
    const connection = this.repository.getConnector(connectionId, userId);
    if (!connection) {
      throw new ConnectorError("Connexion introuvable", { status: 404, code: "NOT_FOUND" });
    }
    if (connection.sessionId) {
      // La révocation distante peut échouer (session déjà expirée, réseau) :
      // le nettoyage local doit rester possible dans tous les cas.
      try {
        await this.connector.deleteSession(connection.sessionId);
      } catch {
        // Le consentement est peut-être déjà expiré côté banque.
      }
    }
    if (archiveAccounts) {
      this.repository.archiveAccountsByConnection(connectionId, userId);
    } else {
      this.repository.detachAccountsFromConnection(connectionId, userId);
    }
    this.repository.deleteConnector(connectionId, userId);
    return true;
  }
}

const dataLabel = (account) => account?.identificationHash || account?.uid || "compte";

const cryptoRandomState = () => {
  // UUID v4 sans dépendance supplémentaire.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
};

export default SyncService;
