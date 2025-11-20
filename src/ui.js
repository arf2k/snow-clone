// src/ui.js

// ---- element handles ----
export const els = {
  // controls
  spot: document.getElementById('spot'),
  elev: document.getElementById('elev'),
  source: document.getElementById('source'),
  refresh: document.getElementById('refresh'),
  overlaySel: document.getElementById('overlay'),
  zoomSel: document.getElementById('zoom'),
  loadWindy: document.getElementById('loadWindy'),

  // status + errors
  status: document.getElementById('status'),
  err: document.getElementById('error'),

  // panes & tabs
  tabForecast: document.getElementById('tabForecast'),
  tabHourly: document.getElementById('tabHourly'),
  paneForecast: document.getElementById('paneForecast'),
  paneHourly: document.getElementById('paneHourly'),

  // forecast areas (period view)
  periods: document.getElementById('periods'),

  // KPI (primary)
  kpiTemp: document.getElementById('kpiTemp'),
  kpiGust: document.getElementById('kpiGust'),
  kpiPoP: document.getElementById('kpiPoP'),

  // KPI (totals)
  kpiSnow24: document.getElementById('kpiSnow24'),
  kpiSnow72: document.getElementById('kpiSnow72'),
  kpiQpf24: document.getElementById('kpiQpf24'),

  // links
  linkPoint: document.getElementById('linkPoint'),
  linkGrid: document.getElementById('linkGrid'),
  linkHourly: document.getElementById('linkHourly'),
  nwsLinks: document.getElementById('nwsLinks'),
  hourlyLinks: document.getElementById('hourlyLinks'),
  realLinks: document.getElementById('realLinks'),

  // hourly table
  hourlyBody: document.getElementById('hourlyBody'),

  // windy
  windyFrame: document.getElementById('windy'),
  openWindy: document.getElementById('openWindy'),

  // SNOTEL / Ground Truth elements
  groundTruthCard: document.getElementById('groundTruthCard'),
  snotelTitle: document.getElementById('snotelTitle'),
  snotelData: document.getElementById('snotelData'),
};

// ---- small helpers ----
export function setStatus(msg) {
  els.status.textContent = msg || '';
}
export function setError(msg) {
  els.err.textContent = msg || '';
}
export function clearForecast() {
  els.periods.innerHTML = '';
  setError('');
}

// ---- Toggles for NWS-specific UI ----
export function showNwsLinks(visible) {
  els.nwsLinks.style.display = visible ? 'block' : 'none';
  els.hourlyLinks.style.display = visible ? 'block' : 'none';
}

// ---- tabs ----
export function initTabs() {
  if (!els.tabForecast || !els.tabHourly) return;

  const activate = (which) => {
    const isForecast = which === 'forecast';
    els.tabForecast.classList.toggle('active', isForecast);
    els.tabHourly.classList.toggle('active', !isForecast);
    els.paneForecast.hidden = !isForecast;
    els.paneHourly.hidden = isForecast;
  };

  els.tabForecast.addEventListener('click', () => activate('forecast'));
  els.tabHourly.addEventListener('click', () => activate('hourly'));

  // default to Forecast on load
  activate('forecast');
}

// ---- dropdown + links ----
export function renderResortOptions(resorts) {
  if (!Array.isArray(resorts) || !resorts.length) {
    els.spot.innerHTML = '<option value="">(no resorts found)</option>';
    return;
  }
  els.spot.innerHTML = resorts
    .map((r) => `<option value="${r.id}">${r.name}</option>`)
    .join('');
}

export function renderRealityLinks(r) {
  const items = [];
  (r?.links?.cams || []).forEach((url) =>
    items.push(`<a href="${url}" target="_blank" rel="noopener">Cams</a>`)
  );
  (r?.links?.dot || []).forEach((url) =>
    items.push(`<a href="${url}" target="_blank" rel="noopener">Roads</a>`)
  );
  if (r?.links?.official)
    items.push(
      `<a href="${r.links.official}" target="_blank" rel="noopener">Official</a>`
    );
  els.realLinks.innerHTML = items.join(' • ');
}

// ---- forecast (period view) ----
export function renderKPIs(firstPeriod, grid) {
  // temperature
  els.kpiTemp.textContent = firstPeriod
    ? `${firstPeriod.temperature}°${firstPeriod.temperatureUnit}`
    : '--';

  // wind gust or speed
  const gust = firstPeriod?.windGust || firstPeriod?.windSpeed || '--';
  els.kpiGust.textContent = gust;

  // PoP from grid (first value)
  const pop = grid?.properties?.probabilityOfPrecipitation?.values?.[0]?.value;
  els.kpiPoP.textContent = pop != null ? `${Math.round(pop)}%` : '--';
}

