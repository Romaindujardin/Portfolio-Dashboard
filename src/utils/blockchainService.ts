import { Wallet, WalletAsset, BlockchainConfig } from "../types";
import { getCryptoBySymbol } from "./cryptoDatabase";
import { getEtherscanApiKey, getCoinGeckoApiKey } from "./userSettings";
import { getNFTsForAddress, getCollectionFloorPrice } from "./openSeaService";

// Fonction pour récupérer le prix de l'ETH en USD
async function getETHPrice(username: string = "Romain"): Promise<number> {
  try {
    // Essayer d'abord depuis la base de données locale
    const ethData = getCryptoBySymbol("ETH");
    if (ethData && ethData.current_price) {
      return ethData.current_price;
    }

    // Sinon, utiliser l'API publique de CoinGecko
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`;
    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      return data.ethereum?.usd || 2000;
    }

    return 2000; // Prix par défaut en cas d'erreur
  } catch (error) {
    console.warn("⚠️ Erreur lors de la récupération du prix ETH:", error);
    return 2000; // Prix par défaut
  }
}

// Fonction pour obtenir la configuration blockchain avec les clés API de l'utilisateur
const getBlockchainConfig = (
  blockchain: string,
  username: string
): BlockchainConfig => {
  const baseConfigs: Record<string, Omit<BlockchainConfig, "apiKey">> = {
    ethereum: {
      name: "Ethereum",
      chainId: 1,
      rpcUrl: "https://mainnet.infura.io/v3/",
      explorerUrl: "https://etherscan.io",
      apiUrl: "https://api.etherscan.io/v2/api",
      nativeToken: {
        symbol: "ETH",
        name: "Ethereum",
        decimals: 18,
      },
    },
    bsc: {
      name: "BSC",
      chainId: 56,
      rpcUrl: "https://bsc-dataseed.binance.org/",
      explorerUrl: "https://bscscan.com",
      apiUrl: "https://api.etherscan.io/v2/api", // Utiliser Etherscan v2 pour BSC
      nativeToken: {
        symbol: "BNB",
        name: "Binance Coin",
        decimals: 18,
      },
    },
    polygon: {
      name: "Polygon",
      chainId: 137,
      rpcUrl: "https://polygon-rpc.com/",
      explorerUrl: "https://polygonscan.com",
      apiUrl: "https://api.etherscan.io/v2/api", // Utiliser Etherscan v2 pour Polygon
      nativeToken: {
        symbol: "MATIC",
        name: "Polygon",
        decimals: 18,
      },
    },
    arbitrum: {
      name: "Arbitrum",
      chainId: 42161,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      explorerUrl: "https://arbiscan.io",
      apiUrl: "https://api.etherscan.io/v2/api", // Utiliser Etherscan v2 pour Arbitrum
      nativeToken: {
        symbol: "ETH",
        name: "Ethereum",
        decimals: 18,
      },
    },
    optimism: {
      name: "Optimism",
      chainId: 10,
      rpcUrl: "https://mainnet.optimism.io",
      explorerUrl: "https://optimistic.etherscan.io",
      apiUrl: "https://api.etherscan.io/v2/api", // Utiliser Etherscan v2 pour Optimism
      nativeToken: {
        symbol: "ETH",
        name: "Ethereum",
        decimals: 18,
      },
    },
    avalanche: {
      name: "Avalanche",
      chainId: 43114,
      rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
      explorerUrl: "https://snowtrace.io",
      apiUrl: "https://api.etherscan.io/v2/api", // Utiliser Etherscan v2 pour Avalanche
      nativeToken: {
        symbol: "AVAX",
        name: "Avalanche",
        decimals: 18,
      },
    },
  };

  const baseConfig = baseConfigs[blockchain];
  if (!baseConfig) {
    throw new Error(`Blockchain non supportée: ${blockchain}`);
  }

  // Utiliser Etherscan API pour toutes les chaînes
  const apiKey = getEtherscanApiKey(username);

  if (!apiKey) {
    throw new Error(
      `Clé API non configurée pour ${blockchain}. Veuillez la configurer dans les paramètres.`
    );
  }

  return {
    ...baseConfig,
    apiKey,
  };
};

// Cache pour les prix CoinGecko (évite les appels répétés)
const coinGeckoCache = new Map<string, { price: number; timestamp: number }>();
const COINGECKO_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Compteur pour le rate limiting CoinGecko (50 appels/minute)
let coinGeckoCallCount = 0;
let coinGeckoResetTime = Date.now();

// Utilitaire pour valider une adresse Ethereum
export const isValidAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

// Fonction pour construire l'URL de l'API V2 Etherscan
function buildApiV2Url(
  module: string,
  action: string,
  address: string,
  additionalParams: string = ""
): string {
  return `${module}?module=${module}&action=${action}&address=${address}&apikey=${additionalParams}`;
}

// Fonction pour attendre un délai (rate limiting)
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fonction pour faire un appel API avec gestion du rate limiting
async function apiCallWithRetry(
  url: string,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Délai entre les appels pour respecter le rate limit (5/sec = 200ms minimum)
      if (attempt > 1) {
        await delay(delayMs * attempt); // Délai croissant en cas de retry
      } else {
        await delay(250); // Délai minimum de 250ms entre chaque appel
      }

      const response = await fetch(url);
      const data = await response.json();

      // Si on dépasse le rate limit, retry
      if (data.message && data.message.includes("rate limit")) {
        console.warn(
          `⚠️ [API V2] Rate limit atteint, tentative ${attempt}/${maxRetries}`
        );
        if (attempt === maxRetries) {
          throw new Error(`Rate limit exceeded after ${maxRetries} attempts`);
        }
        continue;
      }

      return data;
    } catch (error) {
      console.error(
        `❌ [API V2] Erreur tentative ${attempt}/${maxRetries}:`,
        error
      );
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
}

// Fonction pour gérer le rate limiting CoinGecko
async function coinGeckoApiCall(
  url: string,
  username: string = "Romain"
): Promise<any> {
  const apiKey = getCoinGeckoApiKey(username);

  // Ajouter la clé API si elle est configurée
  const separator = url.includes("?") ? "&" : "?";
  const finalUrl = apiKey
    ? `${url}${separator}x_cg_demo_api_key=${apiKey}`
    : url;

  try {
    // Vérifier le rate limiting
    const now = Date.now();
    if (now > coinGeckoResetTime) {
      coinGeckoCallCount = 0;
      coinGeckoResetTime = now + 60000; // Reset toutes les minutes
    }

    if (coinGeckoCallCount >= 50) {
      console.warn("⚠️ Rate limit CoinGecko atteint, attente...");
      await delay(60000); // Attendre 1 minute
      coinGeckoCallCount = 0;
    }

    coinGeckoCallCount++;

    const response = await fetch(finalUrl);
    const data = await response.json();

    if (response.ok) {
      return data;
    } else {
      console.error("❌ Erreur API CoinGecko:", data);
      throw new Error(`Erreur API CoinGecko: ${response.status}`);
    }
  } catch (error) {
    console.error("❌ Erreur lors de l'appel CoinGecko:", error);
    throw error;
  }
}

// Fonction pour récupérer le prix d'un token via CoinGecko
async function getTokenPriceFromCoinGecko(
  symbol: string,
  contractAddress?: string,
  username: string = "Romain"
): Promise<number | null> {
  try {
    // Vérifier le cache d'abord
    const cacheKey = contractAddress || symbol;
    const cached = coinGeckoCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < COINGECKO_CACHE_DURATION) {
      console.log(`💰 Prix en cache pour ${symbol}: $${cached.price}`);
      return cached.price;
    }

    let price = 0;

    if (contractAddress) {
      // Pour les tokens avec contrat, essayer d'abord par symbole puis par contrat
      console.log(
        `🔍 [CoinGecko] Récupération du prix pour ${symbol} (contrat: ${contractAddress})...`
      );

      // D'abord essayer de trouver le prix par symbole dans notre base
      const { getCryptoBySymbol } = await import("./cryptoDatabase");
      const cryptoData = getCryptoBySymbol(symbol);

      if (cryptoData && cryptoData.current_price) {
        price = cryptoData.current_price;
        console.log(`💰 Prix depuis la base crypto pour ${symbol}: $${price}`);
      } else {
        // Fallback: essayer l'API CoinGecko avec l'ID
        if (cryptoData && cryptoData.id) {
          const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoData.id}&vs_currencies=usd`;
          console.log(
            `🔍 [CoinGecko] Récupération du prix pour ${symbol} (ID: ${cryptoData.id})...`
          );

          const data = await coinGeckoApiCall(url, username);
          const symbolData = data[cryptoData.id];
          if (symbolData && symbolData.usd) {
            price = symbolData.usd;
          }
        } else {
          // Dernier recours: essayer l'API des contrats pour Ethereum
          const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${contractAddress}&vs_currencies=usd`;
          console.log(
            `🔍 [CoinGecko] Récupération du prix pour le contrat ${contractAddress}...`
          );

          const data = await coinGeckoApiCall(url, username);
          const tokenData = data[contractAddress.toLowerCase()];
          if (tokenData && tokenData.usd) {
            price = tokenData.usd;
          }
        }
      }
    } else {
      // Pour les tokens natifs, utiliser notre base de données crypto
      const { getCryptoBySymbol } = await import("./cryptoDatabase");
      const cryptoData = getCryptoBySymbol(symbol);

      if (cryptoData && cryptoData.current_price) {
        price = cryptoData.current_price;
        console.log(`💰 Prix depuis la base crypto pour ${symbol}: $${price}`);
      } else {
        // Fallback: essayer l'API CoinGecko avec l'ID
        if (cryptoData && cryptoData.id) {
          const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoData.id}&vs_currencies=usd`;
          console.log(
            `🔍 [CoinGecko] Récupération du prix pour ${symbol} (ID: ${cryptoData.id})...`
          );

          const data = await coinGeckoApiCall(url, username);
          const symbolData = data[cryptoData.id];
          if (symbolData && symbolData.usd) {
            price = symbolData.usd;
          }
        }
      }
    }

    if (price > 0) {
      // Mettre en cache
      coinGeckoCache.set(cacheKey, {
        price,
        timestamp: Date.now(),
      });

      console.log(`💰 Prix CoinGecko pour ${symbol}: $${price}`);
      return price;
    } else {
      console.warn(`⚠️ Prix non trouvé pour ${symbol} sur CoinGecko`);
      return null;
    }
  } catch (error) {
    console.error(
      `❌ Erreur lors de la récupération du prix CoinGecko pour ${symbol}:`,
      error
    );
    return null;
  }
}

