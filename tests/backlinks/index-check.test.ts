import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBrightDataProvider, parseSerp } from "../../scripts/backlinks/index-check/brightdata.js";
import { readManualResults } from "../../scripts/backlinks/index-check/manual.js";
import {
  applyIndexChecks, indexQuery, normalizeIndexUrl, selectIndexItems,
} from "../../scripts/backlinks/index-check/provider.js";
import type { IndexCheck, Submission } from "../../scripts/backlinks/types.js";

const targetUrl = "https://example.invalid/page?key=one";
const now = new Date("2026-11-03T00:00:00.000Z");
const submission: Submission = {
  id: "example-site--example-platform--1",
  siteId: "example-site",
  platformId: "example-platform",
  targetUrl,
  status: "submitted",
  history: [{ at: now.toISOString(), from: null, to: "submitted" }],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

async function fixture(name: string) {
  return JSON.parse(await readFile(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
}

test("normalization ignores www, host case, trailing slash and fragment, preserving protocol and query", () => {
  assert.equal(normalizeIndexUrl("https://WWW.EXAMPLE.INVALID/page/?key=one#section"), targetUrl);
  assert.notEqual(normalizeIndexUrl("http://example.invalid/page?key=one"), targetUrl);
  assert.notEqual(normalizeIndexUrl("https://example.invalid/page?key=two"), targetUrl);
  assert.equal(indexQuery(targetUrl), "site:example.invalid/page?key=one");
  assert.throws(() => normalizeIndexUrl("ftp://example.invalid/page"), /HTTP/);
});

test("SERP parser distinguishes match, organic miss, missing fields, and malformed rows", async () => {
  assert.equal(parseSerp(await fixture("serp-match"), targetUrl).result, "indexed");
  assert.equal(parseSerp(await fixture("serp-no-match"), targetUrl).result, "not_found");
  assert.equal(parseSerp(await fixture("serp-missing"), targetUrl).result, "unknown");
  assert.equal(parseSerp({ organic: [] }, targetUrl).result, "not_found");
  assert.equal(parseSerp({ organic: [{ title: "Invalid row" }] }, targetUrl).result, "unknown");
  assert.equal(parseSerp({ organic: [], captcha: true }, targetUrl).result, "unknown");
});

test("Bright Data provider encodes the expected POST request using injected fetch", async () => {
  const data = await fixture("serp-match");
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json(data);
  };
  const provider = createBrightDataProvider({
    BRIGHT_DATA_API_TOKEN: "fixture-token",
    BRIGHT_DATA_SERP_ZONE: "fixture-zone",
  }, fetchImpl);
  assert.deepEqual(await provider.check(targetUrl), { query: indexQuery(targetUrl), result: "indexed" });
  assert.equal(calls.length, 1);
  const [{ input, init }] = calls;
  assert.equal(input, "https://api.brightdata.com/request");
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    zone: "fixture-zone",
    url: "https://www.google.com/search?q=site%3Aexample.invalid%2Fpage%3Fkey%3Done&brd_json=1",
    format: "raw",
  });
  assert.throws(() => createBrightDataProvider({}, fetchImpl), /--provider manual/);
});

test("Bright Data HTTP and JSON failures are unknown", async () => {
  const env = { BRIGHT_DATA_API_TOKEN: "fixture-token", BRIGHT_DATA_SERP_ZONE: "fixture-zone" };
  const blocked = createBrightDataProvider(env, async () => new Response("", { status: 429 }));
  const malformed = createBrightDataProvider(env, async () => new Response("<html>captcha</html>"));
  assert.match((await blocked.check(targetUrl)).reason ?? "", /HTTP 429/);
  const outcome = await malformed.check(targetUrl);
  assert.equal(outcome.result, "unknown");
  assert.match(outcome.reason ?? "", /parse/);
});

function indexCheck(at: string, result: IndexCheck["result"] = "not_found"): IndexCheck {
  return {
    kind: "index",
    submissionId: submission.id,
    at,
    url: targetUrl,
    target: "target_page",
    query: indexQuery(targetUrl),
    provider: "manual",
    result,
  };
}

test("7-day skip uses the normalized URL and last conclusive history entry", () => {
  const recent = { ...indexCheck("2026-10-27T00:00:00.001Z"), url: "https://www.example.invalid/page/?key=one#old" };
  const unknown = indexCheck("2026-11-02T00:00:00.000Z", "unknown");
  const boundary = indexCheck("2026-10-27T00:00:00.000Z");
  assert.equal(selectIndexItems([submission], [recent, unknown], now, "target_page").items.length, 0);
  assert.equal(selectIndexItems([submission], [boundary, unknown], now, "target_page").items.length, 1);
  assert.equal(selectIndexItems([submission], [recent, unknown], now, "target_page", true).items.length, 1);
  assert.equal(selectIndexItems([submission], [], now, "both").skipped[0].target, "backlink_page");
});

test("manual import validates each row, including stale URLs and duplicate targets", () => {
  const valid = indexCheck(now.toISOString());
  const { checks, errors } = readManualResults({
    items: [
      valid,
      { ...valid, submissionId: "unknown--platform--1" },
      { ...valid, result: "maybe" },
      { ...valid, url: "https://example.invalid/old" },
      { ...valid, target: "backlink_page" },
      { ...valid, query: "site:example.invalid/old" },
      valid,
      { ...valid, reason: true },
    ],
  }, [submission], now);
  assert.equal(checks.length, 1);
  assert.deepEqual(errors.map(error => error.row), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(checks[0].result, "not_found");
  assert.equal(checks[0].provider, "manual");
  assert.throws(() => readManualResults([], [submission], now), /items array/);
});

test("index summary tracks consecutive results separately by target and URL", () => {
  const first = indexCheck(now.toISOString());
  const second = indexCheck("2026-11-10T00:00:00.000Z");
  const unknown = indexCheck("2026-11-17T00:00:00.000Z", "unknown");
  const third = indexCheck("2026-11-24T00:00:00.000Z");
  const backlink = { ...first, target: "backlink_page" as const, url: "https://example-directory.invalid/listing" };
  const prior = applyIndexChecks([submission], [first, second, backlink]);
  assert.equal(prior[0].lastIndexCheck?.target_page?.consecutive, 2);
  assert.equal(prior[0].lastIndexCheck?.backlink_page?.consecutive, 1);
  const after = applyIndexChecks(prior, [unknown, third]);
  assert.equal(after[0].lastIndexCheck?.target_page?.consecutive, 1);
  assert.equal(after[0].lastIndexCheck?.target_page?.at, third.at);
  const changed = applyIndexChecks(prior, [{ ...third, url: "https://example.invalid/changed" }]);
  assert.equal(changed[0].lastIndexCheck?.target_page?.consecutive, 1);
});
