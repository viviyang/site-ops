# Site Ops

Workspace-level utilities for repeated site operations across independent projects.

The first utility is a Playwright screenshot crawler that can capture one registered site or every registered site without changing app code.

## Setup

```bash
npm install
npm run typecheck
```

Install the Playwright browser once if this machine does not already have it:

```bash
npx playwright install chromium
```

## Usage

Capture one live site:

```bash
npm run screenshots -- --site momentwording
```

Capture unpublished local changes by pointing the registered site at a local dev server:

```bash
npm run screenshots -- --site momentwording --base-url http://127.0.0.1:3002 --sitemap-url http://127.0.0.1:3002/sitemap.xml
```

Capture every registered site:

```bash
npm run screenshots -- --all
```

The crawler reads each site's sitemap first. If the sitemap is unavailable or empty, it falls back to the site's configured `fallbackRoutes`.

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
