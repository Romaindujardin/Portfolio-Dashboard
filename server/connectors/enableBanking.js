// Connecteur Enable Banking (PSD2 / AIS).
// -----------------------------------------------------------------------------
// Contrat aligné sur la documentation officielle actuelle :
//   - JWT RS256, kid = application id, iss = enablebanking.com,
//     aud = api.enablebanking.com
//   - POST /auth            -> URL d'autorisation
//   - POST /sessions        -> session_id + comptes (objets complets)
//   - GET  /sessions/{id}   -> accounts (uid) + accounts_data (identification_hash)
//   - GET  /accounts/{uid}/details, /balances, /transactions
//
// Le connecteur ne persiste rien : le service de synchronisation s'en charge.

import crypto from "crypto";
import fs from "fs";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorError,
  PROVIDERS,
} from "./types.js";
import { decryptJson } from "../lib/secrets.js";
import { todayIso } from "../lib/validate.js";

const DEFAULT_BASE_URL = "https://api.enablebanking.com";
const DEFAULT_REDIRECT_URI =
  "https://localhost:5173/api/portfolio/connections/enable-banking/callback";
const DEFAULT_COUNTRY = "FR";
const MAX_INSTITUTIONS = 30;
const MAX_CONSENT_SECONDS = 180 * 24 * 3600;
const REQUEST_TIMEOUT_MS = 30000;

const b64url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const normalizePem = (value) =>
  String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();

/**
 * Construit un JWT RS256 pour Enable Banking.
 * Format courant : `kid` = Application ID, `iss` = "enablebanking.com".
 * Exporté pour les tests : aucun appel réseau n'est nécessaire.
 */
export const createJwt = ({
  applicationId,
  privateKey,
  now = Math.floor(Date.now() / 1000),
  ttlSeconds = 3600,
}) => {
  if (!applicationId || !privateKey) {
    throw new ConnectorConfigError(
      "Configuration Enable Banking incomplète (application ID ou clé privée).",
    );
  }
  const header = { typ: "JWT", alg: "RS256", kid: applicationId };
  const payload = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + Math.min(Math.max(Number(ttlSeconds) || 3600, 60), 86400),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  let signature;
  try {
    signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), {
      key: normalizePem(privateKey),
      padding: crypto.constants.RSA_PKCS1_PADDING,
    });
  } catch (error) {
    throw new ConnectorConfigError(
      `Clé privée Enable Banking invalide : ${error.message}`,
    );
  }
  return `${signingInput}.${b64url(signature)}`;
};

/** Identifiant composite « Nom::Pays::psuType », comme dans Picsou. */
export const buildInstitutionId = (name, country, psuType) =>
  `${name}::${country || ""}::${psuType || "personal"}`;

export const parseInstitutionId = (institutionId) => {
  const parts = String(institutionId || "").split("::");
  const name = parts[0]?.trim();
  if (!name) throw new ConnectorError("Établissement bancaire invalide", { status: 400 });
  const country = parts[1]?.trim() || DEFAULT_COUNTRY;
  let psuType = parts[2]?.trim() || "personal";
  if (!["personal", "business"].includes(psuType)) psuType = "personal";
  return { name, country, psuType };
};

export const resolvePsuType = (psuTypes) => {
  if (!Array.isArray(psuTypes) || psuTypes.length === 0) return "personal";
  if (psuTypes.includes("personal")) return "personal";
  if (psuTypes.includes("business")) return "business";
  return psuTypes[0];
};

/** Mappe le catalogue Enable Banking vers une liste stable et dédupliquée. */
export const mapInstitutions = (aspsps, query = "", fallbackCountry = DEFAULT_COUNTRY) => {
  const q = String(query || "").toLowerCase().trim();
  const byId = new Map();
  for (const aspsp of Array.isArray(aspsps) ? aspsps : []) {
    if (!aspsp?.name) continue;
    if (q && !aspsp.name.toLowerCase().includes(q)) continue;
    const country = aspsp.country || fallbackCountry;
    const psuType = resolvePsuType(aspsp.psu_types);
    const id = buildInstitutionId(aspsp.name, country, psuType);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: aspsp.name,
        bic: aspsp.bic || null,
        logo: aspsp.logo || null,
        country,
        psuType,
        beta: Boolean(aspsp.beta),
      });
    }
    if (byId.size >= MAX_INSTITUTIONS) break;
  }
  return [...byId.values()];
};

/** Récupère le solde le plus pertinent d'une réponse /balances. */
const PREFERRED_BALANCE_TYPES = [
  "CLAV",
  "CLBD",
  "ITAV",
  "OPAV",
  "XPCD",
  "FWAV",
  "PRCD",
  "closingBooked",
  "expected",
];

