import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

// Types pour la base de données
export interface DBInvestment {
  id: string;
  user_id: string;
  name: string;
  type: string;
  symbol: string;
  quantity: number;
  purchase_price: number;
  current_price: number | null;
  purchase_date: string;
  notes: string | null;
  account_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBWatchlistItem {
  id: string;
  user_id: string;
  symbol: string;
  name: string;
  type: string;
  added_at: string;
}

export interface DBWallet {
  id: string;
  user_id: string;
  name: string;
  address: string;
  wallet_type: string;
  blockchains: string;
  total_value: number;
  last_updated: string;
  added_at: string;
}

export interface DBWalletAsset {
  id: string;
  wallet_id: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  blockchain: string;
  contract_address: string | null;
  price: number | null;
  value: number | null;
  logo: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface DBWalletNFT {
  id: string;
  wallet_id: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  blockchain: string;
  contract_address: string | null;
  price: number | null;
  value: number | null;
  logo: string | null;
  token_id: string | null;
  collection: string | null;
  permalink: string | null;
  traits: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

// Singleton pour la connexion à la base de données
class DatabaseManager {
  private static instance: DatabaseManager;
  private db: Database.Database | null = null;
  private dbPath: string;

  private constructor() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Créer la base de données dans le répertoire du projet (2 niveaux au-dessus de src/utils/database)
    this.dbPath = path.join(__dirname, "../../..", "portfolio.db");
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public getDatabase(): Database.Database {
    if (!this.db) {
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
    }
    return this.db;
  }

  public closeDatabase(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Initialiser les tables
  public initializeTables(): void {
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

    // Index pour améliorer les performances
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_investments_symbol ON investments (symbol);
      CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist (symbol);
      CREATE INDEX IF NOT EXISTS idx_wallet_assets_wallet_id ON wallet_assets (wallet_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_assets_symbol ON wallet_assets (symbol);
      CREATE INDEX IF NOT EXISTS idx_wallet_nfts_wallet_id ON wallet_nfts (wallet_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_nfts_symbol ON wallet_nfts (symbol);
    `);

    console.log("✅ Tables de base de données initialisées");
  }

  // Gestion des investissements
  public getAllInvestments(userId: string = "Romain"): DBInvestment[] {
    const db = this.getDatabase();
    return db
      .prepare(
        "SELECT * FROM investments WHERE user_id = ? ORDER BY created_at DESC"
      )
      .all(userId) as DBInvestment[];
  }

  public getInvestmentById(id: string): DBInvestment | null {
    const db = this.getDatabase();
    const stmt = db.prepare("SELECT * FROM investments WHERE id = ?");
    return stmt.get(id) as DBInvestment | null;
  }

  public createInvestment(
    investment: Omit<DBInvestment, "id" | "created_at" | "updated_at">
  ): string {
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
      now
    );

    return id;
  }

  public updateInvestment(
    id: string,
    investment: Partial<Omit<DBInvestment, "id" | "created_at">>
  ): boolean {
    const db = this.getDatabase();
    const now = new Date().toISOString();

    const fields = Object.keys(investment).filter(
      (key) => key !== "id" && key !== "created_at"
    );
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => (investment as any)[field]);

    const stmt = db.prepare(`
      UPDATE investments 
      SET ${setClause}, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(...values, now, id);
    return result.changes > 0;
  }

  public deleteInvestment(id: string): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM investments WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  public updateInvestmentPrices(
    investments: Array<{ id: string; current_price: number }>
  ): void {
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
  public getAllWatchlistItems(userId: string = "Romain"): DBWatchlistItem[] {
    const db = this.getDatabase();
    return db
      .prepare(
        "SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC"
      )
      .all(userId) as DBWatchlistItem[];
  }

  public createWatchlistItem(
    item: Omit<DBWatchlistItem, "id" | "added_at">
  ): string {
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
      now
    );
    return id;
  }

  public deleteWatchlistItem(symbol: string): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM watchlist WHERE symbol = ?");
    const result = stmt.run(symbol);
    return result.changes > 0;
  }

  // Gestion des wallets
  public getAllWallets(userId: string = "Romain"): DBWallet[] {
    const db = this.getDatabase();
    return db
      .prepare("SELECT * FROM wallets WHERE user_id = ? ORDER BY added_at DESC")
      .all(userId) as DBWallet[];
  }

  public getWalletById(id: string): DBWallet | null {
    const db = this.getDatabase();
    const stmt = db.prepare("SELECT * FROM wallets WHERE id = ?");
    return stmt.get(id) as DBWallet | null;
  }

  public createWallet(wallet: Omit<DBWallet, "id" | "added_at">): string {
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
      wallet.blockchains,
      wallet.total_value,
      wallet.last_updated,
      now
    );

    return id;
  }

  public updateWallet(
    id: string,
    wallet: Partial<Omit<DBWallet, "id" | "added_at">>
  ): boolean {
    const db = this.getDatabase();
    const fields = Object.keys(wallet).filter(
      (key) => key !== "id" && key !== "added_at"
    );
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => (wallet as any)[field]);

    const stmt = db.prepare(`
      UPDATE wallets 
      SET ${setClause}
      WHERE id = ?
    `);

    const result = stmt.run(...values, id);
    return result.changes > 0;
  }

  public deleteWallet(id: string): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM wallets WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // Gestion des assets des wallets
  public getWalletAssets(walletId: string): DBWalletAsset[] {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "SELECT * FROM wallet_assets WHERE wallet_id = ? ORDER BY created_at DESC"
    );
    return stmt.all(walletId) as DBWalletAsset[];
  }

  public createWalletAsset(
    asset: Omit<DBWalletAsset, "id" | "created_at" | "updated_at">
  ): string {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO wallet_assets (
        id, wallet_id, symbol, name, balance, decimals, blockchain,
        contract_address, price, value, logo, is_hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      asset.wallet_id,
      asset.symbol,
      asset.name,
      asset.balance,
      asset.decimals,
      asset.blockchain,
      asset.contract_address,
      asset.price,
      asset.value,
      asset.logo,
      asset.is_hidden ? 1 : 0,
      now,
      now
    );

    return id;
  }

  public updateWalletAsset(
    id: string,
    asset: Partial<Omit<DBWalletAsset, "id" | "created_at">>
  ): boolean {
    const db = this.getDatabase();
    const now = new Date().toISOString();

    const fields = Object.keys(asset).filter(
      (key) => key !== "id" && key !== "created_at"
    );
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => {
      const value = (asset as any)[field];
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

  public deleteWalletAssets(walletId: string): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM wallet_assets WHERE wallet_id = ?");
    const result = stmt.run(walletId);
    return result.changes > 0;
  }

  public updateWalletAssetVisibility(id: string, isHidden: boolean): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "UPDATE wallet_assets SET is_hidden = ? WHERE id = ?"
    );
    const result = stmt.run(isHidden ? 1 : 0, id);
    return result.changes > 0;
  }

