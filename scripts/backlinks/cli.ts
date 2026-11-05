import type { Store } from "./store.js";
export type Context = {
  store: Store; flags: Record<string, string | boolean | undefined>; args: string[]; now: Date; dryRun: boolean;
};
export function value(ctx: Context, key: string, required: true): string;
export function value(ctx: Context, key: string, required?: false): string | undefined;
export function value(ctx: Context, key: string, required = false) {
  const field = ctx.flags[key];
  if (typeof field === "string") return field;
  if (required) throw new Error("--" + key + " is required");
}
