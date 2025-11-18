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
 * Parses the complex NRCS JSON response to find a single value.
 */
function parseElement(data, element, dayIndex) {
  try {
    const series = data.find((s) => s.stationElement.elementCode === element);
    if (!series) return null;

    const values = series.values;
    if (!values || values.length === 0) return null;

    // Data is returned in chronological order, so 0 is yesterday, 1 is today.
    const val = values[dayIndex]?.value;

    return val != null && val > -1000 ? val : null;
  } catch (e) {
    console.warn(`Failed to parse SNOTEL element ${element}`, e);
    return null;
  }
}

/**
 * Fetches SNOTEL data for a given station.
 */
export async function fetchSnotelData(stationTriplet) {
  const elements = 'SNWD,WTEQ,TAVG'; // Snow Depth, Water Equivalent, Avg Temp

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const beginDate = getSnotelDate(yesterday);
  const endDate = getSnotelDate(today);

  const u = new URL('/api/snotel/data', window.location.origin);

  u.searchParams.set('stationTriplets', stationTriplet);
  u.searchParams.set('elements', elements);
  u.searchParams.set('timeseries', 'daily');
  u.searchParams.set('format', 'json');
  u.searchParams.set('units', 'english');

  u.searchParams.set('beginDate', beginDate);
  u.searchParams.set('endDate', endDate);

  const r = await fetch(u.toString());
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
  const stationName = data[0]?.stationName || stationTriplet;

  // With a 2-day range, index 0 = yesterday, index 1 = today
  const todayVal = {
    depth: parseElement(stationData, 'SNWD', 1),
    wteq: parseElement(stationData, 'WTEQ', 1),
    temp: parseElement(stationData, 'TAVG', 1),
  };

  const yesterdayVal = {
    depth: parseElement(stationData, 'SNWD', 0),
  };

  // Calculate 24h change
  const change24h =
    todayVal.depth != null && yesterdayVal.depth != null
      ? todayVal.depth - yesterdayVal.depth
      : null;

  return {
    name: stationName,
    source: 'snotel',
    depth: todayVal.depth,
    wteq: todayVal.wteq,
    temp: todayVal.temp,
    change24h: change24h,
  };
}