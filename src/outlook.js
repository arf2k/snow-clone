// outlook.js — date helpers and trip scoring over the daily forecast.
// Dates are plain 'YYYY-MM-DD' strings: a trip day means that calendar day
// at the resort, whatever timezone the viewer is in.

const DAY_MS = 86400000;

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS
  );
}

/** Today as the viewer's calendar date. */
export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The Saturday-Sunday `weeksAhead` weekends from now. On a Saturday the
 * current weekend counts; on a Sunday it is just that day.
 */
export function weekend(weeksAhead = 0, from = today()) {
  const dow = new Date(`${from}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  if (dow === 0 && weeksAhead === 0) return { start: from, end: from };
  const toSaturday = (6 - dow + 7) % 7;
  const start = addDays(from, toSaturday + weeksAhead * 7);
  return { start, end: addDays(start, 1) };
}

/** 'Sat 14' style label; `long` adds the month. */
export function dayLabel(date, { long = false } = {}) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(
    [],
    long
      ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
      : { weekday: 'short', day: 'numeric', timeZone: 'UTC' }
  );
}

export const LEAD_DAYS = 2; // days before a trip that count as "fresh snow"

/**
 * Score one resort for a trip.
 * @param {Array<{date, snow, gust}>} daily from ranking.js
 * @returns {{before, during, total, tripGust}} inches / mph; null when the
 *   forecast does not reach those days
 */
export function tripTotals(daily, start, end) {
  const leadStart = addDays(start, -LEAD_DAYS);
  let before = null;
  let during = null;
  let tripGust = null;
  for (const d of daily || []) {
    if (d.snow == null) continue;
    if (d.date >= leadStart && d.date < start) before = (before ?? 0) + d.snow;
    if (d.date >= start && d.date <= end) {
      during = (during ?? 0) + d.snow;
      if (d.gust != null) tripGust = Math.max(tripGust ?? 0, d.gust);
    }
  }
  return {
    before,
    during,
    total:
      before == null && during == null ? null : (before ?? 0) + (during ?? 0),
    tripGust,
  };
}
