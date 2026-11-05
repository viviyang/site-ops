import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import yaml from "js-yaml";

type Locale = "en" | "zh";
type Topic = "seo" | "ai-growth" | "ai-engineering";
type PublishType = "technical-article" | "journal" | "weekly-update";
type SiteCollection = "blog" | "journal";
type ChannelAction = "draft" | "publish" | "manual" | "skip";

type CliOptions = {
  envFile: string;
  sourceDir: string;
  siteDir: string;
  dryRun: boolean;
  overwrite: boolean;
  wechatMode: "none" | "draft" | "publish";
};

type ParsedNote = {
  filePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
};

type EligibleNote = {
  filePath: string;
  body: string;
  title: string;
  description: string;
  date: string;
  slug: string;
  translationKey: string;
  locale: Locale;
  tags: string[];
  topic: Topic;
  type: PublishType;
  siteAction: ChannelAction;
  coverPath: string;
  coverThumbMediaId: string;
  externalTargets: ExternalTarget[];
};

type ExternalTarget = {
  channel: "wechat" | "devto" | "medium";
  action: ChannelAction;
};

type GeneratedSiteDraft = {
  note: EligibleNote;
  collection: SiteCollection;
  targetPath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  warnings: string[];
  hasConflict: boolean;
};

type RunResult = {
  scannedFiles: string[];
  skipped: SkippedNote[];
  drafts: GeneratedSiteDraft[];
  wechat: WeChatRunItem[];
  errors: string[];
};

type SkippedNote = {
  filePath: string;
  reasons: string[];
};

type WeChatRunItem = {
  note: EligibleNote;
  requestedAction: ChannelAction;
  effectiveAction: "skipped" | "draft" | "publish";
  status: "planned" | "skipped" | "draft-created" | "publish-submitted" | "failed";
  mediaId?: string;
  publishId?: string;
  articleId?: string;
  reason?: string;
};

type WeChatConfig = {
  appId: string;
  appSecret: string;
  author: string;
  defaultCoverPath: string;
  defaultThumbMediaId: string;
  siteBaseUrl: string;
};

type WeChatTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

const defaultSourceDir = path.resolve(process.cwd(), "..", "..", "Obsidian Vault", "20-Content");
const defaultSiteDir = path.resolve(process.cwd(), "..", "weiwei-blog");
const supportedTopics = new Set<Topic>(["seo", "ai-growth", "ai-engineering"]);
const supportedTypes = new Set<PublishType>(["technical-article", "journal", "weekly-update"]);
const supportedActions = new Set<ChannelAction>(["draft", "publish", "manual", "skip"]);

