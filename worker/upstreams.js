// worker/upstreams.js
//
// The complete list of places the app is allowed to fetch data from.
// Shared by the Cloudflare Worker (production) and vite.config.js (local dev)
// so the two can't drift apart.
//
// A browser request for /api/<name>/<path>?<query> is forwarded to
//   <origin><basePath><path>?<query>
// and only if <path> matches one of the `allow` patterns. Anything else is
// refused, so this can never be used as a general-purpose proxy.
//
// ttl = seconds a response is cached at Cloudflare's edge.

const DRUPAL_REPORT = [/^\/api\/v1\/dor\/drupal\/snow-reports$/];
const REPORTPAL = [/^\/api\/reportpal$/];
const REPORT_TTL = 600;

export const UPSTREAMS = {
  // ---- Resort snow reports ----
  killington: {
    origin: 'https://api.killington.com',
    allow: DRUPAL_REPORT,
    ttl: REPORT_TTL,
  },
  copper: {
    origin: 'https://api.coppercolorado.com',
    allow: DRUPAL_REPORT,
    ttl: REPORT_TTL,
  },
  snowbird: {
    origin: 'https://api.snowbird.com',
    allow: DRUPAL_REPORT,
    ttl: REPORT_TTL,
  },
  mtbachelor: {
    origin: 'https://api.mtbachelor.com',
    allow: DRUPAL_REPORT,
    ttl: REPORT_TTL,
  },
  eldora: {
    origin: 'https://api.eldora.com',
    allow: DRUPAL_REPORT,
    ttl: REPORT_TTL,
  },
  jacksonhole: {
    origin: 'https://jacksonhole-prod.zaneray.com',
    allow: [/^\/api\/all\.json$/],
    ttl: REPORT_TTL,
  },
  sugarloaf: {
    origin: 'https://www.sugarloaf.com',
    allow: REPORTPAL,
    ttl: REPORT_TTL,
  },
  brighton: {
    origin: 'https://www.brightonresort.com',
    allow: REPORTPAL,
    ttl: REPORT_TTL,
  },
  sundayriver: {
    origin: 'https://www.sundayriver.com',
    allow: REPORTPAL,
    ttl: REPORT_TTL,
  },
  loon: {
    origin: 'https://www.loonmtn.com',
    allow: REPORTPAL,
    ttl: REPORT_TTL,
  },
  bigsky: {
    origin: 'https://www.bigskyresort.com',
    allow: REPORTPAL,
    ttl: REPORT_TTL,
  },

  // ---- Weather ----
  nws: {
    origin: 'https://api.weather.gov',
    allow: [
      /^\/points\/-?\d{1,3}(\.\d{1,4})?,-?\d{1,3}(\.\d{1,4})?$/,
      /^\/gridpoints\/[A-Z]{3}\/\d{1,3},\d{1,3}(\/forecast(\/hourly)?)?$/,
    ],
    ttl: 300,
  },
  'open-meteo': {
    origin: 'https://api.open-meteo.com',
    basePath: '/v1',
    allow: [/^\/forecast$/],
    ttl: 900,
  },
  snotel: {
    origin: 'https://wcc.sc.egov.usda.gov',
    basePath: '/awdbRestApi/services/v1',
    allow: [/^\/data$/],
    ttl: 1800,
  },
};

// MtnPowder is handled separately because it needs the secret token.
export const MTNPOWDER = {
  origin: 'https://mtnpowder.com',
  path: '/feed/v3.json',
  ttl: REPORT_TTL,
};
