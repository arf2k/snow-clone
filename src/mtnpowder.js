/**
 * Fetches RAW data from the mtnpowder.com platform API.
 * The bearer token is added by the /api/mtnpowder proxy (see vite.config.js),
 * so it never reaches the browser.
 * @param {string|number} resortId - The resort's ID for the platform
 * @returns {object} - The raw, unparsed JSON response
 */
export async function fetchMtnPowderData(resortId, { signal } = {}) {
  const u = new URL('/api/mtnpowder', window.location.origin);
  u.searchParams.set('resortId[]', resortId);

  const r = await fetch(u.toString(), { signal });
  if (!r.ok) {
    throw new Error(`MtnPowder API fetch failed (${r.status})`);
  }
  return r.json();
}
