# 外链登记指南

你可以在用户打开的浏览器里主动搜索、点击、翻页、查找提交入口，并在用户授权的范围内填写提交表单。用户额外要求的查询要单独记录，和指定任务的结果分开。

提交前先查重。站点和平台 ID 必须来自现有注册表和平台库：

```powershell
npm run backlinks -- list --site <id> --platform <id> --json
npm run backlinks -- platform list
```

遇到验证码、登录、付款、额度限制或需要人工确认的步骤时，立即停止。用 `add --status planned --notes "卡在人工确认"` 登记具体卡点；已有计划时用 `update <id> --notes` 补充。节奏检查拒绝时向用户报告，Agent 不使用 `--force`。如需在提交表单前检查节奏，可用对应的 `add --dry-run`。

每完成一次提交就登记。下面的大写值是占位符，请替换成实际数据：

```powershell
npm run backlinks -- add --site SITE_ID --platform PLATFORM_ID --target-url TARGET_URL --by agent:AGENT_NAME --notes "表单已确认提交"
```

如果已有计划记录，用 `update SUBMISSION_ID --status submitted --note "表单已确认提交"` 写回同一条记录。只在核实页面上线并确实链接到站点后填写外链地址；不编造状态、锚文本或 URL。

```powershell
npm run backlinks -- update SUBMISSION_ID --status live --backlink-url VERIFIED_BACKLINK_URL --note "已核实上线"
```

收录检查可走手动流程：

1. 导出待查项：`npm run backlinks -- index export --site SITE_ID --out reports/backlinks/pending.json`。也可使用 `check index --provider manual`。
2. 在 Cursor 里用 Bright Data MCP 的 `search_engine` 逐条查询 `query`。仅自然结果与目标 URL 规范化匹配时填 `indexed`；成功查询但未匹配时填 `not_found`；查询失败时填 `unknown`，在 `reason` 中写明原因。验证码或额度限制出现时立即停止；未执行的项从本次回填文件移除。
3. 保留导出项的 `submissionId`、`target`、`url`、`query`，只在原对象上补字段。例如查询失败时加 `"result": "unknown", "reason": "查询失败，未取得自然结果"`。保留外层 `{ "items": [...] }`。
4. 先预览，再导入。混合有效与无效项时，有效项会写入，逐条错误随结果返回。重试时只导入已修正的失败项。

```powershell
npm run backlinks -- index import --file reports/backlinks/pending.json --dry-run
npm run backlinks -- index import --file reports/backlinks/pending.json
```

报表中连续两次 `not_found` 才显示“未收录”。这只是搜索结果信号。若主动启用 `--provider brightdata`，需配置本地凭据且会消耗额度。写入命令均可先用 `--dry-run`；需要纯 JSON stdout 时使用 `npm run --silent backlinks -- ... --json`。退出码：`0` 成功，`1` 参数或校验错误，`2` 部分检查或导入失败且已保留有效结果。

历史 CSV 可放在 `backlinks/imports/`。先运行 `npm run backlinks -- import-csv --file backlinks/imports/example.csv --dry-run` 查看格式。示例故意使用未注册的 `example-site`，报错是预期行为。替换成真实数据后重新预览；如果需要按 CSV 补建缺失平台，显式加 `--create-platforms`。

## 每周收录检查（manual）

1. 按修改时间找到最新的 `reports/backlinks/index-pending-*.json`，核对站点和待查范围。
2. 在用户授权下用 Bright Data MCP 的 `search_engine` 逐条查询导出的 `query`。遇到验证码、登录或额度限制时停止，保留未查询项供后续处理。
3. 为已查询项填写 `result` 和 `reason`，保留导出的 ID、目标、URL 和查询词。将已完成项保存为回填文件。
4. 执行 `npm run backlinks -- index import --file PATH_TO_RESULTS`，随后执行 `npm run backlinks -- due`，向用户汇报导入、失败和待跟进项。

可直接粘贴给 Agent 的提示词：

> 找到最新的 reports/backlinks/index-pending-*.json。你可以主动用 Bright Data MCP 的 search_engine 逐条查询其中的 query。只记录实际结果，填写 result 和 reason。遇到验证码、登录或额度限制时停止。把已查询项整理为回填文件并执行 index import，再执行 due，向我汇报导入结果、失败项和待跟进事项。额外查询单独记录。
