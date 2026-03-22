# ForexOrbit PWA — setup, HTTPS, and testing

## Folder layout

```
public/
  manifest.json       — Web app manifest (install, theme, icons)
  offline.html        — Shown when a navigation request fails offline
  service-worker.js   — Generated at build/dev from src (gitignored; do not edit)
  icons/
    icon-192.png
    icon-512.png
src/
  service-worker.js   — Source of truth; copied to public/ when Next loads next.config.js
components/
  RegisterPwa.tsx     — Registers the service worker (HTTPS / localhost only)
pages/
  _document.tsx       — Manifest link, meta theme-color, apple-touch-icon
  _app.tsx            — Mounts RegisterPwa
index.html            — Reference for static hosts (Next.js uses pages/* instead)
```

## HTTPS (required outside localhost)

Browsers only register service workers on **secure origins**:

- `https://` production URLs (e.g. Vercel, Netlify, Cloudflare — HTTPS by default)
- `http://localhost` and `http://127.0.0.1` for local development

**Do not** expect the PWA to install or the service worker to register on plain `http://` production hosts. Terminate TLS at your host or reverse proxy and redirect HTTP → HTTPS.

## Deploy

1. Run `npm run build` and deploy as you already do (the config step copies `src/service-worker.js` → `public/service-worker.js`).
2. Confirm `https://your-domain/manifest.json` and `https://your-domain/service-worker.js` return 200.
3. After changing caching behavior or precache URLs, bump `CACHE_VERSION` in `src/service-worker.js` so clients drop old caches.

## Test with Chrome DevTools & Lighthouse

1. Open the site over **HTTPS** or **localhost**.
2. **Application** panel → **Manifest** — verify name, icons, theme.
3. **Application** → **Service workers** — check registered worker and scope `/`.
4. **Network** — enable **Offline**, reload; navigations should fall back to `offline.html` when uncached.
5. **Lighthouse** (DevTools → **Lighthouse** or **More tools** → **Lighthouse**):
   - Mode: **Navigation** (or **Timespan** if needed).
   - Categories: enable **Progressive Web App**.
   - Run on your deployed HTTPS URL (or localhost). Review PWA audit items and fix any regressions (icons, manifest, HTTPS, SW).

## Install prompt

On supported browsers, users can **Install** from the address bar or browser menu once manifest + SW + HTTPS requirements are met. Mobile Safari uses “Add to Home Screen” with `apple-touch-icon` and standalone display from the manifest.
