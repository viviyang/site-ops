import assert from "node:assert/strict";
import test from "node:test";
import { buildReport } from "../../scripts/backlinks/report.js";
import type { Platform, Site, Submission } from "../../scripts/backlinks/types.js";

test("report distinguishes one SERP miss from repeated misses and labels restricted links", () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const at = now.toISOString();
  const site: Site = {
    id: "fixture-site",
    name: "Fixture site",
    baseUrl: "https://fixture-site.invalid",
    backlinks: { maxNewPerWeek: 4 },
  };
  const platform: Platform = {
    id: "fixture",
    name: "Fixture | Directory",
    type: "directory",
    createdAt: at,
  };
  const submission: Submission = {
    id: "fixture-site--fixture--1",
    siteId: site.id,
    platformId: platform.id,
    targetUrl: site.baseUrl,
    backlinkUrl: "https://fixture-platform.invalid/list",
    status: "live",
    submittedAt: at,
    createdAt: at,
    updatedAt: at,
    lastLiveCheck: {
      at, result: "found", consecutive: 1, restricted: true,
    },
    lastIndexCheck: {
      backlink_page: { at, result: "not_found", consecutive: 1, url: "https://fixture-platform.invalid/list" },
      target_page: { at, result: "not_found", consecutive: 2, url: site.baseUrl },
    },
    history: [{ at, from: "submitted", to: "live", note: "auto: live check" }],
  };

  const markdown = buildReport([site], [platform], [submission], now);
  assert.match(markdown, /过去 7 天新增 \/ 上限：1 \/ 4/);
  assert.match(markdown, /nofollow（含 ugc\/sponsored）：1/);
  assert.match(markdown, /submitted → live · auto: live check/);
  assert.ok(markdown.includes("Fixture \\| Directory"));
  assert.ok(markdown.includes("| 待确认 | 未收录 |"));
});
