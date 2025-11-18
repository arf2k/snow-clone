import { MTNPOWDER_TOKEN } from './secrets.js';
/**
 * Fetches RAW data from the mtnpowder.com platform API
 * @param {string} resortId - The resort's ID for the platform
 * @returns {object} - The raw, unparsed JSON response
 */
export async function fetchMtnPowderData(resortId) {
  
  const u = new URL('/api/mtnpowder', window.location.origin);
  u.searchParams.set('bearer_token', MTNPOWDER_TOKEN);
  u.searchParams.set('resortId[]', resortId);

  const r = await fetch(u.toString());
  if (!r.ok) {
    throw new Error(`MtnPowder API fetch failed (${r.status})`);
  }

  // Return the raw JSON, not the parsed object
  return r.json();
}