async function main() {
  const args = process.argv.slice(2);
  const envFile = readEnvFileArg(args);

  loadLocalEnv(envFile);

  const options = parseArgs(args, envFile);
  const result = await runPipeline(options);

  printSummary(result, options);

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

function readEnvFileArg(args: string[]) {
  const envFileIndex = args.indexOf("--env-file");
  const explicitEnvFile = envFileIndex >= 0 ? args[envFileIndex + 1] : undefined;

  if (explicitEnvFile && !explicitEnvFile.startsWith("--")) {
    return path.resolve(explicitEnvFile);
  }

  return path.resolve(process.cwd(), ".env.local");
}

function loadLocalEnv(envFile: string) {
  dotenv.config({ path: envFile, quiet: true });
}

function parseArgs(args: string[], envFile: string): CliOptions {
  const options: CliOptions = {
    envFile,
    sourceDir: process.env.OBSIDIAN_PUBLISH_SOURCE_DIR
      ? path.resolve(process.env.OBSIDIAN_PUBLISH_SOURCE_DIR)
      : defaultSourceDir,
    siteDir: process.env.WEIWEI_BLOG_DIR ? path.resolve(process.env.WEIWEI_BLOG_DIR) : defaultSiteDir,
    dryRun: true,
    overwrite: false,
    wechatMode: "none",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--source-dir") {
      options.sourceDir = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--site-dir") {
      options.siteDir = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--env-file") {
      options.envFile = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--write") {
      options.dryRun = false;
      continue;
    }

    if (arg === "--overwrite") {
      options.overwrite = true;
      continue;
    }

    if (arg === "--wechat-draft") {
      options.wechatMode = "draft";
      continue;
    }

    if (arg === "--wechat-publish") {
      options.wechatMode = "publish";
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
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

async function runPipeline(options: CliOptions): Promise<RunResult> {
  await assertDirectory(options.siteDir, "site directory");

  const scannedFiles = await discoverMarkdownFiles(options.sourceDir);
  const skipped: SkippedNote[] = [];
  const drafts: GeneratedSiteDraft[] = [];
  const wechat: WeChatRunItem[] = [];
  const errors: string[] = [];

  for (const filePath of scannedFiles) {
    const parsed = await readNote(filePath);
    const validation = validateNote(parsed);

    if (!validation.note) {
      skipped.push({ filePath, reasons: validation.reasons });
      continue;
    }

    if (validation.note.siteAction === "draft") {
      const draft = await createSiteDraft(validation.note, options.siteDir);

      drafts.push(draft);

      if (draft.hasConflict && !options.overwrite) {
        errors.push(`Target already exists: ${draft.targetPath}`);
        continue;
      }

      if (!options.dryRun) {
        await writeSiteDraft(draft, options.overwrite);
      }
    }

    const wechatItem = await handleWeChatTarget(validation.note, options);
    if (wechatItem) {
      wechat.push(wechatItem);

      if (wechatItem.status === "failed") {
        errors.push(wechatItem.reason ?? `WeChat failed for ${validation.note.filePath}`);
      }
    }
  }

  return { scannedFiles, skipped, drafts, wechat, errors };
}

async function discoverMarkdownFiles(rootDir: string) {
  await assertDirectory(rootDir, "source directory");

  const files: string[] = [];

  async function visit(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
        files.push(entryPath);
      }
    }
  }

  await visit(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

async function assertDirectory(dirPath: string, label: string) {
  try {
    await access(dirPath);
  } catch {
    throw new Error(`Cannot access ${label}: ${dirPath}`);
  }
}

async function readNote(filePath: string): Promise<ParsedNote> {
  const source = await readFile(filePath, "utf8");
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);

  if (!match) {
    return { filePath, frontmatter: {}, body: source.trim() };
  }

  const parsed = yaml.load(match[1]);
  const frontmatter = isRecord(parsed) ? parsed : {};
  const body = source.slice(match[0].length).trim();

  return { filePath, frontmatter, body };
}

function validateNote(parsed: ParsedNote): { note?: EligibleNote; reasons: string[] } {
  const reasons: string[] = [];
  const { frontmatter } = parsed;

  if (frontmatter.visibility !== "public") {
    reasons.push("visibility is not public");
    return { reasons };
  }

  if (frontmatter.status !== "ready") {
    reasons.push("status is not ready");
  }

  const type = readPublishType(frontmatter.type);
  if (!type) {
    reasons.push("type must be technical-article, journal, or weekly-update");
  }

  const title = readRequiredString(frontmatter.title, "title", reasons);
  const date = readDate(frontmatter.date, reasons);
  const slug = readSlug(frontmatter.slug, reasons);
  const description = readOptionalString(frontmatter.description);
  const locale = readLocale(frontmatter.locale, reasons);
  const topic = readTopic(frontmatter.topic, type, reasons);
  const tags = readStringArray(frontmatter.tags, "tags", reasons);
  const targets = readTargets(frontmatter.targets, reasons);
  const siteAction = targets.site ?? "skip";
  const wechatAction = targets.wechat ?? "skip";

  if (siteAction === "publish") {
    reasons.push("targets.site publish is not enabled in the MVP; use draft");
  }

  if (siteAction === "manual") {
    reasons.push("targets.site manual is not supported");
  }

  if (siteAction === "skip" && wechatAction === "skip") {
    reasons.push("targets must include at least site: draft or wechat: draft/publish");
  }

  if (wechatAction !== "skip" && locale !== "zh") {
    reasons.push("wechat target requires locale: zh");
  }

  if (wechatAction === "manual") {
    reasons.push("targets.wechat manual is not supported");
  }

  if (parsed.body.length === 0) {
    reasons.push("body is empty");
  }

  if (reasons.length > 0 || !type || !title || !date || !slug || !locale || !topic) {
    return { reasons };
  }

  return {
    reasons,
    note: {
      filePath: parsed.filePath,
      body: parsed.body,
      title,
      description,
      date,
      slug,
      translationKey: readOptionalString(frontmatter.translationKey) || slug,
      locale,
      tags,
      topic,
      type,
      siteAction,
      coverPath: readCoverPath(frontmatter.cover),
      coverThumbMediaId: readCoverThumbMediaId(frontmatter.cover),
      externalTargets: readExternalTargets(targets),
    },
  };
}

function readPublishType(value: unknown): PublishType | undefined {
  return typeof value === "string" && supportedTypes.has(value as PublishType) ? (value as PublishType) : undefined;
}

function readRequiredString(value: unknown, fieldName: string, reasons: string[]) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  reasons.push(`${fieldName} is required`);
  return undefined;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readDate(value: unknown, reasons: string[]) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  reasons.push("date must use YYYY-MM-DD");
  return undefined;
}

function readSlug(value: unknown, reasons: string[]) {
  const slug = typeof value === "string" ? value.trim() : "";

  if (/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return slug;
  }

  reasons.push("slug must be kebab-case letters, numbers, and hyphens");
  return undefined;
}

function readLocale(value: unknown, reasons: string[]) {
  if (value === "en" || value === "zh") {
    return value;
  }

  reasons.push("locale must be en or zh");
  return undefined;
}

function readTopic(value: unknown, type: PublishType | undefined, reasons: string[]) {
  if (type !== "technical-article") {
    return "ai-engineering";
  }

  if (typeof value === "string" && supportedTopics.has(value as Topic)) {
    return value as Topic;
  }

  reasons.push("topic must be seo, ai-growth, or ai-engineering for technical articles");
  return undefined;
}

function readStringArray(value: unknown, fieldName: string, reasons: string[]) {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  reasons.push(`${fieldName} must be a string array`);
  return [];
}

function readTargets(value: unknown, reasons: string[]) {
  const targets: Partial<Record<"site" | "wechat" | "devto" | "medium", ChannelAction>> = {};

  if (!isRecord(value)) {
    reasons.push("targets must include site: draft for the MVP");
    return targets;
  }

  for (const channel of ["site", "wechat", "devto", "medium"] as const) {
    const action = value[channel];

    if (action === undefined) {
      continue;
    }

    if (typeof action !== "string" || !supportedActions.has(action as ChannelAction)) {
      reasons.push(`targets.${channel} must be draft, publish, manual, or skip`);
      continue;
    }

    targets[channel] = action as ChannelAction;
  }

  return targets;
}

function readCoverPath(value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  return typeof value.path === "string" ? value.path.trim() : "";
}

function readCoverThumbMediaId(value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  return typeof value.thumbMediaId === "string" ? value.thumbMediaId.trim() : "";
}

function readExternalTargets(targets: Partial<Record<"site" | "wechat" | "devto" | "medium", ChannelAction>>) {
  const externalTargets: ExternalTarget[] = [];

  for (const channel of ["wechat", "devto", "medium"] as const) {
    const action = targets[channel] ?? "skip";

    if (action !== "skip") {
      externalTargets.push({ channel, action });
    }
  }

  return externalTargets;
}

async function createSiteDraft(note: EligibleNote, siteDir: string): Promise<GeneratedSiteDraft> {
  const collection = siteCollectionFor(note.type);
  const targetPath = path.join(siteDir, "content", collection, `${note.slug}.mdx`);
  const frontmatter = siteFrontmatterFor(note, collection);
  const warnings = collectWarnings(note);
  const hasConflict = await fileExists(targetPath);

  return {
    note,
    collection,
    targetPath,
    frontmatter,
    body: note.body,
    warnings,
    hasConflict,
  };
}

function siteCollectionFor(type: PublishType): SiteCollection {
  return type === "technical-article" ? "blog" : "journal";
}

function siteFrontmatterFor(note: EligibleNote, collection: SiteCollection) {
  const common = {
    title: note.title,
    description: note.description,
    date: note.date,
    tags: note.tags,
    slug: note.slug,
    translationKey: note.translationKey,
    locale: note.locale,
    featured: false,
    published: false,
  };

  if (collection === "blog") {
    return {
      ...common,
      topic: note.topic,
    };
  }

  return common;
}

function collectWarnings(note: EligibleNote) {
  const warnings: string[] = [];

  if (note.description.length === 0) {
    warnings.push("description is empty");
  }

  if (note.body.includes("[[")) {
    warnings.push("body contains Obsidian wiki links or embeds that may need manual conversion");
  }

  for (const target of note.externalTargets) {
    if (target.channel !== "wechat") {
      warnings.push(`external target ${target.channel}:${target.action} is deferred`);
    }
  }

  return warnings;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeSiteDraft(draft: GeneratedSiteDraft, overwrite: boolean) {
  if (draft.hasConflict && !overwrite) {
    return;
  }

  await mkdir(path.dirname(draft.targetPath), { recursive: true });
  await writeFile(draft.targetPath, formatMdx(draft.frontmatter, draft.body), "utf8");
}

async function handleWeChatTarget(note: EligibleNote, options: CliOptions): Promise<WeChatRunItem | undefined> {
  const target = note.externalTargets.find((item) => item.channel === "wechat");

  if (!target) {
    return undefined;
  }

  if (target.action !== "draft" && target.action !== "publish") {
    return {
      note,
      requestedAction: target.action,
      effectiveAction: "skipped",
      status: "skipped",
      reason: `wechat:${target.action} is not supported by the CLI`,
    };
  }

  if (options.wechatMode === "none") {
    return {
      note,
      requestedAction: target.action,
      effectiveAction: "skipped",
      status: options.dryRun ? "planned" : "skipped",
      reason: `pass --wechat-${target.action === "publish" ? "publish" : "draft"} to call WeChat`,
    };
  }

  const effectiveAction = options.wechatMode === "publish" && target.action === "publish" ? "publish" : "draft";

  if (options.dryRun) {
    return {
      note,
      requestedAction: target.action,
      effectiveAction,
      status: "planned",
    };
  }

  try {
    const config = readWeChatConfig();
    const accessToken = await getWeChatAccessToken(config);
    const thumbMediaId = await getWeChatThumbMediaId(note, config, accessToken);
    const mediaId = await createWeChatDraft(note, config, accessToken, thumbMediaId);

    if (effectiveAction === "draft") {
      const item: WeChatRunItem = {
        note,
        requestedAction: target.action,
        effectiveAction,
        status: "draft-created",
        mediaId,
      };

      await writeWeChatState(item);
      return item;
    }

    const publishId = await submitWeChatPublish(accessToken, mediaId);
    const item: WeChatRunItem = {
      note,
      requestedAction: target.action,
      effectiveAction,
      status: "publish-submitted",
      mediaId,
      publishId,
    };

    await writeWeChatState(item);
    return item;
  } catch (error) {
    return {
      note,
      requestedAction: target.action,
      effectiveAction,
      status: "failed",
      reason: errorMessage(error),
    };
  }
}

function readWeChatConfig(): WeChatConfig {
  const appId = readEnv("WECHAT_APP_ID");
  const appSecret = readEnv("WECHAT_APP_SECRET");

  return {
    appId,
    appSecret,
    author: process.env.WECHAT_AUTHOR?.trim() || "Weiwei Yang",
    defaultCoverPath: process.env.WECHAT_DEFAULT_COVER_PATH?.trim() || "",
    defaultThumbMediaId: process.env.WECHAT_DEFAULT_THUMB_MEDIA_ID?.trim() || "",
    siteBaseUrl: normalizeBaseUrl(process.env.WEIWEI_SITE_BASE_URL?.trim() || "https://yangweiwei.dev"),
  };
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.local or the process environment.`);
  }

  return value;
}

async function getWeChatAccessToken(config: WeChatConfig) {
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("secret", config.appSecret);

  const response = await fetch(url);
  const payload = (await response.json()) as WeChatTokenResponse;

  if (!response.ok || payload.errcode || !payload.access_token) {
    throw new Error(`WeChat access_token failed: ${formatWeChatError(payload, response.status)}`);
  }

  return payload.access_token;
}

async function getWeChatThumbMediaId(note: EligibleNote, config: WeChatConfig, accessToken: string) {
  if (note.coverThumbMediaId) {
    return note.coverThumbMediaId;
  }

  if (config.defaultThumbMediaId) {
    return config.defaultThumbMediaId;
  }

  const coverPath = resolveCoverPath(note.coverPath || config.defaultCoverPath, note.filePath);

  if (!coverPath) {
    throw new Error("Missing cover image. Set cover.path in frontmatter or WECHAT_DEFAULT_COVER_PATH in .env.local.");
  }

  return uploadWeChatPermanentThumb(accessToken, coverPath);
}

function resolveCoverPath(coverPath: string, sourceFilePath: string) {
  if (!coverPath) {
    return "";
  }

  return path.isAbsolute(coverPath) ? coverPath : path.resolve(path.dirname(sourceFilePath), coverPath);
}

async function uploadWeChatPermanentThumb(accessToken: string, coverPath: string) {
  const bytes = await readFile(coverPath);
  const fileName = path.basename(coverPath);
  const formData = new FormData();
  const blob = new Blob([bytes], { type: mimeTypeFor(fileName) });
  const url = new URL("https://api.weixin.qq.com/cgi-bin/material/add_material");

  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("type", "thumb");
  formData.set("media", blob, fileName);

  const response = await fetch(url, { method: "POST", body: formData });
  const payload = (await response.json()) as { media_id?: string; errcode?: number; errmsg?: string };

  if (!response.ok || payload.errcode || !payload.media_id) {
    throw new Error(`WeChat cover upload failed: ${formatWeChatError(payload, response.status)}`);
  }

  return payload.media_id;
}

async function createWeChatDraft(note: EligibleNote, config: WeChatConfig, accessToken: string, thumbMediaId: string) {
  const url = new URL("https://api.weixin.qq.com/cgi-bin/draft/add");
  const collection = siteCollectionFor(note.type);
  const content = await renderWeChatHtml(note);

  url.searchParams.set("access_token", accessToken);

  const response = await postWechatJson(url, {
    articles: [
      {
        title: note.title,
        author: config.author,
        digest: truncateText(note.description || firstParagraph(note.body), 120),
        content,
        content_source_url: `${config.siteBaseUrl}/${note.locale}/${collection}/${note.slug}`,
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  });

  const mediaId = typeof response.media_id === "string" ? response.media_id : "";

  if (!mediaId) {
    throw new Error("WeChat draft creation did not return media_id.");
  }

  return mediaId;
}

async function submitWeChatPublish(accessToken: string, mediaId: string) {
  const url = new URL("https://api.weixin.qq.com/cgi-bin/freepublish/submit");
  url.searchParams.set("access_token", accessToken);

  const response = await postWechatJson(url, { media_id: mediaId });
  const publishId = typeof response.publish_id === "string" ? response.publish_id : "";

  if (!publishId) {
    throw new Error("WeChat publish submit did not return publish_id.");
  }

  return publishId;
}

async function postWechatJson(url: URL, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  const errcode = typeof payload.errcode === "number" ? payload.errcode : 0;

  if (!response.ok || errcode !== 0) {
    throw new Error(formatWeChatError(payload, response.status));
  }

  return payload;
}

async function renderWeChatHtml(note: EligibleNote) {
  assertWechatBodySupported(note.body);

  return renderWeChatMarkdown(note.body, note.title);
}

function assertWechatBodySupported(body: string) {
  const localImage = /!\[[^\]]*]\((?!https?:\/\/)[^)]+?\)/i;

  if (localImage.test(body)) {
    throw new Error("WeChat publishing does not yet support local body images. Use remote images or remove them.");
  }

  if (body.includes("[[")) {
    throw new Error("WeChat publishing does not support Obsidian wiki links yet. Convert [[links]] to normal Markdown.");
  }
}

function renderWeChatMarkdown(markdown: string, title: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;
  let skippedTitle = false;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(renderWeChatCodeBlock(codeLines));
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();

      if (level === 1 && !skippedTitle && normalizeText(text) === normalizeText(title)) {
        skippedTitle = true;
        index += 1;
        continue;
      }

      blocks.push(renderWeChatHeading(text, level));
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];

      while (index < lines.length && /^[-*]\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(renderWeChatBulletList(items));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];

      while (index < lines.length && /^\d+\.\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(renderWeChatOrderedList(items));
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];

      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push(renderWeChatQuote(quoteLines.join(" ")));
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const current = lines[index] ?? "";
      const currentTrimmed = current.trim();

      if (
        currentTrimmed.length === 0 ||
        currentTrimmed.startsWith("```") ||
        /^(#{1,3})\s+/.test(currentTrimmed) ||
        /^[-*]\s+/.test(currentTrimmed) ||
        /^\d+\.\s+/.test(currentTrimmed) ||
        currentTrimmed.startsWith(">")
      ) {
        break;
      }

      paragraphLines.push(currentTrimmed);
      index += 1;
    }

    blocks.push(renderWeChatParagraph(paragraphLines.join(" ")));
  }

  return `<section style="font-size:16px;line-height:1.85;color:#2b2b2b;letter-spacing:0;">${blocks.join("\n")}</section>`;
}