// Récupérer le solde natif (ETH, BNB, etc.)
const getNativeBalance = async (
  address: string,
  blockchain: string,
  username: string = "Romain"
): Promise<WalletAsset | null> => {
  const config = getBlockchainConfig(blockchain, username);
  if (!config) return null;

  try {
    // Construire l'URL avec le chainid pour Etherscan v2
    const url = `${config.apiUrl}?module=account&action=balance&address=${address}&chainid=${config.chainId}&apikey=${config.apiKey}`;

    console.log(`🔍 [API] Récupération du solde natif ${blockchain}:`, url);

    const response = await apiCallWithRetry(url);
    console.log(
      `🔍 [API] Réponse complète pour ${blockchain}:`,
      JSON.stringify(response, null, 2)
    );

    // Vérifier si la réponse est valide
    if (response.status === "0" || response.status === 0) {
      console.warn(`⚠️ Erreur API pour ${blockchain}: ${response.result}`);
      return null;
    }

    const balance = response.result;
    console.log(`🔍 [API] Balance brute pour ${blockchain}:`, balance);

    // Vérifier que la balance est un nombre valide
    if (balance && balance !== "0" && !isNaN(parseFloat(balance))) {
      const balanceInEth =
        parseFloat(balance) / Math.pow(10, config.nativeToken.decimals);
      console.log(
        `🔍 [API] Balance convertie pour ${blockchain}:`,
        balanceInEth
      );

      const price = await getTokenPriceFromCoinGecko(
        config.nativeToken.symbol,
        undefined,
        username
      );

      return {
        symbol: config.nativeToken.symbol,
        name: config.nativeToken.name,
        balance: balanceInEth,
        decimals: config.nativeToken.decimals,
        blockchain,
        price: price || 0,
        value: price ? balanceInEth * price : 0,
      };
    }

    return null;
  } catch (error) {
    console.error(
      `❌ Erreur lors de la récupération du solde ${blockchain}:`,
      error
    );
    return null;
  }
};

