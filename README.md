# Site Ops

Workspace-level utilities for repeated site operations across independent projects.

The first utility is a Playwright screenshot crawler that can capture one registered site or every registered site without changing app code.

## Commands

```bash
npm install
npm run typecheck
npm run screenshots -- --site momentwording
npm run screenshots -- --site momentwording --base-url http://127.0.0.1:3002 --sitemap-url http://127.0.0.1:3002/sitemap.xml
npm run screenshots -- --all
```

## Site Registry

Sites are configured in `sites/*.json`.

Each config includes:

- `id`
- `name`
- `baseUrl`
- `sitemapUrl`
- `fallbackRoutes`
- `viewports`

## Screenshot Output

Generated screenshots are written to:

```text
screenshots/<site-id>/latest/<viewport>/
screenshots/<site-id>/<YYYY-MM-DD>/<viewport>/
```

Generated screenshots are ignored by git by default.
