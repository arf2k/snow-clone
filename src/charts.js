// charts.js — small HTML bar charts for daily snowfall.
//
// Built from plain elements rather than SVG so labels stay at a readable
// size on a phone. Series colours are the two validated categorical slots
// for a dark surface (see styles/main.css: --series-1 / --series-2).

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
}

const fmt = (v) =>
  v < 0.05 ? '0' : v < 10 ? v.toFixed(1) : String(Math.round(v));

/**
 * Grouped daily bars.
 * @param {object} o
 * @param {Array<{label: string, sub?: string}>} o.days
 * @param {Array<{name: string, values: Array<number|null>}>} o.series
 *   up to two; `slot` (1 or 2) fixes the colour so a source keeps its
 *   colour whether or not the other one is present
 * @param {boolean} [o.compact] sparkline: no legend, no per-day value labels
 * @param {number} [o.max] fixed scale top, to compare several charts
 * @returns {string} HTML
 */
export function dailyBars({ days, series, compact = false, max: fixedMax }) {
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!days.length || !all.length) {
    return '<p class="muted">No daily forecast available.</p>';
  }
  // A floor on the scale keeps a dusting from drawing as a tall bar
  const max = Math.max(...all, fixedMax || 0, compact ? 1 : 2);
  const slot = (s, k) => s.slot || k + 1;

  const columns = days
    .map((day, i) => {
      const vals = series.map((s) => s.values[i]);
      const present = vals.filter((v) => v != null);
      const top = present.length ? Math.max(...present) : null;
      const bars = series
        .map((s, k) => {
          const v = s.values[i];
          if (v == null) return `<span class="bar none s${slot(s, k)}"></span>`;
          const pct = v < 0.05 ? 0 : Math.max(2, (v / max) * 100);
          return `<span class="bar s${slot(s, k)}" style="height:${pct.toFixed(1)}%" title="${esc(
            `${day.label}${day.sub ? ` ${day.sub}` : ''} · ${s.name}: ${fmt(v)}"`
          )}"></span>`;
        })
        .join('');
      // One label per day (the larger forecast), not a number on every bar
      const label =
        compact || top == null
          ? ''
          : `<span class="bar-val${top < 0.05 ? ' zero' : ''}">${fmt(top)}</span>`;
      return `<div class="bar-col">
          <div class="bar-plot">${label}<div class="bar-pair">${bars}</div></div>
          ${compact ? '' : `<span class="bar-day">${esc(day.label)}</span>${day.sub ? `<span class="bar-sub">${esc(day.sub)}</span>` : ''}`}
        </div>`;
    })
    .join('');

  const legend =
    !compact && series.length > 1
      ? `<div class="bar-legend">${series
          .map(
            (s, k) =>
              `<span><i class="swatch s${slot(s, k)}"></i>${esc(s.name)}</span>`
          )
          .join(
            ''
          )}<span class="muted">inches; label shows the higher forecast</span></div>`
      : '';

  // The same numbers as a table, for screen readers
  const table = compact
    ? ''
    : `<table class="sr-only"><caption>Forecast snowfall by day, inches</caption>
        <thead><tr><th>Day</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
        <tbody>${days
          .map(
            (d, i) =>
              `<tr><th>${esc(d.label)} ${esc(d.sub || '')}</th>${series
                .map(
                  (s) =>
                    `<td>${s.values[i] == null ? 'n/a' : fmt(s.values[i])}</td>`
                )
                .join('')}</tr>`
          )
          .join('')}</tbody></table>`;

  return `<div class="bars${compact ? ' compact' : ''}" ${compact ? 'aria-hidden="true"' : 'role="img" aria-label="Bar chart of forecast snowfall by day"'}>${columns}</div>${legend}${table}`;
}