// Récupérer les tokens ERC-20/BEP-20
const getTokenBalances = async (
  address: string,
  blockchain: string,
  username: string = "Romain"
): Promise<WalletAsset[]> => {
  const config = getBlockchainConfig(blockchain, username);
  if (!config) return [];

  try {
    // Construire l'URL avec le chainid pour Etherscan v2
    const url = `${config.apiUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=asc&chainid=${config.chainId}&apikey=${config.apiKey}`;

    console.log(`🔍 [API] Récupération des tokens ${blockchain}:`, url);

    const response = await apiCallWithRetry(url);
    const transactions = response.result;

    if (!Array.isArray(transactions)) {
      console.warn(`⚠️ Pas de transactions trouvées pour ${blockchain}`);
      return [];
    }

    // Grouper par contrat et calculer les soldes
    const tokenBalances = new Map<string, WalletAsset>();

    for (const tx of transactions) {
      const contractAddress = tx.contractAddress;
      const tokenSymbol = tx.tokenSymbol;
      const tokenName = tx.tokenName;
      const decimals = parseInt(tx.tokenDecimal);

      if (!tokenBalances.has(contractAddress)) {
        // Calculer le solde actuel
        try {
          // Construire l'URL avec le chainid pour Etherscan v2
          const balanceUrl = `${config.apiUrl}?module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${address}&chainid=${config.chainId}&apikey=${config.apiKey}`;

          const balanceResponse = await apiCallWithRetry(balanceUrl);
          const balance = balanceResponse.result;

          if (balance && balance !== "0") {
            const balanceInTokens =
              parseFloat(balance) / Math.pow(10, decimals);
            const price = await getTokenPriceFromCoinGecko(
              tokenSymbol,
              contractAddress,
              username
            );

            tokenBalances.set(contractAddress, {
              symbol: tokenSymbol,
              name: tokenName,
              balance: balanceInTokens,
              decimals,
              blockchain,
              contractAddress,
              price: price || 0,
              value: price ? balanceInTokens * price : 0,
            });
          }
        } catch (error) {
          console.warn(
            `⚠️ Erreur lors du calcul du solde pour ${tokenSymbol}:`,
            error
          );
        }
      }
    }

    return Array.from(tokenBalances.values());
  } catch (error) {
    console.error(
      `❌ Erreur lors de la récupération des tokens ${blockchain}:`,
      error
    );
    return [];
  }
};

