import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContextOptions } from "playwright";

type ViewportName = "desktop" | "mobile";

type SiteConfig = {
  id: string;
  name: string;
  baseUrl: string;
  sitemapUrl: string;
  fallbackRoutes: string[];
  viewports: ViewportName[];
  outputDir?: string;
};

type CliOptions = {
  all: boolean;
  siteId?: string;
  baseUrl?: string;
  sitemapUrl?: string;
};

type CaptureFailure = {
  url: string;
  viewport: string;
  reason: string;
};

type SiteResult = {
  site: SiteConfig;
  urls: string[];
  successCount: number;
  failures: CaptureFailure[];
};

const sitesDir = path.join(process.cwd(), "sites");

const viewports = {
  desktop: {
    width: 1440,
    height: 1200,
    contextOptions: {},
  },
  mobile: {
    width: 390,
    height: 844,
    contextOptions: {
      hasTouch: true,
      isMobile: true,
    },
  },
} satisfies Record<
  ViewportName,
  {
    width: number;
    height: number;
    contextOptions: Pick<BrowserContextOptions, "hasTouch" | "isMobile">;
  }
>;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const registry = await loadSiteRegistry();
  const selectedSites = selectSites(registry, options);
  const runDate = formatDate(new Date());
  const browser = await chromium.launch({ headless: true });
  const results: SiteResult[] = [];

  try {
    for (const site of selectedSites) {
      const activeSite = applyOverrides(site, options);
      const result = await captureSite(browser, activeSite, runDate);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  printOverallSummary(results);

  if (results.some((result) => result.failures.length > 0)) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    all: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--all") {
      options.all = true;
      continue;
    }

    if (arg === "--site") {
      options.siteId = readArgValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--base-url") {
      options.baseUrl = normalizeBaseUrl(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--sitemap-url") {
      options.sitemapUrl = normalizeUrl(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.all === Boolean(options.siteId)) {
    throw new Error("Choose exactly one site selection mode: --site <id> or --all.");
  }

  if (options.all && (options.baseUrl || options.sitemapUrl)) {
    throw new Error("--base-url and --sitemap-url overrides are only supported with --site <id>.");
  }

  return options;
}

function readArgValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

async function loadSiteRegistry() {
  const entries = await readdir(sitesDir, { withFileTypes: true });
  const configs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const configPath = path.join(sitesDir, entry.name);
        const rawConfig = await readFile(configPath, "utf8");
        return parseSiteConfig(JSON.parse(rawConfig), configPath);
      })
  );

  const registry = new Map<string, SiteConfig>();

  for (const config of configs) {
    if (registry.has(config.id)) {
      throw new Error(`Duplicate site id in registry: ${config.id}`);
    }

    registry.set(config.id, config);
  }

  if (registry.size === 0) {
    throw new Error(`No site configs found in ${sitesDir}.`);
  }

  return registry;
}

