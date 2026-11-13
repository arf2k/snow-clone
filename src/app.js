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
  renderForecastCompare,
  renderVerdict,
  renderHourly,
  showNwsLinks,
  renderGroundTruth,
  renderTerrain,
  renderRegionOptions,
  renderRanking,
  setRankingStatus,
  setRankingCaption,
  renderDailyChart,
  renderCompareOptions,
  renderCompare,
} from './ui.js';
import { getNwsEndpoints, fetchForecast, fetchGrid } from './nws.js';
import { buildWindyUrls } from './windy.js';
import { fetchOpenMeteo } from './openmeteo.js';
import { fetchGroundTruth } from './groundTruth.js';
import { fetchRanking, currentHourIndex } from './ranking.js';
import {
  addDays,
  daysBetween,
  today,
  weekend,
  dayLabel,
  tripTotals,
  LEAD_DAYS,
} from './outlook.js';

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
let rankingElev = null; // elevation band rankingRows was computed for

// Trip view: rank by snow just before and during chosen dates
const FORECAST_DAYS = 16; // how far the daily forecast reaches
let tripSort = { key: 'total', dir: 'desc' };
let trip = weekend(0); // { start, end } as 'YYYY-MM-DD'

// Compare: on-mountain reports for the picked resorts, fetched on demand
const COMPARE_TTL_MS = 10 * 60000;
const compareReports = new Map(); // id -> { state, data, terrain, at }
const CHART_DAYS = 7;

// Everything the resort header and forecast table are built from. The
// pieces arrive separately (report, lifts, NWS, Open-Meteo); drawSummary()
// redraws from whatever has arrived so far.
const detail = {
  reported: null, // on-mountain report, or null
  reportState: 'loading', // 'loading' | 'done'
  terrain: null, // lifts and trails, or null
  nws: null, // { snow24, snow72 } from the NWS grid
  nwsSnow: null, // raw NWS snowfall series, for the by-day chart
  om: null, // Open-Meteo totals when it is the detail source
  qpf24: null, // NWS liquid equivalent, inches
};

function resetDetail() {
  Object.assign(detail, {
    reported: null,
    reportState: 'loading',
    terrain: null,
    nws: null,
    nwsSnow: null,
    om: null,
    qpf24: null,
  });
}

// The next week, day by day, from both forecasts. Days are calendar days
// at the resort; NWS is summed over the same local-midnight boundaries.
function dailyChartFor(row) {
  const days = row.daily.slice(0, CHART_DAYS);
  const nwsValues = days.map((d) => {
    if (!detail.nwsSnow) return null;
    const start = Date.parse(`${d.date}T00:00:00Z`) - row.utcOffset * 1000;
    // Today only counts from now on; the forecast has no past hours
    const from = Math.max(start, Date.now());
    const mm = accumulateNwsWindow(detail.nwsSnow, from, start + 24 * HOUR_MS, {
      minCoverage: 0.9,
    });
    return mm == null ? null : inchesFromMm(mm);
  });
  const series = [];
  if (nwsValues.some((v) => v != null)) {
    series.push({ name: 'NWS', slot: 1, values: nwsValues });
  }
  series.push({
    name: 'Open-Meteo',
    slot: 2,
    values: days.map((d) => d.snow),
  });
  return {
    days: days.map((d, i) => ({
      label:
        i === 0
          ? 'Today'
          : new Date(`${d.date}T00:00:00Z`).toLocaleDateString([], {
              weekday: 'short',
              timeZone: 'UTC',
            }),
      sub: String(Number(d.date.slice(8))),
    })),
    series,
  };
}