// Fonction principale pour scanner toutes les blockchains
export const scanWalletAssets = async (
  address: string,
  username: string = "Romain"
): Promise<{
  blockchains: string[];
  assets: WalletAsset[];
  nfts: WalletAsset[];
}> => {
  console.log(`🔍 [API] Début du scan pour l'adresse: ${address}`);

  const allAssets: WalletAsset[] = [];
  const supportedBlockchains = [
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
    "optimism",
    "avalanche",
  ];

  // Scanner les blockchains SÉQUENTIELLEMENT pour éviter le rate limiting
  for (const blockchain of supportedBlockchains) {
    console.log(`🔍 [API] Scan de ${blockchain}...`);

    try {
      // Récupérer le solde natif
      const nativeBalance = await getNativeBalance(
        address,
        blockchain,
        username
      );
      if (nativeBalance) {
        allAssets.push(nativeBalance);
        console.log(
          `💰 Solde natif ${blockchain}: ${nativeBalance.balance} ${nativeBalance.symbol}`
        );
      }

      // Récupérer les tokens
      const tokens = await getTokenBalances(address, blockchain, username);
      allAssets.push(...tokens);
      console.log(`💰 ${tokens.length} tokens trouvés sur ${blockchain}`);

      // Pause entre les blockchains pour éviter le rate limiting
      await delay(1000);
    } catch (error) {
      console.error(`❌ Erreur lors du scan de ${blockchain}:`, error);
      // Continuer avec les autres blockchains même si une échoue
    }
  }

  console.log(`✅ Scan terminé. ${allAssets.length} assets trouvés au total`);

  // Récupérer les NFTs via OpenSea (seulement pour Ethereum pour l'instant)
  let nftAssets: WalletAsset[] = [];
  try {
    console.log(`🔍 [OpenSea] Récupération des NFTs pour ${address}...`);
    const nfts = await getNFTsForAddress(address, username);

    if (nfts.length > 0) {
      console.log(`🎨 [OpenSea] ${nfts.length} NFTs trouvés`);

      // Récupérer le prix de l'ETH pour la conversion
      const ethPrice = await getETHPrice(username);
      console.log(`💱 [Conversion] Prix ETH: $${ethPrice.toFixed(2)}`);

      // Récupérer les floor prices pour toutes les collections uniques
      const uniqueCollections = [...new Set(nfts.map((nft) => nft.collection))];
      console.log(
        `🏗️ [OpenSea] Récupération des floor prices pour ${uniqueCollections.length} collections...`
      );

      const floorPrices: { [collection: string]: number } = {};

      for (const collection of uniqueCollections) {
        try {
          const floorPriceETH = await getCollectionFloorPrice(
            collection,
            username
          );
          if (floorPriceETH) {
            const floorPriceUSD = floorPriceETH * ethPrice;
            floorPrices[collection] = floorPriceUSD;
            console.log(
              `💰 [OpenSea] Floor price pour ${collection}: ${floorPriceETH} ETH ($${floorPriceUSD.toFixed(
                2
              )})`
            );
          }
        } catch (error) {
          console.warn(
            `⚠️ [OpenSea] Impossible de récupérer le floor price pour ${collection}:`,
            error
          );
        }
      }

      // Convertir les NFTs en WalletAsset avec les floor prices en USD
      nftAssets = nfts.map((nft) => {
        const floorPriceUSD = floorPrices[nft.collection] || 0;
        const value = floorPriceUSD; // Valeur = floor price en USD

        return {
          symbol: "NFT",
          name: nft.name || `NFT #${nft.token_id}`,
          balance: 1, // Chaque NFT a un balance de 1
          value: value,
          price: floorPriceUSD,
          logo: nft.image_url,
          blockchain: "ethereum", // NFTs principalement sur Ethereum
          contractAddress: nft.contract,
          decimals: 0,
          tokenId: nft.token_id,
          isNFT: true,
          nftData: {
            collection: nft.collection,
            permalink: nft.opensea_url,
            traits: nft.traits || [],
          },
        };
      });

      console.log(
        `🎨 NFTs préparés: ${nftAssets.length} (avec floor prices en USD)`
      );
    }
  } catch (error) {
    console.error(`❌ Erreur lors de la récupération des NFTs:`, error);
  }

  return {
    blockchains: supportedBlockchains,
    assets: allAssets,
    nfts: nftAssets,
  };
};

