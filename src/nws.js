// nws.js

const NWS_BASE = '/api/nws';

const NWS_HEADERS = {
  Accept: 'application/geo+json',
  // NWS requires a User-Agent; customize this string if you want
  'User-Agent': 'snow-dashboard (contact: example@example.com)',
};

function proxyNwsUrl(url) {
  if (!url) return null;
  // This rewrites "https://api.weather.gov/..." to "/api/nws/..."
  return url.replace('https://api.weather.gov', NWS_BASE);
}

/**
 * Build a stable /points path for NWS:
 * - Coerce lat/lon to numbers
 * - Clamp to 4 decimal places (NWS docs recommend <= 4)
 */
function buildPointsPath(lat, lon) {
  const latNum = typeof lat === 'string' ? Number(lat) : lat;
  const lonNum = typeof lon === 'string' ? Number(lon) : lon;

  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    throw new Error(`Invalid lat/lon for NWS points: ${lat},${lon}`);
  }

  const latStr = latNum.toFixed(4);
  const lonStr = lonNum.toFixed(4);

  return `${NWS_BASE}/points/${latStr},${lonStr}`;
}

export async function getNwsEndpoints(lat, lon) {
  const pointsUrl = buildPointsPath(lat, lon);

  const pt = await fetch(pointsUrl, {
    headers: NWS_HEADERS,
  });

  if (!pt.ok) {
    let bodyText = '';
    try {
      bodyText = await pt.text();
    } catch {
      // ignore read errors
    }

    console.error('NWS points lookup failed', {
      url: pointsUrl,
      status: pt.status,
      statusText: pt.statusText,
      body: bodyText,
    });

    throw new Error(`Points lookup failed (${pt.status})`);
  }

  const j = await pt.json();

  return {
    pointsUrl,
    forecastUrl: proxyNwsUrl(j?.properties?.forecast),
    hourlyUrl: proxyNwsUrl(j?.properties?.forecastHourly),
    gridUrl: proxyNwsUrl(j?.properties?.forecastGridData),
  };
}

export async function fetchForecast(url) {
  const r = await fetch(url, {
    headers: NWS_HEADERS,
  });
  if (!r.ok) {
    let bodyText = '';
    try {
      bodyText = await r.text();
    } catch {
      // ignore
    }
    console.error('NWS forecast fetch failed', {
      url,
      status: r.status,
      statusText: r.statusText,
      body: bodyText,
    });
    throw new Error(`Forecast fetch failed (${r.status})`);
  }
  return r.json();
}

export async function fetchGrid(url) {
  const r = await fetch(url, {
    headers: NWS_HEADERS,
  });
  if (!r.ok) {
    let bodyText = '';
    try {
      bodyText = await r.text();
    } catch {
      // ignore
    }
    console.error('NWS grid fetch failed', {
      url,
      status: r.status,
      statusText: r.statusText,
      body: bodyText,
    });
    throw new Error(`Grid fetch failed (${r.status})`);
  }
  return r.json();
}
