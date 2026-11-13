// Sessions serveur signées (HMAC-SHA256) pour l'authentification par profil.
//
// Le cookie est HttpOnly + SameSite=Lax : il n'est jamais lisible par le
// JavaScript du navigateur et ne peut pas être envoyé par un POST cross-site.
// Le jeton est volontairement stateless (pas de table de sessions) : la clé
// de signature est stockée dans data/.portfolio-session-secret (0600) ou
// fournie via PORTFOLIO_SESSION_SECRET.

import crypto from "crypto";
import fs from "fs";
import path from "path";

const COOKIE_NAME = "portfolio_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_FILE = path.join(process.cwd(), "data", ".portfolio-session-secret");

let cachedKey = null;

const deriveKey = (raw) => crypto.createHash("sha256").update(String(raw)).digest();

const loadKey = () => {
  if (cachedKey) return cachedKey;
  if (process.env.PORTFOLIO_SESSION_SECRET) {
    cachedKey = deriveKey(process.env.PORTFOLIO_SESSION_SECRET);
    return cachedKey;
  }
  try {
    if (fs.existsSync(KEY_FILE)) {
      const stored = fs.readFileSync(KEY_FILE, "utf8").trim();
      if (stored) {
        try {
          fs.chmodSync(KEY_FILE, 0o600);
        } catch {}
        cachedKey = deriveKey(stored);
        return cachedKey;
      }
    }
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(KEY_FILE, generated, { mode: 0o600 });
    try {
      fs.chmodSync(KEY_FILE, 0o600);
    } catch {}
    cachedKey = deriveKey(generated);
    return cachedKey;
  } catch (error) {
    throw new Error(
      `Impossible de charger la clé de session (${error.message}). ` +
        "Définissez PORTFOLIO_SESSION_SECRET.",
    );
  }
};

const base64url = (value) => Buffer.from(value).toString("base64url");

const sign = (body) =>
  crypto.createHmac("sha256", loadKey()).update(body).digest("base64url");

export const createSessionToken = (
  username,
  sessionVersion = 1,
  ttlMs = SESSION_TTL_MS,
) => {
  const clean = String(username || "").trim();
  if (!USERNAME_RE.test(clean)) throw new Error("Nom d'utilisateur invalide");
  const now = Date.now();
  const payload = {
    v: 1,
    u: clean,
    sv: Math.max(1, Number(sessionVersion) || 1),
    iat: now,
    exp: now + Math.max(60_000, Number(ttlMs) || SESSION_TTL_MS),
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
};

export const verifySessionToken = (token) => {
  if (typeof token !== "string") return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!body || !signature) return null;

  let expected;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  const providedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      !payload ||
      payload.v !== 1 ||
      !USERNAME_RE.test(String(payload.u || "")) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const parseCookies = (header) => {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[key] = part.slice(index + 1).trim();
    }
  }
  return cookies;
};

export const getSessionUser = (req) => {
  try {
    const token = parseCookies(req?.headers?.cookie)[COOKIE_NAME];
    const payload = verifySessionToken(token);
    if (!payload?.u) return null;
    return {
      username: payload.u,
      sessionVersion: Math.max(1, Number(payload.sv) || 1),
    };
  } catch {
    return null;
  }
};

export const setSessionCookie = (req, res, username, sessionVersion = 1) => {
  const token = createSessionToken(username, sessionVersion);
  const secure =
    process.env.NODE_ENV === "production" || Boolean(req?.secure);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
};

export const clearSessionCookie = (req, res) => {
  const secure =
    process.env.NODE_ENV === "production" || Boolean(req?.secure);
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
  });
};

export const requireSession = (req, res, next) => {
  // Le middleware amont peut avoir invalidé la session (profil supprimé) en
  // positionnant explicitement req.sessionUser à null.
  const session = Object.prototype.hasOwnProperty.call(req, "sessionUser")
    ? { username: req.sessionUser }
    : getSessionUser(req);
  const username = session?.username;
  if (!username) {
    return res.status(401).json({
      error: "Authentification requise",
      code: "AUTH_REQUIRED",
    });
  }
  req.sessionUser = username;
  return next();
};

const requestedUserIds = (req) =>
  [
    req.query?.user_id,
    req.query?.userId,
    req.body?.user_id,
    req.body?.userId,
  ].filter(
    (value) => value != null && String(value).trim() !== "",
  );

const requestedUserId = (req) => requestedUserIds(req)[0];

/**
 * Refuse toute requête qui tente d'agir sur un autre profil que celui de la
 * session. C'est une défense en profondeur : les routes utilisent ensuite
 * req.sessionUser comme source de vérité.
 */
export const rejectUserMismatch = (req, res, next) => {
  if (!req.sessionUser) return next();
  for (const requested of requestedUserIds(req)) {
    const candidate = String(requested).trim();
    // Une valeur syntaxiquement invalide doit produire un 400 métier, pas un
    // 403 : elle ne peut de toute façon désigner aucun profil existant.
    if (!USERNAME_RE.test(candidate)) continue;
    if (candidate !== req.sessionUser) {
      return res.status(403).json({
        error: "Accès interdit à ce profil",
        code: "USER_MISMATCH",
      });
    }
  }
  return next();
};

/**
 * Résout l'utilisateur effectif d'une requête : la session prime toujours.
 * La valeur fournie par le client n'est acceptée que si elle est syntaxiquement
 * valide et identique à la session (le middleware ci-dessus renvoie déjà 403
 * en cas de divergence).
 */
export const resolveRequestUserId = (req, value) => {
  const raw = value ?? requestedUserId(req);
  if (raw == null || String(raw).trim() === "") {
    return req.sessionUser || null;
  }
  const candidate = String(raw).trim();
  if (!USERNAME_RE.test(candidate)) return null;
  if (req.sessionUser && candidate !== req.sessionUser) return null;
  return req.sessionUser || candidate;
};

export const sessionCookieName = COOKIE_NAME;