export function renderPeriods(forecast) {
  const periods = forecast?.properties?.periods || [];
  els.periods.innerHTML = periods
    .slice(0, 8)
    .map(
      (p) => `
    <div class="period">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <strong>${p.name}</strong>
        <span class="muted">${p.startTime ? new Date(p.startTime).toLocaleString() : ''}</span>
      </div>
      <div style="margin-top:6px">${p.detailedForecast || p.shortForecast}</div>
      <div class="muted" style="margin-top:6px">
        Wind: ${p.windSpeed}${p.windGust ? ` (gust ${p.windGust})` : ''}
      </div>
    </div>
  `
    )
    .join('');
}

export function renderTotals({ snow24, snow72, qpf24 }) {
  els.kpiSnow24.textContent = snow24 != null ? `${snow24.toFixed(1)}"` : '--';
  els.kpiSnow72.textContent = snow72 != null ? `${snow72.toFixed(1)}"` : '--';
  els.kpiQpf24.textContent = qpf24 != null ? `${qpf24.toFixed(2)}"` : '--';
}

// ---- hourly view ----
function fmtTime(s) {
  const d = new Date(s);
  return isNaN(d)
    ? ''
    : d.toLocaleString([], {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      });
}
function pct(n) {
  return n == null || Number.isNaN(n) ? '--' : `${Math.round(n)}%`;
}
function num(n, unit = '') {
  return n == null || Number.isNaN(n) ? '--' : `${n}${unit}`;
}

export function renderHourly(hourlyJson, { limitHours = 36 } = {}) {
  const periods = hourlyJson?.properties?.periods || [];
  const now = Date.now();
  const maxTime = now + limitHours * 3600000;

  const rows = [];
  for (const p of periods) {
    const t = Date.parse(p.startTime);
    if (isNaN(t) || t > maxTime) continue;

    const popVal =
      p?.probabilityOfPrecipitation?.value ?? p?.probabilityOfPrecipitation;

    rows.push(`
      <tr>
        <td>${fmtTime(p.startTime)}</td>
        <td>${p.shortForecast ?? ''}</td>
        <td class="num">${num(p.temperature, `°${p.temperatureUnit ?? ''}`)}</td>
        <td class="num">${pct(popVal)}</td>
        <td class="num">${p.windSpeed ?? '--'}</td>
        <td class="num">${p.windGust ?? '--'}</td>
      </tr>
    `);
  }

  els.hourlyBody.innerHTML =
    rows.join('') ||
    `
    <tr><td colspan="6" class="muted">No hourly data available.</td></tr>
  `;
}

// ---- Ground Truth Rendering (UPDATED) ----

/**
 * Renders the Ground Truth data card
 * @param {object|null} data - The normalized ground truth data from groundTruth.js
 */
export function renderGroundTruth(data) {
  if (!data) {
    els.groundTruthCard.hidden = true;
    els.snotelData.innerHTML = '';
    return;
  }

  els.groundTruthCard.hidden = false;

  const resortName = els.spot.options[els.spot.selectedIndex].text.split(',')[0];
  // We no longer need the detailed title since we have the source at the bottom
  els.snotelTitle.textContent = `Conditions Report`;

  // 1. Build KPIs (Grid)
  const kpis = [];
  const addKpi = (label, value, unit = '') => {
    // Loose check for null/undefined/empty string, but allow 0
    if (value == null || value === '') return;
    kpis.push(`
      <div class="kpi">
        <span class="muted">${label}</span>
        <b>${value}${unit}</b>
      </div>
    `);
  };

  addKpi('Base Depth', data.depth, '"');
  addKpi('24h Snow', data.change24h, '"');
  addKpi('Season Total', data.seasonTotal, '"');
  
  if (data.openLifts != null && data.totalLifts != null) {
    addKpi('Lifts Open', `${data.openLifts}/${data.totalLifts}`);
  }
  if (data.openTrails != null && data.totalTrails != null) {
    addKpi('Trails Open', `${data.openTrails}/${data.totalTrails}`);
  }
  if (data.temp != null) {
    addKpi('Temp', data.temp, '°F');
  }

  // 2. Build Extended Attributes (Flex List)
  let attrHtml = '';
  if (data.attributes && Array.isArray(data.attributes) && data.attributes.length > 0) {
    attrHtml += `<div class="gt-attributes">`;
    data.attributes.forEach(attr => {
      // attr = { label, value, type: 'info'|'success'|'warning'|'error' }
      attrHtml += `
        <div class="attr-row">
          <span class="attr-label">${attr.label}:</span>
          <span class="attr-value ${attr.type || 'info'}">${attr.value}</span>
        </div>
      `;
    });
    attrHtml += `</div>`;
  }

  // 3. Excerpt
  let excerptHtml = '';
  if (data.excerpt) {
    excerptHtml = `<div class="gt-excerpt">"${data.excerpt}"</div>`;
  }

  // 4. Source
  const sourceHtml = `<div class="gt-source">Source: ${data.source || 'Unknown'}</div>`;

  // Assemble
  els.snotelData.innerHTML = `
    <div class="gt-grid">${kpis.join('')}</div>
    ${attrHtml}
    ${excerptHtml}
    ${sourceHtml}
  `;
}