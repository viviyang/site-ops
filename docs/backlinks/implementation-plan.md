# 外链系统实施计划

> 配套计划书：[`plan.md`](./plan.md)。执行前先读计划书。
> 本文件是给执行 Agent 的规格说明。如有歧义，按"更保守、更少改动"的方式处理，并在交付说明里列出来。

## 0. 执行边界（必须遵守）

- **只改 `site-ops/` 目录。** 不要修改工作区里的其他项目和根目录文档。
- `site-ops` 里已有与本任务无关的未提交改动：`.gitignore`、`README.md`、`docs/project-context.md`、`package.json`、`package-lock.json`、`.env.local.example`、`assets/`、`scripts/publish-obsidian.ts`。
  - 不要还原、重写或格式化这些文件里已有的内容。
  - 对 `README.md`、`docs/project-context.md`、`package.json`、`.env.local.example` 只做追加式修改（新增章节、新增 script、新增环境变量）。
  - **不要执行 `git commit`、`git push`、`git stash`、`git checkout`。** 改动留在工作区里，由用户审阅后再提交。
- 不要修改 `scripts/capture-screenshots.ts` 和 `scripts/publish-obsidian.ts`。
- **不要发起真实的付费 API 调用。** 测试一律用 fixture。Bright Data provider 只需实现并通过 fixture 测试。
- 不要编造站点或外链数据。种子数据只放 2–3 条明显是示例的平台记录（见第 3.2 节），`submissions/` 下不放任何示例提交。
- 依赖：只允许新增 `cheerio`（解析 HTML）。测试使用 Node 内置的 `node:test` + `tsx`，不要引入 vitest 或 jest。
- 环境：Windows + PowerShell，Node v24。路径处理统一用 `node:path`。

## 1. 目录结构

```text
site-ops/
  backlinks/
    platforms.json                 # 平台库（数组）
    submissions/<site-id>.json     # 每个站点一个文件（数组）
    checks/<site-id>.jsonl         # 检查记录，只追加
    imports/                       # 用户放 CSV 的地方（.gitkeep）
  scripts/
    backlinks.ts                   # CLI 入口，只做参数解析和分发
    backlinks/
      types.ts
      store.ts                     # 读写 + 校验 + 原子写入
      sites.ts                     # 读取 sites/*.json（只读）
      commands/*.ts                # 每个子命令一个文件
      live-check.ts
      index-check/
        provider.ts                # 接口
        brightdata.ts
        manual.ts
      pacing.ts
      due.ts
      report.ts
      csv.ts
  tests/backlinks/
    fixtures/                      # HTML 与 SERP JSON fixture
    *.test.ts
  docs/backlinks/
    plan.md                        # 已存在
    implementation-plan.md         # 已存在
    agent-guide.md                 # 需新建
```

`reports/` 已被 gitignore，报表输出到 `reports/backlinks/`。

## 2. 数据模型（`types.ts`）

```ts
type PlatformType =
  | "directory" | "launch" | "forum" | "profile" | "guest-post"
  | "social" | "qa" | "resource-page" | "other";

type Platform = {
  id: string;                 // kebab-case，唯一
  name: string;
  url?: string;               // 平台首页或提交入口；CLI 的 platform add 要求必填，CSV 自动创建时可空
  type: PlatformType;
  domainRating?: number;      // 0-100，人工填写，可空
  requiresHuman?: boolean;    // 需要验证码、付款或人工审核账号
  reviewDays?: number;        // 预期审核天数，用于 due 判断，默认 14
  linkRel?: "dofollow" | "nofollow" | "mixed" | "unknown";
  notes?: string;
  createdAt: string;          // ISO 8601
};

type SubmissionStatus =
  | "planned" | "submitted" | "pending_review" | "live"
  | "rejected" | "lost" | "abandoned";

type Submission = {
  id: string;                 // `${siteId}--${platformId}--${n}`，n 从 1 开始，同一站点同一平台下递增
  siteId: string;
  platformId: string;
  targetUrl: string;          // 我们网站上被链接的页面
  backlinkUrl?: string;       // 外链所在的页面（上线后填写）
  anchorText?: string;        // 期望的锚文本
  status: SubmissionStatus;
  submittedBy?: string;       // "human" | "agent:<name>"
  submittedAt?: string;
  liveAt?: string;
  lastLiveCheck?: LiveCheckSummary;
  lastIndexCheck?: IndexCheckSummary;
  history: { at: string; from: SubmissionStatus | null; to: SubmissionStatus; note?: string }[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type LiveResult = "found" | "missing" | "unknown";
type IndexResult = "indexed" | "not_found" | "unknown";

type LiveCheck = {
  kind: "live"; submissionId: string; at: string;
  url: string; httpStatus?: number; method: "fetch" | "browser";
  result: LiveResult;
  links: { href: string; rel: string[]; anchorText: string }[]; // 指向本站域名的全部链接
  reason?: string;            // result 为 unknown 时必填
};

type IndexCheck = {
  kind: "index"; submissionId: string; at: string;
  target: "backlink_page" | "target_page";
  url: string; provider: "brightdata" | "manual";
  query: string; result: IndexResult; reason?: string;
};
```

