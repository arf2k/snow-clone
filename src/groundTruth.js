// src/groundTruth.js

import { fetchSnotelData } from './snotel.js';
import { fetchMtnPowderData } from './mtnpowder.js';

/**
 * --- Parser for the "Drupal" API (Killington, Copper) ---
 */
function parseDrupalApiData(data) {
  if (!Array.isArray(data) || data.length === 0) {
    console.warn('Direct API returned empty or invalid data');
    return null;
  }
  const latestReport = data[0];

  return {
    name: "Resort Report",
    depth: latestReport?.base_depth ?? null,
    change24h: latestReport?.computed?.['24_hour'] ?? null,
    
    // --- NEW DATA ---
    seasonTotal: latestReport?.computed?.total ?? null,
    openLifts: null, // This API doesn't provide this
    totalLifts: null,
    openTrails: null,
    totalTrails: null,
  };
}

/**
 * --- Parser for the MtnPowder API ---
 * This is a new function to keep the logic separate
 */
function parseMtnPowderData(data) {
  if (!data?.Resorts || !Array.isArray(data.Resorts) || data.Resorts.length === 0) {
    console.warn('MtnPowder API returned empty or invalid data');
    return null;
  }
  const resort = data.Resorts[0];
  const report = resort?.SnowReport;

  if (!report) {
    console.warn('MtnPowder data missing "SnowReport" object');
    return null;
  }
  
  const change24h = report.AllMountain?.Last24HoursIn ?? report.BaseArea?.Last24HoursIn ?? null;
  
  let depth = null;
  if (report.PreferredBaseReporting === 'summit' && report.SummitArea?.BaseIn) {
    depth = report.SummitArea.BaseIn;
  } else if (report.PreferredBaseReporting === 'mid' && report.MidMountainArea?.BaseIn) {
    depth = report.MidMountainArea.BaseIn;
  } else {
    depth = report.BaseArea?.BaseIn ?? null;
  }

  return {
    name: resort.Name || "Resort Report",
    depth: depth !== null ? parseFloat(depth) : null,
    change24h: change24h !== null ? parseFloat(change24h) : null,

    // --- NEW DATA ---
    seasonTotal: report.SeasonTotalIn !== null ? parseFloat(report.SeasonTotalIn) : null,
    openLifts: report.TotalOpenLifts,
    totalLifts: report.TotalLifts,
    openTrails: report.TotalOpenTrails,
    totalTrails: report.TotalTrails,
  };
}

/**
 * Fetches data from a direct "Drupal" API (e.g., Killington, Copper)
 */
async function fetchDirectApiData(url) {
  let proxyUrl = url;
  if (url.includes('api.killington.com')) {
    proxyUrl = url.replace('https://api.killington.com/api/v1/dor/drupal', '/api/killington');
  } else if (url.includes('api.coppercolorado.com')) {
    proxyUrl = url.replace('https://api.coppercolorado.com/api/v1/dor/drupal', '/api/copper');
  } else {
    throw new Error(`Unknown directApi URL: ${url}. Please add a proxy in vite.config.js`);
  }

  const r = await fetch(proxyUrl, {
    headers: { 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`Direct API fetch failed (${r.status})`);
  const data = await r.json();
  
  // Use the specific parser
  return parseDrupalApiData(data);
}

/**
 * Fetches data from MtnPowder
 * (This is a new, separate function)
 */
async function fetchMtnPowderApiData(resortId) {
  const data = await fetchMtnPowderData(resortId); // Calls the function from mtnpowder.js
  // Use the specific parser
  return parseMtnPowderData(data);
}

/**
 * --- The Main Controller Function ---
 */
export async function fetchGroundTruth(resort) {
  
  // Priority 1: Try a direct JSON API (Killington, Copper)
  if (resort.links.directApi) {
    try {
      return await fetchDirectApiData(resort.links.directApi);
    } catch (e) {
      console.warn('Direct API fetch failed, falling back...', e);
    }
  }

  // Priority 2: Try MtnPowder API
  if (resort.links.mtnpowder_id) {
    try {
      // Call our new, separate function
      return await fetchMtnPowderApiData(resort.links.mtnpowder_id);
    } catch (e) {
      console.warn('MtnPowder fetch failed, falling back...', e);
    }
  }

  // Priority 3: Fallback to SNOTEL
  if (resort.links.snotel) {
    try {
      // SNOTEL data will be missing the new fields, but ui.js will handle it
      return await fetchSnotelData(resort.links.snotel);
    } catch (e) {
      console.warn('SNOTEL fetch failed:', e);
    }
  }

  return null;
}