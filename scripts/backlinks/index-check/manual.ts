import type { IndexCheck, Submission } from "../types.js";
import { indexQuery, indexTargetUrl, type IndexProvider } from "./provider.js";

export const manualProvider: IndexProvider = {
  name: "manual",
  async check(url) {
    return { query: indexQuery(url), result: "unknown", reason: "Awaiting a manually recorded SERP result." };
  },
};

export function readManualResults(data: unknown, submissions: Submission[], now: Date) {
  if (!record(data) || !Array.isArray(data.items)) {
    throw new Error("Expected a JSON object with an items array.");
  }

  const checks: IndexCheck[] = [];
  const errors: { row: number; reason: string }[] = [];
  const byId = new Map(submissions.map(submission => [submission.id, submission]));
  const seen = new Set<string>();
  const at = now.toISOString();

  for (const [index, item] of data.items.entries()) {
    try {
      const check = readItem(item, byId, at);
      const key = `${check.submissionId}:${check.target}`;
      if (seen.has(key)) throw new Error("Duplicate submissionId and target in this file.");
      seen.add(key);
      checks.push(check);
    } catch (error) {
      errors.push({ row: index + 1, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checks, errors };
}

function readItem(item: unknown, byId: Map<string, Submission>, at: string): IndexCheck {
  if (!record(item) || typeof item.submissionId !== "string") {
    throw new Error("Expected a submissionId.");
  }
  const submission = byId.get(item.submissionId);
  if (!submission) throw new Error(`Unknown submissionId: ${item.submissionId}`);
  if (item.target !== "backlink_page" && item.target !== "target_page") {
    throw new Error("target must be backlink_page or target_page.");
  }
  const url = indexTargetUrl(submission, item.target);
  if (!url || item.url !== url) throw new Error("URL no longer matches the submission target. Export a fresh list.");
  const query = indexQuery(url);
  if (item.query !== query) throw new Error("Query does not match the exported URL.");
  if (item.result !== "indexed" && item.result !== "not_found" && item.result !== "unknown") {
    throw new Error("result must be indexed, not_found or unknown.");
  }
  if (item.reason !== undefined && typeof item.reason !== "string") throw new Error("reason must be a string.");
  return {
    kind: "index",
    submissionId: submission.id,
    at,
    target: item.target,
    url,
    query,
    provider: "manual",
    result: item.result,
    reason: item.reason,
  };
}

import { record } from "../sites.js";
