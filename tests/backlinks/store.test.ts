import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { Store, validateData } from "../../scripts/backlinks/store.js";
import type { Platform, Site, Submission } from "../../scripts/backlinks/types.js";

const at = "2026-11-03T00:00:00Z";
const site: Site = { id: "fixture", name: "Fixture", baseUrl: "https://fixture.test" };
const platform: Platform = { id: "directory", name: "Fixture Directory", type: "directory", createdAt: at };
const submission: Submission = {
  id: "fixture--directory--1", siteId: site.id, platformId: platform.id, targetUrl: "https://www.fixture.test/",
  status: "submitted", history: [{ at, from: null, to: "submitted" }], createdAt: at, updatedAt: at,
};
const sites = new Map([[site.id, site]]);
for (const [name, patch, message] of [
  ["id", { id: "bad" }, /Invalid submission id/],
  ["site", { siteId: "missing" }, /Unknown site/],
  ["platform", { platformId: "missing" }, /Unknown platform/],
  ["protocol", { targetUrl: "ftp://fixture.test" }, /HTTP/],
  ["host", { targetUrl: "https://other.test" }, /must belong/],
  ["live URL", { status: "live" }, /requires backlinkUrl/],
  ["timestamp", { submittedAt: "2026-02-30T00:00:00Z" }, /timestamp/],
] as const) {
  test("rejects invalid " + name, () => assert.throws(() => validateData(sites, [platform], [{ ...submission, ...patch }]), message));
}
test("rejects duplicate IDs and active tuple, permits rejected history", () => {
  assert.throws(() => validateData(sites, [platform, platform], []), /Duplicate platform id/);
  assert.throws(() => validateData(sites, [platform], [submission, submission]), /Duplicate submission id/);
  const duplicate = { ...submission, id: "fixture--directory--2" };
  assert.throws(() => validateData(sites, [platform], [submission, duplicate]), /Duplicate active submission: fixture--directory--1/);
  validateData(sites, [platform], [submission, { ...duplicate, status: "rejected", history: [{ at, from: null, to: "rejected" }] }]);
});
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.resolve("node_modules", ".store-test-"));
  const write = async (relative: string, data: unknown) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  };
  t.after(async () => {
    async function clean(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await clean(file);
        else await unlink(file);
      }
      await rmdir(dir);
    }
    await clean(root);
  });
  await write("sites/fixture.json", site);
  await write("backlinks/platforms.json", []);
  return root;
}
test("injected root, atomic sorted JSON, dry run and append-only log", async t => {
  const root = await fixture(t);
  const oldRoot = process.env.SITE_OPS_ROOT;
  process.env.SITE_OPS_ROOT = root;
  t.after(() => { if (oldRoot === undefined) delete process.env.SITE_OPS_ROOT; else process.env.SITE_OPS_ROOT = oldRoot; });
  const store = await Store.open();
  const file = path.join(root, "backlinks", "platforms.json");
  const platforms = [platform, { ...platform, id: "alpha" }];
  await store.save({ platforms, submissions: [submission] }, true);
  assert.equal(await readFile(file, "utf8"), "[]");
  await assert.rejects(store.save({ platforms, submissions: [{ ...submission, status: "live" }] }), /requires backlinkUrl/);
  assert.equal(await readFile(file, "utf8"), "[]");
  await store.save({ platforms, submissions: [submission] });
  assert.equal(await readFile(file, "utf8"), JSON.stringify([...platforms].reverse(), null, 2) + "\n");
  assert.deepEqual((await readdir(path.dirname(file))).sort(), ["platforms.json", "submissions"]);
  const c = { kind: "live", submissionId: submission.id, at, url: "https://backlink.test", method: "fetch", result: "missing", links: [] } as const;
  const check = { ...c, links: [] };
  await store.save({ checks: [check] });
  const next = { ...check, at: "2026-11-04T00:00:00Z" };
  await store.save({ checks: [next] });
  assert.equal(await readFile(path.join(root, "backlinks", "checks", "fixture.jsonl"), "utf8"),
    JSON.stringify(check) + "\n" + JSON.stringify(next) + "\n");
  assert.deepEqual((await Store.open()).select({ id: submission.id }), [submission]);
});
