export const platformTypes = ["directory","launch","forum","profile","guest-post","social","qa","resource-page","other"] as const;
export const statuses = ["planned","submitted","pending_review","live","rejected","lost","abandoned"] as const;
export const liveResults = ["found","missing","unknown"] as const;
export const indexResults = ["indexed","not_found","unknown"] as const;
export const indexTargets = ["backlink_page","target_page"] as const;
export type PlatformType = typeof platformTypes[number];
export type SubmissionStatus = typeof statuses[number];
export type LiveResult = typeof liveResults[number];
export type IndexResult = typeof indexResults[number];
export type IndexTarget = typeof indexTargets[number];
export type Platform = {
  id: string; name: string; url?: string; type: PlatformType; domainRating?: number;
  requiresHuman?: boolean; reviewDays?: number; linkRel?: "dofollow" | "nofollow" | "mixed" | "unknown";
  notes?: string; createdAt: string;
};
export type LiveCheckSummary = { at: string; result: LiveResult; consecutive: number; restricted?: boolean };
export type IndexCheckSummary = Partial<Record<IndexTarget, { at: string; result: IndexResult; consecutive: number; url: string }>>;
export type Submission = {
  id: string; siteId: string; platformId: string; targetUrl: string; backlinkUrl?: string;
  anchorText?: string; status: SubmissionStatus; submittedBy?: string; submittedAt?: string;
  liveAt?: string; lastLiveCheck?: LiveCheckSummary; lastIndexCheck?: IndexCheckSummary;
  history: { at: string; from: SubmissionStatus | null; to: SubmissionStatus; note?: string }[];
  notes?: string; createdAt: string; updatedAt: string;
};
export type LiveCheck = {
  kind: "live"; submissionId: string; at: string; url: string; httpStatus?: number;
  method: "fetch" | "browser"; result: LiveResult;
  links: { href: string; rel: string[]; anchorText: string }[]; reason?: string;
};
export type IndexCheck = {
  kind: "index"; submissionId: string; at: string; target: IndexTarget; url: string;
  provider: "brightdata" | "manual"; query: string; result: IndexResult; reason?: string;
};
export type Check = LiveCheck | IndexCheck;
export type Site = {
  id: string; name: string; baseUrl: string;
  backlinks?: { enabled?: boolean; maxNewPerWeek?: number; pausedUntil?: string; notes?: string };
};
