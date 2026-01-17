// Gestionnaire centralisé des mises à jour de prix
// Remplace les mises à jour fréquentes par un système horaire avec refresh manuel

import { forceUpdateDatabase } from "./cryptoDatabase";
import { clearStockCache } from "./stockDatabase";
import { updateInvestmentPrices } from "./storage";

// Configuration des intervalles
const UPDATE_INTERVAL = 60 * 60 * 1000; // 1 heure en millisecondes
const CACHE_CLEAR_INTERVAL = 60 * 60 * 1000; // 1 heure pour vider les caches

// Variables de gestion
let updateTimer: number | null = null;
let lastUpdateTime = 0;
let nextUpdateTime = 0;
let isUpdating = false;

// Callbacks pour notifier l'UI des changements
type UpdateCallback = (isUpdating: boolean, nextUpdate: number) => void;
const updateCallbacks: UpdateCallback[] = [];

// Initialiser le gestionnaire de mises à jour
export const initializePriceUpdateManager = (): void => {
  console.log(
    "🕐 Initialisation du gestionnaire de mises à jour (intervalle: 1 heure)"
  );

  // Définir la prochaine mise à jour dans 1 heure
  lastUpdateTime = Date.now();
  nextUpdateTime = lastUpdateTime + UPDATE_INTERVAL;

  // Programmer les mises à jour automatiques toutes les heures
  updateTimer = setInterval(() => {
    performUpdate();
  }, UPDATE_INTERVAL);

  console.log(
    "✅ Gestionnaire de mises à jour initialisé - prochaine mise à jour dans 1 heure"
  );
};

// Effectuer une mise à jour
const performUpdate = async (): Promise<void> => {
  console.log("🔄 performUpdate appelé, isUpdating:", isUpdating);

  if (isUpdating) {
    console.log("⏸️ Mise à jour déjà en cours, ignorée");
    return;
  }

  isUpdating = true;
  lastUpdateTime = Date.now();
  nextUpdateTime = lastUpdateTime + UPDATE_INTERVAL;

  // Notifier l'UI
  console.log("📡 Notification des callbacks...");
  notifyCallbacks();

  console.log("🔄 Début de la mise à jour automatique des prix...");

  try {
    // Vider les caches pour forcer le rafraîchissement
    console.log("🧹 Vidage des caches...");
    clearStockCache();

    // Mettre à jour la base crypto
    console.log("🪙 Mise à jour de la base crypto...");
    await forceUpdateDatabase();

    // Mettre à jour les prix des investissements existants
    console.log("📊 Mise à jour des prix des investissements...");
    await updateInvestmentPrices();

    // Mettre à jour les assets des wallets
    console.log("👛 Mise à jour des assets des wallets...");
    const { updateWalletAssets } = await import("./storage");
    await updateWalletAssets();

    console.log("✅ Mise à jour automatique terminée");
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour automatique:", error);
  } finally {
    console.log("🔄 Fin de performUpdate, isUpdating mis à false");
    isUpdating = false;
    notifyCallbacks();
  }
};

// Forcer une mise à jour manuelle (reset le compteur)
export const forceManualUpdate = async (): Promise<void> => {
  console.log("🔄 Mise à jour manuelle forcée...");
  console.log("📊 État avant mise à jour:", getUpdateStatus());

  // Arrêter le timer actuel
  if (updateTimer) {
    console.log("⏹️ Arrêt du timer actuel...");
    clearInterval(updateTimer);
  }

  // Effectuer la mise à jour
  console.log("🔄 Début de performUpdate...");
  await performUpdate();
  console.log("✅ performUpdate terminé");

  // Redémarrer le timer avec un nouveau cycle complet
  console.log("🔄 Redémarrage du timer...");
  updateTimer = setInterval(() => {
    performUpdate();
  }, UPDATE_INTERVAL);

  console.log(
    "✅ Mise à jour manuelle terminée - nouveau cycle d'1 heure démarré"
  );
  console.log("📊 État après mise à jour:", getUpdateStatus());
};

// Obtenir le statut actuel
export const getUpdateStatus = () => {
  const now = Date.now();
  const timeUntilNext = Math.max(0, nextUpdateTime - now);
  const minutesUntilNext = Math.ceil(timeUntilNext / (60 * 1000));

  return {
    isUpdating,
    lastUpdate: lastUpdateTime,
    nextUpdate: nextUpdateTime,
    timeUntilNext,
    minutesUntilNext,
    lastUpdateFormatted: lastUpdateTime
      ? new Date(lastUpdateTime).toLocaleTimeString()
      : "Jamais",
    nextUpdateFormatted: new Date(nextUpdateTime).toLocaleTimeString(),
  };
};

// S'abonner aux changements de statut
export const subscribeToUpdates = (callback: UpdateCallback): (() => void) => {
  updateCallbacks.push(callback);

  // Retourner une fonction de désabonnement
  return () => {
    const index = updateCallbacks.indexOf(callback);
    if (index > -1) {
      updateCallbacks.splice(index, 1);
    }
  };
};

// Notifier tous les callbacks
const notifyCallbacks = (): void => {
  const status = getUpdateStatus();
  updateCallbacks.forEach((callback) => {
    try {
      callback(isUpdating, nextUpdateTime);
    } catch (error) {
      console.error("Erreur dans un callback de mise à jour:", error);
    }
  });
};

// Nettoyer le gestionnaire
export const cleanup = (): void => {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  updateCallbacks.length = 0;
  console.log("🧹 Gestionnaire de mises à jour nettoyé");
};

// Obtenir des statistiques lisibles
export const getReadableStats = () => {
  const status = getUpdateStatus();

  return {
    ...status,
    status: isUpdating ? "🔄 Mise à jour en cours..." : "✅ Prêt",
    nextUpdateText:
      status.minutesUntilNext <= 0
        ? "Prochainement"
        : `Dans ${status.minutesUntilNext} min`,
  };
};
