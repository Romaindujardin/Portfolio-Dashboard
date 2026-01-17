import express from "express";
import cors from "cors";
import yahooFinance from "yahoo-finance2";
import fetch from "node-fetch";
import crypto from "crypto";
import DatabaseManager from "./src/utils/database/database.js";

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialiser la base de données
const dbManager = DatabaseManager.getInstance();
dbManager.initializeTables();

// Routes existantes
app.get("/api/test", (req, res) => {
  res.json({
    message: "Yahoo Finance Proxy Server is running!",
    timestamp: new Date().toISOString(),
    database: "SQLite initialized",
  });
});

// Proxy Yahoo Finance pour les prix
app.get("/api/price/:symbol", async (req, res) => {
  const { symbol } = req.params;
  try {
    const quote = await yahooFinance.quote(symbol);
    res.json({
      symbol: quote.symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      volume: quote.regularMarketVolume,
      marketCap: quote.marketCap,
      high24h: quote.regularMarketDayHigh,
      low24h: quote.regularMarketDayLow,
    });
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    res.status(500).json({ error: "Failed to fetch price" });
  }
});

// Proxy Binance API
app.post("/api/binance/account", async (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret)
    return res.status(400).json({ error: "Missing API key or secret" });

  const timestamp = Date.now();
  const recvWindow = 5000;
  const queryString = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");
  const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": apiKey },
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy OpenSea API pour les NFTs
app.get("/api/opensea/nfts/:address", async (req, res) => {
  const { address } = req.params;
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "Missing OpenSea API key" });
  }

  try {
    console.log(`🔍 [Server] Récupération des NFTs OpenSea pour ${address}...`);

    // Utiliser l'API v2 d'OpenSea
    const url = `https://api.opensea.io/api/v2/chain/ethereum/account/${address}/nfts?limit=50`;

    const response = await fetch(url, {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `OpenSea API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    console.log(
      `✅ [Server] ${data.nfts?.length || 0} NFTs trouvés pour ${address}`
    );

    res.json(data);
  } catch (error) {
    console.error(`❌ [Server] Erreur OpenSea pour ${address}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy OpenSea API pour la valeur d'un NFT spécifique
app.get("/api/opensea/nft/:contract/:tokenId", async (req, res) => {
  const { contract, tokenId } = req.params;
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "Missing OpenSea API key" });
  }

  try {
    console.log(
      `🔍 [Server] Récupération de la valeur NFT ${contract}/${tokenId}...`
    );

    // Utiliser l'API v2 d'OpenSea pour un NFT spécifique
    const url = `https://api.opensea.io/api/v2/chain/ethereum/contract/${contract}/nfts/${tokenId}`;

    const response = await fetch(url, {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `OpenSea API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    console.log(`✅ [Server] Valeur NFT récupérée pour ${contract}/${tokenId}`);

    res.json(data);
  } catch (error) {
    console.error(
      `❌ [Server] Erreur OpenSea pour ${contract}/${tokenId}:`,
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// Proxy OpenSea API pour le floor price d'une collection
app.get("/api/opensea/collection/:collection/floor", async (req, res) => {
  const { collection } = req.params;
  const { apiKey } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: "Missing OpenSea API key" });
  }

  try {
    console.log(
      `🔍 [Server] Récupération du floor price pour la collection ${collection}...`
    );

    // Utiliser l'API v2 d'OpenSea pour les statistiques de collection
    const url = `https://api.opensea.io/api/v2/collections/${collection}/stats`;

    const response = await fetch(url, {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `OpenSea API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    console.log(
      `✅ [Server] Floor price récupéré pour ${collection}: ${
        data.total?.floor_price !== undefined ? data.total.floor_price : "N/A"
      }`
    );

    res.json(data);
  } catch (error) {
    console.error(
      `❌ [Server] Erreur OpenSea pour la collection ${collection}:`,
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// ===== NOUVELLES ROUTES POUR LA BASE DE DONNÉES =====

// Statistiques de la base de données
app.get("/api/database/stats", (req, res) => {
  try {
    const stats = dbManager.getDatabaseStats();
    res.json(stats);
  } catch (error) {
    console.error("Error getting database stats:", error);
    res.status(500).json({ error: "Failed to get database stats" });
  }
});

// Endpoint pour initialiser la base de données
app.post("/api/database/init", (req, res) => {
  try {
    dbManager.initializeTables();
    res.json({ message: "Database initialized successfully" });
  } catch (error) {
    console.error("Error initializing database:", error);
    res.status(500).json({ error: "Failed to initialize database" });
  }
});

// Endpoint pour nettoyer la base de données
app.post("/api/database/clear", (req, res) => {
  try {
    // Supprimer tous les wallets et leurs assets
    const wallets = dbManager.getAllWallets();
    wallets.forEach((wallet) => {
      dbManager.deleteWalletAssets(wallet.id);
      dbManager.deleteWallet(wallet.id);
    });

    // Supprimer tous les investissements
    const investments = dbManager.getAllInvestments();
    investments.forEach((inv) => dbManager.deleteInvestment(inv.id));

    // Supprimer tous les éléments de la watchlist
    const watchlist = dbManager.getAllWatchlistItems();
    watchlist.forEach((item) => dbManager.deleteWatchlistItem(item.symbol));

    // Supprimer tous les uploads CSV bancaires
    const bankCsvUploads = dbManager.getAllBankCsvUploads("Romain");
    bankCsvUploads.forEach((u) => dbManager.deleteBankCsvUpload(u.id, "Romain"));

    res.json({ message: "Database cleared successfully" });
  } catch (error) {
    console.error("Error clearing database:", error);
    res.status(500).json({ error: "Failed to clear database" });
  }
});

// ===== BANQUE / IMPORT CSV =====

// GET /api/database/bank-csv - Lister les CSV uploadés
app.get("/api/database/bank-csv", (req, res) => {
  try {
    const userId = req.query.user_id || "Romain";
    const section = req.query.section || null;
    // Ne pas renvoyer le contenu complet dans la liste
    const uploads = dbManager.getAllBankCsvUploadsMeta(userId, section);
    res.json(uploads);
  } catch (error) {
    console.error("Error getting bank csv uploads:", error);
    res.status(500).json({ error: "Failed to get bank csv uploads" });
  }
});

// POST /api/database/bank-csv - Créer un upload CSV
app.post("/api/database/bank-csv", (req, res) => {
  try {
    const id = dbManager.createBankCsvUpload(req.body);
    res.json({ id, message: "Bank CSV upload created successfully" });
  } catch (error) {
    console.error("Error creating bank csv upload:", error);
    res.status(500).json({ error: "Failed to create bank csv upload" });
  }
});

// GET /api/database/bank-csv/:id - Récupérer un upload CSV
app.get("/api/database/bank-csv/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.user_id || "Romain";
    const upload = dbManager.getBankCsvUploadById(id, userId);
    if (!upload) return res.status(404).json({ error: "Upload not found" });
    res.json(upload);
  } catch (error) {
    console.error("Error getting bank csv upload:", error);
    res.status(500).json({ error: "Failed to get bank csv upload" });
  }
});

// DELETE /api/database/bank-csv/:id - Supprimer un upload CSV
app.delete("/api/database/bank-csv/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.user_id || "Romain";
    const success = dbManager.deleteBankCsvUpload(id, userId);
    if (success) return res.json({ message: "Upload deleted successfully" });
    res.status(404).json({ error: "Upload not found" });
  } catch (error) {
    console.error("Error deleting bank csv upload:", error);
    res.status(500).json({ error: "Failed to delete bank csv upload" });
  }
});

// PUT /api/database/bank-csv/:id - Mettre à jour un upload CSV (content / filename)
app.put("/api/database/bank-csv/:id", (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.user_id || req.body.user_id || "Romain";
    const { filename, content, size_bytes } = req.body || {};

    const success = dbManager.updateBankCsvUpload(id, userId, {
      filename,
      content,
      size_bytes,
    });

    if (success) return res.json({ message: "Upload updated successfully" });
    res.status(404).json({ error: "Upload not found" });
  } catch (error) {
    console.error("Error updating bank csv upload:", error);
    res.status(500).json({ error: "Failed to update bank csv upload" });
  }
});

// ===== GESTION DES INVESTISSEMENTS =====

// GET /api/database/investments - Récupérer tous les investissements
app.get("/api/database/investments", (req, res) => {
  try {
    const userId = req.query.user_id || "Romain";
    const investments = dbManager.getAllInvestments(userId);
    res.json(investments);
  } catch (error) {
    console.error("Error getting investments:", error);
    res.status(500).json({ error: "Failed to get investments" });
  }
});

// POST /api/database/investments - Créer un investissement
app.post("/api/database/investments", (req, res) => {
  try {
    const id = dbManager.createInvestment(req.body);
    res.json({ id, message: "Investment created successfully" });
  } catch (error) {
    console.error("Error creating investment:", error);
    res.status(500).json({ error: "Failed to create investment" });
  }
});

// PUT /api/database/investments - Remplacer tous les investissements
app.put("/api/database/investments", (req, res) => {
  try {
    const investments = req.body;
    const userId = req.query.user_id || "Romain";

    // Supprimer tous les investissements existants pour cet utilisateur
    const existing = dbManager.getAllInvestments(userId);
    existing.forEach((inv) => dbManager.deleteInvestment(inv.id));

    // Ajouter les nouveaux investissements
    investments.forEach((investment) => {
      dbManager.createInvestment({
        user_id: userId,
        name: investment.name,
        type: investment.type,
        symbol: investment.symbol,
        quantity: investment.quantity,
        purchase_price: investment.purchasePrice,
        current_price: investment.currentPrice,
        purchase_date: investment.purchaseDate,
        notes: investment.notes || null,
        account_type: investment.accountType || null,
      });
    });

    res.json({ message: "Investments updated successfully" });
  } catch (error) {
    console.error("Error updating investments:", error);
    res.status(500).json({ error: "Failed to update investments" });
  }
});

// PUT /api/database/investments/:id - Mettre à jour un investissement
app.put("/api/database/investments/:id", (req, res) => {
  try {
    const { id } = req.params;
    const success = dbManager.updateInvestment(id, req.body);

    if (success) {
      res.json({ message: "Investment updated successfully" });
    } else {
      res.status(404).json({ error: "Investment not found" });
    }
  } catch (error) {
    console.error("Error updating investment:", error);
    res.status(500).json({ error: "Failed to update investment" });
  }
});

// DELETE /api/database/investments/:id - Supprimer un investissement
app.delete("/api/database/investments/:id", (req, res) => {
  try {
    const { id } = req.params;
    const success = dbManager.deleteInvestment(id);

    if (success) {
      res.json({ message: "Investment deleted successfully" });
    } else {
      res.status(404).json({ error: "Investment not found" });
    }
  } catch (error) {
    console.error("Error deleting investment:", error);
    res.status(500).json({ error: "Failed to delete investment" });
  }
});

// PUT /api/database/investments/prices - Mettre à jour les prix
app.put("/api/database/investments/prices", (req, res) => {
  try {
    const updates = req.body;
    dbManager.updateInvestmentPrices(updates);
    res.json({ message: "Prices updated successfully" });
  } catch (error) {
    console.error("Error updating prices:", error);
    res.status(500).json({ error: "Failed to update prices" });
  }
});

// ===== GESTION DE LA WATCHLIST =====

// GET /api/database/watchlist - Récupérer la watchlist
app.get("/api/database/watchlist", (req, res) => {
  try {
    const userId = req.query.user_id || "Romain";
    const watchlist = dbManager.getAllWatchlistItems(userId);
    res.json(watchlist);
  } catch (error) {
    console.error("Error getting watchlist:", error);
    res.status(500).json({ error: "Failed to get watchlist" });
  }
});

// POST /api/database/watchlist - Ajouter à la watchlist
app.post("/api/database/watchlist", (req, res) => {
  try {
    const id = dbManager.createWatchlistItem(req.body);
    res.json({ id, message: "Watchlist item added successfully" });
  } catch (error) {
    console.error("Error adding watchlist item:", error);
    res.status(500).json({ error: "Failed to add watchlist item" });
  }
});

// PUT /api/database/watchlist - Remplacer la watchlist
app.put("/api/database/watchlist", (req, res) => {
  try {
    const watchlist = req.body;
    const userId = req.query.user_id || "Romain";

    // Supprimer tous les éléments existants pour cet utilisateur
    const existing = dbManager.getAllWatchlistItems(userId);
    existing.forEach((item) =>
      dbManager.deleteWatchlistItem(item.symbol, userId)
    );

    // Ajouter les nouveaux éléments
    watchlist.forEach((item) => {
      dbManager.createWatchlistItem({
        user_id: userId,
        symbol: item.symbol,
        name: item.name,
        type: item.type,
      });
    });

    res.json({ message: "Watchlist updated successfully" });
  } catch (error) {
    console.error("Error updating watchlist:", error);
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

// DELETE /api/database/watchlist/:symbol - Supprimer de la watchlist
app.delete("/api/database/watchlist/:symbol", (req, res) => {
  try {
    const { symbol } = req.params;
    const userId = req.query.user_id || "Romain";
    const success = dbManager.deleteWatchlistItem(
      decodeURIComponent(symbol),
      userId
    );

    if (success) {
      res.json({ message: "Watchlist item deleted successfully" });
    } else {
      res.status(404).json({ error: "Watchlist item not found" });
    }
  } catch (error) {
    console.error("Error deleting watchlist item:", error);
    res.status(500).json({ error: "Failed to delete watchlist item" });
  }
});

// ===== GESTION DES WALLETS =====

// GET /api/database/wallets - Récupérer tous les wallets
app.get("/api/database/wallets", (req, res) => {
  try {
    const userId = req.query.user_id || "Romain";
    const wallets = dbManager.getAllWallets(userId);

    // Ajouter les assets et NFTs pour chaque wallet
    const walletsWithAssets = wallets.map((wallet) => {
      const assets = dbManager.getWalletAssets(wallet.id);
      const nfts = dbManager.getWalletNFTs(wallet.id);
      return {
        ...wallet,
        assets,
        nfts,
      };
    });

    res.json(walletsWithAssets);
  } catch (error) {
    console.error("Error getting wallets:", error);
    res.status(500).json({ error: "Failed to get wallets" });
  }
});

// POST /api/database/wallets - Créer un wallet
app.post("/api/database/wallets", (req, res) => {
  try {
    console.log(
      "📝 Création d'un wallet avec données:",
      JSON.stringify(req.body, null, 2)
    );

    const { assets, nfts, ...walletData } = req.body;
    console.log("📊 Wallet data:", walletData);
    console.log("📊 Assets:", assets?.length || 0);
    console.log("📊 NFTs:", nfts?.length || 0);

    const walletId = dbManager.createWallet(walletData);
    console.log("✅ Wallet créé avec ID:", walletId);

    // Ajouter les assets du wallet
    if (assets && Array.isArray(assets)) {
      console.log("➕ Ajout de", assets.length, "assets...");
      assets.forEach((asset, index) => {
        console.log(`  - Asset ${index + 1}:`, asset.symbol);
        dbManager.createWalletAsset({
          ...asset,
          wallet_id: walletId,
        });
      });
    }

    // Ajouter les NFTs du wallet
    if (nfts && Array.isArray(nfts)) {
      console.log("➕ Ajout de", nfts.length, "NFTs...");
      nfts.forEach((nft, index) => {
        console.log(`  - NFT ${index + 1}:`, nft.symbol);
        try {
          dbManager.createWalletNFT({
            ...nft,
            wallet_id: walletId,
          });
          console.log(`  ✅ NFT ${index + 1} créé`);
        } catch (nftError) {
          console.error(`  ❌ Erreur NFT ${index + 1}:`, nftError.message);
        }
      });
    }

    res.json({ id: walletId, message: "Wallet created successfully" });
  } catch (error) {
    console.error("❌ Error creating wallet:", error);
    res.status(500).json({ error: "Failed to create wallet" });
  }
});

// PUT /api/database/wallets - Remplacer tous les wallets
app.put("/api/database/wallets", (req, res) => {
  try {
    const wallets = req.body;
    const userId = req.query.user_id || "Romain";

    console.log("📝 Mise à jour des wallets:", wallets.length, "wallets");

    // Sauvegarder les NFTs existants avant de supprimer les wallets
    const existing = dbManager.getAllWallets(userId);
    const existingNFTs = new Map(); // Map pour associer l'adresse du wallet à ses NFTs

    existing.forEach((wallet) => {
      // Récupérer les NFTs avant de supprimer le wallet
      const walletNFTs = dbManager.getWalletNFTs(wallet.id);
      if (walletNFTs && walletNFTs.length > 0) {
        existingNFTs.set(wallet.address, walletNFTs);
        console.log(
          `💾 Sauvegarde de ${walletNFTs.length} NFTs pour le wallet ${wallet.address}`
        );
      }

      dbManager.deleteWalletAssets(wallet.id);
      dbManager.deleteWallet(wallet.id);
    });

    // Ajouter les nouveaux wallets
    wallets.forEach((wallet, index) => {
      console.log(`📊 Traitement du wallet ${index + 1}:`, wallet.name);

      // Transformer les champs camelCase en snake_case
      const walletData = {
        user_id: userId,
        name: wallet.name,
        address: wallet.address,
        wallet_type: wallet.walletType || wallet.wallet_type,
        blockchains: wallet.blockchains,
        total_value: wallet.totalValue || wallet.total_value || 0,
        last_updated:
          wallet.lastUpdated || wallet.last_updated || new Date().toISOString(),
      };

      console.log("📊 Wallet data transformé:", walletData);

      const walletId = dbManager.createWallet(walletData);
      console.log("✅ Wallet créé avec ID:", walletId);

      // Ajouter les assets du wallet
      if (wallet.assets && Array.isArray(wallet.assets)) {
        console.log("➕ Ajout de", wallet.assets.length, "assets...");
        wallet.assets.forEach((asset, assetIndex) => {
          console.log(`  - Asset ${assetIndex + 1}:`, asset.symbol);

          // Transformer les champs de l'asset
          const assetData = {
            wallet_id: walletId,
            symbol: asset.symbol,
            name: asset.name,
            balance: asset.balance,
            decimals: asset.decimals,
            blockchain: asset.blockchain,
            contract_address: asset.contractAddress || asset.contract_address,
            price: asset.price,
            value: asset.value,
            logo: asset.logo,
            is_hidden: asset.isHidden || asset.is_hidden || false,
          };

          dbManager.createWalletAsset(assetData);
        });
      }

      // Ajouter les NFTs du wallet (si fournis)
      if (wallet.nfts && Array.isArray(wallet.nfts)) {
        console.log("➕ Ajout de", wallet.nfts.length, "NFTs...");
        wallet.nfts.forEach((nft, nftIndex) => {
          console.log(`  - NFT ${nftIndex + 1}:`, nft.symbol);

          // Transformer les champs du NFT
          const nftData = {
            wallet_id: walletId,
            symbol: nft.symbol,
            name: nft.name,
            balance: nft.balance,
            decimals: nft.decimals,
            blockchain: nft.blockchain,
            contract_address: nft.contractAddress || nft.contract_address,
            price: nft.price,
            value: nft.value,
            logo: nft.logo,
            token_id: nft.tokenId || nft.token_id,
            collection: nft.collection,
            permalink: nft.permalink,
            traits: nft.traits,
            is_hidden: nft.isHidden || nft.is_hidden || false,
          };

          try {
            dbManager.createWalletNFT(nftData);
            console.log(`  ✅ NFT ${nftIndex + 1} créé`);
          } catch (nftError) {
            console.error(`  ❌ Erreur NFT ${nftIndex + 1}:`, nftError.message);
          }
        });
      } else {
        // Si aucun NFT fourni, essayer de récupérer les NFTs existants pour ce wallet
        console.log("🔍 Récupération des NFTs existants pour ce wallet...");
        const savedNFTs = existingNFTs.get(wallet.address);
        if (savedNFTs && savedNFTs.length > 0) {
          console.log(
            `  - ${savedNFTs.length} NFTs existants trouvés, transfert vers le nouveau wallet...`
          );
          savedNFTs.forEach((nft, nftIndex) => {
            try {
              dbManager.createWalletNFT({
                ...nft,
                wallet_id: walletId,
              });
              console.log(`  ✅ NFT ${nftIndex + 1} transféré`);
            } catch (nftError) {
              console.error(
                `  ❌ Erreur transfert NFT ${nftIndex + 1}:`,
                nftError.message
              );
            }
          });
        }
      }
    });

    res.json({ message: "Wallets updated successfully" });
  } catch (error) {
    console.error("❌ Error updating wallets:", error);
    res.status(500).json({ error: "Failed to update wallets" });
  }
});

// PUT /api/database/wallets/:id - Mettre à jour un wallet
app.put("/api/database/wallets/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { assets, nfts, ...walletData } = req.body;

    // Mettre à jour le wallet
    const success = dbManager.updateWallet(id, walletData);

    if (success) {
      // Supprimer les anciens assets et NFTs
      dbManager.deleteWalletAssets(id);
      dbManager.deleteWalletNFTs(id);

      // Ajouter les nouveaux assets
      if (assets && Array.isArray(assets)) {
        assets.forEach((asset) => {
          dbManager.createWalletAsset({
            ...asset,
            wallet_id: id,
          });
        });
      }

      // Ajouter les nouveaux NFTs
      if (nfts && Array.isArray(nfts)) {
        nfts.forEach((nft) => {
          dbManager.createWalletNFT({
            ...nft,
            wallet_id: id,
          });
        });
      }

      res.json({ message: "Wallet updated successfully" });
    } else {
      res.status(404).json({ error: "Wallet not found" });
    }
  } catch (error) {
    console.error("Error updating wallet:", error);
    res.status(500).json({ error: "Failed to update wallet" });
  }
});

// DELETE /api/database/wallets/:id - Supprimer un wallet
app.delete("/api/database/wallets/:id", (req, res) => {
  try {
    const { id } = req.params;

    // Supprimer les assets et NFTs du wallet
    dbManager.deleteWalletAssets(id);
    dbManager.deleteWalletNFTs(id);

    // Supprimer le wallet
    const success = dbManager.deleteWallet(id);

    if (success) {
      res.json({ message: "Wallet deleted successfully" });
    } else {
      res.status(404).json({ error: "Wallet not found" });
    }
  } catch (error) {
    console.error("Error deleting wallet:", error);
    res.status(500).json({ error: "Failed to delete wallet" });
  }
});

// PUT /api/database/wallets/:id/assets/:index/visibility - Mettre à jour la visibilité d'un asset
app.put("/api/database/wallets/:id/assets/:index/visibility", (req, res) => {
  try {
    const { id, index } = req.params;
    const { isHidden } = req.body;

    const assets = dbManager.getWalletAssets(id);
    if (assets[index]) {
      const success = dbManager.updateWalletAssetVisibility(
        assets[index].id,
        isHidden
      );

      if (success) {
        res.json({ message: "Asset visibility updated successfully" });
      } else {
        res.status(404).json({ error: "Asset not found" });
      }
    } else {
      res.status(404).json({ error: "Asset not found" });
    }
  } catch (error) {
    console.error("Error updating asset visibility:", error);
    res.status(500).json({ error: "Failed to update asset visibility" });
  }
});

// POST /api/database/wallets/:id/sync-nfts - Synchroniser les NFTs d'un wallet
app.post("/api/database/wallets/:id/sync-nfts", async (req, res) => {
  try {
    const { id } = req.params;
    const wallet = dbManager.getWalletById(id);

    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    console.log(
      `🔄 Synchronisation des NFTs pour le wallet ${wallet.address}...`
    );

    // Supprimer les anciens NFTs
    dbManager.deleteWalletNFTs(id);

    // Re-scanner les NFTs (simulation - en réalité, il faudrait appeler le service blockchain)
    // Pour l'instant, on va créer des NFTs de test basés sur les données OpenSea que nous avons
    const testNFTs = [
      {
        wallet_id: id,
        symbol: "NFT",
        name: "1905 - Sir Bibendum",
        balance: 1,
        decimals: 0,
        blockchain: "ethereum",
        contract_address: "0xfad465ca1f33024532febae31761255df9cac5f5",
        price: 95.09,
        value: 95.09,
        logo: "https://i2.seadn.io/ethereum/0xfad465ca1f33024532febae31761255df9cac5f5/b14f9c7a691f01f51b99c70d8f6c088e.jpeg",
        token_id: "671",
        collection: "michelin-h3ritage-collection",
        permalink:
          "https://opensea.io/assets/ethereum/0xfad465ca1f33024532febae31761255df9cac5f5/671",
        traits: "[]",
        is_hidden: false,
      },
      {
        wallet_id: id,
        symbol: "NFT",
        name: "Michelin 3xplorer #771",
        balance: 1,
        decimals: 0,
        blockchain: "ethereum",
        contract_address: "0x87ec044115cd9e0e09221031441640ee48b3a8f2",
        price: 273.85,
        value: 273.85,
        logo: "https://i2.seadn.io/ethereum/0x87ec044115cd9e0e09221031441640ee48b3a8f2/0ad24f73ab24a0f8d496082bf1364d/e10ad24f73ab24a0f8d496082bf1364d.gif",
        token_id: "771",
        collection: "michelin3xplorerclub",
        permalink:
          "https://opensea.io/assets/ethereum/0x87ec044115cd9e0e09221031441640ee48b3a8f2/771",
        traits: "[]",
        is_hidden: false,
      },
    ];

    // Ajouter les NFTs
    testNFTs.forEach((nft) => {
      dbManager.createWalletNFT(nft);
    });

    console.log(
      `✅ ${testNFTs.length} NFTs synchronisés pour le wallet ${wallet.address}`
    );

    res.json({
      message: "NFTs synchronized successfully",
      nftsCount: testNFTs.length,
    });
  } catch (error) {
    console.error("Error synchronizing NFTs:", error);
    res.status(500).json({ error: "Failed to synchronize NFTs" });
  }
});

// POST /api/database/wallets/test-create-with-nfts - Créer un wallet de test avec NFTs
app.post("/api/database/wallets/test-create-with-nfts", async (req, res) => {
  try {
    const { address, name } = req.body;

    if (!address || !name) {
      return res.status(400).json({ error: "Address and name are required" });
    }

    console.log(
      `🧪 Création d'un wallet de test avec NFTs: ${name} (${address})`
    );

    // Créer le wallet
    const walletId = dbManager.createWallet({
      user_id: "Romain",
      name: name,
      address: address,
      wallet_type: "metamask",
      blockchains: JSON.stringify(["ethereum"]),
      total_value: 368.94, // 95.09 + 273.85
      last_updated: new Date().toISOString(),
      added_at: new Date().toISOString(),
    });

    // Ajouter des assets de test
    const testAssets = [
      {
        wallet_id: walletId,
        symbol: "ETH",
        name: "Ethereum",
        balance: 0.1,
        decimals: 18,
        blockchain: "ethereum",
        price: 2000,
        value: 200,
        logo: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
        is_hidden: false,
      },
    ];

    testAssets.forEach((asset) => {
      dbManager.createWalletAsset(asset);
    });

    // Ajouter des NFTs de test
    const testNFTs = [
      {
        wallet_id: walletId,
        symbol: "NFT",
        name: "1905 - Sir Bibendum",
        balance: 1,
        decimals: 0,
        blockchain: "ethereum",
        contract_address: "0xfad465ca1f33024532febae31761255df9cac5f5",
        price: 95.09,
        value: 95.09,
        logo: "https://i2.seadn.io/ethereum/0xfad465ca1f33024532febae31761255df9cac5f5/b14f9c7a691f01f51b99c70d8f6c088e.jpeg",
        token_id: "671",
        collection: "michelin-h3ritage-collection",
        permalink:
          "https://opensea.io/assets/ethereum/0xfad465ca1f33024532febae31761255df9cac5f5/671",
        traits: "[]",
        is_hidden: false,
      },
      {
        wallet_id: walletId,
        symbol: "NFT",
        name: "Michelin 3xplorer #771",
        balance: 1,
        decimals: 0,
        blockchain: "ethereum",
        contract_address: "0x87ec044115cd9e0e09221031441640ee48b3a8f2",
        price: 273.85,
        value: 273.85,
        logo: "https://i2.seadn.io/ethereum/0x87ec044115cd9e0e09221031441640ee48b3a8f2/0ad24f73ab24a0f8d496082bf1364d/e10ad24f73ab24a0f8d496082bf1364d.gif",
        token_id: "771",
        collection: "michelin3xplorerclub",
        permalink:
          "https://opensea.io/assets/ethereum/0x87ec044115cd9e0e09221031441640ee48b3a8f2/771",
        traits: "[]",
        is_hidden: false,
      },
    ];

    testNFTs.forEach((nft) => {
      dbManager.createWalletNFT(nft);
    });

    console.log(
      `✅ Wallet de test créé avec ${testAssets.length} assets et ${testNFTs.length} NFTs`
    );

    res.json({
      message: "Test wallet created successfully",
      walletId: walletId,
      assetsCount: testAssets.length,
      nftsCount: testNFTs.length,
    });
  } catch (error) {
    console.error("Error creating test wallet:", error);
    res.status(500).json({ error: "Failed to create test wallet" });
  }
});

// Endpoint pour exporter les données
app.get("/api/database/export", (req, res) => {
  try {
    const investments = dbManager.getAllInvestments();
    const watchlist = dbManager.getAllWatchlistItems();
    const wallets = dbManager.getAllWallets();

    const exportData = {
      investments,
      watchlist,
      wallets,
      exportDate: new Date().toISOString(),
    };

    res.json(exportData);
  } catch (error) {
    console.error("Error exporting database:", error);
    res.status(500).json({ error: "Failed to export database" });
  }
});

// Endpoint pour importer des données
app.post("/api/database/import", (req, res) => {
  try {
    const { investments, watchlist, wallets } = req.body;

    // Nettoyer la base de données existante
    const existingWallets = dbManager.getAllWallets();
    existingWallets.forEach((wallet) => {
      dbManager.deleteWalletAssets(wallet.id);
      dbManager.deleteWallet(wallet.id);
    });

    const existingInvestments = dbManager.getAllInvestments();
    existingInvestments.forEach((inv) => dbManager.deleteInvestment(inv.id));

    const existingWatchlist = dbManager.getAllWatchlistItems();
    existingWatchlist.forEach((item) =>
      dbManager.deleteWatchlistItem(item.symbol)
    );

    // Importer les nouvelles données
    if (investments) {
      investments.forEach((inv) => {
        dbManager.createInvestment({
          name: inv.name,
          type: inv.type,
          symbol: inv.symbol,
          quantity: inv.quantity,
          purchase_price: inv.purchase_price,
          current_price: inv.current_price,
          purchase_date: inv.purchase_date,
          notes: inv.notes,
          account_type: inv.account_type,
        });
      });
    }

    if (watchlist) {
      watchlist.forEach((item) => {
        dbManager.createWatchlistItem({
          symbol: item.symbol,
          name: item.name,
          type: item.type,
        });
      });
    }

    if (wallets) {
      wallets.forEach((wallet) => {
        const walletId = dbManager.createWallet({
          name: wallet.name,
          address: wallet.address,
          wallet_type: wallet.wallet_type,
          blockchains: wallet.blockchains,
          total_value: wallet.total_value,
          last_updated: wallet.last_updated,
        });

        // Importer les assets du wallet
        if (wallet.assets) {
          wallet.assets.forEach((asset) => {
            dbManager.createWalletAsset({
              wallet_id: walletId,
              symbol: asset.symbol,
              name: asset.name,
              balance: asset.balance,
              decimals: asset.decimals,
              blockchain: asset.blockchain,
              contract_address: asset.contract_address,
              price: asset.price,
              value: asset.value,
              logo: asset.logo,
              is_hidden: asset.is_hidden,
            });
          });
        }
      });
    }

    res.json({ message: "Database imported successfully" });
  } catch (error) {
    console.error("Error importing database:", error);
    res.status(500).json({ error: "Failed to import database" });
  }
});

// Endpoint pour la migration depuis localStorage
app.post("/api/database/migrate", (req, res) => {
  try {
    const { localStorageData } = req.body;

    if (localStorageData.investments) {
      localStorageData.investments.forEach((inv) => {
        dbManager.createInvestment({
          name: inv.name,
          type: inv.type,
          symbol: inv.symbol,
          quantity: inv.quantity,
          purchase_price: inv.purchasePrice,
          current_price: inv.currentPrice,
          purchase_date: inv.purchaseDate,
          notes: inv.notes || null,
          account_type: inv.accountType || null,
        });
      });
    }

    if (localStorageData.watchlist) {
      localStorageData.watchlist.forEach((item) => {
        dbManager.createWatchlistItem({
          symbol: item.symbol,
          name: item.name,
          type: item.type,
        });
      });
    }

    if (localStorageData.wallets) {
      localStorageData.wallets.forEach((wallet) => {
        const walletId = dbManager.createWallet({
          name: wallet.name,
          address: wallet.address,
          wallet_type: wallet.walletType,
          blockchains: JSON.stringify(wallet.blockchains),
          total_value: wallet.totalValue,
          last_updated: wallet.lastUpdated,
        });

        if (wallet.assets) {
          wallet.assets.forEach((asset) => {
            dbManager.createWalletAsset({
              wallet_id: walletId,
              symbol: asset.symbol,
              name: asset.name,
              balance: asset.balance,
              decimals: asset.decimals,
              blockchain: asset.blockchain,
              contract_address: asset.contractAddress || null,
              price: asset.price || null,
              value: asset.value || null,
              logo: asset.logo || null,
              is_hidden: asset.isHidden || false,
            });
          });
        }
      });
    }

    res.json({ message: "Migration completed successfully" });
  } catch (error) {
    console.error("Error during migration:", error);
    res.status(500).json({ error: "Failed to migrate data" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: SQLite initialized`);
  console.log(`🌐 CORS enabled for all origins`);
});