`LiveCheckSummary` 和 `IndexCheckSummary` 是对最近一次检查的摘要（时间、结果、连续同类结果次数），写回 Submission，方便 `list` 和 `due` 使用，不必每次都扫描 jsonl。

### 站点节奏配置

在 `sites/<id>.json` 中新增**可选**字段（`capture-screenshots.ts` 会忽略未知字段，已确认）：

```json
"backlinks": {
  "enabled": true,
  "maxNewPerWeek": 3,
  "pausedUntil": "2026-12-01",
  "notes": "原因说明"
}
```

- 缺少 `backlinks` 字段时视为 `enabled: true`，且不设每周上限。
- `sites.ts` 只读取这些字段，不写 `sites/*.json`。

## 3. 存储层（`store.ts`）

### 3.1 规则

- 每次写入都要先通过完整校验，再原子写入：先写 `*.tmp`，再 `rename`。
- JSON 用 2 空格缩进，末尾带换行；数组按 `id` 排序，保证 diff 稳定。
- 校验内容：
  - `id` 格式和唯一性。
  - `siteId` 必须存在于 `sites/`，`platformId` 必须存在于 `platforms.json`。
  - URL 合法，且为 http 或 https 协议。
  - `targetUrl` 的域名必须与站点 `baseUrl` 的域名一致（忽略 `www.`）。
  - 状态为 `live` 时必须有 `backlinkUrl`。
  - 时间字段为 ISO 8601 格式。
- 唯一性约束：同一个 `(siteId, platformId, targetUrl)` 只能有一条未处于 `abandoned` 或 `rejected` 状态的记录。重复执行 `add` 时报错，并给出已有记录的 id。
- `checks/*.jsonl` 每行一个 JSON 对象，只追加写入。

### 3.2 种子数据

`platforms.json` 写入 2 条示例记录，`id` 以 `example-` 开头，并在 `notes` 中注明"示例，可删除"。不要猜测真实平台的 DR、审核周期等数据。

## 4. CLI（`npm run backlinks -- <command>`）

在 `package.json` 中新增两个 script：

- `"backlinks": "tsx scripts/backlinks.ts"`
- `"test": "node --import tsx --test tests/**/*.test.ts"`（如果 Windows 下 glob 不生效，改为显式列出测试文件或写一个小的测试 runner，并在交付说明里写明）

全局约定：

- 每个命令都支持 `--json`：stdout 只输出一个 JSON 对象，人类可读信息走 stderr。
- 退出码：`0` 表示成功；`1` 表示参数或校验错误；`2` 表示部分检查失败（结果仍已写入）。
- 会写入数据的命令都支持 `--dry-run`：打印将要做的改动，但不落盘。
- 参数解析手写即可（参照现有脚本的风格），不要新增 CLI 框架依赖。

