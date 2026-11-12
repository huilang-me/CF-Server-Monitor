# CFSM Minimal

A compact, low-dependency third-party theme for CF-Server-Monitor.

## Design goals
- Small dashboard cards and restrained colors
- No charting framework, icon pack, web fonts, or animation library
- REST only for initial configuration/list and detail/history; live metrics use WebSocket
- Responsive layout and tabular numerals

## Development
```bash
npm install
cp .env.example .env
npm run dev
npm run build
```

Set `VITE_API_BASE` to one or more comma-separated Worker origins for local or static hosting. Leave it empty for same-origin deployment.

## Publish
Push to `theme-minimal` or run the workflow manually. The workflow builds the site and appends the generated `index.html` and `assets/` to the `dist` branch without force-pushing.

In GitHub repository settings:
1. Actions → General → Workflow permissions → Read and write permissions.
2. Pages → Build and deployment → Deploy from a branch → `dist` / `/(root)`.
3. Add repository secrets: `API_BASE`, `TITLE`, `BACKGROUND_IMAGE`, `CSP_API`, `CSP_STATIC`.

For cross-origin hosting, add the Pages origin to `CORS_ALLOWED_ORIGINS` on every Worker. Use plain origins separated by commas.
