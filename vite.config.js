// vite.config.js
import { defineConfig, loadEnv } from 'vite';

// Every upstream is reached as /api/<name>/<upstream path>. The proxy only
// strips the /api/<name> prefix, so the browser-side URL rewrite in
// src/groundTruth.js is the same for every resort.
const UPSTREAMS = {
  // Resort snow reports
  killington: 'https://api.killington.com',
  copper: 'https://api.coppercolorado.com',
  snowbird: 'https://api.snowbird.com',
  mtbachelor: 'https://api.mtbachelor.com',
  eldora: 'https://api.eldora.com',
  jacksonhole: 'https://jacksonhole-prod.zaneray.com',
  sugarloaf: 'https://www.sugarloaf.com',
  brighton: 'https://www.brightonresort.com',
  sundayriver: 'https://www.sundayriver.com',
  loon: 'https://www.loonmtn.com',
  bigsky: 'https://www.bigskyresort.com',
  // Weather
  nws: 'https://api.weather.gov',
};

function stripPrefix(name, replacement = '') {
  const re = new RegExp(`^/api/${name}`);
  return (path) => path.replace(re, replacement);
}

export default defineConfig(({ mode }) => {
  // '' prefix: load non-VITE_ vars too. They stay in this (Node) process.
  const env = loadEnv(mode, process.cwd(), '');
  const mtnPowderToken = env.MTNPOWDER_TOKEN || '';

  const proxy = {};
  for (const [name, target] of Object.entries(UPSTREAMS)) {
    proxy[`/api/${name}`] = {
      target,
      changeOrigin: true,
      rewrite: stripPrefix(name),
    };
  }

  proxy['/api/snotel'] = {
    target: 'https://wcc.sc.egov.usda.gov',
    changeOrigin: true,
    rewrite: stripPrefix('snotel', '/awdbRestApi/services/v1'),
  };

  proxy['/api/open-meteo'] = {
    target: 'https://api.open-meteo.com',
    changeOrigin: true,
    rewrite: stripPrefix('open-meteo', '/v1'),
  };

  // MtnPowder: the token is appended here, server side.
  proxy['/api/mtnpowder'] = {
    target: 'https://mtnpowder.com',
    changeOrigin: true,
    rewrite: (path) => {
      const rewritten = path.replace(/^\/api\/mtnpowder/, '/feed/v3.json');
      const sep = rewritten.includes('?') ? '&' : '?';
      return `${rewritten}${sep}bearer_token=${encodeURIComponent(mtnPowderToken)}`;
    },
  };

  return { server: { proxy }, preview: { proxy } };
});
