import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "../cli.js";
import { dueLabels } from "../due.js";
import { createBrightDataProvider } from "../index-check/brightdata.js";
import type { LiveOptions } from "../live-check.js";
import { withBacklinksLock } from "../lock.js";
import { atomicWrite, Store } from "../store.js";
import { checkIndex, readBrightDataEnv } from "./check-index.js";
import { due } from "./due.js";
import { indexExport } from "./index-export.js";
import { live } from "./live.js";
import { report } from "./report.js";

type StepResult = { exitCode?: number; file?: string; summary: object };
type Step = { name: string; exitCode: number; summary: object; file?: string };
type WeeklyOptions = { live?: LiveOptions; createProvider?: typeof createBrightDataProvider };

export async function weekly(ctx: Context, options: WeeklyOptions = {}) {
  const { root } = ctx.store;
  const startedAt = ctx.now.toISOString();
  const steps: Step[] = [];
  const files: string[] = [];

  async function step(name: string, action: (fresh: Context) => Promise<StepResult>) {
    try {
      const result = await action({ ...ctx, store: await Store.open(root) });
      steps.push({ name, exitCode: result.exitCode ?? 0, summary: result.summary, file: result.file });
      if (result.file) files.push(result.file);
    } catch (error) {
      steps.push({ name, exitCode: 1, summary: { error: error instanceof Error ? error.message : String(error) } });
    }
  }

  await step("check live", async fresh => {
    const result = await live({ ...fresh, flags: { ...fresh.flags, browser: true } }, options.live);
    return { exitCode: result.exitCode, summary: { checked: result.checks?.length ?? 0, planned: result.tasks?.length ?? 0, skipped: result.skipped.length,
      unknown: result.checks?.filter(row => row.result === "unknown").length ?? 0 } };
  });
  await step("check index", async fresh => {
    const env = await readBrightDataEnv(root);
    if (env.BRIGHT_DATA_API_TOKEN?.trim() && env.BRIGHT_DATA_SERP_ZONE?.trim()) {
      const result = await checkIndex({ ...fresh, flags: { ...fresh.flags, provider: "brightdata" } },
        () => (options.createProvider ?? createBrightDataProvider)(env));
      if (!("requests" in result)) throw new Error("Unexpected index provider result");
      return { exitCode: result.exitCode, summary: { provider: "brightdata", requests: result.requests, checked: result.checks?.length ?? 0, skipped: result.skipped.length,
        unknown: result.checks?.filter(row => row.result === "unknown").length ?? 0 } };
    }
    const result = await indexExport(fresh);
    return { file: result.file, summary: { provider: "manual", pending: result.items.length, skipped: result.skipped.length } };
  });
  await step("report", async fresh => ({ file: (await report(fresh)).file, summary: { generated: !ctx.dryRun } }));
  await step("due", async fresh => {
    const result = await due(fresh);
    const file = path.join(root, "reports", "backlinks", "latest-due.md");
    const entries = Object.entries(result);
    const sections = entries.map(([key, items]) => "## " + dueLabels[key as keyof typeof dueLabels] + "\n\n" +
      (items.length ? items.map(item => "- " + [item.submissionId, item.status, item.dueSince, item.targets?.join(", "),
        item.remaining === undefined ? undefined : "剩余额度 " + (item.remaining ?? "不限"), item.pacingReason]
        .filter(Boolean).join(" · ")).join("\n") : "无"));
    if (!ctx.dryRun) await atomicWrite(file, "# 待跟进外链\n\n" + sections.join("\n\n") + "\n");
    return { file, summary: Object.fromEntries(entries.map(([key, items]) => [key, items.length])) };
  });

  const run = { startedAt, endedAt: new Date().toISOString(), site: ctx.flags.site, dryRun: ctx.dryRun, steps, files,
    exitCode: Math.max(...steps.map(result => result.exitCode)) };
  if (!ctx.dryRun) await withBacklinksLock(root, async () => {
    const file = path.join(root, "backlinks", "runs.jsonl");
    const existing = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    await appendFile(file, (existing && !existing.endsWith("\n") ? "\n" : "") + JSON.stringify(run) + "\n");
  });
  return run;
}