function renderWeChatHeading(text: string, level: number) {
  const content = renderInlineMarkdown(text);

  if (level === 1) {
    return `<h1 style="font-size:22px;line-height:1.45;font-weight:700;color:#1f2933;margin:28px 0 16px;">${content}</h1>`;
  }

  if (level === 2) {
    return `<section style="margin:32px 0 14px;padding:0 0 0 12px;border-left:4px solid #2f6f61;"><strong style="font-size:18px;line-height:1.5;color:#1f2933;">${content}</strong></section>`;
  }

  return `<p style="font-size:16px;line-height:1.7;font-weight:700;color:#1f2933;margin:24px 0 10px;">${content}</p>`;
}

function renderWeChatParagraph(text: string) {
  return `<p style="font-size:16px;line-height:1.85;color:#2b2b2b;margin:0 0 16px;">${renderInlineMarkdown(text)}</p>`;
}

function renderWeChatBulletList(items: string[]) {
  return `<section style="margin:6px 0 18px;">${items
    .map(
      (item) =>
        `<p style="font-size:16px;line-height:1.75;color:#2b2b2b;margin:0 0 8px;"><span style="color:#2f6f61;font-weight:700;">•</span> ${renderInlineMarkdown(
          item
        )}</p>`
    )
    .join("")}</section>`;
}

