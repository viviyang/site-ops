import { httpUrl } from "../sites.js";
import { indexTargets } from "../types.js";
import type { Check, IndexCheck, IndexResult, IndexTarget, Submission } from "../types.js";

export type IndexItem = Pick<IndexCheck, "submissionId" | "target" | "url" | "query">;
export type IndexCandidate = Omit<IndexItem, "query">;
export type IndexOutcome = { result: IndexResult; query: string; reason?: string };
export type TargetSelection = IndexTarget | "both";
export type SkippedIndexItem = Pick<IndexItem, "submissionId" | "target"> & { reason: string };

const week = 7 * 24 * 60 * 60 * 1_000;

export interface IndexProvider {
  name: "brightdata" | "manual";
  check(url: string): Promise<IndexOutcome>;
}

export function normalizeIndexUrl(value: string) {
  const url = httpUrl(value);
  const host = url.host.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/$/, "");
  return `${url.protocol}//${host}${pathname}${url.search}`;
}

export function indexQuery(value: string) {
  httpUrl(value);
  return `site:${value.replace(/^https?:\/\//i, "").split("#", 1)[0]}`;
}

export function indexTargetUrl(submission: Submission, target: IndexTarget) {
  return target === "target_page" ? submission.targetUrl : submission.backlinkUrl;
}

export function selectIndexItems(
  submissions: Submission[],
  checks: Check[],
  now: Date,
  target: TargetSelection,
  force = false,
) {
  const items: IndexCandidate[] = [];
  const skipped: SkippedIndexItem[] = [];
  const recent = new Set<string>();

  if (!force) {
    for (const check of checks) {
      if (check.kind !== "index" || check.result === "unknown") continue;
      const age = now.getTime() - Date.parse(check.at);
      if (age >= 0 && age < week) recent.add(normalizeIndexUrl(check.url));
    }
  }

  for (const submission of submissions) {
    for (const page of target === "both" ? indexTargets : [target]) {
      const item = { submissionId: submission.id, target: page };
      const url = indexTargetUrl(submission, page);
      if (!url) {
        skipped.push({ ...item, reason: "No backlink URL recorded." });
      } else if (recent.has(normalizeIndexUrl(url))) {
        skipped.push({ ...item, reason: "This URL had a conclusive check in the last 7 days." });
      } else {
        items.push({ ...item, url });
      }
    }
  }
  return { items, skipped };
}

export function applyIndexChecks(submissions: Submission[], checks: IndexCheck[]) {
  const byId = new Map<string, IndexCheck[]>();
  for (const check of checks) {
    const group = byId.get(check.submissionId) ?? [];
    group.push(check);
    byId.set(check.submissionId, group);
  }
  return submissions.map(submission => {
    const group = byId.get(submission.id);
    if (!group) return submission;
    const summary = { ...submission.lastIndexCheck };
    let updatedAt = submission.updatedAt;
    for (const { target, result, url, at } of group) {
      const previous = summary[target];
      const consecutive = previous?.result === result && normalizeIndexUrl(previous.url) === normalizeIndexUrl(url)
        ? previous.consecutive + 1 : 1;
      summary[target] = { at, result, consecutive, url };
      if (Date.parse(at) > Date.parse(updatedAt)) updatedAt = at;
    }
    return { ...submission, lastIndexCheck: summary, updatedAt };
  });
}
