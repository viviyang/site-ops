import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { importCsv } from "../../scripts/backlinks/commands/import-csv.js";
import { parseCsv, readCsvRows } from "../../scripts/backlinks/csv.js";
import { Store } from "../../scripts/backlinks/store.js";

const header = "site,platform,target_url,status,backlink_url,anchor,submitted_at,submitted_by,notes";
const now = new Date("2026-11-03T00:00:00Z");
const validRow = 'fixture-site,fixture-platform,https://fixture-site.invalid/page,submitted,,"Words, ""quoted""",2026-11-01T00:00:00Z,human,"first line\nsecond line"';

async function fixtureRoot(t: TestContext, rows: string[]) {
  const root = await mkdtemp(path.join(process.cwd(), "node_modules", ".backlinks-csv-test-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await Promise.all(["sites", "backlinks/submissions", "backlinks/checks"].map((dir) => mkdir(path.join(root, dir), { recursive: true })));
  await Promise.all([
    writeFile(path.join(root, "sites", "fixture-site.json"), JSON.stringify({
      id: "fixture-site", name: "Fixture site", baseUrl: "https://fixture-site.invalid",
    })),
    writeFile(path.join(root, "backlinks", "platforms.json"), "[]\n"),
    writeFile(path.join(root, "fixture.csv"), [header, ...rows].join("\r\n")),
  ]);
  return root;
}

test("CSV parses quotes, delimiters, newlines, BOM and reordered headers", () => {
  const rows = readCsvRows(`\uFEFF${header}\r\n${validRow}\r\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].anchor, 'Words, "quoted"');
  assert.equal(rows[0].notes, "first line\nsecond line");
  const [head, row] = parseCsv(`${header}\n${validRow}`);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const reordered = [head.reverse(), row.reverse()].map((fields) => fields.map(quote).join(",")).join("\n");
  assert.deepEqual(readCsvRows(reordered), rows);
  assert.throws(() => parseCsv('a,"unfinished'), /unclosed quote/);
});

test("a later invalid row leaves submissions and auto-created platforms unchanged", async (t) => {
  const root = await fixtureRoot(t, [validRow, validRow.replace("https://fixture-site.invalid", "https://wrong.invalid")]);
  await assert.rejects(() => runImport(root, true, false));
  assert.equal(await readFile(path.join(root, "backlinks", "platforms.json"), "utf8"), "[]\n");
  const reopened = await Store.open(root);
  assert.deepEqual(reopened.submissions, []);
  assert.deepEqual(reopened.platforms, []);
});

test("missing platforms are listed, and creation supports dry-run then validated import", async (t) => {
  const root = await fixtureRoot(t, [validRow, validRow.replace("fixture-platform", "another-platform")]);
  await assert.rejects(() => runImport(root, false, false), /another-platform, fixture-platform/);

  const preview = await runImport(root, true, true);
  assert.equal(preview.addedPlatforms.length, 2);
  assert.equal(preview.addedSubmissions.length, 2);
  assert.equal((await Store.open(root)).submissions.length, 0);

  await runImport(root, true, false);
  const reopened = await Store.open(root);
  assert.deepEqual(reopened.platforms.map(({ id, type, url }) => [id, type, url]), [
    ["another-platform", "other", undefined],
    ["fixture-platform", "other", undefined],
  ]);
  assert.equal(reopened.submissions.length, 2);
  assert.equal(reopened.submissions[0].history[0].note, "imported from fixture.csv");
});

async function runImport(root: string, createPlatforms: boolean, dryRun: boolean) {
  const store = await Store.open(root);
  return importCsv({ store, flags: { file: "fixture.csv", "create-platforms": createPlatforms }, args: [], now, dryRun });
}