| 命令 | 作用 |
|---|---|
| `platform add --id --name --url --type [--dr] [--requires-human] [--review-days] [--link-rel] [--notes]` | 新增平台 |
| `platform list [--type]` | 列出平台 |
| `add --site --platform --target-url [--status submitted] [--anchor] [--by] [--backlink-url] [--notes] [--force]` | 登记一条提交。默认状态为 `submitted`，并把 `submittedAt` 设为当前时间。会执行节奏检查 |
| `update <id> [--status] [--backlink-url] [--anchor] [--notes] [--note "<状态变更说明>"]` | 更新记录。状态变更写入 `history`；变为 `live` 时设置 `liveAt` |
| `list [--site] [--status] [--platform]` | 列表 |
| `show <id>` | 单条详情，附最近 5 次检查 |
| `check live [--site] [--id] [--browser] [--dry-run]` | 存活检查 |
| `check index [--site] [--id] [--target backlink_page\|target_page\|both] [--provider brightdata\|manual] [--force] [--dry-run]` | 收录检查 |
| `index export [--site] [--out <file>]` | manual provider：导出待查列表 |
| `index import --file <file>` | manual provider：导入结果 |
| `due [--site]` | 待跟进列表 |
| `report [--site] [--out]` | 生成 Markdown 报表，默认输出到 `reports/backlinks/<YYYY-MM-DD>.md` |
| `import-csv --file <file> [--dry-run]` | 批量导入已有记录 |
| `validate` | 校验全部数据文件 |

## 5. 节奏检查（`pacing.ts`）

在 `add` 时执行（状态为 `planned` 的记录不受限制）：

- 站点的 `backlinks.enabled === false`：拒绝写入。
- 今天早于 `pausedUntil`：拒绝写入。
- 过去 7 天内（按 `submittedAt` 计算的滚动窗口），该站点的提交数已达到 `maxNewPerWeek`：拒绝写入。
- 被拒绝时退出码为 1，并说明原因和剩余额度。加 `--force` 可以写入，但要在 `history.note` 中记录 `forced: <原因>`；`--force` 必须和 `--note` 一起使用。

## 6. 存活检查（`live-check.ts`）

- 检查对象：状态为 `submitted`、`pending_review`、`live` 或 `lost`，并且有 `backlinkUrl` 的记录。没有 `backlinkUrl` 的记录跳过，并在输出中列出。
- 默认用 `fetch` 请求，带常见浏览器 UA，超时 20 秒，跟随重定向。同一域名的请求之间至少间隔 2 秒；不同域名可以并发，最多 4 个。
- 用 `cheerio` 提取所有 `<a href>`，解析为绝对 URL，再筛选出域名属于本站的链接（忽略 `www.`）。
- 结果判定：
  - 找到指向本站的链接：`found`。记录每条链接的 `rel`（拆成数组）和锚文本（去掉首尾空白）。
  - HTTP 200 且没有找到链接：`missing`。
  - 以下情况一律记为 `unknown`，并写明 `reason`：HTTP 403/429/5xx、超时、网络错误、页面看起来是 JS 渲染（`<body>` 文本少于 200 字符，或包含常见挑战页特征，如 `cf-chl`、`captcha`）。
- `--browser`：对上述 `unknown` 的记录用 Playwright Chromium 再试一次（项目已安装 Playwright），`method` 记为 `browser`。
- 状态自动流转（必须写入 `history`，`note` 为 `auto: live check`）：
  - `submitted` 或 `pending_review` 时结果为 `found`：改为 `live`，并设置 `liveAt`。
  - `live` 状态下**连续 2 次** `missing`：改为 `lost`。
  - `lost` 状态下结果为 `found`：改回 `live`。
  - 结果为 `unknown` 时不改变状态。
- 如果找到的链接全部带 `nofollow`、`ugc` 或 `sponsored`，在输出和报表中标注出来，但不改变状态。

## 7. 收录检查（`index-check/`）

### 7.1 Provider 接口

```ts
interface IndexProvider {
  name: "brightdata" | "manual";
  check(url: string): Promise<{ result: IndexResult; query: string; reason?: string }>;
}
```

### 7.2 查询与判定

- 查询词：`site:<去掉协议后的 URL>`，例如 `site:example.com/path/page`。
- 判定：
  - SERP 自然结果中有任意一条 URL 与目标 URL 规范化后相同：`indexed`。规范化规则：小写 host、去掉 `www.`、去掉末尾 `/`、去掉 hash，保留 query。
  - SERP 请求成功，但没有匹配结果：`not_found`。
  - 请求失败、遇到验证码或解析失败：`unknown`。
