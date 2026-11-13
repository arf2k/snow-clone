// src/ui.js

// ---- element handles ----

// The elevation picker is a group of radio buttons; this gives it the same
// .value interface as a <select> so callers don't care which it is.
function elevControl(group) {
  return {
    get value() {
      return group.querySelector('input:checked')?.value || 'summit';
    },
    set value(v) {
      const input = [...group.querySelectorAll('input')].find(
        (i) => i.value === v
      );
      if (input) input.checked = true;
    },
    onChange(fn) {
      group.addEventListener('change', fn);
    },
  };
}

export const els = {
  // controls
  spot: document.getElementById('spot'),
  elev: elevControl(document.getElementById('elev')),
  source: document.getElementById('source'),
  refresh: document.getElementById('refresh'),
  overlaySel: document.getElementById('overlay'),
  zoomSel: document.getElementById('zoom'),
  loadWindy: document.getElementById('loadWindy'),

  offlineBanner: document.getElementById('offlineBanner'),

  // status + errors
  status: document.getElementById('status'),
  err: document.getElementById('error'),

  // forecast areas (period view)
  periods: document.getElementById('periods'),

  // KPI (primary)
  kpiTemp: document.getElementById('kpiTemp'),
  kpiGust: document.getElementById('kpiGust'),
  kpiPoP: document.getElementById('kpiPoP'),

  // forecast comparison + verdict strip
  forecastCompare: document.getElementById('forecastCompare'),
  vFellLabel: document.getElementById('vFellLabel'),
  vFell: document.getElementById('vFell'),
  vFellSub: document.getElementById('vFellSub'),
  vComing: document.getElementById('vComing'),
  vComingSub: document.getElementById('vComingSub'),
  vLifts: document.getElementById('vLifts'),
  vLiftsSub: document.getElementById('vLiftsSub'),
  vWind: document.getElementById('vWind'),
  vWindSub: document.getElementById('vWindSub'),

  // links
  linkPoint: document.getElementById('linkPoint'),
  linkGrid: document.getElementById('linkGrid'),
  linkHourly: document.getElementById('linkHourly'),
  nwsLinks: document.getElementById('nwsLinks'),
  realLinks: document.getElementById('realLinks'),

  // hourly table
  hourlyBody: document.getElementById('hourlyBody'),

  // windy
  windyFrame: document.getElementById('windy'),
  openWindy: document.getElementById('openWindy'),

  // ranking
  rankRegion: document.getElementById('rankRegion'),
  rankRefresh: document.getElementById('rankRefresh'),
  rankStatus: document.getElementById('rankStatus'),
  rankElevLabel: document.getElementById('rankElevLabel'),
  rankHead: document.getElementById('rankHead'),
  rankBody: document.getElementById('rankBody'),
  detailTop: document.getElementById('detailTop'),

  // SNOTEL / Ground Truth elements
  groundTruthCard: document.getElementById('groundTruthCard'),
  snotelData: document.getElementById('snotelData'),
  terrain: document.getElementById('terrain'),
  reportExtra: document.getElementById('reportExtra'),
};

// ---- escaping ----
// Everything written with innerHTML goes through esc(). Forecast text and
// resort reports come from third-party feeds and must never be able to
// inject markup into the page.
function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
}

// Only plain web links may be used as an href
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch {
    return '#';
  }
}

const ATTR_TYPES = new Set(['info', 'success', 'warning', 'error']);

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
  els.nwsLinks.hidden = !visible;
}

// ---- dropdown + links ----
export function renderResortOptions(resorts) {
  if (!Array.isArray(resorts) || !resorts.length) {
    els.spot.innerHTML = '<option value="">(no resorts found)</option>';
    return;
  }
  els.spot.innerHTML = resorts
    .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
    .join('');
}