  // Gestion des NFTs des wallets
  public getWalletNFTs(walletId: string): DBWalletNFT[] {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "SELECT * FROM wallet_nfts WHERE wallet_id = ? ORDER BY created_at DESC"
    );
    return stmt.all(walletId) as DBWalletNFT[];
  }

  public createWalletNFT(
    nft: Omit<DBWalletNFT, "id" | "created_at" | "updated_at">
  ): string {
    const db = this.getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

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
      nft.symbol,
      nft.name,
      nft.balance,
      nft.decimals,
      nft.blockchain,
      nft.contract_address,
      nft.price,
      nft.value,
      nft.logo,
      nft.token_id,
      nft.collection,
      nft.permalink,
      nft.traits,
      nft.is_hidden ? 1 : 0,
      now,
      now
    );

    return id;
  }

  public updateWalletNFT(
    id: string,
    nft: Partial<Omit<DBWalletNFT, "id" | "created_at">>
  ): boolean {
    const db = this.getDatabase();
    const now = new Date().toISOString();

    const fields = Object.keys(nft).filter(
      (key) => key !== "id" && key !== "created_at"
    );
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => {
      const value = (nft as any)[field];
      return field === "is_hidden" ? (value ? 1 : 0) : value;
    });

    const stmt = db.prepare(`
      UPDATE wallet_nfts 
      SET ${setClause}, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(...values, now, id);
    return result.changes > 0;
  }

  public deleteWalletNFTs(walletId: string): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare("DELETE FROM wallet_nfts WHERE wallet_id = ?");
    const result = stmt.run(walletId);
    return result.changes > 0;
  }

  public updateWalletNFTVisibility(id: string, isHidden: boolean): boolean {
    const db = this.getDatabase();
    const stmt = db.prepare(
      "UPDATE wallet_nfts SET is_hidden = ? WHERE id = ?"
    );
    const result = stmt.run(isHidden ? 1 : 0, id);
    return result.changes > 0;
  }

  // Statistiques de la base de données
  public getDatabaseStats(): any {
    const db = this.getDatabase();

    const investmentCount = db
      .prepare("SELECT COUNT(*) as count FROM investments")
      .get() as { count: number };
    const watchlistCount = db
      .prepare("SELECT COUNT(*) as count FROM watchlist")
      .get() as { count: number };
    const walletCount = db
      .prepare("SELECT COUNT(*) as count FROM wallets")
      .get() as { count: number };
    const assetCount = db
      .prepare("SELECT COUNT(*) as count FROM wallet_assets")
      .get() as { count: number };
    const nftCount = db
      .prepare("SELECT COUNT(*) as count FROM wallet_nfts")
      .get() as { count: number };

    return {
      investments: investmentCount.count,
      watchlist: watchlistCount.count,
      wallets: walletCount.count,
      assets: assetCount.count,
      nfts: nftCount.count,
      databasePath: this.dbPath,
      lastUpdated: new Date().toISOString(),
    };
  }

  // Migration depuis localStorage
  public async migrateFromLocalStorage(): Promise<void> {
    console.log("🔄 Migration depuis localStorage...");

    // Cette fonction sera implémentée dans le script de migration
    // Elle convertira les données localStorage vers SQLite
  }
}

export default DatabaseManager;