// Fonction pour créer un nouveau wallet
export const createWallet = async (
  name: string,
  address: string,
  walletType: string = "neutral",
  username: string = "Romain"
): Promise<Wallet> => {
  if (!isValidAddress(address)) {
    throw new Error("Adresse invalide");
  }

  console.log(
    `📝 [API] Création du wallet "${name}" avec l'adresse ${address} (type: ${walletType})`
  );

  const { blockchains, assets, nfts } = await scanWalletAssets(
    address,
    username
  );

  const totalValue =
    assets.reduce((sum, asset) => sum + (asset.value || 0), 0) +
    nfts.reduce((sum, nft) => sum + (nft.value || 0), 0);

  const wallet: Wallet = {
    id: Date.now().toString(),
    name,
    address,
    walletType: walletType as any,
    blockchains,
    assets,
    nfts,
    totalValue,
    lastUpdated: new Date().toISOString(),
    addedAt: new Date().toISOString(),
  };

  console.log(
    `✅ [API] Wallet créé avec succès: ${assets.length} assets, ${
      nfts.length
    } NFTs, valeur totale: $${totalValue.toFixed(2)}`
  );

  return wallet;
};

// Fonction pour mettre à jour un wallet existant
export const updateWallet = async (
  wallet: Wallet,
  username: string = "Romain"
): Promise<Wallet> => {
  console.log(
    `🔄 [API] Mise à jour du wallet "${wallet.name}" (${wallet.address})`
  );
  console.log(
    `📊 État initial: ${
      wallet.assets.filter((a) => !a.isHidden).length
    } assets actifs, valeur: $${wallet.totalValue.toFixed(2)}`
  );

  const { blockchains, assets, nfts } = await scanWalletAssets(
    wallet.address,
    username
  );
  console.log(
    `🔍 Scan terminé: ${assets.length} assets, ${nfts.length} NFTs détectés sur ${blockchains.length} blockchains`
  );

  // Préserver les assets cachés existants
  const existingHiddenAssets = wallet.assets.filter((asset) => asset.isHidden);
  console.log(
    `👁️ Préservation de ${existingHiddenAssets.length} assets suspects`
  );

  const updatedAssets = [...assets];

  // Fusionner avec les assets cachés existants
  existingHiddenAssets.forEach((hiddenAsset) => {
    const existingIndex = updatedAssets.findIndex(
      (asset) =>
        asset.symbol === hiddenAsset.symbol &&
        asset.blockchain === hiddenAsset.blockchain &&
        asset.contractAddress === hiddenAsset.contractAddress
    );

    if (existingIndex >= 0) {
      // Marquer l'asset comme caché et préserver les données existantes
      updatedAssets[existingIndex] = {
        ...updatedAssets[existingIndex],
        isHidden: true,
        // Préserver les données existantes si elles sont plus récentes
        balance:
          hiddenAsset.balance > 0
            ? hiddenAsset.balance
            : updatedAssets[existingIndex].balance,
        value:
          (hiddenAsset.value || 0) > 0
            ? hiddenAsset.value
            : updatedAssets[existingIndex].value,
        price:
          (hiddenAsset.price || 0) > 0
            ? hiddenAsset.price
            : updatedAssets[existingIndex].price,
      };
      console.log(
        `👁️ Asset ${hiddenAsset.symbol} marqué comme suspect et préservé`
      );
    } else {
      // Ajouter l'asset caché s'il n'existe plus dans le scan
      updatedAssets.push({
        ...hiddenAsset,
        balance: 0, // Balance mise à 0 car plus détecté
        value: 0,
        price: 0,
      });
      console.log(
        `👁️ Asset suspect ${hiddenAsset.symbol} ajouté avec balance 0 (plus détecté)`
      );
    }
  });

  // Calculer la valeur totale en excluant les assets cachés et en incluant les NFTs
  const totalValue =
    updatedAssets
      .filter((asset) => !asset.isHidden)
      .reduce((sum, asset) => sum + (asset.value || 0), 0) +
    nfts.reduce((sum, nft) => sum + (nft.value || 0), 0);

  // Vérifier que la valeur totale ne prend en compte que les assets actifs
  const suspectAssetsValue = updatedAssets
    .filter((asset) => asset.isHidden)
    .reduce((sum, asset) => sum + (asset.value || 0), 0);

  console.log(`💰 Valeur des assets actifs: $${totalValue.toFixed(2)}`);
  console.log(
    `👁️ Valeur des assets suspects (exclue): $${suspectAssetsValue.toFixed(2)}`
  );

  const updatedWallet: Wallet = {
    ...wallet,
    blockchains,
    assets: updatedAssets,
    nfts,
    totalValue,
    lastUpdated: new Date().toISOString(),
  };

  const activeAssetsCount = updatedAssets.filter(
    (asset) => !asset.isHidden
  ).length;
  const suspectAssetsCount = updatedAssets.filter(
    (asset) => asset.isHidden
  ).length;

  console.log(
    `✅ [API] Wallet mis à jour: ${activeAssetsCount} assets actifs, ${suspectAssetsCount} assets suspects, ${
      nfts.length
    } NFTs, valeur totale: $${totalValue.toFixed(2)}`
  );

  return updatedWallet;
};

// Obtenir la liste des blockchains supportées
export const getSupportedBlockchains = (
  username: string = "Romain"
): BlockchainConfig[] => {
  const supportedBlockchains = [
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
    "optimism",
    "avalanche",
  ];
  return supportedBlockchains.map((blockchain) =>
    getBlockchainConfig(blockchain, username)
  );
};

// Utilitaires pour les URLs d'explorateur
export const getExplorerUrl = (
  address: string,
  blockchain: string,
  username: string = "Romain"
): string => {
  const config = getBlockchainConfig(blockchain, username);
  return config ? `${config.explorerUrl}/address/${address}` : "";
};

export const getTransactionUrl = (
  txHash: string,
  blockchain: string,
  username: string = "Romain"
): string => {
  const config = getBlockchainConfig(blockchain, username);
  return config ? `${config.explorerUrl}/tx/${txHash}` : "";
};
