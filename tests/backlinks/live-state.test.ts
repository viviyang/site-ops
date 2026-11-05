import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveCheck } from "../../scripts/backlinks/commands/live.js";
import type { LiveCheck, Submission } from "../../scripts/backlinks/types.js";

const initialAt = "2026-11-01T00:00:00.000Z";
const initial: Submission = {
  id: "fixture--directory--1",
  siteId: "fixture",
  platformId: "directory",
  targetUrl: "https://target.example/page",
  backlinkUrl: "https://directory.example/listing",
  status: "submitted",
  history: [{ at: initialAt, from: null, to: "submitted" }],
  createdAt: initialAt,
  updatedAt: initialAt,
};

function check(submission: Submission, result: LiveCheck["result"], day: number) {
  return applyLiveCheck(submission, {
    kind: "live",
    submissionId: initial.id,
    at: `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    url: initial.backlinkUrl!,
    method: "fetch",
    result,
    links: result === "found" ? [{ href: initial.targetUrl, rel: ["ugc"], anchorText: "Target" }] : [],
    reason: result === "unknown" ? "Fixture timeout" : undefined,
  });
}

test("promotes submitted and pending submissions, marks lost on two misses, then restores on found", () => {
  const live = check(initial, "found", 2);
  assert.equal(live.status, "live");
  assert.equal(live.liveAt, "2026-11-02T00:00:00.000Z");
  assert.equal(live.lastLiveCheck?.restricted, true);
  assert.deepEqual(live.history.at(-1), {
    at: live.liveAt, from: "submitted", to: "live", note: "auto: live check",
  });
  assert.equal(check({ ...initial, status: "pending_review" }, "found", 2).status, "live");

  const firstMiss = check(live, "missing", 3);
  assert.equal(firstMiss.status, "live");
  assert.equal(firstMiss.history.length, live.history.length);
  const lost = check(firstMiss, "missing", 4);
  assert.equal(lost.status, "lost");
  assert.equal(lost.lastLiveCheck?.consecutive, 2);
  assert.equal(lost.history.at(-1)?.note, "auto: live check");

  const restored = check(lost, "found", 5);
  assert.equal(restored.status, "live");
  assert.equal(restored.liveAt, "2026-11-05T00:00:00.000Z");
  assert.equal(restored.history.at(-1)?.from, "lost");
});

test("unknown preserves status and breaks the streak of missing links", () => {
  const live = check(initial, "found", 2);
  const firstMiss = check(live, "missing", 3);
  const uncertain = check(firstMiss, "unknown", 4);
  assert.equal(uncertain.status, "live");
  assert.equal(uncertain.history.length, live.history.length);

  const nextMiss = check(uncertain, "missing", 5);
  assert.equal(nextMiss.status, "live");
  assert.equal(nextMiss.lastLiveCheck?.consecutive, 1);
});
