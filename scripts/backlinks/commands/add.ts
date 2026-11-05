import { value, type Context } from "../cli.js";
import { pacingNote } from "../pacing.js";
import { ensure, httpUrl } from "../sites.js";
import { nextId } from "../store.js";
import { statuses, type Submission, type SubmissionStatus } from "../types.js";

export async function add(ctx: Context) {
  const { store, now } = ctx;
  const siteId = value(ctx, "site", true);
  const platformId = value(ctx, "platform", true);
  const site = store.sites.get(siteId);
  ensure(site, "Unknown site: " + siteId);
  ensure(store.platforms.some(p => p.id === platformId), "Unknown platform: " + platformId);
  const status = (value(ctx, "status") ?? "submitted") as SubmissionStatus;
  ensure(statuses.includes(status), "Unknown status: " + status);
  const targetUrl = value(ctx, "target-url", true);
  if (status !== "rejected" && status !== "abandoned") {
    const duplicate = store.submissions.find(s => s.siteId === siteId && s.platformId === platformId
      && s.status !== "rejected" && s.status !== "abandoned" && httpUrl(s.targetUrl).href === httpUrl(targetUrl).href);
    ensure(!duplicate, "Duplicate active submission: " + duplicate?.id);
  }
  const note = pacingNote(site, store.submissions, now, status, ctx.flags.force === true, value(ctx, "note"));
  const at = now.toISOString();
  const submission: Submission = {
    id: nextId(store.submissions, siteId, platformId), siteId, platformId, targetUrl, status,
    backlinkUrl: value(ctx, "backlink-url"), anchorText: value(ctx, "anchor"),
    submittedBy: value(ctx, "by"), notes: value(ctx, "notes"), createdAt: at, updatedAt: at,
    submittedAt: status === "planned" ? undefined : at, liveAt: status === "live" ? at : undefined,
    history: [{ at, from: null, to: status, note }],
  };
  await store.save({ submissions: [...store.submissions, submission] }, ctx.dryRun);
  return { submission, dryRun: ctx.dryRun };
}
