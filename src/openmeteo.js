export async function fetchOpenMeteo({ lat, lon, elevation }, { signal } = {}) {
  const u = new URL('/api/open-meteo/forecast', window.location.origin);

  u.searchParams.set('latitude', lat);
  u.searchParams.set('longitude', lon);
  u.searchParams.set(
    'hourly',
    'snowfall,precipitation,precipitation_probability,temperature_2m,wind_speed_10m,wind_gusts_10m,freezing_level_height'
  );
  // Unix timestamps are unambiguous. The default (local ISO strings with no
  // offset) gets parsed in the *browser's* timezone, which is wrong whenever
  // the viewer is not in the resort's timezone.
  u.searchParams.set('timeformat', 'unixtime');
  u.searchParams.set('timezone', 'GMT');

  u.searchParams.set('temperature_unit', 'fahrenheit');
  u.searchParams.set('wind_speed_unit', 'mph');

  if (elevation) u.searchParams.set('elevation', elevation);

  const r = await fetch(u.toString(), { signal });
  if (!r.ok) throw new Error(`Open-Meteo failed (${r.status})`);
  return r.json();
}
