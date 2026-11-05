import assert from "node:assert/strict";
import { test } from "node:test";
import { pacing, pacingNote } from "../../scripts/backlinks/pacing.js";
import type { Site, Submission } from "../../scripts/backlinks/types.js";

const now = new Date(2026, 10, 3, 12);
const site: Site = { id: "fixture", name: "Fixture", baseUrl: "https://fixture.test" };
const day = 86_400_000;
function submitted(age: number): Submission {
  const at = new Date(+now - age).toISOString();
  return {
    id: "fixture--test--1", siteId: site.id, platformId: "test", targetUrl: site.baseUrl, status: "submitted",
    submittedAt: at, createdAt: at, updatedAt: at, history: [{ from: null, to: "submitted", at }],
  };
}
test("pause is exclusive of the configured day; planned is exempt", () => {
  const paused = { ...site, backlinks: { pausedUntil: "2026-11-04" } };
  assert.throws(() => pacingNote(paused, [], now, "submitted", false), /paused until.*remaining: unlimited/);
  assert.equal(pacingNote(paused, [], now, "planned", false), undefined);
  assert.deepEqual(pacing({ ...site, backlinks: { pausedUntil: "2026-11-03" } }, [], now).reasons, []);
});
test("rolling quota excludes exact 7 days, future submissions and other sites", () => {
  const limited = { ...site, backlinks: { maxNewPerWeek: 1 } };
  const rows = [submitted(7 * day), submitted(-1), { ...submitted(day), siteId: "other" }];
  assert.equal(pacing(limited, rows, now).remaining, 1);
  rows.push(submitted(7 * day - 1));
  assert.throws(() => pacingNote(limited, rows, now, "submitted", false), /weekly limit reached.*remaining: 0/);
});
test("force always requires a note and records the reason", () => {
  const disabled = { ...site, backlinks: { enabled: false } };
  assert.throws(() => pacingNote(disabled, [], now, "submitted", false), /disabled/);
  assert.throws(() => pacingNote(disabled, [], now, "submitted", true), /--force requires --note/);
  assert.equal(pacingNote(disabled, [], now, "submitted", true, "user approved"), "forced: backlinks disabled; user approved");
});
