/**
 * Helper function to format a Date object as YYYY-MM-DD
 */
function getSnotelDate(date) {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the valid daily readings for one element, oldest first.
 */
function readings(data, element) {
  const series = data.find((s) => s?.stationElement?.elementCode === element);
  return (series?.values || []).filter(
    (v) => v?.value != null && v.value > -1000
  );
}

/**
 * Fetches SNOTEL data for a given station.
 */
export async function fetchSnotelData(stationTriplet, { signal } = {}) {
  const elements = 'SNWD,WTEQ,TAVG'; // Snow Depth, Water Equivalent, Avg Temp

  // Ask for a week and use the newest reading that exists: today's daily
  // value is usually not posted yet, and stations sometimes skip a day.
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 3600000);

  const beginDate = getSnotelDate(weekAgo);
  const endDate = getSnotelDate(today);

  const u = new URL('/api/snotel/data', window.location.origin);

  u.searchParams.set('stationTriplets', stationTriplet);
  u.searchParams.set('elements', elements);
  u.searchParams.set('duration', 'DAILY');

  u.searchParams.set('beginDate', beginDate);
  u.searchParams.set('endDate', endDate);

  const r = await fetch(u.toString(), { signal });
  if (!r.ok) {
    const errBody = await r.text();
    console.error('SNOTEL API Error Body:', errBody);
    throw new Error(`SNOTEL fetch failed (${r.status}): ${errBody}`);
  }

  const data = await r.json();

  if (!Array.isArray(data) || data.length === 0 || !data[0].data) {
    console.warn('SNOTEL returned empty data for', stationTriplet);
    return null;
  }

  const stationData = data[0].data;

  const depths = readings(stationData, 'SNWD');
  const latest = depths.at(-1);
  const previous = depths.at(-2);
  const wteq = readings(stationData, 'WTEQ').at(-1);
  const temp = readings(stationData, 'TAVG').at(-1);

  if (!latest && !wteq) return null;

  return {
    name: data[0]?.stationName || stationTriplet,
    source: `SNOTEL ${stationTriplet}${latest ? ` · ${latest.date}` : ''}`,
    depth: latest?.value ?? null,
    wteq: wteq?.value ?? null,
    temp: temp?.value ?? null,
    // Change in settled depth between the last two readings (can be negative)
    change24h: latest && previous ? latest.value - previous.value : null,
  };
}