export function renderRealityLinks(r) {
  const items = [];
  (r?.links?.cams || []).forEach((url) =>
    items.push(
      `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">Cams</a>`
    )
  );
  (r?.links?.dot || []).forEach((url) =>
    items.push(
      `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">Roads</a>`
    )
  );
  if (r?.links?.official)
    items.push(
      `<a href="${esc(safeUrl(r.links.official))}" target="_blank" rel="noopener">Official</a>`
    );
  els.realLinks.innerHTML = items.join(' • ');
}

// ---- forecast (period view) ----
export function renderKPIs(firstPeriod, pop) {
  // temperature
  els.kpiTemp.textContent = firstPeriod
    ? `${firstPeriod.temperature}°${firstPeriod.temperatureUnit}`
    : '--';

  // wind gust or speed
  const gust = firstPeriod?.windGust || firstPeriod?.windSpeed || '--';
  els.kpiGust.textContent = gust;

  // probability of precipitation for the current period (0-100)
  els.kpiPoP.textContent = pop != null ? `${Math.round(pop)}%` : '--';
}

// Day rows: one line each (name, short forecast, temperature); tap for the
// full text. The first row starts open.
export function renderPeriods(forecast) {
  const periods = (forecast?.properties?.periods || []).slice(0, 8);
  if (!periods.length) {
    els.periods.innerHTML =
      '<p class="muted">The day-by-day text forecast comes from NWS and is not available from this source.</p>';
    return;
  }
  els.periods.innerHTML = periods
    .map(
      (p, i) => `
    <details class="day"${i === 0 ? ' open' : ''}>
      <summary>
        <span class="day-name">${esc(p.name)}</span>
        <span class="day-short">${esc(p.shortForecast || '')}</span>
        <span class="day-temp">${p.temperature != null ? `${esc(p.temperature)}°` : ''}</span>
      </summary>
      <div class="day-body">
        ${esc(p.detailedForecast || p.shortForecast || '')}
        <div class="muted">Wind: ${esc(p.windSpeed)}${p.windGust ? ` (gust ${esc(p.windGust)})` : ''}</div>
      </div>
    </details>`
    )
    .join('');
}

// ---- snowfall amounts ----
function inches(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '--';
  return v < 0.05 ? '0' : `${v.toFixed(digits)}"`;
}

// For the headline: whole inches once there is at least one
function inchesShort(v) {
  if (v < 0.25) return '0'; // a dusting isn't worth a headline range
  return v < 1 ? v.toFixed(1) : String(Math.round(v));
}

/**
 * Forecast snowfall from both models, side by side.
 * @param {{nws: object|null, om: object|null, qpf24: number|null}} f
 *   nws / om: { snow24, snow72, snow7d? } in inches
 */
export function renderForecastCompare({ nws, om, qpf24 }) {
  const row = (label, t, note) => `
    <tr>
      <th scope="row">${label}${note ? `<span class="muted">${note}</span>` : ''}</th>
      <td class="num">${inches(t?.snow24)}</td>
      <td class="num">${inches(t?.snow72)}</td>
      <td class="num">${inches(t?.snow7d)}</td>
    </tr>`;

  const notes = [];
  if (nws?.snow72 != null && om?.snow72 != null) {
    const gap = Math.abs(nws.snow72 - om.snow72);
    if (gap >= 3) {
      notes.push(
        `The two forecasts differ by ${gap.toFixed(0)}" over 72 hours.`
      );
    }
  }
  if (qpf24 != null && qpf24 >= 0.005) {
    notes.push(`Liquid equivalent, 24h (NWS): ${qpf24.toFixed(2)}"`);
  }

  els.forecastCompare.innerHTML = `
    <table class="compare" aria-label="Forecast snowfall by source">
      <thead>
        <tr><th scope="col">Snowfall</th><th scope="col" class="num">24h</th><th scope="col" class="num">72h</th><th scope="col" class="num">7 days</th></tr>
      </thead>
      <tbody>
        ${row('NWS', nws, nws ? '' : 'not loaded')}
        ${row('Open-Meteo', om, om ? '' : 'loading')}
      </tbody>
    </table>
    ${notes.length ? `<p class="muted compare-notes">${notes.map(esc).join(' · ')}</p>` : ''}`;
}

