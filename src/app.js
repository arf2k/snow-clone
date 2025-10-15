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
} from './ui.js';
import { getNwsEndpoints, fetchForecast, fetchGrid } from './nws.js';
import { setWindyFrame } from './windy.js';

let RESORTS = [];

/* ----------------------- helpers for totals ----------------------- */
function inchesFromMm(mm) {
  return (mm ?? 0) / 25.4;
}

function accumulateTimeSeries(values, hours) {
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

function deriveTotalsFromGrid(gdJson) {
  const props = gdJson?.properties || {};
  const qpfMm24 = accumulateTimeSeries(props?.quantitativePrecipitation?.values, 24);
  const qpfIn24 = inchesFromMm(qpfMm24);

  const hasSnow = Array.isArray(props?.snowfallAmount?.values);
  let snowIn24, snowIn72;

  if (hasSnow) {
    const snowMm24 = accumulateTimeSeries(props.snowfallAmount.values, 24);
    const snowMm72 = accumulateTimeSeries(props.snowfallAmount.values, 72);
    snowIn24 = inchesFromMm(snowMm24);
    snowIn72 = inchesFromMm(snowMm72);
  } else {
    const qpfMm72 = accumulateTimeSeries(props?.quantitativePrecipitation?.values, 72);
    snowIn24 = qpfIn24 * 12;
    snowIn72 = inchesFromMm(qpfMm72) * 12;
  }

  return { snow24: snowIn24, snow72: snowIn72, qpf24: qpfIn24 };
}

/* ----------------------- selection + loading ---------------------- */
function getSelected() {
  const r = RESORTS.find(x => x.id === els.spot.value);
  const elevKey = els.elev.value;
  const elev = r?.elevations?.[elevKey];
  return { r, elevKey, elev };
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

/* ----------------------------- run() ------------------------------ */
async function run() {
  setError('');
  clearForecast();

  if (els.refresh.disabled) {
    setStatus('Waiting for resorts…');
    return;
  }

  setStatus('Fetching NWS…');
  const { r, elev } = getSelected();

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
    const ep = await getNwsEndpoints(elev.lat, elev.lon);
    const [forecast, grid, hourly] = await Promise.all([
      fetchForecast(ep.forecastUrl),
      fetchGrid(ep.gridUrl),
      fetchForecast(ep.hourlyUrl), // hourly endpoint
    ]);

    // Period view
    renderKPIs(forecast?.properties?.periods?.[0], grid);
    renderPeriods(forecast);

    // Totals
    const totals = deriveTotalsFromGrid(grid);
    renderTotals(totals);

    // Hourly view
    renderHourly(hourly, { limitHours: 36 });

    // Links
    els.linkPoint.href  = ep.forecastUrl;
    els.linkGrid.href   = ep.gridUrl;
    els.linkHourly.href = ep.hourlyUrl;

    // Windy
    setWindyFrame(els.windyFrame, els.openWindy, {
      lat: elev.lat,
      lon: elev.lon,
      overlay: els.overlaySel.value || DEFAULT_OVERLAY,
      zoom: Number(els.zoomSel.value || DEFAULT_ZOOM),
    });

    // Reality links
    renderRealityLinks(r);

    setStatus('OK (live)');
  } catch (e) {
    console.error(e);
    setError(`NWS fetch failed: ${e.message}`);
    setStatus('Error');
  }
}

/* ------------------------- event wiring --------------------------- */
els.refresh.addEventListener('click', run);
els.overlaySel.addEventListener('change', run);
els.zoomSel.addEventListener('change', run);
els.spot.addEventListener('change', run);
els.elev.addEventListener('change', run);

/* --------------------------- boot -------------------------------- */
initTabs();        // enable Forecast/Hourly tab behavior
await loadResorts();
run();