function drawSummary() {
  // The ranking already holds Open-Meteo totals for every resort, so the
  // second forecast costs no extra request (when it is for this elevation).
  const row =
    rankingElev === els.elev.value
      ? rankingRows.find((r) => r.id === els.spot.value)
      : null;
  const fromRanking = row
    ? { snow24: row.snow24, snow72: row.snow72, snow7d: row.snow7d }
    : null;
  const om = detail.om || fromRanking ? { ...fromRanking, ...detail.om } : null;

  renderForecastCompare({ nws: detail.nws, om, qpf24: detail.qpf24 });
  renderDailyChart(row ? dailyChartFor(row) : null);
  renderVerdict({
    reported: detail.reported,
    reportState: detail.reportState,
    terrain: detail.terrain,
    nws: detail.nws,
    om,
    gust24: row?.gust24 ?? null,
    windHoldMph: WIND_HOLD_GUST_MPH,
  });
}

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
        rankMode: els.rankMode.value,
        tripStart: trip.start,
        tripEnd: trip.end,
        compare: els.cmp.map((sel) => sel.value),
        compareOpen: els.compareCard.open,
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
  if (['summit', 'mid', 'base'].includes(prefs.elev))
    els.elev.value = prefs.elev;
  restore(els.source, prefs.source);
  restore(els.overlaySel, prefs.overlay);
  restore(els.zoomSel, prefs.zoom);
  restore(els.rankRegion, prefs.region);
  if (prefs.rankMode === 'trip') els.rankMode.value = 'trip';
  // Saved trip dates are only kept while they are still ahead of us
  if (prefs.tripStart >= today() && prefs.tripEnd >= prefs.tripStart) {
    setTrip(prefs.tripStart, prefs.tripEnd, { silent: true });
  } else {
    setTrip(trip.start, trip.end, { silent: true });
  }
  // Only a real saved comparison counts; otherwise the card seeds itself
  if (
    Array.isArray(prefs.compare) &&
    prefs.compare.filter(Boolean).length >= 2
  ) {
    prefs.compare.forEach((id, i) => {
      if (els.cmp[i]) restore(els.cmp[i], id);
    });
    els.compareCard.dataset.picked = '1';
  }
  if (prefs.compareOpen) els.compareCard.open = true;
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
  return accumulateNwsWindow(values, now, now + hours * HOUR_MS) ?? 0;
}

// Same, for an arbitrary window. Returns null when the series covers less
// than `minCoverage` of the window (e.g. the day the forecast runs out
// part-way through, which would otherwise show as a misleadingly small total).
function accumulateNwsWindow(
  values,
  windowStart,
  windowEnd,
  { minCoverage = 0 } = {}
) {
  if (!Array.isArray(values)) return null;
  let sum = 0;
  let coveredMs = 0;
  for (const v of values) {
    if (v?.value == null) continue;
    const t = parseValidTime(v.validTime);
    if (!t || t.end <= t.start) continue;
    const overlap = Math.min(t.end, windowEnd) - Math.max(t.start, windowStart);
    if (overlap > 0) {
      coveredMs += overlap;
      sum += v.value * (overlap / (t.end - t.start));
    }
  }
  if (coveredMs <= 0) return null;
  return coveredMs >= minCoverage * (windowEnd - windowStart) ? sum : null;
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
    renderCompareOptions(RESORTS);
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
    const totals = deriveTotalsFromNwsGrid(grid.value);
    detail.nws = { snow24: totals.snow24, snow72: totals.snow72 };
    detail.qpf24 = totals.qpf24;
    detail.nwsSnow = grid.value?.properties?.snowfallAmount?.values || null;
    drawSummary();
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
  renderPeriods(null); // explains that day-by-day text is NWS only
  const { firstPeriod, pop } = adaptOmToKpis(omJson);
  renderKPIs(firstPeriod, pop);
  const totals = adaptOmToTotals(omJson);
  detail.om = { snow24: totals.snow24, snow72: totals.snow72 };
  drawSummary();
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
  let data = null;
  try {
    data = await fetchGroundTruth(resort, { signal });
    if (signal.aborted) return;
  } catch (e) {
    if (signal.aborted) return;
    console.warn('Ground Truth fetch failed:', e);
  }
  detail.reported = data;
  detail.reportState = 'done';
  renderGroundTruth(data); // null shows the "no report" message

  // Lifts and trails: usually part of the report; some feeds need a
  // second request, which must not hold up or break the report above.
  if (!data?.loadTerrain) {
    detail.terrain = data?.terrain ?? null;
    renderTerrain(detail.terrain);
    drawSummary();
    return;
  }
  drawSummary();
  renderTerrain('loading');
  try {
    const terrain = await data.loadTerrain({ signal });
    if (signal.aborted) return;
    detail.terrain = terrain;
  } catch (e) {
    if (signal.aborted) return;
    console.warn('Lift/trail fetch failed:', e);
  }
  renderTerrain(detail.terrain);
  drawSummary();
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
  // Don't leave the previous resort's numbers up while the new ones load
  resetDetail();
  renderGroundTruth('loading');
  renderTerrain(null);
  drawSummary();

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
  els.windyFrame.hidden = false; // no empty map box until it's asked for
  els.windyFrame.src = pendingWindySrc;
  windyLoaded = true;
}
// ----------------------------------------------------------

