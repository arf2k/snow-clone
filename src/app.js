import '../styles/main.css';
import {
  RESORTS_JSON_URL,
  DEFAULT_OVERLAY,
  DEFAULT_ZOOM,
  WIND_HOLD_GUST_MPH,
} from './config.js';
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
  renderRegionOptions,
  renderRanking,
  setRankingStatus,
} from './ui.js';
import { getNwsEndpoints, fetchForecast, fetchGrid } from './nws.js';
import { buildWindyUrls } from './windy.js';
import { fetchOpenMeteo } from './openmeteo.js';
import { fetchGroundTruth } from './groundTruth.js';
import { fetchRanking, currentHourIndex } from './ranking.js';

let RESORTS = [];
// One budget per provider attempt. NWS needs a /points lookup followed by
// three more requests and is often slow, so this is deliberately generous.
const WEATHER_TIMEOUT_MS = 20000;
const PREFS_KEY = 'snowchase:prefs';
const HOUR_MS = 3600000;
let windyLoaded = false;
let pendingWindySrc = '';
let activeRun = null; // AbortController for the run currently on screen

// Ranking state
const RANKING_TTL_MS = 15 * 60000;
const rankingCache = new Map(); // elevKey -> { at, rows }
let rankingLoad = null; // AbortController for the ranking request in flight
let rankingRows = [];
let rankingSort = { key: 'snow72', dir: 'desc' };

/* ----------------------- saved selection ----------------------- */
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        spot: els.spot.value,
        elev: els.elev.value,
        source: els.source.value,
        overlay: els.overlaySel.value,
        zoom: els.zoomSel.value,
        region: els.rankRegion.value,
      })
    );
  } catch {
    // storage unavailable (private mode etc.) — the app works without it
  }
}

function applyPrefs() {
  const prefs = loadPrefs();
  const restore = (select, value) => {
    if (value == null) return;
    const exists = [...select.options].some((o) => o.value === String(value));
    if (exists) select.value = String(value);
  };
  restore(els.spot, prefs.spot);
  restore(els.elev, prefs.elev);
  restore(els.source, prefs.source);
  restore(els.overlaySel, prefs.overlay);
  restore(els.zoomSel, prefs.zoom);
  restore(els.rankRegion, prefs.region);
}

/* ----------------------- NWS helpers ----------------------- */
function inchesFromMm(mm) {
  return (mm ?? 0) / 25.4;
}

// ISO-8601 duration as used by NWS validTime, e.g. PT6H, P1DT6H, PT30M
function durationMs(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso || '');
  if (!m) return HOUR_MS;
  const [, d = 0, h = 0, min = 0] = m;
  return (Number(d) * 24 + Number(h)) * HOUR_MS + Number(min) * 60000;
}

function parseValidTime(validTime) {
  const [startStr, durStr] = String(validTime || '').split('/');
  const start = Date.parse(startStr);
  if (Number.isNaN(start)) return null;
  return { start, end: start + durationMs(durStr) };
}

/**
 * Sum an NWS grid accumulation series over the next `hours` hours.
 * Each entry covers an interval; it is counted in proportion to how much of
 * that interval overlaps the window, so the period in progress right now and
 * the one straddling the end of the window are both included fairly.
 */
function accumulateNwsTimeSeries(values, hours, now = Date.now()) {
  if (!Array.isArray(values)) return 0;
  const windowEnd = now + hours * HOUR_MS;
  let sum = 0;
  for (const v of values) {
    if (v?.value == null) continue;
    const t = parseValidTime(v.validTime);
    if (!t || t.end <= t.start) continue;
    const overlap = Math.min(t.end, windowEnd) - Math.max(t.start, now);
    if (overlap > 0) sum += v.value * (overlap / (t.end - t.start));
  }
  return sum;
}

// Value of an NWS grid series for the interval containing `now`
// (falling back to the next upcoming one).
function currentNwsValue(values, now = Date.now()) {
  if (!Array.isArray(values)) return null;
  let next = null;
  for (const v of values) {
    if (v?.value == null) continue;
    const t = parseValidTime(v.validTime);
    if (!t) continue;
    if (t.start <= now && now < t.end) return v.value;
    if (t.start > now && (!next || t.start < next.start))
      next = { start: t.start, value: v.value };
  }
  return next ? next.value : null;
}

