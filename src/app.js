// src/app.js
import { RESORTS_JSON_URL, DEFAULT_OVERLAY, DEFAULT_ZOOM } from './config.js';
import {
  els,
  setStatus,
  setError,
  clearForecast,
  renderResortOptions,
  renderRealityLinks,
  renderKPIs,
  renderPeriods,
  renderTotals,
  renderHourly,
  initTabs,
  showNwsLinks,
  renderSnotel,
} from './ui.js';
import { getNwsEndpoints, fetchForecast, fetchGrid } from './nws.js';
import { setWindyFrame } from './windy.js';
import { fetchOpenMeteo } from './openmeteo.js';
import { fetchSnotelData } from './snotel.js';

let RESORTS = [];

/* ----------------------- NWS helpers ----------------------- */
function inchesFromMm(mm) {
  return (mm ?? 0) / 25.4;
}

function accumulateNwsTimeSeries(values, hours) {
  if (!Array.isArray(values)) return 0;
  const now = Date.now();
  let sum = 0;
  for (const v of values) {
    if (v?.value == null || !v.validTime) continue;
    const [startStr] = v.validTime.split('/');
    const start = Date.parse(startStr);
    if (Number.isNaN(start)) continue;
    const dtHours = (start - now) / 3600000;
    if (dtHours >= 0 && dtHours < hours) sum += v.value;
  }
  return sum;
}

function deriveTotalsFromNwsGrid(gdJson) {
  const props = gdJson?.properties || {};
  const qpfMm24 = accumulateNwsTimeSeries(props?.quantitativePrecipitation?.values, 24);
  const qpfIn24 = inchesFromMm(qpfMm24);

  const hasSnow = Array.isArray(props?.snowfallAmount?.values);
  let snowIn24, snowIn72;

  if (hasSnow) {
    const snowMm24 = accumulateNwsTimeSeries(props.snowfallAmount.values, 24);
    const snowMm72 = accumulateNwsTimeSeries(props.snowfallAmount.values, 72);
    snowIn24 = inchesFromMm(snowMm24);
    snowIn72 = inchesFromMm(snowMm72);
  } else {
    // Fallback: 12:1 snow-to-liquid ratio
    const qpfMm72 = accumulateNwsTimeSeries(props?.quantitativePrecipitation?.values, 72);
    snowIn24 = qpfIn24 * 12;
    snowIn72 = inchesFromMm(qpfMm72) * 12;
  }

  return { snow24: snowIn24, snow72: snowIn72, qpf24: qpfIn24 };
}

/* -------------------- Open-Meteo Adapters ------------------- */
// Find the index of the current hour in the OM hourly data
function getOmCurrentHourIndex(hourly) {
  const now = Date.now();
  // Find the first time slot that is *after* the current time
  const idx = hourly.time.findIndex(t => Date.parse(t) > now);
  // Go back one to get the *current* hour
  return (idx > 0) ? idx - 1 : 0;
}

function adaptOmToKpis(omJson) {
  const i = getOmCurrentHourIndex(omJson.hourly);
  const temp = omJson.hourly.temperature_2m[i];
  const gust = omJson.hourly.wind_gusts_10m[i];
  const pop = omJson.hourly.precipitation_probability[i];

  // 1. Create a `firstPeriod` object
  const firstPeriod = {
    temperature: Math.round(temp),
    temperatureUnit: omJson.hourly_units.temperature_2m.replace('°', ''),
    windGust: `${Math.round(gust)} ${omJson.hourly_units.wind_gusts_10m}`,
  };

  // 2. Create a fake `grid` object just for the PoP
  const grid = {
    properties: {
      probabilityOfPrecipitation: {
        values: [{ value: pop }],
      },
    },
  };

  return { firstPeriod, grid };
}

function adaptOmToTotals(omJson) {
  const snowCm24 = omJson.daily.snowfall_sum[0] || 0;
  const snowCm72 = (omJson.daily.snowfall_sum[0] || 0) +
                   (omJson.daily.snowfall_sum[1] || 0) +
                   (omJson.daily.snowfall_sum[2] || 0);
  const qpfMm24 = omJson.daily.precipitation_sum[0] || 0;

  // Convert units (OM: cm/mm, UI: in/in)
  return {
    snow24: snowCm24 / 2.54, // cm to in
    snow72: snowCm72 / 2.54, // cm to in
    qpf24: qpfMm24 / 25.4,  // mm to in
  };
}

function adaptOmToHourly(omJson) {
  const { time, temperature_2m, precipitation_probability, wind_speed_10m, wind_gusts_10m } = omJson.hourly;
  const { temperature_2m: tempUnit, wind_speed_10m: windUnit, wind_gusts_10m: gustUnit } = omJson.hourly_units;

  const periods = [];
  for (let i = 0; i < time.length; i++) {
    periods.push({
      startTime: time[i],
      temperature: Math.round(temperature_2m[i]),
      temperatureUnit: tempUnit.replace('°', ''),
      probabilityOfPrecipitation: precipitation_probability[i],
      windSpeed: `${Math.round(wind_speed_10m[i])} ${windUnit}`,
      windGust: `${Math.round(wind_gusts_10m[i])} ${gustUnit}`,
      shortForecast: 'N/A', // OM does not provide text forecasts
    });
  }
  return { properties: { periods } };
}

/* ----------------------- selection + loading ---------------------- */
function getSelected() {
  const r = RESORTS.find(x => x.id === els.spot.value);
  const elevKey = els.elev.value;
  const elev = r?.elevations?.[elevKey];
  const source = els.source.value;
  return { r, elevKey, elev, source };
}