/* --------------------------- ranking ------------------------------ */
const OUTLOOK_COLUMNS = [
  { key: 'snow24', label: '24h' },
  { key: 'snow72', label: '72h' },
  { key: 'snow7d', label: '7 days' },
  {
    key: 'gust24',
    label: 'Max gust',
    kind: 'gust',
    title: 'Strongest forecast gust in the next 24 hours',
  },
];
const TRIP_COLUMNS = [
  {
    key: 'before',
    label: 'Before',
    title: `Snow in the ${LEAD_DAYS} days before the trip`,
  },
  { key: 'during', label: 'Trip', title: 'Snow during the trip' },
  { key: 'total', label: 'Total' },
  {
    key: 'tripGust',
    label: 'Gust',
    kind: 'gust',
    title: 'Strongest forecast gust during the trip',
  },
];

function tripLabel() {
  return trip.start === trip.end
    ? dayLabel(trip.start, { long: true })
    : `${dayLabel(trip.start, { long: true })} – ${dayLabel(trip.end, { long: true })}`;
}

function drawRanking() {
  const tripMode = els.rankMode.value === 'trip';
  els.tripControls.hidden = !tripMode;

  const region = els.rankRegion.value;
  const sort = tripMode ? tripSort : rankingSort;
  const { key, dir } = sort;
  const sign = dir === 'asc' ? 1 : -1;
  const rows = rankingRows
    .filter((row) => !region || row.region === region)
    .map((row) =>
      tripMode
        ? { ...row, ...tripTotals(row.daily, trip.start, trip.end) }
        : row
    )
    .sort((a, b) => {
      if (key === 'name') return sign * a.name.localeCompare(b.name);
      // rows with no value always sink to the bottom
      if (a[key] == null) return b[key] == null ? 0 : 1;
      if (b[key] == null) return -1;
      return sign * (a[key] - b[key]) || a.name.localeCompare(b.name);
    });
  renderRanking(rows, {
    columns: tripMode ? TRIP_COLUMNS : OUTLOOK_COLUMNS,
    sort,
    selectedId: els.spot.value,
    windHoldMph: WIND_HOLD_GUST_MPH,
  });

  const where = `${els.elev.value} elevation · Open-Meteo · tap a resort for detail`;
  if (tripMode) {
    const nights = daysBetween(trip.start, trip.end) + 1;
    const far = daysBetween(today(), trip.end) > 7;
    setRankingCaption(
      `${tripLabel()} (${nights} day${nights === 1 ? '' : 's'}). "Before" is snow in the ${LEAD_DAYS} days leading in. ` +
        (far ? 'Past about a week this is a rough signal only. ' : '') +
        `Forecast at ${where}.`
    );
  } else {
    setRankingCaption(`Forecast snowfall at ${where}.`);
  }

  drawSummary(); // the resort header uses the ranking's Open-Meteo numbers
  drawCompare();
}

/* ----------------------------- trip -------------------------------- */
function setTrip(start, end, { silent = false } = {}) {
  const first = today();
  const last = addDays(first, FORECAST_DAYS - 1);
  const clamp = (d) => (d < first ? first : d > last ? last : d);
  let s = clamp(start || first);
  let e = clamp(end || s);
  if (e < s) e = s;
  trip = { start: s, end: e };

  els.tripStart.min = first;
  els.tripStart.max = last;
  els.tripEnd.min = s;
  els.tripEnd.max = last;
  els.tripStart.value = s;
  els.tripEnd.value = e;
  if (silent) return;
  savePrefs();
  drawRanking();
}

/* ---------------------------- compare ------------------------------ */
function compareIds() {
  // de-duplicated, in slot order
  return [...new Set(els.cmp.map((sel) => sel.value).filter(Boolean))];
}

// First time the card is opened: this resort plus the top two others
function seedCompare() {
  if (els.compareCard.dataset.picked) return;
  const ranked = [...els.rankBody.querySelectorAll('tr[data-id]')].map(
    (tr) => tr.dataset.id
  );
  if (!ranked.length) return; // ranking not loaded yet; try again next draw
  els.compareCard.dataset.picked = '1';
  const current = els.spot.value;
  const others = ranked.filter((id) => id !== current).slice(0, 2);
  [current, ...others].forEach((id, i) => {
    if (els.cmp[i] && id) els.cmp[i].value = id;
  });
}

