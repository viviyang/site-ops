import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { withBacklinksLock } from "./lock.js";
import { ensure, host, httpUrl, isoTime, kebab, loadSites, record } from "./sites.js";
import { indexResults, indexTargets, liveResults, platformTypes, statuses, type Check, type Platform, type Site, type Submission } from "./types.js";

function oneOf(values: readonly unknown[], value: unknown) { return values.includes(value); }
function optionalText(value: unknown) { return value === undefined || typeof value === "string"; }
function integer(value: unknown, min: number) { return Number.isSafeInteger(value) && Number(value) >= min; }
function summary(value: unknown, results: readonly string[]) {
  ensure(record(value) && isoTime(value.at) && oneOf(results, value.result) && integer(value.consecutive, 1), "Invalid check summary");
  return value;
}
function validatePlatform(p: Platform) {
  ensure(record(p) && typeof p.id === "string" && kebab.test(p.id), "Invalid platform id");
  ensure(typeof p.name === "string" && p.name.trim() && oneOf(platformTypes, p.type), "Invalid platform name or type: " + p.id);
  if (p.url !== undefined) httpUrl(p.url);
  ensure(p.domainRating === undefined || (typeof p.domainRating === "number" && p.domainRating >= 0 && p.domainRating <= 100), "Invalid domain rating");
  ensure(p.reviewDays === undefined || integer(p.reviewDays, 0), "Invalid review days");
  ensure(p.requiresHuman === undefined || typeof p.requiresHuman === "boolean", "Invalid requiresHuman");
  ensure(p.linkRel === undefined || oneOf(["dofollow", "nofollow", "mixed", "unknown"], p.linkRel), "Invalid platform rel");
  ensure(isoTime(p.createdAt) && optionalText(p.notes), "Invalid platform timestamp or notes");
}
function validateSubmission(s: Submission, sites: Map<string, Site>, platforms: Set<string>) {
  ensure(record(s), "Expected submission object");
  const site = sites.get(s.siteId);
  ensure(site, "Unknown site: " + s.siteId);
  ensure(platforms.has(s.platformId), "Unknown platform: " + s.platformId);
  const prefix = s.siteId + "--" + s.platformId + "--";
  ensure(typeof s.id === "string" && s.id.startsWith(prefix) && /^[1-9][0-9]*$/.test(s.id.slice(prefix.length))
    && Number.isSafeInteger(Number(s.id.slice(prefix.length))), "Invalid submission id: " + s.id);
  ensure(host(s.targetUrl) === host(site.baseUrl), "Target URL must belong to " + site.id);
  if (s.backlinkUrl !== undefined) httpUrl(s.backlinkUrl);
  ensure(oneOf(statuses, s.status), "Invalid submission status: " + s.status);
  ensure(s.status !== "live" || s.backlinkUrl, "Live submission requires backlinkUrl");
  ensure([s.createdAt, s.updatedAt, s.submittedAt ?? s.createdAt, s.liveAt ?? s.createdAt].every(isoTime)
    && s.submittedAt !== null && s.liveAt !== null, "Invalid submission timestamp");
  ensure(s.submittedBy === undefined || (typeof s.submittedBy === "string" && /^(human|agent:\S+)$/.test(s.submittedBy)), "Invalid submittedBy");
  ensure(optionalText(s.notes) && optionalText(s.anchorText), "Invalid notes or anchor");
  ensure(Array.isArray(s.history) && s.history.length, "Missing submission history");
  let previous = null;
  for (const event of s.history) {
    ensure(record(event) && isoTime(event.at) && event.from === previous && oneOf(statuses, event.to) && optionalText(event.note), "Invalid history event");
    previous = event.to;
  }
  ensure(previous === s.status, "History does not match status");
  if (s.lastLiveCheck !== undefined) {
    const live = summary(s.lastLiveCheck, liveResults);
    ensure(live.restricted === undefined || typeof live.restricted === "boolean", "Invalid restricted flag");
  }
  if (s.lastIndexCheck !== undefined) {
    ensure(record(s.lastIndexCheck), "Invalid index summaries");
    for (const [target, value] of Object.entries(s.lastIndexCheck)) {
      ensure(oneOf(indexTargets, target), "Invalid index target");
      httpUrl(summary(value, indexResults).url);
    }
  }
}
export function validateData(sites: Map<string, Site>, platforms: Platform[], submissions: Submission[], checks: Check[] = []) {
  const platformIds = new Set<string>();
  for (const p of platforms) {
    validatePlatform(p);
    ensure(!platformIds.has(p.id), "Duplicate platform id: " + p.id);
    platformIds.add(p.id);
  }
  const ids = new Set<string>();
  const active = new Map<string, string>();
  for (const s of submissions) {
    validateSubmission(s, sites, platformIds);
    ensure(!ids.has(s.id), "Duplicate submission id: " + s.id);
    ids.add(s.id);
    if (s.status === "abandoned" || s.status === "rejected") continue;
    const key = JSON.stringify([s.siteId, s.platformId, httpUrl(s.targetUrl).href]);
    ensure(!active.has(key), "Duplicate active submission: " + active.get(key));
    active.set(key, s.id);
  }
  for (const c of checks) {
    ensure(record(c) && ids.has(c.submissionId) && isoTime(c.at) && optionalText(c.reason), "Invalid check metadata");
    httpUrl(c.url);
    if (c.kind === "live") {
      ensure(oneOf(["fetch", "browser"], c.method) && oneOf(liveResults, c.result)
        && (c.result !== "unknown" || c.reason?.trim()) && Array.isArray(c.links), "Invalid live check");
      ensure(c.httpStatus === undefined || (integer(c.httpStatus, 100) && c.httpStatus <= 599), "Invalid HTTP status");
      for (const link of c.links) {
        ensure(record(link) && Array.isArray(link.rel) && link.rel.every(r => typeof r === "string")
          && typeof link.anchorText === "string", "Invalid live link");
        httpUrl(link.href);
      }
    } else {
      ensure(c.kind === "index" && oneOf(indexTargets, c.target) && oneOf(indexResults, c.result)
        && oneOf(["brightdata", "manual"], c.provider) && typeof c.query === "string" && c.query.trim(), "Invalid index check");
    }
  }
}
export function nextId(submissions: Submission[], siteId: string, platformId: string) {
  const prefix = siteId + "--" + platformId + "--";
  const max = submissions.reduce((n, s) => s.id.startsWith(prefix) ? Math.max(n, Number(s.id.slice(prefix.length))) : n, 0);
  return prefix + (max + 1);
}
export async function atomicWrite(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, content, { flag: "wx" });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
async function files(dir: string, ext: string) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter(entry => entry.isFile() && entry.name.endsWith(ext)).map(entry => entry.name).sort();
}
async function arrayFile(file: string): Promise<unknown[]> {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  ensure(Array.isArray(value), "Expected JSON array: " + file);
  return value;
}
function jsonArray(rows: { id: string }[]) {
  return JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)), null, 2) + "\n";
}
type Changes = { platforms?: Platform[]; submissions?: Submission[]; checks?: Check[] };

