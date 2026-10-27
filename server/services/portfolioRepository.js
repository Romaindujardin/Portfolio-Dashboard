// Dépôt SQLite du patrimoine connecté.
// Toutes les écritures passent par better-sqlite3 (synchrone), avec des
// transactions pour les imports de transactions et les valorisations.

import { v4 as uuidv4 } from "uuid";
import { nowIso, round2 } from "../lib/validate.js";

const parseJson = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toJson = (value) => (value == null ? null : JSON.stringify(value));

const mapAccount = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    externalId: row.external_id,
    connectionId: row.connection_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    balance: Number(row.balance) || 0,
    cashBalance: row.cash_balance == null ? null : Number(row.cash_balance),
    availableBalance:
      row.available_balance == null ? null : Number(row.available_balance),
    iban: row.iban,
    isManual: Boolean(row.is_manual),
    isArchived: Boolean(row.is_archived),
    color: row.color,
    metadata: parseJson(row.metadata_json, {}),
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapConnector = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    sessionId: row.session_id,
    validUntil: row.valid_until,
    aspspName: row.aspsp_name,
    aspspCountry: row.aspsp_country,
    psuType: row.psu_type,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapTransaction = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    provider: row.provider,
    externalId: row.external_id,
    dedupKey: row.dedup_key,
    date: row.date,
    valueDate: row.value_date,
    amount: Number(row.amount) || 0,
    currency: row.currency,
    label: row.label,
    counterparty: row.counterparty,
    category: row.category,
    subcategory: row.subcategory,
    pending: Boolean(row.pending),
    isTransfer: Boolean(row.is_transfer),
    notes: row.notes,
    createdAt: row.created_at,
  };
};

const mapHolding = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    isin: row.isin,
    ticker: row.ticker,
    name: row.name,
    quantity: Number(row.quantity) || 0,
    costBasis: row.cost_basis == null ? null : Number(row.cost_basis),
    price: row.price == null ? null : Number(row.price),
    currency: row.currency,
    lastPriceAt: row.last_price_at,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapProperty = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    name: row.name,
    address: row.address,
    postalCode: row.postal_code,
    city: row.city,
    country: row.country,
    inseeCode: row.insee_code,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    banId: row.ban_id,
    geocodeScore: row.geocode_score == null ? null : Number(row.geocode_score),
    propertyType: row.property_type,
    surfaceM2: row.surface_m2 == null ? null : Number(row.surface_m2),
    landM2: row.land_m2 == null ? null : Number(row.land_m2),
    rooms: row.rooms,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    floorNumber: row.floor_number,
    floorsTotal: row.floors_total,
    hasElevator: Boolean(row.has_elevator),
    hasGarden: Boolean(row.has_garden),
    hasTerrace: Boolean(row.has_terrace),
    hasBalcony: Boolean(row.has_balcony),
    garageCount: row.garage_count || 0,
    parkingCount: row.parking_count || 0,
    constructionYear: row.construction_year,
    energyClass: row.energy_class,
    purchasePrice: row.purchase_price == null ? null : Number(row.purchase_price),
    purchaseDate: row.purchase_date,
    agencyFees: row.agency_fees == null ? null : Number(row.agency_fees),
    notaryFees: row.notary_fees == null ? null : Number(row.notary_fees),
    worksCost: row.works_cost == null ? null : Number(row.works_cost),
    rentalIncome: row.rental_income == null ? 0 : Number(row.rental_income),
    valuationMode: row.valuation_mode,
    currentValue: row.current_value == null ? null : Number(row.current_value),
    lastValuedAt: row.last_valued_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapValuation = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    propertyId: row.property_id,
    valuedAt: row.valued_at,
    estimatedValue: Number(row.estimated_value) || 0,
    lowValue: row.low_value == null ? null : Number(row.low_value),
    highValue: row.high_value == null ? null : Number(row.high_value),
    pricePerSqm: row.price_per_sqm == null ? null : Number(row.price_per_sqm),
    provider: row.provider,
    confidence: row.confidence,
    sampleSize: row.sample_size,
    sourceYear: row.source_year,
    detail: parseJson(row.method_detail, {}),
    createdAt: row.created_at,
  };
};

