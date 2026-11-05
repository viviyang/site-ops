# Project Context

## Summary

Site Ops is a workspace-level utility project for repeated operations across independent websites in this workspace.

## Goals

- Provide one shared screenshot crawler for multiple sites.
- Keep site configuration in a small checked-in registry.
- Support live-site and local-dev screenshot runs.
- Avoid changing individual app code for workspace-level capture workflows.
- Provide a safe Obsidian-to-site draft pipeline for public-ready personal content.

- Track registered backlink submissions, checks, and follow-ups from one CLI.

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

- `backlinks/`: platform registry, per-site submissions, and append-only check logs.

## Runbook

- `npm install`: install dependencies
- `npm run typecheck`: run TypeScript checks
- `npm run screenshots -- --site <id>`: capture one registered site
- `npm run screenshots -- --all`: capture all registered sites
- `npm run publish:obsidian`: dry-run Obsidian public-note publishing
- `npm run publish:obsidian -- --write`: generate `weiwei-blog` MDX drafts from eligible public notes

- `npm run backlinks -- validate`: validate backlink data; see [Agent guide](backlinks/agent-guide.md) for checks and CSV import.

- Run the loopback dashboard with `npm run backlinks:ui` or preview weekly checks with `npm run backlinks -- weekly --dry-run`.

## Current Priorities

- Keep the screenshot crawler generic and reliable.
- Register active sites through config rather than crawler code.
- Preserve a stable CLI contract for future Codex skill integration.
- Keep Obsidian publishing dry-run-first and limited to explicit public-ready source notes.

## Known Risks

- Screenshot output can grow quickly; generated screenshots stay ignored by default.
- Visual diff is intentionally out of scope until baseline capture is stable.
- Some future sites may need custom auth or route filtering; keep the first version public-page only.
- Obsidian contains private daily and project material; publishing tools must not scan broad vault folders by default.
- External publishing credentials must stay outside checked-in files.

- SERP results are approximate; Bright Data checks consume quota. Use the manual provider to export pending queries.

- The dashboard listens on 127.0.0.1. Dashboard and weekly data writes use the same file lock.