export function withStoreWrite<T>(root: string | undefined, change: (store: Store) => Promise<T>) {
  const resolved = path.resolve(root ?? process.env.SITE_OPS_ROOT ?? process.cwd());
  return withBacklinksLock(resolved, async () => change(await Store.open(resolved)));
}

export class Store {
  private constructor(public root: string, public sites: Map<string, Site>, public platforms: Platform[],
    public submissions: Submission[], public checks: Check[]) {}

  static async open(root = process.env.SITE_OPS_ROOT ?? process.cwd()) {
    root = path.resolve(root);
    const data = path.join(root, "backlinks");
    const sites = await loadSites(root);
    const platforms = await arrayFile(path.join(data, "platforms.json")) as Platform[];
    const submissions: Submission[] = [];
    const checks: Check[] = [];
    const owners = new Map<string, string>();
    for (const name of await files(path.join(data, "submissions"), ".json")) {
      const siteId = name.slice(0, -5);
      ensure(sites.has(siteId), "Unknown site in submission filename: " + name);
      for (const s of await arrayFile(path.join(data, "submissions", name))) {
        ensure(record(s) && s.siteId === siteId, "Submission stored under wrong site: " + name);
        submissions.push(s as Submission);
        if (typeof s.id === "string") owners.set(s.id, siteId);
      }
    }
    for (const name of await files(path.join(data, "checks"), ".jsonl")) {
      const siteId = name.slice(0, -6);
      ensure(sites.has(siteId), "Unknown site in check filename: " + name);
      for (const line of (await readFile(path.join(data, "checks", name), "utf8")).split(/\r?\n/)) {
        if (!line.trim()) continue;
        const c: unknown = JSON.parse(line);
        ensure(record(c) && typeof c.submissionId === "string" && owners.get(c.submissionId) === siteId, "Check stored under wrong site: " + name);
        checks.push(c as Check);
      }
    }
    validateData(sites, platforms, submissions, checks);
    return new Store(root, sites, platforms, submissions, checks);
  }

  select({ site, id }: { site?: string; id?: string } = {}) {
    ensure(site === undefined || this.sites.has(site), "Unknown site: " + site);
    const rows = this.submissions.filter(s => (!site || s.siteId === site) && (!id || s.id === id));
    ensure(id === undefined || rows.length === 1, "Unknown submission: " + id);
    return rows;
  }

  async save(changes: Changes, dryRun = false) {
    const platforms = changes.platforms ?? this.platforms;
    const submissions = changes.submissions ?? this.submissions;
    const checks = changes.checks ?? [];
    validateData(this.sites, platforms, submissions, [...this.checks, ...checks]);
    if (dryRun) return;
    const data = path.join(this.root, "backlinks");
    if (changes.platforms) await atomicWrite(path.join(data, "platforms.json"), jsonArray(platforms));
    if (changes.submissions) {
      for (const siteId of this.sites.keys()) {
        const before = jsonArray(this.select({ site: siteId }));
        const after = jsonArray(submissions.filter(s => s.siteId === siteId));
        if (before !== after) await atomicWrite(path.join(data, "submissions", siteId + ".json"), after);
      }
    }
    if (checks.length) {
      const dir = path.join(data, "checks");
      await mkdir(dir, { recursive: true });
      const owners = new Map(submissions.map(s => [s.id, s.siteId]));
      const groups = new Map<string, Check[]>();
      for (const check of checks) {
        const siteId = owners.get(check.submissionId)!;
        if (!groups.has(siteId)) groups.set(siteId, []);
        groups.get(siteId)!.push(check);
      }
      for (const [siteId, entries] of groups) {
        const file = path.join(dir, siteId + ".jsonl");
        const old = await readFile(file, "utf8").catch(error => {
          if (error.code === "ENOENT") return "";
          throw error;
        });
        await appendFile(file, (old && !old.endsWith("\n") ? "\n" : "") + entries.map(c => JSON.stringify(c)).join("\n") + "\n");
      }
    }
    this.platforms = platforms;
    this.submissions = submissions;
    this.checks.push(...checks);
  }
}
