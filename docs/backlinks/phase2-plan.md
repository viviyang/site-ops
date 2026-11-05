# 外链系统第二阶段：本地看板 + 每周定时检查

> 前置：第一阶段已完成（见 [`implementation-plan.md`](./implementation-plan.md)）。本文件是给执行 Agent 的规格说明，第 0 节的边界规则继续有效。
> 如有歧义，按"更保守、更少改动"的方式处理，并在交付说明里列出来。

## 0. 执行边界

- 只改 `site-ops/`。不要执行 `git commit`、`push`、`stash`、`checkout`、`reset`。不要还原或改写现有的未提交改动。
- 不要修改 `scripts/capture-screenshots.ts` 和 `scripts/publish-obsidian.ts`。
- 不新增任何依赖。Web 服务用 `node:http`，前端用原生 HTML、CSS 和 JS，不引入框架、不引入构建步骤。
- 不要发起真实的 Bright Data 请求，也不要请求真实的外链页面。测试一律用 fixture 和注入的函数。
- **不要在本机注册计划任务。** 只提供注册脚本，由用户自己执行。
- 看板的所有写入都必须调用第一阶段已有的 store、pacing、status 逻辑，不能另写一套校验。

## 1. 并发写入保护（先做）

看板服务和定时任务可能同时写数据，因此在 `store.save` 外层加文件锁：

- 锁文件为 `backlinks/.lock`，用 `open(path, "wx")` 创建，内容写入 `pid` 和时间。
- 获取不到锁时，每 200 毫秒重试一次，最多等 10 秒，超时报错。锁文件存在超过 5 分钟视为陈旧锁，可以删除。
- 读取、修改、写入必须在锁内完成：拿到锁后先重新读取磁盘上的最新数据，再应用修改，然后保存。
- 在 `.gitignore` 中追加 `backlinks/.lock`。
- 测试：两个并发写入都能成功，且都没有丢失；陈旧锁会被清理。

## 2. 本地看板

### 2.1 启动

- 新增 script：`"backlinks:ui": "tsx scripts/backlinks-ui.ts"`。
- 启动参数：`--port`，默认 `4310`。**只监听 `127.0.0.1`。**
- 启动后打印访问地址。不自动打开浏览器。

### 2.2 页面（服务端渲染 HTML，表单提交用原生 `<form>`，少量 JS 只用于筛选）

| 路径 | 内容 |
|---|---|
| `/` | 总览：每个站点各状态的数量、本周新增 / 上限、dofollow 与 nofollow 数量、外链页已收录数；下方是完整的 `due` 列表 |
| `/submissions` | 提交列表，可按站点、状态、平台筛选（URL 查询参数），按 `updatedAt` 倒序 |
| `/submissions/:id` | 详情：全部字段、`history`、最近 10 次检查；带编辑表单（状态、`backlinkUrl`、锚文本、备注、状态变更说明） |
| `/submissions/new` | 新增提交表单（与 CLI 的 `add` 参数一致）；被节奏检查拒绝时，在页面上显示原因和剩余额度。页面**不提供** `--force` |
| `/platforms` | 平台列表，以及新增平台表单 |
| `/platforms/:id` | 编辑平台字段 |
| `/sites` | 站点列表，可编辑每个站点的 `backlinks` 配置（`enabled`、`maxNewPerWeek`、`pausedUntil`、`notes`） |
| `/runs` | 最近 20 次定时任务的结果（读取第 3 节的运行记录） |

- 编辑站点配置时，只能修改 `sites/<id>.json` 中的 `backlinks` 字段。其他字段原样保留，键的顺序也保持不变。写入同样要原子化，并且在锁内完成。
- 表单校验失败时，保留用户已填写的内容，并显示具体的错误信息。
- 写入成功后用 303 重定向回详情页。
- 安全：
  - 所有输出都要做 HTML 转义。
  - POST 请求校验 `Origin` 或 `Referer` 必须是 `http://127.0.0.1:<port>` 或 `http://localhost:<port>`，否则返回 403。
  - 请求体大小上限 64KB。
- 样式：一个内联的 CSS 文件，清爽易读即可。表格可以横向滚动。状态用颜色标签区分。

