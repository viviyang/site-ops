import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Store } from "../store.js";
import { platformForm, siteForm, submissionForm } from "./forms.js";
import { readForm, RequestError, submit } from "./post.js";
import { data, overview, page, platformListView, siteListView, submissionDetail, submissionList } from "./views.js";

export function html(res: ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(page(title, body));
}

async function runs(root: string) {
  const raw = await readFile(path.join(root, "backlinks", "runs.jsonl"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return raw.split(/\r?\n/).filter(line => line.trim()).slice(-20).reverse().map(line => JSON.parse(line) as unknown);
}

export function createDashboard(root?: string) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const port = req.socket.localPort;
      if (!["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host ?? "")) {
        return html(res, 403, "不允许的主机", "");
      }
      if (req.method === "POST") {
        const form = await readForm(req);
        const result = await submit(await Store.open(root), url.pathname, form);
        if (result.location) { res.writeHead(303, { Location: result.location }); res.end(); return; }
        return html(res, result.body ? 400 : 404, result.body ? "保存失败" : "页面不存在", result.body ?? "");
      }
      if (req.method !== "GET") {
        html(res, 405, "不支持此请求方法", "");
        return;
      }
      const store = await Store.open(root);
      const pathname = url.pathname;
      if (pathname === "/") return html(res, 200, "外链总览", overview(store, new Date()));
      if (pathname === "/submissions") return html(res, 200, "提交列表", submissionList(store, url.searchParams));
      if (pathname === "/submissions/new") return html(res, 200, "新增提交", submissionForm(store));
      if (pathname === "/platforms") return html(res, 200, "平台库", platformListView(store) + platformForm());
      if (pathname === "/sites") return html(res, 200, "站点节奏", siteListView(store, id => siteForm(store.sites.get(id)!)));
      if (pathname === "/runs") return html(res, 200, "最近 20 次运行", data(await runs(store.root)));
      const detail = /^\/(submissions|platforms|sites)\/([a-z0-9-]+)$/.exec(pathname);
      if (detail?.[1] === "submissions") {
        const row = store.submissions.find(s => s.id === detail[2]);
        if (row) return html(res, 200, row.id, submissionDetail(store, row) + submissionForm(store, row));
      }
      if (detail?.[1] === "platforms") {
        const row = store.platforms.find(p => p.id === detail[2]);
        if (row) return html(res, 200, row.name, data(row) + platformForm(row));
      }
      if (detail?.[1] === "sites") {
        const site = store.sites.get(detail[2]);
        if (site) return html(res, 200, site.name, siteForm(site));
      }
      html(res, 404, "页面不存在", "");
    } catch (error) {
      if (error instanceof RequestError) {
        res.setHeader("Connection", "close");
        return html(res, error.status, error.message, "");
      }
      html(res, 500, "无法读取看板数据", "<p>请运行 backlinks validate 检查数据文件。</p>");
    }
  });
}
