import { RESORTS_JSON_URL, DEFAULT_OVERLAY, DEFAULT_ZOOM } from './config.js';
import { els, setStatus, setError, clearForecast, renderResortOptions, renderRealityLinks, renderKPIs, renderPeriods } from './ui.js';
import { getNwsEndpoints, fetchForecast, fetchGrid } from './nws.js';
import { setWindyFrame } from './windy.js';

let RESORTS = [];
let CURRENT = null;

async function loadResorts(){
  const r = await fetch(RESORTS_JSON_URL);
  if (!r.ok) throw new Error(`Failed to load resorts.json (${r.status})`);
  RESORTS = await r.json();
  // Filter: only those with coords ready (no "needs_coords")
  const ready = RESORTS.filter(r => !r.needs_coords);
  renderResortOptions(ready);
  CURRENT = ready[0]?.id;
  els.spot.value = CURRENT;
}

function getSelected(){
  const r = RESORTS.find(x => x.id === els.spot.value);
  const elevKey = els.elev.value;
  const elev = r?.elevations?.[elevKey];
  return { r, elevKey, elev };
}

async function run(){
  setError(''); clearForecast(); setStatus('Fetching NWS…');
  const { r, elev } = getSelected();
  if (!r || !elev){ setError('Missing resort/elevation'); setStatus(''); return; }

  try {
    const ep = await getNwsEndpoints(elev.lat, elev.lon);
    const [forecast, grid] = await Promise.all([ fetchForecast(ep.forecastUrl), fetchGrid(ep.gridUrl) ]);
    renderKPIs(forecast?.properties?.periods?.[0], grid);
    renderPeriods(forecast);
    els.linkPoint.href = ep.forecastUrl;
    els.linkGrid.href  = ep.gridUrl;

    setWindyFrame(els.windyFrame, els.openWindy, { lat: elev.lat, lon: elev.lon, overlay: els.overlaySel.value || DEFAULT_OVERLAY, zoom: Number(els.zoomSel.value || DEFAULT_ZOOM) });
    renderRealityLinks(r);
    setStatus('OK (live)');
  } catch (e){
    console.error(e);
    setError(String(e.message));
    setStatus('Error');
  }
}

els.refresh.addEventListener('click', run);
els.overlaySel.addEventListener('change', run);
els.zoomSel.addEventListener('change', run);
els.spot.addEventListener('change', run);
els.elev.addEventListener('change', run);

loadResorts().then(run).catch(e => { setError(String(e.message)); setStatus(''); });
