import { getOpenSeaApiKey } from "./userSettings";
import { API_ORIGIN } from "./apiBase";

const API_BASE_URL = API_ORIGIN;

interface NFTAsset {
  identifier: string;
  name: string;
  description: string;
  image_url: string;
  animation_url: string;
  background_color: string;
  external_url: string;
  contract: string;
  collection: string;
  token_standard: string;
  token_id: string;
  metadata_url: string;
  last_token_uri_sync: string;
  last_metadata_sync: string;
  chain: string;
  owner: string;
  creator: string;
  traits: any[];
  rarity: any;
  orders: any[];
  listings: any[];
  offers: any[];
  seaport_sell_orders: any[];
  seaport_buy_orders: any[];
  last_sale: any;
  top_bid: any;
  listing_date: any;
  is_presale: boolean;
  transfer_fee_payment_token: any;
  transfer_fee: any;
  opensea_url: string;
}

interface OpenSeaResponse {
  nfts: NFTAsset[];
  next: string;
}

export const getNFTsForAddress = async (
  address: string,
  username: string = "Romain"
): Promise<NFTAsset[]> => {
  const apiKey = getOpenSeaApiKey(username);

  if (!apiKey) {
    console.warn("⚠️ Clé API OpenSea non configurée");
    return [];
  }

  try {
    console.log(`🔍 [OpenSea] Récupération des NFTs pour ${address}...`);

    const url = `${API_BASE_URL}/api/opensea/nfts/${address}?apiKey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Erreur OpenSea API: ${response.status} ${response.statusText}`
      );
    }

    const data: OpenSeaResponse = await response.json();

    console.log(
      `✅ [OpenSea] ${data.nfts.length} NFTs trouvés pour ${address}`
    );

    return data.nfts;
  } catch (error) {
    console.error(
      `❌ Erreur lors de la récupération des NFTs OpenSea pour ${address}:`,
      error
    );
    return [];
  }
};

export const getNFTValue = async (
  contractAddress: string,
  tokenId: string,
  username: string = "Romain"
): Promise<number | null> => {
  const apiKey = getOpenSeaApiKey(username);

  if (!apiKey) {
    return null;
  }

  try {
    const url = `${API_BASE_URL}/api/opensea/nft/${contractAddress}/${tokenId}?apiKey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data: NFTAsset = await response.json();

    // Essayer de récupérer le prix depuis last_sale ou top_bid
    if (data.last_sale && data.last_sale.total_price) {
      return parseFloat(data.last_sale.total_price) / Math.pow(10, 18); // Convertir wei en ETH
    }

    if (data.top_bid && data.top_bid.current_bid) {
      return parseFloat(data.top_bid.current_bid) / Math.pow(10, 18);
    }

    return null;
  } catch (error) {
    console.error(`❌ Erreur lors de la récupération de la valeur NFT:`, error);
    return null;
  }
};

export const getCollectionFloorPrice = async (
  collection: string,
  username: string = "Romain"
): Promise<number | null> => {
  const apiKey = getOpenSeaApiKey(username);

  if (!apiKey) {
    return null;
  }

  try {
    const url = `${API_BASE_URL}/api/opensea/collection/${collection}/floor?apiKey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // Récupérer le floor price en ETH
    if (data.total && data.total.floor_price) {
      return parseFloat(data.total.floor_price);
    }

    return null;
  } catch (error) {
    console.error(
      `❌ Erreur lors de la récupération du floor price pour ${collection}:`,
      error
    );
    return null;
  }
};
