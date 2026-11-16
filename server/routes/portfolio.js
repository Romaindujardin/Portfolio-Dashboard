// Routes HTTP du patrimoine connecté.
// Montées sous /api/portfolio par server.js. Aucune route existante n'est
// modifiée : les pages historiques continuent d'utiliser leurs endpoints.

import express from "express";
import fetch from "node-fetch";
import { PortfolioRepository } from "../services/portfolioRepository.js";
import { EnableBankingConnector } from "../connectors/enableBanking.js";
import { SyncService, parseOAuthState } from "../services/syncService.js";
import {
  MarketDataService,
  isIsin,
  normalizeTicker,
} from "../services/marketData.js";
import { RealEstateService, ValuationError } from "../services/realEstate.js";
import {
  LoanError,
  buildAmortizationSchedule,
  syncLoanAccount,
} from "../services/loans.js";
import { OwnershipError, normalizeShares } from "../services/ownership.js";
import {
  transactionDedupKey,
} from "../services/transactions.js";
import { executeCsvImport } from "../services/csvImportService.js";
import {
  ACCOUNT_TYPES,
  ConnectorError,
  INVESTMENT_TYPES,
  PROVIDERS,
} from "../connectors/types.js";
import {
  HttpError,
  asDate,
  asNumber,
  asOptionalInteger,
  asOptionalNumber,
  asOptionalString,
  asString,
  asyncHandler,
  nowIso,
  oneOf,
  round2,
  todayIso,
} from "../lib/validate.js";
import {
  clearSessionCookie,
  resolveRequestUserId,
  setSessionCookie,
} from "../lib/session.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { isAdminUser } from "../lib/admin.js";
import {
  resolveSetupAuth,
  setupTokenMatches,
} from "../lib/setupAuth.js";
import { encryptJson } from "../lib/secrets.js";
import {
  SECRET_KEYS,
  deleteUserSecret,
  getUserSecret,
  getUserSecretStatuses,
  isSecretKey,
  setUserSecret,
} from "../services/userSecretsService.js";
import { deleteUserData } from "../services/userDataService.js";
import {
  CryptoFetchError,
  syncCryptoAccount,
  syncAllCryptoAccounts,
} from "../services/cryptoService.js";
import {
  deleteBoursoCredentials,
  getBoursoStatus,
  syncBoursoSidecar,
} from "../services/boursoSidecarService.js";
import {
  computePortfolioEtfBreakdown,
  ETF_CATALOG,
  resolveHoldingProfile,
} from "../services/etfService.js";
import {
  changeUserPasswordAsync,
  getUserCredential,
  hasUserPassword,
  setUserPasswordAsync,
  validateUsername,
  verifyUserPasswordAsync,
} from "../services/authService.js";

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
};

const requireSessionUserId = (req) => {
  if (!req.sessionUser) {
    throw new HttpError(401, "Authentification requise");
  }
  return req.sessionUser;
};

/**
 * Les erreurs de récupération crypto sont des erreurs de fournisseur (502),
 * pas des erreurs internes : la synchronisation a été annulée avant écriture.
 */
const replyCryptoError = (res, error) => {
  if (!(error instanceof CryptoFetchError)) return false;
  res.status(502).json({
    error: error.message,
    code: error.code || "CRYPTO_FETCH_FAILED",
  });
  return true;
};

const bodyUserId = (req) => {
  const userId = resolveRequestUserId(
    req,
    req.body?.user_id ?? req.body?.userId ?? req.query.user_id,
  );
  if (!userId) throw new HttpError(400, "user_id invalide");
  return userId || requireSessionUserId(req);
};

const queryUserId = (req) => {
  const userId = resolveRequestUserId(req, req.query.user_id);
  if (!userId) throw new HttpError(400, "user_id invalide");
  return userId || requireSessionUserId(req);
};

const buildPropertyAccountName = (property) =>
  property.name || property.address || "Bien immobilier";

const SENSITIVE_ACCOUNT_METADATA = new Set([
  "credentialsEncrypted",
  "apiKeyMasked",
  "apiKey",
  "apiSecret",
  "binanceApiKey",
  "binanceSecretKey",
  "password",
  "customerId",
  "privateKey",
  "sessionId",
  "accessToken",
  "refreshToken",
]);

/** Ne jamais exposer les métadonnées secrètes d'un compte dans une réponse API. */
const sanitizeAccountMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }
  const clean = { ...metadata };
  for (const key of SENSITIVE_ACCOUNT_METADATA) delete clean[key];
  return clean;
};

const publicAccount = (account) =>
  account && typeof account === "object" && !Array.isArray(account)
    ? { ...account, metadata: sanitizeAccountMetadata(account.metadata) }
    : account;

const SENSITIVE_CONNECTION_METADATA = new Set([
  "customerId",
  "password",
  "credentialsEncrypted",
  "apiKey",
  "apiSecret",
  "privateKey",
  "state",
  "authorizationId",
  "sessionId",
]);

/** Ne jamais exposer les identifiants d'une connexion dans une réponse API. */
const publicConnection = (connection) => {
  if (
    !connection ||
    typeof connection !== "object" ||
    Array.isArray(connection)
  ) {
    return connection;
  }
  // Le sessionId Enable Banking permet d'interroger la banque : il reste côté
  // serveur, comme les identifiants stockés dans les métadonnées.
  const { sessionId: _sessionId, ...safeConnection } = connection;
  const metadata = safeConnection.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return safeConnection;
  }
  const clean = { ...metadata };
  for (const key of SENSITIVE_CONNECTION_METADATA) delete clean[key];
  return { ...safeConnection, metadata: clean };
};

/**
 * Nettoie récursivement tout résultat de synchronisation avant réponse API :
 * connexions, comptes (y compris listes imbriquées) et sous-résultats.
 */
export const publicSyncResult = (result, seen = new WeakSet()) => {
  if (!result || typeof result !== "object") return result;
  if (seen.has(result)) return result;
  seen.add(result);
  if (Array.isArray(result)) {
    return result.map((entry) => publicSyncResult(entry, seen));
  }
  const clean = { ...result };
  if (clean.connection) clean.connection = publicConnection(clean.connection);
  if (clean.account) clean.account = publicAccount(clean.account);
  if (Array.isArray(clean.accounts)) {
    clean.accounts = clean.accounts.map(publicAccount);
  }
  if (Array.isArray(clean.results)) {
    clean.results = clean.results.map((entry) => publicSyncResult(entry, seen));
  }
  for (const key of ["sync", "result"]) {
    if (clean[key] && typeof clean[key] === "object") {
      clean[key] = publicSyncResult(clean[key], seen);
    }
  }
  return clean;
};