const mapLoan = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    propertyId: row.property_id,
    name: row.name,
    lender: row.lender,
    principal: Number(row.principal) || 0,
    annualRate: Number(row.annual_rate) || 0,
    startDate: row.start_date,
    endDate: row.end_date,
    termMonths: row.term_months,
    monthlyPayment:
      row.monthly_payment == null ? null : Number(row.monthly_payment),
    insuranceMonthly: Number(row.insurance_monthly) || 0,
    fileFees: Number(row.file_fees) || 0,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapOwnership = (row) => ({
  id: row.id,
  accountId: row.account_id,
  ownerName: row.owner_name,
  sharePercent: Number(row.share_percent) || 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class PortfolioRepository {
  constructor(db) {
    this.db = db;
  }

  // ─── Comptes ───────────────────────────────────────────────────────────────

  listAccounts(userId, { includeArchived = false } = {}) {
    const sql = includeArchived
      ? "SELECT * FROM accounts WHERE user_id = ? ORDER BY type, name"
      : "SELECT * FROM accounts WHERE user_id = ? AND is_archived = 0 ORDER BY type, name";
    return this.db.prepare(sql).all(userId).map(mapAccount);
  }

  getAccount(id, userId) {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?")
      .get(id, userId);
    return mapAccount(row);
  }

  findAccountByExternalId(provider, externalId, userId) {
    if (!externalId) return null;
    const row = this.db
      .prepare(
        "SELECT * FROM accounts WHERE provider = ? AND external_id = ? AND user_id = ?",
      )
      .get(provider, externalId, userId);
    return mapAccount(row);
  }

  createAccount(userId, data) {
    const id = data.id || uuidv4();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO accounts (
          id, user_id, provider, external_id, connection_id, name, type, currency,
          balance, cash_balance, available_balance, iban, is_manual, is_archived,
          color, metadata_json, last_sync_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        data.provider || "manual",
        data.externalId || null,
        data.connectionId || null,
        data.name || "Compte",
        data.type || "OTHER",
        data.currency || "EUR",
        round2(data.balance || 0),
        data.cashBalance == null ? null : round2(data.cashBalance),
        data.availableBalance == null ? null : round2(data.availableBalance),
        data.iban || null,
        data.isManual === false ? 0 : 1,
        data.color || null,
        toJson(data.metadata || {}),
        data.lastSyncAt || null,
        now,
        now,
      );
    return this.getAccount(id, userId);
  }

  updateAccount(id, userId, patch) {
    const allowed = {
      name: "name",
      type: "type",
      currency: "currency",
      balance: "balance",
      cashBalance: "cash_balance",
      availableBalance: "available_balance",
      iban: "iban",
      isArchived: "is_archived",
      color: "color",
      connectionId: "connection_id",
      lastSyncAt: "last_sync_at",
      metadata: "metadata_json",
      externalId: "external_id",
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (patch[key] === undefined) continue;
      fields.push(`${column} = ?`);
      if (key === "metadata") values.push(toJson(patch[key]));
      else if (key === "isArchived") values.push(patch[key] ? 1 : 0);
      else if (["balance", "cashBalance", "availableBalance"].includes(key)) {
        values.push(patch[key] == null ? null : round2(patch[key]));
      } else values.push(patch[key] ?? null);
    }
    if (fields.length === 0) return this.getAccount(id, userId);
    fields.push("updated_at = ?");
    values.push(nowIso(), id, userId);
    this.db
      .prepare(`UPDATE accounts SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`)
      .run(...values);
    return this.getAccount(id, userId);
  }

  upsertSyncedAccount(userId, data) {
    const existing = this.findAccountByExternalId(
      data.provider,
      data.externalId,
      userId,
    );
    if (existing) {
      return this.updateAccount(existing.id, userId, {
        name: data.name || existing.name,
        type: data.type || existing.type,
        currency: data.currency || existing.currency,
        balance: data.balance,
        availableBalance: data.availableBalance,
        iban: data.iban || existing.iban,
        connectionId: data.connectionId || existing.connectionId,
        isArchived: false,
        lastSyncAt: data.lastSyncAt || nowIso(),
        metadata: { ...existing.metadata, ...(data.metadata || {}) },
      });
    }
    return this.createAccount(userId, { ...data, isManual: false });
  }

  deleteAccount(id, userId) {
    return (
      this.db
        .prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?")
        .run(id, userId).changes > 0
    );
  }

  // ─── Transactions ─────────────────────────────────────────────────────────

  listTransactions(accountId, userId, { from, to, limit = 500 } = {}) {
    const clauses = ["account_id = ?", "user_id = ?"];
    const values = [accountId, userId];
    if (from) {
      clauses.push("date >= ?");
      values.push(from);
    }
    if (to) {
      clauses.push("date <= ?");
      values.push(to);
    }
    values.push(Math.min(Math.max(Number(limit) || 500, 1), 5000));
    return this.db
      .prepare(
        `SELECT * FROM transactions WHERE ${clauses.join(" AND ")}
         ORDER BY date DESC, created_at DESC LIMIT ?`,
      )
      .all(...values)
      .map(mapTransaction);
  }

  getLatestTransactionDate(accountId) {
    const row = this.db
      .prepare("SELECT MAX(date) AS latest FROM transactions WHERE account_id = ?")
      .get(accountId);
    return row?.latest || null;
  }

  listTransactionDedupKeys(accountId) {
    return this.db
      .prepare("SELECT dedup_key FROM transactions WHERE account_id = ?")
      .all(accountId)
      .map((row) => row.dedup_key);
  }

  archiveAccountsByConnection(connectionId, userId) {
    return this.db
      .prepare(
        `UPDATE accounts SET is_archived = 1, connection_id = NULL, updated_at = ?
         WHERE connection_id = ? AND user_id = ?`,
      )
      .run(nowIso(), connectionId, userId).changes;
  }

  detachAccountsFromConnection(connectionId, userId) {
    return this.db
      .prepare(
        `UPDATE accounts SET connection_id = NULL, updated_at = ?
         WHERE connection_id = ? AND user_id = ?`,
      )
      .run(nowIso(), connectionId, userId).changes;
  }

  countTransactions(accountId) {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?")
        .get(accountId)?.count || 0
    );
  }

  /**
   * Insère les transactions nouvelles. Le dédoublonnage est fait en amont par
   * selectNewTransactions(), mais la contrainte UNIQUE(account_id, dedup_key)
   * sert de filet de sécurité (INSERT OR IGNORE).
   */
  insertTransactions(userId, accountId, provider, items) {
    if (!items.length) return 0;
    const now = nowIso();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO transactions (
        id, user_id, account_id, provider, external_id, dedup_key, date,
        value_date, amount, currency, label, counterparty, category,
        subcategory, pending, is_transfer, notes, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let inserted = 0;
    const insertMany = this.db.transaction((rows) => {
      for (const item of rows) {
        const result = stmt.run(
          uuidv4(),
          userId,
          accountId,
          provider,
          item.externalId || null,
          item.dedupKey,
          item.date,
          item.valueDate || null,
          round2(item.amount),
          item.currency || "EUR",
          item.label || "",
          item.counterparty || null,
          item.category || null,
          item.subcategory || null,
          item.pending ? 1 : 0,
          item.isTransfer ? 1 : 0,
          item.notes || null,
          toJson(item.raw || null),
          now,
        );
        if (result.changes > 0) inserted += 1;
      }
    });
    insertMany(items);
    return inserted;
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  saveSnapshot(userId, accountId, date, balance, currency = "EUR", source = "sync") {
    this.db
      .prepare(
        `INSERT INTO balance_snapshots (
          id, user_id, account_id, date, balance, currency, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, date) DO UPDATE SET
          balance = excluded.balance,
          currency = excluded.currency,
          source = excluded.source`,
      )
      .run(uuidv4(), userId, accountId, date, round2(balance), currency, source, nowIso());
  }

  listSnapshots(accountId, userId, { from, to } = {}) {
    const clauses = ["account_id = ?", "user_id = ?"];
    const values = [accountId, userId];
    if (from) {
      clauses.push("date >= ?");
      values.push(from);
    }
    if (to) {
      clauses.push("date <= ?");
      values.push(to);
    }
    return this.db
      .prepare(
        `SELECT * FROM balance_snapshots WHERE ${clauses.join(" AND ")}
         ORDER BY date ASC`,
      )
      .all(...values)
      .map((row) => ({
        id: row.id,
        accountId: row.account_id,
        date: row.date,
        balance: Number(row.balance),
        currency: row.currency,
        source: row.source,
      }));
  }

  // ─── Holdings ─────────────────────────────────────────────────────────────

  listHoldings(accountId, userId) {
    return this.db
      .prepare(
        "SELECT * FROM holdings WHERE account_id = ? AND user_id = ? ORDER BY name, ticker",
      )
      .all(accountId, userId)
      .map(mapHolding);
  }

  listAllHoldings(userId) {
    return this.db
      .prepare("SELECT * FROM holdings WHERE user_id = ? ORDER BY account_id, name")
      .all(userId)
      .map(mapHolding);
  }

  upsertHolding(userId, accountId, data) {
    const existing = data.ticker
      ? this.db
          .prepare(
            "SELECT * FROM holdings WHERE account_id = ? AND ticker = ?",
          )
          .get(accountId, data.ticker)
      : null;
    const now = nowIso();
    if (existing) {
      this.db
        .prepare(
          `UPDATE holdings SET isin = ?, name = ?, quantity = ?, cost_basis = ?,
           price = ?, currency = ?, last_price_at = ?, metadata_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          data.isin || existing.isin,
          data.name || existing.name,
          Number(data.quantity ?? existing.quantity) || 0,
          data.costBasis == null ? existing.cost_basis : Number(data.costBasis),
          data.price == null ? existing.price : Number(data.price),
          data.currency || existing.currency,
          data.lastPriceAt || existing.last_price_at,
          toJson(data.metadata || parseJson(existing.metadata_json, {})),
          now,
          existing.id,
        );
      return mapHolding(
        this.db.prepare("SELECT * FROM holdings WHERE id = ?").get(existing.id),
      );
    }

    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO holdings (
          id, user_id, account_id, isin, ticker, name, quantity, cost_basis,
          price, currency, last_price_at, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        accountId,
        data.isin || null,
        data.ticker || null,
        data.name || null,
        Number(data.quantity) || 0,
        data.costBasis == null ? null : Number(data.costBasis),
        data.price == null ? null : Number(data.price),
        data.currency || "EUR",
        data.lastPriceAt || null,
        toJson(data.metadata || {}),
        now,
        now,
      );
    return mapHolding(this.db.prepare("SELECT * FROM holdings WHERE id = ?").get(id));
  }

  deleteHolding(id, accountId, userId) {
    return (
      this.db
        .prepare("DELETE FROM holdings WHERE id = ? AND account_id = ? AND user_id = ?")
        .run(id, accountId, userId).changes > 0
    );
  }

  updateHoldingPrice(id, price, lastPriceAt, metadata = null) {
    if (metadata) {
      this.db
        .prepare(
          "UPDATE holdings SET price = ?, last_price_at = ?, metadata_json = ?, updated_at = ? WHERE id = ?",
        )
        .run(price, lastPriceAt, toJson(metadata), nowIso(), id);
    } else {
      this.db
        .prepare(
          "UPDATE holdings SET price = ?, last_price_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(price, lastPriceAt, nowIso(), id);
    }
  }

  // ─── Connecteurs ──────────────────────────────────────────────────────────

  listConnectors(userId) {
    return this.db
      .prepare("SELECT * FROM connectors WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId)
      .map(mapConnector);
  }

  getConnector(id, userId) {
    return mapConnector(
      this.db
        .prepare("SELECT * FROM connectors WHERE id = ? AND user_id = ?")
        .get(id, userId),
    );
  }

  findPendingConnectorByState(state, userId) {
    const rows = this.db
      .prepare(
        "SELECT * FROM connectors WHERE user_id = ? AND provider = 'enable-banking' AND status = 'pending' ORDER BY created_at DESC",
      )
      .all(userId);
    return (
      rows
        .map(mapConnector)
        .find((connector) => connector.metadata?.state === state) || null
    );
  }

  createConnector(userId, data) {
    const id = uuidv4();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO connectors (
          id, user_id, provider, label, status, session_id, valid_until,
          aspsp_name, aspsp_country, psu_type, last_sync_at, last_error,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        data.provider || "enable-banking",
        data.label || "Connexion bancaire",
        data.status || "pending",
        data.sessionId || null,
        data.validUntil || null,
        data.aspspName || null,
        data.aspspCountry || null,
        data.psuType || "personal",
        data.lastSyncAt || null,
        data.lastError || null,
        toJson(data.metadata || {}),
        now,
        now,
      );
    return this.getConnector(id, userId);
  }

  updateConnector(id, userId, patch) {
    const allowed = {
      label: "label",
      status: "status",
      sessionId: "session_id",
      validUntil: "valid_until",
      aspspName: "aspsp_name",
      aspspCountry: "aspsp_country",
      psuType: "psu_type",
      lastSyncAt: "last_sync_at",
      lastError: "last_error",
      metadata: "metadata_json",
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (patch[key] === undefined) continue;
      fields.push(`${column} = ?`);
      values.push(key === "metadata" ? toJson(patch[key]) : patch[key] ?? null);
    }
    if (fields.length === 0) return this.getConnector(id, userId);
    fields.push("updated_at = ?");
    values.push(nowIso(), id, userId);
    this.db
      .prepare(`UPDATE connectors SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`)
      .run(...values);
    return this.getConnector(id, userId);
  }

  deleteConnector(id, userId) {
    return (
      this.db
        .prepare("DELETE FROM connectors WHERE id = ? AND user_id = ?")
        .run(id, userId).changes > 0
    );
  }

  // ─── Réglages d'intégration chiffrés ──────────────────────────────────────

  getEncryptedIntegration(provider) {
    return this.db
      .prepare("SELECT * FROM integration_settings WHERE provider = ?")
      .get(provider);
  }

  saveEncryptedIntegration(provider, encryptedJson) {
    this.db
      .prepare(
        `INSERT INTO integration_settings (provider, encrypted_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           encrypted_json = excluded.encrypted_json,
           updated_at = excluded.updated_at`,
      )
      .run(provider, encryptedJson, nowIso());
  }

  deleteIntegration(provider) {
    return (
      this.db
        .prepare("DELETE FROM integration_settings WHERE provider = ?")
        .run(provider).changes > 0
    );
  }

  // ─── Journal de sync ──────────────────────────────────────────────────────

  startSyncRun(userId, connectionId, provider) {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO sync_runs (id, user_id, connection_id, provider, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(id, userId, connectionId || null, provider, nowIso());
    return id;
  }

  finishSyncRun(id, { status, accountsSynced = 0, transactionsImported = 0, error = null }) {
    this.db
      .prepare(
        `UPDATE sync_runs SET status = ?, finished_at = ?, accounts_synced = ?,
         transactions_imported = ?, error = ? WHERE id = ?`,
      )
      .run(status, nowIso(), accountsSynced, transactionsImported, error, id);
  }

  listSyncRuns(userId, { connectionId, limit = 20 } = {}) {
    const sql = connectionId
      ? "SELECT * FROM sync_runs WHERE user_id = ? AND connection_id = ? ORDER BY started_at DESC LIMIT ?"
      : "SELECT * FROM sync_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?";
    const params = connectionId
      ? [userId, connectionId, Math.min(limit, 100)]
      : [userId, Math.min(limit, 100)];
    return this.db.prepare(sql).all(...params);
  }

  // ─── Immobilier ───────────────────────────────────────────────────────────

  listProperties(userId) {
    return this.db
      .prepare("SELECT * FROM properties WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId)
      .map(mapProperty);
  }

  getProperty(id, userId) {
    return mapProperty(
      this.db
        .prepare("SELECT * FROM properties WHERE id = ? AND user_id = ?")
        .get(id, userId),
    );
  }

  saveProperty(userId, data) {
    const now = nowIso();
    if (data.id) {
      const allowed = [
        "name",
        "address",
        "postal_code",
        "city",
        "country",
        "insee_code",
        "latitude",
        "longitude",
        "ban_id",
        "geocode_score",
        "property_type",
        "surface_m2",
        "land_m2",
        "rooms",
        "bedrooms",
        "bathrooms",
        "floor_number",
        "floors_total",
        "has_elevator",
        "has_garden",
        "has_terrace",
        "has_balcony",
        "garage_count",
        "parking_count",
        "construction_year",
        "energy_class",
        "purchase_price",
        "purchase_date",
        "agency_fees",
        "notary_fees",
        "works_cost",
        "rental_income",
        "valuation_mode",
        "current_value",
        "last_valued_at",
        "account_id",
      ];
      const fields = [];
      const values = [];
      for (const column of allowed) {
        if (data[column] === undefined) continue;
        fields.push(`${column} = ?`);
        values.push(data[column]);
      }
      if (fields.length > 0) {
        fields.push("updated_at = ?");
        values.push(now, data.id, userId);
        this.db
          .prepare(
            `UPDATE properties SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
          )
          .run(...values);
      }
      return this.getProperty(data.id, userId);
    }

    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO properties (
          id, user_id, account_id, name, address, postal_code, city, country,
          insee_code, latitude, longitude, ban_id, geocode_score, property_type,
          surface_m2, land_m2, rooms, bedrooms, bathrooms, floor_number, floors_total,
          has_elevator, has_garden, has_terrace, has_balcony, garage_count,
          parking_count, construction_year, energy_class, purchase_price,
          purchase_date, agency_fees, notary_fees, works_cost, rental_income,
          valuation_mode, current_value, last_valued_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        data.account_id || null,
        data.name || "Bien immobilier",
        data.address || null,
        data.postal_code || null,
        data.city || null,
        data.country || "FR",
        data.insee_code || null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.ban_id || null,
        data.geocode_score ?? null,
        data.property_type || "APARTMENT",
        data.surface_m2 ?? null,
        data.land_m2 ?? null,
        data.rooms ?? null,
        data.bedrooms ?? null,
        data.bathrooms ?? null,
        data.floor_number ?? null,
        data.floors_total ?? null,
        data.has_elevator ? 1 : 0,
        data.has_garden ? 1 : 0,
        data.has_terrace ? 1 : 0,
        data.has_balcony ? 1 : 0,
        data.garage_count || 0,
        data.parking_count || 0,
        data.construction_year ?? null,
        data.energy_class || null,
        data.purchase_price ?? null,
        data.purchase_date || null,
        data.agency_fees ?? null,
        data.notary_fees ?? null,
        data.works_cost ?? null,
        data.rental_income ?? 0,
        data.valuation_mode || "ESTIMATED",
        data.current_value ?? null,
        data.last_valued_at || null,
        now,
        now,
      );
    return this.getProperty(id, userId);
  }

  updatePropertyValue(id, userId, value, valuedAt) {
    this.db
      .prepare(
        `UPDATE properties SET current_value = ?, last_valued_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(round2(value), valuedAt, nowIso(), id, userId);
  }

  deleteProperty(id, userId) {
    const property = this.getProperty(id, userId);
    if (!property) return false;
    const result = this.db
      .prepare("DELETE FROM properties WHERE id = ? AND user_id = ?")
      .run(id, userId);
    if (property.accountId) {
      this.db
        .prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?")
        .run(property.accountId, userId);
    }
    return result.changes > 0;
  }

  saveValuation(userId, propertyId, data) {
    this.db
      .prepare(
        `INSERT INTO property_valuations (
          id, property_id, valued_at, estimated_value, low_value, high_value,
          price_per_sqm, provider, confidence, sample_size, source_year,
          method_detail, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(property_id, valued_at) DO UPDATE SET
          estimated_value = excluded.estimated_value,
          low_value = excluded.low_value,
          high_value = excluded.high_value,
          price_per_sqm = excluded.price_per_sqm,
          provider = excluded.provider,
          confidence = excluded.confidence,
          sample_size = excluded.sample_size,
          source_year = excluded.source_year,
          method_detail = excluded.method_detail`,
      )
      .run(
        uuidv4(),
        propertyId,
        data.valuedAt,
        round2(data.estimatedValue),
        data.lowValue == null ? null : round2(data.lowValue),
        data.highValue == null ? null : round2(data.highValue),
        data.pricePerSqm == null ? null : round2(data.pricePerSqm),
        data.provider || "MANUAL",
        data.confidence || null,
        data.sampleSize ?? null,
        data.sourceYear ?? null,
        toJson(data.detail || {}),
        nowIso(),
      );
    return this.listValuations(propertyId, userId).find(
      (valuation) => valuation.valuedAt === data.valuedAt,
    );
  }

  listValuations(propertyId, userId) {
    return this.db
      .prepare(
        `SELECT v.* FROM property_valuations v
         JOIN properties p ON p.id = v.property_id
         WHERE v.property_id = ? AND p.user_id = ?
         ORDER BY v.valued_at DESC`,
      )
      .all(propertyId, userId)
      .map(mapValuation);
  }

  // ─── Prêts ────────────────────────────────────────────────────────────────

  listLoans(userId) {
    return this.db
      .prepare("SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId)
      .map(mapLoan);
  }

  getLoan(id, userId) {
    return mapLoan(
      this.db.prepare("SELECT * FROM loans WHERE id = ? AND user_id = ?").get(id, userId),
    );
  }

  saveLoan(userId, data) {
    const now = nowIso();
    if (data.id) {
      const allowed = [
        "account_id",
        "property_id",
        "name",
        "lender",
        "principal",
        "annual_rate",
        "start_date",
        "end_date",
        "term_months",
        "monthly_payment",
        "insurance_monthly",
        "file_fees",
        "metadata_json",
      ];
      const fields = [];
      const values = [];
      for (const column of allowed) {
        if (data[column] === undefined) continue;
        fields.push(`${column} = ?`);
        values.push(data[column]);
      }
      if (fields.length > 0) {
        fields.push("updated_at = ?");
        values.push(now, data.id, userId);
        this.db
          .prepare(`UPDATE loans SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`)
          .run(...values);
      }
      return this.getLoan(data.id, userId);
    }

    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO loans (
          id, user_id, account_id, property_id, name, lender, principal,
          annual_rate, start_date, end_date, term_months, monthly_payment,
          insurance_monthly, file_fees, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        data.account_id || null,
        data.property_id || null,
        data.name || "Prêt",
        data.lender || null,
        round2(data.principal || 0),
        Number(data.annual_rate) || 0,
        data.start_date || null,
        data.end_date || null,
        data.term_months ?? null,
        data.monthly_payment == null ? null : round2(data.monthly_payment),
        round2(data.insurance_monthly || 0),
        round2(data.file_fees || 0),
        toJson(data.metadata || {}),
        now,
        now,
      );
    return this.getLoan(id, userId);
  }

  deleteLoan(id, userId) {
    const loan = this.getLoan(id, userId);
    if (!loan) return false;
    const result = this.db
      .prepare("DELETE FROM loans WHERE id = ? AND user_id = ?")
      .run(id, userId);
    if (loan.accountId) {
      this.db
        .prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?")
        .run(loan.accountId, userId);
    }
    return result.changes > 0;
  }

  // ─── Parts de propriété ───────────────────────────────────────────────────

  listOwnerships(accountId, userId) {
    return this.db
      .prepare(
        `SELECT o.* FROM account_ownerships o
         JOIN accounts a ON a.id = o.account_id
         WHERE o.account_id = ? AND a.user_id = ?
         ORDER BY o.share_percent DESC`,
      )
      .all(accountId, userId)
      .map(mapOwnership);
  }

  listAllOwnerships(userId) {
    return this.db
      .prepare(
        `SELECT o.* FROM account_ownerships o
         JOIN accounts a ON a.id = o.account_id
         WHERE a.user_id = ?`,
      )
      .all(userId)
      .map(mapOwnership);
  }

  replaceOwnerships(accountId, userId, shares) {
    const account = this.getAccount(accountId, userId);
    if (!account) return null;
    const replace = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM account_ownerships WHERE account_id = ?")
        .run(accountId);
      const stmt = this.db.prepare(
        `INSERT INTO account_ownerships (
          id, account_id, owner_name, share_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const share of shares) {
        stmt.run(
          uuidv4(),
          accountId,
          share.ownerName,
          Number(share.sharePercent),
          nowIso(),
          nowIso(),
        );
      }
    });
    replace();
    return this.listOwnerships(accountId, userId);
  }

  // ─── Prix ─────────────────────────────────────────────────────────────────

  getCachedPrice(ticker) {
    const row = this.db
      .prepare("SELECT * FROM price_cache WHERE ticker = ?")
      .get(ticker);
    if (!row) return null;
    return {
      ticker: row.ticker,
      price: Number(row.price),
      currency: row.currency,
      source: row.source,
      fetchedAt: row.fetched_at,
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  saveCachedPrice(ticker, data) {
    this.db
      .prepare(
        `INSERT INTO price_cache (ticker, price, currency, source, fetched_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(ticker) DO UPDATE SET
           price = excluded.price,
           currency = excluded.currency,
           source = excluded.source,
           fetched_at = excluded.fetched_at,
           metadata_json = excluded.metadata_json`,
      )
      .run(
        ticker,
        Number(data.price),
        data.currency || "EUR",
        data.source || "yahoo",
        data.fetchedAt || nowIso(),
        toJson(data.metadata || {}),
      );
  }

  getSecurity(isin) {
    const row = this.db
      .prepare("SELECT * FROM security_master WHERE isin = ?")
      .get(isin);
    if (!row) return null;
    return {
      isin: row.isin,
      ticker: row.ticker,
      name: row.name,
      exchange: row.exchange,
      currency: row.currency,
      updatedAt: row.updated_at,
    };
  }

  saveSecurity(isin, data) {
    this.db
      .prepare(
        `INSERT INTO security_master (isin, ticker, name, exchange, currency, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(isin) DO UPDATE SET
           ticker = excluded.ticker,
           name = excluded.name,
           exchange = excluded.exchange,
           currency = excluded.currency,
           updated_at = excluded.updated_at`,
      )
      .run(
        isin,
        data.ticker || null,
        data.name || null,
        data.exchange || null,
        data.currency || null,
        nowIso(),
      );
  }

  // ─── Vue d'ensemble ───────────────────────────────────────────────────────

  /**
   * Calcule la vue d'ensemble. Les holdings sont déjà valorisés par le service
   * de marché ; on ajoute leur valeur au solde du compte d'investissement.
   * Le solde d'un compte REAL_ESTATE / LOAN est déjà la valeur (ou la dette)
   * à jour : pas de double comptage.
   */
  getOverview(userId) {
    const accounts = this.listAccounts(userId);
    const ownerships = this.listAllOwnerships(userId);
    const ownershipByAccount = new Map();
    for (const ownership of ownerships) {
      const list = ownershipByAccount.get(ownership.accountId) || [];
      list.push(ownership);
      ownershipByAccount.set(ownership.accountId, list);
    }

    const holdingsByAccount = new Map();
    for (const holding of this.listAllHoldings(userId)) {
      const list = holdingsByAccount.get(holding.accountId) || [];
      list.push(holding);
      holdingsByAccount.set(holding.accountId, list);
    }

    let assets = 0;
    let debts = 0;
    const byType = {};
    const perOwner = {};

    for (const account of accounts) {
      const holdings = holdingsByAccount.get(account.id) || [];
      const holdingsValue = holdings.reduce(
        (sum, holding) => sum + (holding.quantity || 0) * (holding.price || 0),
        0,
      );
      const isInvestment = ["PEA", "SECURITIES", "CRYPTO", "EMPLOYEE_SAVINGS"].includes(
        account.type,
      );
      const value =
        isInvestment && holdings.length > 0
          ? (account.cashBalance ?? 0) + holdingsValue
          : account.balance;

      if (account.type === "LOAN" || value < 0) debts += Math.abs(value);
      else assets += value;

      byType[account.type] = (byType[account.type] || 0) + value;

      const shares = ownershipByAccount.get(account.id) || [];
      if (shares.length === 0) {
        perOwner[userId] = (perOwner[userId] || 0) + value;
      } else {
        for (const share of shares) {
          perOwner[share.ownerName] =
            (perOwner[share.ownerName] || 0) + (value * share.sharePercent) / 100;
        }
        const allocated = shares.reduce((sum, s) => sum + s.sharePercent, 0);
        if (allocated < 100) {
          perOwner[userId] =
            (perOwner[userId] || 0) + (value * (100 - allocated)) / 100;
        }
      }
    }

    const properties = this.listProperties(userId);
    const loans = this.listLoans(userId);

    return {
      userId,
      totals: {
        assets: round2(assets),
        debts: round2(debts),
        netWorth: round2(assets - debts),
      },
      byType: Object.fromEntries(
        Object.entries(byType).map(([type, val]) => [type, round2(val)]),
      ),
      perOwner: Object.fromEntries(
        Object.entries(perOwner).map(([name, value]) => [name, round2(value)]),
      ),
      accounts: accounts.map((account) => ({
        ...account,
        holdings: holdingsByAccount.get(account.id) || [],
        ownerships: ownershipByAccount.get(account.id) || [],
      })),
      properties,
      loans,
      counts: {
        accounts: accounts.length,
        properties: properties.length,
        loans: loans.length,
        holdings: accounts.reduce(
          (sum, account) => sum + (holdingsByAccount.get(account.id)?.length || 0),
          0,
        ),
      },
    };
  }
}

export default PortfolioRepository;
