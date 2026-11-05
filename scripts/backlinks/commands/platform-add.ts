import { value, type Context } from "../cli.js";
import type { Platform } from "../types.js";

export function platformFields(ctx: Context, requireUrl: boolean) {
  const dr = value(ctx, "dr");
  const days = value(ctx, "review-days");
  return {
    name: value(ctx, "name", true), url: requireUrl ? value(ctx, "url", true) : value(ctx, "url"),
    type: value(ctx, "type", true) as Platform["type"],
    domainRating: dr === undefined ? undefined : Number(dr),
    reviewDays: days === undefined ? undefined : Number(days),
    requiresHuman: ctx.flags["requires-human"] === true || undefined,
    linkRel: value(ctx, "link-rel") as Platform["linkRel"], notes: value(ctx, "notes"),
  };
}
export async function platformAdd(ctx: Context) {
  const platform: Platform = { id: value(ctx, "id", true), ...platformFields(ctx, true), createdAt: ctx.now.toISOString() };
  await ctx.store.save({ platforms: [...ctx.store.platforms, platform] }, ctx.dryRun);
  return { platform, dryRun: ctx.dryRun };
}
