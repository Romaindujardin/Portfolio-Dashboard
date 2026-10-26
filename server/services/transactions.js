// Normalisation et dédoublonnage des transactions.
// Reprend les règles de Picsou : identifiant fournisseur quand il existe,
// sinon empreinte stable date + montant + libellé ; fenêtre de relecture de
// 7 jours pour rattraper les écritures comptabilisées en retard.

import crypto from "crypto";

export const INITIAL_HISTORY_DAYS = 90;
export const OVERLAP_DAYS = 7;

const sha256 = (value) =>
  crypto.createHash("sha256").update(String(value), "utf8").digest("hex");

export const transactionFingerprint = (date, amount, label) => {
  const canonical = [
    date || "",
    amount == null ? "" : Number(amount).toString(),
    (label || "").trim(),
  ].join("|");
  return `fp:${sha256(canonical)}`;
};

export const transactionDedupKey = (transaction) => {
  if (transaction.externalId && String(transaction.externalId).trim()) {
    return String(transaction.externalId).trim();
  }
  return transactionFingerprint(
    transaction.date,
    transaction.amount,
    transaction.label,
  );
};

/**
 * Début de la fenêtre à demander au fournisseur.
 * - Premier import : 90 jours d'historique.
 * - Suivant : 7 jours avant la dernière écriture connue.
 * - Une date future ne doit pas bloquer la fenêtre indéfiniment.
 */
export const computeWindowStart = (
  latestDate,
  today = new Date(),
  { initialDays = INITIAL_HISTORY_DAYS, overlapDays = OVERLAP_DAYS } = {},
) => {
  const toIso = (date) => new Date(date).toISOString().slice(0, 10);
  const todayIso = toIso(today);
  const floor = new Date(today);
  floor.setUTCDate(floor.getUTCDate() - initialDays);
  const floorIso = toIso(floor);

  if (!latestDate) return floorIso;

  const latest = new Date(`${String(latestDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(latest.getTime())) return floorIso;

  const incremental = new Date(latest);
  incremental.setUTCDate(incremental.getUTCDate() - overlapDays);
  const incrementalIso = toIso(incremental);

  if (incrementalIso > todayIso) return floorIso;
  return incrementalIso;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const parseTransactionDate = (item) => {
  for (const raw of [item.booking_date, item.value_date, item.transaction_date]) {
    if (!raw) continue;
    const value = String(raw).slice(0, 10);
    if (DATE_RE.test(value)) return value;
  }
  return null;
};

const absoluteAmount = (raw) => {
  if (raw == null || raw === "") return null;
  const parsed = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(parsed);
};

export const signedTransactionAmount = (item) => {
  const magnitude = absoluteAmount(item?.transaction_amount?.amount);
  if (magnitude == null) return null;
  const debit = String(item?.credit_debit_indicator || "").toUpperCase() === "DBIT";
  return debit ? -magnitude : magnitude;
};

export const describeTransaction = (item) => {
  const remittance = Array.isArray(item?.remittance_information)
    ? item.remittance_information
        .filter((line) => line != null && String(line).trim())
        .map((line) => String(line).trim())
        .join(" ")
    : "";
  if (remittance) return remittance;

  const debit = String(item?.credit_debit_indicator || "").toUpperCase() === "DBIT";
  const party = debit ? item?.creditor : item?.debtor;
  if (party?.name && String(party.name).trim()) return String(party.name).trim();

  const bankLabel = item?.bank_transaction_code?.description;
  if (bankLabel && String(bankLabel).trim()) return String(bankLabel).trim();

  return "Transaction";
};

/**
 * Convertit une entrée Enable Banking en transaction normalisée.
 * Les écritures non comptabilisées (PDNG, etc.) sont ignorées : elles changent
 * encore et sont renvoyées plus tard en BOOK, ce qui produirait un doublon.
 */
export const mapEnableBankingTransaction = (item) => {
  if (!item) return null;
  const status = item.status ? String(item.status).toUpperCase() : "BOOK";
  if (status !== "BOOK") return null;

  const date = parseTransactionDate(item);
  const amount = signedTransactionAmount(item);
  if (!date || amount == null) return null;

  const label = describeTransaction(item);
  const externalId =
    (item.entry_reference && String(item.entry_reference).trim()) ||
    (item.transaction_id && String(item.transaction_id).trim()) ||
    null;

  const debit = String(item.credit_debit_indicator || "").toUpperCase() === "DBIT";
  const counterparty =
    (debit ? item.creditor?.name : item.debtor?.name) || null;

  const transaction = {
    externalId,
    date,
    valueDate: item.value_date ? String(item.value_date).slice(0, 10) : null,
    amount,
    currency: item.transaction_amount?.currency || "EUR",
    label,
    counterparty,
    category: item.bank_transaction_code?.description || null,
    pending: false,
    raw: item,
  };
  transaction.dedupKey = transactionDedupKey(transaction);
  return transaction;
};

/**
 * Filtre les transactions déjà connues et les doublons internes au lot.
 * @param {Set<string>} knownKeys
 * @param {Array} fetched
 */
export const selectNewTransactions = (knownKeys, fetched) => {
  const known = new Set(knownKeys);
  const result = [];
  for (const transaction of fetched) {
    const key = transaction.dedupKey || transactionDedupKey(transaction);
    if (known.has(key)) continue;
    known.add(key);
    result.push({ ...transaction, dedupKey: key });
  }
  return result;
};

export const mapEnableBankingTransactions = (items) =>
  (Array.isArray(items) ? items : [])
    .map(mapEnableBankingTransaction)
    .filter(Boolean);
