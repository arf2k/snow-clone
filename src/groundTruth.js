// src/groundTruth.js
//
// Central place to normalize "on the ground" resort data into a simple,
// UI-friendly shape, regardless of source:
//  - Drupal-style resort APIs (Killington, Copper, etc.)
//  - MtnPowder snow report API
//  - Resort-specific multi-zone snow+weather JSON (e.g. Jackson Hole all.json)
//  - SNOTEL station data

import { fetchSnotelData } from './snotel.js';
import { fetchMtnPowderData } from './mtnpowder.js';

/** Coerce numeric-ish strings (with commas, etc.) into numbers or null. */
function toNumberOrNull(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Flatten an object into [path, value] pairs, e.g. lifts.open -> "lifts.open" */
function flattenLeafPaths(obj, prefix = '') {
  const result = [];
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result.push(...flattenLeafPaths(value, path));
    } else {
      result.push([path, value]);
    }
  }
  return result;
}

/**
 * ---------------- Drupal-style snow report parser ----------------
 *
 * Used for Killington / Copper "snow-report" endpoints.
 * We don't hardcode exact field names; instead we flatten the object and
 * search for path substrings like "base.depth", "lifts.open", etc.
 */
function parseDrupalApiData(data, { resortName } = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    console.warn('Drupal API: empty or invalid array');
    return null;
  }

  const latest = data[0] || {};
  const computed = latest.computed || {};

  // --- 1) Explicit Killington/Copper-style mappings ---

  // Base depth in inches
  const depth =
    toNumberOrNull(latest.base_depth) ??
    toNumberOrNull(latest.baseDepth);

  // 24h new snow:
  // - Prefer computed["24_hour"]
  // - fall back to "amount" (new snow for this report)
  // - then "overnight_amount" as a last resort
  const change24h =
    toNumberOrNull(computed['24_hour']) ??
    toNumberOrNull(latest.amount) ??
    toNumberOrNull(latest.overnight_amount);

  // Season total snow:
  // - Prefer computed.total
  // - fall back to more generic names if they ever appear
  const seasonTotal =
    toNumberOrNull(computed.total) ??
    toNumberOrNull(computed.season_total);

  // This particular endpoint does NOT include lifts/trails,
  // but we keep the generic pattern-matching fallback so other
  // Drupal APIs can still benefit.

  // --- 2) Generic flatten + pattern matching for other Drupal variants ---

  const flattened = flattenLeafPaths(latest).map(([path, value]) => [
    path.toLowerCase(),
    value,
  ]);

  const findByPatterns = (patterns) => {
    for (const [path, value] of flattened) {
      const ok = patterns.every((p) => path.includes(p));
      if (ok) return toNumberOrNull(value);
    }
    return null;
  };

  // If depth / change24h / seasonTotal were not resolved above,
  // try to infer them from other Drupal-style shapes.
  const depthFinal =
    depth ??
    findByPatterns(['base', 'depth']) ??
    findByPatterns(['base', 'snow']) ??
    findByPatterns(['base']) ??
    findByPatterns(['depth']);

  const change24hFinal =
    change24h ??
    findByPatterns(['24', 'snow']) ??
    findByPatterns(['24', 'new']) ??
    findByPatterns(['last', '24']) ??
    findByPatterns(['one', 'day']) ??
    findByPatterns(['24h']);

  const seasonTotalFinal =
    seasonTotal ??
    findByPatterns(['season', 'total']) ??
    findByPatterns(['season', 'snow']) ??
    findByPatterns(['season']);

  // Lifts and trails: not present for Killington snow-reports,
  // but other Drupal APIs might have them, so we still try.
  const openLifts =
    findByPatterns(['lift', 'open']) ??
    findByPatterns(['lifts', 'open']);
  const totalLifts =
    findByPatterns(['lift', 'total']) ??
    findByPatterns(['lifts', 'total']) ??
    findByPatterns(['lifts', 'count']);

  const openTrails =
    findByPatterns(['trail', 'open']) ??
    findByPatterns(['run', 'open']);
  const totalTrails =
    findByPatterns(['trail', 'total']) ??
    findByPatterns(['run', 'total']) ??
    findByPatterns(['trail', 'count']) ??
    findByPatterns(['runs', 'count']);

  // Temperature, if it ever shows up in a Drupal payload
  const temp =
    findByPatterns(['temp']) ??
    findByPatterns(['temperature']);

  return {
    name:
      resortName ||
      latest.name ||
      latest.title ||
      latest.resort ||
      'Resort',
    source: 'drupal',
    depth: depthFinal,
    change24h: change24hFinal,
    seasonTotal: seasonTotalFinal,
    openLifts,
    totalLifts,
    openTrails,
    totalTrails,
    temp,
  };
}