### 2.3 测试

- 路由测试：启动在随机端口，覆盖以下情况：
  - 每个 GET 页面都返回 200
  - 新增提交成功
  - 节奏检查拒绝时页面显示原因
  - 编辑提交状态后 `history` 正确
  - 编辑站点配置后其他字段不变
  - 缺少 Origin 或 Origin 不对的 POST 返回 403
  - 内容中的 `<script>` 被转义
- 全部使用临时的 `SITE_OPS_ROOT`。

## 3. 每周定时任务

### 3.1 一条命令完成一次例行检查

新增 `npm run backlinks -- weekly [--site] [--dry-run]`，按顺序执行：

1. `check live --browser`
2. 收录检查：如果 `.env.local` 中配置了 `BRIGHT_DATA_API_TOKEN` 和 `BRIGHT_DATA_SERP_ZONE`，用 `brightdata` provider（保留 7 天跳过逻辑）；否则执行 `index export`，生成待查文件，留给 Agent 处理。
3. `report`
4. 把 `due` 结果写入 `reports/backlinks/latest-due.md`，每次覆盖。

运行记录：每次运行向 `backlinks/runs.jsonl` 追加一行，内容包括开始和结束时间、每一步的结果摘要和退出码、生成的文件路径。某一步失败时继续执行后续步骤，最终退出码取各步骤中的最大值。

### 3.2 Windows 计划任务注册脚本

- 新增 `scripts/backlinks/register-weekly-task.ps1`：
  - 参数：`-Day`（默认 `Monday`）、`-Time`（默认 `09:00`）、`-Unregister`。
  - 任务名为 `site-ops-backlinks-weekly`，工作目录为 `site-ops`，执行 `npm run --silent backlinks -- weekly`，输出追加到 `reports/backlinks/weekly.log`。
  - 只为当前用户注册，不需要管理员权限。
- 脚本**只写不执行**。在 README 中说明用户如何运行脚本，以及如何取消注册。

### 3.3 测试

- `weekly` 在两种情况下的分支逻辑：有 Bright Data 环境变量、没有环境变量（provider 和 fetch 都要注入）。
- 某一步失败时，后续步骤仍会执行，并写入运行记录。

## 4. Agent 流程补充（更新 `agent-guide.md`）

追加一节"每周收录检查（manual）"，内容包括：

- 找到最新的 `reports/backlinks/index-pending-*.json`。
- 用 Bright Data MCP 的 `search_engine` 逐条查询。
- 填写每条记录的 `result` 和 `reason`。
- 执行 `index import`。
- 最后执行 `due`，并向用户汇报结果。

再附上一段可以直接粘贴给 Agent 的触发 prompt。

## 5. 文档

- README：在 Backlinks 章节中追加看板的启动方式、`weekly` 命令、计划任务的注册与取消。
- `docs/project-context.md`：在 Runbook 和 Known Risks 中追加相关条目，包括：看板只监听本机地址；定时任务和看板通过文件锁避免并发写入冲突。

## 6. 验收清单（交付前逐条自查，并在交付说明中逐条回答）

1. `npm run typecheck` 通过。
2. `npm test` 全部通过，并贴出测试数量（第一阶段为 39 项）。
3. 在临时 `SITE_OPS_ROOT` 下启动看板，用 HTTP 请求实际访问每个 GET 页面，贴出状态码；完成一次新增提交和一次状态修改，并贴出修改后的 `show --json` 结果。
4. 在临时 `SITE_OPS_ROOT` 下执行 `weekly --dry-run` 和一次注入假数据的运行，贴出 `runs.jsonl` 的最后一行。
5. 注册脚本没有被执行，并贴出脚本内容的摘要。
6. `git status` 只包含原有改动、第一阶段文件和本阶段文件。
7. 没有发起真实的外部请求。
8. 列出所有偏离本计划的地方；没有偏离就写"无偏离"。

## 7. 交付说明格式

用简体中文回复：一句话总结；验收清单第 1–8 条的逐条结果；新增和修改的文件列表；偏离计划的地方与遗留问题；用户接下来需要做的事情。