export const pickBalance = (balances) => {
  const list = Array.isArray(balances) ? balances.filter(Boolean) : [];
  if (list.length === 0) return null;
  // Priorité explicite (CLAV avant CLBD, etc.), indépendante de l'ordre du
  // fournisseur : Picsou applique la même hiérarchie.
  let selected = null;
  for (const type of PREFERRED_BALANCE_TYPES) {
    selected = list.find((balance) => String(balance.balance_type || "") === type);
    if (selected) break;
  }
  selected = selected || list[0];
  const amount = Number(selected?.balance_amount?.amount);
  if (!Number.isFinite(amount)) return null;
  return {
    amount,
    currency: selected?.balance_amount?.currency || "EUR",
    type: selected?.balance_type || null,
  };
};

/**
 * Extrait les comptes d'une session.
 * POST /sessions renvoie des objets ; GET /sessions/{id} renvoie des uid +
 * accounts_data. On gère les deux formes pour être robuste aux évolutions.
 */
export const extractSessionAccounts = (session) => {
  const hashes = new Map(
    (Array.isArray(session?.accounts_data) ? session.accounts_data : []).map(
      (entry) => [entry.uid, entry.identification_hash || null],
    ),
  );
  const list = Array.isArray(session?.accounts) ? session.accounts : [];
  return list
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          uid: entry,
          identificationHash: hashes.get(entry) || null,
          resource: null,
        };
      }
      if (entry?.uid) {
        return {
          uid: entry.uid,
          identificationHash:
            entry.identification_hash || hashes.get(entry.uid) || null,
          resource: entry,
        };
      }
      return null;
    })
    .filter(Boolean);
};

const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);