/**
 * ---------------- MtnPowder snow report parser ----------------
 *
 * Expects something like:
 * [
 *   {
 *     depth: { base, middle, summit },
 *     lifts: { open, total, ... },
 *     terrain: { runs: { open, total, ... }, ... },
 *     recent: [{ date, snow }, ...],
 *     ...
 *   }
 * ]
 */
function parseMtnPowderApiData(raw, { resortName, resortId } = {}) {
  if (!raw) {
    console.warn('MtnPowder API: empty response');
    return null;
  }

  let report = null;
  let label = resortName || 'Resort';

  // --- Case 1: v3 wrapper with Resorts[] and SnowReport (what you showed for Sugarbush) ---
  if (Array.isArray(raw.Resorts) && raw.Resorts.length > 0) {
    let resortObj = raw.Resorts[0];

    // Try to pick the correct resort if there are multiple
    if (resortId != null) {
      const byId = raw.Resorts.find(
        (r) => String(r.Id) === String(resortId)
      );
      if (byId) resortObj = byId;
    } else if (resortName) {
      const byName = raw.Resorts.find(
        (r) => r.Name && r.Name.toLowerCase() === resortName.toLowerCase()
      );
      if (byName) resortObj = byName;
    }

    report = resortObj.SnowReport || resortObj;
    label = resortName || resortObj.Name || label;
  }

  // --- Case 2: older / other shapes (array, results[], data[]) ---
  if (!report) {
    const arr = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.results)
      ? raw.results
      : Array.isArray(raw.data)
      ? raw.data
      : null;

    if (!arr || arr.length === 0) {
      console.warn('MtnPowder API: no rows', raw);
      return null;
    }

    report = arr[0];
  }

  // At this point, `report` is either:
  //  - the v3 SnowReport object (Sugarbush style), or
  //  - an older-style snowreport row with depth/lifts/terrain fields.

  let depth = null;
  let change24h = null;
  let openLifts = null;
  let totalLifts = null;
  let openTrails = null;
  let totalTrails = null;
  let seasonTotal = null;

  // --- Branch A: older style with depth/lifts/terrain ---
  if (report.depth || report.lifts || report.terrain) {
    const depthObj = report.depth || {};
    depth =
      toNumberOrNull(depthObj.base) ??
      toNumberOrNull(depthObj.middle) ??
      toNumberOrNull(depthObj.summit);

    if (Array.isArray(report.recent) && report.recent.length > 0) {
      change24h = toNumberOrNull(report.recent[0].snow);
    }

    const lifts = report.lifts || {};
    const terrain = report.terrain || {};
    const runs = terrain.runs || {};

    openLifts = toNumberOrNull(lifts.open);
    totalLifts = toNumberOrNull(lifts.total);
    openTrails = toNumberOrNull(runs.open);
    totalTrails = toNumberOrNull(runs.total);
    // seasonTotal stays null unless we add a field mapping here
  }

  // --- Branch B: v3 SnowReport (your Sugarbush JSON) ---
  else {
    const preferred = String(
      report.PreferredBaseReporting || ''
    ).toLowerCase();

    // Depth:
    //  1) respect PreferredBaseReporting (summit / mid / base)
    //  2) fall back to SnowBaseRangeIn (e.g. "12-18")
    if (preferred === 'summit' && report.SummitArea?.BaseIn != null) {
      depth = toNumberOrNull(report.SummitArea.BaseIn);
    } else if (preferred === 'mid' && report.MidMountainArea?.BaseIn != null) {
      depth = toNumberOrNull(report.MidMountainArea.BaseIn);
    } else if (report.BaseArea?.BaseIn != null) {
      depth = toNumberOrNull(report.BaseArea.BaseIn);
    } else if (report.SnowBaseRangeIn != null) {
      const match = String(report.SnowBaseRangeIn).match(/[\d.]+/);
      if (match) depth = toNumberOrNull(match[0]);
    }

    // 24h new snow (AllMountain first, then summit/mid/base)
    change24h =
      toNumberOrNull(report.AllMountain?.Last24HoursIn) ??
      toNumberOrNull(report.SummitArea?.Last24HoursIn) ??
      toNumberOrNull(report.MidMountainArea?.Last24HoursIn) ??
      toNumberOrNull(report.BaseArea?.Last24HoursIn);

    // Season total
    seasonTotal = toNumberOrNull(report.SeasonTotalIn);

    // Lifts & trails
    openLifts = toNumberOrNull(report.TotalOpenLifts);
    totalLifts = toNumberOrNull(report.TotalLifts);
    openTrails = toNumberOrNull(report.TotalOpenTrails);
    totalTrails = toNumberOrNull(report.TotalTrails);
  }

  return {
    name: label,
    source: 'mtnpowder',
    depth,
    change24h,
    seasonTotal,
    openLifts,
    totalLifts,
    openTrails,
    totalTrails,
    temp: null, // this API doesn't give us an easy "avg temp" field
  };
}