async function loadResorts() {
  setStatus('Loading resorts.json…');
  els.refresh.disabled = true;
  try {
    const r = await fetch(RESORTS_JSON_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`resorts.json HTTP ${r.status}`);
    const json = await r.json();

    RESORTS = json.filter(x => x?.elevations?.summit?.lat && x?.elevations?.summit?.lon);
    if (!RESORTS.length) throw new Error('resorts.json loaded but no ready entries (check elevations).');

    renderResortOptions(RESORTS);
    els.spot.value = RESORTS[0].id;
    setStatus('Resorts loaded ✓');
    els.refresh.disabled = false;
  } catch (e) {
    console.error('Failed to load resorts.json:', e);
    setError(`Failed to load resorts.json: ${e.message}\nURL: ${RESORTS_JSON_URL}`);
    setStatus('Error');
  }
}

/* ------------------------- run() functions ------------------------ */

async function runNws(elev) {
  setStatus('Fetching NWS…');
  showNwsLinks(true); // Show NWS-specific links

  const ep = await getNwsEndpoints(elev.lat, elev.lon);
  const [forecast, grid, hourly] = await Promise.all([
    fetchForecast(ep.forecastUrl),
    fetchGrid(ep.gridUrl),
    fetchForecast(ep.hourlyUrl),
  ]);

  // Period view
  renderKPIs(forecast?.properties?.periods?.[0], grid);
  renderPeriods(forecast); // NWS has text forecasts

  // Totals
  const totals = deriveTotalsFromNwsGrid(grid);
  renderTotals(totals);

  // Hourly view
  renderHourly(hourly, { limitHours: 36 });

  // Links
  els.linkPoint.href  = ep.forecastUrl;
  els.linkGrid.href   = ep.gridUrl;
  els.linkHourly.href = ep.hourlyUrl;
}

async function runOpenMeteo(elev) {
  setStatus('Fetching Open-Meteo…');
  showNwsLinks(false); // Hide NWS-specific links
  clearForecast(); // Clear NWS text periods

  const omJson = await fetchOpenMeteo({
    lat: elev.lat,
    lon: elev.lon,
    elevation: elev.elev_m,
  });

  // Period view
  const { firstPeriod, grid } = adaptOmToKpis(omJson);
  renderKPIs(firstPeriod, grid);
  // Note: We don't call renderPeriods() as OM has no text forecasts

  // Totals
  const totals = adaptOmToTotals(omJson);
  renderTotals(totals);

  // Hourly view
  const hourly = adaptOmToHourly(omJson);
  renderHourly(hourly, { limitHours: 36 });
}

/* ------------------- Main Router ------------------- */
async function fetchWeather(source, elev) {
  if (source === 'open-meteo') {
    await runOpenMeteo(elev);
    return;
  }

  await runNws(elev); // Default to NWS
}

function updateMapAndRealityLinks(resort, elev) {
  // This call is STILL NEEDED here, to update the map when the *resort* changes.
  setWindyFrame(els.windyFrame, els.openWindy, {
    lat: elev.lat,
    lon: elev.lon,
    overlay: els.overlaySel.value || DEFAULT_OVERLAY,
    zoom: Number(els.zoomSel.value || DEFAULT_ZOOM),
  });

  renderRealityLinks(resort);
}

async function updateSnotelCard(resort) {
  if (!resort.links?.snotel) {
    renderSnotel(null);
    return;
  }

  try {
    setStatus('Fetching SNOTEL…');
    const snotelData = await fetchSnotelData(resort.links.snotel);
    renderSnotel(snotelData);
  } catch (e) {
    console.warn('SNOTEL fetch failed:', e);
    renderSnotel(null); // Hide card on error
  }
}

async function run() {
  setError('');

  if (els.refresh.disabled) {
    setStatus('Waiting for resorts…');
    return;
  }

  const { r, elev, source } = getSelected();

  if (!r) {
    setError('No resort selected (dropdown empty). resorts.json likely failed to load.');
    setStatus('Error');
    return;
  }
  if (!elev) {
    setError(`Selected resort "${r.name}" is missing "${els.elev.value}" coordinates.`);
    setStatus('Error');
    return;
  }

  try {
    await fetchWeather(source, elev);
    updateMapAndRealityLinks(r, elev);
    await updateSnotelCard(r);
    setStatus('OK (live)');
  } catch (e) {
    console.error(e);
    setError(`Fetch failed: ${e.message}`);
    setStatus('Error');
  }
}
   


function updateWindyMap() {
  const { elev } = getSelected();
  if (!elev) return; // No resort loaded yet

  setWindyFrame(els.windyFrame, els.openWindy, {
    lat: elev.lat,
    lon: elev.lon,
    overlay: els.overlaySel.value || DEFAULT_OVERLAY,
    zoom: Number(els.zoomSel.value || DEFAULT_ZOOM),
  });
}
// ----------------------------------------------------------


/* ------------------------- event wiring --------------------------- */
els.refresh.addEventListener('click', run);
els.overlaySel.addEventListener('change', updateWindyMap); // <-- CHANGED from run
els.zoomSel.addEventListener('change', updateWindyMap);    // <-- CHANGED from run
els.spot.addEventListener('change', run);
els.elev.addEventListener('change', run);
els.source.addEventListener('change', run);

/* --------------------------- boot -------------------------------- */
initTabs();
await loadResorts();
run();
