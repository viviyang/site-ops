import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Site } from "./types.js";

export const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function httpUrl(value: unknown): URL {
  ensure(typeof value === "string" && /^https?:\/\//i.test(value), "Expected an HTTP(S) URL");
  const url = new URL(value);
  ensure(!url.username && !url.password, "URL credentials are not supported");
  return url;
}
export function host(url: string) {
  return httpUrl(url).hostname.replace(/^www\./, "");
}
export function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function isoTime(value: unknown): value is string {
  return typeof value === "string" && isoDate(value.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
export function localDate(now: Date) {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, "0")).join("-");
}
export function validateBacklinksConfig(config: unknown): asserts config is NonNullable<Site["backlinks"]> {
  ensure(record(config), "Invalid backlinks config");
  ensure(config.enabled === undefined || typeof config.enabled === "boolean", "Invalid enabled");
  ensure(config.maxNewPerWeek === undefined || (Number.isSafeInteger(config.maxNewPerWeek)
    && Number(config.maxNewPerWeek) >= 0), "Invalid maxNewPerWeek");
  ensure(config.pausedUntil === undefined || isoDate(config.pausedUntil), "Invalid pausedUntil");
  ensure(config.notes === undefined || typeof config.notes === "string", "Invalid pacing notes");
}
export async function loadSites(root = process.env.SITE_OPS_ROOT ?? process.cwd()) {
  const dir = path.join(root, "sites");
  const sites = new Map<string, Site>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const site: unknown = JSON.parse(await readFile(path.join(dir, entry.name), "utf8"));
    ensure(record(site) && typeof site.id === "string" && kebab.test(site.id)
      && typeof site.name === "string" && site.name.trim(), "Invalid site config: " + entry.name);
    httpUrl(site.baseUrl);
    ensure(!sites.has(site.id), "Duplicate site id: " + site.id);
    const config = site.backlinks;
    if (config !== undefined) validateBacklinksConfig(config);
    sites.set(site.id, site as Site);
  }
  return sites;
}