/**
 * ---------------- Generic multi-zone snow+weather parser ----------------
 *
 * Intended for resort-specific JSON like Jackson Hole's all.json:
 *   snow: { base: {...}, midMountain: {...}, tramSummit: {...}, ... }
 *   weather: { base: {...}, midMountain: {...}, tramSummit: {...}, ... }
 */
function parseMultiZoneSnowApi(data, options = {}) {
  const {
    resortName = data?.name || 'Resort',
    preferredPrimaryKeys = ['tramsummit', 'summit', 'peak', 'midmountain'],
  } = options;

  const snow = data?.snow || {};
  const weather = data?.weather || {};

  const metaKeys = new Set([
    'lastmodified',
    'lastsnowfalldate',
    'psa',
    'detail',
    'inversion',
    'inversionmessage',
  ]);

  const zoneEntries = Object.entries(snow).filter(([key, value]) => {
    if (!value || typeof value !== 'object') return false;
    const lower = key.toLowerCase();
    if (metaKeys.has(lower)) return false;
    return true;
  });

  if (!zoneEntries.length) {
    console.warn('multi-zone parser: no zones under snow');
    return null;
  }

  const zones = zoneEntries.map(([key, node]) => {
    const lowerKey = key.toLowerCase();
    const wNode = weather[key] || weather[lowerKey] || {};

    return {
      key,
      name: node.name || key,
      elevationFt: toNumberOrNull(node.altitude?.value),
      depthIn: toNumberOrNull(node.totalSnowDepth?.value),
      seasonTotalIn: toNumberOrNull(node.seasonTotalSnow?.value),
      newSnow24In: toNumberOrNull(node.newSnowLast24H?.value),
      newSnow48In: toNumberOrNull(node.newSnowLast48H?.value),
      newSnow7dIn: toNumberOrNull(node.newSnowLast7D?.value),
      newSinceLiftsClosedIn: toNumberOrNull(node.newSnowSinceLiftsClosed?.value),
      tempF: toNumberOrNull(wNode.temperature?.value),
      windMph: toNumberOrNull(wNode.wind?.value),
    };
  });

  // Choose primary zone:
  // 1) first with key in preferred list (case-insensitive)
  // 2) highest elevation
  // 3) first zone
  const normPreferred = preferredPrimaryKeys.map((k) => k.toLowerCase());

  let primary =
    zones.find((z) => normPreferred.includes(z.key.toLowerCase())) || null;

  if (!primary) {
    primary = zones.reduce((max, z) => {
      const elev = z.elevationFt ?? -Infinity;
      return elev > (max.elevationFt ?? -Infinity) ? z : max;
    }, zones[0]);
  }

  const depth = primary.depthIn;
  const seasonTotal = primary.seasonTotalIn;
  const change24h = primary.newSnow24In ?? primary.newSnow48In ?? null;
  const temp = primary.tempF;

  return {
    name: resortName,
    source: 'multi-zone-snow',
    depth,
    change24h,
    seasonTotal,
    openLifts: null,
    totalLifts: null,
    openTrails: null,
    totalTrails: null,
    temp,
    detail: data?.snow?.detail || '',
    inversion: !!data?.snow?.inversion,
    inversionMessage: data?.snow?.inversionMessage || '',
    zones,
  };
}

