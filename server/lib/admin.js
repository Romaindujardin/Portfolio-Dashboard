// Résolution du ou des administrateurs de l'application.
//
// La configuration Enable Banking est globale (une seule application PSD2 pour
// tous les profils). Elle ne doit donc pas être modifiable par n'importe quel
// profil authentifié.
//
// Ordre de résolution :
//   1. option `adminUsers` (tests / intégration) ;
//   2. variable d'environnement ADMIN_USERS (liste séparée par des virgules) ;
//   3. repli : le profil le plus ancien (premier identifiant créé).
//
// Les noms sont comparés exactement, comme les identifiants de profil.

const normalize = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const resolveAdminUsers = (
  db,
  { env = process.env, adminUsers = null } = {},
) => {
  if (Array.isArray(adminUsers)) {
    return adminUsers.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  const configured = normalize(env.ADMIN_USERS);
  if (configured.length > 0) return configured;

  if (!db) return [];
  try {
    const row = db
      .prepare(
        `SELECT username FROM user_credentials
         ORDER BY created_at ASC, rowid ASC
         LIMIT 1`,
      )
      .get();
    return row?.username ? [String(row.username)] : [];
  } catch {
    return [];
  }
};

export const isAdminUser = (db, username, options = {}) => {
  const clean = String(username || "").trim();
  if (!clean) return false;
  return resolveAdminUsers(db, options).includes(clean);
};

export default { resolveAdminUsers, isAdminUser };
