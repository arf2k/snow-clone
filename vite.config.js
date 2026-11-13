// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import { UPSTREAMS, MTNPOWDER } from './worker/upstreams.js';

// Local dev only (`npm run dev`). In production the same /api/* routes are
// served by the Cloudflare Worker in worker/index.js, from the same table.

function swapPrefix(name, replacement = '') {
  const re = new RegExp(`^/api/${name}`);
  return (path) => path.replace(re, replacement);
}

export default defineConfig(({ mode }) => {
  // '' prefix: load non-VITE_ vars too. They stay in this (Node) process.
  const env = loadEnv(mode, process.cwd(), '');
  const mtnPowderToken = env.MTNPOWDER_TOKEN || '';

  const proxy = {};
  for (const [name, { origin, basePath }] of Object.entries(UPSTREAMS)) {
    proxy[`/api/${name}`] = {
      target: origin,
      changeOrigin: true,
      rewrite: swapPrefix(name, basePath || ''),
    };
  }

  // MtnPowder: the token is appended here, server side.
  proxy['/api/mtnpowder'] = {
    target: MTNPOWDER.origin,
    changeOrigin: true,
    rewrite: (path) => {
      const rewritten = path.replace(/^\/api\/mtnpowder/, MTNPOWDER.path);
      const sep = rewritten.includes('?') ? '&' : '?';
      return `${rewritten}${sep}bearer_token=${encodeURIComponent(mtnPowderToken)}`;
    },
  };

  return { server: { proxy } };
});