async function loadCompareReport(id) {
  const resort = RESORTS.find((r) => r.id === id);
  if (!resort) return;
  const entry = { state: 'loading', data: null, terrain: null, at: Date.now() };
  compareReports.set(id, entry);
  try {
    entry.data = await fetchGroundTruth(resort);
    entry.terrain = entry.data?.loadTerrain
      ? await entry.data.loadTerrain()
      : (entry.data?.terrain ?? null);
  } catch (e) {
    console.warn(`Compare: report for ${id} failed:`, e);
  }
  entry.state = 'done';
  if (compareReports.get(id) === entry) drawCompare();
}

function drawCompare() {
  if (!els.compareCard.open || !RESORTS.length) return;
  seedCompare();
  const ids = compareIds();

  for (const id of ids) {
    const have = compareReports.get(id);
    if (!have || Date.now() - have.at > COMPARE_TTL_MS) loadCompareReport(id);
  }

  const rowFor = (id) =>
    rankingElev === els.elev.value
      ? rankingRows.find((r) => r.id === id)
      : undefined;
  const cols = ids.map((id) => ({
    id,
    name: RESORTS.find((r) => r.id === id)?.name || id,
    row: rowFor(id),
    report: compareReports.get(id),
  }));
  const withDays = cols.find((c) => c.row?.daily?.length);
  renderCompare({
    cols,
    trip:
      els.rankMode.value === 'trip'
        ? {
            label: tripLabel(),
            totals: new Map(
              cols.map((c) => [
                c.id,
                tripTotals(c.row?.daily, trip.start, trip.end),
              ])
            ),
          }
        : null,
    days: withDays
      ? withDays.row.daily.slice(0, CHART_DAYS).map((d) => d.date)
      : [],
    windHoldMph: WIND_HOLD_GUST_MPH,
  });
}

function addToCompare(id) {
  els.compareCard.dataset.picked = '1';
  const slots = els.cmp.map((sel) => sel.value);
  if (!slots.includes(id)) {
    const free = slots.findIndex((v, i) => i > 0 && !v);
    els.cmp[free === -1 ? els.cmp.length - 1 : free].value = id;
  }
  els.compareCard.open = true;
  savePrefs();
  drawCompare();
  els.compareCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadRanking({ force = false } = {}) {
  const elevKey = els.elev.value;

  const cached = rankingCache.get(elevKey);
  if (!force && cached && Date.now() - cached.at < RANKING_TTL_MS) {
    rankingRows = cached.rows;
    rankingElev = elevKey;
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
    rankingElev = elevKey;
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
  const tripMode = els.rankMode.value === 'trip';
  const current = tripMode ? tripSort : rankingSort;
  const next =
    current.key === key
      ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' };
  if (tripMode) tripSort = next;
  else rankingSort = next;
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
els.elev.onChange(() => {
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

// Ranking view + trip dates
els.rankMode.onChange(() => {
  savePrefs();
  drawRanking();
});
els.tripStart.addEventListener('change', () => {
  // Moving the start keeps the trip the same length
  const length = daysBetween(trip.start, trip.end);
  const start = els.tripStart.value || trip.start;
  setTrip(start, addDays(start, length));
});
els.tripEnd.addEventListener('change', () =>
  setTrip(trip.start, els.tripEnd.value || trip.end)
);
els.tripControls.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-trip-weekend]');
  if (!btn) return;
  const { start, end } = weekend(Number(btn.dataset.tripWeekend));
  setTrip(start, end);
});

// Compare
els.compareCard.addEventListener('toggle', () => {
  savePrefs();
  drawCompare();
});
els.cmp.forEach((sel) =>
  sel.addEventListener('change', () => {
    els.compareCard.dataset.picked = '1';
    savePrefs();
    drawCompare();
  })
);
els.compareBody.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-open-resort]');
  if (btn) onRankingPick(btn.dataset.openResort);
});
els.addCompare.addEventListener('click', () => addToCompare(els.spot.value));

/* ----------------------- offline support -------------------------- */
function updateOnlineState() {
  els.offlineBanner.hidden = navigator.onLine;
}
window.addEventListener('online', () => {
  updateOnlineState();
  // Back online: replace whatever was served from the offline copy
  loadRanking({ force: true });
  run();
});
window.addEventListener('offline', updateOnlineState);
updateOnlineState();

// The service worker keeps the last good copy of the app and its data for
// offline use. Production only, so it never caches dev-server modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((e) => console.warn('Service worker registration failed:', e));
  });
}

/* --------------------------- boot -------------------------------- */
async function boot() {
  await loadResorts();
  if (!RESORTS.length) return;
  loadRanking();
  run();
}

boot();