/**
 * The four headline tiles under the resort name. Each fills in as its data
 * arrives; anything missing shows "--".
 */
export function renderVerdict({
  reported,
  reportState,
  terrain,
  nws,
  om,
  gust24,
  windHoldMph,
}) {
  // 1. What fell (reported by the resort) or, for SNOTEL, what is on the ground
  const isSnotel = String(reported?.source || '').startsWith('SNOTEL');
  if (reported && !isSnotel && reported.change24h != null) {
    els.vFellLabel.textContent = 'New snow';
    els.vFell.textContent = `${reported.change24h}"`;
    els.vFellSub.textContent = 'reported, 24h';
  } else if (reported?.depth != null) {
    els.vFellLabel.textContent = 'Snow depth';
    els.vFell.textContent = `${reported.depth}"`;
    els.vFellSub.textContent = isSnotel ? 'SNOTEL station' : 'reported';
  } else {
    els.vFellLabel.textContent = 'New snow';
    els.vFell.textContent = '--';
    els.vFellSub.textContent =
      reportState === 'loading' ? 'loading' : 'no report';
  }

  // 2. What is coming: the range across both forecasts
  const next = [nws?.snow24, om?.snow24].filter((v) => v != null);
  if (next.length) {
    const lo = inchesShort(Math.min(...next));
    const hi = inchesShort(Math.max(...next));
    els.vComing.textContent = lo === hi ? `${lo}"` : `${lo}–${hi}"`;
    els.vComingSub.textContent =
      next.length === 2 ? 'forecast, 2 models' : 'forecast';
  } else {
    els.vComing.textContent = '--';
    els.vComingSub.textContent = 'forecast';
  }

  // 3. Lifts
  const s = terrain?.summary;
  if (s?.liftsTotal != null) {
    els.vLifts.textContent = `${s.liftsOpen ?? 0}/${s.liftsTotal}`;
    els.vLiftsSub.textContent =
      s.liftsHold > 0 ? `open · ${s.liftsHold} on hold` : 'open';
    els.vLiftsSub.classList.toggle('warn', s.liftsHold > 0);
  } else {
    els.vLifts.textContent = '--';
    els.vLiftsSub.textContent =
      reportState === 'loading' ? 'loading' : 'not published';
    els.vLiftsSub.classList.remove('warn');
  }

  // 4. Wind
  const windy = gust24 != null && gust24 >= windHoldMph;
  els.vWind.textContent = gust24 != null ? `${Math.round(gust24)} mph` : '--';
  els.vWind.classList.toggle('warn', windy);
  els.vWindSub.textContent = windy ? 'wind-hold risk' : 'max gust, 24h';
  els.vWindSub.classList.toggle('warn', windy);
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
    // skip hours that have already ended, and anything past the window
    if (isNaN(t) || t + 3600000 <= now || t > maxTime) continue;

    const popVal =
      p?.probabilityOfPrecipitation?.value ?? p?.probabilityOfPrecipitation;

    rows.push(`
      <tr>
        <td>${esc(fmtTime(p.startTime))}</td>
        <td>${esc(p.shortForecast ?? '')}</td>
        <td class="num">${esc(num(p.temperature, `°${p.temperatureUnit ?? ''}`))}</td>
        <td class="num">${pct(popVal)}</td>
        <td class="num">${esc(p.windSpeed ?? '--')}</td>
        <td class="num">${esc(p.windGust ?? '--')}</td>
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
 * @param {object|null|'loading'} data - normalized report from groundTruth.js
 */
export function renderGroundTruth(data) {
  if (!data || data === 'loading') {
    els.reportExtra.innerHTML = '';
    els.snotelData.innerHTML =
      data === 'loading'
        ? '<p class="muted empty">Loading the mountain report…</p>'
        : '<p class="muted empty">This resort has no live on-mountain report. Use the Cams and Official links above.</p>';
    return;
  }

  // 1. Build KPIs (Grid)
  const kpis = [];
  const addKpi = (label, value, unit = '') => {
    // Loose check for null/undefined/empty string, but allow 0
    if (value == null || value === '') return;
    kpis.push(`
      <div class="kpi">
        <span class="muted">${esc(label)}</span>
        <b>${esc(value)}${esc(unit)}</b>
      </div>
    `);
  };

  // SNOTEL reports settled depth, so its day-over-day figure can be negative
  const isSnotel = String(data.source || '').startsWith('SNOTEL');
  addKpi(isSnotel ? 'Depth change, 24h' : 'New snow, 24h', data.change24h, '"');
  addKpi('Base depth', data.depth, '"');
  addKpi('Season total', data.seasonTotal, '"');

  if (data.temp != null) {
    addKpi('Temp', data.temp, '°F');
  }

  // 2. Build Extended Attributes (Flex List)
  let attrHtml = '';
  if (
    data.attributes &&
    Array.isArray(data.attributes) &&
    data.attributes.length > 0
  ) {
    attrHtml += `<div class="gt-attributes">`;
    data.attributes.forEach((attr) => {
      // attr = { label, value, type: 'info'|'success'|'warning'|'error' }
      attrHtml += `
        <div class="attr-row">
          <span class="attr-label">${esc(attr.label)}:</span>
          <span class="attr-value ${ATTR_TYPES.has(attr.type) ? attr.type : 'info'}">${esc(attr.value)}</span>
        </div>
      `;
    });
    attrHtml += `</div>`;
  }

  // 3. Excerpt
  let excerptHtml = '';
  if (data.excerpt) {
    excerptHtml = `<div class="gt-excerpt">"${esc(data.excerpt)}"</div>`;
  }

  // 4. Source
  const sourceHtml = `<div class="gt-source">Source: ${esc(data.source || 'Unknown')}</div>`;

  // Numbers first, then lifts and trails (#terrain sits between these two
  // containers), then the resort's own notes and write-up.
  els.snotelData.innerHTML = `<div class="gt-grid">${kpis.join('')}</div>`;
  els.reportExtra.innerHTML = `
    ${attrHtml}
    ${excerptHtml}
    ${sourceHtml}
  `;
}

// ---- Powder ranking ----
export function setRankingStatus(msg) {
  els.rankStatus.textContent = msg || '';
}

export function renderRegionOptions(resorts) {
  const regions = [...new Set(resorts.map((r) => r.region))].sort();
  els.rankRegion.innerHTML =
    '<option value="">All regions</option>' +
    regions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
}

function snowCell(inches, isSorted) {
  if (inches == null) return '<td class="num muted">--</td>';
  // Anything under a tenth of an inch reads as "no snow"
  const none = inches < 0.05;
  const cls = ['num', none ? 'muted' : '', isSorted ? 'sorted' : '']
    .filter(Boolean)
    .join(' ');
  return `<td class="${cls}">${none ? '0' : `${inches.toFixed(1)}"`}</td>`;
}

/**
 * @param {Array} rows - already filtered and sorted
 * @param {{sort:{key:string,dir:string}, selectedId:string, windHoldMph:number}} opts
 */
export function renderRanking(rows, { sort, selectedId, windHoldMph }) {
  // header sort indicators
  els.rankHead.querySelectorAll('th').forEach((th) => {
    const btn = th.querySelector('button[data-sort]');
    if (!btn) return;
    const active = btn.dataset.sort === sort.key;
    th.setAttribute(
      'aria-sort',
      active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
    );
    btn.querySelector('.arrow').textContent = active
      ? sort.dir === 'asc'
        ? '▲'
        : '▼'
      : '';
  });

  if (!rows.length) {
    els.rankBody.innerHTML =
      '<tr><td colspan="6" class="muted">No resorts to show.</td></tr>';
    return;
  }

  els.rankBody.innerHTML = rows
    .map((row, i) => {
      const windy = row.gust24 != null && row.gust24 >= windHoldMph;
      const gust =
        row.gust24 == null
          ? '<td class="num muted">--</td>'
          : `<td class="num${windy ? ' windy' : ''}"${
              windy
                ? ` title="Gusts at or above ${windHoldMph} mph: wind-hold risk"`
                : ''
            }>${windy ? '⚠ ' : ''}${Math.round(row.gust24)} mph</td>`;
      return `
      <tr data-id="${esc(row.id)}" tabindex="0"${
        row.id === selectedId ? ' class="selected" aria-current="true"' : ''
      }>
        <td class="num muted">${i + 1}</td>
        <td>${esc(row.name)}<span class="rank-region muted">${esc(row.region)}</span></td>
        ${snowCell(row.snow24, sort.key === 'snow24')}
        ${snowCell(row.snow72, sort.key === 'snow72')}
        ${snowCell(row.snow7d, sort.key === 'snow7d')}
        ${gust}
      </tr>`;
    })
    .join('');
}

// ---- Lifts & trails ----
const STATUS_LABELS = {
  open: 'Open',
  hold: 'On hold',
  scheduled: 'Expected',
  closed: 'Closed',
};
const LEVEL_MARKS = {
  green: '●',
  blue: '■',
  black: '◆',
  double: '◆◆',
  park: '▲',
  other: '○',
};
const LEVEL_ORDER = ['green', 'blue', 'black', 'double', 'park', 'other'];

let terrainState = null; // what is currently shown
let trailFilter = 'all'; // all | open | groomed

function statusChip(item) {
  // An unrecognised status is shown in the feed's own words
  const label = STATUS_LABELS[item.status] || item.rawStatus || 'Unknown';
  return `<span class="chip ${esc(item.status)}">${esc(label)}</span>`;
}

function levelMark(level, label) {
  return `<span class="lvl ${esc(level)}" title="${esc(label)}">${LEVEL_MARKS[level] || LEVEL_MARKS.other}</span>`;
}

// [{ area, items }] in first-seen order; a single unnamed group has no heading
function groupByArea(items) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.area)) groups.set(it.area, []);
    groups.get(it.area).push(it);
  }
  return [...groups].map(([area, list]) => ({ area, items: list }));
}

function groupHtml(items, rowHtml) {
  return groupByArea(items)
    .map(
      ({ area, items: list }) => `
      ${area ? `<div class="terrain-area">${esc(area)}</div>` : ''}
      <ul class="terrain-list">${list.map(rowHtml).join('')}</ul>`
    )
    .join('');
}

function liftsHtml(lifts) {
  if (!lifts.length) return '<p class="muted">No lift list in this feed.</p>';
  return groupHtml(lifts, (l) => {
    const sub = [l.type, l.wait != null ? `${l.wait} min wait` : '', l.note]
      .filter(Boolean)
      .join(' · ');
    return `<li>
        <span class="terrain-name">${esc(l.name)}${sub ? `<span class="muted">${esc(sub)}</span>` : ''}</span>
        ${statusChip(l)}
      </li>`;
  });
}

function trailsHtml(trails) {
  const shown = trails.filter(
    (t) =>
      trailFilter === 'all' ||
      (trailFilter === 'open' && t.status === 'open') ||
      (trailFilter === 'groomed' && t.groomed)
  );
  if (!trails.length) return '<p class="muted">No trail list in this feed.</p>';
  if (!shown.length) {
    return `<p class="muted">No ${trailFilter === 'open' ? 'open' : 'groomed'} trails right now.</p>`;
  }
  return groupHtml(
    shown,
    (t) => `<li>
        <span class="terrain-name">${levelMark(t.level, t.levelLabel)} ${esc(t.name)}${
          t.groomed ? '<span class="groomed">groomed</span>' : ''
        }</span>
        ${statusChip(t)}
      </li>`
  );
}

function filterButtons() {
  return ['all', 'open', 'groomed']
    .map(
      (f) =>
        `<button type="button" class="tab${f === trailFilter ? ' active' : ''}" data-trail-filter="${f}" aria-pressed="${f === trailFilter}">${f[0].toUpperCase()}${f.slice(1)}</button>`
    )
    .join('');
}

function levelBreakdown(trails) {
  return LEVEL_ORDER.map((level) => {
    const ofLevel = trails.filter((t) => t.level === level);
    if (!ofLevel.length) return '';
    const open = ofLevel.filter((t) => t.status === 'open').length;
    const label = level === 'other' ? 'Other' : ofLevel[0].levelLabel;
    return `<span class="terrain-stat" title="${esc(label)}">${levelMark(level, label)} ${open}/${ofLevel.length}</span>`;
  }).join('');
}

/**
 * @param {object|null|'loading'} terrain - from terrain.js; 'loading' shows
 *   a placeholder while a separate lift/trail request is in flight
 */
export function renderTerrain(terrain) {
  terrainState = terrain && terrain !== 'loading' ? terrain : null;
  if (!terrain) {
    els.terrain.hidden = true;
    els.terrain.innerHTML = '';
    return;
  }
  els.terrain.hidden = false;
  if (terrain === 'loading') {
    els.terrain.innerHTML =
      '<p class="muted terrain-loading">Loading lifts and trails…</p>';
    return;
  }

  const { summary: s, trails } = terrain;
  const stats = [];
  if (s.liftsHold > 0) {
    stats.push(
      `<span class="terrain-stat hold">${s.liftsHold} lift${s.liftsHold === 1 ? '' : 's'} on hold</span>`
    );
  }
  if (s.groomed != null && trails.length + (s.trailsTotal || 0) > 0) {
    stats.push(`<span class="terrain-stat">Groomed ${s.groomed}</span>`);
  }
  if (s.acresTotal) {
    stats.push(
      `<span class="terrain-stat">Acres ${s.acresOpen ?? 0}/${s.acresTotal}</span>`
    );
  }

  els.terrain.innerHTML = `
    <div class="terrain-stats">${levelBreakdown(trails)}${stats.join('')}</div>
    <details class="terrain-details" data-kind="lifts">
      <summary>Lifts <b>${s.liftsOpen ?? '--'}/${s.liftsTotal ?? '--'} open</b></summary>
      <div class="terrain-body"></div>
    </details>
    <details class="terrain-details" data-kind="trails">
      <summary>Trails <b>${s.trailsOpen ?? '--'}/${s.trailsTotal ?? '--'} open</b></summary>
      <div class="terrain-filters">${filterButtons()}</div>
      <div class="terrain-body"></div>
    </details>`;
}

// The lists can be hundreds of rows, so they are built only when opened
function fillTerrainBody(details) {
  if (!terrainState) return;
  const body = details.querySelector('.terrain-body');
  body.innerHTML =
    details.dataset.kind === 'lifts'
      ? liftsHtml(terrainState.lifts)
      : trailsHtml(terrainState.trails);
}

els.terrain.addEventListener(
  'toggle',
  (ev) => {
    const details = ev.target.closest?.('details.terrain-details');
    if (details?.open) fillTerrainBody(details);
  },
  true // toggle doesn't bubble
);

els.terrain.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-trail-filter]');
  if (!btn) return;
  trailFilter = btn.dataset.trailFilter;
  const details = btn.closest('details');
  details.querySelector('.terrain-filters').innerHTML = filterButtons();
  fillTerrainBody(details);
});
