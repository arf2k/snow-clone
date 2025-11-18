

function proxyNwsUrl(url) {
  if (!url) return null;
  // This rewrites "https://api.weather.gov/gridpoints/..."
  // to "/api/nws/gridpoints/..."
  return url.replace('https://api.weather.gov', '/api/nws');
}

export async function getNwsEndpoints(lat, lon) {
  // Call our /api/nws proxy instead of the real URL ---
  const pointsUrl = `/api/nws/points/${lat},${lon}`;
  
  const pt = await fetch(pointsUrl, {
    headers: { Accept: 'application/geo+json' },
  });
  if (!pt.ok) throw new Error(`Points lookup failed (${pt.status})`);
  const j = await pt.json();


  return {
    pointsUrl: pointsUrl, 
    forecastUrl: proxyNwsUrl(j?.properties?.forecast),
    hourlyUrl: proxyNwsUrl(j?.properties?.forecastHourly),
    gridUrl: proxyNwsUrl(j?.properties?.forecastGridData),
  };
}

export async function fetchForecast(url) {
  const r = await fetch(url, { headers: { Accept: 'application/geo+json' } });
  if (!r.ok) throw new Error(`Forecast fetch failed (${r.status})`);
  return r.json();
}

export async function fetchGrid(url) {
  const r = await fetch(url, { headers: { Accept: 'application/geo+json' } });
  if (!r.ok) throw new Error(`Grid fetch failed (${r.status})`);
  return r.json();
}