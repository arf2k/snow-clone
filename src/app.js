import '../styles/main.css'; 
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
  renderGroundTruth, 
} from './ui.js';
import { getNwsEndpoints, fetchForecast, fetchGrid } from './nws.js';
import { setWindyFrame } from './windy.js';
import { fetchOpenMeteo } from './openmeteo.js';
import { fetchGroundTruth } from './groundTruth.js'; 

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
  const qpfMm24 = accumulateNwsTimeSeries(
    props?.quantitativePrecipitation?.values,
    24
  );
  const qpfIn24 = inchesFromMm(qpfMm24);
  const hasSnow = Array.isArray(props?.snowfallAmount?.values);
  let snowIn24, snowIn72;
  if (hasSnow) {
    const snowMm24 = accumulateNwsTimeSeries(props.snowfallAmount.values, 24);
    const snowMm72 = accumulateNwsTimeSeries(props.snowfallAmount.values, 72);
    snowIn24 = inchesFromMm(snowMm24);
    snowIn72 = inchesFromMm(snowMm72);
  } else {
    const qpfMm72 = accumulateNwsTimeSeries(
      props?.quantitativePrecipitation?.values,
      72
    );
    snowIn24 = qpfIn24 * 12;
    snowIn72 = inchesFromMm(qpfMm72) * 12;
  }
  return { snow24: snowIn24, snow72: snowIn72, qpf24: qpfIn24 };
}

/* -------------------- Open-Meteo Adapters ------------------- */
function getOmCurrentHourIndex(hourly) {
  const now = Date.now();
  const idx = hourly.time.findIndex((t) => Date.parse(t) > now);
  return idx > 0 ? idx - 1 : 0;
}

function adaptOmToKpis(omJson) {
  const i = getOmCurrentHourIndex(omJson.hourly);
  const temp = omJson.hourly.temperature_2m[i];
  const gust = omJson.hourly.wind_gusts_10m[i];
  const pop = omJson.hourly.precipitation_probability[i];
  const firstPeriod = {
    temperature: Math.round(temp),
    temperatureUnit: omJson.hourly_units.temperature_2m.replace('°', ''),
    windGust: `${Math.round(gust)} ${omJson.hourly_units.wind_gusts_10m}`,
  };
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
  const snowCm72 =
    (omJson.daily.snowfall_sum[0] || 0) +
    (omJson.daily.snowfall_sum[1] || 0) +
    (omJson.daily.snowfall_sum[2] || 0);
  const qpfMm24 = omJson.daily.precipitation_sum[0] || 0;
  return {
    snow24: snowCm24 / 2.54,
    snow72: snowCm72 / 2.54,
    qpf24: qpfMm24 / 25.4,
  };
}

function adaptOmToHourly(omJson) {
  const {
    time,
    temperature_2m,
    precipitation_probability,
    wind_speed_10m,
    wind_gusts_10m,
  } = omJson.hourly;
  const {
    temperature_2m: tempUnit,
    wind_speed_10m: windUnit,
    wind_gusts_10m: gustUnit,
  } = omJson.hourly_units;
  const periods = [];
  for (let i = 0; i < time.length; i++) {
    periods.push({
      startTime: time[i],
      temperature: Math.round(temperature_2m[i]),
      temperatureUnit: tempUnit.replace('°', ''),
      probabilityOfPrecipitation: precipitation_probability[i],
      windSpeed: `${Math.round(wind_speed_10m[i])} ${windUnit}`,
      windGust: `${Math.round(wind_gusts_10m[i])} ${gustUnit}`,
      shortForecast: 'N/A',
    });
  }
  return { properties: { periods } };
}

/* ----------------------- selection + loading ---------------------- */
function getSelected() {
  const r = RESORTS.find((x) => x.id === els.spot.value);
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
    RESORTS = json.filter(
      (x) => x?.elevations?.summit?.lat && x?.elevations?.summit?.lon
    );
    if (!RESORTS.length)
      throw new Error(
        'resorts.json loaded but no ready entries (check elevations).'
      );
    renderResortOptions(RESORTS);
    els.spot.value = RESORTS[0].id;
    setStatus('Resorts loaded ✓');
    els.refresh.disabled = false;
  } catch (e) {
    console.error('Failed to load resorts.json:', e);
    setError(
      `Failed to load resorts.json: ${e.message}\nURL: ${RESORTS_JSON_URL}`
    );
    setStatus('Error');
  }
}

