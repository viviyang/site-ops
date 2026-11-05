import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { weekly } from "../../scripts/backlinks/commands/weekly.js";
import { Store } from "../../scripts/backlinks/store.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.resolve("node_modules", ".backlinks-weekly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const at = new Date().toISOString();
  await mkdir(path.join(root, "sites"));
  await mkdir(path.join(root, "backlinks"));
  await writeFile(path.join(root, "sites", "fixture.json"), JSON.stringify({ id: "fixture", name: "Fixture", baseUrl: "https://fixture.invalid" }));
  await writeFile(path.join(root, "backlinks", "platforms.json"), JSON.stringify([{ id: "directory", name: "Directory", type: "directory", createdAt: at }]));
  const store = await Store.open(root);
  await store.save({ submissions: [{ id: "fixture--directory--1", siteId: "fixture", platformId: "directory", status: "submitted",
    targetUrl: "https://fixture.invalid/page", backlinkUrl: "https://directory.invalid/page",
    createdAt: at, updatedAt: at, history: [{ from: null, to: "submitted", at }] }] });
  return { store, now: new Date(), flags: { site: "fixture" }, args: [], dryRun: false };
}

test("weekly CLI dry run and offline manual run generate the expected outputs", async t => {
  const ctx = await fixture(t);
  const logfile = path.join(ctx.store.root, "backlinks", "runs.jsonl");
  const preview = execFileSync(process.execPath, ["--import", "tsx", "scripts/backlinks.ts", "weekly", "--site", "fixture", "--dry-run", "--json"],
    { env: { ...process.env, SITE_OPS_ROOT: ctx.store.root }, encoding: "utf8" });
  assert.equal(JSON.parse(preview).dryRun, true);
  await assert.rejects(access(logfile), { code: "ENOENT" });
  await assert.rejects(access(path.join(ctx.store.root, "reports")), { code: "ENOENT" });
  t.diagnostic("weekly --dry-run " + preview.trim());
  const result = await weekly(ctx, {
    live: { fetch: async () => new Response('<a href="https://fixture.invalid/page">fixture</a>'),
      loadBrowser: async () => { throw new Error("Unexpected browser fallback"); } },
    createProvider: () => { throw new Error("Unexpected paid provider"); },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.files.length, 3);
  assert.equal((await Store.open(ctx.store.root)).submissions[0].status, "live");
  assert.equal(JSON.parse(await readFile(result.files[0], "utf8")).items.length, 2);
  const line = (await readFile(logfile, "utf8")).trimEnd().split("\n").at(-1)!;
  assert.deepEqual(JSON.parse(line), JSON.parse(JSON.stringify(result)));
  t.diagnostic("runs.jsonl " + line);
});

test("weekly selects configured provider and continues after live and provider failures", async t => {
  const ctx = await fixture(t);
  await writeFile(path.join(ctx.store.root, ".env.local"), "BRIGHT_DATA_API_TOKEN=fixture\nBRIGHT_DATA_SERP_ZONE=fixture\n");
  let calls = 0;
  const result = await weekly(ctx, {
    live: { fetch: async () => new Response("", { status: 403 }), loadBrowser: async () => { throw new Error("fixture blocked"); }, wait: async () => {} },
    createProvider: env => {
      calls++;
      assert.equal(env?.BRIGHT_DATA_API_TOKEN, "fixture");
      return { name: "brightdata", check: async () => { throw new Error("fixture provider failure"); } };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.steps.map(step => step.exitCode), [2, 1, 0, 0]);
  assert.equal(result.exitCode, 2);
  await Promise.all(result.files.map(file => access(file)));
  const log = await readFile(path.join(ctx.store.root, "backlinks", "runs.jsonl"), "utf8");
  assert.equal(JSON.parse(log).exitCode, 2);
});