function renderWeChatOrderedList(items: string[]) {
  return `<section style="margin:6px 0 18px;">${items
    .map(
      (item, itemIndex) =>
        `<p style="font-size:16px;line-height:1.75;color:#2b2b2b;margin:0 0 8px;"><span style="color:#2f6f61;font-weight:700;">${
          itemIndex + 1
        }.</span> ${renderInlineMarkdown(item)}</p>`
    )
    .join("")}</section>`;
}

function renderWeChatCodeBlock(lines: string[]) {
  const renderedLines = lines.length > 0 ? lines : [""];

  return `<section style="background:#f6f7f5;border:1px solid #e2e6df;border-radius:6px;padding:12px 14px;margin:14px 0 20px;">${renderedLines
    .map((line) => `<p style="font-size:14px;line-height:1.7;color:#415047;margin:0;font-family:Consolas,Menlo,monospace;">${escapeHtml(line || " ")}</p>`)
    .join("")}</section>`;
}

function renderWeChatQuote(text: string) {
  return `<section style="border-left:3px solid #c6d3cc;background:#f8faf8;padding:10px 14px;margin:14px 0 18px;"><p style="font-size:15px;line-height:1.75;color:#53635b;margin:0;">${renderInlineMarkdown(
    text
  )}</p></section>`;
}

