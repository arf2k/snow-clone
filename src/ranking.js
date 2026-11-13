// ranking.js — forecast snowfall for every resort in one Open-Meteo request

const CM_PER_IN = 2.54;

// hourly.time is unix seconds. Returns the index of the hour in progress.
export function currentHourIndex(hourly, now = Date.now()) {
  const idx = hourly.time.findIndex((t) => t * 1000 > now);
  if (idx === -1) return hourly.time.length - 1;
  return idx > 0 ? idx - 1 : 0;
}

function summarize(hourly) {
  // Each hourly value covers the hour *ending* at its timestamp, so the
  // rolling window starts with the hour after the current one.
  const start = currentHourIndex(hourly) + 1;
  const window = (series, hours) => (series || []).slice(start, start + hours);
  const snowIn = (hours) =>
    window(hourly.snowfall, hours).reduce((acc, v) => acc + (v || 0), 0) /
    CM_PER_IN;
  const gusts = window(hourly.wind_gusts_10m, 24).filter((v) => v != null);

  return {
    snow24: snowIn(24),
    snow72: snowIn(72),
    snow7d: snowIn(168),
    gust24: gusts.length ? Math.max(...gusts) : null,
  };
}

/**
 * Fetch the next-7-day outlook for all resorts at one elevation band.
 * Open-Meteo accepts comma-separated coordinates and answers with one entry
 * per location, in request order.
 * @returns {Promise<Array<{id, name, region, snow24, snow72, snow7d, gust24}>>}
 */
export async function fetchRanking(resorts, elevKey, { signal } = {}) {
  const targets = resorts
    .map((r) => ({ r, e: r.elevations?.[elevKey] || r.elevations?.summit }))
    .filter(({ e }) => e?.lat != null && e?.lon != null);
  if (!targets.length) return [];

  const u = new URL('/api/open-meteo/forecast', window.location.origin);
  u.searchParams.set('latitude', targets.map(({ e }) => e.lat).join(','));
  u.searchParams.set('longitude', targets.map(({ e }) => e.lon).join(','));
  // Elevation must be given for every location or none
  if (targets.every(({ e }) => e.elev_m != null)) {
    u.searchParams.set('elevation', targets.map(({ e }) => e.elev_m).join(','));
  }
  u.searchParams.set('hourly', 'snowfall,wind_gusts_10m');
  u.searchParams.set('forecast_days', '8'); // a full 7 days from any hour
  u.searchParams.set('timeformat', 'unixtime');
  u.searchParams.set('timezone', 'GMT');
  u.searchParams.set('wind_speed_unit', 'mph');

  const res = await fetch(u.toString(), { signal });
  if (!res.ok) throw new Error(`Open-Meteo ranking failed (${res.status})`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== targets.length) {
    throw new Error(
      `Open-Meteo returned ${list.length} locations for ${targets.length} resorts`
    );
  }

  return targets.map(({ r }, i) => ({
    id: r.id,
    name: r.name,
    region: r.region,
    ...summarize(list[i].hourly),
  }));
}
