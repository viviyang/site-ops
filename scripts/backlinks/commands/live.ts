import type { Context } from "../cli.js";
import { allLinksRestricted, runLiveChecks, type LiveOptions } from "../live-check.js";
import { withStoreWrite } from "../store.js";
import type { LiveCheck, Submission } from "../types.js";

const eligibleStatuses = new Set(["submitted", "pending_review", "live", "lost"]);

export function applyLiveCheck(submission: Submission, check: LiveCheck): Submission {
  const previous = submission.lastLiveCheck;
  const consecutive = previous?.result === check.result ? previous.consecutive + 1 : 1;
  let status = submission.status;
  if (check.result === "found" && ["submitted", "pending_review", "lost"].includes(status)) {
    status = "live";
  } else if (check.result === "missing" && status === "live" && consecutive >= 2) {
    status = "lost";
  }
  const transitioned = status !== submission.status;
  return {
    ...submission,
    status,
    liveAt: transitioned && status === "live" ? check.at : submission.liveAt,
    lastLiveCheck: {
      at: check.at,
      result: check.result,
      consecutive,
      restricted: check.result === "found" ? allLinksRestricted(check) : undefined,
    },
    history: transitioned
      ? [...submission.history, { at: check.at, from: submission.status, to: status, note: "auto: live check" }]
      : submission.history,
    updatedAt: Date.parse(check.at) > Date.parse(submission.updatedAt) ? check.at : submission.updatedAt,
  };
}

export async function live({ store, flags, now, dryRun }: Context, options: LiveOptions = {}) {
  const submissions = store.select({
    site: typeof flags.site === "string" ? flags.site : undefined,
    id: typeof flags.id === "string" ? flags.id : undefined,
  });
  const skipped: { submissionId: string; reason: string }[] = [];
  const tasks = submissions.flatMap((submission) => {
    const { id, siteId, status, backlinkUrl } = submission;
    if (!eligibleStatuses.has(status) || !backlinkUrl) {
      skipped.push({ submissionId: id, reason: !backlinkUrl ? "No backlink URL" : `Status is ${status}` });
      return [];
    }
    return [{ submissionId: id, url: backlinkUrl, siteUrl: store.sites.get(siteId)!.baseUrl }];
  });
  if (dryRun) return { dryRun, tasks, skipped, browser: flags.browser === true };

  const outcomes = await runLiveChecks(tasks, { ...options, browser: flags.browser === true, now: () => now });
  const checks: LiveCheck[] = [];
  if (outcomes.length) await withStoreWrite(store.root, async fresh => {
    const latest = new Map(fresh.submissions.map(row => [row.id, row]));
    const original = new Map(submissions.map(row => [row.id, row]));
    for (const check of outcomes) {
      const row = latest.get(check.submissionId);
      const before = original.get(check.submissionId);
      if (!row || row.backlinkUrl !== check.url || row.status !== before?.status
        || JSON.stringify(row.lastLiveCheck) !== JSON.stringify(before?.lastLiveCheck)) {
        skipped.push({ submissionId: check.submissionId, reason: "Submission or live result changed during check" });
      } else {
        checks.push(check);
      }
    }
    if (!checks.length) return;
    const byId = new Map(checks.map((check) => [check.submissionId, check]));
    await fresh.save({
      checks,
      submissions: fresh.submissions.map((submission) => {
        const check = byId.get(submission.id);
        return check ? applyLiveCheck(submission, check) : submission;
      }),
    }, false);
  });

  return {
    checks: checks.map((check) => ({ ...check, allLinksRestricted: allLinksRestricted(check) })),
    skipped,
    exitCode: checks.some((check) => check.result === "unknown") ? 2 : 0,
  };
}