function deriveTotalsFromNwsGrid(gdJson) {
  const props = gdJson?.properties || {};
  const qpf = props?.quantitativePrecipitation?.values;
  const snow = props?.snowfallAmount?.values;
  const qpfIn24 = inchesFromMm(accumulateNwsTimeSeries(qpf, 24));
  if (Array.isArray(snow)) {
    return {
      snow24: inchesFromMm(accumulateNwsTimeSeries(snow, 24)),
      snow72: inchesFromMm(accumulateNwsTimeSeries(snow, 72)),
      qpf24: qpfIn24,
    };
  }
  // No snowfall series: rough 12:1 estimate from liquid precipitation
  return {
    snow24: qpfIn24 * 12,
    snow72: inchesFromMm(accumulateNwsTimeSeries(qpf, 72)) * 12,
    qpf24: qpfIn24,
  };
}

/* -------------------- Open-Meteo Adapters ------------------- */
function adaptOmToKpis(omJson) {
  const i = currentHourIndex(omJson.hourly);
  const temp = omJson.hourly.temperature_2m[i];
  const gust = omJson.hourly.wind_gusts_10m[i];
  const firstPeriod = {
    temperature: Math.round(temp),
    temperatureUnit: omJson.hourly_units.temperature_2m.replace('°', ''),
    windGust: `${Math.round(gust)} ${omJson.hourly_units.wind_gusts_10m}`,
  };
  return { firstPeriod, pop: omJson.hourly.precipitation_probability[i] };
}

