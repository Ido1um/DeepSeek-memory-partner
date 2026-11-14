# 打包清单（2026-10-29 · v7.3）

> 一句话：**功能代码全部在 `<DSMP_MEMORY_SRC>`，记忆数据全部在 `<DSMP_MEMORY_DIR>`**；
> 桥接只通过一个 junction 引用本包，工作台是包内的零依赖服务。

## 1. 两条边界

| 边界 | 位置 | 谁写 |
|---|---|---|
| 功能文件 | `<DSMP_MEMORY_SRC>\`（89 个文件 / 870 KB，不含 `node_modules`） | 我（改代码只动这里） |
| 记忆数据 | `<DSMP_MEMORY_DIR>\`（默认，可在工作台改 `dir`） | 桥接引擎在运行时写 |

桥接侧只有一处引用：

```
<DSMP_BRIDGE_DIR>\node_modules\@local\deepseek-memory  →  Junction  →  <DSMP_MEMORY_SRC>
```

也就是说：**包挪位置只需重建这一个 junction，桥接代码不动**。

## 2. 目录内容

```
DeepSeek memory\
├─ package.json            @local/deepseek-memory 0.1.0（exports: . digest config migrate engine host score facts longterm scoring）
├─ README.md               安装/使用总览
├─ PACKAGE.md              本文（打包清单与边界）
├─ src\                    引擎（17 文件）
│   ├─ store.mjs           日志/归档/窗口/检索（776 行 / 30 KB）
│   ├─ engine.mjs          轮转/注入/日终/打分入口/doctor（512 行 / 25 KB）
│   ├─ score.mjs           二维打分 I×R、复习增益、升降级（纯函数）
│   ├─ facts.mjs           硬事实抽取（主语 + 模式，user/bot）
│   ├─ longterm.mjs        事件流 longterm.jsonl + 折叠 + 影子文件
│   ├─ due.mjs            到期日解析（星期/明天/N天后/时刻）+ 提醒窗口
│   ├─ scoring-runner.mjs  classify / recordInbound / settle / search（off/shadow/write）
│   ├─ card.mjs            事实卡投影（hard 全留 → 高分 long → 新近 long）+ 备份轮转
│   ├─ policy.mjs          会话三态（deny > 白名单 > 暂停 > 显式 > 默认）
│   ├─ token.mjs           真实 token / 三级窗口 / 轮转判据（0.7×窗口，无年龄）
│   ├─ doctor.mjs          十项自检（长期库/影子/卡/备份/token/策略/墓碑）
│   ├─ invalidate.mjs      作废与撤销（侧车墓碑 + 审计 + supersedes 连坐）
│   ├─ digest.mjs          模型摘要与事实卡
│   ├─ config.mjs          配置读取与默认值
│   ├─ host.mjs            宿主契约 + null host
│   ├─ migrate.mjs         旧数据迁移
│   └─ mcp-server.mjs      MCP 工具（qq_memory_search / qq_memory_recall）
├─ test\                   104 场景 / 10 套件：memory 1（内含 20 断言） + engine 9 + score 23 + scoring 11 + v7 18 + due 11 + v8 8 + v8b 6 + v8c 7 + v8d 5
├─ workbench\              记忆工作台 v1.4（11 文件；含 public\starmap.js 记忆星图）
│   ├─ server.mjs          零依赖 http，127.0.0.1:7351
│   ├─ public\index.html   单页（左侧导航、深浅色、字号、自适应 9 档）
│   ├─ config.json         目标配置（含 dir / scoring / policies）
│   ├─ start.cmd           双击启动（前台窗口）
│   ├─ open.mjs            一键启动：没起服务就后台起，就绪后开浏览器
│   ├─ open.vbs            无窗口包装，供开始菜单快捷方式调用
│   ├─ icon.ico            快捷方式图标（teal「忆」）
│   ├─ stop.cmd / stop.ps1 停止后台服务
│   ├─ README.md           界面与接口说明
│   └─ backup\             「应用到线上」前的 config.json 备份
├─ scripts\                辅助脚本（8 文件）：memory-cli.mjs（status/doctor/recall/card/due/invalidate/reinstate/search/describe）、backfill-longterm.mjs（旧记忆回填，默认 dry-run）、安装与迁移脚本
├─ docs\                   方案与交接文档（10 文件，当前主线：记忆方案-v7.md）
├─ shadow\                 阶段 2 影子对比数据
├─ examples\  scratch\     示例与草稿
└─ node_modules\           依赖（@modelcontextprotocol/sdk、js-yaml、zod）
```

记忆数据目录（默认）：

```
dsmp-memory\
├─ profile.md              长期事实卡（1500 字上限）
├─ raw\hot\<日期>\*.jsonl  7 天原文日志
├─ raw\archive\<月份>\     归档
├─ digests\                交接摘要
├─ state\                  memory.json / sessions 状态 / facts-invalidated.json
│                           longterm.jsonl（已回填 27 条历史事实；write 模式起继续追加）
│                           scoring-shadow.jsonl + scoring-shadow-stats.json + scoring-dryrun.json（影子采样与日终预览）
├─ logs\                   bridge.log / token-usage.jsonl / facts-audit.jsonl / scoring.log（每条入站一行：候选/写入/原文）
└─ dsh-memories\           DSH 记忆库投影
```

## 3. 怎么跑

```powershell
# 工作台：日常点开始菜单「记忆工作台」（open.vbs → open.mjs，自动起服务 + 开浏览器）