function renderInlineMarkdown(text: string) {
  let html = escapeHtml(text);

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:700;color:#1f2933;">$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f3f1;color:#2f6f61;border-radius:4px;padding:1px 4px;font-size:90%;">$1</code>');
  html = html.replace(
    /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" style="color:#2f6f61;text-decoration:none;">$1</a>'
  );

  return html;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

async function writeWeChatState(item: WeChatRunItem) {
  const stateDir = path.join(process.cwd(), ".tmp", "publishing-state", "wechat");
  const statePath = path.join(stateDir, `${item.note.slug}.json`);

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        slug: item.note.slug,
        sourcePath: item.note.filePath,
        requestedAction: item.requestedAction,
        effectiveAction: item.effectiveAction,
        status: item.status,
        mediaId: item.mediaId,
        publishId: item.publishId,
        articleId: item.articleId,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function firstParagraph(markdown: string) {
  return markdown
    .split(/\r?\n\r?\n/)
    .map((part) => part.replace(/^#+\s+/gm, "").trim())
    .find(Boolean) ?? "";
}

function truncateText(value: string, maxLength: number) {
  const plain = value.replace(/\s+/g, " ").trim();

  return plain.length > maxLength ? plain.slice(0, maxLength - 1) : plain;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function mimeTypeFor(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  return "image/jpeg";
}

function formatWeChatError(payload: Record<string, unknown>, status: number) {
  const errcode = payload.errcode ?? status;
  const errmsg = payload.errmsg ?? "unknown error";

  return `${errcode}: ${errmsg}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatMdx(frontmatter: Record<string, unknown>, body: string) {
  const yamlText = yaml.dump(frontmatter, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
  });

  return `---\n${yamlText}---\n\n${body.trim()}\n`;
}

function printSummary(result: RunResult, options: CliOptions) {
  console.log("");
  console.log("Obsidian publishing pipeline");
  console.log(`Mode: ${options.dryRun ? "dry-run" : "write"}`);
  console.log(`Source: ${options.sourceDir}`);
  console.log(`Site: ${options.siteDir}`);
  console.log(`Env file: ${options.envFile}`);
  console.log(`WeChat mode: ${options.wechatMode}`);
  console.log("");
  console.log(`Scanned markdown files: ${result.scannedFiles.length}`);
  console.log(`Eligible site drafts: ${result.drafts.length}`);
  console.log(`WeChat items: ${result.wechat.length}`);
  console.log(`Skipped files: ${result.skipped.length}`);

  if (result.drafts.length > 0) {
    console.log("");
    console.log("Planned site drafts:");

    for (const draft of result.drafts) {
      console.log(`- ${relativePath(draft.note.filePath)} -> ${relativePath(draft.targetPath)} (${draft.collection})`);
      console.log(`  title: ${draft.note.title}`);
      console.log("  published: false");

      if (draft.hasConflict) {
        console.log("  conflict: target file already exists");
      }

      for (const warning of draft.warnings) {
        console.log(`  warning: ${warning}`);
      }
    }
  }

  if (result.wechat.length > 0) {
    console.log("");
    console.log("WeChat:");

    for (const item of result.wechat) {
      console.log(
        `- ${relativePath(item.note.filePath)}: ${item.status} (requested=${item.requestedAction}, effective=${item.effectiveAction})`
      );

      if (item.mediaId) {
        console.log(`  media_id: ${item.mediaId}`);
      }

      if (item.publishId) {
        console.log(`  publish_id: ${item.publishId}`);
      }

      if (item.reason) {
        console.log(`  reason: ${item.reason}`);
      }
    }
  }

  if (result.skipped.length > 0) {
    console.log("");
    console.log("Skipped files:");

    for (const skipped of result.skipped) {
      console.log(`- ${relativePath(skipped.filePath)}: ${skipped.reasons.join("; ")}`);
    }
  }

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors:");

    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }

  if (options.dryRun) {
    console.log("");
    console.log("Dry-run only. Add --write to generate MDX drafts.");
  }
}

function relativePath(filePath: string) {
  return path.relative(process.cwd(), filePath) || ".";
}

function printUsage() {
  console.log(`Usage:
  npm run publish:obsidian
  npm run publish:obsidian -- --dry-run
  npm run publish:obsidian -- --write
  npm run publish:obsidian -- --write --overwrite
  npm run publish:obsidian -- --write --wechat-draft
  npm run publish:obsidian -- --write --wechat-publish
  npm run publish:obsidian -- --source-dir "C:\\path\\to\\20-Content" --site-dir "C:\\path\\to\\weiwei-blog"

Default behavior is dry-run. WeChat API calls only happen with --write plus --wechat-draft or --wechat-publish.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
