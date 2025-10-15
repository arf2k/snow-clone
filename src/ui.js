export const els = {
  spot: document.getElementById('spot'),
  elev: document.getElementById('elev'),
  refresh: document.getElementById('refresh'),
  status: document.getElementById('status'),
  periods: document.getElementById('periods'),
  err: document.getElementById('error'),
  kpiTemp: document.getElementById('kpiTemp'),
  kpiGust: document.getElementById('kpiGust'),
  kpiPoP: document.getElementById('kpiPoP'),
  linkPoint: document.getElementById('linkPoint'),
  linkGrid: document.getElementById('linkGrid'),
  overlaySel: document.getElementById('overlay'),
  zoomSel: document.getElementById('zoom'),
  windyFrame: document.getElementById('windy'),
  openWindy: document.getElementById('openWindy'),
  realLinks: document.getElementById('realLinks'),
};

export function setStatus(msg){ els.status.textContent = msg || ''; }
export function setError(msg){ els.err.textContent = msg || ''; }
export function clearForecast(){ els.periods.innerHTML = ''; setError(''); }

export function renderResortOptions(resorts){
  els.spot.innerHTML = resorts.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
}

export function renderRealityLinks(r){
  const items = [];
  (r.links?.cams || []).forEach(url => items.push(`<a href="${url}" target="_blank" rel="noopener">Cams</a>`));
  (r.links?.dot  || []).forEach(url => items.push(`<a href="${url}" target="_blank" rel="noopener">Roads</a>`));
  if (r.links?.official) items.push(`<a href="${r.links.official}" target="_blank" rel="noopener">Official</a>`);
  els.realLinks.innerHTML = items.join(' • ');
}

export function renderKPIs(firstPeriod, grid){
  els.kpiTemp.textContent = firstPeriod ? `${firstPeriod.temperature}°${firstPeriod.temperatureUnit}` : '--';
  const gust = firstPeriod?.windGust || firstPeriod?.windSpeed || '--';
  els.kpiGust.textContent = gust;
  const pop = grid?.properties?.probabilityOfPrecipitation?.values?.[0]?.value;
  els.kpiPoP.textContent = (pop != null) ? `${Math.round(pop)}%` : '--';
}

export function renderPeriods(forecast){
  const periods = forecast?.properties?.periods || [];
  els.periods.innerHTML = periods.slice(0, 8).map(p => `
    <div class="period">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <strong>${p.name}</strong>
        <span class="muted">${p.startTime ? new Date(p.startTime).toLocaleString() : ''}</span>
      </div>
      <div style="margin-top:6px">${p.detailedForecast || p.shortForecast}</div>
      <div class="muted" style="margin-top:6px">Wind: ${p.windSpeed}${p.windGust ? ` (gust ${p.windGust})` : ''}</div>
    </div>
  `).join('');
}
