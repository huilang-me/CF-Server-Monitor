# CFSM Minimal

A lightweight third-party theme for CF-Server-Monitor, built with Vue 3 + Vite.

## Design
- Minimal responsive server cards and compact status summary
- No charting framework, icon library, UI framework, web font, or animation dependency
- Lightweight SVG history charts
- Dark / light appearance follows the site's `preferred_theme`
- Chinese / English follows `default_language`

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

By default the theme uses the current origin as its API base. For local development against a remote Worker, set `VITE_API_BASE` in a local `.env` file. Do not commit Worker URLs or credentials.

## Build output

`npm run build` creates only `dist/index.html` and `dist/assets/`.

## Current status

This branch is for theme development and CI verification only. It does not deploy to GitHub Pages, Cloudflare Pages, or Cloudflare Workers. No deployment workflow is enabled.
