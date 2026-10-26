// Estimation immobilière (phase 2).
// -----------------------------------------------------------------------------
// Chaîne : géocodage IGN → médiane communale DVF/Cerema → corrections déclarées
// (étage, extérieur, DPE, garage…) → ré-indexation INSEE → valorisation.
//
// Les corrections sont des heuristiques, pas un modèle calibré : elles sont
// toutes renvoyées à l'UI pour rester auditables. Un échec de source ne doit
// jamais écraser la dernière valeur connue.

import { round2 } from "../lib/validate.js";

const GEOCODE_BASE = "https://data.geopf.fr/geocodage";
const CEREMA_BASE = "https://apidf-preprod.cerema.fr";
const INSEE_BASE = "https://api.insee.fr/series/BDM/V1";
const TIMEOUT_MS = 20000;

const UNCOVERED_DEPARTMENTS = new Set(["57", "67", "68", "976"]);
const LOW_CONFIDENCE_SAMPLE = 15;
const MEDIUM_CONFIDENCE_SAMPLE = 50;
const MAX_ROOM_SERIES = 5;
const MIN_ROOM_SERIES_SAMPLE = 20;

const IDBANK = {
  APARTMENT: "010567056",
  ALL: "010567058",
  HOUSE: "010567060",
};

export class ValuationError extends Error {
  constructor(message, { status = 422, code = "VALUATION_ERROR", details = null } = {}) {
    super(message);
    this.name = "ValuationError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const fetchWithTimeout = async (url, options = {}) => {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": "Portfolio-Dashboard/1.0 (self-hosted)",
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ValuationError(`Source de valorisation injoignable : ${error.message}`, {
      status: 502,
      code: "SOURCE_UNREACHABLE",
      details: { url },
    });
  }
  if (!response.ok) {
    throw new ValuationError(
      `Source de valorisation en erreur (HTTP ${response.status})`,
      {
        status: response.status >= 500 ? 502 : 422,
        code: "SOURCE_ERROR",
        details: { url, status: response.status },
      },
    );
  }
  return response;
};

const asNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const departmentCode = (inseeCode) => {
  const code = String(inseeCode || "").trim();
  if (!code) return null;
  if (code.startsWith("97")) return code.slice(0, 3);
  if (code.startsWith("2A") || code.startsWith("2B")) return code.slice(0, 2);
  return code.slice(0, 2);
};

export const isCoveredDepartment = (inseeCode) =>
  !UNCOVERED_DEPARTMENTS.has(departmentCode(inseeCode));

// ─── Géocodage IGN ──────────────────────────────────────────────────────────

