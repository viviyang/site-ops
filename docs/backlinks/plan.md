# 外链系统计划书（Backlinks Tracker）

> 状态：已定稿，待实施 · 2026-11-03
> 实施细节见 [`implementation-plan.md`](./implementation-plan.md)

## 1. 要解决的问题

- 多个网站都要提交外链、更新外链、跟进审核和收录，这些信息目前散在各处。
- 一部分提交工作由 AI Agent 完成，结果没有统一写回到同一个地方。
- 不知道哪些外链已经上线、哪些已经失效、哪些页面已被 Google 收录，也不知道下一步该跟进哪条。
- 部分站点有外链节奏约束（例如 `docs/decision-log.md` 中提到的"短期不拉外链，避免不自然增长"），目前全靠记忆来执行。

## 2. 目标

1. 用一份数据统一记录所有站点的外链提交，人工和 Agent 写入同一处。
2. 自动检查外链是否还在：链接是否存在、`rel` 属性、锚文本、HTTP 状态。
3. 检查收录情况：外链所在页是否被 Google 收录，以及我们的目标页是否被收录。
4. 自动列出待跟进事项：审核超时、外链失效、到期该复查的记录。
5. 在工具层面执行每个站点的节奏约束：每周新增上限、暂停期。

## 3. 非目标（MVP 不做）

- 不自动提交外链（不填表、不注册账号）。提交仍由人或 Agent 在浏览器里完成，本系统只负责记录和检查。
- 不做全网外链发现（那是 Ahrefs / DataForSEO 的工作）。只跟踪我们自己提交过的、已知的外链。
- 不做 Web 界面、不做多用户、不部署上线。
- 不调用 Google Search Console API（以后可以作为额外的数据来源）。

## 4. 方案选择

- **放在 `site-ops` 里，作为一个新模块**：`site-ops` 本来就是多站共享运维工具，已有 `sites/*.json` 站点注册表和 TypeScript + `tsx` 工具链，外链系统可以直接复用站点注册表。
- **数据存成 Git 里的 JSON 文件**，不使用数据库：
  - 数据量小（几个站、几百条记录），JSON 足够。
  - 人和 Agent 都能直接阅读；`git diff` 就是审计记录。
  - 所有写入都通过 CLI 完成，并带校验，避免 Agent 直接手改 JSON。
  - 以后数据量变大或需要 Web 界面时，再迁移到 SQLite 或 Supabase。
- **收录检查采用可插拔的 provider**：
  - `brightdata`：脚本直接调用 Bright Data SERP API（需要在 `.env.local` 里配置 token 和 zone）。
  - `manual`：导出待查 URL 列表，由 Cursor 里的 Agent 用 Bright Data MCP 查询，再把结果导入。没有 API token 也能用。

## 5. 核心概念

- **Site**：一个我们的网站，来自 `sites/<id>.json`，可以附加可选的 `backlinks` 节奏配置。
- **Platform**：一个外链平台（目录站、论坛、个人资料页、客座文章等），所有站点共用一份平台库。
- **Submission**：某个站点在某个平台上的一次外链提交，有状态流转。
- **Check**：一次检查的结果（存活或收录），只追加、不修改。

状态流转：

```text
planned → submitted → pending_review → live → lost
                    ↘ rejected        ↗（重新上线时可回到 live）
任意状态 → abandoned
```

## 6. 使用方式（目标形态）

```bash
npm run backlinks -- add --site airesearchreviews --platform producthunt --target-url https://... --by agent:grok
npm run backlinks -- update <id> --status live --backlink-url https://...
npm run backlinks -- check live --site airesearchreviews
npm run backlinks -- check index --site airesearchreviews --provider manual
npm run backlinks -- due
npm run backlinks -- report
```

所有命令都支持 `--json` 输出，方便 Agent 解析。

## 7. 成功标准

- 现有站点的外链记录可以通过 CSV 一次导入，`validate` 校验通过。
- 对一个真实外链页执行 `check live`，能正确识别链接存在与否以及 `rel` 属性。
- `due` 能列出全部需要跟进的记录，不漏、也不误报。
- 某站点超过每周新增上限或处于暂停期时，`add` 会拒绝写入（除非显式加 `--force`）。
- Agent 只需阅读 `docs/backlinks/agent-guide.md`，就能正确登记一条提交。

## 8. 分阶段

- **阶段 1（本次实施）**：数据结构、CLI、存活检查、收录检查（两种 provider）、待跟进列表、报表、CSV 导入、Agent 指南、测试。
- **阶段 2（视使用情况再定）**：接入 GSC Links 报告、定时任务（Windows 任务计划程序或 GitHub Actions）、Canvas 看板。
- **阶段 3（可选）**：Web 界面，迁移到 Supabase。

## 9. 风险

- 部分外链页面由 JS 渲染或有反爬限制，直接 `fetch` 拿不到链接。应对：提供 `--browser` 选项（Playwright），仍失败时记为 `unknown`，不能误判为 `lost`。
- 用 SERP 判断收录本身有误差。应对：结果分为 `indexed`、`not_found`、`unknown` 三种；只连续两次 `not_found` 才算未收录，不能凭单次结果下结论。
- SERP 调用要花额度。应对：收录检查默认每条最多 7 天查一次，加 `--force` 才能绕过。
- `site-ops` 里已有未提交的 Obsidian 发布相关改动。实施时不能碰这些文件，也不能把它们一起提交。
