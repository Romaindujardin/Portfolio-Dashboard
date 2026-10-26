// Parts de propriété (phase 2).
// Une somme <= 100 % est acceptée : le reliquat reste attribué au propriétaire
// principal du compte (ou représente un tiers non suivi par l'application).

export class OwnershipError extends Error {
  constructor(message, { status = 400, code = "OWNERSHIP_ERROR", details = null } = {}) {
    super(message);
    this.name = "OwnershipError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const normalizeShares = (shares) => {
  if (!Array.isArray(shares)) {
    throw new OwnershipError("La liste des parts doit être un tableau.");
  }
  const byOwner = new Map();
  for (const share of shares) {
    const ownerName = String(share?.ownerName ?? share?.owner_name ?? "").trim();
    if (!ownerName) {
      throw new OwnershipError("Chaque part doit avoir un nom de propriétaire.");
    }
    if (ownerName.length > 120) {
      throw new OwnershipError("Nom de propriétaire trop long (120 caractères max).");
    }
    const percent = Number(share?.sharePercent ?? share?.share_percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new OwnershipError(
        `Part invalide pour ${ownerName} : attendu entre 0 et 100 %.`,
      );
    }
    byOwner.set(ownerName, (byOwner.get(ownerName) || 0) + percent);
  }
  const normalized = [...byOwner.entries()]
    .map(([ownerName, sharePercent]) => ({
      ownerName,
      sharePercent: Math.round(sharePercent * 100) / 100,
    }))
    .filter((share) => share.sharePercent > 0);

  const total = normalized.reduce((sum, share) => sum + share.sharePercent, 0);
  if (total > 100.005) {
    throw new OwnershipError(
      `Le total des parts ne peut pas dépasser 100 % (actuellement ${Math.round(total * 100) / 100} %).`,
    );
  }
  return normalized;
};

/** Répartit une valeur selon les parts ; le reliquat revient à defaultOwner. */
export const distributeValue = (value, shares, defaultOwner) => {
  const amount = Number(value) || 0;
  const result = {};
  let allocated = 0;
  for (const share of shares || []) {
    result[share.ownerName] =
      (result[share.ownerName] || 0) + (amount * share.sharePercent) / 100;
    allocated += share.sharePercent;
  }
  if (allocated < 100) {
    result[defaultOwner] = (result[defaultOwner] || 0) + (amount * (100 - allocated)) / 100;
  }
  return Object.fromEntries(
    Object.entries(result).map(([owner, ownerValue]) => [
      owner,
      Math.round(ownerValue * 100) / 100,
    ]),
  );
};
