import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createDashboard } from "../../scripts/backlinks/ui/server.js";

test("dashboard GET routes, form writes, pacing, Origin and HTML escaping", async t => {
  const root = await mkdtemp(path.resolve("node_modules", ".backlinks-ui-"));
  const siteFile = path.join(root, "sites", "fixture.json");
  const site = '{ "id":"fixture", "name":"Fixture", "baseUrl":"https://fixture.invalid", "custom": [1,{"backlinks": 2}], "backlinks": {"maxNewPerWeek":1} }\n';
  await mkdir(path.join(root, "sites"));
  await mkdir(path.join(root, "backlinks"));
  await writeFile(siteFile, site);
  await writeFile(path.join(root, "backlinks", "platforms.json"), "[]");
  const server = createDashboard(root);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  const post = (route: string, fields: Record<string, string>, headers: Record<string, string> = { origin: base }) =>
    fetch(base + route, { method: "POST", body: new URLSearchParams(fields), headers, redirect: "manual" });

  const platform = await post("/platforms", { id: "directory", name: "Directory", type: "directory", url: "https://directory.invalid" });
  assert.equal(platform.status, 303);
  assert.equal((await post("/platforms/directory", { name: "Updated", type: "directory" })).status, 303);
  const values = { site: "fixture", platform: "directory", "target-url": "https://fixture.invalid/one", notes: "<script>alert(1)</script>" };
  assert.equal((await post("/submissions/new", values, {})).status, 403);
  assert.equal((await post("/submissions/new", values, { origin: "https://wrong.invalid", referer: base })).status, 403);
  assert.equal((await post("/submissions/new", { notes: "a".repeat(65536) })).status, 413);
  const created = await post("/submissions/new", values, { referer: base + "/submissions/new" });
  assert.equal(created.status, 303);
  const location = created.headers.get("location")!;
  const rejected = await post("/submissions/new", { ...values, "target-url": "https://fixture.invalid/two", force: "true" });
  assert.equal(rejected.status, 400);
  const error = await rejected.text();
  assert.match(error, /weekly limit reached.*remaining: 0/);
  assert.match(error, /fixture.invalid\/two/);
  assert.equal((await post(location, { status: "live", "backlink-url": "https://directory.invalid/listing", note: "verified" })).status, 303);

  assert.equal((await post("/sites/fixture", { enabled: "on", maxNewPerWeek: "2" })).status, 303);
  assert.equal(await readFile(siteFile, "utf8"), site.replace('{"maxNewPerWeek":1}', '{"maxNewPerWeek":2,"enabled":true}'));
  for (const route of ["/", "/submissions", "/submissions?site=fixture&status=live&platform=directory", location, "/submissions/new", "/platforms", "/platforms/directory", "/sites", "/sites/fixture", "/runs"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    const body = await response.text();
    if (route === location) {
      assert.match(body, /&lt;script&gt;/);
      assert.doesNotMatch(body, /<script>/);
    }
    t.diagnostic("GET " + route + " " + response.status);
  }
  const show = execFileSync(process.execPath, ["--import", "tsx", "scripts/backlinks.ts", "show", "fixture--directory--1", "--json"],
    { encoding: "utf8", env: { ...process.env, SITE_OPS_ROOT: root } });
  assert.deepEqual(JSON.parse(show).submission.history.map(({ from, to }: { from: string; to: string }) => [from, to]), [[null, "submitted"], ["submitted", "live"]]);
  t.diagnostic("POST add/update 303/303; show --json " + show.trim());
});
