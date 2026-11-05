import type { IncomingMessage } from "node:http";
import { add } from "../commands/add.js";
import { update } from "../commands/update.js";
import { platformAdd, platformFields } from "../commands/platform-add.js";
import { withStoreWrite, type Store } from "../store.js";
import { saveSiteConfig } from "./site-config.js";
import { platformForm, siteForm, submissionForm } from "./forms.js";
import { detailPath } from "./views.js";

export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function readForm(req: IncomingMessage) {
  const port = req.socket.localPort;
  const origins = ["http://127.0.0.1:" + port, "http://localhost:" + port];
  let source = req.headers.origin;
  if (source === undefined && req.headers.referer) {
    try { source = new URL(req.headers.referer).origin; } catch {}
  }
  if (!source || !origins.includes(source)) throw new RequestError(403, "请求来源不受信任");
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
    throw new RequestError(415, "需要使用网页表单");
  }
  const limit = 64 * 1024;
  if (Number(req.headers["content-length"]) > limit) throw new RequestError(413, "表单超过 64 KB");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) throw new RequestError(413, "表单超过 64 KB");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export async function submit(store: Store, route: string, input: URLSearchParams) {
  const detail = /^\/(submissions|platforms|sites)\/([a-z0-9-]+)$/.exec(route);
  const id = detail?.[2];
  const entered = Object.fromEntries(input);
  const submission = store.submissions.find(row => row.id === id);
  const platform = store.platforms.find(row => row.id === id);
  const site = id ? store.sites.get(id) : undefined;
  const isNew = route === "/submissions/new";
  const isSubmission = detail?.[1] === "submissions" && submission;
  const isPlatform = detail?.[1] === "platforms" && platform;
  const isSite = detail?.[1] === "sites" && site;
  if (!isNew && !isSubmission && !isPlatform && !isSite && route !== "/platforms") return {};
  try {
    const location = await withStoreWrite(store.root, async fresh => {
      const flags: Record<string, string | boolean | undefined> = Object.create(null);
      for (const key of ["id", "name", "url", "type", "dr", "review-days", "link-rel", "site", "platform", "target-url", "status", "by", "anchor", "notes", "backlink-url", "note"]) {
        const value = input.get(key);
        if (value?.trim() || (isSubmission && value === "" && ["anchor", "notes", "backlink-url"].includes(key))) flags[key] = value;
      }
      flags["requires-human"] = input.get("requires-human") === "on";
      const ctx = { store: fresh, flags, args: id ? [id] : [], dryRun: false, now: new Date() };
      if (isNew) return detailPath("submissions", (await add(ctx)).submission.id);
      if (isSubmission) return detailPath("submissions", (await update(ctx)).submission.id);
      if (isSite) {
        await saveSiteConfig(fresh, site.id, input);
        return detailPath("sites", site.id);
      }
      if (isPlatform) {
        await fresh.save({ platforms: fresh.platforms.map(row => row.id === platform.id ? { ...row, ...platformFields(ctx, false) } : row) });
        return detailPath("platforms", platform.id);
      }
      return detailPath("platforms", (await platformAdd(ctx)).platform.id);
    });
    return { location };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const body = isNew || isSubmission ? submissionForm(store, isNew ? undefined : submission, entered, message)
      : isSite ? siteForm(site, entered, message) : platformForm(isPlatform || undefined, entered, message);
    return { body };
  }
}
