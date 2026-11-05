import type { Site, Platform, Submission } from "./types.js";
import { pacing } from "./pacing.js";

const day = 24 * 60 * 60 * 1000;

type DueItem = {
  submissionId: string;
  siteId: string;
  platformId: string;
  status: Submission["status"];
  dueSince?: string;
  targets?: ("backlink_page" | "target_page")[];
  remaining?: number | null;
  pacingReason?: string;
};

export const dueLabels = {
  reviewOverdue: "审核超时",
  lost: "已失效",
  missingBacklinkUrl: "需要补外链地址",
  liveCheckDue: "存活检查到期",
  indexCheckDue: "收录待查",
  planned: "计划中",
};

type DueKey = keyof typeof dueLabels;
export type DueList = Record<DueKey, DueItem[]>;

export function buildDue(
  sites: readonly Site[],
  platforms: readonly Platform[],
  submissions: readonly Submission[],
  now: Date,
): DueList {
  const due: DueList = {
    reviewOverdue: [],
    lost: [],
    missingBacklinkUrl: [],
    liveCheckDue: [],
    indexCheckDue: [],
    planned: [],
  };

  const platformById = new Map(platforms.map((platform) => [platform.id, platform]));
  const allowance = new Map(sites.map((site) => [site.id, pacing(site, submissions, now)]));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (const submission of submissions) {
    const { id: submissionId, siteId, platformId, status } = submission;
    const entry = { submissionId, siteId, platformId, status };
    const submitted = submission.submittedAt ? Date.parse(submission.submittedAt) : undefined;
    if ((status === "submitted" || status === "pending_review") && submitted !== undefined) {
      const reviewDays = platformById.get(platformId)?.reviewDays ?? 14;
      const reviewDeadline = submitted + reviewDays * day;
      if (reviewDeadline < today.getTime()) {
        due.reviewOverdue.push({ ...entry, dueSince: new Date(reviewDeadline).toISOString() });
      }
    }

    if (status === "lost") {
      due.lost.push({ ...entry, dueSince: submission.history.at(-1)?.at ?? submission.updatedAt });
    }

    if (!submission.backlinkUrl) {
      if (status === "live") due.missingBacklinkUrl.push({ ...entry, dueSince: submission.liveAt ?? submission.createdAt });
      if (status === "submitted" && submitted !== undefined && submitted + 7 * day < now.getTime()) {
        due.missingBacklinkUrl.push({ ...entry, dueSince: new Date(submitted + 7 * day).toISOString() });
      }
    }

    if (status === "live") {
      const lastLive = submission.lastLiveCheck;
      const liveDeadline = lastLive
        ? Date.parse(lastLive.at) + (lastLive.result === "unknown" ? 0 : 30 * day)
        : Date.parse(submission.liveAt ?? submission.createdAt);
      if (!lastLive || lastLive.result === "unknown" || liveDeadline < now.getTime()) {
        due.liveCheckDue.push({ ...entry, dueSince: new Date(liveDeadline).toISOString() });
      }

      const targets: NonNullable<DueItem["targets"]> = [];
      const deadlines: number[] = [];
      for (const target of ["backlink_page", "target_page"] as const) {
        if (target === "backlink_page" && !submission.backlinkUrl) continue;
        const lastIndex = submission.lastIndexCheck?.[target];
        const deadline = lastIndex
          ? Date.parse(lastIndex.at) + 7 * day
          : Date.parse(submission.liveAt ?? submission.createdAt);
        if (lastIndex?.result !== "indexed" && (!lastIndex || deadline < now.getTime())) {
          targets.push(target);
          deadlines.push(deadline);
        }
      }
      if (targets.length) {
        due.indexCheckDue.push({ ...entry, targets, dueSince: new Date(Math.min(...deadlines)).toISOString() });
      }
    }

    if (status === "planned") {
      const quota = allowance.get(siteId);
      due.planned.push({
        ...entry,
        dueSince: submission.createdAt,
        remaining: quota?.remaining ?? null,
        pacingReason: quota?.reasons.join("; ") || undefined,
      });
    }
  }

  for (const items of Object.values(due)) {
    items.sort((a, b) => (a.dueSince ?? "").localeCompare(b.dueSince ?? "") || a.submissionId.localeCompare(b.submissionId));
  }
  return due;
}
