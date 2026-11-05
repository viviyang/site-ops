import assert from "node:assert/strict";
import test from "node:test";
import { buildDue } from "../../scripts/backlinks/due.js";
import type { Platform, Site, Submission } from "../../scripts/backlinks/types.js";

const now = new Date(2026, 10, 3, 12);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const site: Site = {
  id: "fixture-site",
  name: "Fixture site",
  baseUrl: "https://fixture-site.invalid",
  backlinks: { enabled: true, maxNewPerWeek: 2 },
};
const platform: Platform = {
  id: "fixture-directory",
  name: "Fixture directory",
  type: "directory",
  reviewDays: 2,
  createdAt: daysAgo(50),
};

function submission(id: string, status: Submission["status"], overrides: Partial<Submission> = {}): Submission {
  return {
    id,
    status,
    siteId: site.id,
    platformId: platform.id,
    targetUrl: `${site.baseUrl}/${id}`,
    backlinkUrl: `https://fixture-directory.invalid/${id}`,
    createdAt: daysAgo(50),
    updatedAt: daysAgo(4),
    history: [{ at: daysAgo(50), from: null, to: status }],
    ...overrides,
  };
}

function results(...records: Submission[]) {
  return buildDue([site], [platform], records, now);
}

test("review deadline uses platform days and a strict calendar boundary", () => {
  const result = results(
    submission("recent", "pending_review", { submittedAt: daysAgo(2) }),
    submission("overdue", "submitted", { submittedAt: daysAgo(4) }),
    submission("oldest", "pending_review", { submittedAt: daysAgo(6) }),
    submission("rejected", "rejected", { submittedAt: daysAgo(8) }),
  );
  assert.deepEqual(result.reviewOverdue.map((item) => item.submissionId), ["oldest", "overdue"]);
});

test("only lost records enter the lost category", () => {
  const result = results(submission("lost", "lost"), submission("abandoned", "abandoned"));
  assert.deepEqual(result.lost.map((item) => item.submissionId), ["lost"]);
});

test("missing backlink URLs surface for live and submitted records after seven days", () => {
  const result = results(
    submission("live", "live", { backlinkUrl: undefined }),
    submission("late", "submitted", { backlinkUrl: undefined, submittedAt: daysAgo(8) }),
    submission("boundary", "submitted", { backlinkUrl: undefined, submittedAt: daysAgo(7) }),
    submission("pending", "pending_review", { backlinkUrl: undefined, submittedAt: daysAgo(8) }),
    submission("known", "live"),
  );
  assert.deepEqual(result.missingBacklinkUrl.map((item) => item.submissionId), ["live", "late"]);
});

test("live checks due after 30 days, immediately after unknown, or when never checked", () => {
  const result = results(
    submission("never", "live"),
    submission("stale", "live", { lastLiveCheck: { at: daysAgo(31), result: "found", consecutive: 1 } }),
    submission("recent", "live", { lastLiveCheck: { at: daysAgo(30), result: "found", consecutive: 1 } }),
    submission("unknown", "live", { lastLiveCheck: { at: daysAgo(1), result: "unknown", consecutive: 1 } }),
    submission("lost", "lost", { lastLiveCheck: { at: daysAgo(1), result: "unknown", consecutive: 1 } }),
  );
  assert.deepEqual(result.liveCheckDue.map((item) => item.submissionId), ["never", "stale", "unknown"]);
});

test("index due is evaluated for each URL and excludes indexed and recent results", () => {
  const result = results(
    submission("stale", "live", {
      lastIndexCheck: {
        backlink_page: { at: daysAgo(10), result: "not_found", consecutive: 1, url: "https://fixture-directory.invalid/stale" },
        target_page: { at: daysAgo(10), result: "indexed", consecutive: 1, url: site.baseUrl },
      },
    }),
    submission("recent", "live", {
      lastIndexCheck: {
        backlink_page: { at: daysAgo(7), result: "unknown", consecutive: 1, url: "https://fixture-directory.invalid/recent" },
        target_page: { at: daysAgo(1), result: "indexed", consecutive: 1, url: site.baseUrl },
      },
    }),
    submission("planned", "planned"),
  );
  assert.deepEqual(result.indexCheckDue.map(({ submissionId, targets }) => [submissionId, targets]), [
    ["stale", ["backlink_page"]],
  ]);
});

test("planned records include remaining pacing quota", () => {
  const result = results(
    submission("planned", "planned"),
    submission("submitted", "submitted", { submittedAt: daysAgo(1) }),
  );
  assert.deepEqual(result.planned.map(({ submissionId, remaining }) => [submissionId, remaining]), [["planned", 1]]);
});
