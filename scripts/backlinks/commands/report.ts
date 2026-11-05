import path from "node:path";
import type { Context } from "../cli.js";
import { buildReport } from "../report.js";
import { localDate } from "../sites.js";
import { atomicWrite } from "../store.js";

export async function report({ store, flags, now, dryRun }: Context) {
  const site = typeof flags.site === "string" ? flags.site : undefined;
  const submissions = store.select({ site });
  const sites = [...store.sites.values()].filter((record) => !site || record.id === site);
  const markdown = buildReport(sites, store.platforms, submissions, now, store.checks);
  const date = localDate(now);
  const out = typeof flags.out === "string" ? flags.out : path.join("reports", "backlinks", `${date}.md`);
  const file = path.resolve(store.root, out);
  if (!dryRun) await atomicWrite(file, markdown);
  return dryRun ? { file, dryRun, markdown } : { file, dryRun };
}
