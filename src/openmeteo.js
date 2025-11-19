export async function fetchOpenMeteo({ lat, lon, elevation }, { signal } = {}) {
  const u = new URL('/api/open-meteo/forecast', window.location.origin);
  
  u.searchParams.set('latitude', lat);
  u.searchParams.set('longitude', lon);
  u.searchParams.set(
    'hourly',
    'snowfall,precipitation,precipitation_probability,temperature_2m,wind_speed_10m,wind_gusts_10m,freezing_level_height'
  );
  u.searchParams.set(
    'daily',
    'snowfall_sum,precipitation_sum,wind_gusts_10m_max,temperature_2m_min,temperature_2m_max'
  );
  u.searchParams.set('timezone', 'auto');

  u.searchParams.set('temperature_unit', 'fahrenheit');
  u.searchParams.set('wind_speed_unit', 'mph');

  if (elevation) u.searchParams.set('elevation', elevation);
  
  const r = await fetch(u.toString(), { signal });
  if (!r.ok) throw new Error(`Open-Meteo failed (${r.status})`);
  return r.json();
}