- 只有**连续 2 次** `not_found`，才在报表中显示为"未收录"；只有 1 次时显示为"待确认"。

### 7.3 `brightdata` provider

- 环境变量（追加到 `.env.local.example`，值留空）：`BRIGHT_DATA_API_TOKEN=`、`BRIGHT_DATA_SERP_ZONE=`。缺少任一变量时报错退出，并提示改用 `--provider manual`。
- 请求：`POST https://api.brightdata.com/request`，请求头 `Authorization: Bearer <token>`，请求体为 `{ "zone": <zone>, "url": "https://www.google.com/search?q=<编码后的查询词>&brd_json=1", "format": "raw" }`。实现前先查阅 Bright Data 官方文档确认这个接口格式；如果与文档不一致，以文档为准，并在交付说明里写明。
- 把 SERP JSON 的解析逻辑单独抽成一个纯函数，用 fixture 测试：有匹配、无匹配、字段缺失这三种情况。
- 频率限制：同一个 URL 在 7 天内已有 `indexed` 或 `not_found` 结果时跳过（`unknown` 不算），加 `--force` 才能绕过。请求之间至少间隔 1 秒。

### 7.4 `manual` provider

- `check index --provider manual` 与 `index export` 的效果相同：输出 JSON 文件，默认路径为 `reports/backlinks/index-pending-<date>.json`，格式为 `{ items: [{ submissionId, target, url, query }] }`。
- Agent 在 Cursor 里用 Bright Data MCP 的 `search_engine` 逐条查询，把每条记录的 `result` 和 `reason` 填进去，然后执行 `index import --file`。
- `import` 时校验每一条：`submissionId` 必须存在，`result` 必须是合法枚举值；校验通过的写入 checks 并更新摘要，不合法的逐条报错。
- 在 `agent-guide.md` 中给出这一流程的完整示例。

## 8. 待跟进（`due.ts`）

`due` 输出以下几类，每类按紧急程度排序：

1. **审核超时**：状态为 `submitted` 或 `pending_review`，且 `submittedAt + reviewDays`（平台配置值，默认 14 天）早于今天。
2. **已失效**：状态为 `lost`。
3. **需要补外链地址**：状态为 `live` 但没有 `backlinkUrl`（理论上校验不允许这种情况，作为兜底），或状态为 `submitted` 且超过 7 天仍没有 `backlinkUrl`。
4. **存活检查到期**：状态为 `live` 且距上次存活检查超过 30 天；或最近一次结果为 `unknown`。
5. **收录待查**：状态为 `live`，外链页或目标页的最近一次收录结果不是 `indexed`，且距上次收录检查超过 7 天。
6. **计划中**：状态为 `planned` 的记录。附上该站点本周的剩余节奏额度。

## 9. 报表（`report.ts`）

Markdown 报表包含：

- 每个站点的汇总：各状态的数量、本周新增数 / 上限、dofollow 与 nofollow 的数量、外链页已收录数。
- `due` 的全部内容。
- 最近 7 天的状态变化（从 `history` 中提取）。
- 所有 `live` 记录的明细表：平台、外链页、目标页、`rel`、外链页收录情况、目标页收录情况、上次检查时间。

## 10. CSV 导入（`csv.ts`）

- 列：`site,platform,target_url,status,backlink_url,anchor,submitted_at,submitted_by,notes`。表头必须存在，列的顺序不限。
- 支持带引号的字段和字段内的逗号。手写一个小解析器即可，或者在交付说明里说明理由后引入一个零依赖的小库。
- 如果 `platform` 在平台库中不存在：默认报错，并列出所有缺失的平台；加 `--create-platforms` 时自动创建，`type` 设为 `other`，`url` 留空。
- 先校验全部行，再一次性写入：只要有一行出错，就一行都不写。
- 导入记录的 `history` 中写入 `note: "imported from <file>"`。
- `imports/` 下放一个 `example.csv`，只有表头和一行明显的示例数据（`site` 填 `example-site`，`--dry-run` 时会因站点不存在而报错，这是预期行为，在指南里说明）。

