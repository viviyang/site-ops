import { value, type Context } from "../cli.js";
import type { Submission, SubmissionStatus } from "../types.js";

export async function update(ctx: Context) {
  const [current] = ctx.store.select({ id: ctx.args[0] });
  const status = (value(ctx, "status") ?? current.status) as SubmissionStatus;
  const backlinkUrl = (value(ctx, "backlink-url") ?? current.backlinkUrl) || undefined;
  const at = ctx.now.toISOString();
  const note = value(ctx, "note");
  if (note && status === current.status) throw new Error("--note requires a status change; use --notes for record notes");
  const submission: Submission = {
    ...current, status, backlinkUrl, updatedAt: at,
    anchorText: value(ctx, "anchor") ?? current.anchorText,
    notes: value(ctx, "notes") ?? current.notes,
  };
  if (backlinkUrl !== current.backlinkUrl) {
    delete submission.lastLiveCheck;
    const target = submission.lastIndexCheck?.target_page;
    submission.lastIndexCheck = target ? { target_page: target } : undefined;
  }
  if (status !== current.status) {
    submission.history = [...current.history, { at, from: current.status, to: status, note }];
    if (status === "live") submission.liveAt = at;
    if (current.status === "planned" && ["submitted", "pending_review", "live"].includes(status)) {
      submission.submittedAt ??= at;
    }
  }
  await ctx.store.save({ submissions: ctx.store.submissions.map(s => s.id === submission.id ? submission : s) }, ctx.dryRun);
  return { submission, dryRun: ctx.dryRun };
}
