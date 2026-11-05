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

## Obsidian Publishing

The publishing pipeline reads public-ready notes from the Obsidian vault and prepares `weiwei-blog` MDX drafts.

Default dry-run:

```bash
npm run publish:obsidian
```

Generate site MDX drafts:

```bash
npm run publish:obsidian -- --write
```

Publish eligible Chinese notes to WeChat:

```bash
npm run publish:obsidian -- --write --wechat-publish
```

The default source is:

```text
C:\Users\Admin\Documents\Obsidian Vault\20-Content
```

The default site target is:

```text
C:\Users\Admin\Documents\viviyang_github\weiwei-blog
```

Only notes with explicit public-ready frontmatter are eligible:

```yaml
---
title: "How I use Obsidian as a publishing pipeline"
description: "A technical note on turning Obsidian drafts into website and newsletter-ready content."
date: "2026-05-13"
slug: "obsidian-publishing-pipeline"
visibility: "public"
status: "ready"
type: "technical-article"
locale: "zh"
topic: "ai-engineering"
tags: ["obsidian", "publishing", "workflow"]
targets:
  site: "draft"
  wechat: "publish"
  devto: "draft"
  medium: "manual"
cover:
  path: "covers/obsidian-publishing-pipeline.jpg"
---
```

Local WeChat credentials are read from `.env.local`, which is ignored by git:

```text
WECHAT_APP_ID=your_app_id
WECHAT_APP_SECRET=your_app_secret
WECHAT_AUTHOR=Weiwei Yang
WECHAT_DEFAULT_COVER_PATH=C:\path\to\default-cover.jpg
WECHAT_DEFAULT_THUMB_MEDIA_ID=
WEIWEI_SITE_BASE_URL=https://yangweiwei.dev
```

You can either set `cover.path` per article or configure `WECHAT_DEFAULT_COVER_PATH`. If you already uploaded a reusable cover to WeChat, set `WECHAT_DEFAULT_THUMB_MEDIA_ID` to skip uploading the cover each run.

MVP behavior:

- scans only the configured public source directory
- skips notes that are not `visibility: public` and `status: ready`
- maps `technical-article` to `weiwei-blog/content/blog/<slug>.mdx`
- maps `journal` and `weekly-update` to `weiwei-blog/content/journal/<slug>.mdx`
- generates site drafts with `published: false`
- publishes to WeChat only when both the note has `targets.wechat: "publish"` and the command includes `--wechat-publish`
- defers dev.to and Medium actions
- refuses to overwrite existing site files unless `--overwrite` is passed

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

## Backlinks

外链跟踪模块复用 `sites/*.json`，把平台、提交和检查日志保存在 `backlinks/`。新增提交前可在站点配置中设置 `backlinks.enabled`、`maxNewPerWeek` 和 `pausedUntil`。

```powershell
npm run backlinks -- validate
npm run backlinks -- list --site SITE_ID
npm run backlinks -- add --site SITE_ID --platform PLATFORM_ID --target-url TARGET_URL --by human
npm run backlinks -- due
npm run backlinks -- report
```

先用 `platform add` 登记真实平台。详见 [Agent 指南](docs/backlinks/agent-guide.md)、[计划书](docs/backlinks/plan.md)和[实施规格](docs/backlinks/implementation-plan.md)。

### 本地看板与每周检查

运行 `npm run backlinks:ui`，打开 `http://127.0.0.1:4310`。用 `npm run backlinks:ui -- --port 4311` 更换端口。

```powershell
npm run backlinks -- weekly --dry-run
npm run backlinks -- weekly
```

`weekly` 依次检查存活、处理收录、生成报表和 `latest-due.md`。可加 `--site SITE_ID`。在 `.env.local` 中填齐两项 Bright Data 配置会启用付费收录检查，否则导出待查清单。运行结果可在看板的「运行记录」查看。

在 Windows 上可为当前登录用户注册每周任务，默认周一 09:00，日志追加到 `reports/backlinks/weekly.log`。使用本机时间，任务以当前用户交互式登录身份运行。

```powershell
.\scripts\backlinks\register-weekly-task.ps1
.\scripts\backlinks\register-weekly-task.ps1 -Day Wednesday -Time 10:30
.\scripts\backlinks\register-weekly-task.ps1 -Unregister
```

第二条是自定义时间的注册示例。已有任务时，先取消注册再用新时间注册。