## 11. Agent 指南（`docs/backlinks/agent-guide.md`）

这份文档写给执行外链提交的 Agent，必须包含：

- Agent 的角色：可以在用户打开的浏览器里主动搜索、点击、翻页、填写提交表单，也可以自己查找相关的提交入口。
- 硬性规则：
  - 遇到验证码、登录、付款、额度限制或需要人工确认的步骤时，立即停止，并登记为 `planned`，在 `notes` 中写明卡在哪一步。
  - 不编造 `backlinkUrl` 或状态。
  - 提交前先执行 `npm run backlinks -- list --site <id> --platform <id> --json`，避免重复提交。
  - 被节奏检查拒绝时，不要使用 `--force`，向用户报告即可。
- 每完成一次提交，必须执行的登记命令（给出完整示例）。
- 外链上线后如何执行 `update`。
- 用 manual provider 做收录检查的完整流程（第 7.4 节）。
- 用户额外要求的查询，要与指定任务分开记录。

## 12. 测试（`tests/backlinks/`）

至少覆盖：

- `store`：校验规则（每条规则至少一个反例）、唯一性约束、原子写入后文件内容正确。测试使用临时目录，**不要读写真实的 `backlinks/` 数据**。为此，store 和 sites 的根目录需要能通过参数或环境变量 `SITE_OPS_ROOT` 注入。
- `pacing`：暂停期、每周上限、7 天滚动窗口边界、`--force` 必须带 `--note`。
- `live-check`：用 fixture HTML 测试解析和判定，覆盖以下情况：
  - 找到 dofollow 链接
  - 找到 nofollow + ugc 链接
  - 只有 `www` 不同的同域链接
  - 相对链接
  - 没有链接
  - Cloudflare 挑战页
  - 内容很少的 JS 渲染页
- 状态流转：`submitted` 到 `live`；`live` 下 1 次 `missing` 保持不变；连续 2 次 `missing` 变为 `lost`；`lost` 下 `found` 恢复为 `live`；`unknown` 不改变状态。
- 收录：URL 规范化、Bright Data SERP 解析（fixture）、7 天跳过逻辑、manual import 校验。
- `due`：每一类至少一条命中、一条不命中。时间统一通过参数注入 `now`，不要依赖系统时钟。
- `csv`：引号与逗号、有错误行时整体不写入、`--create-platforms`。

网络请求全部通过注入的 `fetch` 函数完成，测试中不发起真实请求。

## 13. 文档更新（只追加）

- `site-ops/README.md`：新增 "Backlinks" 章节，包括快速上手（5 条最常用的命令）和指向 `docs/backlinks/` 的链接。
- `site-ops/docs/project-context.md`：在 Goals、Structure、Runbook、Known Risks 中各追加 1–2 条。
- `.env.local.example`：追加两个 Bright Data 变量。

## 14. 验收清单（交付前逐条自查，并在交付说明中逐条回答）

1. `npm run typecheck` 通过。
2. `npm test` 全部通过，并贴出测试数量。
3. `npm run backlinks -- validate` 在种子数据上通过。
4. 在临时的 `SITE_OPS_ROOT` 下完成端到端演示，并贴出输出：`platform add`、`add`、超出上限时被拒绝、`update` 改为 `live`、`due`、`report`。
5. `npm run screenshots -- --site airesearchreviews --help`（或任何不联网的调用方式）仍能运行。如果该脚本没有 help，则说明你如何确认 `sites/*.json` 的读取没有受影响。
6. `git status` 的输出：除第 0 节列出的已有改动外，只包含本任务新增或修改的文件；已有改动的文件，只有追加内容，没有删改。
7. 没有发起任何真实的 Bright Data 请求或外链页请求。
8. 列出所有偏离本计划的地方及原因；没有偏离就写"无偏离"。

## 15. 交付说明格式

用简体中文回复，包含以下内容：

- 完成情况的一句话总结。
- 验收清单第 1–8 条的逐条结果。
- 新增和修改的文件列表。
- 偏离计划的地方与遗留问题。
- 用户接下来需要做的事情：在 `sites/` 中注册其他在线站点、配置节奏、准备 CSV、可选配置 Bright Data 环境变量。
