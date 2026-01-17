// Test des APIs blockchain avec l'API V2 Etherscan

import { getEtherscanApiKey } from "./userSettings";

interface TestConfig {
  name: string;
  chainId: number;
  testAddress: string;
  currency: string;
}

// Configuration des tests pour chaque blockchain
const TEST_CONFIGS: TestConfig[] = [
  {
    name: "ethereum",
    chainId: 1,
    testAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
    currency: "ETH",
  },
  {
    name: "bsc",
    chainId: 56,
    testAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
    currency: "BNB",
  },
  {
    name: "polygon",
    chainId: 137,
    testAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
    currency: "MATIC",
  },
  {
    name: "arbitrum",
    chainId: 42161,
    testAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
    currency: "ETH",
  },
  {
    name: "optimism",
    chainId: 10,
    testAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
    currency: "ETH",
  },
  {
    name: "avalanche",
    chainId: 43114,
    testAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
    currency: "AVAX",
  },
];

const BASE_URL = "https://api.etherscan.io/v2/api";

// Fonction pour construire l'URL API V2
function buildApiV2Url(
  chainId: number,
  module: string,
  action: string,
  address: string,
  apiKey: string,
  additionalParams: string = ""
): string {
  return `${BASE_URL}?chainid=${chainId}&module=${module}&action=${action}&address=${address}&tag=latest&apikey=${apiKey}${additionalParams}`;
}

// Test d'une blockchain spécifique
async function testBlockchain(config: TestConfig, username: string = "Romain") {
  console.log(
    `🧪 Test de l'API ${config.name} (chainId: ${config.chainId})...`
  );

  try {
    const apiKey = getEtherscanApiKey(username);
    if (!apiKey) {
      console.error(
        `❌ Clé API Etherscan non trouvée. Veuillez la configurer.`
      );
      return false;
    }

    // Test 1: Balance native
    const balanceUrl = buildApiV2Url(
      config.chainId,
      "account",
      "balance",
      config.testAddress,
      apiKey
    );
    console.log(`🔍 Test balance native: ${balanceUrl}`);

    const balanceResponse = await fetch(balanceUrl);
    const balanceData = await balanceResponse.json();
    console.log(`📊 Résultat balance:`, balanceData);

    // Test 2: Token transactions
    const tokensUrl = buildApiV2Url(
      config.chainId,
      "account",
      "tokentx",
      config.testAddress,
      apiKey,
      "&startblock=0&endblock=99999999&sort=asc"
    );
    console.log(`🔍 Test token transactions: ${tokensUrl}`);

    const tokensResponse = await fetch(tokensUrl);
    const tokensData = await tokensResponse.json();

    if (tokensData.result && Array.isArray(tokensData.result)) {
      console.log(`📊 Résultat tokens (premiers 3):`, {
        status: tokensData.status,
        message: tokensData.message,
        resultCount: tokensData.result.length,
        firstThree: tokensData.result.slice(0, 3),
      });
    } else {
      console.log(`📊 Résultat tokens (premiers 3):`, {
        status: tokensData.status,
        message: tokensData.message,
        resultCount: tokensData.result ? tokensData.result.length || 0 : 0,
        firstThree: tokensData.result
          ? tokensData.result.toString().substring(0, 20)
          : "N/A",
      });
    }

    // Analyse des résultats
    if (balanceData.status === "1" || tokensData.status === "1") {
      console.log(`✅ ${config.name}: API V2 fonctionne !`);
      return true;
    } else {
      console.log(`❌ ${config.name}: Problème détecté`);
      console.log(
        `   - Balance status: ${balanceData.status} - ${balanceData.message}`
      );
      console.log(
        `   - Tokens status: ${tokensData.status} - ${tokensData.message}`
      );
      return false;
    }
  } catch (error) {
    console.error(`❌ ${config.name}: Erreur lors du test:`, error);
    return false;
  }
}

// Test de toutes les blockchains
export async function testAllApis(username: string = "Romain") {
  console.log("🚀 Lancement des tests API V2 Etherscan...");
  const apiKey = getEtherscanApiKey(username);
  if (!apiKey) {
    console.error(`❌ Clé API Etherscan non trouvée. Veuillez la configurer.`);
    return;
  }
  console.log(`🔑 Utilisation de la clé API: ${apiKey}`);
  console.log(`🌐 URL de base: ${BASE_URL}`);
  console.log("🧪 Début des tests de toutes les blockchains...");

  let successCount = 0;
  let totalCount = TEST_CONFIGS.length;

  for (const config of TEST_CONFIGS) {
    const success = await testBlockchain(config, username);
    if (success) successCount++;
    console.log("---");
  }

  console.log(
    `🎯 Résultats finaux: ${successCount}/${totalCount} APIs fonctionnelles`
  );
  if (successCount === totalCount) {
    console.log("✅ Toutes les APIs fonctionnent parfaitement !");
  } else if (successCount > 0) {
    console.log("⚠️ Certaines APIs ont des problèmes");
  } else {
    console.log("❌ Aucune API ne fonctionne");
  }
}