function parseSiteConfig(value: unknown, configPath: string): SiteConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid site config at ${configPath}: expected object.`);
  }

  const config = {
    id: readString(value, "id", configPath),
    name: readString(value, "name", configPath),
    baseUrl: normalizeBaseUrl(readString(value, "baseUrl", configPath)),
    sitemapUrl: normalizeUrl(readString(value, "sitemapUrl", configPath)),
    fallbackRoutes: readStringArray(value, "fallbackRoutes", configPath),
    viewports: readViewportArray(value, "viewports", configPath),
    outputDir: typeof value.outputDir === "string" ? value.outputDir : undefined,
  };

  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.id)) {
    throw new Error(`Invalid site id in ${configPath}: use kebab-case letters, numbers, and hyphens.`);
  }

  return config;
}

function selectSites(registry: Map<string, SiteConfig>, options: CliOptions) {
  if (options.all) {
    return Array.from(registry.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  const site = registry.get(options.siteId ?? "");

  if (!site) {
    const available = Array.from(registry.keys()).sort().join(", ");
    throw new Error(`Unknown site id: ${options.siteId}. Available sites: ${available}`);
  }

  return [site];
}

function applyOverrides(site: SiteConfig, options: CliOptions): SiteConfig {
  if (!options.baseUrl && !options.sitemapUrl) {
    return site;
  }

  return {
    ...site,
    baseUrl: options.baseUrl ?? site.baseUrl,
    sitemapUrl: options.sitemapUrl ?? site.sitemapUrl,
  };
}

async function captureSite(browser: Awaited<ReturnType<typeof chromium.launch>>, site: SiteConfig, runDate: string) {
  console.log("");
  console.log(`Site: ${site.name} (${site.id})`);
  console.log(`Base URL: ${site.baseUrl}`);
  console.log(`Sitemap URL: ${site.sitemapUrl}`);

  const urls = await getScreenshotUrls(site);
  const outputPaths = await prepareOutputPaths(site, runDate, site.viewports);
  const failures: CaptureFailure[] = [];
  const successfulUrls = new Map(urls.map((url) => [url, true]));

  for (const viewportName of site.viewports) {
    const viewport = viewports[viewportName];
    const context = await browser.newContext({
      ...viewport.contextOptions,
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
    });

    await context.addInitScript(disableAnimations);

    const page = await context.newPage();

    try {
      for (const url of urls) {
      const fileName = `${urlSafeName(url)}.png`;
      const latestPath = path.join(outputPaths.latest[viewportName], fileName);
      const archivePath = path.join(outputPaths.archive[viewportName], fileName);

      try {
        const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
        const status = response?.status();

        if (status && status >= 400) {
          throw new Error(`HTTP ${status}`);
        }

          const screenshot = await page.screenshot({ fullPage: true });
          await Promise.all([writeFile(latestPath, screenshot), writeFile(archivePath, screenshot)]);
        console.log(`Captured ${viewportName}: ${url}`);
      } catch (error) {
          successfulUrls.set(url, false);
        failures.push({ url, viewport: viewportName, reason: errorMessage(error) });
        console.warn(`Failed ${viewportName}: ${url} - ${errorMessage(error)}`);
      }
    }
    } finally {
      await context.close();
    }
  }

  const successCount = Array.from(successfulUrls.values()).filter(Boolean).length;

  printSiteSummary(urls.length, successCount, failures);

  return { site, urls, successCount, failures };
}

async function getScreenshotUrls(site: SiteConfig) {
  try {
    const sitemap = await fetchSitemap(site.sitemapUrl);
    const urls = parseSitemapUrls(sitemap);

    if (urls.length === 0) {
      throw new Error("No <loc> entries found in sitemap.");
    }

    console.log(`Loaded ${urls.length} URL(s) from sitemap.`);
    return urls;
  } catch (error) {
    const urls = localFallbackUrls(site);
    console.warn(`Could not load sitemap: ${errorMessage(error)}`);
    console.warn(`Using ${urls.length} fallback URL(s) from site config.`);
    return urls;
  }
}

async function fetchSitemap(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseSitemapUrls(xml: string) {
  const urls = Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g), (match) => decodeXml(match[1].trim()));
  return uniqueUrls(urls);
}

function localFallbackUrls(site: SiteConfig) {
  return uniqueUrls(site.fallbackRoutes.map((routePath) => new URL(routePath, site.baseUrl).toString()));
}

async function prepareOutputPaths(site: SiteConfig, runDate: string, viewportNames: ViewportName[]) {
  const siteOutputRoot = path.resolve(process.cwd(), site.outputDir ?? "screenshots", site.id);
  const latestRoot = path.join(siteOutputRoot, "latest");
  const archiveRoot = path.join(siteOutputRoot, runDate);
  const latest = {} as Record<ViewportName, string>;
  const archive = {} as Record<ViewportName, string>;

  await rm(latestRoot, { recursive: true, force: true });

  for (const viewportName of viewportNames) {
    latest[viewportName] = path.join(latestRoot, viewportName);
    archive[viewportName] = path.join(archiveRoot, viewportName);

    await mkdir(latest[viewportName], { recursive: true });
    await mkdir(archive[viewportName], { recursive: true });
  }

  return { latest, archive };
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.map((url) => normalizeUrl(url))));
}

function normalizeUrl(url: string) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function normalizeBaseUrl(url: string) {
  return normalizeUrl(url).replace(/\/$/, "");
}

function urlSafeName(url: string) {
  const parsed = new URL(url);
  const pathName = parsed.pathname === "/" ? "home" : parsed.pathname.replace(/^\/|\/$/g, "").replace(/\//g, "__");
  const search = parsed.search ? `__${parsed.searchParams.toString()}` : "";
  const rawName = `${parsed.host}__${pathName}${search}`;
  const safeName = rawName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);

  return `${safeName || "page"}__${hash}`;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function disableAnimations() {
  const css = `
    *,
    *::before,
    *::after {
      animation-delay: 0s !important;
      animation-duration: 0s !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-delay: 0s !important;
      transition-duration: 0s !important;
    }
  `;

  const style = document.createElement("style");
  style.setAttribute("data-screenshot-crawler", "disable-animations");
  style.textContent = css;

  const appendStyle = () => {
    document.head?.appendChild(style);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", appendStyle, { once: true });
  } else {
    appendStyle();
  }
}

function printSiteSummary(totalUrls: number, successCount: number, failures: CaptureFailure[]) {
  console.log("");
  console.log("Site summary");
  console.log(`Total URLs: ${totalUrls}`);
  console.log(`Success count: ${successCount}`);

  if (failures.length === 0) {
    console.log("Failed URLs: none");
    return;
  }

  console.log("Failed URLs:");
  for (const failure of failures) {
    console.log(`- ${failure.url} (${failure.viewport}): ${failure.reason}`);
  }
}

function printOverallSummary(results: SiteResult[]) {
  const totalUrls = results.reduce((sum, result) => sum + result.urls.length, 0);
  const successCount = results.reduce((sum, result) => sum + result.successCount, 0);
  const failures = results.flatMap((result) =>
    result.failures.map((failure) => ({
      site: result.site.id,
      ...failure,
    }))
  );

  console.log("");
  console.log("Overall screenshot summary");
  console.log(`Sites: ${results.length}`);
  console.log(`Total URLs: ${totalUrls}`);
  console.log(`Success count: ${successCount}`);

  if (failures.length === 0) {
    console.log("Failed URLs: none");
    return;
  }

  console.log("Failed URLs:");
  for (const failure of failures) {
    console.log(`- ${failure.site}: ${failure.url} (${failure.viewport}): ${failure.reason}`);
  }
}

function printUsage() {
  console.log(`Usage:
  npm run screenshots -- --site <site-id>
  npm run screenshots -- --site <site-id> --base-url http://127.0.0.1:3002 --sitemap-url http://127.0.0.1:3002/sitemap.xml
  npm run screenshots -- --all`);
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string, configPath: string) {
  const field = value[key];

  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`Invalid site config at ${configPath}: ${key} must be a non-empty string.`);
  }

  return field.trim();
}

function readStringArray(value: Record<string, unknown>, key: string, configPath: string) {
  const field = value[key];

  if (!Array.isArray(field) || field.length === 0 || field.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid site config at ${configPath}: ${key} must be a non-empty string array.`);
  }

  return field.map((item) => item.trim()).filter(Boolean);
}

function readViewportArray(value: Record<string, unknown>, key: string, configPath: string) {
  const values = readStringArray(value, key, configPath);

  for (const viewportName of values) {
    if (!isViewportName(viewportName)) {
      throw new Error(`Invalid site config at ${configPath}: unknown viewport "${viewportName}".`);
    }
  }

  return values as ViewportName[];
}

function isViewportName(value: string): value is ViewportName {
  return value === "desktop" || value === "mobile";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
