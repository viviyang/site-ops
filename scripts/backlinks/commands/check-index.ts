import path from "node:path";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { value, type Context } from "../cli.js";
import { createBrightDataProvider } from "../index-check/brightdata.js";
import {
  applyIndexChecks, indexQuery, indexTargetUrl, normalizeIndexUrl, selectIndexItems,
  type IndexOutcome,
} from "../index-check/provider.js";
import type { IndexCheck } from "../types.js";
import { withStoreWrite } from "../store.js";
import { indexExport } from "./index-export.js";

export async function readBrightDataEnv(root: string) {
  const localEnv = await readFile(path.join(root, ".env.local"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return parse(localEnv);
}

export async function checkIndex(ctx: Context, providerFactory?: () => ReturnType<typeof createBrightDataProvider>) {
  const { store, flags, now, dryRun } = ctx;
  const provider = flags.provider ?? "manual";
  const target = flags.target ?? "both";
  if (target !== "backlink_page" && target !== "target_page" && target !== "both") {
    throw new Error("--target must be backlink_page, target_page or both.");
  }
  if (provider === "manual") return indexExport(ctx, target);
  if (provider !== "brightdata") throw new Error("--provider must be brightdata or manual.");
  if (flags.out !== undefined) throw new Error("--out is only supported with --provider manual.");

  const selected = store.select({
    site: value(ctx, "site"),
    id: value(ctx, "id"),
  });
  const { items, skipped } = selectIndexItems(selected, store.checks, now, target, flags.force === true);
  const urls = new Set(items.map(item => normalizeIndexUrl(item.url)));
  if (dryRun) return {
    items: items.map(item => ({ ...item, query: indexQuery(item.url) })),
    skipped,
    requests: urls.size,
    dryRun,
  };

  const brightData = providerFactory?.() ?? createBrightDataProvider({ ...await readBrightDataEnv(store.root), ...process.env });

  const outcomes = new Map<string, IndexOutcome>();
  const checks: IndexCheck[] = [];
  for (const item of items) {
    const key = normalizeIndexUrl(item.url);
    let outcome = outcomes.get(key);
    if (!outcome) {
      outcome = await brightData.check(item.url);
      outcomes.set(key, outcome);
    }
    checks.push({
      ...item,
      ...outcome,
      kind: "index",
      provider: brightData.name,
      at: new Date().toISOString(),
    });
  }
  const saved = checks.length ? await withStoreWrite(store.root, async fresh => {
    const current = new Map(fresh.submissions.map(row => [row.id, row]));
    const original = new Map(selected.map(row => [row.id, row]));
    const accepted = checks.filter(check => {
      const row = current.get(check.submissionId);
      const previous = original.get(check.submissionId)?.lastIndexCheck?.[check.target];
      if (row && indexTargetUrl(row, check.target) === check.url
        && JSON.stringify(row.lastIndexCheck?.[check.target]) === JSON.stringify(previous)) return true;
      skipped.push({ submissionId: check.submissionId, target: check.target, reason: "URL or index result changed during check" });
      return false;
    });
    if (accepted.length) await fresh.save({ submissions: applyIndexChecks(fresh.submissions, accepted), checks: accepted });
    return accepted;
  }) : [];
  const exitCode = saved.some(check => check.result === "unknown") ? 2 : 0;
  return { checks: saved, skipped, requests: outcomes.size, dryRun, exitCode };
}
