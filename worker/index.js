// worker/index.js — Cloudflare Worker: the app's only server-side code.
//
// Static files (the built app in ./dist) are served by Cloudflare directly.
// This Worker handles /api/* and nothing else. It is a deliberately narrow
// read-only gateway to the upstream data sources:
//
//   - fixed allowlist of upstream hosts AND paths (worker/upstreams.js)
//   - GET/HEAD only
//   - same-site browser requests only (no CORS, cross-site callers refused)
//   - per-visitor rate limit
//   - nothing from the visitor is forwarded upstream (no cookies, headers, IP)
//   - nothing but JSON comes back, with upstream headers stripped
//   - the MtnPowder token lives in a Worker secret and never leaves the server
//   - responses are cached at the edge, which also shields the upstreams

import { UPSTREAMS, MTNPOWDER } from './upstreams.js';

const USER_AGENT = 'SnowChase/1.0 (personal snow forecast dashboard)';
const UPSTREAM_TIMEOUT_MS = 12000;
const MAX_QUERY_LENGTH = 2048;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const BROWSER_MAX_AGE = 60;

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

/** Refuse requests that a page on another site caused the browser to make. */
function isCrossSite(request, url) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin !== url.origin);
}

/**
 * Work out the upstream URL for an /api/... request.
 * Returns { target, ttl } or { error: Response }.
 */
function resolveUpstream(url, env) {
  const [, , name, ...rest] = url.pathname.split('/'); // '', 'api', name, ...
  const path = rest.length ? `/${rest.join('/')}` : '';

  if (name === 'mtnpowder') {
    if (path) return { error: json(404, { error: 'Not found' }) };
    // Only the one parameter the app uses, and only a plain numeric ID
    const ids = url.searchParams.getAll('resortId[]');
    const onlyResortId = [...url.searchParams.keys()].every(
      (k) => k === 'resortId[]'
    );
    if (!onlyResortId || ids.length !== 1 || !/^\d{1,5}$/.test(ids[0])) {
      return { error: json(400, { error: 'Bad request' }) };
    }
    if (!env.MTNPOWDER_TOKEN) {
      return { error: json(503, { error: 'MtnPowder is not configured' }) };
    }
    const target = new URL(MTNPOWDER.path, MTNPOWDER.origin);
    target.searchParams.set('bearer_token', env.MTNPOWDER_TOKEN);
    target.searchParams.set('resortId[]', ids[0]);
    return { target, ttl: MTNPOWDER.ttl };
  }

  const upstream = Object.hasOwn(UPSTREAMS, name) ? UPSTREAMS[name] : null;
  if (!upstream || !upstream.allow.some((re) => re.test(path))) {
    return { error: json(404, { error: 'Not found' }) };
  }
  if (url.search.length > MAX_QUERY_LENGTH) {
    return { error: json(414, { error: 'Query too long' }) };
  }
  // Built from fixed parts plus an allowlisted path, so the host can't change
  const target = new URL(
    `${upstream.origin}${upstream.basePath || ''}${path}${url.search}`
  );
  if (target.origin !== upstream.origin) {
    return { error: json(400, { error: 'Bad request' }) };
  }
  return { target, ttl: upstream.ttl };
}

async function fetchUpstream(target, ttl) {
  let res;
  try {
    res = await fetch(target, {
      method: 'GET',
      headers: {
        Accept: 'application/json, application/geo+json',
        'User-Agent': USER_AGENT,
      },
      // An upstream must not be able to bounce us to some other host
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Deliberately no detail: the target URL can contain the secret token
    return json(502, { error: 'Upstream request failed' });
  }

  if (!res.ok) {
    await res.body?.cancel();
    return json(res.status === 404 ? 404 : 502, {
      error: 'Upstream error',
      upstreamStatus: res.status,
    });
  }

  const type = res.headers.get('Content-Type') || '';
  const length = Number(res.headers.get('Content-Length') || 0);
  if (!type.includes('json') || length > MAX_BODY_BYTES) {
    await res.body?.cancel();
    return json(502, { error: 'Unexpected upstream response' });
  }

  // Fresh headers: nothing from the upstream (cookies etc.) is passed along
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${ttl}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Copy of a cached/fresh response with the headers the browser should see. */
function forBrowser(res, cacheStatus) {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', `private, max-age=${BROWSER_MAX_AGE}`);
  out.headers.set('X-Cache', cacheStatus);
  return out;
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
  }
  if (isCrossSite(request, url)) {
    return json(403, { error: 'Forbidden' });
  }

  if (env.API_LIMITER) {
    const who = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.API_LIMITER.limit({ key: who });
    if (!success) {
      return json(429, { error: 'Too many requests' }, { 'Retry-After': '60' });
    }
  }

  const resolved = resolveUpstream(url, env);
  if (resolved.error) return resolved.error;

  // The cache key is the public /api URL, so it never contains the token
  url.searchParams.sort();
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) return forBrowser(hit, 'HIT');

  const fresh = await fetchUpstream(resolved.target, resolved.ttl);
  if (fresh.status !== 200) return fresh;

  ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  return forBrowser(fresh, 'MISS');
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApi(request, env, ctx);
    }
    // Everything else is a static file
    return env.ASSETS.fetch(request);
  },
};
