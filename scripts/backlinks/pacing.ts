import { localDate } from "./sites.js";
import type { Site, Submission, SubmissionStatus } from "./types.js";

const week = 7 * 86_400_000;
export function pacing(site: Site, submissions: readonly Submission[], now: Date) {
  const config = site.backlinks;
  const used = submissions.filter(row => {
    const age = now.getTime() - Date.parse(row.submittedAt ?? "");
    return row.siteId === site.id && age >= 0 && age < week;
  }).length;
  const limit = config?.maxNewPerWeek;
  const remaining = limit === undefined ? undefined : Math.max(0, limit - used);
  const reasons: string[] = [];
  if (config?.enabled === false) reasons.push("backlinks disabled");
  if (config?.pausedUntil && localDate(now) < config.pausedUntil) reasons.push("paused until " + config.pausedUntil);
  if (remaining === 0) reasons.push("weekly limit reached (" + used + "/" + limit + ")");
  return { used, limit, remaining, reasons };
}
export function pacingNote(site: Site, rows: Submission[], now: Date, status: SubmissionStatus, force: boolean, note?: string) {
  if (force && !note?.trim()) throw new Error("--force requires --note");
  const budget = pacing(site, rows, now);
  if (status === "planned") return force ? "forced: " + note : note;
  if (budget.reasons.length && !force) {
    throw new Error(budget.reasons.join("; ") + "; remaining: " + (budget.remaining ?? "unlimited"));
  }
  return force ? "forced: " + [...budget.reasons, note].filter(Boolean).join("; ") : note;
}