export function createPortfolioRouter({
  db,
  enableBankingBaseUrl = null,
  setupAuth = resolveSetupAuth(),
  adminUsers = null,
  authRateLimits = {},
} = {}) {
  if (!db) throw new Error("Base de données requise pour le routeur patrimoine");
  const router = express.Router();

  const httpErrorWithCode = (status, message, code) => {
    const error = new HttpError(status, message);
    error.code = code;
    return error;
  };
  const repository = new PortfolioRepository(db);
  const connector = new EnableBankingConnector({
    repository,
    baseUrl: enableBankingBaseUrl,
  });
  const syncService = new SyncService({ repository, connector });
  const market = new MarketDataService({ repository });
  const realEstate = new RealEstateService({ repository });

  const integrationStatus = (userId) => ({
    ...connector.getStatus(),
    canManage: isAdminUser(db, userId, { adminUsers }),
  });

  // Précharge les taux de change des devises réellement utilisées par les
  // comptes et positions du profil. Une devise en échec est valorisée en 1:1
  // et signalée dans overview.fx.missing.
  const loadFxRates = async (userId) => {
    const currencies = new Set();
    for (const account of repository.listAccounts(userId)) {
      if (account.currency) currencies.add(account.currency);
    }
    for (const holding of repository.listAllHoldings(userId)) {
      if (holding.currency) currencies.add(holding.currency);
    }
    return market.preloadFxRates([...currencies]);
  };

  const requireIntegrationAdmin = (userId) => {
    if (!isAdminUser(db, userId, { adminUsers })) {
      throw new HttpError(
        403,
        "Seul un administrateur peut modifier la configuration Enable Banking globale.",
      );
    }
  };

  /** Source de vérité d'un compte géré par un bien ou un prêt. */
  const managedAccountSource = (userId, account) => {
    if (account.type === "REAL_ESTATE") {
      return repository
        .listProperties(userId)
        .some((property) => property.accountId === account.id)
        ? "Immobilier"
        : null;
    }
    if (account.type === "LOAN") {
      return repository
        .listLoans(userId)
        .some((loan) => loan.accountId === account.id)
        ? "Prêts"
        : null;
    }
    return null;
  };

  // ─── Santé / diagnostic ────────────────────────────────────────────────────

  router.get(
    "/health",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const fxRates = await loadFxRates(userId);
      const overview = repository.getOverview(userId, { fxRates });
      res.json({
        ok: true,
        userId,
        enableBanking: integrationStatus(userId),
        counts: overview.counts,
        fx: overview.fx,
        timestamp: nowIso(),
      });
    }),
  );

  // ─── Authentification & Sécurité des profils ──────────────────────────────

  // Aucune réponse d'authentification ne doit être mise en cache par un
  // navigateur ou un proxy.
  router.use("/auth", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    next();
  });

  const authKey = (req) =>
    `${req.ip || req.socket?.remoteAddress || "unknown"}:${String(
      req.body?.username || req.query?.username || "",
    )
      .trim()
      .slice(0, 64)
      .toLowerCase()}`;
  // Limite par IP + profil : ralentit les attaques ciblées sur un compte.
  const {
    authWindowMs = 5 * 60 * 1000,
    authMax = 12,
    authIpWindowMs = 15 * 60 * 1000,
    authIpMax = 200,
    statusWindowMs = 60 * 1000,
    statusMax = 60,
  } = authRateLimits;
  const authLimiter = createRateLimiter({
    windowMs: authWindowMs,
    max: authMax,
    keyPrefix: "auth",
    keyGenerator: authKey,
  });
  // Limite globale par IP : protège aussi les créations de profils et les
  // attaques qui feraient varier le nom d'utilisateur. Seuil volontairement
  // haut pour ne pas pénaliser un foyer derrière un NAT.
  const authIpLimiter = createRateLimiter({
    windowMs: authIpWindowMs,
    max: authIpMax,
    keyPrefix: "auth-ip",
  });
  const statusLimiter = createRateLimiter({
    windowMs: statusWindowMs,
    max: statusMax,
    keyPrefix: "auth-status",
  });

  router.get(
    "/auth/status",
    statusLimiter,
    asyncHandler(async (req, res) => {
      const username = String(req.query.username || "").trim();
      if (!username) {
        throw new HttpError(400, "Nom d'utilisateur requis");
      }
      let cleanUsername;
      try {
        cleanUsername = validateUsername(username);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      // Réponse minimale : le nom validé n'est pas renvoyé en écho, seul
      // l'état nécessaire au formulaire de connexion est exposé. `hasPassword`
      // reste utile pour choisir entre création et déverrouillage ; il ne
      // révèle pas le nom et l'énumération est bornée par les limiteurs.
      const hasPassword = hasUserPassword(db, cleanUsername);
      res.json({
        hasPassword,
        setup: {
          enabled: Boolean(setupAuth.enabled),
          tokenRequired: Boolean(setupAuth.required),
        },
      });
    }),
  );

  router.post(
    "/auth/setup",
    authIpLimiter,
    authLimiter,
    asyncHandler(async (req, res) => {
      if (!setupAuth.enabled) {
        throw httpErrorWithCode(
          403,
          "La création de profil est désactivée sur ce serveur.",
          "SETUP_DISABLED",
        );
      }
      if (setupAuth.required) {
        const providedToken = req.get("X-Setup-Token");
        if (!providedToken) {
          throw httpErrorWithCode(
            403,
            "Code d'initialisation requis pour créer un profil.",
            "SETUP_TOKEN_REQUIRED",
          );
        }
        if (!setupTokenMatches(providedToken, setupAuth.token)) {
          throw httpErrorWithCode(
            403,
            "Code d'initialisation invalide.",
            "SETUP_TOKEN_INVALID",
          );
        }
      }

      const { username, password } = req.body || {};
      let cleanUsername;
      try {
        cleanUsername = validateUsername(username);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      try {
        const result = await setUserPasswordAsync(db, cleanUsername, password);
        const credential = getUserCredential(db, cleanUsername);
        setSessionCookie(
          req,
          res,
          cleanUsername,
          credential?.session_version,
        );
        res.status(201).json(result);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    }),
  );

  router.post(
    "/auth/verify",
    authIpLimiter,
    authLimiter,
    asyncHandler(async (req, res) => {
      const { username, password } = req.body || {};
      let cleanUsername;
      try {
        cleanUsername = validateUsername(username);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      const isValid = await verifyUserPasswordAsync(
        db,
        cleanUsername,
        typeof password === "string" ? password : "",
      );
      if (!isValid) {
        throw new HttpError(401, "Mot de passe incorrect");
      }
      const credential = getUserCredential(db, cleanUsername);
      setSessionCookie(
        req,
        res,
        cleanUsername,
        credential?.session_version,
      );
      res.json({ success: true, username: cleanUsername });
    }),
  );

  router.get(
    "/auth/me",
    asyncHandler(async (req, res) => {
      res.json({
        authenticated: Boolean(req.sessionUser),
        username: req.sessionUser || null,
      });
    }),
  );

  router.post(
    "/auth/logout",
    asyncHandler(async (req, res) => {
      clearSessionCookie(req, res);
      res.json({ success: true });
    }),
  );

  router.post(
    "/auth/change-password",
    authLimiter,
    asyncHandler(async (req, res) => {
      if (!req.sessionUser) {
        throw new HttpError(401, "Authentification requise");
      }
      const { username, currentPassword, newPassword } = req.body || {};
      const cleanUsername = String(username || "").trim();
      if (!cleanUsername) {
        throw new HttpError(400, "Nom d'utilisateur requis");
      }
      if (cleanUsername !== req.sessionUser) {
        throw new HttpError(403, "Accès interdit à ce profil");
      }
      try {
        const result = await changeUserPasswordAsync(
          db,
          cleanUsername,
          currentPassword,
          newPassword,
        );
        setSessionCookie(
          req,
          res,
          cleanUsername,
          result.sessionVersion,
        );
        res.json(result);
      } catch (err) {
        const status = err.message?.toLowerCase().includes("incorrect")
          ? 401
          : 400;
        throw new HttpError(status, err.message);
      }
    }),
  );

  // ─── Coffre de secrets d'intégration (chiffré, jamais renvoyé en clair) ───

  const secretLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyPrefix: "secrets",
  });

  router.get(
    "/secrets",
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      res.json({
        secrets: getUserSecretStatuses(db, userId),
        keys: SECRET_KEYS,
      });
    }),
  );

  router.put(
    "/secrets/:key",
    secretLimiter,
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      const keyName = String(req.params.key || "");
      if (!isSecretKey(keyName)) {
        throw new HttpError(400, "Clé de secret inconnue");
      }
      try {
        const result = setUserSecret(db, userId, keyName, req.body?.value);
        res.json(result);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    }),
  );

  router.delete(
    "/secrets/:key",
    secretLimiter,
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      const keyName = String(req.params.key || "");
      if (!isSecretKey(keyName)) {
        throw new HttpError(400, "Clé de secret inconnue");
      }
      const deleted = deleteUserSecret(db, userId, keyName);
      res.json({ success: true, key: keyName, deleted });
    }),
  );

  router.delete(
    "/users/:username",
    asyncHandler(async (req, res) => {
      const sessionUser = requireSessionUserId(req);
      const username = String(req.params.username || "").trim();
      if (username !== sessionUser) {
        throw new HttpError(403, "Accès interdit à ce profil");
      }
      const result = deleteUserData(db, username);
      clearSessionCookie(req, res);
      res.json(result);
    }),
  );

  // ─── Proxy Gemini (la clé reste exclusivement côté serveur) ───────────────

  const aiLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    keyPrefix: "ai-gemini",
  });

  router.post(
    "/ai/gemini",
    aiLimiter,
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      const model = String(req.body?.model || req.query?.model || "").trim();
      const payload = req.body?.payload;
      if (!/^gemini-[A-Za-z0-9._-]{1,80}$/.test(model)) {
        throw new HttpError(400, "Modèle Gemini invalide");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new HttpError(400, "Payload Gemini invalide");
      }
      let serialized;
      try {
        serialized = JSON.stringify(payload);
      } catch {
        throw new HttpError(400, "Payload Gemini non sérialisable");
      }
      if (serialized.length > 2_000_000) {
        throw new HttpError(413, "Payload Gemini trop volumineux");
      }
      const apiKey = getUserSecret(db, userId, "geminiApiKey");
      if (!apiKey) {
        throw new HttpError(
          400,
          "Clé API Gemini non configurée. Renseignez-la dans les paramètres pour utiliser le Conseiller IA.",
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model,
          )}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: serialized,
            signal: controller.signal,
          },
        );
        const text = await upstream.text();
        res.status(upstream.status);
        res.type(upstream.headers.get("content-type") || "application/json");
        return res.send(text);
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new HttpError(504, "Gemini n'a pas répondu à temps");
        }
        throw new HttpError(502, "Impossible de joindre Gemini");
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  // ─── Proxies de données de marché (clés côté serveur) ─────────────────────

  const marketLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    keyPrefix: "market",
  });

  router.get(
    "/crypto/etherscan",
    marketLimiter,
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      const moduleName = String(req.query.module || "");
      const action = String(req.query.action || "");
      const allowedActions = new Set([
        "balance",
        "tokentx",
        "tokenbalance",
      ]);
      if (moduleName !== "account" || !allowedActions.has(action)) {
        throw new HttpError(400, "Requête Etherscan non autorisée");
      }
      const apiKey = getUserSecret(db, userId, "etherscanApiKey");
      if (!apiKey) {
        throw new HttpError(
          400,
          "Clé API Etherscan non configurée. Renseignez-la dans les paramètres.",
        );
      }
      const url = new URL("https://api.etherscan.io/v2/api");
      url.searchParams.set("module", moduleName);
      url.searchParams.set("action", action);
      for (const key of [
        "address",
        "chainid",
        "contractaddress",
        "startblock",
        "endblock",
        "sort",
      ]) {
        if (req.query[key] != null) {
          url.searchParams.set(key, String(req.query[key]));
        }
      }
      url.searchParams.set("apikey", apiKey);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const upstream = await fetch(url.toString(), {
          signal: controller.signal,
        });
        const data = await upstream.json();
        res.status(upstream.status).json(data);
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new HttpError(504, "Etherscan n'a pas répondu à temps");
        }
        throw new HttpError(502, "Impossible de joindre Etherscan");
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  router.get(
    "/market/coingecko",
    marketLimiter,
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      const endpoint = String(req.query.endpoint || "");
      const allowed = new Set([
        "simple/price",
        "simple/token_price/ethereum",
      ]);
      if (!allowed.has(endpoint)) {
        throw new HttpError(400, "Endpoint CoinGecko non autorisé");
      }
      const url = new URL(`https://api.coingecko.com/api/v3/${endpoint}`);
      for (const key of ["ids", "contract_addresses", "vs_currencies"]) {
        if (req.query[key] != null) {
          url.searchParams.set(key, String(req.query[key]));
        }
      }
      const apiKey = getUserSecret(db, userId, "coinGeckoApiKey");
      if (apiKey) url.searchParams.set("x_cg_demo_api_key", apiKey);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const upstream = await fetch(url.toString(), {
          signal: controller.signal,
        });
        const data = await upstream.json();
        res.status(upstream.status).json(data);
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new HttpError(504, "CoinGecko n'a pas répondu à temps");
        }
        throw new HttpError(502, "Impossible de joindre CoinGecko");
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  // ─── Vue d'ensemble ────────────────────────────────────────────────────────

  router.get(
    "/overview",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      // Recalcule les soldes de prêts (dette restante à date) avant agrégation.
      for (const loan of repository.listLoans(userId)) {
        try {
          syncLoanAccount(repository, loan, userId);
        } catch {
          // Un prêt incomplet ne doit pas bloquer toute la synthèse.
        }
      }
      const overview = repository.getOverview(userId, {
        fxRates: await loadFxRates(userId),
      });
      res.json({
        ...overview,
        accounts: (overview.accounts || []).map(publicAccount),
      });
    }),
  );

  // ─── Comptes ───────────────────────────────────────────────────────────────

  /** Résout le logo officiel d'un compte (issu de sa connexion bancaire Enable Banking / Sidecar ou de son établissement). */
  const resolveAccountLogo = (account, connectorsMap = null) => {
    if (account?.metadata?.logo) return account.metadata.logo;
    if (account?.connectionId && connectorsMap) {
      const conn = connectorsMap.get(account.connectionId);
      if (conn?.metadata?.logo) return conn.metadata.logo;
      if (conn?.aspspName) {
        const country = conn.aspspCountry || "FR";
        return `https://enablebanking.com/brands/${encodeURIComponent(country)}/${encodeURIComponent(conn.aspspName)}/`;
      }
    }
    const nameLower = (account?.name || "").toLowerCase();
    const providerLower = (account?.provider || "").toLowerCase();
    if (providerLower.includes("bourso") || nameLower.includes("bourso")) {
      return "https://enablebanking.com/brands/FR/Boursorama%20Banque/";
    }
    if (nameLower.includes("natixis")) {
      return "https://www.google.com/s2/favicons?domain=natixis.com&sz=128";
    }
    if (nameLower.includes("gresham")) {
      return "https://www.google.com/s2/favicons?domain=gresham.fr&sz=128";
    }
    if (nameLower.includes("amundi")) {
      return "https://www.google.com/s2/favicons?domain=amundi.com&sz=128";
    }
    if (nameLower.includes("bnp")) {
      return "https://enablebanking.com/brands/FR/BNP%20Paribas/";
    }
    if (nameLower.includes("société générale") || nameLower.includes("societe generale")) {
      return "https://enablebanking.com/brands/FR/Soci%C3%A9t%C3%A9%20G%C3%A9n%C3%A9rale/";
    }
    if (nameLower.includes("credit agricole") || nameLower.includes("crédit agricole")) {
      return "https://enablebanking.com/brands/FR/Cr%C3%A9dit%20Agricole/";
    }
    if (nameLower.includes("credit mutuel") || nameLower.includes("crédit mutuel")) {
      return "https://enablebanking.com/brands/FR/Cr%C3%A9dit%20Mutuel/";
    }
    if (nameLower.includes("cic")) {
      return "https://enablebanking.com/brands/FR/CIC/";
    }
    if (nameLower.includes("fortuneo")) {
      return "https://enablebanking.com/brands/FR/Fortuneo/";
    }
    if (nameLower.includes("revolut")) {
      return "https://enablebanking.com/brands/FR/Revolut/";
    }
    if (nameLower.includes("n26")) {
      return "https://enablebanking.com/brands/FR/N26/";
    }
    if (nameLower.includes("monabanq")) {
      return "https://enablebanking.com/brands/FR/Monabanq/";
    }
    if (nameLower.includes("qonto")) {
      return "https://enablebanking.com/brands/FR/Qonto/";
    }
    return null;
  };

  /** Résout le logo officiel d'une connexion bancaire (Enable Banking, Sidecar ou autre). */
  const resolveConnectionLogo = (conn) => {
    if (conn?.metadata?.logo) return conn.metadata.logo;
    const nameLower = (conn?.aspspName || conn?.label || "").toLowerCase();
    const providerLower = (conn?.provider || "").toLowerCase();
    if (providerLower.includes("bourso") || nameLower.includes("bourso")) {
      return "https://enablebanking.com/brands/FR/Boursorama%20Banque/";
    }
    if (conn?.aspspName) {
      const country = conn.aspspCountry || "FR";
      return `https://enablebanking.com/brands/${encodeURIComponent(country)}/${encodeURIComponent(conn.aspspName)}/`;
    }
    if (nameLower.includes("natixis")) {
      return "https://www.google.com/s2/favicons?domain=natixis.com&sz=128";
    }
    if (nameLower.includes("gresham")) {
      return "https://www.google.com/s2/favicons?domain=gresham.fr&sz=128";
    }
    if (nameLower.includes("bnp")) {
      return "https://enablebanking.com/brands/FR/BNP%20Paribas/";
    }
    if (nameLower.includes("société générale") || nameLower.includes("societe generale")) {
      return "https://enablebanking.com/brands/FR/Soci%C3%A9t%C3%A9%20G%C3%A9n%C3%A9rale/";
    }
    if (nameLower.includes("credit agricole") || nameLower.includes("crédit agricole")) {
      return "https://enablebanking.com/brands/FR/Cr%C3%A9dit%20Agricole/";
    }
    if (nameLower.includes("credit mutuel") || nameLower.includes("crédit mutuel")) {
      return "https://enablebanking.com/brands/FR/Cr%C3%A9dit%20Mutuel/";
    }
    if (nameLower.includes("cic")) {
      return "https://enablebanking.com/brands/FR/CIC/";
    }
    if (nameLower.includes("fortuneo")) {
      return "https://enablebanking.com/brands/FR/Fortuneo/";
    }
    return null;
  };

  router.get(
    "/accounts",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const rawAccounts = repository.listAccounts(userId, {
        includeArchived: toBool(req.query.include_archived),
      });
      const connectors = new Map(
        repository.listConnectors(userId).map((c) => [c.id, c]),
      );
      const accounts = rawAccounts.map((account) => ({
        ...publicAccount(account),
        logo: resolveAccountLogo(account, connectors),
      }));
      res.json({ accounts });
    }),
  );

  router.get(
    "/accounts/:id",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      const connectors = new Map(
        repository.listConnectors(userId).map((c) => [c.id, c]),
      );
      res.json({
        account: {
          ...publicAccount(account),
          logo: resolveAccountLogo(account, connectors),
        },
        holdings: repository.listHoldings(account.id, userId),
        ownerships: repository.listOwnerships(account.id, userId),
        snapshots: repository.listSnapshots(account.id, userId),
      });
    }),
  );

  router.post(
    "/accounts",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const name = asString(req.body?.name, { max: 120 });
      if (!name) throw new HttpError(400, "Le nom du compte est requis");
      const type = oneOf(req.body?.type, ACCOUNT_TYPES, "OTHER");
      if (type === "REAL_ESTATE" || type === "LOAN") {
        throw new HttpError(
          400,
          "Les comptes immobiliers et de prêt sont créés depuis les onglets Immobilier et Prêts.",
        );
      }
      const balance = round2(asNumber(req.body?.balance, { min: -1e12, max: 1e12 }));
      const isInvestment = INVESTMENT_TYPES.has(type);
      // Les liquidités d'un compte d'investissement valent 0 par défaut : le
      // solde saisi peut déjà représenter les positions. Sans position, la
      // synthèse utilise de toute façon le solde total.
      const cashBalance = isInvestment
        ? round2(asNumber(req.body?.cash_balance, { fallback: 0 }))
        : asOptionalNumber(req.body?.cash_balance);
      const rawLogo = asOptionalString(req.body?.logo, 500);
      const logo = rawLogo || resolveAccountLogo({ name, provider: PROVIDERS.MANUAL }, null);
      const account = repository.createAccount(userId, {
        provider: PROVIDERS.MANUAL,
        externalId: asOptionalString(req.body?.external_id, 120),
        name,
        type,
        currency: asString(req.body?.currency, { max: 3, fallback: "EUR" }).toUpperCase(),
        balance,
        cashBalance,
        color: asOptionalString(req.body?.color, 20),
        isManual: true,
        metadata: {
          ...(sanitizeAccountMetadata(req.body?.metadata || {}) || {}),
          ...(logo ? { logo } : {}),
        },
      });
      repository.saveSnapshot(userId, account.id, todayIso(), balance, account.currency, "manual");
      res.status(201).json({
        account: {
          ...publicAccount(account),
          logo: resolveAccountLogo(account, null),
        },
      });
    }),
  );

  router.post(
    "/accounts/import-csv",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const accountId = asOptionalString(req.body?.accountId || req.body?.account_id);
      const newAccount = req.body?.newAccount || null;
      const mode = oneOf(req.body?.mode, ["HOLDINGS", "TRANSACTIONS"], "HOLDINGS");
      const items = Array.isArray(req.body?.items) ? req.body.items : [];

      if (!accountId && !newAccount) {
        throw new HttpError(400, "Un identifiant de compte ou les paramètres du nouveau compte sont requis.");
      }
      if (items.length === 0) {
        throw new HttpError(400, "Aucune ligne à importer.");
      }

      const connectors = new Map(
        repository.listConnectors(userId).map((c) => [c.id, c]),
      );
      const result = await executeCsvImport({
        userId,
        repository,
        market,
        accountId,
        newAccount,
        mode,
        items,
        resolveLogo: (acc) => resolveAccountLogo(acc, connectors),
      });

      if (result.account) {
        result.account.logo = resolveAccountLogo(result.account, connectors);
      }

      res.status(201).json(publicSyncResult(result));
    }),
  );

  router.patch(
    "/accounts/:id",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const existing = repository.getAccount(req.params.id, userId);
      if (!existing) throw new HttpError(404, "Compte introuvable");
      const source = managedAccountSource(userId, existing);
      if (source) {
        throw new HttpError(
          409,
          `Ce compte est géré depuis l'onglet ${source}. Modifiez-le depuis sa fiche source.`,
        );
      }
      const patch = {};
      if (req.body.name !== undefined) patch.name = asString(req.body.name, { max: 120 });
      if (req.body.type !== undefined) {
        const nextType = oneOf(req.body.type, ACCOUNT_TYPES, existing.type);
        if (nextType === "REAL_ESTATE" || nextType === "LOAN") {
          throw new HttpError(
            400,
            "Un compte ne peut pas devenir immobilier ou prêt depuis cette page.",
          );
        }
        patch.type = nextType;
        if (
          INVESTMENT_TYPES.has(existing.type) &&
          !INVESTMENT_TYPES.has(nextType) &&
          repository.listHoldings(existing.id, userId).length > 0
        ) {
          throw new HttpError(
            409,
            "Supprimez les positions de ce compte avant de le transformer en compte non investissement.",
          );
        }
      }
      if (req.body.currency !== undefined) {
        patch.currency = asString(req.body.currency, { max: 3, fallback: "EUR" }).toUpperCase();
      }
      if (req.body.balance !== undefined) {
        patch.balance = asNumber(req.body.balance, { min: -1e12, max: 1e12 });
      }
      if (req.body.cash_balance !== undefined) {
        patch.cashBalance = asOptionalNumber(req.body.cash_balance);
      }
      if (req.body.color !== undefined) patch.color = asOptionalString(req.body.color, 20);
      if (req.body.is_archived !== undefined) patch.isArchived = Boolean(req.body.is_archived);
      if (req.body.metadata !== undefined) {
        patch.metadata = sanitizeAccountMetadata(req.body.metadata);
      }
      const account = repository.updateAccount(req.params.id, userId, patch);
      res.json({ account: publicAccount(account) });
    }),
  );

  router.delete(
    "/accounts/:id",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      const source = managedAccountSource(userId, account);
      if (source) {
        throw new HttpError(
          409,
          source === "Immobilier"
            ? "Ce compte est lié à un bien immobilier. Supprimez le bien depuis l'onglet Immobilier."
            : "Ce compte est lié à un prêt. Supprimez le prêt depuis l'onglet Prêts.",
        );
      }
      const deleted = repository.deleteAccount(req.params.id, userId);
      if (!deleted) throw new HttpError(404, "Compte introuvable");
      res.json({ deleted: true });
    }),
  );

  router.post(
    "/accounts/:id/sync",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      if (account.connectionId) {
        const result = await syncService.syncConnection(account.connectionId, userId, { force: true });
        return res.json({
          result: publicSyncResult(result),
          account: publicAccount(repository.getAccount(account.id, userId)),
        });
      }
      if (account.provider === "bourso-sidecar" || account.provider === "bourso") {
        const result = await syncBoursoSidecar({ repository, userId });
        return res.json({
          result: publicSyncResult(result),
          account: publicAccount(repository.getAccount(account.id, userId)),
        });
      }
      if (account.provider === "crypto" || account.type === "CRYPTO") {
        try {
          const result = await syncCryptoAccount(repository, account.id, userId);
          return res.json({
            result: publicSyncResult(result),
            account: publicAccount(repository.getAccount(account.id, userId)),
          });
        } catch (error) {
          if (replyCryptoError(res, error)) return undefined;
          throw error;
        }
      }
      throw new HttpError(400, "Ce compte ne supporte pas la synchronisation directe.");
    }),
  );

  router.get(
    "/transactions",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const accountId = asOptionalString(req.query.account_id, 100);
      let transactions;
      if (accountId) {
        const account = repository.getAccount(accountId, userId);
        if (!account) throw new HttpError(404, "Compte introuvable");
        transactions = repository.listTransactions(account.id, userId, {
          from: asDate(req.query.from),
          to: asDate(req.query.to),
          limit: asOptionalInteger(req.query.limit, { min: 1, max: 10000 }) || 2000,
        });
      } else {
        transactions = repository.listAllTransactions(userId, {
          from: asDate(req.query.from),
          to: asDate(req.query.to),
          limit: asOptionalInteger(req.query.limit, { min: 1, max: 10000 }) || 2000,
        });
      }
      res.json({ transactions });
    }),
  );

  router.get(
    "/accounts/:id/transactions",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      const transactions = repository.listTransactions(account.id, userId, {
        from: asDate(req.query.from),
        to: asDate(req.query.to),
        limit: asOptionalInteger(req.query.limit, { min: 1, max: 20000 }) || 500,
      });
      res.json({ transactions });
    }),
  );

  // Nettoyage explicite des doublons d'autorisations bancaires. Il s'agit
  // d'une écriture : elle n'est jamais déclenchée par un GET. Le même nettoyage
  // est déjà exécuté après une synchronisation BoursoBank.
  router.post(
    "/transactions/cleanup-duplicates",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const accountId = asOptionalString(
        req.body?.account_id || req.body?.accountId,
        100,
      );
      let cleaned = 0;
      if (accountId) {
        const account = repository.getAccount(accountId, userId);
        if (!account) throw new HttpError(404, "Compte introuvable");
        cleaned = repository.cleanAuthorizationDuplicates(account.id, userId);
      } else {
        cleaned = repository.cleanAllAuthorizationDuplicates(userId);
      }
      res.json({ cleaned });
    }),
  );

  router.post(
    "/accounts/:id/transactions",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      const date = asDate(req.body?.date);
      if (!date) throw new HttpError(400, "Date invalide (YYYY-MM-DD attendu)");
      const amount = asNumber(req.body?.amount, { fallback: NaN });
      if (!Number.isFinite(amount)) throw new HttpError(400, "Montant invalide");
      const label = asString(req.body?.label, { max: 255, fallback: "Transaction" });
      const transaction = {
        externalId: asOptionalString(req.body?.external_id, 255),
        date,
        valueDate: asDate(req.body?.value_date),
        amount,
        currency: asString(req.body?.currency, { max: 3, fallback: account.currency }).toUpperCase(),
        label,
        counterparty: asOptionalString(req.body?.counterparty, 255),
        category: asOptionalString(req.body?.category, 120),
        pending: toBool(req.body?.pending),
        notes: asOptionalString(req.body?.notes, 2000),
      };
      transaction.dedupKey = transactionDedupKey(transaction);
      repository.insertTransactions(userId, account.id, PROVIDERS.MANUAL, [transaction]);
      res.status(201).json({ transaction });
    }),
  );

  router.get(
    "/accounts/:id/snapshots",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      res.json({
        snapshots: repository.listSnapshots(account.id, userId, {
          from: asDate(req.query.from),
          to: asDate(req.query.to),
        }),
      });
    }),
  );

  // ─── Holdings ──────────────────────────────────────────────────────────────

  router.get(
    "/accounts/:id/holdings",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      res.json({ holdings: repository.listHoldings(account.id, userId) });
    }),
  );

  router.post(
    "/accounts/:id/holdings",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      if (!INVESTMENT_TYPES.has(account.type)) {
        throw new HttpError(
          409,
          "Ajoutez des positions sur un compte PEA, titres, crypto ou épargne salariale.",
        );
      }

      let isin = asOptionalString(req.body?.isin, 12);
      if (isin) isin = isin.toUpperCase();
      if (isin && !isIsin(isin)) throw new HttpError(400, "ISIN invalide");
      let ticker = asOptionalString(req.body?.ticker, 30);
      if (ticker) ticker = normalizeTicker(ticker);
      let name = asOptionalString(req.body?.name, 160);
      let price = asOptionalNumber(req.body?.price, { min: 0 });
      let currency = asString(req.body?.currency, { max: 3, fallback: "EUR" }).toUpperCase();

      if (isin && !ticker) {
        const resolved = await market.resolveIsin(isin);
        if (!resolved.resolved) {
          throw new HttpError(
            422,
            "ISIN non résolu. Vérifiez l'ISIN ou saisissez directement le ticker Yahoo et un prix.",
          );
        }
        ticker = resolved.ticker;
        name = name || resolved.name;
      }
      if (ticker && price == null) {
        try {
          const quote = await market.getQuote(ticker);
          price = quote.price;
          currency = "EUR";
          name = name || quote.name;
        } catch (error) {
          throw new HttpError(
            422,
            `Cours indisponible pour ${ticker}. Saisissez un prix manuel ou réessayez.`,
            { code: "PRICE_UNAVAILABLE", cause: error.message },
          );
        }
      }
      if (!ticker && !isin) throw new HttpError(400, "ISIN ou ticker requis");

      if (req.body.cash_balance !== undefined) {
        repository.updateAccount(account.id, userId, {
          cashBalance: asOptionalNumber(req.body.cash_balance, { min: 0 }),
        });
      }
      const holding = repository.upsertHolding(userId, account.id, {
        isin,
        ticker,
        name,
        quantity: asNumber(req.body?.quantity, { fallback: 0, min: -1e12, max: 1e12 }),
        costBasis: asOptionalNumber(req.body?.cost_basis, { min: 0 }),
        price,
        currency,
        lastPriceAt: price != null ? nowIso() : null,
      });
      market.recomputeInvestmentAccount(account.id, userId);
      res.status(201).json({
        holding,
        account: publicAccount(repository.getAccount(account.id, userId)),
      });
    }),
  );

  router.delete(
    "/accounts/:id/holdings/:holdingId",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const deleted = repository.deleteHolding(
        req.params.holdingId,
        req.params.id,
        userId,
      );
      if (!deleted) throw new HttpError(404, "Position introuvable");
      market.recomputeInvestmentAccount(req.params.id, userId);
      res.json({ deleted: true });
    }),
  );

  // ─── Parts de propriété ───────────────────────────────────────────────────

  router.get(
    "/accounts/:id/ownership",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const account = repository.getAccount(req.params.id, userId);
      if (!account) throw new HttpError(404, "Compte introuvable");
      res.json({ ownerships: repository.listOwnerships(account.id, userId) });
    }),
  );

  router.put(
    "/accounts/:id/ownership",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const shares = normalizeShares(req.body?.shares);
      const ownerships = repository.replaceOwnerships(req.params.id, userId, shares);
      if (ownerships == null) throw new HttpError(404, "Compte introuvable");
      res.json({ ownerships });
    }),
  );

  // ─── Connexions bancaires ─────────────────────────────────────────────────

  router.get(
    "/connections",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const connections = repository.listConnectors(userId).map((connection) => ({
        ...publicConnection(connection),
        logo: resolveConnectionLogo(connection),
        accountCount: repository
          .listAccounts(userId)
          .filter((account) => account.connectionId === connection.id).length,
      }));
      res.json({
        connections,
        status: integrationStatus(userId),
      });
    }),
  );

  router.get(
    "/connections/status",
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      res.json({ status: integrationStatus(userId) });
    }),
  );

  router.get(
    "/connections/countries",
    asyncHandler(async (req, res) => {
      const countries = await connector.listCountries();
      res.json({ countries });
    }),
  );

  router.get(
    "/connections/institutions",
    asyncHandler(async (req, res) => {
      const institutions = await connector.listInstitutions({
        query: asString(req.query.query, { max: 80 }),
        country: asString(req.query.country, { max: 2, fallback: "FR" }).toUpperCase(),
      });
      res.json({ institutions });
    }),
  );

  router.put(
    "/connections/settings",
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      requireIntegrationAdmin(userId);
      const body = req.body || {};
      const existingConfig = connector.storedConfig() || {};
      const applicationId = asString(body.applicationId, { max: 120 }) || existingConfig.applicationId || "";
      const privateKey = String(body.privateKey || "").trim() || existingConfig.privateKey || "";
      const redirectUri = asString(body.redirectUri, { max: 500 });
      if (!applicationId || !privateKey || !redirectUri) {
        throw new HttpError(
          400,
          "applicationId, privateKey et redirectUri sont requis pour configurer Enable Banking",
        );
      }
      try {
        new URL(redirectUri);
      } catch {
        throw new HttpError(400, "L'URL de retour Enable Banking est invalide");
      }
      if (!privateKey.includes("BEGIN") || !privateKey.includes("PRIVATE KEY")) {
        throw new HttpError(400, "La clé privée doit être au format PEM");
      }
      repository.saveEncryptedIntegration(
        PROVIDERS.ENABLE_BANKING,
        encryptJson({ applicationId, privateKey, redirectUri }),
      );
      connector.invalidateConfig();
      res.json({ status: integrationStatus(userId) });
    }),
  );

  router.delete(
    "/connections/settings",
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      requireIntegrationAdmin(userId);
      repository.deleteIntegration(PROVIDERS.ENABLE_BANKING);
      connector.invalidateConfig();
      res.json({ status: integrationStatus(userId) });
    }),
  );

  router.post(
    "/connections/enable-banking/start",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const institutionId = asString(req.body?.institution_id, { max: 200 });
      if (!institutionId) throw new HttpError(400, "institution_id requis");
      const result = await syncService.beginConnection({
        userId,
        institutionId,
        label: asOptionalString(req.body?.label, 120),
      });
      res.status(201).json({
        ...result,
        connection: publicConnection(result.connection),
      });
    }),
  );

  const callbackHandler = async (req, res) => {
    const wantsJson =
      req.query.format === "json" ||
      String(req.headers.accept || "").includes("application/json");
    const appUrl = (process.env.APP_URL || "https://localhost:5173").replace(/\/+$/, "");
    const redirectBase = `${appUrl}/patrimoine`;
    const parsedState = parseOAuthState(req.query.state);

    console.log("[Enable Banking OAuth Callback] Paramètres reçus :", {
      error: req.query.error,
      error_description: req.query.error_description,
      hasState: Boolean(parsedState),
      hasCode: Boolean(req.query.code),
    });

    if (req.query.error) {
      const message =
        req.query.error_description || req.query.error || "Autorisation refusée";
      if (parsedState) {
        try {
          const pending = repository.findPendingConnectorByState(
            parsedState.state,
            parsedState.userId,
          );
          if (pending) {
            repository.updateConnector(pending.id, parsedState.userId, {
              status: "error",
              lastError: `Échec d'autorisation (${message})`,
            });
          }
        } catch {
          // Tolérance silencieuse
        }
      }
      if (wantsJson) return res.status(400).json({ error: message });
      return res.redirect(
        `${redirectBase}?connection=error&message=${encodeURIComponent(message)}`,
      );
    }

    if (!parsedState) {
      const message = "État OAuth manquant ou invalide";
      if (wantsJson) {
        return res.status(400).json({ error: message, code: "INVALID_STATE" });
      }
      return res.redirect(
        `${redirectBase}?connection=error&message=${encodeURIComponent(message)}`,
      );
    }

    const state = parsedState.state;
    const code = asString(req.query.code, { max: 4000 });
    try {
      const result = await syncService.completeConnection({
        userId: parsedState.userId,
        state,
        code,
      });
      if (wantsJson) return res.json(publicSyncResult(result));
      const status = result.status === "PENDING" ? "pending" : "success";
      return res.redirect(`${redirectBase}?connection=${status}`);
    } catch (error) {
      console.error("[Enable Banking OAuth Callback] Échec de la finalisation :", error);
      if (wantsJson) {
        return res.status(error.status || 500).json({ error: error.message });
      }
      return res.redirect(
        `${redirectBase}?connection=error&message=${encodeURIComponent(error.message)}`,
      );
    }
  };
  router.get("/connections/enable-banking/callback", asyncHandler(callbackHandler));

  router.post(
    "/connections/enable-banking/complete",
    asyncHandler(async (req, res) => {
      const rawUrl = asString(req.body?.callback_url, { max: 4000 });
      if (!rawUrl) throw new HttpError(400, "callback_url requis");
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new HttpError(400, "URL de retour invalide");
      }
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state") || "";
      const error = parsed.searchParams.get("error");
      if (error) {
        throw new HttpError(
          400,
          parsed.searchParams.get("error_description") || error,
        );
      }
      const userId = bodyUserId(req);
      const parsedState = parseOAuthState(state);
      if (!parsedState) {
        throw new HttpError(400, "État OAuth manquant ou invalide");
      }
      if (parsedState.userId !== userId) {
        throw new HttpError(403, "State OAuth associé à un autre profil");
      }
      const result = await syncService.completeConnection({
        userId,
        state: parsedState.state,
        code,
      });
      res.json(publicSyncResult(result));
    }),
  );

  router.post(
    "/connections/sync-all",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const results = await syncService.syncAll(userId, {
        force: toBool(req.body?.force),
      });
      res.json({ results: results.map(publicSyncResult) });
    }),
  );

  router.post(
    "/connections/:id/sync",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const result = await syncService.syncConnection(req.params.id, userId, {
        force: toBool(req.body?.force),
      });
      res.json(publicSyncResult(result));
    }),
  );

  router.get(
    "/connections/:id/runs",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      res.json({
        runs: repository.listSyncRuns(userId, { connectionId: req.params.id }),
      });
    }),
  );

  router.delete(
    "/connections/:id",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      await syncService.disconnect(req.params.id, userId, {
        archiveAccounts: toBool(req.query.archive_accounts),
      });
      res.json({ deleted: true });
    }),
  );

  // ─── Sidecar BoursoBank ───────────────────────────────────────────────────

  router.get(
    "/sidecar/bourso/status",
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      const status = getBoursoStatus(repository, userId);
      res.json(status);
    }),
  );

  router.post(
    "/sidecar/bourso/connect",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const customerId = asOptionalString(req.body?.customerId || req.body?.customer_id);
      const password = asOptionalString(req.body?.password);
      const saveCredentials = toBool(req.body?.saveCredentials ?? req.body?.save_credentials, true);
      const pages = asOptionalInteger(req.body?.pages, 10);
      const connectionId = asOptionalString(req.body?.connectionId || req.body?.connection_id);

      const result = await syncBoursoSidecar({
        repository,
        userId,
        connectionId,
        customerId,
        password,
        pages,
        saveCredentials,
      });

      res.json(publicSyncResult(result));
    }),
  );

  router.post(
    "/sidecar/bourso/sync",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const pages = asOptionalInteger(req.body?.pages, 10);
      const connectionId = asOptionalString(req.body?.connectionId || req.body?.connection_id);

      const result = await syncBoursoSidecar({
        repository,
        userId,
        connectionId,
        pages,
      });

      res.json(publicSyncResult(result));
    }),
  );

  router.delete(
    "/sidecar/bourso/credentials",
    asyncHandler(async (req, res) => {
      const userId = requireSessionUserId(req);
      const deleted = deleteBoursoCredentials(repository, userId);
      res.json({ deleted });
    }),
  );

  // ─── Immobilier ───────────────────────────────────────────────────────────

  router.get(
    "/properties",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      res.json({ properties: repository.listProperties(userId) });
    }),
  );

  router.get(
    "/properties/:id",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const property = repository.getProperty(req.params.id, userId);
      if (!property) throw new HttpError(404, "Bien introuvable");
      res.json({
        property,
        valuations: repository.listValuations(property.id, userId),
      });
    }),
  );

  router.post(
    "/properties",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const name = asString(req.body?.name || req.body?.address, { max: 160 });
      if (!name) throw new HttpError(400, "Le nom du bien est requis");
      const purchasePrice = asOptionalNumber(req.body?.purchase_price, { min: 0 });
      const currentValue =
        asOptionalNumber(req.body?.current_value, { min: 0 }) ??
        purchasePrice ??
        0;

      let property = repository.saveProperty(userId, {
        name,
        address: asOptionalString(req.body?.address, 500),
        postal_code: asOptionalString(req.body?.postal_code, 10),
        city: asOptionalString(req.body?.city, 120),
        country: asString(req.body?.country, { max: 2, fallback: "FR" }).toUpperCase(),
        insee_code: asOptionalString(req.body?.insee_code, 5),
        latitude: asOptionalNumber(req.body?.latitude),
        longitude: asOptionalNumber(req.body?.longitude),
        ban_id: asOptionalString(req.body?.ban_id, 120),
        geocode_score: asOptionalNumber(req.body?.geocode_score),
        property_type: oneOf(req.body?.property_type, ["HOUSE", "APARTMENT", "OTHER"], "APARTMENT"),
        surface_m2: asOptionalNumber(req.body?.surface_m2, { min: 0 }),
        land_m2: asOptionalNumber(req.body?.land_m2, { min: 0 }),
        rooms: asOptionalInteger(req.body?.rooms, { min: 0, max: 50 }),
        bedrooms: asOptionalInteger(req.body?.bedrooms, { min: 0, max: 50 }),
        bathrooms: asOptionalInteger(req.body?.bathrooms, { min: 0, max: 20 }),
        floor_number: asOptionalInteger(req.body?.floor_number, { min: -5, max: 100 }),
        floors_total: asOptionalInteger(req.body?.floors_total, { min: 0, max: 200 }),
        has_elevator: toBool(req.body?.has_elevator),
        has_garden: toBool(req.body?.has_garden),
        has_terrace: toBool(req.body?.has_terrace),
        has_balcony: toBool(req.body?.has_balcony),
        garage_count: asOptionalInteger(req.body?.garage_count, { min: 0, max: 20 }) || 0,
        parking_count: asOptionalInteger(req.body?.parking_count, { min: 0, max: 20 }) || 0,
        construction_year: asOptionalInteger(req.body?.construction_year, {
          min: 1200,
          max: 2200,
        }),
        energy_class: asOptionalString(req.body?.energy_class, 1)?.toUpperCase(),
        purchase_price: purchasePrice,
        purchase_date: asDate(req.body?.purchase_date),
        agency_fees: asOptionalNumber(req.body?.agency_fees, { min: 0 }),
        notary_fees: asOptionalNumber(req.body?.notary_fees, { min: 0 }),
        works_cost: asOptionalNumber(req.body?.works_cost, { min: 0 }),
        rental_income: asOptionalNumber(req.body?.rental_income, { min: 0 }) || 0,
        valuation_mode: currentValue > 0 ? "MANUAL" : "ESTIMATED",
        current_value: currentValue,
        last_valued_at: currentValue > 0 ? todayIso() : null,
      });

      const account = repository.createAccount(userId, {
        provider: PROVIDERS.MANUAL,
        externalId: `property:${property.id}`,
        name: buildPropertyAccountName(property),
        type: "REAL_ESTATE",
        currency: "EUR",
        balance: currentValue,
        isManual: true,
        metadata: { propertyId: property.id, kind: "real-estate" },
      });
      property = repository.saveProperty(userId, {
        id: property.id,
        account_id: account.id,
      });
      repository.saveSnapshot(userId, account.id, todayIso(), currentValue, "EUR", "manual");

      res.status(201).json({ property, account });
    }),
  );

  router.patch(
    "/properties/:id",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const existing = repository.getProperty(req.params.id, userId);
      if (!existing) throw new HttpError(404, "Bien introuvable");
      const patch = { id: existing.id };
      const map = {
        name: ["name", (v) => asString(v, { max: 160 })],
        address: ["address", (v) => asOptionalString(v, 500)],
        postal_code: ["postal_code", (v) => asOptionalString(v, 10)],
        city: ["city", (v) => asOptionalString(v, 120)],
        insee_code: ["insee_code", (v) => asOptionalString(v, 5)],
        property_type: ["property_type", (v) => oneOf(v, ["HOUSE", "APARTMENT", "OTHER"], existing.propertyType)],
        surface_m2: ["surface_m2", (v) => asOptionalNumber(v, { min: 0 })],
        land_m2: ["land_m2", (v) => asOptionalNumber(v, { min: 0 })],
        rooms: ["rooms", (v) => asOptionalInteger(v, { min: 0, max: 50 })],
        bedrooms: ["bedrooms", (v) => asOptionalInteger(v, { min: 0, max: 50 })],
        bathrooms: ["bathrooms", (v) => asOptionalInteger(v, { min: 0, max: 20 })],
        floor_number: ["floor_number", (v) => asOptionalInteger(v, { min: -5, max: 100 })],
        floors_total: ["floors_total", (v) => asOptionalInteger(v, { min: 0, max: 200 })],
        has_elevator: ["has_elevator", (v) => (toBool(v) ? 1 : 0)],
        has_garden: ["has_garden", (v) => (toBool(v) ? 1 : 0)],
        has_terrace: ["has_terrace", (v) => (toBool(v) ? 1 : 0)],
        has_balcony: ["has_balcony", (v) => (toBool(v) ? 1 : 0)],
        garage_count: ["garage_count", (v) => asOptionalInteger(v, { min: 0, max: 20 }) || 0],
        parking_count: ["parking_count", (v) => asOptionalInteger(v, { min: 0, max: 20 }) || 0],
        construction_year: ["construction_year", (v) => asOptionalInteger(v, { min: 1200, max: 2200 })],
        energy_class: ["energy_class", (v) => asOptionalString(v, 1)?.toUpperCase()],
        purchase_price: ["purchase_price", (v) => asOptionalNumber(v, { min: 0 })],
        purchase_date: ["purchase_date", (v) => asDate(v)],
        agency_fees: ["agency_fees", (v) => asOptionalNumber(v, { min: 0 })],
        notary_fees: ["notary_fees", (v) => asOptionalNumber(v, { min: 0 })],
        works_cost: ["works_cost", (v) => asOptionalNumber(v, { min: 0 })],
        rental_income: ["rental_income", (v) => asOptionalNumber(v, { min: 0 }) || 0],
        valuation_mode: ["valuation_mode", (v) => oneOf(v, ["ESTIMATED", "MANUAL"], existing.valuationMode)],
        current_value: [
          "current_value",
          (v) => asOptionalNumber(v, { min: 0 }) ?? existing.currentValue ?? 0,
        ],
      };
      for (const [key, [column, parse]] of Object.entries(map)) {
        if (req.body[key] !== undefined) patch[column] = parse(req.body[key]);
      }
      const addressChanged = ["address", "postal_code", "city"].some(
        (key) => req.body[key] !== undefined,
      );
      if (addressChanged && req.body.insee_code === undefined) {
        Object.assign(patch, {
          insee_code: null,
          latitude: null,
          longitude: null,
          ban_id: null,
          geocode_score: null,
        });
      }
      if (req.body.current_value !== undefined && req.body.valuation_mode === undefined) {
        patch.valuation_mode = "MANUAL";
        patch.last_valued_at = todayIso();
      }
      let property = repository.saveProperty(userId, patch);
      if (existing.accountId) {
        const accountPatch = { name: buildPropertyAccountName(property) };
        if (patch.current_value !== undefined) {
          accountPatch.balance = patch.current_value;
          accountPatch.lastSyncAt = nowIso();
        }
        repository.updateAccount(existing.accountId, userId, accountPatch);
        if (patch.current_value !== undefined) {
          repository.saveSnapshot(
            userId,
            existing.accountId,
            todayIso(),
            patch.current_value,
            "EUR",
            "manual",
          );
        }
      }
      res.json({ property });
    }),
  );

  router.delete(
    "/properties/:id",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      if (!repository.deleteProperty(req.params.id, userId)) {
        throw new HttpError(404, "Bien introuvable");
      }
      res.json({ deleted: true });
    }),
  );

  router.post(
    "/properties/:id/geocode",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const property = await realEstate.geocodeProperty(req.params.id, userId);
      res.json({ property });
    }),
  );

  router.post(
    "/properties/:id/valuate",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      if (req.body?.mode === "manual") {
        const value = asOptionalNumber(req.body?.value, { min: 0 });
        if (value == null) throw new HttpError(400, "Valeur manuelle requise");
        const result = realEstate.valuateManually(req.params.id, userId, {
          value,
          date: new Date(),
        });
        return res.json(result);
      }
      const result = await realEstate.valuateProperty(req.params.id, userId);
      res.json(result);
    }),
  );

  router.get(
    "/properties/:id/valuations",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const property = repository.getProperty(req.params.id, userId);
      if (!property) throw new HttpError(404, "Bien introuvable");
      res.json({ valuations: repository.listValuations(property.id, userId) });
    }),
  );

  // ─── Prêts ────────────────────────────────────────────────────────────────

  router.get(
    "/loans",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      res.json({ loans: repository.listLoans(userId) });
    }),
  );

  router.post(
    "/loans",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const principal = asNumber(req.body?.principal, { fallback: NaN, min: 0 });
      if (!Number.isFinite(principal) || principal <= 0) {
        throw new HttpError(400, "Capital emprunté invalide");
      }
      const startDate = asDate(req.body?.start_date);
      if (!startDate) throw new HttpError(400, "Date de début requise");
      const endDate = asDate(req.body?.end_date);
      const termMonths = asOptionalInteger(req.body?.term_months, { min: 1, max: 600 });
      if (!endDate && !termMonths) {
        throw new HttpError(400, "Durée (term_months) ou date de fin requise");
      }
      const loanInput = {
        name: asString(req.body?.name, { max: 160, fallback: "Prêt" }),
        lender: asOptionalString(req.body?.lender, 120),
        principal: round2(principal),
        annualRate: asNumber(req.body?.annual_rate, { fallback: 0, min: 0, max: 30 }),
        startDate,
        endDate,
        termMonths,
        monthlyPayment: asOptionalNumber(req.body?.monthly_payment, { min: 0 }),
        insuranceMonthly: asNumber(req.body?.insurance_monthly, { fallback: 0, min: 0 }),
        fileFees: asNumber(req.body?.file_fees, { fallback: 0, min: 0 }),
      };
      const { summary } = buildAmortizationSchedule(loanInput);

      let loan = repository.saveLoan(userId, {
        name: loanInput.name,
        lender: loanInput.lender,
        principal: loanInput.principal,
        annual_rate: loanInput.annualRate,
        start_date: loanInput.startDate,
        end_date: loanInput.endDate,
        term_months: loanInput.termMonths,
        monthly_payment: loanInput.monthlyPayment,
        insurance_monthly: loanInput.insuranceMonthly,
        file_fees: loanInput.fileFees,
        property_id: asOptionalString(req.body?.property_id, 64),
        metadata: req.body?.metadata || {},
      });

      const account = repository.createAccount(userId, {
        provider: PROVIDERS.MANUAL,
        externalId: `loan:${loan.id}`,
        name: loan.name,
        type: "LOAN",
        currency: "EUR",
        balance: -summary.remainingBalance,
        isManual: true,
        metadata: { loanId: loan.id, kind: "loan" },
      });
      loan = repository.saveLoan(userId, { id: loan.id, account_id: account.id });
      repository.saveSnapshot(
        userId,
        account.id,
        todayIso(),
        -summary.remainingBalance,
        "EUR",
        "manual",
      );

      res.status(201).json({ loan, account, summary });
    }),
  );

  router.patch(
    "/loans/:id",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const existing = repository.getLoan(req.params.id, userId);
      if (!existing) throw new HttpError(404, "Prêt introuvable");

      const patch = { id: existing.id };
      const numericFields = {
        principal: "principal",
        annual_rate: "annual_rate",
        insurance_monthly: "insurance_monthly",
        file_fees: "file_fees",
        monthly_payment: "monthly_payment",
      };
      for (const [key, column] of Object.entries(numericFields)) {
        if (req.body[key] === undefined) continue;
        patch[column] = asOptionalNumber(req.body[key], { min: 0 });
      }
      if (req.body.name !== undefined) patch.name = asString(req.body.name, { max: 160 });
      if (req.body.lender !== undefined) patch.lender = asOptionalString(req.body.lender, 120);
      if (req.body.start_date !== undefined) patch.start_date = asDate(req.body.start_date);
      if (req.body.end_date !== undefined) patch.end_date = asDate(req.body.end_date);
      if (req.body.term_months !== undefined) {
        patch.term_months = asOptionalInteger(req.body.term_months, { min: 1, max: 600 });
      }
      if (req.body.property_id !== undefined) {
        patch.property_id = asOptionalString(req.body.property_id, 64);
      }
      if (req.body.metadata !== undefined) patch.metadata_json = JSON.stringify(req.body.metadata);

      let loan = repository.saveLoan(userId, patch);
      try {
        syncLoanAccount(repository, loan, userId);
        loan = repository.getLoan(loan.id, userId);
        if (loan.accountId) {
          repository.updateAccount(loan.accountId, userId, { name: loan.name });
        }
      } catch {
        // Les champs incomplets sont signalés par GET /loans/:id/schedule.
      }
      res.json({ loan });
    }),
  );

  router.delete(
    "/loans/:id",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      if (!repository.deleteLoan(req.params.id, userId)) {
        throw new HttpError(404, "Prêt introuvable");
      }
      res.json({ deleted: true });
    }),
  );

  router.get(
    "/loans/:id/schedule",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const loan = repository.getLoan(req.params.id, userId);
      if (!loan) throw new HttpError(404, "Prêt introuvable");
      const asOf = asDate(req.query.as_of);
      const date = asOf ? new Date(`${asOf}T00:00:00Z`) : new Date();
      const schedule = buildAmortizationSchedule(loan, date);
      res.json(schedule);
    }),
  );

  // ─── Marché ───────────────────────────────────────────────────────────────

  router.get(
    "/market/indices",
    asyncHandler(async (req, res) => {
      const defaultTickers = [
        "^FCHI", // CAC 40
        "^GSPC", // S&P 500
        "^IXIC", // Nasdaq Composite
        "^STOXX50E", // Euro Stoxx 50
        "BTC-EUR", // Bitcoin
        "ETH-EUR", // Ethereum
        "GC=F", // Or (Gold)
        "BZ=F", // Pétrole Brent
      ];
      const customParam = req.query.tickers;
      const tickers = customParam
        ? String(customParam).split(",").map((t) => t.trim()).filter(Boolean)
        : defaultTickers;
      const quotes = await market.getQuotes(tickers, {
        force: toBool(req.query.force),
        concurrency: 4,
      });
      res.json({ quotes });
    }),
  );

  router.get(
    "/market/quote",
    asyncHandler(async (req, res) => {
      const ticker = asString(req.query.ticker, { max: 30 });
      if (!ticker) throw new HttpError(400, "ticker requis");
      const quote = await market.getQuote(ticker, {
        force: toBool(req.query.force),
      });
      res.json({ quote });
    }),
  );

  router.get(
    "/market/search",
    asyncHandler(async (req, res) => {
      const query = asString(req.query.q, { max: 80 });
      if (!query) throw new HttpError(400, "q requis");
      res.json({ results: await market.search(query) });
    }),
  );

  router.get(
    "/market/resolve-isin",
    asyncHandler(async (req, res) => {
      const isin = asString(req.query.isin, { max: 12 });
      if (!isin) throw new HttpError(400, "isin requis");
      res.json({ security: await market.resolveIsin(isin) });
    }),
  );

  router.get(
    "/market/holdings",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const accounts = new Map(
        repository.listAccounts(userId).map((account) => [account.id, account]),
      );
      const holdings = repository
        .listAllHoldings(userId)
        .filter((holding) => accounts.has(holding.accountId))
        .map((holding) => ({
          ...holding,
          accountName: accounts.get(holding.accountId)?.name || null,
          accountType: accounts.get(holding.accountId)?.type || null,
          value: round2((holding.quantity || 0) * (holding.price || 0)),
        }));
      res.json({ holdings });
    }),
  );

  router.get(
    "/market/etf-breakdown",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const accounts = new Map(
        repository.listAccounts(userId).map((account) => [account.id, account]),
      );
      const holdings = repository
        .listAllHoldings(userId)
        .filter((holding) => accounts.has(holding.accountId))
        .map((holding) => ({
          ...holding,
          accountName: accounts.get(holding.accountId)?.name || null,
          accountType: accounts.get(holding.accountId)?.type || null,
          value: round2((holding.quantity || 0) * (holding.price || 0)),
        }));
      const breakdown = computePortfolioEtfBreakdown(holdings);
      res.json(breakdown);
    }),
  );

  router.get(
    "/market/etf-catalog",
    asyncHandler(async (_req, res) => {
      res.json({ catalog: Object.values(ETF_CATALOG) });
    }),
  );

  router.get(
    "/market/etf-profile",
    asyncHandler(async (req, res) => {
      const query = asString(req.query.query, { max: 120 });
      const profile = resolveHoldingProfile({ isin: query, ticker: query, name: query });
      res.json({ profile });
    }),
  );

  router.post(
    "/market/refresh",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const accountId = asOptionalString(req.body?.accountId || req.body?.account_id);
      const result = await market.refreshHoldings(userId, {
        force: toBool(req.body?.force, true),
        accountId,
      });
      res.json(result);
    }),
  );

  // ─── Crypto (Wallets on-chain, CEX Binance, Manuel) ───────────────────────

  router.get(
    "/crypto/accounts",
    asyncHandler(async (req, res) => {
      const userId = queryUserId(req);
      const accounts = repository
        .listAccounts(userId)
        .filter((a) => a.type === "CRYPTO");
      const populated = accounts.map((account) => {
        const holdings = repository.listHoldings(account.id, userId);
        return {
          ...publicAccount(account),
          holdings,
        };
      });
      res.json({ accounts: populated });
    }),
  );

  router.post(
    "/crypto/accounts",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const name = asString(req.body?.name, { max: 120 });
      if (!name) throw new HttpError(400, "Le nom du compte crypto est requis");
      const provider = asString(req.body?.provider, { max: 40, fallback: "manual" }).toLowerCase();
      const metadata = sanitizeAccountMetadata(req.body?.metadata || {}) || {};

      if (provider === "binance") {
        // Les clés Binance vivent uniquement dans le coffre chiffré. Le corps
        // de la requête n'est accepté que pour migrer un ancien client.
        const bodyApiKey = asString(req.body?.apiKey, { max: 200 });
        const bodyApiSecret = asString(req.body?.apiSecret, { max: 200 });
        let apiKey = getUserSecret(db, userId, "binanceApiKey");
        let apiSecret = getUserSecret(db, userId, "binanceSecretKey");
        if (bodyApiKey && bodyApiSecret && (!apiKey || !apiSecret)) {
          setUserSecret(db, userId, "binanceApiKey", bodyApiKey);
          setUserSecret(db, userId, "binanceSecretKey", bodyApiSecret);
          apiKey = bodyApiKey;
          apiSecret = bodyApiSecret;
        }
        if (!apiKey || !apiSecret) {
          throw new HttpError(
            400,
            "Clés API Binance non configurées. Renseignez-les dans les paramètres.",
          );
        }
        delete metadata.credentialsEncrypted;
        delete metadata.apiKeyMasked;
        delete metadata.apiKey;
        delete metadata.apiSecret;
        metadata.binanceConfigured = true;
      } else if (["evm", "bitcoin", "solana", "hyperliquid", "aptos"].includes(provider)) {
        const address = asString(req.body?.address, { max: 200 });
        if (!address) throw new HttpError(400, "L'adresse du wallet est requise");
        metadata.address = address;
      }

      const account = repository.createAccount(userId, {
        provider,
        name,
        type: "CRYPTO",
        currency: "EUR",
        balance: 0,
        cashBalance: 0,
        color: asOptionalString(req.body?.color, 20) || "#f59e0b",
        isManual: provider === "manual",
        metadata,
      });

      if (provider === "manual" && Array.isArray(req.body?.holdings)) {
        for (const h of req.body.holdings) {
          if (h.ticker && Number(h.quantity) > 0) {
            repository.upsertHolding(userId, account.id, {
              ticker: h.ticker.toUpperCase(),
              name: h.name || h.ticker.toUpperCase(),
              quantity: Number(h.quantity),
              price: Number(h.price) || 0,
              currency: "EUR",
              lastPriceAt: nowIso(),
            });
          }
        }
      }

      let syncResult;
      try {
        syncResult = await syncCryptoAccount(repository, account.id, userId);
      } catch (error) {
        // La création est atomique du point de vue de l'utilisateur : si la
        // première synchronisation échoue, le compte vide est retiré et
        // l'erreur est remontée (502 pour une erreur de fournisseur).
        repository.deleteAccount(account.id, userId);
        if (replyCryptoError(res, error)) return undefined;
        throw error;
      }

      res.status(201).json(publicSyncResult(syncResult));
    }),
  );

  router.post(
    "/crypto/sync/:id",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      try {
        const result = await syncCryptoAccount(repository, req.params.id, userId);
        return res.json(publicSyncResult(result));
      } catch (error) {
        if (replyCryptoError(res, error)) return undefined;
        throw error;
      }
    }),
  );

  router.post(
    "/crypto/sync-all",
    asyncHandler(async (req, res) => {
      const userId = bodyUserId(req);
      const result = await syncAllCryptoAccounts(repository, userId);
      res.json(publicSyncResult(result));
    }),
  );

  // ─── Taux de change (FX) ───────────────────────────────────────────────────

  router.get(
    "/fx/rates",
    asyncHandler(async (req, res) => {
      let eur_usd = 1.08;
      let source = "fallback";
      try {
        const resp = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", {
          signal: AbortSignal.timeout(4000),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.rates?.USD && Number.isFinite(Number(data.rates.USD))) {
            eur_usd = Number(data.rates.USD);
            source = "ecb_frankfurter";
          }
        }
      } catch (err) {
        try {
          const bResp = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT", {
            signal: AbortSignal.timeout(4000),
          });
          if (bResp.ok) {
            const bData = await bResp.json();
            if (bData?.price && Number.isFinite(Number(bData.price))) {
              eur_usd = Number(bData.price);
              source = "binance_eurusdt";
            }
          }
        } catch (_) {}
      }
      res.json({
        base: "EUR",
        target: "USD",
        eur_usd,
        usd_eur: round2(1 / eur_usd),
        source,
        timestamp: Date.now(),
      });
    }),
  );

  // ─── Gestion d'erreurs du routeur ─────────────────────────────────────────

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error.status ||
      (error instanceof ConnectorError ||
      error instanceof ValuationError ||
      error instanceof LoanError ||
      error instanceof OwnershipError ||
      error instanceof CryptoFetchError
        ? error.status
        : 500);
    if (status >= 500) {
      console.error("[portfolio]", error.message);
    }
    res.status(status).json({
      error: error.message || "Erreur interne",
      code: error.code || "INTERNAL_ERROR",
      ...(error.details ? { details: error.details } : {}),
    });
  });

  return router;
}

export default createPortfolioRouter;
