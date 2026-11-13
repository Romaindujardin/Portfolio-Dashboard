// Service d'authentification et de gestion sécurisée des mots de passe.
// Inspiré des meilleures pratiques de sécurité de Picsou :
// - Hashage scrypt avec sel aléatoire unique (16 octets)
// - Égalisation du timing contre l'énumération d'utilisateurs (GHSA-ww5m-pxgq-8qq6)
// - Comparaison timing-safe (crypto.timingSafeEqual)
// - Support du multi-utilisateur (un mot de passe par profil)

import crypto from "crypto";
import { promisify } from "util";
import { nowIso } from "../lib/validate.js";

// Paramètres scrypt recommandés pour une protection mémoire/CPU robuste
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const USERNAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

const scryptAsync = promisify(crypto.scrypt);

export const validateUsername = (username) => {
  const clean = String(username || "").trim();
  if (!USERNAME_RE.test(clean)) {
    throw new Error("Nom d'utilisateur invalide");
  }
  return clean;
};

export const validatePassword = (password) => {
  if (typeof password !== "string") {
    throw new Error("Mot de passe invalide");
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `Le mot de passe doit comporter au moins ${PASSWORD_MIN_LENGTH} caractères`,
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères`,
    );
  }
  return password;
};

export function hashPassword(password, salt) {
  if (typeof password !== "string") {
    throw new Error("Mot de passe invalide");
  }
  return crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
    .toString("hex");
}

export async function hashPasswordAsync(password, salt) {
  if (typeof password !== "string") {
    throw new Error("Mot de passe invalide");
  }
  const derived = await scryptAsync(
    password,
    salt,
    SCRYPT_KEYLEN,
    SCRYPT_OPTIONS,
  );
  return Buffer.from(derived).toString("hex");
}

export function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

// Époque de session aléatoire : même si un profil est supprimé puis recréé
// avec le même nom, un ancien jeton (dont le claim `sv` valait 1) ne peut pas
// redevenir valide.
const generateSessionVersion = () => crypto.randomInt(2, 2 ** 31);

export function compareTimingSafe(testHex, storedHex) {
  if (!testHex || !storedHex || testHex.length !== storedHex.length) {
    return false;
  }
  const testBuf = Buffer.from(testHex, "hex");
  const storedBuf = Buffer.from(storedHex, "hex");
  return crypto.timingSafeEqual(testBuf, storedBuf);
}

// Sel et hash factices précalculés au démarrage pour égaliser le temps de réponse
// en cas d'utilisateur inconnu (défense timing attack / énumération)
const DUMMY_SALT = generateSalt();
const DUMMY_HASH = hashPassword("login-timing-equalizer", DUMMY_SALT);

/**
 * Vérifie si un profil a déjà configuré un mot de passe.
 */
export function hasUserPassword(db, username) {
  const clean = String(username || "").trim();
  if (!USERNAME_RE.test(clean)) return false;
  const row = db
    .prepare("SELECT 1 FROM user_credentials WHERE username = ?")
    .get(clean);
  return Boolean(row);
}

/**
 * Récupère les identifiants d'un profil.
 */
export function getUserCredential(db, username) {
  const clean = String(username || "").trim();
  if (!USERNAME_RE.test(clean)) return null;
  return (
    db
      .prepare(
        "SELECT username, password_hash, salt, session_version, created_at, updated_at FROM user_credentials WHERE username = ?",
      )
      .get(clean) || null
  );
}

/**
 * Définit le mot de passe initial d'un profil.
 */
export function setUserPassword(db, username, password) {
  const cleanUsername = validateUsername(username);
  validatePassword(password);

  const existing = getUserCredential(db, cleanUsername);
  if (existing) {
    throw new Error(
      "Un mot de passe est déjà configuré pour cet utilisateur. Utilisez la modification de mot de passe.",
    );
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  const now = nowIso();

  db.prepare(
    `INSERT INTO user_credentials (username, password_hash, salt, session_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(cleanUsername, passwordHash, salt, generateSessionVersion(), now, now);

  return { success: true, username: cleanUsername };
}

/**
 * Vérifie le mot de passe d'un profil de manière timing-safe et égale.
 */
export function verifyUserPassword(db, username, password) {
  const cleanUsername = String(username || "").trim();
  const cred = getUserCredential(db, cleanUsername);
  const candidate = typeof password === "string" ? password : "";

  // Une valeur démesurée ne doit pas pouvoir consommer impunément du scrypt.
  if (candidate.length > PASSWORD_MAX_LENGTH) {
    compareTimingSafe(hashPassword("invalid-too-long", DUMMY_SALT), DUMMY_HASH);
    return false;
  }

  if (!cred) {
    // L'utilisateur n'existe pas : on exécute quand même le scrypt factice
    // pour que la durée d'exécution soit exactement identique (timing equalization)
    const testHash = hashPassword(candidate, DUMMY_SALT);
    compareTimingSafe(testHash, DUMMY_HASH);
    return false;
  }

  const testHash = hashPassword(candidate, cred.salt);
  return compareTimingSafe(testHash, cred.password_hash);
}

/**
 * Modifie le mot de passe d'un profil existant (avec validation de l'ancien mot de passe).
 */
export function changeUserPassword(db, username, currentPassword, newPassword) {
  const cleanUsername = validateUsername(username);

  const cred = getUserCredential(db, cleanUsername);
  if (!cred) {
    throw new Error("Utilisateur non trouvé");
  }

  // Vérifier l'ancien mot de passe
  const isValid = verifyUserPassword(db, cleanUsername, currentPassword);
  if (!isValid) {
    throw new Error("Le mot de passe actuel est incorrect");
  }

  validatePassword(newPassword);

  const newSalt = generateSalt();
  const newHash = hashPassword(newPassword, newSalt);
  const now = nowIso();

  db.prepare(
    `UPDATE user_credentials
     SET password_hash = ?, salt = ?, updated_at = ?,
         session_version = session_version + 1
     WHERE username = ?`,
  ).run(newHash, newSalt, now, cleanUsername);

  const updated = getUserCredential(db, cleanUsername);
  return {
    success: true,
    message: "Mot de passe mis à jour avec succès",
    sessionVersion: Number(updated?.session_version) || 2,
  };
}

/**
 * Supprime les identifiants d'un utilisateur (par ex. lors de la suppression du profil).
 */
export function deleteUserCredential(db, username) {
  const cleanUsername = String(username || "").trim();
  if (!USERNAME_RE.test(cleanUsername)) return;
  db.prepare("DELETE FROM user_credentials WHERE username = ?").run(cleanUsername);
}

// ─── Variantes asynchrones (ne bloquent pas l'event loop) ───────────────────

export async function setUserPasswordAsync(db, username, password) {
  const cleanUsername = validateUsername(username);
  validatePassword(password);

  const existing = getUserCredential(db, cleanUsername);
  if (existing) {
    throw new Error(
      "Un mot de passe est déjà configuré pour cet utilisateur. Utilisez la modification de mot de passe.",
    );
  }

  const salt = generateSalt();
  const passwordHash = await hashPasswordAsync(password, salt);
  const now = nowIso();
  db.prepare(
    `INSERT INTO user_credentials (username, password_hash, salt, session_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    cleanUsername,
    passwordHash,
    salt,
    generateSessionVersion(),
    now,
    now,
  );
  return { success: true, username: cleanUsername };
}

export async function verifyUserPasswordAsync(db, username, password) {
  const cleanUsername = String(username || "").trim();
  const cred = getUserCredential(db, cleanUsername);
  const candidate = typeof password === "string" ? password : "";

  if (candidate.length > PASSWORD_MAX_LENGTH) {
    compareTimingSafe(
      await hashPasswordAsync("invalid-too-long", DUMMY_SALT),
      DUMMY_HASH,
    );
    return false;
  }

  if (!cred) {
    const testHash = await hashPasswordAsync(candidate, DUMMY_SALT);
    compareTimingSafe(testHash, DUMMY_HASH);
    return false;
  }

  const testHash = await hashPasswordAsync(candidate, cred.salt);
  return compareTimingSafe(testHash, cred.password_hash);
}

export async function changeUserPasswordAsync(
  db,
  username,
  currentPassword,
  newPassword,
) {
  const cleanUsername = validateUsername(username);

  const cred = getUserCredential(db, cleanUsername);
  if (!cred) throw new Error("Utilisateur non trouvé");

  const isValid = await verifyUserPasswordAsync(
    db,
    cleanUsername,
    currentPassword,
  );
  if (!isValid) throw new Error("Le mot de passe actuel est incorrect");

  validatePassword(newPassword);

  const newSalt = generateSalt();
  const newHash = await hashPasswordAsync(newPassword, newSalt);
  const now = nowIso();
  db.prepare(
    `UPDATE user_credentials
     SET password_hash = ?, salt = ?, updated_at = ?,
         session_version = session_version + 1
     WHERE username = ?`,
  ).run(newHash, newSalt, now, cleanUsername);
  const updated = getUserCredential(db, cleanUsername);
  return {
    success: true,
    message: "Mot de passe mis à jour avec succès",
    sessionVersion: Number(updated?.session_version) || 2,
  };
}
