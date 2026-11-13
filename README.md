# Snow-Chase

Where is it going to snow? A ranking of ski resorts by forecast snowfall, plus
forecast, on-mountain conditions and a model map for the resort you pick.

- **Front end:** plain JavaScript built with Vite (`src/`, `styles/`, `index.html`)
- **Back end:** one Cloudflare Worker (`worker/`) that serves the built site and
  a small, locked-down `/api/*` gateway to the data sources
- **Data:** NWS, Open-Meteo, SNOTEL, MtnPowder and individual resort feeds;
  the resort list is `public/resorts.json`

## Run locally

```bash
npm install
cp .env.example .env.local   # then put your MtnPowder token in it
npm run dev                  # Vite dev server with hot reload
npm run preview:cf           # production build served by the real Worker, on :8787
```

`.env.local` is gitignored. Both commands read `MTNPOWDER_TOKEN` from it.
Without a token everything works except the MtnPowder-backed resorts, which
fall back to SNOTEL where a station is configured.

## Deploy to Cloudflare

One-time setup (pick A or B), then set the secret.

**A. Auto-deploy from GitHub (recommended).** In the Cloudflare dashboard:
Workers & Pages → Create → Import a repository → choose this repo.
Build command `npm run build`, deploy command `npx wrangler deploy`.
Every push to `main` deploys; pull requests get preview URLs. No Cloudflare
credentials are stored in GitHub.

**B. Deploy from your machine.**

```bash
npx wrangler login
npm run deploy
```

**Then set the token** (once; it is stored encrypted by Cloudflare and is never
in the repo or the browser):

```bash
npx wrangler secret put MTNPOWDER_TOKEN
```

## Security model

The Worker is the only server-side code, and it is deliberately narrow:

- **Not an open proxy.** Only the hosts *and paths* listed in
  `worker/upstreams.js` can be reached. Everything else is a 404.
- **Read-only.** GET and HEAD only.
- **Same-site only.** No CORS headers; requests triggered by other sites are
  refused.
- **Rate limited** per visitor (`ratelimits` in `wrangler.jsonc`).
- **Nothing from the visitor goes upstream** — no cookies, headers or IP.
- **Only JSON comes back,** with upstream headers stripped.
- **The MtnPowder token is a Worker secret.** It is added server side and is
  not part of the cache key, logs or any response.
- **Edge caching** (5–30 minutes depending on the source) keeps load on the
  upstreams low.
- **Static site headers** (`public/_headers`): a strict Content-Security-Policy
  (scripts only from this site, framing only of Windy), HSTS, no framing of
  this site, no sniffing.
- **In the browser,** all feed text is escaped before it is rendered.

To make the site private (only you, or a list of emails), turn on Cloudflare
Access for the Worker in the dashboard: Settings → Domains & Routes → enable
Cloudflare Access. No code change is needed.

## Add a resort

Add an entry to `public/resorts.json` (run `npm run smoke:test` to validate).
If it has its own report feed, add the host and path to `worker/upstreams.js`
and the host to `PROXY_MAP` in `src/groundTruth.js`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run preview:cf` | Build, then run the Worker locally |
| `npm run deploy` | Lint, validate resorts, build, deploy |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run smoke:test` | Validate `public/resorts.json` |