export const geocodeAddress = async ({ address, postalCode, city } = {}) => {
  const query = [address, postalCode, city]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!query) {
    throw new ValuationError("Adresse vide : impossible de géocoder le bien.", {
      code: "MISSING_ADDRESS",
    });
  }
  const url = new URL(`${GEOCODE_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("index", "address");
  url.searchParams.set("returntruegeometry", "false");

  const response = await fetchWithTimeout(url);
  const payload = await response.json();
  const feature = payload?.features?.[0];
  if (!feature?.properties) {
    throw new ValuationError(
      "Adresse introuvable. Vérifiez la voie, le code postal et la commune.",
      { code: "ADDRESS_NOT_FOUND" },
    );
  }
  const properties = feature.properties;
  const coordinates = feature.geometry?.coordinates || [];
  const result = {
    label: properties.label || query,
    score: asNumber(properties.score),
    longitude: asNumber(coordinates[0]),
    latitude: asNumber(coordinates[1]),
    inseeCode: properties.citycode || null,
    postalCode: properties.postcode || postalCode || null,
    city: properties.city || city || null,
    banId: properties.banId || null,
  };
  if (!result.inseeCode && result.latitude == null) {
    throw new ValuationError("Adresse géocodée sans code INSEE exploitable.", {
      code: "INCOMPLETE_GEOCODE",
    });
  }
  if (result.score != null && result.score < 0.4) {
    throw new ValuationError(
      "Adresse trop imprécise (score de confiance faible). Précisez l'adresse.",
      { code: "LOW_GEOCODE_SCORE", details: result },
    );
  }
  return result;
};

// ─── DVF / Cerema ───────────────────────────────────────────────────────────

const seriesFor = (kind, rooms, row) => {
  if (kind === "HOUSE") return "cod111";
  if (kind !== "APARTMENT") return null;
  const roomCount = Number(rooms);
  if (Number.isFinite(roomCount) && roomCount > 0) {
    const bucket = Math.min(Math.round(roomCount), MAX_ROOM_SERIES);
    const roomSeries = `cod121x${bucket}`;
    const roomSample = asNumber(row[`nbtrans_${roomSeries}`]);
    const roomMedian = asNumber(row[`pxm2_median_${roomSeries}`]);
    if (roomMedian != null && roomMedian > 0 && roomSample != null && roomSample >= MIN_ROOM_SERIES_SAMPLE) {
      return roomSeries;
    }
  }
  return "cod121";
};

export const confidenceFor = (sample, degraded = false) => {
  if (degraded) return "LOW";
  if (sample == null || sample < LOW_CONFIDENCE_SAMPLE) return "LOW";
  return sample < MEDIUM_CONFIDENCE_SAMPLE ? "MEDIUM" : "HIGH";
};

const buildDvfResult = (row, { kind, rooms }, scale, degraded) => {
  const series = seriesFor(kind, rooms, row);
  if (!series) return null;
  const median = asNumber(row[`pxm2_median_${series}`]);
  if (median == null || median <= 0) return null;
  return {
    scale,
    degraded,
    series,
    median,
    q25: asNumber(row[`pxm2_q25_${series}`]),
    q75: asNumber(row[`pxm2_q75_${series}`]),
    sample: asNumber(row[`nbtrans_${series}`]),
    year: Number(row.annee) || null,
    confidence: confidenceFor(asNumber(row[`nbtrans_${series}`]), degraded),
  };
};

const fetchDvfRows = async (scale, code) => {
  const url = new URL(`${CEREMA_BASE}/indicateurs/dv3f/prix/annuel/`);
  url.searchParams.set("echelle", scale);
  url.searchParams.set("code", code);
  const response = await fetchWithTimeout(url);
  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
};

export const fetchDvfIndex = async ({ inseeCode, kind, rooms }) => {
  const code = String(inseeCode || "").trim();
  if (!code) throw new ValuationError("Code INSEE manquant.", { code: "MISSING_INSEE" });
  if (!isCoveredDepartment(code)) {
    throw new ValuationError(
      "Ce département (Alsace-Moselle ou Mayotte) n'est pas couvert par la base DVF. Utilisez une valorisation manuelle.",
      { code: "UNSUPPORTED_AREA" },
    );
  }

  // Commune d'abord ; repli département si la commune n'a pas assez de ventes.
  const communeRows = await fetchDvfRows("communes", code);
  for (let index = communeRows.length - 1; index >= 0; index -= 1) {
    const built = buildDvfResult(communeRows[index], { kind, rooms }, "commune", false);
    // Une seule vente reste une donnée locale ; la confiance affichée sera LOW.
    if (built && (built.sample == null || built.sample >= 1)) return built;
  }

  const department = departmentCode(code);
  if (!department) return null;
  const departmentRows = await fetchDvfRows("departements", department);
  for (let index = departmentRows.length - 1; index >= 0; index -= 1) {
    const built = buildDvfResult(departmentRows[index], { kind, rooms }, "department", true);
    if (built && built.sample >= 5) return built;
  }
  return null;
};

// ─── INSEE ──────────────────────────────────────────────────────────────────

const inseeCache = new Map();

const parseInseeXml = (xml) => {
  const series = new Map();
  const obsRe = /<Obs\b([^>]*)\/?>/g;
  let match;
  while ((match = obsRe.exec(xml)) !== null) {
    const attrs = match[1];
    const period = /TIME_PERIOD="([^"]+)"/.exec(attrs)?.[1];
    const rawValue = /OBS_VALUE="([^"]+)"/.exec(attrs)?.[1];
    if (!period || !rawValue) continue;
    const periodMatch = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!periodMatch) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    series.set(Number(periodMatch[1]) * 10 + Number(periodMatch[2]), value);
  }
  return series;
};

const fetchInseeSeries = async (kind) => {
  const idBank = IDBANK[kind] || IDBANK.ALL;
  const cached = inseeCache.get(idBank);
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000) return cached.series;

  const headers = { Accept: "application/xml" };
  if (process.env.INSEE_API_KEY) headers["X-API-KEY"] = process.env.INSEE_API_KEY;
  try {
    const response = await fetchWithTimeout(`${INSEE_BASE}/data/SERIES_BDM/${idBank}`, {
      headers,
    });
    const xml = await response.text();
    const series = parseInseeXml(xml);
    if (series.size > 0) {
      inseeCache.set(idBank, { series, at: Date.now() });
      return series;
    }
  } catch {
    // L'index est une amélioration, jamais un prérequis.
  }
  return cached?.series || null;
};

const quarterKey = (date) => {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return year * 10 + quarter;
};

const valueAtOrBefore = (series, key) => {
  let bestKey = null;
  for (const candidate of series.keys()) {
    if (candidate <= key && (bestKey == null || candidate > bestKey)) bestKey = candidate;
  }
  return bestKey == null ? null : series.get(bestKey);
};

/** Ratio de ré-indexation entre l'année de la source DVF et aujourd'hui. */
export const computeReindexRatio = (series, sourceYear, now = new Date()) => {
  if (!series || !sourceYear) return null;
  const fromKey = quarterKey(new Date(Date.UTC(Number(sourceYear), 11, 31)));
  const toKey = quarterKey(now);
  if (fromKey >= toKey) return 1;
  const fromValue = valueAtOrBefore(series, fromKey);
  const toValue = valueAtOrBefore(series, toKey);
  if (!fromValue || !toValue || fromValue <= 0) return null;
  return toValue / fromValue;
};

export const fetchReindexRatio = async ({ kind, sourceYear, now = new Date() }) => {
  if (!sourceYear) return null;
  const series = await fetchInseeSeries(kind);
  return computeReindexRatio(series, sourceYear, now);
};

// ─── Corrections ────────────────────────────────────────────────────────────

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Applique les corrections déclarées de Picsou (PropertyAdjustments).
 * Retourne la valeur corrigée + le détail de chaque ligne, pour l'UI.
 */
export const applyPropertyAdjustments = (property, baseValue, pricePerSqm) => {
  const kind = property.propertyType;
  const base = Number(baseValue) || 0;
  const perSqm = asNumber(pricePerSqm);
  const applied = [];
  let factorSum = 0;

  const record = (code, factor) => {
    applied.push({
      code,
      factor,
      sqm: null,
      amount: round2(base * factor),
    });
    factorSum += factor;
  };

  // Étage / ascenseur (appartements uniquement).
  if (kind === "APARTMENT" && property.floorNumber != null) {
    const floor = Number(property.floorNumber);
    const hasElevator = Boolean(property.hasElevator);
    if (floor === 0) {
      record("GROUND_FLOOR", -0.03);
    } else if (floor >= 3 && !hasElevator) {
      const penalty = Math.max(-0.05 - 0.01 * (floor - 3), -0.1);
      record("NO_ELEVATOR", round2(penalty * 100) / 100);
    }
    const top = property.floorsTotal;
    if (hasElevator && top != null && Number(top) >= 3 && floor === Number(top)) {
      record("TOP_FLOOR_ELEVATOR", 0.03);
    }
  }

  // Extérieur.
  if (property.hasGarden) {
    record("GARDEN", kind === "APARTMENT" ? 0.05 : 0.02);
  }
  if (property.hasTerrace) record("TERRACE", 0.03);
  if (property.hasBalcony) record("BALCONY", 0.015);

  // Salles de bain supplémentaires.
  const bathrooms = Number(property.bathrooms);
  if (Number.isFinite(bathrooms) && bathrooms > 1) {
    record("EXTRA_BATHROOMS", Math.min(0.02 * (bathrooms - 1), 0.04));
  }

  // DPE, sinon époque de construction (jamais les deux).
  const energy = String(property.energyClass || "").trim().toUpperCase();
  if (energy) {
    const factors = { A: 0.04, B: 0.04, C: 0.02, E: -0.03, F: -0.06, G: -0.1 };
    if (factors[energy]) record(`ENERGY_${energy}`, factors[energy]);
  } else if (property.constructionYear != null) {
    const year = Number(property.constructionYear);
    if (year < 1949) record("ERA_PRE_1949", -0.02);
    else if (year <= 1974) record("ERA_1949_1974", -0.04);
    else if (year <= 2000) {
      // Référence : aucune correction.
    } else if (year <= 2012) record("ERA_2001_2012", 0.02);
    else record("ERA_POST_2012", 0.05);
  }

  const multiplier = clamp(1 + factorSum, 0.75, 1.25);
  let value = base * multiplier;

  // Équivalents-surface : garage, parking, terrain.
  const additive = [];
  let extraSqm = 0;
  const addLine = (code, sqm) => {
    extraSqm += sqm;
    additive.push({ code, factor: null, sqm, amount: perSqm == null ? null : round2(sqm * perSqm) });
  };
  if (Number(property.garageCount) > 0) addLine("GARAGE", 12 * Number(property.garageCount));
  if (Number(property.parkingCount) > 0) addLine("PARKING", 7 * Number(property.parkingCount));
  if (kind === "HOUSE" && property.landM2 != null) {
    const extraLand = Number(property.landM2) - 500;
    if (extraLand > 0) addLine("LAND_SURPLUS", Math.min(extraLand * 0.02, 30));
  }

  if (extraSqm > 60) {
    const ratio = 60 / extraSqm;
    for (const line of additive) {
      line.sqm = round2(line.sqm * ratio);
      line.amount = perSqm == null ? null : round2(line.sqm * perSqm);
    }
    extraSqm = 60;
  }
  const addedAmount = perSqm == null ? 0 : extraSqm * perSqm;
  value += addedAmount;

  return {
    value: round2(value),
    multiplier,
    addedAmount: round2(addedAmount),
    adjustments: [...applied, ...additive],
  };
};

/** Applique la même transformation affine aux bornes q25/q75. */
export const applyTransformToBound = (bound, multiplier, addedAmount) =>
  bound == null ? null : round2(bound * multiplier + addedAmount);

// ─── Service ────────────────────────────────────────────────────────────────

export class RealEstateService {
  constructor({ repository } = {}) {
    this.repository = repository;
  }

  async geocodeProperty(propertyId, userId) {
    const property = this.repository.getProperty(propertyId, userId);
    if (!property) throw new ValuationError("Bien introuvable", { status: 404 });
    const geocode = await geocodeAddress({
      address: property.address,
      postalCode: property.postalCode,
      city: property.city,
    });
    return this.repository.saveProperty(userId, {
      id: propertyId,
      insee_code: geocode.inseeCode,
      postal_code: geocode.postalCode,
      city: geocode.city,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      ban_id: geocode.banId,
      geocode_score: geocode.score,
    });
  }

  /**
   * Estime un bien. En cas d'absence de données, renvoie un statut explicite
   * sans modifier la valeur courante.
   */
  async valuateProperty(propertyId, userId, { now = new Date() } = {}) {
    if (!this.repository) throw new Error("Repository requis");
    let property = this.repository.getProperty(propertyId, userId);
    if (!property) throw new ValuationError("Bien introuvable", { status: 404 });

    if (!["HOUSE", "APARTMENT"].includes(property.propertyType)) {
      throw new ValuationError(
        "Seuls les maisons et appartements peuvent être estimés automatiquement.",
        { code: "UNSUPPORTED_PROPERTY_TYPE" },
      );
    }
    if (!property.surfaceM2 || property.surfaceM2 <= 0) {
      throw new ValuationError("La surface habitable doit être renseignée.", {
        code: "MISSING_SURFACE",
      });
    }

    // Géocodage à la volée si le code INSEE manque.
    if (!property.inseeCode) {
      property = await this.geocodeProperty(propertyId, userId);
    }
    if (!isCoveredDepartment(property.inseeCode)) {
      throw new ValuationError(
        "Ce département n'est pas couvert par DVF. Utilisez une valorisation manuelle.",
        { code: "UNSUPPORTED_AREA" },
      );
    }

    let dvf;
    try {
      dvf = await fetchDvfIndex({
        inseeCode: property.inseeCode,
        kind: property.propertyType,
        rooms: property.rooms,
      });
    } catch (error) {
      if (error instanceof ValuationError && error.code === "UNSUPPORTED_AREA") throw error;
      throw error;
    }
    if (!dvf) {
      return {
        status: "NO_DATA",
        message:
          "Aucune vente comparable trouvée pour cette commune. La valeur actuelle est conservée.",
        property,
      };
    }

    const baseValue = dvf.median * property.surfaceM2;
    const adjusted = applyPropertyAdjustments(property, baseValue, dvf.median);
    let ratio = null;
    try {
      ratio = await fetchReindexRatio({
        kind: property.propertyType,
        sourceYear: dvf.year,
        now,
      });
    } catch {
      ratio = null;
    }

    const reindexedValue = ratio ? round2(adjusted.value * ratio) : adjusted.value;
    const lowValue = ratio
      ? round2(
          applyTransformToBound(
            (dvf.q25 ?? dvf.median) * property.surfaceM2,
            adjusted.multiplier,
            adjusted.addedAmount,
          ) * ratio,
        )
      : applyTransformToBound(
          (dvf.q25 ?? dvf.median) * property.surfaceM2,
          adjusted.multiplier,
          adjusted.addedAmount,
        );
    const highValue = ratio
      ? round2(
          applyTransformToBound(
            (dvf.q75 ?? dvf.median) * property.surfaceM2,
            adjusted.multiplier,
            adjusted.addedAmount,
          ) * ratio,
        )
      : applyTransformToBound(
          (dvf.q75 ?? dvf.median) * property.surfaceM2,
          adjusted.multiplier,
          adjusted.addedAmount,
        );

    const valuedAt = now.toISOString().slice(0, 10);
    const valuation = this.repository.saveValuation(userId, propertyId, {
      valuedAt,
      estimatedValue: reindexedValue,
      lowValue,
      highValue,
      pricePerSqm: dvf.median,
      provider: "CEREMA_DV3F",
      confidence: dvf.confidence,
      sampleSize: dvf.sample,
      sourceYear: dvf.year,
      detail: {
        scale: dvf.scale,
        series: dvf.series,
        baseValue: round2(baseValue),
        multiplier: adjusted.multiplier,
        addedAmount: adjusted.addedAmount,
        adjustments: adjusted.adjustments,
        reindexRatio: ratio,
        reindexed: Boolean(ratio),
      },
    });

    this.repository.updatePropertyValue(propertyId, userId, reindexedValue, valuedAt);
    this.repository.saveProperty(userId, {
      id: propertyId,
      valuation_mode: "ESTIMATED",
    });
    if (property.accountId) {
      this.repository.updateAccount(property.accountId, userId, {
        balance: reindexedValue,
        lastSyncAt: now.toISOString(),
      });
    }

    return {
      status: "OK",
      valuation,
      property: this.repository.getProperty(propertyId, userId),
      dvf,
      reindexed: Boolean(ratio),
    };
  }

  /** Valorisation manuelle : l'utilisateur assume le chiffre. */
  valuateManually(propertyId, userId, { value, date = new Date() }) {
    const property = this.repository.getProperty(propertyId, userId);
    if (!property) throw new ValuationError("Bien introuvable", { status: 404 });
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new ValuationError("Valeur manuelle invalide", { code: "INVALID_VALUE" });
    }
    const valuedAt = date.toISOString().slice(0, 10);
    const valuation = this.repository.saveValuation(userId, propertyId, {
      valuedAt,
      estimatedValue: amount,
      lowValue: null,
      highValue: null,
      pricePerSqm: property.surfaceM2 ? round2(amount / property.surfaceM2) : null,
      provider: "MANUAL",
      confidence: "HIGH",
      detail: { method: "manual" },
    });
    this.repository.updatePropertyValue(propertyId, userId, amount, valuedAt);
    this.repository.saveProperty(userId, {
      id: propertyId,
      valuation_mode: "MANUAL",
    });
    if (property.accountId) {
      this.repository.updateAccount(property.accountId, userId, {
        balance: amount,
        lastSyncAt: date.toISOString(),
      });
    }
    return {
      status: "OK",
      valuation,
      property: this.repository.getProperty(propertyId, userId),
    };
  }
}

export default RealEstateService;
