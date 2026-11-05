import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allLinksRestricted, inspectPage, runLiveChecks } from "../../scripts/backlinks/live-check.js";

const siteUrl = "https://target.example";
const url = "https://directory.example/listing";
const task = { url, siteUrl, submissionId: "fixture--directory--1" };
const now = () => new Date("2026-11-03T00:00:00.000Z");

async function fixture(name: string) {
  return readFile(new URL(`./fixtures/live-${name}.html`, import.meta.url), "utf8");
}

async function inspect(name: string, status = 200) {
  return inspectPage({ html: await fixture(name), status, url }, siteUrl);
}

test("extracts dofollow links and trims anchors", async () => {
  assert.deepEqual(await inspect("follow"), {
    result: "found",
    links: [{ href: "https://target.example/page", rel: [], anchorText: "Example page" }],
  });
});

test("matches domains ignoring www and splits nofollow + ugc", async () => {
  const parsed = await inspect("restricted");
  assert.equal(parsed.result, "found");
  assert.deepEqual(parsed.links, [{
    href: "https://www.target.example/page",
    rel: ["nofollow", "ugc"],
    anchorText: "Example page",
  }]);
  assert.equal(allLinksRestricted({
    kind: "live", submissionId: task.submissionId, at: now().toISOString(), url, method: "fetch", ...parsed,
  }), true);
});

test("resolves relative href using the document base", async () => {
  const parsed = await inspect("relative");
  assert.equal(parsed.result, "found");
  assert.equal(parsed.links[0].href, "https://target.example/page?ref=fixture");
});

test("marks an HTTP 200 page with enough content and no links as missing", async () => {
  assert.deepEqual(await inspect("missing"), { result: "missing", links: [] });
});

test("keeps found links on short pages that embed a captcha form", async () => {
  const parsed = await inspect("recaptcha-form");
  assert.equal(parsed.result, "found");
  assert.equal(parsed.links[0].href, "https://target.example/page");
});

test("classifies challenge pages, JS shells and unsuccessful HTTP as unknown", async () => {
  for (const name of ["challenge", "shell"]) {
    const parsed = await inspect(name);
    assert.equal(parsed.result, "unknown");
    assert.ok(parsed.reason);
  }
  for (const status of [403, 404, 429, 500]) {
    assert.deepEqual(await inspect("follow", status), { result: "unknown", links: [], reason: `HTTP ${status}` });
  }
});

test("uses the browser only for unknown results and waits between same-host attempts", async () => {
  const calls: string[] = [];
  const [first, second] = await runLiveChecks([task, { ...task, submissionId: "fixture--directory--2" }], {
    browser: true,
    now,
    fetch: async (input, init) => {
      assert.equal(input, url);
      assert.equal(init?.redirect, "follow");
      assert.ok(init?.signal);
      calls.push("fetch");
      return new Response(await fixture(calls.length === 1 ? "shell" : "missing"));
    },
    wait: async (milliseconds) => { calls.push(`wait ${milliseconds}`); },
    loadBrowser: async (address) => {
      assert.equal(address, url);
      calls.push("browser");
      return { url, status: 200, html: await fixture("follow") };
    },
  });
  assert.deepEqual(calls, ["fetch", "wait 2000", "browser", "wait 2000", "fetch"]);
  assert.equal(first.method, "browser");
  assert.equal(first.result, "found");
  assert.equal(second.method, "fetch");
  assert.equal(second.result, "missing");
});

test("limits distinct host concurrency to four and preserves task order", async () => {
  let concurrent = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    ...task,
    url: `https://directory-${index}.example/listing`,
    submissionId: `fixture--directory--${index + 1}`,
  }));
  const checks = await runLiveChecks(tasks, {
    fetch: async () => {
      peak = Math.max(peak, ++concurrent);
      await new Promise<void>((resolve) => setImmediate(resolve));
      concurrent -= 1;
      throw new Error("fixture network error");
    },
    now,
  });
  assert.equal(peak, 4);
  assert.deepEqual(checks.map((check) => check.submissionId), tasks.map((entry) => entry.submissionId));
  assert.ok(checks.every((check) => check.result === "unknown" && check.reason === "fixture network error"));
});