/**
 * ---------------- Direct resort API fetcher ----------------
 *
 * Handles resort.links.directApi endpoints (Killington, Copper, Jackson, etc.).
 * Uses schema hints from resort.groundTruthConfig.schema when present,
 * otherwise falls back to simple shape detection.
 */
async function fetchDirectApiData(resort) {
  const url = resort?.links?.directApi;
  if (!url) throw new Error('No directApi URL configured for resort');

  let proxyUrl = url;

  // Host → dev proxy mapping (vite.config.js must define these)
  if (url.includes('api.killington.com')) {
    proxyUrl = url.replace(
      'https://api.killington.com/api/v1/dor/drupal',
      '/api/killington'
    );
  } else if (url.includes('api.coppercolorado.com')) {
    proxyUrl = url.replace(
      'https://api.coppercolorado.com/api/v1/dor/drupal',
      '/api/copper'
    );
  } else if (url.includes('jacksonhole-prod.zaneray.com')) {
    proxyUrl = url.replace(
      'https://jacksonhole-prod.zaneray.com',
      '/api/jacksonhole'
    );
  }

  const r = await fetch(proxyUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) {
    throw new Error(`Direct API fetch failed (${r.status})`);
  }

  const data = await r.json();
  const schemaHint = resort.groundTruthConfig?.schema;

  // 1) Explicit schema wins
  if (schemaHint === 'drupal-array') {
    return parseDrupalApiData(data, { resortName: resort.name });
  }
  if (schemaHint === 'multi-zone-snow') {
    const opts = resort.groundTruthConfig?.multiZone || {};
    return parseMultiZoneSnowApi(data, {
      resortName: resort.name,
      ...opts,
    });
  }

  // 2) Shape-based fallbacks
  if (Array.isArray(data)) {
    return parseDrupalApiData(data, { resortName: resort.name });
  }
  if (data && data.snow && typeof data.snow === 'object') {
    return parseMultiZoneSnowApi(data, { resortName: resort.name });
  }

  console.warn('Unknown directApi schema for resort', resort.id, 'data:', data);
  return null;
}

/**
 * ---------------- MtnPowder helper ----------------
 */
async function fetchMtnPowderApiDataForResort(resort) {
  const id = resort?.links?.mtnpowder_id;
  if (id == null) {
    throw new Error('No mtnpowder_id configured for resort');
  }

  const raw = await fetchMtnPowderData(String(id));
  return parseMtnPowderApiData(raw, {
    resortName: resort.name,
    resortId: String(id),
  });
}


/**
 * ---------------- Primary entrypoint ----------------
 *
 * Given a resort record from resorts.json, try (in priority order):
 *   1. Resort.directApi (Killington/Copper/Jackson/etc.)
 *   2. MtnPowder (if mtnpowder_id present)
 *   3. SNOTEL (if stationTriplet present)
 *
 * Returns a normalized object expected by ui.renderGroundTruth, or null.
 */
export async function fetchGroundTruth(resort) {
  if (!resort || !resort.links) return null;

  // 1) Direct resort JSON
  if (resort.links.directApi) {
    try {
      const direct = await fetchDirectApiData(resort);
      if (direct) return direct;
    } catch (e) {
      console.warn('Direct resort API fetch failed, falling back…', e);
    }
  }

  // 2) MtnPowder snow report
  if (resort.links.mtnpowder_id != null) {
    try {
      const mtn = await fetchMtnPowderApiDataForResort(resort);
      if (mtn) return mtn;
    } catch (e) {
      console.warn('MtnPowder fetch failed, falling back…', e);
    }
  }

  // 3) SNOTEL
  if (resort.links.snotel) {
    try {
      return await fetchSnotelData(resort.links.snotel);
    } catch (e) {
      console.warn('SNOTEL fetch failed:', e);
    }
  }

  return null;
}
