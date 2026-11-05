import { value, type Context } from "../cli.js";
import { ensure } from "../sites.js";
import { statuses, type SubmissionStatus } from "../types.js";
export function list(ctx: Context) {
  const status = value(ctx, "status") as SubmissionStatus | undefined;
  const platform = value(ctx, "platform");
  ensure(status === undefined || statuses.includes(status), "Unknown status: " + status);
  ensure(platform === undefined || ctx.store.platforms.some(p => p.id === platform), "Unknown platform: " + platform);
  return { submissions: ctx.store.select({ site: value(ctx, "site") })
    .filter(s => (!status || s.status === status) && (!platform || s.platformId === platform)) };
}
