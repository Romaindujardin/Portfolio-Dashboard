// Service d'authentification et de gestion sécurisée des mots de passe.
// Inspiré des meilleures pratiques de sécurité de Picsou :
// - Hashage scrypt avec sel aléatoire unique (16 octets)
// - Égalisation du timing contre l'énumération d'utilisateurs (GHSA-ww5m-pxgq-8qq6)
// - Comparaison timing-safe (crypto.timingSafeEqual)
// - Support du multi-utilisateur (un mot de passe par profil)

import crypto from "crypto";
import { nowIso } from "../lib/validate.js";

// Paramètres scrypt recommandés pour une protection mémoire/CPU robuste
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password, salt) {
  if (typeof password !== "string" || !password) {
    throw new Error("Mot de passe invalide");
  }
  return crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
    .toString("hex");
}

export function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

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
  if (!username) return false;
  const row = db
    .prepare("SELECT 1 FROM user_credentials WHERE username = ?")
    .get(username);
  return Boolean(row);
}

/**
 * Récupère les identifiants d'un profil.
 */
export function getUserCredential(db, username) {
  if (!username) return null;
  return (
    db
      .prepare(
        "SELECT username, password_hash, salt, created_at, updated_at FROM user_credentials WHERE username = ?",
      )
      .get(username) || null
  );
}

/**
 * Définit le mot de passe initial d'un profil.
 */
export function setUserPassword(db, username, password) {
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername) {
    throw new Error("Nom d'utilisateur requis");
  }
  if (typeof password !== "string" || password.length < 4) {
    throw new Error("Le mot de passe doit comporter au moins 4 caractères");
  }

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
    `INSERT INTO user_credentials (username, password_hash, salt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(cleanUsername, passwordHash, salt, now, now);

  return { success: true, username: cleanUsername };
}

/**
 * Vérifie le mot de passe d'un profil de manière timing-safe et égale.
 */
export function verifyUserPassword(db, username, password) {
  const cleanUsername = String(username || "").trim();
  const cred = getUserCredential(db, cleanUsername);

  if (!cred) {
    // L'utilisateur n'existe pas : on exécute quand même le scrypt factice
    // pour que la durée d'exécution soit exactement identique (timing equalization)
    const testHash = hashPassword(password || "", DUMMY_SALT);
    compareTimingSafe(testHash, DUMMY_HASH);
    return false;
  }

  const testHash = hashPassword(password || "", cred.salt);
  return compareTimingSafe(testHash, cred.password_hash);
}

/**
 * Modifie le mot de passe d'un profil existant (avec validation de l'ancien mot de passe).
 */
export function changeUserPassword(db, username, currentPassword, newPassword) {
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername) {
    throw new Error("Nom d'utilisateur requis");
  }

  const cred = getUserCredential(db, cleanUsername);
  if (!cred) {
    throw new Error("Utilisateur non trouvé");
  }

  // Vérifier l'ancien mot de passe
  const isValid = verifyUserPassword(db, cleanUsername, currentPassword);
  if (!isValid) {
    throw new Error("Le mot de passe actuel est incorrect");
  }

  if (typeof newPassword !== "string" || newPassword.length < 4) {
    throw new Error("Le nouveau mot de passe doit comporter au moins 4 caractères");
  }

  const newSalt = generateSalt();
  const newHash = hashPassword(newPassword, newSalt);
  const now = nowIso();

  db.prepare(
    `UPDATE user_credentials
     SET password_hash = ?, salt = ?, updated_at = ?
     WHERE username = ?`,
  ).run(newHash, newSalt, now, cleanUsername);

  return { success: true, message: "Mot de passe mis à jour avec succès" };
}

/**
 * Supprime les identifiants d'un utilisateur (par ex. lors de la suppression du profil).
 */
export function deleteUserCredential(db, username) {
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername) return;
  db.prepare("DELETE FROM user_credentials WHERE username = ?").run(cleanUsername);
}
