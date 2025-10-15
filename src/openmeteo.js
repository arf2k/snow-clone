export async function fetchOpenMeteo({ lat, lon, elevation }){
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', lat);
  u.searchParams.set('longitude', lon);
  u.searchParams.set('hourly','snowfall,precipitation,temperature_2m,wind_speed_10m,wind_gusts_10m,freezing_level_height');
  u.searchParams.set('daily','snowfall_sum,precipitation_sum,wind_gusts_10m_max,temperature_2m_min,temperature_2m_max');
  u.searchParams.set('timezone','auto');
  if (elevation) u.searchParams.set('elevation', elevation);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`Open-Meteo failed (${r.status})`);
  return r.json();
}
