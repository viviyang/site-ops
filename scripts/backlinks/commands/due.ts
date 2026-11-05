import type { Context } from "../cli.js";
import { buildDue } from "../due.js";

export async function due({ store, flags, now }: Context) {
  const site = typeof flags.site === "string" ? flags.site : undefined;
  const submissions = store.select({ site });
  const sites = [...store.sites.values()].filter((record) => !site || record.id === site);
  return buildDue(sites, store.platforms, submissions, now);
}
