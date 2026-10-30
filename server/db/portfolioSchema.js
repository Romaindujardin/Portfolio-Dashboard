// =============================================================================
// Schéma « patrimoine connecté » (phases 1 & 2)
// -----------------------------------------------------------------------------
// Tables additives : elles ne remplacent ni ne modifient les tables existantes
// (wallets, bank_csv_uploads, tricount_*, savings_*, user_settings).
// L'objectif est de disposer d'un modèle normalisé pour les connecteurs
// bancaires, les snapshots, les holdings, l'immobilier et les prêts, tout en
// laissant la logique métier historique (CSV, budget, épargne) intacte.
// =============================================================================

const addColumnIfMissing = (db, table, column, definition) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    // Colonne déjà présente : migration idempotente.
  }
};

export function initializePortfolioSchema(db) {
  db.exec(`
    -- Comptes normalisés : une ligne par compte, quelle que soit la source.
    -- provider = enable-banking | manual | csv | bourso
    CREATE TABLE IF NOT EXISTS accounts (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      provider          TEXT NOT NULL,
      external_id       TEXT,
      connection_id     TEXT,
      name              TEXT NOT NULL,
      type              TEXT NOT NULL DEFAULT 'OTHER',
      currency          TEXT NOT NULL DEFAULT 'EUR',
      balance           REAL NOT NULL DEFAULT 0,
      cash_balance      REAL,
      available_balance REAL,
      iban              TEXT,
      is_manual         INTEGER NOT NULL DEFAULT 0,
      is_archived       INTEGER NOT NULL DEFAULT 0,
      color             TEXT,
      metadata_json     TEXT,
      last_sync_at      TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    DROP INDEX IF EXISTS idx_accounts_provider_external;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_provider_external
      ON accounts (user_id, provider, external_id)
      WHERE external_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id, is_archived);

    -- Connexions bancaires (une requisition / session par banque).
    CREATE TABLE IF NOT EXISTS connectors (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      provider       TEXT NOT NULL,
      label          TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      session_id     TEXT,
      valid_until    TEXT,
      aspsp_name     TEXT,
      aspsp_country  TEXT,
      psu_type       TEXT,
      last_sync_at   TEXT,
      last_error     TEXT,
      metadata_json  TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connectors_user ON connectors (user_id, provider);

    -- Secrets d'intégration chiffrés (AES-256-GCM), jamais renvoyés en clair.
    CREATE TABLE IF NOT EXISTS integration_settings (
      provider       TEXT PRIMARY KEY,
      encrypted_json TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    -- Transactions normalisées, dédupliquées par (account_id, dedup_key).
    CREATE TABLE IF NOT EXISTS transactions (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      account_id     TEXT NOT NULL,
      provider       TEXT NOT NULL,
      external_id    TEXT,
      dedup_key      TEXT NOT NULL,
      date           TEXT NOT NULL,
      value_date     TEXT,
      amount         REAL NOT NULL,
      currency       TEXT NOT NULL DEFAULT 'EUR',
      label          TEXT NOT NULL DEFAULT '',
      counterparty   TEXT,
      category       TEXT,
      subcategory    TEXT,
      pending        INTEGER NOT NULL DEFAULT 0,
      is_transfer    INTEGER NOT NULL DEFAULT 0,
      notes          TEXT,
      raw_json       TEXT,
      created_at     TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_account_dedup
      ON transactions (account_id, dedup_key);
    CREATE INDEX IF NOT EXISTS idx_transactions_account_date
      ON transactions (account_id, date DESC);

    -- Holdings (positions) d'un compte d'investissement.
    CREATE TABLE IF NOT EXISTS holdings (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      account_id    TEXT NOT NULL,
      isin          TEXT,
      ticker        TEXT,
      name          TEXT,
      quantity      REAL NOT NULL DEFAULT 0,
      cost_basis    REAL,
      price         REAL,
      currency      TEXT NOT NULL DEFAULT 'EUR',
      last_price_at TEXT,
      metadata_json TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_account_ticker
      ON holdings (account_id, ticker)
      WHERE ticker IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings (account_id);

    -- Snapshots de soldes : un point par compte et par jour.
    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      account_id TEXT NOT NULL,
      date       TEXT NOT NULL,
      balance    REAL NOT NULL,
      currency   TEXT NOT NULL DEFAULT 'EUR',
      source     TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_account_date
      ON balance_snapshots (account_id, date);

    -- Journal des synchronisations (diagnostic + santé des intégrations).
    CREATE TABLE IF NOT EXISTS sync_runs (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL,
      connection_id         TEXT,
      provider              TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'running',
      started_at            TEXT NOT NULL,
      finished_at           TEXT,
      accounts_synced       INTEGER NOT NULL DEFAULT 0,
      transactions_imported INTEGER NOT NULL DEFAULT 0,
      error                 TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_runs_connection
      ON sync_runs (connection_id, started_at DESC);

    -- Immobilier : métadonnées + valorisations historisées.
    CREATE TABLE IF NOT EXISTS properties (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      account_id        TEXT,
      name              TEXT NOT NULL,
      address           TEXT,
      postal_code       TEXT,
      city              TEXT,
      country           TEXT NOT NULL DEFAULT 'FR',
      insee_code        TEXT,
      latitude          REAL,
      longitude         REAL,
      ban_id            TEXT,
      geocode_score     REAL,
      property_type     TEXT NOT NULL DEFAULT 'APARTMENT',
      surface_m2        REAL,
      land_m2           REAL,
      rooms             INTEGER,
      bedrooms          INTEGER,
      bathrooms         INTEGER,
      floor_number      INTEGER,
      floors_total      INTEGER,
      has_elevator      INTEGER,
      has_garden        INTEGER,
      has_terrace       INTEGER,
      has_balcony       INTEGER,
      garage_count      INTEGER NOT NULL DEFAULT 0,
      parking_count     INTEGER NOT NULL DEFAULT 0,
      construction_year INTEGER,
      energy_class      TEXT,
      purchase_price    REAL,
      purchase_date     TEXT,
      agency_fees       REAL,
      notary_fees       REAL,
      works_cost        REAL,
      rental_income     REAL DEFAULT 0,
      valuation_mode    TEXT NOT NULL DEFAULT 'ESTIMATED',
      current_value     REAL,
      last_valued_at    TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_properties_user ON properties (user_id);

    CREATE TABLE IF NOT EXISTS property_valuations (
      id              TEXT PRIMARY KEY,
      property_id     TEXT NOT NULL,
      valued_at       TEXT NOT NULL,
      estimated_value REAL NOT NULL,
      low_value       REAL,
      high_value      REAL,
      price_per_sqm   REAL,
      provider        TEXT NOT NULL,
      confidence      TEXT,
      sample_size     INTEGER,
      source_year     INTEGER,
      method_detail   TEXT,
      created_at      TEXT NOT NULL,
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_property_valuations_unique
      ON property_valuations (property_id, valued_at);

    -- Prêts immobiliers / crédits.
    CREATE TABLE IF NOT EXISTS loans (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      account_id        TEXT,
      property_id       TEXT,
      name              TEXT NOT NULL,
      lender            TEXT,
      principal         REAL NOT NULL,
      annual_rate       REAL NOT NULL DEFAULT 0,
      start_date        TEXT,
      end_date          TEXT,
      term_months       INTEGER,
      monthly_payment   REAL,
      insurance_monthly REAL NOT NULL DEFAULT 0,
      file_fees         REAL NOT NULL DEFAULT 0,
      metadata_json     TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
      FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_loans_user ON loans (user_id);

    -- Parts de propriété par compte (immobilier, prêt, compte joint).
    -- Somme <= 100 : le reste peut appartenir à des tiers hors application.
    CREATE TABLE IF NOT EXISTS account_ownerships (
      id            TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL,
      owner_name    TEXT NOT NULL,
      share_percent REAL NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_account_owner
      ON account_ownerships (account_id, owner_name);

    -- Cache de prix (Yahoo Finance, CoinGecko) et mapping ISIN -> ticker.
    CREATE TABLE IF NOT EXISTS price_cache (
      ticker     TEXT PRIMARY KEY,
      price      REAL NOT NULL,
      currency   TEXT NOT NULL DEFAULT 'EUR',
      source     TEXT NOT NULL DEFAULT 'yahoo',
      fetched_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS security_master (
      isin       TEXT PRIMARY KEY,
      ticker     TEXT,
      name       TEXT,
      exchange   TEXT,
      currency   TEXT,
      updated_at TEXT NOT NULL
    );

    -- Identifiants & mots de passe sécurisés par profil (scrypt + timing-safe)
    CREATE TABLE IF NOT EXISTS user_credentials (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  // Colonnes ajoutées après coup (bases déjà créées par une version antérieure).
  addColumnIfMissing(db, "accounts", "cash_balance", "REAL");
  addColumnIfMissing(db, "accounts", "connection_id", "TEXT");
  addColumnIfMissing(db, "loans", "term_months", "INTEGER");
  addColumnIfMissing(db, "properties", "bathrooms", "INTEGER");
  addColumnIfMissing(db, "properties", "valuation_mode", "TEXT NOT NULL DEFAULT 'ESTIMATED'");
}

export default initializePortfolioSchema;
