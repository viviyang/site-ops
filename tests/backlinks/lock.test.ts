import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { add } from "../../scripts/backlinks/commands/add.js";
import { Store, withStoreWrite } from "../../scripts/backlinks/store.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.resolve("node_modules", ".backlinks-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "sites"));
  await mkdir(path.join(root, "backlinks"));
  await writeFile(path.join(root, "sites", "fixture.json"), JSON.stringify({
    id: "fixture", name: "Fixture", baseUrl: "https://fixture.invalid",
  }));
  await writeFile(path.join(root, "backlinks", "platforms.json"), JSON.stringify([
    { id: "directory", name: "Fixture", type: "directory", createdAt: "2026-11-03T00:00:00Z" },
  ]));
  return root;
}

test("parallel additions allocate different IDs from fresh locked snapshots", async t => {
  const root = await fixture(t);
  await Promise.all(["one", "two"].map(page => withStoreWrite(root, store => add({
    store, args: [], now: new Date(), dryRun: false,
    flags: { site: "fixture", platform: "directory", "target-url": "https://fixture.invalid/" + page },
  }))));
  assert.deepEqual((await Store.open(root)).submissions.map(row => row.id), ["fixture--directory--1", "fixture--directory--2"]);
});

test("stale lock is reclaimed and a failed operation releases its lock", async t => {
  const root = await fixture(t);
  const lock = path.join(root, "backlinks", ".lock");
  const old = new Date(Date.now() - 301_000);
  await writeFile(lock, JSON.stringify({ pid: 0, at: old.toISOString() }));
  await utimes(lock, old, old);
  await assert.rejects(withStoreWrite(root, async () => { throw new Error("fixture error"); }), /fixture error/);
  await assert.rejects(access(lock), { code: "ENOENT" });
});
