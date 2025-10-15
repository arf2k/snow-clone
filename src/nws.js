export async function getNwsEndpoints(lat, lon){
  const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
  const pt = await fetch(pointsUrl, { headers: { 'Accept': 'application/geo+json' }});
  if (!pt.ok) throw new Error(`Points lookup failed (${pt.status})`);
  const j = await pt.json();
  return {
    pointsUrl,
    forecastUrl: j?.properties?.forecast,
    hourlyUrl: j?.properties?.forecastHourly,
    gridUrl: j?.properties?.forecastGridData,
  };
}

export async function fetchForecast(url){
  const r = await fetch(url, { headers: { 'Accept': 'application/geo+json' }});
  if (!r.ok) throw new Error(`Forecast fetch failed (${r.status})`);
  return r.json();
}

export async function fetchGrid(url){
  const r = await fetch(url, { headers: { 'Accept': 'application/geo+json' }});
  if (!r.ok) throw new Error(`Grid fetch failed (${r.status})`);
  return r.json();
}
