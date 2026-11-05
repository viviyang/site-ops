import { buildDue, dueLabels } from "../due.js";
import { pacing } from "../pacing.js";
import { statuses, type Submission } from "../types.js";
import type { Store } from "../store.js";

const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, char => entities[char]);
}
export function detailPath(section: string, id: string) {
  return "/" + section + "/" + encodeURIComponent(id);
}
export function link(href: string, label: string) {
  return '<a href="' + esc(href) + '">' + esc(label) + '</a>';
}
export function data(value: unknown) {
  return "<pre>" + esc(JSON.stringify(value, null, 2)) + "</pre>";
}
export function page(title: string, body: string) {
  const nav = [["/", "总览"], ["/submissions", "提交"], ["/submissions/new", "新增提交"], ["/platforms", "平台"], ["/sites", "站点"], ["/runs", "运行记录"]];
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · 外链看板</title>
<style>
:root{font:16px/1.55 system-ui,sans-serif;color:#172334;background:#f4f6fa}
body{max-width:76rem;margin:auto;padding:1rem} nav{display:flex;gap:.5rem 1rem;flex-wrap:wrap}
a{color:#174fa6} a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid #174fa6;outline-offset:2px}
section,form,.scroll,pre{background:white;border:1px solid #d5ddea;border-radius:.5rem;padding:.8rem;margin:.8rem 0}
.scroll,pre{overflow:auto} table{width:100%;border-collapse:collapse} th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d5ddea;padding:.5rem}
pre{white-space:pre-wrap;overflow-wrap:anywhere} label{display:block;margin:.5rem 0}
input,select,textarea,button{font:inherit;padding:.25rem;max-width:100%} textarea{display:block;width:min(35rem,95%)}
.badge{display:inline-block;border-radius:1rem;background:#e3eaf5;padding:.1rem .55rem}
.live{background:#d8f4e4}.lost,.rejected{background:#ffe0df}.pending_review,.submitted{background:#fff0c5}.abandoned{background:#eceef1}
.error{color:#881e23;background:#fff0ee;border:1px solid #d89191;padding:.6rem}
</style><body><nav aria-label="主导航">${nav.map(([href, label]) => link(href, label)).join("")}</nav>
<main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

function table(headers: string[], rows: string[][]) {
  return "<div class=scroll><table><thead><tr>" + headers.map(h => "<th scope=col>" + esc(h) + "</th>").join("")
    + "</tr></thead><tbody>" + rows.map(row => "<tr>" + row.map(cell => "<td>" + cell + "</td>").join("") + "</tr>").join("")
    + "</tbody></table></div>";
}
function badge(status: string) {
  return '<span class="badge ' + esc(status) + '">' + esc(status) + "</span>";
}
export type Choice = [value: string, label: string];
export function select(name: string, label: string, choices: Choice[], value = "") {
  const options = choices.some(([key]) => key === value) || !value ? choices : [[value, value] as Choice, ...choices];
  return `<label>${esc(label)} <select name="${esc(name)}">${options.map(([key, caption]) =>
    `<option value="${esc(key)}"${key === value ? " selected" : ""}>${esc(caption)}</option>`).join("")}</select></label>`;
}
export function siteChoices(store: Store): Choice[] { return [...store.sites.values()].map(s => [s.id, s.name]); }
export function platformChoices(store: Store): Choice[] { return store.platforms.map(p => [p.id, p.name]); }

export function overview(store: Store, now: Date) {
  const sites = [...store.sites.values()];
  const summary = table(["站点", ...statuses, "7 天新增 / 上限", "dofollow", "nofollow*", "外链页已收录"], sites.map(site => {
    const rows = store.select({ site: site.id });
    const live = rows.filter(row => row.status === "live");
    const budget = pacing(site, rows, now);
    return [site.name, ...statuses.map(status => rows.filter(row => row.status === status).length),
      budget.used + " / " + (budget.limit ?? "不限"),
      live.filter(row => row.lastLiveCheck?.restricted === false && row.lastLiveCheck.result === "found").length,
      live.filter(row => row.lastLiveCheck?.restricted === true && row.lastLiveCheck.result === "found").length,
      live.filter(row => row.lastIndexCheck?.backlink_page?.result === "indexed").length].map(esc);
  }));
  const due = buildDue(sites, store.platforms, store.submissions, now);
  const sections = Object.entries(dueLabels).map(([key, label]) => {
    const items = due[key as keyof typeof due];
    return "<section><h3>" + esc(label) + "</h3>" + (items.length ? "<ul>" + items.map(item =>
      "<li>" + link(detailPath("submissions", item.submissionId), item.submissionId) + " · " +
      esc([item.status, item.dueSince, item.targets?.join(", "), item.remaining === undefined ? undefined :
        "剩余额度 " + (item.remaining ?? "不限"), item.pacingReason].filter(Boolean).join(" · ")) + "</li>").join("") + "</ul>" : "<p>无</p>") + "</section>";
  }).join("");
  return summary + "<p>* 含 ugc 和 sponsored</p><h2>待跟进</h2>" + sections;
}
export function submissionList(store: Store, query: URLSearchParams) {
  const fields: [string, string, Choice[]][] = [
    ["site", "站点", siteChoices(store)], ["status", "状态", statuses.map(s => [s, s])],
    ["platform", "平台", platformChoices(store)],
  ];
  const filter = fields.map(([name, label, choices]) => select(name, label, [["", "全部"], ...choices], query.get(name) ?? "")).join("");
  const rows = store.submissions.filter(row => fields.every(([key]) => {
    const field = key === "site" ? "siteId" : key === "platform" ? "platformId" : "status";
    return !query.get(key) || row[field] === query.get(key);
  })).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return '<form action="/submissions" method="get">' + filter + '<button>筛选</button></form>' +
    table(["提交", "站点", "平台", "状态", "目标页", "外链页", "更新时间"], rows.map(row => [
      link(detailPath("submissions", row.id), row.id), esc(row.siteId), esc(row.platformId), badge(row.status),
      esc(row.targetUrl), esc(row.backlinkUrl ?? "—"), esc(row.updatedAt),
    ]));
}
export function submissionDetail(store: Store, row: Submission) {
  const { history, ...fields } = row;
  const checks = store.checks.filter(c => c.submissionId === row.id).reverse()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 10);
  return badge(row.status) + data(fields) + "<h2>状态历史</h2>" + data(history) + "<h2>最近 10 次检查</h2>" + data(checks);
}
export function platformListView(store: Store) {
  return table(["平台", "ID", "类型", "URL", "DR", "审核天数"], store.platforms.map(p => [
    link(detailPath("platforms", p.id), p.name), esc(p.id), esc(p.type), esc(p.url), esc(p.domainRating), esc(p.reviewDays ?? 14),
  ]));
}
export function siteListView(store: Store, form: (id: string) => string = () => "") {
  return [...store.sites.values()].map(site => "<section><h2>" + esc(site.name) + "</h2><p>" +
    esc(site.id + " · " + site.baseUrl) + "</p>" + data(site.backlinks ?? {}) + form(site.id) + "</section>").join("");
}