/** Détection heuristique du type de compte à partir des métadonnées PSD2. */
export const detectAccountType = (account) => {
  const haystack = [
    account?.name,
    account?.product,
    account?.details,
    account?.cash_account_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const cashType = String(account?.cash_account_type || "").toUpperCase();

  if (/(épargne salariale|epargne salariale|\bpee\b|\bperco\b|intéressement|interessement)/.test(haystack)) {
    return "EMPLOYEE_SAVINGS";
  }
  if (/\bpea\b|plan d'épargne en actions|plan d'epargne en actions/.test(haystack)) {
    return "PEA";
  }
  if (/(compte[- ]titres|compte titres|\bcto\b|portefeuille|securities)/.test(haystack)) {
    return "SECURITIES";
  }
  if (/(livret|\blep\b|\bldds\b|\bpel\b|\bcel\b|épargne|epargne)/.test(haystack)) {
    return "SAVINGS";
  }
  if (cashType === "SVGS" || cashType === "TRAN") return "SAVINGS";
  if (cashType === "LOAN" || cashType === "LOANACCOUNT") return "LOAN";
  if (["CACC", "CARD", "CASH", "OTHR"].includes(cashType)) return "CHECKING";
  return "CHECKING";
};

export const externalIdForAccount = (detail, fallbackUid) => {
  if (detail?.identification_hash) return detail.identification_hash;
  const iban = detail?.account_id?.iban || detail?.iban;
  if (iban) return `iban:${hashValue(iban)}`;
  return `uid:${fallbackUid}`;
};

export class EnableBankingConnector {
  constructor({ repository, baseUrl } = {}) {
    this.repository = repository;
    this.baseUrlOverride = baseUrl || null;
    this.configCache = null;
  }

  /** Secrets stockés (chiffrés) dans integration_settings. */
  storedConfig() {
    if (!this.repository) return null;
    const row = this.repository.getEncryptedIntegration(PROVIDERS.ENABLE_BANKING);
    if (!row?.encrypted_json) return null;
    try {
      return decryptJson(row.encrypted_json);
    } catch {
      return null;
    }
  }

  resolveConfig() {
    if (this.configCache) return this.configCache;
    const stored = this.storedConfig() || {};
    const privateKeyPath =
      process.env.ENABLE_BANKING_PRIVATE_KEY_PATH ||
      process.env.ENABLEBANKING_PRIVATE_KEY_PATH;
    let fileKey = null;
    if (privateKeyPath) {
      try {
        fileKey = fs.readFileSync(privateKeyPath, "utf8");
      } catch {
        fileKey = null;
      }
    }

    const config = {
      applicationId:
        process.env.ENABLEBANKING_APPLICATION_ID ||
        process.env.ENABLE_BANKING_APP_ID ||
        stored.applicationId ||
        "",
      privateKey:
        process.env.ENABLEBANKING_PRIVATE_KEY ||
        process.env.ENABLE_BANKING_PRIVATE_KEY ||
        fileKey ||
        stored.privateKey ||
        "",
      redirectUri:
        process.env.ENABLEBANKING_REDIRECT_URI ||
        process.env.ENABLE_BANKING_REDIRECT_URI ||
        stored.redirectUri ||
        DEFAULT_REDIRECT_URI,
      baseUrl:
        this.baseUrlOverride ||
        process.env.ENABLEBANKING_BASE_URL ||
        process.env.ENABLE_BANKING_BASE_URL ||
        DEFAULT_BASE_URL,
    };
    this.configCache = config;
    return config;
  }

  invalidateConfig() {
    this.configCache = null;
  }

  getStatus() {
    const config = this.resolveConfig();
    const missing = [];
    if (!config.applicationId) missing.push("applicationId");
    if (!config.privateKey) missing.push("privateKey");
    if (!config.redirectUri) missing.push("redirectUri");
    return {
      configured: missing.length === 0,
      missing,
      applicationId: config.applicationId
        ? `${config.applicationId.slice(0, 8)}…`
        : null,
      redirectUri: config.redirectUri,
      baseUrl: config.baseUrl,
    };
  }

  authHeader() {
    const config = this.resolveConfig();
    return `Bearer ${createJwt({
      applicationId: config.applicationId,
      privateKey: config.privateKey,
    })}`;
  }

  async request(path, { method = "GET", body = null, query = null } = {}) {
    const config = this.resolveConfig();
    if (!config.applicationId || !config.privateKey) {
      throw new ConnectorConfigError(
        "Enable Banking n'est pas configuré. Renseignez l'application ID et la clé privée dans l'onglet Connexions.",
        this.getStatus(),
      );
    }

    const url = new URL(`${config.baseUrl.replace(/\/+$/, "")}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null && value !== "") url.searchParams.set(key, String(value));
      }
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader(),
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Portfolio-Dashboard/1.0 (self-hosted)",
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ConnectorError(
        `Enable Banking injoignable : ${error.message}`,
        { status: 502, code: "NETWORK_ERROR", retryable: true },
      );
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerCode =
        payload?.code || payload?.error || payload?.error_code || null;
      const message =
        payload?.message ||
        payload?.error_description ||
        payload?.detail ||
        `Erreur Enable Banking (HTTP ${response.status})`;
      const authFailure =
        response.status === 401 ||
        response.status === 403 ||
        ["EXPIRED_SESSION", "SESSION_EXPIRED", "ACCESS_DENIED"].includes(
          String(providerCode || "").toUpperCase(),
        );
      if (authFailure) {
        throw new ConnectorAuthError(
          "La session Enable Banking est expirée ou révoquée. Reconnectez la banque.",
          { providerCode, status: response.status, body: payload },
        );
      }
      throw new ConnectorError(message, {
        status: response.status >= 500 ? 502 : 400,
        code: providerCode || "ENABLE_BANKING_ERROR",
        details: { status: response.status, body: payload },
        retryable: response.status >= 500,
      });
    }
    return payload;
  }

  async listCountries() {
    try {
      const payload = await this.request("/application");
      const countries = Array.isArray(payload?.countries) ? payload.countries : [];
      return countries.length > 0 ? [...countries].sort() : [DEFAULT_COUNTRY];
    } catch {
      // Le catalogue des pays n'est pas critique : sans configuration, on
      // retombe sur la France pour laisser l'UI fonctionner.
      return [DEFAULT_COUNTRY];
    }
  }

  async listInstitutions({ query = "", country = DEFAULT_COUNTRY } = {}) {
    let payload;
    try {
      payload = await this.request("/aspsps", { query: { country } });
    } catch (error) {
      if (error instanceof ConnectorAuthError) {
        throw new ConnectorConfigError(
          "Identifiants Enable Banking refusés. Vérifiez l'application ID et la clé privée.",
        );
      }
      throw error;
    }
    return mapInstitutions(payload?.aspsps, query, country);
  }

  async maximumConsentSeconds(institution) {
    try {
      const payload = await this.request("/aspsps", {
        query: { country: institution.country },
      });
      const aspsp = (Array.isArray(payload?.aspsps) ? payload.aspsps : []).find(
        (entry) =>
          entry?.name === institution.name &&
          (!entry.country || entry.country === institution.country),
      );
      const maximum = Number(aspsp?.maximum_consent_validity);
      if (!Number.isFinite(maximum) || maximum <= 0) return MAX_CONSENT_SECONDS;
      // Marge d'une minute pour rester sous la limite annoncée par la banque.
      return Math.max(60, Math.min(MAX_CONSENT_SECONDS, maximum) - 60);
    } catch {
      return MAX_CONSENT_SECONDS;
    }
  }

  async startAuth({ institutionId, state, psuType } = {}) {
    const institution = parseInstitutionId(institutionId);
    const config = this.resolveConfig();
    const consentSeconds = await this.maximumConsentSeconds(institution);
    const validUntil = new Date(Date.now() + consentSeconds * 1000).toISOString();
    let payload;
    try {
      payload = await this.request("/auth", {
        method: "POST",
        body: {
          access: { valid_until: validUntil },
          aspsp: { name: institution.name, country: institution.country },
          state,
          redirect_url: config.redirectUri,
          psu_type: psuType || institution.psuType,
          language: "fr",
        },
      });
    } catch (error) {
      if (error instanceof ConnectorAuthError) {
        throw new ConnectorConfigError(
          "Identifiants Enable Banking refusés. Vérifiez l'application ID et la clé privée.",
        );
      }
      throw error;
    }
    if (!payload?.url) {
      throw new ConnectorError("Réponse /auth vide : aucune URL d'autorisation.", {
        status: 502,
        code: "EMPTY_AUTH_RESPONSE",
        retryable: true,
      });
    }
    return {
      url: payload.url,
      authorizationId: payload.authorization_id || null,
      institution,
      validUntil,
    };
  }

  async exchangeCode(code) {
    if (!code) throw new ConnectorError("Code d'autorisation manquant", { status: 400 });
    let payload;
    try {
      payload = await this.request("/sessions", {
        method: "POST",
        body: { code },
      });
    } catch (error) {
      if (error instanceof ConnectorAuthError) {
        throw new ConnectorError(
          "Code d'autorisation refusé ou expiré. Relancez la connexion depuis l'application.",
          { status: 400, code: "INVALID_AUTHORIZATION_CODE" },
        );
      }
      throw error;
    }
    if (!payload?.session_id) {
      throw new ConnectorError("Réponse /sessions vide : session absente.", {
        status: 502,
        code: "EMPTY_SESSION_RESPONSE",
        retryable: true,
      });
    }
    return payload;
  }

  async getSession(sessionId) {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async getAccountDetails(accountUid) {
    const payload = await this.request(
      `/accounts/${encodeURIComponent(accountUid)}/details`,
    );
    // La documentation officielle renvoie l'objet directement ; certaines
    // versions l'enveloppent dans { account: ... }. On accepte les deux.
    return payload?.account || payload;
  }

  async getBalances(accountUid) {
    const payload = await this.request(
      `/accounts/${encodeURIComponent(accountUid)}/balances`,
    );
    return pickBalance(payload?.balances);
  }

  async fetchAccountData(accountUid) {
    const [details, balance] = await Promise.all([
      this.getAccountDetails(accountUid),
      this.getBalances(accountUid),
    ]);
    const name =
      details?.name || details?.product || details?.details || "Compte bancaire";
    const iban = details?.account_id?.iban || details?.iban || null;
    const currency =
      details?.currency || balance?.currency || "EUR";
    return {
      uid: accountUid,
      externalId: externalIdForAccount(details, accountUid),
      identificationHash: details?.identification_hash || null,
      name,
      product: details?.product || null,
      iban,
      currency,
      balance: balance?.amount ?? 0,
      availableBalance: balance?.amount ?? null,
      type: detectAccountType(details),
      raw: details,
    };
  }

  async getTransactionsPage(accountUid, { dateFrom, continuationKey } = {}) {
    return this.request(
      `/accounts/${encodeURIComponent(accountUid)}/transactions`,
      {
        query: {
          date_from: dateFrom || undefined,
          continuation_key: continuationKey || undefined,
        },
      },
    );
  }

  async fetchAllTransactions(accountUid, { dateFrom, maxPages = 20 } = {}) {
    const collected = [];
    let continuationKey = null;
    let pages = 0;
    do {
      const payload = await this.getTransactionsPage(accountUid, {
        dateFrom,
        continuationKey,
      });
      if (Array.isArray(payload?.transactions)) {
        collected.push(...payload.transactions);
      }
      continuationKey = payload?.continuation_key || null;
      pages += 1;
    } while (continuationKey && pages < maxPages);
    return { transactions: collected, pages, truncated: Boolean(continuationKey) };
  }

  async deleteSession(sessionId) {
    if (!sessionId) return;
    try {
      await this.request(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
    } catch {
      // Déconnexion best-effort : la suppression locale reste possible.
    }
  }
}

export const enableBankingHelpers = {
  createJwt,
  buildInstitutionId,
  parseInstitutionId,
  resolvePsuType,
  mapInstitutions,
  pickBalance,
  extractSessionAccounts,
  detectAccountType,
  externalIdForAccount,
  todayIso,
};

export default EnableBankingConnector;