// Rolling totals for the next 24h/72h, same window as the NWS numbers.
// Each hourly value is the accumulation over the hour *ending* at its
// timestamp, so the window starts with the hour after the current one.
function adaptOmToTotals(omJson) {
  const { snowfall, precipitation } = omJson.hourly;
  const start = currentHourIndex(omJson.hourly) + 1;
  const sum = (series, hours) =>
    series.slice(start, start + hours).reduce((acc, v) => acc + (v || 0), 0);
  return {
    snow24: sum(snowfall, 24) / 2.54, // cm -> in
    snow72: sum(snowfall, 72) / 2.54,
    qpf24: sum(precipitation, 24) / 25.4, // mm -> in
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
  for (let i = currentHourIndex(omJson.hourly); i < time.length; i++) {
    periods.push({
      startTime: new Date(time[i] * 1000).toISOString(),
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
    renderRegionOptions(RESORTS);
    els.spot.value = RESORTS[0].id;
    applyPrefs();
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
// Each returns a list of warnings for parts that could not be loaded.
// `signal` aborts on timeout or when a newer run supersedes this one;
// throwIfAborted() after every await keeps stale data off the screen.
async function runNws(elev, { signal } = {}) {
  setStatus('Fetching NWS…');
  const ep = await getNwsEndpoints(elev.lat, elev.lon, { signal });

  const forecastPromise = fetchForecast(ep.forecastUrl, { signal });
  // Attach handlers now so a rejection is never reported as unhandled
  const gridResult = fetchGrid(ep.gridUrl, { signal }).then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  const hourlyResult = fetchForecast(ep.hourlyUrl, { signal }).then(
    (value) => ({ value }),
    (error) => ({ error })
  );

  // The text forecast is the one required piece: if it fails, the whole
  // provider fails and the caller falls back.
  const forecast = await forecastPromise;
  signal?.throwIfAborted();

  showNwsLinks(true);
  els.linkPoint.href = ep.forecastUrl;
  els.linkGrid.href = ep.gridUrl;
  els.linkHourly.href = ep.hourlyUrl;

  const firstPeriod = forecast?.properties?.periods?.[0];
  renderKPIs(firstPeriod, null);
  renderPeriods(forecast);
  renderTotals({ snow24: null, snow72: null, qpf24: null });

  const warnings = [];

  const grid = await gridResult;
  signal?.throwIfAborted();
  if (grid.error) {
    warnings.push('snow totals unavailable');
  } else {
    const pop = currentNwsValue(
      grid.value?.properties?.probabilityOfPrecipitation?.values
    );
    renderKPIs(firstPeriod, pop);
    renderTotals(deriveTotalsFromNwsGrid(grid.value));
  }

  const hourly = await hourlyResult;
  signal?.throwIfAborted();
  if (hourly.error) {
    warnings.push('hourly unavailable');
    renderHourly(null);
  } else {
    renderHourly(hourly.value, { limitHours: 36 });
  }

  return warnings;
}

async function runOpenMeteo(elev, { signal } = {}) {
  setStatus('Fetching Open-Meteo…');
  const omJson = await fetchOpenMeteo(
    {
      lat: elev.lat,
      lon: elev.lon,
      elevation: elev.elev_m,
    },
    { signal }
  );
  signal?.throwIfAborted();

  showNwsLinks(false);
  clearForecast();
  const { firstPeriod, pop } = adaptOmToKpis(omJson);
  renderKPIs(firstPeriod, pop);
  renderTotals(adaptOmToTotals(omJson));
  renderHourly(adaptOmToHourly(omJson), { limitHours: 36 });
  return [];
}

/* ------------------- Main Router ------------------- */
const PROVIDER_LABELS = { nws: 'NWS', 'open-meteo': 'Open-Meteo' };

async function attemptProvider(provider, elev, runSignal) {
  const timeoutSignal = AbortSignal.timeout(WEATHER_TIMEOUT_MS);
  const signal = AbortSignal.any([runSignal, timeoutSignal]);
  try {
    const warnings =
      provider === 'open-meteo'
        ? await runOpenMeteo(elev, { signal })
        : await runNws(elev, { signal });
    return { ok: true, provider, warnings };
  } catch (e) {
    // Superseded by a newer run: not a provider failure, don't fall back
    if (runSignal.aborted) throw e;
    const message = timeoutSignal.aborted
      ? `timed out after ${WEATHER_TIMEOUT_MS / 1000}s`
      : e?.message || String(e);
    return { ok: false, provider, error: new Error(message) };
  }
}

async function fetchWeather(source, elev, runSignal) {
  const primary = source === 'open-meteo' ? 'open-meteo' : 'nws';
  const secondary = primary === 'nws' ? 'open-meteo' : 'nws';

  const primaryResult = await attemptProvider(primary, elev, runSignal);
  if (primaryResult.ok) return { ...primaryResult, fallbackUsed: false };

  const fallbackResult = await attemptProvider(secondary, elev, runSignal);
  if (fallbackResult.ok)
    return {
      ...fallbackResult,
      fallbackUsed: true,
      primaryError: primaryResult.error,
    };

  const detail = [primaryResult, fallbackResult]
    .map((x) => `${PROVIDER_LABELS[x.provider]}: ${x.error.message}`)
    .join('; ');
  throw new Error(`Weather providers failed (${detail})`);
}

function updateWindyTargets(elev) {
  const opts = {
    lat: elev.lat,
    lon: elev.lon,
    overlay: els.overlaySel.value || DEFAULT_OVERLAY,
    zoom: Number(els.zoomSel.value || DEFAULT_ZOOM),
  };
  const { src, href } = buildWindyUrls(opts);
  pendingWindySrc = src;
  els.openWindy.href = href;
  if (windyLoaded) {
    els.windyFrame.src = src;
  }
}

async function updateGroundTruthCard(resort, signal) {
  try {
    const groundTruthData = await fetchGroundTruth(resort, { signal });
    if (signal.aborted) return;
    renderGroundTruth(groundTruthData); // ui.js handles null
  } catch (e) {
    if (signal.aborted) return;
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

  savePrefs();

  // Cancel whatever the previous selection was still loading, so its
  // responses can't land on top of this one.
  activeRun?.abort();
  const controller = new AbortController();
  activeRun = controller;
  const { signal } = controller;

  // Links only depend on the selection; no need to wait for the network
  updateWindyTargets(elev);
  renderRealityLinks(r);
  renderGroundTruth(null); // don't leave the previous resort's report up

  const groundTruthDone = updateGroundTruthCard(r, signal);

  try {
    const outcome = await fetchWeather(source, elev, signal);
    if (signal.aborted) return;

    const label = PROVIDER_LABELS[outcome.provider];
    const notes = [];
    if (outcome.fallbackUsed) {
      notes.push(
        `${PROVIDER_LABELS[source === 'open-meteo' ? 'open-meteo' : 'nws']} failed, using fallback`
      );
    }
    notes.push(...outcome.warnings);
    setStatus(
      notes.length ? `OK · ${label} (${notes.join('; ')})` : `OK · ${label}`
    );
  } catch (e) {
    if (signal.aborted) return; // superseded; the newer run owns the UI
    console.error(e);
    setError(`Fetch failed: ${e.message}`);
    setStatus('Error');
  }

  await groundTruthDone;
}

function updateWindyMap() {
  const { elev } = getSelected();
  if (!elev) return;
  savePrefs();
  updateWindyTargets(elev);
}

function loadWindyFrame() {
  const { elev } = getSelected();
  if (!elev) return;
  if (!pendingWindySrc) updateWindyTargets(elev);
  els.windyFrame.src = pendingWindySrc;
  windyLoaded = true;
}
// ----------------------------------------------------------

/* --------------------------- ranking ------------------------------ */
function drawRanking() {
  const region = els.rankRegion.value;
  const { key, dir } = rankingSort;
  const sign = dir === 'asc' ? 1 : -1;
  const rows = rankingRows
    .filter((row) => !region || row.region === region)
    .sort((a, b) => {
      if (key === 'name') return sign * a.name.localeCompare(b.name);
      // rows with no value always sink to the bottom
      if (a[key] == null) return b[key] == null ? 0 : 1;
      if (b[key] == null) return -1;
      return sign * (a[key] - b[key]) || a.name.localeCompare(b.name);
    });
  renderRanking(rows, {
    sort: rankingSort,
    selectedId: els.spot.value,
    windHoldMph: WIND_HOLD_GUST_MPH,
  });
}

async function loadRanking({ force = false } = {}) {
  const elevKey = els.elev.value;
  els.rankElevLabel.textContent = elevKey;

  const cached = rankingCache.get(elevKey);
  if (!force && cached && Date.now() - cached.at < RANKING_TTL_MS) {
    rankingRows = cached.rows;
    setRankingStatus(`Updated ${new Date(cached.at).toLocaleTimeString()}`);
    drawRanking();
    return;
  }

  rankingLoad?.abort();
  const controller = new AbortController();
  rankingLoad = controller;
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(WEATHER_TIMEOUT_MS),
  ]);

  setRankingStatus('Loading…');
  try {
    const rows = await fetchRanking(RESORTS, elevKey, { signal });
    if (controller.signal.aborted) return;
    const at = Date.now();
    rankingCache.set(elevKey, { at, rows });
    rankingRows = rows;
    setRankingStatus(`Updated ${new Date(at).toLocaleTimeString()}`);
    drawRanking();
  } catch (e) {
    if (controller.signal.aborted) return; // superseded by a newer request
    console.error('Ranking failed:', e);
    rankingRows = [];
    drawRanking();
    setRankingStatus(
      signal.aborted ? 'Ranking timed out' : `Ranking failed: ${e.message}`
    );
  }
}

function onRankingSort(key) {
  if (rankingSort.key === key) {
    rankingSort.dir = rankingSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    rankingSort = { key, dir: key === 'name' ? 'asc' : 'desc' };
  }
  drawRanking();
}

function onRankingPick(id) {
  if (!RESORTS.some((r) => r.id === id)) return;
  els.spot.value = id;
  run();
  drawRanking();
  els.detailTop.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ------------------------- event wiring --------------------------- */
els.refresh.addEventListener('click', run);
els.overlaySel.addEventListener('change', updateWindyMap);
els.zoomSel.addEventListener('change', updateWindyMap);
els.loadWindy?.addEventListener('click', loadWindyFrame);
els.spot.addEventListener('change', () => {
  run();
  drawRanking(); // move the row highlight
});
els.elev.addEventListener('change', () => {
  run();
  loadRanking();
});
els.rankRegion.addEventListener('change', () => {
  savePrefs();
  drawRanking();
});
els.rankRefresh.addEventListener('click', () => loadRanking({ force: true }));
els.rankHead.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-sort]');
  if (btn) onRankingSort(btn.dataset.sort);
});
els.rankBody.addEventListener('click', (ev) => {
  const row = ev.target.closest('tr[data-id]');
  if (row) onRankingPick(row.dataset.id);
});
els.rankBody.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const row = ev.target.closest('tr[data-id]');
  if (!row) return;
  ev.preventDefault();
  onRankingPick(row.dataset.id);
});
els.source.addEventListener('change', run);

/* --------------------------- boot -------------------------------- */
async function boot() {
  initTabs();
  await loadResorts();
  if (!RESORTS.length) return;
  loadRanking();
  run();
}

boot();
