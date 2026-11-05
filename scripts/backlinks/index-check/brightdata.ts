import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { record } from "../sites.js";
import { indexQuery, normalizeIndexUrl, type IndexOutcome, type IndexProvider } from "./provider.js";

export function parseSerp(data: unknown, url: string): Omit<IndexOutcome, "query"> {
  if (!record(data) || !Array.isArray(data.organic) || data.error || data.captcha) {
    return { result: "unknown", reason: "SERP response has no usable organic results field." };
  }

  const expected = normalizeIndexUrl(url);
  let malformed = false;
  for (const item of data.organic) {
    if (record(item) && typeof item.link === "string") {
      try {
        if (normalizeIndexUrl(item.link) === expected) return { result: "indexed" };
        continue;
      } catch {
        // Malformed results cannot be used to confirm absence.
      }
    }
    malformed = true;
  }
  if (malformed) return { result: "unknown", reason: "Organic results contain invalid links." };
  return { result: "not_found" };
}

export function createBrightDataProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): IndexProvider {
  const token = env.BRIGHT_DATA_API_TOKEN?.trim();
  const zone = env.BRIGHT_DATA_SERP_ZONE?.trim();
  if (!token || !zone) {
    throw new Error("BRIGHT_DATA_API_TOKEN and BRIGHT_DATA_SERP_ZONE are required. Use --provider manual to export queries instead.");
  }

  let pending: Promise<unknown> = Promise.resolve();
  let lastStarted = -Infinity;
  return {
    name: "brightdata",
    check(url) {
      const request = pending.then(async (): Promise<IndexOutcome> => {
        const query = indexQuery(url);
        const remaining = 1_000 - (performance.now() - lastStarted);
        if (remaining > 0) await delay(Math.ceil(remaining));
        lastStarted = performance.now();
        try {
          const response = await fetchImpl("https://api.brightdata.com/request", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              zone,
              url: `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1`,
              format: "raw",
            }),
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) return { result: "unknown", query, reason: `Bright Data HTTP ${response.status}` };
          try {
            return { query, ...parseSerp(await response.json(), url) };
          } catch {
            return { result: "unknown", query, reason: "Could not parse Bright Data SERP JSON." };
          }
        } catch {
          return { result: "unknown", query, reason: "Bright Data request failed or timed out." };
        }
      });
      pending = request.catch(() => undefined);
      return request;
    },
  };
}
