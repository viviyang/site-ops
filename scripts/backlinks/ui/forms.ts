import { platformTypes, statuses, type Platform, type Site, type Submission } from "../types.js";
import type { Store } from "../store.js";
import { detailPath, esc, platformChoices, select, siteChoices } from "./views.js";

type Values = Record<string, string | undefined>;
function input(name: string, label: string, fields: Values, type = "text", required = false) {
  return `<label>${esc(label)} <input name="${esc(name)}" type="${esc(type)}" value="${esc(fields[name])}"${required ? " required" : ""}></label>`;
}
function area(name: string, label: string, fields: Values) {
  return `<label>${esc(label)}<textarea name="${esc(name)}">\n${esc(fields[name])}</textarea></label>`;
}
function checkbox(name: string, label: string, fields: Values) {
  return `<label><input type="checkbox" name="${esc(name)}"${fields[name] === "on" ? " checked" : ""}> ${esc(label)}</label>`;
}
function form(action: string, fields: string, error?: string) {
  return `<form method="post" action="${esc(action)}">${error ? '<p class="error" role="alert">' + esc(error) + "</p>" : ""}${fields}<button>保存</button></form>`;
}

export function submissionForm(store: Store, row?: Submission, entered?: Values, error?: string) {
  const fields = entered ?? {
    status: row?.status ?? "submitted", "backlink-url": row?.backlinkUrl, anchor: row?.anchorText, notes: row?.notes, by: "human",
  };
  const initial = row ? "" : select("site", "站点", [["", "请选择"], ...siteChoices(store)], fields.site) +
    select("platform", "平台", [["", "请选择"], ...platformChoices(store)], fields.platform) +
    input("target-url", "目标 URL", fields, "url", true) + input("by", "提交者", fields);
  return form(row ? detailPath("submissions", row.id) : "/submissions/new",
    initial + select("status", "状态", statuses.map(status => [status, status]), fields.status) +
    input("backlink-url", "外链 URL", fields, "url") + input("anchor", "锚文本", fields) +
    area("notes", "备注", fields) + input("note", "状态变更说明", fields), error);
}

export function platformForm(row?: Platform, entered?: Values, error?: string) {
  const fields = entered ?? {
    name: row?.name, url: row?.url, type: row?.type ?? "directory",
    dr: row?.domainRating?.toString(), "review-days": row?.reviewDays?.toString(),
    "requires-human": row?.requiresHuman ? "on" : undefined, "link-rel": row?.linkRel, notes: row?.notes,
  };
  return form(row ? detailPath("platforms", row.id) : "/platforms",
    (row ? "" : input("id", "平台 ID", fields, "text", true)) +
    input("name", "名称", fields, "text", true) + input("url", "URL", fields, "url", !row) +
    select("type", "类型", platformTypes.map(type => [type, type]), fields.type) +
    input("dr", "DR（0–100）", fields) + input("review-days", "审核天数", fields) +
    checkbox("requires-human", "需要人工操作", fields) +
    select("link-rel", "链接属性", [["", "未填写"], ...["dofollow", "nofollow", "mixed", "unknown"].map((rel): [string, string] => [rel, rel])], fields["link-rel"]) +
    area("notes", "备注", fields), error);
}
export function siteForm(site: Site, entered?: Values, error?: string) {
  const config = site.backlinks;
  const fields = entered ?? {
    enabled: config?.enabled === false ? undefined : "on", maxNewPerWeek: config?.maxNewPerWeek?.toString(),
    pausedUntil: config?.pausedUntil, notes: config?.notes,
  };
  return form(detailPath("sites", site.id),
    checkbox("enabled", "启用提交", fields) + input("maxNewPerWeek", "每周新增上限", fields) +
    input("pausedUntil", "暂停至（YYYY-MM-DD）", fields) + area("notes", "备注", fields), error);
}
