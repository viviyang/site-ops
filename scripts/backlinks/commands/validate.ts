import type { Context } from "../cli.js";
export function validate({ store }: Context) {
  return { valid: true, sites: store.sites.size, platforms: store.platforms.length, submissions: store.submissions.length, checks: store.checks.length };
}
