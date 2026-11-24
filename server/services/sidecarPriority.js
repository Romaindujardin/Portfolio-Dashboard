// Priorité des sidecars bancaires locaux sur Enable Banking.
// Une banque disposant d'un sidecar ne doit plus être synchronisée via la
// DSP2 : ses comptes Enable Banking sont marqués puis archivés pour éviter
// les doublons, tandis que le sidecar fournit tous les comptes et mouvements.

import { PROVIDERS } from "../connectors/types.js";
import { nowIso } from "../lib/validate.js";

export const SIDECAR_BANKS = Object.freeze({
  bnp: {
    key: "bnp",
    provider: PROVIDERS.BNP_SIDECAR,
    label: "BNP Paribas",
    connectionLabel: "BNP Paribas (Sidecar)",
    aliases: ["bnp", "paribas", "hello bank", "hellobank"],
  },
  fortuneo: {
    key: "fortuneo",
    provider: PROVIDERS.FORTUNEO_SIDECAR,
    label: "Fortuneo",
    connectionLabel: "Fortuneo (Sidecar)",
    aliases: ["fortuneo"],
  },
  bourso: {
    key: "bourso",
    provider: PROVIDERS.BOURSO_SIDECAR,
    label: "BoursoBank",
    connectionLabel: "BoursoBank (Sidecar)",
    aliases: ["bourso", "boursorama"],
  },
});

export const sidecarProviderForBank = (bankKey) =>
  SIDECAR_BANKS[bankKey]?.provider || null;

export const sidecarBankForProvider = (provider) => {
  const entry = Object.entries(SIDECAR_BANKS).find(
    ([, definition]) => definition.provider === provider,
  );
  return entry ? entry[0] : null;
};

export const isSidecarProvider = (provider) =>
  Boolean(sidecarBankForProvider(provider));

/** Identifie la banque d'une connexion, sidecar ou Enable Banking. */
export const detectBankKey = (connection) => {
  if (!connection || typeof connection !== "object") return null;
  const providerBank = sidecarBankForProvider(connection.provider);
  if (providerBank) return providerBank;
  const metadata =
    connection.metadata && typeof connection.metadata === "object"
      ? connection.metadata
      : {};
  const aspspName = metadata.aspsp?.name || connection.aspspName || "";
  const haystack = `${connection.aspspName || ""} ${
    connection.label || ""
  } ${aspspName}`.toLowerCase();
  for (const definition of Object.values(SIDECAR_BANKS)) {
    if (definition.aliases.some((alias) => haystack.includes(alias))) {
      return definition.key;
    }
  }
  return null;
};

export const isSidecarLinked = (connection) =>
  Boolean(connection?.metadata?.sidecarLinked);

export const findSidecarConnection = (connections, bankKey) => {
  const provider = sidecarProviderForBank(bankKey);
  if (!provider) return null;
  return connections.find((connection) => connection.provider === provider) || null;
};

/**
 * Marque les connexions Enable Banking de la même banque comme remplacées.
 * Les comptes liés sont archivés par défaut : le sidecar fournit leur version
 * complète, et conserver les deux jeux créerait des doublons dans la synthèse.
 */
export const markSidecarPriority = ({
  repository,
  userId,
  bankKey,
  sidecarConnectionId = null,
  archiveAccounts = true,
}) => {
  const definition = SIDECAR_BANKS[bankKey];
  if (!definition) return { linked: [], archivedAccounts: 0 };
  const connections = repository.listConnectors(userId);
  const linked = [];
  let archivedAccounts = 0;

  for (const connection of connections) {
    if (connection.id === sidecarConnectionId) continue;
    if (connection.provider !== PROVIDERS.ENABLE_BANKING) continue;
    if (detectBankKey(connection) !== bankKey) continue;

    repository.updateConnector(connection.id, userId, {
      metadata: {
        ...(connection.metadata || {}),
        sidecarLinked: true,
        sidecarProvider: definition.provider,
        sidecarLinkedAt: nowIso(),
      },
    });
    if (archiveAccounts) {
      archivedAccounts += repository.archiveAccountsByConnection(
        connection.id,
        userId,
      );
    }
    linked.push(connection.id);
  }

  return { linked, archivedAccounts };
};

/** Retire le marquage lorsque le sidecar correspondant est supprimé. */
export const unmarkSidecarPriority = ({ repository, userId, bankKey }) => {
  const definition = SIDECAR_BANKS[bankKey];
  if (!definition) return 0;
  const connections = repository.listConnectors(userId);
  let updated = 0;
  for (const connection of connections) {
    if (connection.provider !== PROVIDERS.ENABLE_BANKING) continue;
    if (!isSidecarLinked(connection)) continue;
    if (detectBankKey(connection) !== bankKey) continue;
    const metadata = { ...(connection.metadata || {}) };
    delete metadata.sidecarLinked;
    delete metadata.sidecarProvider;
    delete metadata.sidecarLinkedAt;
    repository.updateConnector(connection.id, userId, { metadata });
    updated += 1;
  }
  return updated;
};

/**
 * Connexions à synchroniser : les sidecars, plus les connexions Enable Banking
 * dont la banque n'a pas de sidecar. Les connexions marquées sont ignorées.
 */
export const filterSyncableConnections = (connections) => {
  const sidecarBanks = new Set(
    connections
      .filter((connection) => isSidecarProvider(connection.provider))
      .map((connection) => sidecarBankForProvider(connection.provider)),
  );
  return connections.filter((connection) => {
    if (isSidecarProvider(connection.provider)) return true;
    if (connection.provider !== PROVIDERS.ENABLE_BANKING) return false;
    if (isSidecarLinked(connection)) return false;
    const bankKey = detectBankKey(connection);
    return !(bankKey && sidecarBanks.has(bankKey));
  });
};

/** Une connexion Enable Banking est-elle remplacée par un sidecar actif ? */
export const isConnectionReplacedBySidecar = (connection, connections) => {
  if (!connection || connection.provider !== PROVIDERS.ENABLE_BANKING) {
    return false;
  }
  if (isSidecarLinked(connection)) return true;
  const bankKey = detectBankKey(connection);
  if (!bankKey) return false;
  return connections.some(
    (candidate) =>
      isSidecarProvider(candidate.provider) &&
      sidecarBankForProvider(candidate.provider) === bankKey,
  );
};
