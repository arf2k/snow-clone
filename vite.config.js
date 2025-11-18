// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // --- Proxy for Killington ---
      '/api/killington': {
        target: 'https://api.killington.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/killington/, '/api/v1/dor/drupal'),
      },

      // --- Proxy for Copper ---
      '/api/copper': {
        target: 'https://api.coppercolorado.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/copper/, '/api/v1/dor/drupal'),
      },

      // --- Proxy for MtnPowder ---
      '/api/mtnpowder': {
        target: 'https://mtnpowder.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mtnpowder/, '/feed/v3.json'),
      },
      
      // --- Proxy for NWS ---
      '/api/nws': {
        target: 'https://api.weather.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nws/, ''),
      },

      // --- Proxy for SNOTEL ---
      '/api/snotel': {
        target: 'https://wcc.sc.egov.usda.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/snotel/, '/awdbRestApi/services/v1'),
      },
      
      // --- Proxy for Open-Meteo ---
      '/api/open-meteo': {
        target: 'https://api.open-meteo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/open-meteo/, '/v1'),
      },
    },
  },
});