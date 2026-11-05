import path from "node:path";
import { value, type Context } from "../cli.js";
import { manualProvider } from "../index-check/manual.js";
import { selectIndexItems, type TargetSelection } from "../index-check/provider.js";
import { localDate } from "../sites.js";
import { atomicWrite } from "../store.js";

export async function indexExport(ctx: Context, target: TargetSelection = "both") {
  const { store, flags, now, dryRun } = ctx;
  const selected = store.select({
    site: value(ctx, "site"),
    id: value(ctx, "id"),
  });
  const { items, skipped } = selectIndexItems(selected, store.checks, now, target, flags.force === true);
  const entries = await Promise.all(items.map(async item => ({
    ...item,
    query: (await manualProvider.check(item.url)).query,
  })));

  const date = localDate(now);
  const out = value(ctx, "out");
  const file = path.resolve(store.root, out ?? path.join("reports", "backlinks", `index-pending-${date}.json`));
  if (!dryRun) await atomicWrite(file, `${JSON.stringify({ items: entries }, null, 2)}\n`);
  return { file, items: entries, skipped, dryRun };
}
