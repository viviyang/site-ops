import { setTimeout as delay } from "node:timers/promises";
import { load } from "cheerio";
import { chromium } from "playwright";
import type { LiveCheck } from "./types.js";

const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type PageContent = { html: string; status: number; url: string };
export type LiveTask = { submissionId: string; url: string; siteUrl: string };
export type LiveOptions = {
  browser?: boolean;
  fetch?: typeof fetch;
  loadBrowser?: (url: string) => Promise<PageContent>;
  wait?: (milliseconds: number) => Promise<unknown>;
  now?: () => Date;
};

function hostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function inspectPage(
  page: PageContent,
  siteUrl: string,
): Pick<LiveCheck, "result" | "links" | "reason"> {
  if (page.status < 200 || page.status >= 300) {
    return { result: "unknown", links: [], reason: `HTTP ${page.status}` };
  }

  const $ = load(page.html);
  const domain = hostname(new URL(siteUrl));
  let baseUrl = page.url;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    try {
      baseUrl = new URL(baseHref, page.url).href;
    } catch {
      // Invalid document base; resolve relative URLs against the final page URL.
    }
  }

  const links: LiveCheck["links"] = [];
  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    if (!href?.trim()) return;

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!["http:", "https:"].includes(url.protocol) || hostname(url) !== domain) return;
    links.push({
      href: url.href,
      rel: (anchor.attr("rel") ?? "").split(/\s+/).filter(Boolean),
      anchorText: anchor.text().trim(),
    });
  });

  // Listing pages often embed captcha widgets for their own forms, so markers only matter when no link was found.
  if (links.length > 0) return { result: "found", links };

  if (/cf-chl|captcha/i.test(page.html)) {
    return { result: "unknown", links, reason: "Possible challenge page" };
  }
  $("script, style, template").remove();
  if ($("body").text().replace(/\s+/g, " ").trim().length < 200) {
    return { result: "unknown", links, reason: "Short body; page may require JavaScript" };
  }

  if (page.status === 200) return { result: "missing", links };
  return { result: "unknown", links, reason: `HTTP ${page.status}` };
}

export function isRestrictedLink(link: LiveCheck["links"][number]) {
  return link.rel.some((token) => ["nofollow", "ugc", "sponsored"].includes(token.toLowerCase()));
}

export function allLinksRestricted(check: LiveCheck) {
  return check.result === "found" && check.links.length > 0 && check.links.every(isRestrictedLink);
}

async function loadBrowserPage(url: string): Promise<PageContent> {
  const browser = await chromium.launch({ headless: true, timeout: 20_000 });
  try {
    const page = await browser.newPage({ userAgent: browserUserAgent, serviceWorkers: "block" });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!response) throw new Error("Browser navigation returned no response");
    // Allow client rendering to settle, while still inspecting pages with persistent requests.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    return { status: response.status(), url: page.url(), html: await page.content() };
  } finally {
    await browser.close();
  }
}

async function runAttempt(
  task: LiveTask,
  method: LiveCheck["method"],
  loadPage: (url: string) => Promise<PageContent>,
  now: () => Date,
): Promise<LiveCheck> {
  const check = { kind: "live" as const, submissionId: task.submissionId, at: now().toISOString(), url: task.url, method };
  try {
    const page = await loadPage(task.url);
    return { ...check, httpStatus: page.status, ...inspectPage(page, task.siteUrl) };
  } catch (error) {
    return { ...check, result: "unknown", links: [], reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function runLiveChecks(tasks: LiveTask[], options: LiveOptions = {}): Promise<LiveCheck[]> {
  const request = options.fetch ?? fetch;
  const wait = options.wait ?? delay;
  const now = options.now ?? (() => new Date());
  const loadBrowser = options.loadBrowser ?? loadBrowserPage;

  async function loadFetchPage(url: string): Promise<PageContent> {
    const response = await request(url, {
      headers: { "User-Agent": browserUserAgent },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    return {
      status: response.status,
      url: response.url || url,
      html: response.ok ? await response.text() : "",
    };
  }

  const groups = new Map<string, { task: LiveTask; index: number }[]>();
  tasks.forEach((task, index) => {
    const key = hostname(new URL(task.url));
    const entries = groups.get(key) ?? [];
    entries.push({ task, index });
    groups.set(key, entries);
  });

  const batches = groups.values();
  const results = new Array<LiveCheck>(tasks.length);
  async function worker() {
    for (const entries of batches) {
      let hasRun = false;
      for (const { task, index } of entries) {
        if (hasRun) await wait(2_000);
        let check = await runAttempt(task, "fetch", loadFetchPage, now);
        if (options.browser && check.result === "unknown") {
          await wait(2_000);
          check = await runAttempt(task, "browser", loadBrowser, now);
        }
        results[index] = check;
        hasRun = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, groups.size) }, () => worker()));
  return results;
}
