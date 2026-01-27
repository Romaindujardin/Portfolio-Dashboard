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

    // Table des investissements
    db.exec(`
      CREATE TABLE IF NOT EXISTS investments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        symbol TEXT NOT NULL,
        quantity REAL NOT NULL,
        purchase_price REAL NOT NULL,
        current_price REAL,
        purchase_date TEXT NOT NULL,
        notes TEXT,
        account_type TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Table de la watchlist
    db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        added_at TEXT NOT NULL
      )
    `);

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

    // Supprimer la table wallet_nfts si elle existe (pour la recréer)
    db.exec(`DROP TABLE IF EXISTS wallet_nfts`);

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

    // Index pour améliorer les performances
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_investments_user_id ON investments (user_id);
      CREATE INDEX IF NOT EXISTS idx_investments_symbol ON investments (symbol);
      CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist (user_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist (symbol);
      CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets (user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_assets_wallet_id ON wallet_assets (wallet_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_assets_symbol ON wallet_assets (symbol);
      CREATE INDEX IF NOT EXISTS idx_bank_csv_uploads_user_id ON bank_csv_uploads (user_id);
      CREATE INDEX IF NOT EXISTS idx_bank_csv_uploads_uploaded_at ON bank_csv_uploads (uploaded_at);
    `);

    console.log("✅ Tables de base de données initialisées");
  }

  // Gestion des investissements
  getAllInvestments(userId = "Romain") {
    const db = this.getDatabase();
    // Gérer les anciens investissements sans user_id en les attribuant à 'Romain' par défaut
    if (userId === "Romain") {
      return db
        .prepare(
          "SELECT * FROM investments WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC",
        )
        .all(userId);
    } else {
      return db
        .prepare(
          "SELECT * FROM investments WHERE user_id = ? ORDER BY created_at DESC",
        )
        .all(userId);
    }
  }

  getInvestmentById(id) {
    const db = this.getDatabase();
    const stmt = db.prepare("SELECT * FROM investments WHERE id = ?");
    return stmt.get(id);
  }

  createInvestment(investment) {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO investments (
        id, user_id, name, type, symbol, quantity, purchase_price, current_price,
        purchase_date, notes, account_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      investment.user_id || "Romain",
      investment.name,
      investment.type,
      investment.symbol,
      investment.quantity,
      investment.purchase_price,
      investment.current_price,
      investment.purchase_date,
      investment.notes,
      investment.account_type,
      now,
      now,
    );

    return id;
  }

  updateInvestment(id, investment) {
    const db = this.getDatabase();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE investments 
      SET user_id = ?, name = ?, type = ?, symbol = ?, quantity = ?, purchase_price = ?, 
          current_price = ?, purchase_date = ?, notes = ?, account_type = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      investment.user_id || "Romain",
      investment.name,
      investment.type,
      investment.symbol,
      investment.quantity,
      investment.purchase_price,
      investment.current_price,
      investment.purchase_date,
      investment.notes,
      investment.account_type,
      now,
      id,
    );

    return result.changes > 0;
  }

  deleteInvestment(id) {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM investments WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  updateInvestmentPrices(investments) {
    const db = this.getDatabase();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE investments 
      SET current_price = ?, updated_at = ?
      WHERE id = ?
    `);

    const transaction = db.transaction(() => {
      for (const investment of investments) {
        stmt.run(investment.current_price, now, investment.id);
      }
    });

    transaction();
  }

  // Gestion de la watchlist
  getAllWatchlistItems(userId = "Romain") {
    const db = this.getDatabase();
    // Gérer les anciens éléments sans user_id en les attribuant à 'Romain' par défaut
    if (userId === "Romain") {
      return db
        .prepare(
          "SELECT * FROM watchlist WHERE user_id = ? OR user_id IS NULL ORDER BY added_at DESC",
        )
        .all(userId);
    } else {
      return db
        .prepare(
          "SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC",
        )
        .all(userId);
    }
  }

  createWatchlistItem(item) {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO watchlist (id, user_id, symbol, name, type, added_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      item.user_id || "Romain",
      item.symbol,
      item.name,
      item.type,
      now,
    );
    return id;
  }

  deleteWatchlistItem(symbol, userId = "Romain") {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "DELETE FROM watchlist WHERE symbol = ? AND user_id = ?",
    );
    const result = stmt.run(symbol, userId);
    return result.changes > 0;
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
    const fields = Object.keys(wallet).filter(
      (key) => key !== "id" && key !== "added_at",
    );
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

    const fields = Object.keys(asset).filter(
      (key) => key !== "id" && key !== "created_at",
    );
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
    stmt.run(isHidden ? 1 : 0, id);
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

    const effectiveUserId = userId || "Romain";
    if (effectiveUserId === "Romain") {
      const stmt = db.prepare(
        `UPDATE bank_csv_uploads SET ${setClause} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`,
      );
      const result = stmt.run(...values, id, effectiveUserId);
      return result.changes > 0;
    }

    const stmt = db.prepare(
      `UPDATE bank_csv_uploads SET ${setClause} WHERE id = ? AND user_id = ?`,
    );
    const result = stmt.run(...values, id, effectiveUserId);
    if (result.changes > 0) return true;

    // Legacy fallback: allow updates on rows without user_id
    const fallback = db.prepare(
      `UPDATE bank_csv_uploads SET ${setClause} WHERE id = ? AND user_id IS NULL`,
    );
    const fallbackResult = fallback.run(...values, id);
    return fallbackResult.changes > 0;
  }

  // Statistiques de la base de données
  getDatabaseStats() {
    const db = this.getDatabase();

    const investmentCount = db
      .prepare("SELECT COUNT(*) as count FROM investments")
      .get();
    const watchlistCount = db
      .prepare("SELECT COUNT(*) as count FROM watchlist")
      .get();
    const walletCount = db
      .prepare("SELECT COUNT(*) as count FROM wallets")
      .get();
    const assetCount = db
      .prepare("SELECT COUNT(*) as count FROM wallet_assets")
      .get();
    const bankCsvCount = db
      .prepare("SELECT COUNT(*) as count FROM bank_csv_uploads")
      .get();

    return {
      investments: investmentCount.count,
      watchlist: watchlistCount.count,
      wallets: walletCount.count,
      assets: assetCount.count,
      bankCsvUploads: bankCsvCount.count,
      databasePath: this.dbPath,
      lastUpdated: new Date().toISOString(),
    };
  }
}

export default DatabaseManager;