/* ------------------------- run() functions ------------------------ */
async function runNws(elev) {
  setStatus('Fetching NWS…');
  showNwsLinks(true);
  const ep = await getNwsEndpoints(elev.lat, elev.lon);
  const [forecast, grid, hourly] = await Promise.all([
    fetchForecast(ep.forecastUrl),
    fetchGrid(ep.gridUrl),
    fetchForecast(ep.hourlyUrl),
  ]);
  renderKPIs(forecast?.properties?.periods?.[0], grid);
  renderPeriods(forecast);
  const totals = deriveTotalsFromNwsGrid(grid);
  renderTotals(totals);
  renderHourly(hourly, { limitHours: 36 });
  els.linkPoint.href = ep.forecastUrl;
  els.linkGrid.href = ep.gridUrl;
  els.linkHourly.href = ep.hourlyUrl;
}

async function runOpenMeteo(elev) {
  setStatus('Fetching Open-Meteo…');
  showNwsLinks(false);
  clearForecast();
  const omJson = await fetchOpenMeteo({
    lat: elev.lat,
    lon: elev.lon,
    elevation: elev.elev_m,
  });
  const { firstPeriod, grid } = adaptOmToKpis(omJson);
  renderKPIs(firstPeriod, grid);
  const totals = adaptOmToTotals(omJson);
  renderTotals(totals);
  const hourly = adaptOmToHourly(omJson);
  renderHourly(hourly, { limitHours: 36 });
}

/* ------------------- Main Router ------------------- */
async function fetchWeather(source, elev) {
  if (source === 'open-meteo') {
    await runOpenMeteo(elev);
    return;
  }
  await runNws(elev);
}

function updateMapAndRealityLinks(resort, elev) {
  setWindyFrame(els.windyFrame, els.openWindy, {
    lat: elev.lat,
    lon: elev.lon,
    overlay: els.overlaySel.value || DEFAULT_OVERLAY,
    zoom: Number(els.zoomSel.value || DEFAULT_ZOOM),
  });
  renderRealityLinks(resort);
}



async function updateGroundTruthCard(resort) {
  setStatus('Fetching Ground Truth…');
  try {
    // This one function now holds all our priority logic
    const groundTruthData = await fetchGroundTruth(resort);
    renderGroundTruth(groundTruthData); // ui.js handles null
  } catch (e) {
    console.warn('Ground Truth fetch failed:', e);
    renderGroundTruth(null); // Hide card on any error
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
    setError(
      'No resort selected (dropdown empty). resorts.json likely failed to load.'
    );
    setStatus('Error');
    return;
  }
  if (!elev) {
    setError(
      `Selected resort "${r.name}" is missing "${els.elev.value}" coordinates.`
    );
    setStatus('Error');
    return;
  }

  try {
    // Run weather and ground truth in parallel for speed
    const [weatherResult, groundTruthResult] = await Promise.allSettled([
      fetchWeather(source, elev),
      updateGroundTruthCard(r),
    ]);
    
    // This only updates links, so it can run after
    updateMapAndRealityLinks(r, elev);
    
    // Check if any of the main fetches failed
    if (weatherResult.status === 'rejected') {
      throw weatherResult.reason;
    }
    if (groundTruthResult.status === 'rejected') {
      console.warn('Ground truth promise failed:', groundTruthResult.reason);
    }
    
    setStatus('OK (live)');
  } catch (e) {
    console.error(e);
    setError(`Fetch failed: ${e.message}`);
    setStatus('Error');
  }
}

function updateWindyMap() {
  const { elev } = getSelected();
  if (!elev) return;
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
els.overlaySel.addEventListener('change', updateWindyMap);
els.zoomSel.addEventListener('change', updateWindyMap);
els.spot.addEventListener('change', run);
els.elev.addEventListener('change', run);
els.source.addEventListener('change', run);

/* --------------------------- boot -------------------------------- */
async function boot() {
  initTabs();
  await loadResorts();
  run();
}

boot();