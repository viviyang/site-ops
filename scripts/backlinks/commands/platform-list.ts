import { value, type Context } from "../cli.js";
import { platformTypes, type PlatformType } from "../types.js";
export function platformList(ctx: Context) {
  const type = value(ctx, "type") as PlatformType | undefined;
  if (type && !platformTypes.includes(type)) throw new Error("Unknown platform type: " + type);
  return { platforms: ctx.store.platforms.filter(p => !type || p.type === type) };
}
