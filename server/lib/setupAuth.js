// Protection de la création de profil (/auth/setup).
//
// Sans jeton, un visiteur pourrait revendiquer le profil « Romain » avant son
// propriétaire et obtenir une session sur ses données. En production, la
// création de profil est donc fermée par défaut : il faut définir
// AUTH_SETUP_TOKEN (ou pré-créer les identifiants au déploiement).
//
// En développement local (NODE_ENV !== "production"), l'absence de jeton reste
// tolérée pour ne pas gêner le premier lancement.

import crypto from "crypto";

export const SETUP_TOKEN_MIN_LENGTH = 16;

const normalizeToken = (value) => String(value || "").trim();

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveSetupAuth(env = process.env) {
  const token = normalizeToken(env.AUTH_SETUP_TOKEN);
  const production = env.NODE_ENV === "production";
  const configured = token.length > 0;
  const valid = !configured || token.length >= SETUP_TOKEN_MIN_LENGTH;

  return {
    token,
    configured,
    valid,
    // Le jeton est obligatoire dès qu'il est configuré, et en production même
    // s'il est absent (dans ce cas `enabled` vaut false et l'endpoint refuse).
    required: configured || production,
    enabled: valid && (!production || configured),
  };
}

/**
 * Compare le jeton fourni au jeton attendu en temps constant, même lorsque
 * les deux chaînes n'ont pas la même longueur.
 */
export function setupTokenMatches(provided, expected) {
  const expectedToken = normalizeToken(expected);
  if (!expectedToken) return false;
  const providedToken = normalizeToken(provided);
  const providedHash = crypto
    .createHash("sha256")
    .update(providedToken)
    .digest();
  const expectedHash = crypto
    .createHash("sha256")
    .update(expectedToken)
    .digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}
