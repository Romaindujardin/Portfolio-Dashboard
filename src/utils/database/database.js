import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

// Singleton pour la connexion à la base de données
class DatabaseManager {
  constructor() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Créer la base de données dans le répertoire du projet (2 niveaux au-dessus de src/utils/database)
    this.dbPath = path.join(__dirname, "../../..", "portfolio.db");
    this.db = null;
  }

  static getInstance() {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  getDatabase() {
    if (!this.db) {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
    }
    return this.db;
  }

  closeDatabase() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Initialiser les tables
  initializeTables() {
    const db = this.getDatabase();

    // Table des wallets
    db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        wallet_type TEXT NOT NULL,
        blockchains TEXT NOT NULL,
        total_value REAL NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL,
        added_at TEXT NOT NULL
      )
    `);

    // Table des assets des wallets
    db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_assets (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        balance REAL NOT NULL,
        decimals INTEGER NOT NULL,
        blockchain TEXT NOT NULL,
        contract_address TEXT,
        price REAL,
        value REAL,
        logo TEXT,
        is_hidden BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE
      )
    `);

    // Table des NFTs des wallets
    db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_nfts (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        balance REAL NOT NULL,
        decimals INTEGER NOT NULL,
        blockchain TEXT NOT NULL,
        contract_address TEXT,
        price REAL,
        value REAL,
        logo TEXT,
        token_id TEXT,
        collection TEXT,
        permalink TEXT,
        traits TEXT,
        is_hidden BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE
      )
    `);

    // ===== BANQUE / IMPORT CSV =====
    db.exec(`
      CREATE TABLE IF NOT EXISTS bank_csv_uploads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        section TEXT NOT NULL DEFAULT 'bank',
        source_label TEXT NOT NULL DEFAULT '',
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        uploaded_at TEXT NOT NULL
      )
    `);

    // Migration légère: ajouter la colonne section si la table existe déjà (anciens DB)
    try {
      db.exec(
        "ALTER TABLE bank_csv_uploads ADD COLUMN section TEXT NOT NULL DEFAULT 'bank'",
      );
    } catch (e) {
      // ignore si la colonne existe déjà
    }

    // Migration: ajouter une étiquette immuable pour identifier la source (ne change pas au renommage)
    try {
      db.exec(
        "ALTER TABLE bank_csv_uploads ADD COLUMN source_label TEXT NOT NULL DEFAULT ''",
      );
    } catch (e) {
      // ignore si la colonne existe déjà
    }
    // Backfill: si source_label est vide, on prend le filename actuel
    try {
      db.exec(
        "UPDATE bank_csv_uploads SET source_label = filename WHERE source_label IS NULL OR source_label = ''",
      );
    } catch (e) {
      // ignore si la colonne n'existe pas (DB très ancienne)
    }

    // ===== TRICOUNT / BUDGET FAMILLE =====
    db.exec(`
      CREATE TABLE IF NOT EXISTS tricount_expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'Romain',
        month TEXT NOT NULL,
        date TEXT NOT NULL,
        label TEXT NOT NULL,
        amount REAL NOT NULL,
        payer_person_id TEXT NOT NULL DEFAULT 'person1',
        pocket_id TEXT NOT NULL DEFAULT 'unallocated',
        pocket_name TEXT,
        sub_pocket_id TEXT,
        sub_pocket_name TEXT,
        split_method TEXT NOT NULL DEFAULT '50_50',
        nature TEXT NOT NULL DEFAULT 'expense',
        source TEXT DEFAULT 'manual',
        bank_account TEXT,
        bank_reference TEXT,
        bank_row_id TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tricount_incomes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'Romain',
        month TEXT NOT NULL,
        date TEXT NOT NULL,
        label TEXT NOT NULL,
        amount REAL NOT NULL,
        beneficiary_person_id TEXT NOT NULL DEFAULT 'person1',
        source TEXT DEFAULT 'manual',
        bank_account TEXT,
        bank_reference TEXT,
        bank_row_id TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tricount_configs (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'Romain',
        p1_income REAL NOT NULL DEFAULT 0,
        p2_income REAL NOT NULL DEFAULT 0,
        is_strategy_applied INTEGER NOT NULL DEFAULT 0,
        applied_strategy_date TEXT,
        target_savings_rate REAL,
        notes TEXT
      );

      -- ===== PLAN D'ÉPARGNE & STRATÉGIE =====
      CREATE TABLE IF NOT EXISTS savings_strategies (
        user_id TEXT PRIMARY KEY,
        strategy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS savings_monthly_strategies (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        month TEXT NOT NULL,
        strategy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- ===== PARAMÈTRES UTILISATEUR =====
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets (user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_assets_wallet_id ON wallet_assets (wallet_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_assets_symbol ON wallet_assets (symbol);
      CREATE INDEX IF NOT EXISTS idx_bank_csv_uploads_user_id ON bank_csv_uploads (user_id);
      CREATE INDEX IF NOT EXISTS idx_bank_csv_uploads_uploaded_at ON bank_csv_uploads (uploaded_at);
      CREATE INDEX IF NOT EXISTS idx_tricount_expenses_user_month ON tricount_expenses (user_id, month);
      CREATE INDEX IF NOT EXISTS idx_tricount_incomes_user_month ON tricount_incomes (user_id, month);
      CREATE INDEX IF NOT EXISTS idx_tricount_configs_user_month ON tricount_configs (user_id, month);
      CREATE INDEX IF NOT EXISTS idx_savings_monthly_user ON savings_monthly_strategies (user_id);
      CREATE INDEX IF NOT EXISTS idx_savings_monthly_user_month ON savings_monthly_strategies (user_id, month);
    `);

    try {
      db.exec("ALTER TABLE tricount_configs ADD COLUMN notes TEXT");
    } catch (e) {
      // ignore
    }

    console.log("✅ Tables de base de données initialisées");
  }

  // Gestion des wallets
  getAllWallets(userId = "Romain") {
    const db = this.getDatabase();
    return db
      .prepare("SELECT * FROM wallets WHERE user_id = ? ORDER BY added_at DESC")
      .all(userId);
  }

  getWalletById(id) {
    const db = this.getDatabase();
    const stmt = db.prepare("SELECT * FROM wallets WHERE id = ?");
    return stmt.get(id);
  }

  createWallet(wallet) {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO wallets (id, user_id, name, address, wallet_type, blockchains, total_value, last_updated, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      wallet.user_id || "Romain",
      wallet.name,
      wallet.address,
      wallet.wallet_type,
      JSON.stringify(wallet.blockchains),
      wallet.total_value || 0,
      wallet.last_updated || now,
      now,
    );

    return id;
  }

  updateWallet(id, wallet) {
    const db = this.getDatabase();
    // Whitelist des colonnes autorisées (protection contre l'injection SQL par nom de champ)
    const allowed = [
      "user_id",
      "name",
      "address",
      "wallet_type",
      "blockchains",
      "total_value",
      "last_updated",
    ];
    const fields = Object.keys(wallet).filter((key) => allowed.includes(key));
    if (fields.length === 0) return false;
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => wallet[field]);

    const stmt = db.prepare(`
      UPDATE wallets 
      SET ${setClause}
      WHERE id = ?
    `);

    const result = stmt.run(...values, id);
    return result.changes > 0;
  }

  deleteWallet(id) {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM wallets WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // Gestion des assets des wallets
  getWalletAssets(walletId) {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "SELECT * FROM wallet_assets WHERE wallet_id = ? ORDER BY created_at DESC",
    );
    return stmt.all(walletId);
  }

  createWalletAsset(asset) {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    // S'assurer que les valeurs ne sont pas null/undefined
    const safeAsset = {
      wallet_id: asset.wallet_id || "",
      symbol: asset.symbol || "",
      name: asset.name || "",
      balance: asset.balance || 0,
      decimals: asset.decimals || 0,
      blockchain: asset.blockchain || "",
      contract_address: asset.contract_address || null,
      price: asset.price || 0,
      value: asset.value || 0,
      logo: asset.logo || null,
      is_hidden: asset.is_hidden ? 1 : 0,
    };

    const stmt = db.prepare(`
      INSERT INTO wallet_assets (
        id, wallet_id, symbol, name, balance, decimals, blockchain,
        contract_address, price, value, logo, is_hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      safeAsset.wallet_id,
      safeAsset.symbol,
      safeAsset.name,
      safeAsset.balance,
      safeAsset.decimals,
      safeAsset.blockchain,
      safeAsset.contract_address,
      safeAsset.price,
      safeAsset.value,
      safeAsset.logo,
      safeAsset.is_hidden,
      now,
      now,
    );

    return id;
  }

  updateWalletAsset(id, asset) {
    const db = this.getDatabase();
    const now = new Date().toISOString();

    // Whitelist des colonnes autorisées (protection contre l'injection SQL par nom de champ)
    const allowed = [
      "wallet_id",
      "symbol",
      "name",
      "balance",
      "decimals",
      "blockchain",
      "contract_address",
      "price",
      "value",
      "logo",
      "is_hidden",
    ];
    const fields = Object.keys(asset).filter((key) => allowed.includes(key));
    if (fields.length === 0) return false;
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => {
      const value = asset[field];
      return field === "is_hidden" ? (value ? 1 : 0) : value;
    });

    const stmt = db.prepare(`
      UPDATE wallet_assets 
      SET ${setClause}, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(...values, now, id);
    return result.changes > 0;
  }

  deleteWalletAssets(walletId) {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM wallet_assets WHERE wallet_id = ?");
    const result = stmt.run(walletId);
    return result.changes > 0;
  }

  updateWalletAssetVisibility(id, isHidden) {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "UPDATE wallet_assets SET is_hidden = ? WHERE id = ?",
    );
    const result = stmt.run(isHidden ? 1 : 0, id);
    return result.changes > 0;
  }

  // Méthodes pour les NFTs
  getWalletNFTs(walletId) {
    const db = this.getDatabase();
    const stmt = db.prepare("SELECT * FROM wallet_nfts WHERE wallet_id = ?");
    return stmt.all(walletId);
  }

  createWalletNFT(nft) {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const safeNft = {
      balance: Number(nft.balance) || 0,
      symbol: String(nft.symbol || ""),
      name: String(nft.name || ""),
      decimals: Number(nft.decimals) || 0,
      blockchain: String(nft.blockchain || ""),
      contract_address: nft.contract_address || null,
      price: nft.price ? Number(nft.price) : null,
      value: nft.value ? Number(nft.value) : null,
      logo: nft.logo || null,
      token_id: nft.token_id || null,
      collection: nft.collection || null,
      permalink: nft.permalink || null,
      traits: nft.traits || null,
      is_hidden: Boolean(nft.is_hidden) || false,
    };

    const stmt = db.prepare(`
      INSERT INTO wallet_nfts (
        id, wallet_id, symbol, name, balance, decimals, blockchain,
        contract_address, price, value, logo, token_id, collection,
        permalink, traits, is_hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      nft.wallet_id,
      safeNft.symbol,
      safeNft.name,
      safeNft.balance,
      safeNft.decimals,
      safeNft.blockchain,
      safeNft.contract_address,
      safeNft.price,
      safeNft.value,
      safeNft.logo,
      safeNft.token_id,
      safeNft.collection,
      safeNft.permalink,
      safeNft.traits,
      safeNft.is_hidden ? 1 : 0,
      now,
      now,
    );

    return id;
  }

  updateWalletNFT(id, nft) {
    const db = this.getDatabase();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE wallet_nfts SET
        symbol = ?, name = ?, balance = ?, decimals = ?, blockchain = ?,
        contract_address = ?, price = ?, value = ?, logo = ?, token_id = ?,
        collection = ?, permalink = ?, traits = ?, is_hidden = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      nft.symbol,
      nft.name,
      nft.balance,
      nft.decimals,
      nft.blockchain,
      nft.contractAddress,
      nft.price,
      nft.value,
      nft.logo,
      nft.tokenId,
      nft.nftData?.collection,
      nft.nftData?.permalink,
      nft.nftData?.traits ? JSON.stringify(nft.nftData.traits) : null,
      nft.isHidden ? 1 : 0,
      now,
      id,
    );
  }

  deleteWalletNFTs(walletId) {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM wallet_nfts WHERE wallet_id = ?");
    stmt.run(walletId);
  }

  updateWalletNFTVisibility(id, isHidden) {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "UPDATE wallet_nfts SET is_hidden = ? WHERE id = ?",
    );
    const result = stmt.run(isHidden ? 1 : 0, id);
    return result.changes > 0;
  }

  // ===== BANQUE / IMPORT CSV =====
  getAllBankCsvUploads(userId = "Romain") {
    const db = this.getDatabase();
    // Compat: récupérer aussi les anciens enregistrements sans user_id si besoin
    if (userId === "Romain") {
      return db
        .prepare(
          "SELECT * FROM bank_csv_uploads WHERE user_id = ? OR user_id IS NULL ORDER BY uploaded_at DESC",
        )
        .all(userId);
    }
    return db
      .prepare(
        "SELECT * FROM bank_csv_uploads WHERE user_id = ? ORDER BY uploaded_at DESC",
      )
      .all(userId);
  }

  getAllBankCsvUploadsMeta(userId = "Romain", section = null) {
    const db = this.getDatabase();
    if (userId === "Romain") {
      if (section) {
        return db
          .prepare(
            "SELECT id, user_id, section, source_label, filename, size_bytes, uploaded_at FROM bank_csv_uploads WHERE (user_id = ? OR user_id IS NULL) AND section = ? ORDER BY uploaded_at DESC",
          )
          .all(userId, section);
      }
      return db
        .prepare(
          "SELECT id, user_id, section, source_label, filename, size_bytes, uploaded_at FROM bank_csv_uploads WHERE user_id = ? OR user_id IS NULL ORDER BY uploaded_at DESC",
        )
        .all(userId);
    }
    if (section) {
      return db
        .prepare(
          "SELECT id, user_id, section, source_label, filename, size_bytes, uploaded_at FROM bank_csv_uploads WHERE user_id = ? AND section = ? ORDER BY uploaded_at DESC",
        )
        .all(userId, section);
    }
    return db
      .prepare(
        "SELECT id, user_id, section, source_label, filename, size_bytes, uploaded_at FROM bank_csv_uploads WHERE user_id = ? ORDER BY uploaded_at DESC",
      )
      .all(userId);
  }

  getBankCsvUploadById(id, userId = "Romain") {
    const db = this.getDatabase();
    if (userId === "Romain") {
      return db
        .prepare(
          "SELECT * FROM bank_csv_uploads WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
        )
        .get(id, userId);
    }
    return db
      .prepare("SELECT * FROM bank_csv_uploads WHERE id = ? AND user_id = ?")
      .get(id, userId);
  }

  createBankCsvUpload(upload) {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO bank_csv_uploads (id, user_id, section, source_label, filename, content, size_bytes, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const filename = upload.filename || "transactions.csv";
    const sourceLabel = upload.source_label || upload.sourceLabel || filename;

    stmt.run(
      id,
      upload.user_id || "Romain",
      upload.section || "bank",
      sourceLabel,
      filename,
      upload.content || "",
      Number(upload.size_bytes || 0),
      upload.uploaded_at || now,
    );

    return id;
  }

  deleteBankCsvUpload(id, userId = "Romain") {
    const db = this.getDatabase();
    // On force la sécurité par user_id quand on peut
    if (userId) {
      const stmt = db.prepare(
        "DELETE FROM bank_csv_uploads WHERE id = ? AND user_id = ?",
      );
      const result = stmt.run(id, userId);
      return result.changes > 0;
    }
    const stmt = db.prepare("DELETE FROM bank_csv_uploads WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  deleteBankCsvUploadsByUser(userId) {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM bank_csv_uploads WHERE user_id = ?");
    const result = stmt.run(userId);
    return result.changes;
  }

  updateBankCsvUpload(id, userId, updates) {
    const db = this.getDatabase();
    const allowed = ["filename", "content", "size_bytes"];
    const fields = Object.keys(updates || {}).filter((k) => {
      if (!allowed.includes(k)) return false;
      // Don't write NULL/undefined into NOT NULL columns accidentally
      return updates[k] !== undefined && updates[k] !== null;
    });
    if (fields.length === 0) return false;

    const setClause = fields.map((f) => `${f} = ?`).join(", ");
    const values = fields.map((f) => updates[f]);

    const stmt = db.prepare(
      `UPDATE bank_csv_uploads SET ${setClause} WHERE id = ? AND user_id = ?`,
    );
    const result = stmt.run(...values, id, userId || "Romain");
    return result.changes > 0;
  }

  // ===== GESTION TRICOUNT / BUDGET FAMILLE =====

  getAllTricountExpenses(userId = "Romain") {
    const db = this.getDatabase();
    const rows = db
      .prepare(
        "SELECT * FROM tricount_expenses WHERE user_id = ? OR user_id IS NULL ORDER BY date DESC, created_at DESC",
      )
      .all(userId || "Romain");
    return rows.map((r) => ({
      id: r.id,
      month: r.month,
      date: r.date,
      label: r.label,
      amount: r.amount,
      payerPersonId: r.payer_person_id,
      pocketId: r.pocket_id,
      pocketName: r.pocket_name,
      subPocketId: r.sub_pocket_id,
      subPocketName: r.sub_pocket_name,
      splitMethod: r.split_method,
      nature: r.nature,
      source: r.source,
      bankAccount: r.bank_account,
      bankReference: r.bank_reference,
      bankRowId: r.bank_row_id,
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }

  saveTricountExpense(exp, userId = "Romain") {
    const db = this.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tricount_expenses (
        id, user_id, month, date, label, amount, payer_person_id,
        pocket_id, pocket_name, sub_pocket_id, sub_pocket_name,
        split_method, nature, source, bank_account, bank_reference,
        bank_row_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        month = excluded.month,
        date = excluded.date,
        label = excluded.label,
        amount = excluded.amount,
        payer_person_id = excluded.payer_person_id,
        pocket_id = excluded.pocket_id,
        pocket_name = excluded.pocket_name,
        sub_pocket_id = excluded.sub_pocket_id,
        sub_pocket_name = excluded.sub_pocket_name,
        split_method = excluded.split_method,
        nature = excluded.nature,
        source = excluded.source,
        bank_account = excluded.bank_account,
        bank_reference = excluded.bank_reference,
        bank_row_id = excluded.bank_row_id,
        notes = excluded.notes
    `);

    stmt.run(
      exp.id,
      userId || "Romain",
      exp.month,
      exp.date,
      exp.label,
      exp.amount,
      exp.payerPersonId || "person1",
      exp.pocketId || "unallocated",
      exp.pocketName || null,
      exp.subPocketId || null,
      exp.subPocketName || null,
      exp.splitMethod || "50_50",
      exp.nature || "expense",
      exp.source || "manual",
      exp.bankAccount || null,
      exp.bankReference || null,
      exp.bankRowId || null,
      exp.notes || null,
      exp.createdAt || Date.now(),
    );
    return exp.id;
  }

  saveTricountExpensesBatch(expenses, userId = "Romain") {
    if (!Array.isArray(expenses) || expenses.length === 0) return 0;
    const db = this.getDatabase();
    const insertMany = db.transaction((items) => {
      for (const exp of items) {
        this.saveTricountExpense(exp, userId);
      }
    });
    insertMany(expenses);
    return expenses.length;
  }

  deleteTricountExpense(id, userId = "Romain") {
    const db = this.getDatabase();
    const result = db
      .prepare(
        "DELETE FROM tricount_expenses WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      )
      .run(id, userId || "Romain");
    return result.changes > 0;
  }

  getAllTricountIncomes(userId = "Romain") {
    const db = this.getDatabase();
    const rows = db
      .prepare(
        "SELECT * FROM tricount_incomes WHERE user_id = ? OR user_id IS NULL ORDER BY date DESC, created_at DESC",
      )
      .all(userId || "Romain");
    return rows.map((r) => ({
      id: r.id,
      month: r.month,
      date: r.date,
      label: r.label,
      amount: r.amount,
      beneficiaryPersonId: r.beneficiary_person_id,
      source: r.source,
      bankAccount: r.bank_account,
      bankReference: r.bank_reference,
      bankRowId: r.bank_row_id,
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }

  saveTricountIncome(inc, userId = "Romain") {
    const db = this.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tricount_incomes (
        id, user_id, month, date, label, amount, beneficiary_person_id,
        source, bank_account, bank_reference, bank_row_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        month = excluded.month,
        date = excluded.date,
        label = excluded.label,
        amount = excluded.amount,
        beneficiary_person_id = excluded.beneficiary_person_id,
        source = excluded.source,
        bank_account = excluded.bank_account,
        bank_reference = excluded.bank_reference,
        bank_row_id = excluded.bank_row_id,
        notes = excluded.notes
    `);

    stmt.run(
      inc.id,
      userId || "Romain",
      inc.month,
      inc.date,
      inc.label,
      inc.amount,
      inc.beneficiaryPersonId || "person1",
      inc.source || "manual",
      inc.bankAccount || null,
      inc.bankReference || null,
      inc.bankRowId || null,
      inc.notes || null,
      inc.createdAt || Date.now(),
    );
    return inc.id;
  }

  saveTricountIncomesBatch(incomes, userId = "Romain") {
    if (!Array.isArray(incomes) || incomes.length === 0) return 0;
    const db = this.getDatabase();
    const insertMany = db.transaction((items) => {
      for (const inc of items) {
        this.saveTricountIncome(inc, userId);
      }
    });
    insertMany(incomes);
    return incomes.length;
  }

  deleteTricountIncome(id, userId = "Romain") {
    const db = this.getDatabase();
    const result = db
      .prepare(
        "DELETE FROM tricount_incomes WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      )
      .run(id, userId || "Romain");
    return result.changes > 0;
  }

  getAllTricountConfigs(userId = "Romain") {
    const db = this.getDatabase();
    const rows = db
      .prepare(
        "SELECT * FROM tricount_configs WHERE user_id = ? OR user_id IS NULL",
      )
      .all(userId || "Romain");
    const map = {};
    for (const r of rows) {
      map[r.month] = {
        month: r.month,
        p1Income: r.p1_income,
        p2Income: r.p2_income,
        isStrategyApplied: Boolean(r.is_strategy_applied),
        appliedStrategyDate: r.applied_strategy_date,
        targetSavingsRate: r.target_savings_rate,
        notes: r.notes,
      };
    }
    return map;
  }

  saveTricountConfig(conf, userId = "Romain") {
    const db = this.getDatabase();
    const id = `${userId || "Romain"}_${conf.month}`;
    const stmt = db.prepare(`
      INSERT INTO tricount_configs (
        id, month, user_id, p1_income, p2_income, is_strategy_applied,
        applied_strategy_date, target_savings_rate, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        p1_income = excluded.p1_income,
        p2_income = excluded.p2_income,
        is_strategy_applied = excluded.is_strategy_applied,
        applied_strategy_date = excluded.applied_strategy_date,
        target_savings_rate = excluded.target_savings_rate,
        notes = excluded.notes
    `);

    stmt.run(
      id,
      conf.month,
      userId || "Romain",
      conf.p1Income || 0,
      conf.p2Income || 0,
      conf.isStrategyApplied ? 1 : 0,
      conf.appliedStrategyDate || null,
      conf.targetSavingsRate || null,
      conf.notes || null,
    );
    return id;
  }

  restoreTricountFromBankCsv(userId = "Romain", targetMonths = ["2026-09", "2026-10"]) {
    const db = this.getDatabase();
    // Trouver le dernier upload BoursoBank
    const upload = db
      .prepare(
        "SELECT id, filename, content FROM bank_csv_uploads WHERE user_id = ? AND (filename LIKE '%bourso-bank%' OR section = 'bank') ORDER BY uploaded_at DESC LIMIT 1",
      )
      .get(userId || "Romain");

    if (!upload) {
      return { expenses: 0, incomes: 0, message: "Aucun fichier bancaire trouvé" };
    }

    const lines = upload.content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);

    if (lines.length <= 1) {
      return { expenses: 0, incomes: 0, message: "Fichier bancaire vide" };
    }

    const parseLine = (line, delimiter = ";") => {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
            continue;
          }
          inQuotes = !inQuotes;
          continue;
        }
        if (!inQuotes && ch === delimiter) {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out.map((v) => v.trim());
    };

    const headers = parseLine(lines[0], ";");
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseLine(lines[i], ";");
      const r = {};
      for (let c = 0; c < headers.length; c++) {
        r[headers[c]] = values[c] || "";
      }
      rows.push(r);
    }

    const filtered = rows.filter((r) =>
      targetMonths.some((m) => (r.dateOp || "").startsWith(m)),
    );

    const expenses = [];
    const incomes = [];

    filtered.forEach((r, idx) => {
      const rawAmt = parseFloat((r.amount || "0").replace(",", "."));
      const month = (r.dateOp || "").slice(0, 7);
      const date = r.dateOp || `${month}-01`;
      const cleanLabel = (r.label || "")
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&");

      if (rawAmt > 0) {
        incomes.push({
          id: `inc-bank-${r.reference || idx}`,
          month,
          date,
          label: cleanLabel,
          amount: Math.round(rawAmt * 100) / 100,
          beneficiaryPersonId: cleanLabel.toLowerCase().includes("caf")
            ? "shared"
            : "person1",
          source: "bank_import",
          bankAccount: r.accountLabel || "BoursoBank",
          bankReference: r.reference || undefined,
          bankRowId: `${upload.id}:${idx}`,
          createdAt: Date.now() + idx,
        });
      } else if (rawAmt < 0) {
        const absAmt = Math.abs(rawAmt);
        let pocketId = "unallocated";
        let pocketName = "Autre / Non classé";
        let subPocketId = undefined;
        let subPocketName = undefined;

        const cat = (r.category || "").toLowerCase();
        const lbl = cleanLabel.toLowerCase();

        if (
          cat.includes("alimentation") ||
          cat.includes("restaurant") ||
          lbl.includes("deliveroo") ||
          lbl.includes("intermarché") ||
          lbl.includes("boulangerie") ||
          lbl.includes("too good to go") ||
          lbl.includes("kfc") ||
          lbl.includes("chicken street")
        ) {
          pocketId = "poc-2";
          pocketName = "Alimentation & quotidien";
          subPocketId = "sub-5";
          subPocketName = "Courses supermarché";
        } else if (
          cat.includes("carburant") ||
          cat.includes("péages") ||
          cat.includes("transport") ||
          lbl.includes("totalenergies") ||
          lbl.includes("cofiroute") ||
          lbl.includes("sanef")
        ) {
          pocketId = "poc-2";
          pocketName = "Alimentation & quotidien";
          subPocketId = "sub-6";
          subPocketName = "Transports en commun";
        } else if (
          cat.includes("médecin") ||
          cat.includes("santé") ||
          cat.includes("pharmacie") ||
          lbl.includes("docteur") ||
          lbl.includes("pharmacie") ||
          lbl.includes("dr boudart")
        ) {
          pocketId = "poc-2";
          pocketName = "Alimentation & quotidien";
          subPocketId = "sub-7";
          subPocketName = "Santé & pharmacie";
        } else if (
          cat.includes("loyer") ||
          cat.includes("prêt") ||
          cat.includes("energie") ||
          lbl.includes("edf") ||
          lbl.includes("la banque postale") ||
          lbl.includes("sci ctm")
        ) {
          pocketId = "poc-1";
          pocketName = "Loyer & charges fixes";
          if (lbl.includes("edf")) {
            subPocketId = "sub-2";
            subPocketName = "Électricité & Gaz";
          } else {
            subPocketId = "sub-1";
            subPocketName = "Loyer";
          }
        }

        expenses.push({
          id: `exp-bank-${r.reference || idx}`,
          month,
          date,
          label: cleanLabel,
          amount: Math.round(absAmt * 100) / 100,
          payerPersonId: "person1",
          pocketId,
          pocketName,
          subPocketId,
          subPocketName,
          splitMethod: "50_50",
          nature: "expense",
          source: "bank_import",
          bankAccount: r.accountLabel || "BoursoBank",
          bankReference: r.reference || undefined,
          bankRowId: `${upload.id}:${idx}`,
          createdAt: Date.now() + idx,
        });
      }
    });

    this.saveTricountExpensesBatch(expenses, userId);
    this.saveTricountIncomesBatch(incomes, userId);

    return {
      expenses: expenses.length,
      incomes: incomes.length,
      message: `${expenses.length} dépenses et ${incomes.length} revenus restaurés pour ${targetMonths.join(", ")}`,
    };
  }

  // ===== GESTION DE LA STRATÉGIE D'ÉPARGNE =====
  getSavingsStrategy(userId = "Romain") {
    const db = this.getDatabase();
    const row = db
      .prepare("SELECT strategy_json FROM savings_strategies WHERE user_id = ?")
      .get(userId || "Romain");
    if (!row) return null;
    try {
      return JSON.parse(row.strategy_json);
    } catch (e) {
      console.error("Erreur parsing strategy_json:", e);
      return null;
    }
  }

  saveSavingsStrategy(userId = "Romain", strategy) {
    if (!strategy) return false;
    const db = this.getDatabase();
    const jsonStr = typeof strategy === "string" ? strategy : JSON.stringify(strategy);
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO savings_strategies (user_id, strategy_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        strategy_json = excluded.strategy_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(userId || "Romain", jsonStr, now);
    return true;
  }

  getAllSavingsMonthlyStrategies(userId = "Romain") {
    const db = this.getDatabase();
    const rows = db
      .prepare("SELECT month, strategy_json FROM savings_monthly_strategies WHERE user_id = ?")
      .all(userId || "Romain");
    const result = {};
    for (const r of rows) {
      try {
        result[r.month] = JSON.parse(r.strategy_json);
      } catch (e) {
        console.error("Erreur parsing monthly strategy_json:", e);
      }
    }
    return result;
  }

  getSavingsStrategyForMonth(userId = "Romain", month) {
    if (!month) return null;
    const db = this.getDatabase();
    const id = `${userId || "Romain"}_${month}`;
    const row = db
      .prepare("SELECT strategy_json FROM savings_monthly_strategies WHERE id = ?")
      .get(id);
    if (!row) return null;
    try {
      return JSON.parse(row.strategy_json);
    } catch (e) {
      return null;
    }
  }

  saveSavingsStrategyForMonth(userId = "Romain", month, strategy) {
    if (!strategy || !month) return false;
    const db = this.getDatabase();
    const id = `${userId || "Romain"}_${month}`;
    const jsonStr = typeof strategy === "string" ? strategy : JSON.stringify(strategy);
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO savings_monthly_strategies (id, user_id, month, strategy_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        strategy_json = excluded.strategy_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(id, userId || "Romain", month, jsonStr, now);
    return true;
  }

  saveAllSavingsMonthlyStrategies(userId = "Romain", map) {
    if (!map || typeof map !== "object") return false;
    for (const month of Object.keys(map)) {
      this.saveSavingsStrategyForMonth(userId, month, map[month]);
    }
    return true;
  }

  // ===== GESTION DES PARAMÈTRES UTILISATEUR =====
  getUserSettings(userId = "Romain") {
    const db = this.getDatabase();
    const row = db
      .prepare("SELECT settings_json FROM user_settings WHERE user_id = ?")
      .get(userId || "Romain");
    if (!row) return null;
    try {
      return JSON.parse(row.settings_json);
    } catch (e) {
      console.error("Erreur parsing settings_json:", e);
      return null;
    }
  }

  saveUserSettings(userId = "Romain", settings) {
    if (!settings) return false;
    const db = this.getDatabase();
    const jsonStr = typeof settings === "string" ? settings : JSON.stringify(settings);
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO user_settings (user_id, settings_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        settings_json = excluded.settings_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(userId || "Romain", jsonStr, now);
    return true;
  }

  // Statistiques de la base de données
  getDatabaseStats() {
    const db = this.getDatabase();

    const walletCount = db
      .prepare("SELECT COUNT(*) as count FROM wallets")
      .get();
    const assetCount = db
      .prepare("SELECT COUNT(*) as count FROM wallet_assets")
      .get();
    const bankCsvCount = db
      .prepare("SELECT COUNT(*) as count FROM bank_csv_uploads")
      .get();
    const tricountExpenseCount = db
      .prepare("SELECT COUNT(*) as count FROM tricount_expenses")
      .get();
    const tricountIncomeCount = db
      .prepare("SELECT COUNT(*) as count FROM tricount_incomes")
      .get();

    return {
      wallets: walletCount.count,
      assets: assetCount.count,
      bankCsvUploads: bankCsvCount.count,
      tricountExpenses: tricountExpenseCount.count,
      tricountIncomes: tricountIncomeCount.count,
      databasePath: this.dbPath,
      lastUpdated: new Date().toISOString(),
    };
  }
}

export default DatabaseManager;
