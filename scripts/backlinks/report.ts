import { buildDue, dueLabels } from "./due.js";
import { pacing } from "./pacing.js";
import { statuses, type Check, type Platform, type Site, type Submission } from "./types.js";

function cell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|").replace(/\r\n|[\r\n]/g, " ");
}

function relLabel(submission: Submission, check?: Extract<Check, { kind: "live" }>) {
  const summary = submission.lastLiveCheck;
  if (summary?.result !== "found" || summary.restricted === undefined) return "未知";
  const restricted = summary.restricted;
  const tokens = [...new Set(check?.links.flatMap(({ rel }) => rel) ?? [])].sort();
  const label = restricted ? "nofollow（含 ugc/sponsored）" : "dofollow";
  return tokens.length ? `${label} · ${tokens.join(", ")}` : label;
}

function indexLabel(summary: NonNullable<Submission["lastIndexCheck"]>["target_page"]) {
  if (summary?.result === "indexed") return "已收录";
  if (summary?.result === "not_found") return summary.consecutive >= 2 ? "未收录" : "待确认";
  return summary ? "未知" : "未检查";
}

export function buildReport(
  sites: readonly Site[],
  platforms: readonly Platform[],
  submissions: readonly Submission[],
  now: Date,
  checks: readonly Check[] = [],
): string {
  const recordsById = new Map(submissions.map((record) => [record.id, record]));
  const liveChecks = new Map<string, Extract<Check, { kind: "live" }>>();
  for (const check of checks) {
    if (check.kind === "live" && check.at === recordsById.get(check.submissionId)?.lastLiveCheck?.at) {
      liveChecks.set(check.submissionId, check);
    }
  }
  const lines = [
    "# 外链报表",
    "",
    `生成时间 ${now.toISOString()}`,
    "",
    "## 站点汇总",
    "",
  ];

  for (const site of sites) {
    const records = submissions.filter((record) => record.siteId === site.id);
    const live = records.filter((record) => record.status === "live");
    const { used, limit } = pacing(site, records, now);
    const statusCounts = statuses.map((status) => `${status} ${records.filter((record) => record.status === status).length}`);
    lines.push(
      `### ${cell(site.id)}`, "",
      `- 各状态：${statusCounts.join("，")}`,
      `- 过去 7 天新增 / 上限：${used} / ${limit ?? "不限"}`,
      `- dofollow：${live.filter((record) => relLabel(record).startsWith("dofollow")).length}`,
      `- nofollow（含 ugc/sponsored）：${live.filter((record) => relLabel(record).startsWith("nofollow")).length}`,
      `- 外链页已收录：${live.filter((record) => record.lastIndexCheck?.backlink_page?.result === "indexed").length}`,
      "",
    );
  }

  lines.push("## 待跟进", "");
  const due = buildDue(sites, platforms, submissions, now);
  for (const key of Object.keys(dueLabels) as (keyof typeof dueLabels)[]) {
    lines.push(`### ${dueLabels[key]}`, "");
    if (!due[key].length) lines.push("无");
    for (const item of due[key]) {
      const details = [item.dueSince, item.targets?.join(", ")];
      if (key === "planned") {
        details.push(`剩余额度 ${item.remaining ?? "不限"}`, item.pacingReason);
      }
      lines.push(`- ${cell(item.submissionId)} · ${cell(details.filter(Boolean).join(" · "))}`);
    }
    lines.push("");
  }

  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const changes = submissions.flatMap((record) => record.history
    .filter((event) => Date.parse(event.at) >= cutoff && Date.parse(event.at) <= now.getTime())
    .map((event) => ({ ...event, id: record.id })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));

  lines.push("## 最近 7 天的状态变化", "");
  if (!changes.length) lines.push("无");
  for (const { at, id, from, to, note } of changes) {
    lines.push(`- ${at} · ${cell(id)} · ${from ?? "新建"} → ${to}${note ? ` · ${cell(note)}` : ""}`);
  }

  lines.push(
    "",
    "## 已上线外链",
    "",
    "| 平台 | 外链页 | 目标页 | rel | 外链页收录 | 目标页收录 | 上次检查 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const record of submissions.filter((item) => item.status === "live")) {
    const index = record.lastIndexCheck;
    const checkTimes = [record.lastLiveCheck?.at, index?.backlink_page?.at, index?.target_page?.at]
      .filter((at): at is string => Boolean(at)).sort((a, b) => Date.parse(b) - Date.parse(a));
    const fields = [
      platforms.find((platform) => platform.id === record.platformId)?.name ?? record.platformId,
      record.backlinkUrl ?? "未填写",
      record.targetUrl,
      relLabel(record, liveChecks.get(record.id)),
      indexLabel(index?.backlink_page),
      indexLabel(index?.target_page),
      checkTimes[0] ?? "未检查",
    ];
    lines.push(`| ${fields.map(cell).join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}
