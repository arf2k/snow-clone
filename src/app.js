import { RESORTS_JSON_URL, DEFAULT_OVERLAY, DEFAULT_ZOOM } from './config.js';
import { els, setStatus, setError, clearForecast, renderResortOptions, renderRealityLinks, renderKPIs, renderPeriods } from './ui.js';
import { getNwsEndpoints, fetchForecast, fetchGrid } from './nws.js';
import { setWindyFrame } from './windy.js';

let RESORTS = [];

function getSelected(){
  const r = RESORTS.find(x => x.id === els.spot.value);
  const elevKey = els.elev.value;
  const elev = r?.elevations?.[elevKey];
  return { r, elevKey, elev };
}

async function loadResorts(){
  setStatus('Loading resorts.json…');
  els.refresh.disabled = true;
  try {
    const r = await fetch(RESORTS_JSON_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`resorts.json HTTP ${r.status}`);
    const json = await r.json();
    // Only include entries that have full elevation coords
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

async function run(){
  setError(''); clearForecast();
  if (els.refresh.disabled) { setStatus('Waiting for resorts…'); return; }

  setStatus('Fetching NWS…');
  const { r, elev } = getSelected();
  if (!r) { setError('No resort selected (dropdown empty). resorts.json likely failed to load.'); setStatus('Error'); return; }
  if (!elev) { setError(`Selected resort "${r.name}" missing "${els.elev.value}" coordinates.`); setStatus('Error'); return; }

  try {
    const ep = await getNwsEndpoints(elev.lat, elev.lon);
    const [forecast, grid] = await Promise.all([
      fetchForecast(ep.forecastUrl),
      fetchGrid(ep.gridUrl),
    ]);
    renderKPIs(forecast?.properties?.periods?.[0], grid);
    renderPeriods(forecast);
    els.linkPoint.href = ep.forecastUrl;
    els.linkGrid.href = ep.gridUrl;

    setWindyFrame(els.windyFrame, els.openWindy, {
      lat: elev.lat, lon: elev.lon,
      overlay: els.overlaySel.value || DEFAULT_OVERLAY,
      zoom: Number(els.zoomSel.value || DEFAULT_ZOOM),
    });
    renderRealityLinks(r);
    setStatus('OK (live)');
  } catch (e) {
    console.error(e);
    setError(`NWS fetch failed: ${e.message}`);
    setStatus('Error');
  }
}

els.refresh.addEventListener('click', run);
els.overlaySel.addEventListener('change', run);
els.zoomSel.addEventListener('change', run);
els.spot.addEventListener('change', run);
els.elev.addEventListener('change', run);

await loadResorts();
run();
