# Project Context

## Summary

Site Ops is a workspace-level utility project for repeated operations across independent websites in this workspace.

## Goals

- Provide one shared screenshot crawler for multiple sites.
- Keep site configuration in a small checked-in registry.
- Support live-site and local-dev screenshot runs.
- Avoid changing individual app code for workspace-level capture workflows.

## Stack

- Node.js
- TypeScript
- Playwright
- tsx

## Structure

- `scripts/`: executable TypeScript utilities
- `sites/`: site registry JSON files
- `screenshots/`: generated screenshot output, ignored by git
- `reports/`: future generated reports, ignored by git

## Runbook

- `npm install`: install dependencies
- `npm run typecheck`: run TypeScript checks
- `npm run screenshots -- --site <id>`: capture one registered site
- `npm run screenshots -- --all`: capture all registered sites

## Current Priorities

- Keep the screenshot crawler generic and reliable.
- Register active sites through config rather than crawler code.
- Preserve a stable CLI contract for future Codex skill integration.

## Known Risks

- Screenshot output can grow quickly; generated screenshots stay ignored by default.
- Visual diff is intentionally out of scope until baseline capture is stable.
- Some future sites may need custom auth or route filtering; keep the first version public-page only.
