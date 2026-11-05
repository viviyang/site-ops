import { readFile } from "node:fs/promises";
import path from "node:path";
import { value, type Context } from "../cli.js";
import { readManualResults } from "../index-check/manual.js";
import { applyIndexChecks } from "../index-check/provider.js";

export async function indexImport(ctx: Context) {
  const { store, now, dryRun } = ctx;
  const file = path.resolve(store.root, value(ctx, "file", true));
  const data: unknown = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  const { checks, errors } = readManualResults(data, store.submissions, now);
  if (checks.length) {
    await store.save({ submissions: applyIndexChecks(store.submissions, checks), checks }, dryRun);
  }
  const exitCode = errors.length ? (checks.length ? 2 : 1) : 0;
  return { file, checks, errors, dryRun, exitCode };
}