# 手动起（前台，关窗口即停）
& '<DSMP_BRIDGE_DIR>\tools\node-runtime\bin\node.exe' `
  '<DSMP_MEMORY_SRC>\workbench\server.mjs' --port 7351

# 或双击 workbench\start.cmd；只起服务不开浏览器：
$env:WORKBENCH_NO_OPEN='1'
& '<DSMP_BRIDGE_DIR>\tools\node-runtime\bin\node.exe' `
  '<DSMP_MEMORY_SRC>\workbench\open.mjs'
```

打开 `http://127.0.0.1:7351`；顶栏「控制台」按钮会打开桥接控制台
`http://127.0.0.1:3100/?token=…`（令牌从桥接 `consoleToken` 或 `state/console-token` 读取，只在本机页面出现）。

## 4. 测试（2026-10-29 实跑，共 94 场景全过）

| 项 | 命令 | 结果 |
|---|---|---|
| 记忆库场景 | `node test/memory.test.mjs` | 20/20 通过 |
| 引擎场景 | `node --test test/engine.test.mjs` | 9/9 通过（轮转判据/冷却/保底/注入/日终） |
| 二维打分 | `node --test test/score.test.mjs` | 23/23 通过 |
| 入站与落盘 | `node --test test/scoring.test.mjs` | 9/9 通过（off/shadow/write、mention 折叠、settle、检索） |
| 到期解析 | `node --test test/due.test.mjs` | 11/11 通过（星期/相对日/绝对日期/时刻/中文数字/提醒窗口） |
| v7 新模块 | `node --test test/v7.test.mjs` | 18/18 通过（token/policy/card/doctor/引擎三态/抽取防御） |
| 命令行 | `node scripts/memory-cli.mjs status\|doctor\|recall` | 通过；`invalidate`→侧车墓碑+审计、`reinstate` 恢复 |
| 工作台语法 | `node --check workbench/server.mjs` | 0 |
| 工作台接口 | `/api/state`、`/api/checkdir`、`/api/config`、`/api/apply`、`/api/fact` | 见 `docs\记忆方案-v7.md` §8.2 八条用例，全通过 |
| 界面设计 | `design_audit`（深/浅色、768/1280/1920/2560） | 0 violation |

## 5. 换电脑 / 换盘

1. 复制整个 `DeepSeek memory` 到新位置（含 `node_modules`；没有就 `npm i`）
2. 复制或新建记忆数据目录（默认 `<DSMP_MEMORY_DIR>`），没有就先建空目录
3. 重建 junction：`mklink /J "<桥接>\node_modules\@local\deepseek-memory" "<新包路径>"`
4. 起工作台 → 调控台「数据目录」填数据目录 → **测试** → 保存目标配置 → 应用到线上 → 重启桥接
5. 跑 §4 的四条命令确认

> 改 `dir` **不会自动搬文件**：两个目录都要自己复制；apply 只改配置。

## 6. 不打包的东西

- 桥接本体 `<DSMP_BRIDGE_DIR>`（只保留 junction 引用）
- SnowLuma / A绘世 / GPT-SoVITS（与记忆无关的可选能力）
- 备份卷 `<BACKUP_ROOT>\dsmp-memory`（计划任务产出，不随包走）
