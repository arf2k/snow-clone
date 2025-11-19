import { fetchSnotelData } from './snotel.js';
import { fetchMtnPowderData } from './mtnpowder.js';

/**
 * ---------------- PROXY CONFIGURATION ----------------
 * Map unique domains to their local proxy paths.
 */
const PROXY_MAP = {
  'api.killington.com':           '/api/killington',      
  'api.coppercolorado.com':       '/api/copper',          
  'jacksonhole-prod.zaneray.com': '/api/jacksonhole',     
  'www.sugarloaf.com':            '/api/sugarloaf',       
  'api.snowbird.com':             '/api/snowbird',
  'brightonresort.com':           '/api/brighton', 
};

/**
 * ---------------- HELPERS ----------------
 */

function toNumberOrNull(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isNaN(n) ? null : n;
}

function stripHtml(html) {
  if (!html) return '';
  const text = html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>?/gm, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function attr(label, value, type = 'info') {
  if (value == null || value === '' || value === 'null') return null;
  return { label, value, type };
}

/**
 * ---------------- SPECIFIC PARSERS ----------------
 */

/* Jackson Hole (Zaneray JSON) */
function parseJacksonHole(data) {
  const snow = data?.snow || {};
  const weather = data?.weather || {};

  const summit = snow.tramSummit || {};
  const wSummit = weather.tramSummit || {};
  const wBase = weather.base || {};
  
  const temp = toNumberOrNull(wSummit.temperature?.value) ?? toNumberOrNull(wBase.temperature?.value);

  const attributes = [
    attr('Wind (Summit)', wSummit.wind?.value ? `${wSummit.wind.value} ${wSummit.wind.unitSymbol || 'mph'}` : null, Number(wSummit.wind?.value) > 30 ? 'warning' : 'info'),
    attr('Wind (Base)', wBase.wind?.value ? `${wBase.wind.value} ${wBase.wind.unitSymbol || 'mph'}` : null),
    attr('Inversion', snow.inversion ? 'Detected' : null, 'warning')
  ];

  return {
    source: 'Direct (JHMR)',
    depth: toNumberOrNull(summit.totalSnowDepth?.value),
    change24h: toNumberOrNull(summit.newSnowLast24H?.value),
    seasonTotal: toNumberOrNull(summit.seasonTotalSnow?.value),
    openLifts: null, 
    totalLifts: null,
    openTrails: null,
    totalTrails: null,
    temp,
    attributes: attributes.filter(Boolean),
    excerpt: snow.detail || snow.inversionMessage || ''
  };
}

/* Brighton / Sugarloaf (ReportPal JSON) */
function parseReportPal(data) {
  const current = data?.currentConditions?.resortLocations?.location?.[0] || {};
  const resortwide = data?.currentConditions?.resortwide || {};
  const comments = data?.comments?.comment || [];

  const attributes = [];
  
  // Uphill Status
  const uphillComment = comments.find(c => 
    (c.title && c.title.toLowerCase().includes('uphill')) || 
    (c.text && c.text.toLowerCase().includes('uphill'))
  );
  if (uphillComment) {
    const text = (uphillComment.text || '').toLowerCase();
    const isClosed = text.includes('not allowed') || text.includes('closed') || text.includes('red');
    attributes.push(attr('Uphill Travel', isClosed ? 'Closed' : 'Open', isClosed ? 'error' : 'success'));
  }

  // Road Status
  const roadComment = comments.find(c => c.name === 'Road' || (c.title && c.title.toLowerCase().includes('road')));
  if (roadComment) {
    const text = stripHtml(roadComment.text || roadComment.title);
    const type = text.toLowerCase().includes('traction') || text.toLowerCase().includes('closed') ? 'warning' : 'info';
    attributes.push(attr('Roads', text, type));
  }

  const mainComment = comments.find(c => c.name === 'Comment' || c.name === 'Weather');

  return {
    source: 'Direct (ReportPal)',
    depth: toNumberOrNull(current.base?.inches),
    change24h: toNumberOrNull(current.snow24Hours?.inches),
    seasonTotal: toNumberOrNull(current.snowSeasonTotal?.inches),
    openLifts: toNumberOrNull(resortwide.numLiftsOpen),
    totalLifts: toNumberOrNull(resortwide.numLiftsTotal),
    openTrails: toNumberOrNull(resortwide.numTrailsOpen),
    totalTrails: toNumberOrNull(resortwide.numTrailsTotal),
    temp: null,
    attributes: attributes.filter(Boolean),
    excerpt: mainComment ? stripHtml(mainComment.text) : ''
  };
}

/* Killington / Copper / Snowbird (Drupal Array) */
function parseDrupal(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const report = data[0]; 
  const computed = report.computed || {};

  const attributes = [];
  if (report.author && report.author.name) {
    attributes.push(attr('Report By', report.author.name));
  }

  let excerpt = stripHtml(report.report);
  if (excerpt.length > 150) excerpt = excerpt.substring(0, 150) + '...';

  return {
    source: 'Direct (Drupal)',
    depth: toNumberOrNull(report.base_depth),
    change24h: toNumberOrNull(computed['24_hour']) ?? toNumberOrNull(report.amount),
    seasonTotal: toNumberOrNull(computed.total) ?? toNumberOrNull(computed.season_total),
    openLifts: null,
    totalLifts: null,
    openTrails: null,
    totalTrails: null,
    temp: null,
    attributes: attributes.filter(Boolean),
    excerpt
  };
}

/* Stratton (MtnPowder) */
function parseMtnPowder(raw) {
  let report = raw;
  if (raw.Resorts && Array.isArray(raw.Resorts)) {
    report = raw.Resorts[0]?.SnowReport;
  } else if (raw.SnowReport) {
    report = raw.SnowReport;
  }
  if (!report) return null;

  const attributes = [
    attr('Snowmaking', report.SnowMakingActive === 'true' ? 'Active' : 'Inactive', report.SnowMakingActive === 'true' ? 'success' : 'info'),
    attr('Grooming', report.GroomingActive === 'true' ? 'Yes' : 'No'),
    attr('Acres Open', report.OpenTerrainAcres && report.OpenTerrainAcres !== '0' ? report.OpenTerrainAcres : null)
  ];

  let excerpt = stripHtml(report.Report);
  if (excerpt.length > 150) excerpt = excerpt.substring(0, 150) + '...';

  return {
    source: 'MtnPowder',
    depth: toNumberOrNull(report.SummitArea?.BaseIn) ?? toNumberOrNull(report.BaseArea?.BaseIn),
    change24h: toNumberOrNull(report.AllMountain?.Last24HoursIn) ?? toNumberOrNull(report.SummitArea?.Last24HoursIn),
    seasonTotal: toNumberOrNull(report.SeasonTotalIn),
    openLifts: toNumberOrNull(report.TotalOpenLifts),
    totalLifts: toNumberOrNull(report.TotalLifts),
    openTrails: toNumberOrNull(report.TotalOpenTrails),
    totalTrails: toNumberOrNull(report.TotalTrails),
    temp: null,
    attributes: attributes.filter(Boolean),
    excerpt
  };
}

/**
 * ---------------- MAIN FETCH ----------------
 */
export async function fetchGroundTruth(resort) {
  if (!resort || !resort.links) return null;

  try {
    // 1. Try Direct API (Highest Priority)
    if (resort.links.directApi) {
      const originalUrl = resort.links.directApi;
      let fetchUrl = originalUrl;

      // Iterate through our Proxy Map
      for (const [domain, proxyPath] of Object.entries(PROXY_MAP)) {
        // Check if the URL contains the domain (e.g. "brightonresort.com")
        if (originalUrl.includes(domain)) {
          
          // SPECIAL CASE: Drupal/Killington (Requires stripping a specific path prefix)
          if (domain.includes('killington') || domain.includes('copper') || domain.includes('snowbird')) {
             // Replace the specific Drupal base path with the proxy
             fetchUrl = originalUrl.replace(`https://${domain}/api/v1/dor/drupal`, proxyPath);
             // Handle cases where 'www' might cause a mismatch manually
             if (fetchUrl === originalUrl) {
                fetchUrl = originalUrl.replace(`https://www.${domain}/api/v1/dor/drupal`, proxyPath);
             }
          } 
          // STANDARD CASE: Simple Domain Swap (Brighton, Jackson Hole, etc.)
          else {
             try {
               // Use the URL object to cleanly swap the Origin
               const u = new URL(originalUrl);
               // Construct: /api/brighton + /api/reportpal?resortName=br...
               fetchUrl = `${proxyPath}${u.pathname}${u.search}`;
             } catch (e) {
               // Fallback if URL parsing fails
               console.error('URL parse failed', e);
             }
          }
          break; // Stop checking once we match
        }
      }

      // Debug log to confirm the rewrite happened
      if (originalUrl.includes('brighton')) {
        console.log(`[Brighton Debug] Rewrote ${originalUrl} -> ${fetchUrl}`);
      }

      const r = await fetch(fetchUrl);
      if (r.ok) {
        const json = await r.json();

        // Select Parser
        if (resort.groundTruthConfig?.schema === 'multi-zone-snow' || originalUrl.includes('jacksonhole')) {
          return parseJacksonHole(json);
        } else if (originalUrl.includes('reportpal')) {
          return parseReportPal(json);
        } else if (Array.isArray(json)) {
          return parseDrupal(json);
        }
      } else {
        console.warn(`Direct API error (${r.status}) for ${resort.name}:`, fetchUrl);
      }
    }

    // 2. Try MtnPowder (Medium Priority)
    if (resort.links.mtnpowder_id != null) {
      const data = await fetchMtnPowderData(resort.links.mtnpowder_id);
      const parsed = parseMtnPowder(data);
      if (parsed) return parsed;
    }

    // 3. Fallback to SNOTEL (Lowest Priority)
    if (resort.links.snotel) {
      return await fetchSnotelData(resort.links.snotel);
    }

  } catch (e) {
    console.warn('Ground Truth fetch error:', e);
  }
  
  return null;
}