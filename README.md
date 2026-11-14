# DeepSeek-memory-partner（DSMP）

把「记忆引擎 + 桌面聊天面板」合并成一个 DSH 插件的单包实现。包名 `@local/dsmp`，显示名 **DeepSeek-memory-partner**。

> 当前进度：**M0 骨架 + M1/M1b 本地聊天与记忆注入 + M2 QQ 通道 + M3 媒体 + M4 历史/设置/工作台 + M5 迁移/记忆包/打包 + M6 单写者租约 + M7 搬家归位 + M8 记忆目录自包含设计 + M9 记忆写操作并入 + P1 听 QQ 语音 + B1 一键换机 + B2 面板备份/恢复 + B3 她说过的语音 + D 健壮性 + 情境索引显示修复（1.8.1）+ C 发布准备（1.9.0）+ A3 面板体检/命名统一（1.9.2）+ QQ 语音转写（1.10.0）+ QQ bridge 并入 / components 归位（2.0.0）**。侧边栏「记忆面板」+ 四页签（聊天 / 历史记录 / 记忆速览 / 设置）。
>
> **M9（1.2.0）新增**：「记忆」页签不只读，还能改——长期事实逐条「编辑 / 作废 / 恢复 / 历史（修订链）」、待确认候选「确认 / 驳回」、激活开关（enabled / emit / rankInInject / recordRetrieved / toneResidue / toneSummary / matchTokens）。所有写操作走 `POST /api/dsmp/workbench/write`，统一守卫：迁移中 409、租约非本机 409、只写 `memory.dir`、写前备份到 `backup/*.bak-dsmp-*`、写后审计到 `logs/dsmp-workbench-audit.jsonl`。
>
> **测试期规矩（主人 2026-11-06 定，2026-11-08 P2 已收口）**：M1–M6 开发期只测试、不实际接入，那时默认 `test.enabled = true`。P2 收口后 `test.enabled = false`，账本、注入与媒体都落生产目录 `<DSMP_MEMORY_DIR>`；面板直连驱动同一条 QQ 会话（`session.via = auto`），QQ 侧仍由 bridge 传输。
>
> **安装位置**：插件实体在 `<DSMP_PLUGIN_ROOT>`。旧开发路径 `<DSMP_WORKSPACE>\plugins\dsmp` 已于 2026-11-08 随旧目录一起退役，现位于 `<DSMP_WORKSPACE>\_retired\`（观察 7 天后删除）。

## English summary

**DeepSeek-memory-partner (DSMP)** is a single DeepSeek Harness plugin that bundles a long-term memory engine with a desktop chat panel. It keeps what the owner said (facts, preferences, plans, dates), injects a compact memory card into every agent step, and lets you read or edit that memory inside the Harness UI.

- **What it installs** — one host plugin (`@local/dsmp`) with a web client: a sidebar item **Chat** with four tabs (Chat / History / Memory / Settings), plus seven native `dsmp_memory_*` tools: `search`, `recall`, `window`, `write`, `edit`, `photo`, `todo`.
- **What it needs** — DeepSeek Harness `>= 0.2.1-rc.2`, Node `>= 22.13`, and no npm runtime dependencies; the memory engine ships as a vendored copy under `vendor/memory/`.
- **Three commands** (Windows, run inside the plugin folder):

  ```cmd
  :: 1) link the plugin into the desktop profile (plus bundles entry, see 安装)
  mklink /J "%DSH_HOME%\profiles\desktop\node_modules\@local\dsmp" "%CD%"
  :: 2) run the test suite
  node --test test/*.test.mjs
  :: 3) build the installable tarball
  node scripts/pack.mjs
  ```

- **Boundary** — memory lives only under the data directory you configure (`settings.memory.dir`); the panel reads and writes nothing else. QQ delivery stays with qq-bridge: DSMP queues and records, it does not send to QQ on its own. No telemetry, no outbound network calls except the local Harness and the optional local QQ bridge.

## 5 分钟上手

1. **装插件**（三种落点见下面「安装」）：`dependencies` 写 `link:`、`dsh.profile.bundles` 追加 `@local/dsmp`、在 profile 的 `node_modules\@local\dsmp` 建 junction。刷新页面，侧边栏出现「聊天」。
2. **打开面板**：点侧边栏「聊天」→「设置」→ 确认「记忆目录」指向你要用的数据目录（第一次装建议先指向一个空目录试）；「模型」选默认 provider/model。
3. **发一条本地消息**：回到「聊天」，输入「你好，记住我喜欢喝美式」并回车。回复下方应出现「记忆已注入：事实 N 条 · 卡 X 字 · 规则 Y 字」。
4. **看到记忆注入**：切到「记忆」页签 →「长期事实」应能看到这条事实（或候选）；「窗口回放」里应有刚才这一轮。用 `curl "http://127.0.0.1:<端口>/api/dsmp/memory/preview?text=我喜欢喝什么"` 可看到完整注入文本。
5. **确认工具**：在会话里让她调用 `dsmp_memory_recall`（问「我上次说的咖啡是什么」），返回应带 `⟵ 窗口…轮…` 锚点；点开「历史记录」能看到同一轮。

> 没有装 QQ bridge 也能跑完这五步——面板直连 DSH 会话，QQ 只影响「QQ 通道」卡片。

## 目录

```
plugins/dsmp
├─ package.json          # dsh.bundle.patch / dsh.client 声明
├─ cordis.patch.yml      # bundle 插入 @local/dsmp
├─ lib/index.js          # host：status / settings / roles / models / chat / memory-preview / bridge 通道
├─ lib/client.js         # web 客户端：侧栏图标 + 整页三页签
├─ lib/session-bridge.js # 会话桥：建/接管会话、followup、事件投影、测试期护栏
├─ lib/memory-context.js # 只读记忆投影：规则 + 事实卡 → 注入文本
├─ lib/bridge-client.js  # QQ 通道：x-console-token 只读、入站落盘、出站 dry-run
├─ lib/models.js         # provider / model 目录 + agentOptions
├─ lib/load.js           # 开发期 data: URL 热重载（生产不启用）
├─ lib/paths.js          # PLUGIN_ROOT / DSH_HOME
├─ lib/settings.js       # <DSH_HOME>/dsmp/settings.json
├─ lib/role.js           # 角色卡跟随（current-role.json → 面板名）
├─ lib/probe.js          # 纯 Node 端口/HTTP 探测（避开沙箱 pipe 限制）
├─ lib/lease.js          # M6 单写者租约（state/engine-lease.json）
├─ lib/memory-writer.js  # M6 记账转发落点（begin / note-spoken / finish）
├─ lib/http.js           # sendJson / readJsonBody
├─ vendor/memory/        # 记忆引擎固定副本（src/test/scripts，无 node_modules）
├─ scripts/              # check-memory-layout：记忆目录自检（只读）
├─ dev/                  # 开发辅助：toggle-bundle / verify-m1b / repair-test-encoding / normalize-layout
└─ test/dsmp.test.mjs    # 26 条用例
```

## 记忆数据布局（2026-11-07 规范化）

文本、图片、语音三个库分开，引擎要读的路径一个都不改名（详情见 `docs\记忆数据布局-20261107.md`）：

| 库 | 位置 |
| --- | --- |
| 文本 | `state\`（longterm/topics/memory/calendar…）、`raw\hot|archive\`、`window\`、`episodes\`、`digests\`、`profile.md`、`rules.md` |
| 图片 | `media\YYYY-MM\<sha1>.<ext>` + 索引 `state\media.jsonl` |
| 语音 | `voice\YYYY-MM\<sha1>.<ext>` + 索引 `state\voice.jsonl` |

自检：

```cmd
node scripts\check-memory-layout.mjs
```

检查必需目录/文件、`*.bak-*` 是否回潮、图片/语音文件数与索引是否一致。只读。

## 安装

DSH 的 profile 在 `<DSH_HOME>\profiles\desktop`（`DSH_HOME` 由启动器决定，不要假设是用户主目录下的 `.dsh`）。三个落点都要有：

1. `profiles/desktop/package.json` 的 `dependencies` 增加：
   ```json
   "@local/dsmp": "link:<DSMP_PLUGIN_ROOT>"
   ```
2. 同一个文件的 `dsh.profile.bundles` 数组追加 `"@local/dsmp"`。
3. 建立 junction：
   ```cmd
   mklink /J "<DSH_HOME>\profiles\desktop\node_modules\@local\dsmp" "<DSMP_PLUGIN_ROOT>"
   ```

也可以让 CLI 代劳（会跑 pnpm，需要能写 profile 目录）：

```cmd
"<DSH_HOME>\app\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<DSMP_PLUGIN_ROOT>"
```

装完刷新页面即可（实测 `bundles` 变更会被宿主热加载：约 2 秒卸载、4 秒重载；客户端 UI 需要刷新页面重新拉插件清单）。**用 CLI 升级/重装后仍需完全退出并重开 DSH**，热加载只对 bundle 清单的增删有效。

### 验证

```cmd
curl -s http://127.0.0.1:<当前端口>/api/dsmp/status
curl -s "http://127.0.0.1:<当前端口>/api/dsmp/memory/preview?text=hello"
```

`status` 应返回 `ok: true`、`packageName: "@local/dsmp"`、`version`（与 `package.json` 一致）、`mode`（`local` / `degraded` / `qq`）、`test.enabled` 与 `test.memoryDir`。`memory/preview` 返回即将注入的完整 prompt、各段长度与事实条数。

## 面板

- **聊天**：会话下拉 +「新建会话」+ 气泡 + Enter 发送；发送后底部显示「记忆已注入：事实 N 条 · 卡 X 字 · 规则 Y 字」。聊天页顶部有一条「QQ 通道」栏：显示最近入站记录，并有「模拟一条入站」按钮（只写 `<DSH_HOME>\dsmp\bridge-inbox.jsonl`，不进会话、不发 QQ）。
- **发图（M3）**：点「发图」、直接粘贴、或把文件拖进输入框；图片先传进本地媒体库（按 sha1 去重），发送时只带 sha1，服务端再转成 DSH 的 `ImageAttachmentRef` 交给模型。模型能真正「看见」图，不是把路径塞进文本。
- **发语音（M3）**：语音库卡片可播放本地音频（`<audio>` + HTTP Range），点「发这条」把音频作为语音发送；测试模式下只写 outbox。
- **历史记录（M4）**：以 DSH 会话日志为唯一真源，按天分组、来源徽标（QQ / 面板 / 笔记）、关键字搜索、向前翻页；图片走媒体库渲染。
- **记忆速览（M4）**：内嵌工作台十视图——长期事实 / 待裁决 / 待确认 / 主题 / 窗口 / 情境 / 月摘要 / 账单 / 激活 / 检索，不启动 7351 也能用。有未裁决冲突时，主标签与「待裁决」子页签会带条数角标。
- **设置（M4）**：运行状态、服务开关、诊断、备份与换机、模型与人设卡、记忆与工作台（「打开速览」/「启动记忆工作台」）、消费、QQ 通道；人设卡保存前自动备份原文件。

## 记忆排序：重要度分（1.14.0）

- **一个分数**：`score = 100 × W × R`。`W = 0.55×I + 0.45×档位基值 + 作者/类别/提及次数的小加成`（hard 1.0 / long 0.85 / general 0.6 / temp 0.35），`R` 仍是时间衰减；hard 不衰减。分数读取时计算，不写回 `longterm.jsonl`。
- **分档**：核心 ≥80 / 重要 60–79 / 一般 40–59 / 边缘 <40，只用于展示与筛选。
- **面板「长期事实」**：默认按分数排，`正常 → 旧事 → 已作废` 分组；每行显示分数、档位、档位名、提及次数、最近几天；顶部有「全部 / 核心 / 重要 / 一般 / 旧事 / 已作废」筛选与 50 条一页的「显示更多」。
- **检索**：`memory.scoring.ranking.applyToSearch` 默认 `false`（保留旧公式，只多回一个 `importance` 字段）。改成 `true` 后档位不再单独 ×1000，改为「结构命中 6000–8000 + 命中 500 + score×4 + 提及次数×10」——先保证问什么有什么，同一类命中里再按重要度排。打开前先用 `route-preview` 对比真实问法。
- **卡面**：注入事实卡维持 `I×1000 + 档位×100 + 提及次数` 的稳定排序，不受当天衰减影响。

## 记忆工作台（插件内置副本）

7351 的工作台整份复制进了插件：`workbench/`（`server.mjs` + `public/`，零依赖、只监听 127.0.0.1）。设置页「记忆」一行：7351 没监听时按钮是「启动记忆工作台」——先 `POST /api/dsmp/services {action:'start',name:'workbench'}` 起服务，再开浏览器；已在跑就直接「打开记忆工作台」。

- 启动脚本 `workbench/start.cmd` 用 `%DSMP_NODE%`（面板注入的当前 Node；手动双击时回落 PATH 里的 `node`），停止脚本 `workbench/stop.cmd` 走 `stop.ps1`，按命令行匹配 `workbench*server.mjs` 结束进程。
- `server.mjs` 的引擎 import 已从旧的 `../src/` 改到 `../vendor/memory/src/`；数据目录、bridge 日志、价格表仍按 `workbench/config.json` 与默认路径读，指向同一份生产记忆。
- 它与面板「记忆速览」是两套前端、同一份数据：写操作都落盘，谁先改谁生效，刷新另一侧即可看到。
- **打包时会带上它**（`scripts/pack.mjs` 的 `INCLUDE` 含 `workbench`，但排除 `workbench/config.json` 与 `.workbench-token`）：发布包同时提供速览与完整工作台。

## 会话管理：改名 / 删除（2026-11-07）

聊天页顶部（会话标题旁）有两个小按钮：

- **重命名**：点一下标题变成输入框，Enter 或「保存」生效，Esc 取消；名字存 `<DSH_HOME>\dsmp\session-meta.json`（上限 60 字），只影响面板显示，不改 DSH 里的会话。
- **删除**：第一次点变「确认删除」，再点一次才执行。删除 = 停掉内存里的 agent + 从面板列表隐藏，**DSH 会话日志原样保留在磁盘上**，随时可以清掉 `hidden` 标记恢复（`session-meta.json` 里改 `"hidden": false`）。

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsmp/chat/rename` | POST | `{sessionId,title}`，空名字拒绝 |
| `/api/dsmp/chat/delete` | POST | `{sessionId}`，只做面板隐藏 + dispose |

插件重载后内存镜像会清空，所以 `GET /api/dsmp/chat/sessions` 会扫 `<DSH_HOME>\sessions\*\<sessionId>` 把 `session-dsmp-test-*` 的会话补回列表（标题从 `session-meta.json` 取），重载不影响改名/删除/继续聊。

## 面板直发（2026-11-07）

聊天页的「当前对话」就是 QQ 正在用的那条 DSH 会话。面板里打字不会另起一个 agent，而是经 bridge 投进去：

```
面板输入 → POST /api/dsmp/chat/send
        → 命中 bridge 会话 → POST <bridge>/api/socialV2/panel-message（控制台令牌）
        → bridge 组 prompt（【来自桌面面板 · 不发 QQ】+【面板消息】<text>）→ 同一会话
        → 回复是普通 assistant 文本，不会调用任何 QQ 发送工具
```

- 开关：`settings.panel.liveSend`（默认 `true`），关掉后对当前对话发送返回 `403 面板直发未开启`。
- 当前对话不支持从面板发图（返回 400，明确提示改用测试会话），避免把图片塞进 QQ 侧流程。
- `GET /api/dsmp/history/sessions` 会向 bridge 查当前会话映射并标 `bridgeLive`，所以 `closed-agent`/`reserved2` 切模式后「当前对话」仍指向真正在用的那条。
- 会话日志解析：`【面板消息】` 之后才是主人原话；QQ 入站的整段提示按 `【管理员】…` 这类发送者行截断，气泡只显示对方说的话。

## 本地服务控制（2026-11-07）

设置页「本地服务」卡片可以手动开关三样东西，只调用已有脚本、不修改任何服务配置：

| 服务 | 端口 | 启动 | 关闭 |
| --- | --- | --- | --- |
| QQ 机器人（SnowLuma + bridge） | 3100 | `start-bot.cmd` | `stop-bot.cmd` |
| ComfyUI（ComfyUI API） | 8188 | `scripts\start-comfy-api.cmd` | `scripts\stop-comfy-api.cmd` |
| GPT-SoVITS（语音合成） | 9880 | `scripts\start-tts-api.cmd` | `scripts\stop-tts-api.cmd` |

- 按钮只对「未运行 / 运行中」做启动或关闭，启动是 `%SystemRoot%\System32\cmd.exe /c <脚本>` 分离进程（`detached`），**stdout/stderr 写到 `<DSH_HOME>\dsmp\logs\service-<name>.log`**，不再吞掉错误。
- 2026-11-07 修复：宿主（Electron）进程的环境块可能早于用户终端，`PATH` 里未必有 `WindowsPowerShell\v1.0`，脚本里的 `powershell` 会直接报「不是内部或外部命令」。现在 spawn 时显式构造 `PATH`（`C:\Program Files\PowerShell\7` → `%SystemRoot%\System32\WindowsPowerShell\v1.0` → `System32` → `%SystemRoot%` → 原 PATH 去重），并用绝对路径的 `cmd.exe`，所以面板不再依赖宿主 `PATH`。卡片上每个服务多一个「日志」按钮，失败时也会把日志末尾直接显示出来。
- 本机 PowerShell 现状（2026-11-07）：系统自带 `powershell.exe` 仍是 **5.1.26100.9444**；另装了 **PowerShell 7.6.9**（`C:\Program Files\PowerShell\7\pwsh.exe`，MSI 静默安装）。注意以后台方式跑 `winget install Microsoft.PowerShell` 会失败（`0x80070422`，本机 `wuauserv` 被禁用），MSI 安装不依赖该服务。脚本内的 `powershell` 仍解析到 5.1；要用 7 就把脚本里的 `powershell` 换成 `pwsh`（两版语法在本项目用到的命令上兼容）。
- **10 分钟空闲自动关闭**由 bridge 自己维持（`imageGen.idleStopProcessMs`、`socialV2.tts.idleStopMs` 都是 600000）；面板额外兜底：bridge 不在线时，面板启动的引擎满 10 分钟会被 `services.startIdleWatch` 关掉，避免留下没人用的进程。
- QQ 机器人已在运行时点「启动」不会重复拉起，返回 `already:true`。
- 脚本目录取自 `settings.bridge.dir`（默认 `<DSMP_BRIDGE_DIR>`），换机时改这一项即可。
- **2026-11-07 二次修复：按钮结果以前只看「脚本启动成功」，不看端口**。现在启动会等端口真正监听（bridge 最长 90s、ComfyUI 120s、其它引擎 60s），关闭会等脚本退出（`stop-bot.cmd` 约 10s）再等端口真正关闭，返回里带 `running`；没到位就回 `ok:false` + 日志末尾，不再出现「点了关闭、看着像成功、其实还在跑」。
- 关闭失败的根因在 `stop-bridge.cmd`：它原来只杀「命令行里带 `DSH-QQ-bridge` 路径」的 `cmd.exe`，但监督进程是 `cmd.exe /c start-bridge.cmd`（相对名），匹配不到 → 桥接被杀后 5 秒内被监督进程重新拉起。该脚本已改为「按脚本名匹配 + 连 `start-bot.cmd` 一起杀 + 杀监听 3100 的 pid + 三轮复查」。
- 另一个坑：`state\bridge.lock` 里记的 pid 活着但 3100 没监听（半死桥接）时，新启动会判「已有实例在运行」直接退出。`services.startService` 现在会先 `clearStaleLock()`（杀该 pid 再删锁）。
- **改完 `lib/*.js` 必须完整重启 DSH**：bundle 开关只会重新执行 `apply()`，不会重新 import 模块（ESM 缓存），面板里跑的还是旧代码。改 `lib/client.js` 只需刷新页面。
- **2026-11-07 三次修复：不再刷一屏 PowerShell 窗口**。`start-bot.cmd` 原来分六次调 `powershell`、`stop-bot.cmd` 分四次 `call` 子脚本，每次都会闪一个控制台。现在两个入口各自只起**一个** PowerShell 进程（`scripts\dsmp-boot.ps1` / `scripts\dsmp-halt.ps1`，带 `-WindowStyle Hidden`），子步骤（SnowLuma、bridge）用 `Start-Process -WindowStyle Hidden` 拉起；面板侧的 spawn 也改成非 detached（`CREATE_NO_WINDOW`），整棵进程树共用一个不可见控制台。交互运行 `start-bot.cmd` 仍会打开 SnowLuma WebUI，面板触发时（`DSMP_HEADLESS=1`）不打开浏览器。

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsmp/services` | GET | 三个服务的端口探测、脚本存在性、空闲阈值 |
| `/api/dsmp/services?log=qq` | GET | 读该服务脚本日志末尾（最多 20000 字） |
| `/api/dsmp/services` | POST | `{action:'start'|'stop',name:'qq'|'draw'|'tts'}`，失败时回 `error`/`code`/`tail` |

注意：**生成/合成能力本身没有接进面板**。ComfyUI 的出图与 GPT-SoVITS 的合成都走 bridge 的 `send-image` / `tts` 端点，而这些端点在 reserved2 模式下要求 `x-agent-token` 且会把结果直接发到 QQ；面板只做到「开/关引擎 + 状态」，不越权调用。要真正在面板里生成图片/试听语音，需要另开一个不发送、只返回文件的本机端点（属 bridge 侧改动，需主人点头）。

## 历史与工作台（M4）

历史页签不另存聊天记录，每次都从 DSH 的会话日志读：

| 路由 | 作用 |
| --- | --- |
| `GET /api/dsmp/history/sessions?limit=` | 列出 `<DSH_HOME>/sessions/**` 下的会话（首帧取 cwd/预设，按 mtime 倒序） |
| `GET /api/dsmp/history?sessionId=&limit=&before=&q=` | 逐帧解压会话日志还原气泡；`before` 是游标，`q` 是关键字 |

解析要点：日志是**多帧 zstd、每帧一行 JSON**（`zlib.zstdDecompressSync` 只解首帧，所以自己走帧头）；她真正发出去的话在 `mcp__snowluma__qq_send_message` 的 `tool/call` 参数里，同一 turn 里这段一旦出现，就丢掉她没发出去的工作笔记；用户气泡优先取 `【本次消息快照】` 里的原文。

记忆页签：

| 路由 | 视图 |
| --- | --- |
| `GET /api/dsmp/workbench?view=facts` | 长期事实（现存/旧事、槽位、作者、I） |
| `view=topics` | 主题簇与事实数 |
| `view=window&sessionId=&from=&to=&limit=` | 窗口回放（主人原话 / 她说的 / 当时的想法）；`from`/`to` 限定轮次 |
| `view=episodes` | 情境索引（标题 + 场景 + 主题 + 轮次；按 `atTo` 新→旧；每段可「展开原文」跳到窗口回放） |
| `view=usage` | 消费（只统计 `k=turn`，不含 `base` 基线） |
| `view=recall&q=` | 真跑 smart 检索，含空结果诊断 |
| `view=claims` | 待确认纠正（当前为 0） |

情境段在磁盘上是 `episodes/<年-月>.jsonl`，真实行用 `title` / `scene` / `topics` / `atFrom` / `atTo` / `summarized` 描述，没有单独的 `summary` 字段。`episodesView()` 会把 `title：scene` 合成展示摘要、用 `atTo` 排序，并保留对旧 `summary` 行的兼容；只有 `summarized:false` 且没有叙事时面板才显示「（未摘要）」。

**从摘要回到原文**有三条路：① 事实行的 `⟵ 窗口 … 轮 a–b（8 位）` 可以直接交给 `dsmp_memory_window`，会话 id 给 8 位前缀即可；② 注入里的情境段行尾带 `（#ep-xxxxxxxx-nn）`，把它作为 `episodeId` 传给 `dsmp_memory_window`，轮次范围会自动带上；③ 面板「情境索引」每段有「展开原文」，跳到「窗口回放」并只显示那段轮次。月摘要、七天交接、事实卡本身不带锚点，仍需先经 ① / ② 或按日期检索。

## 模型与人设卡（M4）

| 路由 | 作用 |
| --- | --- |
| `GET /api/dsmp/models` | 列 provider 与模型、当前选择、本插件覆盖值 |
| `POST /api/dsmp/models` | 写 `settings.chat.{provider,model}`，下一轮生效 |
| `GET /api/dsmp/roles?name=` | 列角色卡 + 读某张卡全文（附带 `mirror` 镜像摘要） |
| `POST /api/dsmp/roles` | 保存人设卡（≤30000 字，写前自动备份 `.bak-dsmp-*`），保存后自动同步镜像 |
| `DELETE /api/dsmp/roles?name=` | 删除人设卡（先留 `.bak-dsmp-*` 备份；不能删当前正在用的那张），删除后镜像同步清理 |
| `GET /api/dsmp/roles/sync` | 只看镜像状态（目录、张数、当前角色、上次同步时间） |
| `POST /api/dsmp/roles/sync` | 立即把人设卡同步到 `<记忆目录>\roles\` |

### 人设卡镜像（2026-11-07）

人设卡的原件在 bridge 的 `roles\`，插件会把它们复制一份到**记忆目录**里：

```
<DSMP_MEMORY_DIR>\roles\
  ├─ <PERSONA>.md
  ├─ 傲娇助手.md
  ├─ <PERSONA_ALT2>.md
  └─ active.json        { role, source, syncedAt }
```

- 复制规则：只同步 `*.md`，跳过 `README.md`、`.bak-*`、`.tmp-*`；内容相同不重写（幂等）。
- 触发点：插件启动时、面板保存人设卡后、面板删除人设卡后、手动 `POST /api/dsmp/roles/sync`。
- 删除：`DELETE /api/dsmp/roles?name=` 先把原文件复制成 `.bak-dsmp-*`，再删源卡并同步镜像；**当前正在使用的那张不能删**（要先切换）。镜像里对应的副本会在同一次同步中被清掉，返回的 `removed[]` 会列出清了哪些。
- 目的是「记忆目录搬走 = 人设一起搬走」，导出记忆包时 `roles/` 也会跟着进包。
- 只复制、不反向覆盖；源目录被外部（不经面板）删掉的卡，下一次同步时镜像里也会一并清掉。
- 镜像目标固定是 `settings.memoryDir`（生产记忆目录），不受测试期隔离影响——测试隔离只管记忆记录与媒体，人设卡属于配置。

## QQ 通道（M2，只读 + 只入队）

bridge 通过 `x-console-token` 头鉴权（令牌在 `<bridge>\state\console-token`），DSMP 的 `BridgeClient` 只读它的状态与历史：

| 路由 | 作用 |
| --- | --- |
| `GET /api/dsmp/bridge/status` | 令牌是否就绪、当前模式、是否允许真发、outbox 条数 |
| `GET /api/dsmp/bridge/recent?key=&limit=` | 真实会话最近消息（只读） |
| `POST /api/dsmp/bridge/send` | 测试期只把消息写 `outbox.jsonl` 并返回 `dryRun:true`，不发请求 |
| `POST /api/dsmp/inbound` | 入站落盘（`bridge-inbox.jsonl`），供 M2 链路自检 |
| `GET /api/dsmp/inbox` / `GET /api/dsmp/outbox` | 读回入站/出站记录 |

**为什么出站只能是 dry-run**：reserved2 模式下 bridge 的 `/api/socialV2/send-message` 要求 `x-agent-token`（每个会话的 `state/social-v2.json.agentToken`），DSMP 拿不到；真发要等接入阶段，或改成由 bridge 转发。测试期 `test.allowLiveSend = false` 是硬闸门，即使改代码也不会静默发出去。


## 媒体库（M3）

图片与语音共用一个内容寻址仓库，只是分目录：图片进 `<记忆根>\media\YYYY-MM\<sha1>.<ext>` + `state\media.jsonl`，语音进 `<记忆根>\voice\YYYY-MM\<sha1>.<ext>` + `state\voice.jsonl`。同一个文件只存一份（按 sha1 去重），索引每 sha1 只追加一行。

| 路由 | 作用 |
| --- | --- |
| `POST /api/dsmp/media/upload?kind=image\|voice&name=&alt=` | 原始字节上传（≤16MB），按魔数嗅探类型，返回 `sha1` |
| `GET /api/dsmp/media/file?sha1=&kind=` | 取文件；强 ETag（sha1），支持 `If-None-Match`→304 与单区间 `Range`→206（语音拖动播放靠它） |
| `GET /api/dsmp/media/list?kind=&limit=` | 列出最近条目 |
| `POST /api/dsmp/media/attachment` | 把会话里的 `ImageAttachmentRef` 读成字节（面板渲染镜像消息的图，不必把字节塞进事件缓冲） |
| `POST /api/dsmp/voice/send` | 测试期写入 `voice-outbox.jsonl` 并返回 `dryRun:true` |
| `GET /api/dsmp/voice/outbox?limit=` | 读回语音队列 |

要点：
- 服务端不解码图片、不生成缩略图（零依赖）；面板按原图缩到 132px 显示，浏览器缓存靠 `immutable`。
- 语音行保留 `transcript` 字段：1.10.0 起入站语音会先转写再落库（见「听 QQ 语音转文字」）。
- QQ 侧入站语音已接（P1，见下节）：bridge 取字节后转给 `POST /api/dsmp/voice/inbound`，面板语音库直接可播。

## 听 QQ 语音（P1，2026-11-08）

主人在 QQ 发语音 → SnowLuma 给 `record` 段 → bridge 调 `get_record` 拿音频地址（或 `base64://`）→ `safeFetchBuffer` 限 16MB 取字节、校验魔数 → `POST /api/dsmp/voice/inbound` → 语音库 → 面板「语音库」里 `<audio controls>` 播放。

- **面板**：聊天页顶部「语音库」按钮展开，显示最近 5 条（来源、大小、时长、时间），带条数 chip 与「刷新」；QQ 来的标 `QQ`，面板自己生成/上传的标 `本地上传`。
- **接口**：`POST /api/dsmp/voice/inbound`，body `{key,msgId,name,from,duration,data(base64)}`；只接音频（OGG/Opus、WAV、MP3、M4A），超过 `media.maxVoiceBytes`（默认 16MB）或不是音频返回 400 且不落盘；同 sha1 只存一份。
- **桥接侧**：每条消息最多转 2 条语音，20s 超时；取字节/转发失败只写日志，绝不影响她回复文字。
- **语音转写**：1.10.0 起入站语音会先转成文字（见下节）；转写失败仍按 `[语音]` 处理。
- **自检**：`node dev/verify-voice.mjs --base http://127.0.0.1:<GUI 端口>`（生成 0.25s 测试音，验证入库 / 列表 / 取回逐字节一致）。
- **回滚**：删 `voice/inbound` 路由与 `lib/voice-inbound.js`，并去掉 `bridge.js` 里的 `forwardInboundVoice` 调用；已入库语音留着无害。
- **限制**：`get_record` 不可用（账号不支持 / 消息过期 / 网络失败）时面板不会出现这条，只在桥接日志留一行 `[voice] 入站语音取字节失败`。

## 听 QQ 语音转文字（1.10.0，2026-11-10）

QQ 语音是 SILK，本地 ffmpeg 直接解不了；落库前先让 SnowLuma 解码，再交给 DSH 自带的 SenseVoice。模型这一轮看到的是文字，不再是 `[语音]`。

链路：

```
QQ record 段 → bridge 取字节（get_record out_format:'wav'，SnowLuma 内置 SILK 解码）
  → 本机 ffmpeg 归一化 16k/单声道/PCM16 并削掉 LIST 块
  → POST /api/dsmp/voice/transcribe（x-dsmp-internal: bridge）
  → ctx.get('speechToText').transcribe()
  → 语音库存 WAV + transcript，本轮文本变成 "[语音转写] …"
```

- **依赖**：profile 里的 `@deepseek-ai/dsh-experimental-voice-input-bundle`（DSH 自带，不是插件依赖）；模型缓存在 `<DSH_HOME>\speech-to-text\sensevoice\`（int8 约 239 MB），`prepare()` 跑过一次后常驻 `standby`。
- **接口**：`POST /api/dsmp/voice/transcribe`，body `{key,msgId,name,from,duration,data(base64 wav)}`；只接受 16k/单声道/PCM16、44 字节标准头、≤4 MB/110 s；同 sha1 已有 transcript 时直接返回（`cached:true`）。
- **配置**（`settings.json` 的 `media.voice.stt`）：`enabled`（默认 true）、`provider`（空=用服务默认）、`language`（`zh`）、`timeoutMs`（20000）、`maxSeconds`（110）、`maxBytes`（4 MB）、`prepareTimeoutMs`（30000）。面板设置页不暴露这些键，改文件后 bundle off/on 或重启 DSH 生效。
- **状态**：`GET /api/dsmp/status` 的 `stt` 字段给出 `{enabled,available,provider,phase,language,error}`；`phase` 为 `standby/ready` 才可立即转写。
- **边界**：转写只进 `voice.jsonl` 的 `transcript` 和本轮 prompt，**不进事实卡、不进抽取**；超时/失败/未加载 provider 时 bridge 回退 `[语音]`，回复不受影响。
- **排障**：桥接日志看 `[voice] 语音转写 …`；失败会打印 `DSMP_STT_*` 码（`TOO_LONG`/`WAVE`/`NOT_READY`/`TIMEOUT`/`UNAVAILABLE`）。`phase=failed` 时删掉 `<DSH_HOME>\speech-to-text\sensevoice\models` 让 bundle 重新下载。
- **回滚**：删 `lib/voice-stt.js`、`voice/transcribe` 路由与 `media.voice.stt` 配置；bridge 侧还原 `segmentsToText`/`handleIncoming`/`toCanonicalWav` 三处。




## 记忆去重与过期降权（1.13.0，2026-11-10）

- **近同义只留一条**：同一主题+槽位下，值归一化全等、长串包含短串（≥8 字）、共享 ≥2 个型号/编号（如 A7R3 + 2470GM）、或字符二元组 Dice ≥ 0.85 的，视为同一件事。她自己写时命中就合并（`ev:'revise'`，保留更完整那句）；抽取器命中记 `skippedDup` 不再叠版本。
- **边界**：不按「共享中文二元组」合并——「电子学基础 周二」与「周五」是两门课，「不喜欢被叫<PERSONA_NICK>」与「README 不许出现<PERSONA_NICK>」是两条规则，都不能并。
- **过期默认不出**：检索跳过 `expired` 事实；问「以前/过去/作废/取消/过期」或显式要历史版本时才放回（旧课表「英语课作废」不再压在新课表前面）。卡面仍保留「旧事」行。
- **存量归并**：一次性脚本按 topic+slot 分组，保留 self / 高 I / 较新的一条，其余 `invalidate`（备份在 `<BACKUP_ROOT>\dsmp-memory\backup\`）。本次清理 5 对。
- **热重载**：`lib/tools.js`、`lib/workbench/state.js`、`lib/memory-engine.js` 的 vendor 导入带 mtime，bundle 开关即可加载新引擎模块（新路由/入口仍需重启 DSH）。
- **配置**：无需新配置；`memory.selfWrite`、`memory.scoring` 原样生效。

## 记忆自主化与月摘要（1.11.0，2026-11-10）

- **她为主，模型只补**：<PERSONA>在聊天里用 `dsmp_memory_write` 直接记（20 条/天、总 600）；抽取器遇到「她写过同一主题+槽位、值不同」时不覆盖，写 `state/disputes.jsonl` 等人工裁决。
- **待裁决视图**：记忆速览 →「待裁决」，每条显示她的值、抽取器的值、引文；`保留她的 / 采用补充 / 合并 / 忽略` 四个动作，采用或合并会写 `supersede`（`author:'correction'`）。接口 `GET /api/dsmp/workbench?view=disputes`、`POST /api/dsmp/workbench/write`（`action:'dispute'`）。
- **月摘要视图**：记忆速览 →「月摘要」，显示当前 `rolling.md` 的正文、字数、条数与更新时间；`GET /api/dsmp/workbench?view=monthly`。它只在轮转时注入，平时不影响上下文。
- **轮转四层**：`【最近一天原话】→【七天摘要】→【月摘要】`；月摘要 ≤700 字，只留身份/关系/约定、在进行的计划、重要事件，写 `state/monthly/rolling.md` 与 `YYYY-MM.md`，7 天内复用缓存。
- **配置**：`memory.monthly{enabled,maxChars,days}`、`memory.conflicts{maxPending}`、`memory.selfWrite{maxPerDay,maxTotal}`、`handoverMaxChars`（默认 5200）。bridge `config.json` 与插件 `settings.json` 两处都读。
- **回滚**：还原 `_retired\_memauto-20261110-131709` 的 `vendor/memory/src` 与 `lib`，或把 `memory.monthly.enabled` 设为 false（月摘要立即消失，其余不变）。

## 迁移 / 记忆包 / 打包（M5）

三个能力都只依赖 Node 内置模块（`zlib`、`fs`、`crypto`），不装外部依赖。

### 1. 迁移向导（记忆目录 + agent 工作区）

`POST /api/dsmp/migrate` 由 Journal 驱动，阶段固定为 `copy → verify → switch → cleanup → done`：

| 请求 | 作用 |
| --- | --- |
| `GET /api/dsmp/migrate` | 读取 `<DSH_HOME>\dsmp\migration\journal.json` |
| `POST {"action":"preflight","sourceDir":…,"targetDir":…}` | 只检查：源存在、目标为空/不存在、互不嵌套、空间 ≥ 源×1.2，并报告 `agent\` 工作区是否存在 |
| `POST {"action":"run",…}` | 逐阶段执行：复制 →（若存在）复制 `agent\` 工作区 → 逐文件 sha256 对账 → 记录 switch → 把源目录改名 `<源>.migrated-<时间戳>` → done |
| `POST {"action":"rollback"}` | 用改名记录把源目录搬回；`deleteTarget:true` 可清掉新目录 |

硬规则：
- **从不删除源目录**，cleanup 只改名，保留 7 天后由人决定是否删。
- 任何阶段失败都停在原地，journal 里留现场；`rollback` 只回滚改名，不动已复制的目标文件。
- 测试期（`test.enabled=true`）拒绝把 `sourceDir` 指到生产记忆目录，直接 403 `DSMP_TEST_ONLY`。

### 2. 记忆包导出 / 校验 / 导入

| 路由 | 作用 |
| --- | --- |
| `POST /api/dsmp/memory/export` `{memoryDir?,name?,includeWorkspace?}` | 生成 `deepseek-memory-<日期>.dsmp.zip` 到 `<DSH_HOME>\dsmp\exports\` |
| `POST /api/dsmp/memory/verify` `{file}` | 校验每个条目的 sha256、缺件与 manifest 之外的额外文件 |
| `POST /api/dsmp/memory/import` `{file,targetDir,overwrite?}` | 先校验再写；只写记忆树（`memory/**`→目标根、`workspace/agent/**`→`agent/`），`sessions|roles|dsmp` 由调用方另行处理 |

包内布局：`manifest.json`（kind、版本、创建时间、来源机器、文件数、字节数、全量 sha256）+ `memory/**` + `workspace/agent/**` + `sessions/<转义目录>/<sessionId>/**` + `roles/*.md` + `dsmp/settings.json`。
跳过 `backup/`、`node_modules/`、`scratch/`、`shadow/`、`.git/`——备份目录不进包。

### 3. 单 tgz 打包

```bash
node scripts/pack.mjs            # → dist/deepseek-memory-partner-<version>.tgz
node scripts/pack.mjs --out <输出目录>\dsmp.tgz
```

- 自写 ustar + gzip，不依赖 npm；包含 `package.json / README.md / CHANGELOG.md / lib / vendor/memory(src) / docs`。
- 不含 `dev/ test/ dist/ backup/ node_modules/`，也不含 `vendor/memory` 的开发文档与脚本。
- **本机绝对路径在打包时替换成占位符**：`<DSMP_MEMORY_DIR>`、`<DSMP_BRIDGE_DIR>`、`<DSH_HOME>`。运行时由 `lib/settings.js` 从同名环境变量展开：

```powershell
$env:DSMP_MEMORY_DIR   = '<DSMP_MEMORY_DIR>'
$env:DSMP_BRIDGE_DIR   = '<DSMP_BRIDGE_DIR>'
$env:DSH_HOME          = '<DSH_HOME>'
```

未设置的占位符会原样保留，面板的状态卡会显示「记忆目录未配置」而不是猜一个路径。

### 换机演练结果（2026-11-07）

```
迁移：1097 文件 / 13,728,434 B → preflight ok → run done → 目标可读、agent 工作区随迁 → rollback 源目录恢复
导出：489 条目（memory 482 / sessions 1 / roles 4 / dsmp 1），4,253,424 B
导入：482 文件写入新目录，state/longterm.jsonl 与源逐字节一致
导入副本跑 acceptance-check：18 通过 / 0 失败 / 0 跳过
会话：session.v4.jsonl.zstd 的 header.cwd 正确、112 条气泡可解析
打包：75 条目 / 277,547 B，`work program` 零命中；解包后 lib/index.js 可加载、占位符按 env 展开
```


## 一键换机（B1，2026-11-08）

把「记忆目录 + QQ 工作区 + DSH 会话树 + 人设卡 + 插件设置」打成一个 `dsmp-machine-pack` zip，在新机器导入后所有绝对路径自动改写，会话能接着聊。

| 请求 | 作用 |
| --- | --- |
| `GET /api/dsmp/machine` | 本机身份（`machine.json`）、心跳、单机锁、历史 |
| `POST /api/dsmp/machine/export` | 导出：`{name?, memoryDir?, sessionIds?}` → `<DSH_HOME>\dsmp\exports\<name>`；不是记忆写者时 409 |
| `POST /api/dsmp/machine/upload?name=…` | 浏览器上传换机包（原始 zip body，落 `<DSH_HOME>\dsmp\imports\`） |
| `POST /api/dsmp/machine/import` | 导入：`{file, targetDir, machineName?, dryRun?, overwrite?, force?}` |

包内结构（`manifest.json` 记录 `cwd`、`sessionIds`、逐文件 sha256）：

```
memory/**            记忆目录（排除 backup / sessions / node_modules / scratch / shadow）
machine.json         来源机器身份
sessions/<sid>/**    选中的 DSH 会话日志（逐帧 zstd，导入时改 header.cwd）
roles/*.md           人设卡
dsmp/settings.json   插件设置（导入后 memoryDir / liveCwd 改新路径）
```

导入做的事：校验整包 sha256 → 目标非空先备份改名 → 记忆写 `target.importing-<pid>` 再整体 rename → 会话按 `escapeCwd(newCwd)` 落到 `<DSH_HOME>\sessions\…\<sid>\` 并逐帧改写 cwd → `storages/workspace.json` 里指向旧工作区的条目改新路径（`updatedAt` 用 ISO）→ bridge `config.json` 的 `sessionCwd`（若配了 bridge 目录）→ DSMP settings 的 `memoryDir` / `session.liveCwd` → 新 `machine.json` 并把旧 machineId 记进 `state/machine-history.jsonl`；任一步失败删新建目录、把备份改回。

单机锁：每 5 分钟写一次 `state/machine-heartbeat.json`；导入时目标目录 10 分钟内有别的 machineId 心跳 → 409 `DSMP_MACHINE_BUSY`（确认覆盖传 `force:true`）。

面板「设置」页签里的「一键换机」卡片就是这套接口的 UI：导出换机包 → 新机器选包 → 预检（显示旧/新工作区、文件数、目标是否已存在）→ 确认导入。

离线验收：`node dev\verify-b1.mjs --pack <zip>` 在 `%TEMP%` 里做一次完整导入（不碰真实 sessions / workspace.json / bridge），12 项对账。

## 备份与恢复（B2，2026-11-08）

面板「设置」页签里的「备份与恢复」卡片：点「立即备份」生成一份记忆包，列表里每份都能「恢复…」（先预检，再确认）。备份是本地文件，不依赖 QQ / bridge，也不需要停 DSH。

| 请求 | 作用 |
| --- | --- |
| `GET /api/dsmp/backup` | 备份根目录、保留份数、已有备份列表（按时间新→旧） |
| `POST /api/dsmp/backup/now` | `{name?}` → 生成 `<root>\<YYYYMMDD-HHmmss>-<name>.zip`；不是记忆写者时 409 |
| `POST /api/dsmp/backup/restore` | `{file, dryRun?, overwrite?}`；`dryRun` 只校验并回报包内文件数，`overwrite:true` 才替换 |

备份根目录默认 `<DSH_HOME>\dsmp\backups`，可在设置里改 `backup.dir`；`backup.keep`（默认 10）控制只保留最近几份，清理只删最旧的、失败跳过。

一份备份就是一个 `dsmp-memory-pack`：`manifest.json`（来源目录、文件数、逐文件 sha256）+ `memory/**` + 可选 `workspace/agent/**` + `roles/*.md` + `dsmp/settings.json`；`backup/sessions/node_modules/scratch/shadow/.git` 不进包。写盘前先 `verifyArchive` 自检，自检不过直接报错、不留半截文件。

恢复做的事：校验 manifest 与哈希 → 目标非空且没 `overwrite` 就停在预检 → 解到临时目录（只取 `memory/`、`roles/`、`workspace/agent/`，**跳过 `sessions/` 与 `dsmp/settings.json`**）→ 当前记忆目录整体改名 `<memoryDir>.before-restore-<stamp>` → 临时目录 rename 就位；任一步失败删临时、把旧目录改回。旧目录永不删除，回滚就是把它改回来。

> 恢复会改动生产记忆；面板默认先预检，确认按钮上写明「会先把当前记忆目录改名备份」。不是记忆写者（另一个进程持租约）时两条写路由都返回 409 `DSMP_NOT_WRITER`。

离线验收：`node dev\verify-b2.mjs --file <备份.zip> [--base http://127.0.0.1:<GUI 端口>]` 在 `%TEMP%` 里做一次真实恢复与二次拒绝，14 项对账。


## 她说过的语音（B3，2026-11-08）

她发出去的语音会自动进语音库，**TTS 的原文直接记下来，不跑语音识别**：

- `/api/socialV2/tts` 成功发送后，bridge 用回读的 `msgId` 把「音频 + 原文」回报给 `POST /api/dsmp/voice/sent`，原文标 `textSource:'tts-input'`。
- `/api/socialV2/send-voice`（语音库文件）只回报音频，没有原文就留空；面板那条显示灰字「（没有原文）」，以后可补。
- 主人发来的语音仍走 `/api/dsmp/voice/inbound`，标 `direction:'in'`、`speaker:'owner'`，只听、不转写。

`state/voice.jsonl` 每行新增 `direction`（`in`/`out`）、`speaker`（`owner`/`shenming`）、`text`、`textSource`（`tts-input`/`stt`/`library-meta`/`manual`）。旧行没有这些字段，按 `direction:'in'` 兼容。同一段音频按 sha1 只存一份；后到的空文本不会冲掉已有原文，只有 `manual` 能人工覆盖。

面板「记忆 → 语音库」分两组：「她说过的」（原文 / 「（识别）」 / 「（没有原文）」+「发这条」）和「主人发来的」（只听）。

| 请求 | 作用 |
| --- | --- |
| `POST /api/dsmp/voice/sent` | `{data(base64), text, textSource, name, key, msgId, duration}`；落 `direction:'out'` |
| `GET /api/dsmp/media/list?kind=voice` | 每行带 `direction/speaker/text/textSource` |

> 出口原文只进语音库，**不自动写长期事实卡**；她的话要进记忆仍须调用 `dsmp_memory_write`。TTS 原文与真实发音语义一致即可，允许有语气差异。

离线验收：`node dev\verify-b3.mjs --base http://127.0.0.1:<GUI 端口>`（写入一段 0.25s 测试音，断言原文落库、重报不冲掉原文、文件逐字节一致）。


## 健壮性：写令牌 / 诊断 / 乐观锁 / 启动自检（D，2026-11-08）

四项都在插件里，不依赖外部服务：

- **写令牌**：启动时生成 `<DSH_HOME>\dsmp\api-token`（32 hex，仅当前用户可读）。所有写路由要求 `x-dsmp-token`，或浏览器同源（`Sec-Fetch-Site: same-origin`），bridge 的内部转发用 `x-dsmp-internal: bridge`；其余一律 `403 DSMP_WRITE_FORBIDDEN`。`/api/dsmp/status` 只在同源时回 `writeToken`，所以面板不用自己存令牌。它防的是跨站伪造和误调用，不防同一用户下的本机进程。
- **诊断**：设置页「诊断与自检」折叠卡，数据来自 `GET /api/dsmp/diagnostics`——3100/7351/8188/9880 端口、租约、残留锁、`.exporting`/未完成迁移、6 个日志的尾部 20 行、6 项自检。
- **乐观锁**：`?view=facts|claims|activation|history` 回 `etag`；写请求带 `ifMatch`，对不上回 `409 DSMP_STALE`，面板自动刷新并提示「数据已更新，已刷新」。四类写（claims / fact-edit / fact / activation）都覆盖。
- **启动自检**：`status.selfCheck[]` 六项——记忆目录可写、租约是否本机、bridge 是否在线、残留 panel-lock（超过 5 分钟且进程已死会清）、运行模式（生产模式 / 开发热重载，两种都算通过，只作信息展示）、写令牌就绪。有失败项时面板顶部出黄条，点「重新检查」会调用 `POST /api/dsmp/selfcheck` 真正重跑（`status` 只回启动时那份缓存）。

离线验收：`node dev\verify-d.mjs --base http://127.0.0.1:<GUI 端口>`（15 项，含跨站 403、同源 200、带令牌 200、过期 ifMatch 409）。


## 单写者租约（M6）

默认 `settings.memory.owner = "bridge"`：DSMP **不抢租约**，QQ 侧记忆仍由 bridge 自己写，生产行为与 M5 完全一致。

把 owner 改成 `"dsmp"` 之后：

1. DSMP 在 `<记忆目录>/state/engine-lease.json` 抢租约：`{owner:"dsmp", pid, startedAt, heartbeatAt, ttlMs:60000}`，每 15s 心跳；抢不到就降级只读（不会双写）。
2. bridge 侧（`cfg.memory.owner = "dsmp"` 且租约有效、owner 为 dsmp）不再自己写账本，改为把 `begin-turn` / `note-spoken` / `finish-turn` 转发到 `POST /api/dsmp/memory/*`；转发失败只记日志、**不回落本地写入**（宁可少记一轮，也不允许双写）。
3. 切回 `"bridge"` 或删除租约文件即回滚；DSMP 的写入口在租约失效时一律返回 `409 DSMP_NOT_WRITER`。

路由：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/dsmp/memory/lease` | 租约摘要（owner / live / mine / 心跳时间） |
| POST | `/api/dsmp/memory/lease` | `{action:"acquire"\|"release"\|"heartbeat"\|"status"}` |
| POST | `/api/dsmp/memory/begin-turn` | bridge 转发：开一轮（key/sessionId/userRaw/windowText/blocks/media/model/mode） |
| POST | `/api/dsmp/memory/note-spoken` | bridge 转发：她真正发出去的一句（tool/text/feels） |
| POST | `/api/dsmp/memory/finish-turn` | bridge 转发：收尾（reply/reason/pressureTokens/contextWindow/incomplete） |
| GET | `/api/dsmp/memory/writer` | 当前写者状态与计数（begun/finished/spoken/skipped/errors） |

> M6 阶段仍按「只测试」执行：默认 owner=bridge，租约只会在测试记忆目录里演练；真实 QQ 回合不会被转发。切到生产需要主人点头后再改 `settings.json` 与 bridge `config.json` 两处 owner。

## 记忆单写者已切到 DSMP（P2，2026-11-07）

本机现状：`memory.owner = "dsmp"` 已生效，生产记忆账本（`window/*/turns.jsonl`）由 DSMP 写，bridge 只转发。

切过去要改三处（缺一不可）：

1. `settings.json`：`memory = { "owner": "dsmp", "leaseTtlMs": 60000, "dir": "<DSMP_MEMORY_DIR>" }` —— `dir` 必须显式写生产记忆目录，否则测试期会落到 `test/memory` 副本。
2. bridge `config.json`：`memory.owner = "dsmp"`，然后重启 bridge。日志出现 `记忆单写者：owner=dsmp，租约=dsmp（有效）` 即生效；若仍是 `owner=bridge`，说明租约文件没被 DSMP 抢到或 owner 没读到。
3. 确认 `/api/dsmp/status` 的 `memory.lease` 是 `{owner:"dsmp", live:true, mine:true}`、`memory.writer.writer === true`。

切换后一轮的完整链路：面板/QQ 消息 → bridge `deliverPrompt` → bridge 调 `POST /api/dsmp/memory/begin-turn` → DSMP 写 `<记忆目录>/window/<sessionId>/turns.jsonl` → `finish-turn` 收尾。账本里的 `userRaw` 只保留主人原话（面板消息的「【来自桌面面板 · 不发 QQ】…」包装会在写入前剥掉）。

回滚（任一步都立刻恢复 bridge 独占）：

```powershell
# 1) DSMP 让出：owner 改回 bridge（下一次心跳会把租约文件删掉）
# 2) bridge 恢复自写：config.json 的 memory.owner 改回 bridge 或直接删掉该键
# 3) 重启 bridge，日志应变回「记忆单写者：owner=bridge，租约=无」
```

边界：切到 DSMP 后，日终派生（情境段 / 事实抽取 / 归档 / 轮转 / 到期提醒）也由 DSMP 跑（A2，见下节），bridge 不再启动自己的维护定时器；两边共用同一个记忆目录，靠租约互斥。

## 记忆日终归 DSMP（A2，2026-11-08）

- 新增 `lib/memory-engine.js`：DSMP 自己建 `createMemoryEngine` 实例，**不用** engine 自带的 `startMaintenance()`，改为 60 秒巡检（首跑 15 秒后）。每次巡检先验两件事——`settings.memory.owner === 'dsmp'` 且租约文件仍属于本进程；任一不满足就跳过并记 `skipped: "not-writer"`，绝不与 bridge 双跑。
- 面板与运维接口：`GET /api/dsmp/memory/engine` 看状态（`running / writable / ticks / lastTickAt / lastError / lastDailyAt`）；`POST /api/dsmp/memory/engine` 支持 `{"action":"tick"}`（一次巡检）、`"daily"`（强制今日日终）、`"start"` / `"stop"`。非写者时 tick/daily 返回 **409**。
- `lib/index.js`：`buildStatus().memory.engine` 带上状态；`settings` 变更后重新按新目录配置引擎（换目录会丢弃旧实例）。
- bridge 侧（`src/bridge.js` 的 `startMemoryMaintenance`）：启动时先看 `dsmpWriterOn()`——租约在 DSMP 手上就**不启动**自己的定时器，并每 5 分钟复查；DSMP 掉线或租约过期后 bridge 自动接管，不需要人工重启。日志在接管/让出时各打一行，安静启动说明按预期跳过了。
- 回滚：把 `memory.owner` 改回 `bridge`（DSMP 心跳会释放租约），重启 bridge 即恢复旧行为；DSMP 侧也可以 `POST {"action":"stop"}` 现停巡检。

## 记忆注入在 agent/pre-step（A1，2026-11-08）

以前面板把「规则 + 事实卡 + 【本次消息快照】」拼进用户消息再投递；现在**用户消息只保留主人原话**，记忆投影由 `agent/pre-step` 作为一条独立上下文消息挂上去：

- `lib/inject.js`：`preStep(payload, next)` 先 `await next()`，只在 `decision.kind === 'enter'` 时动手；把一条 `id = dsmp-memory-<sessionId>`、`source.kind = 'dsmp-inject'` 的消息插在最后一条用户消息**前面**，每一步**原地替换**（先按 id 删旧再插入），不会每步追加一份。
- 只对绑定会话生效（`settings.session.liveId || boundId`）；QQ 那条路的 prompt 里带 `【本次消息快照】` / `【面板消息】`，检测到就跳过，避免双重注入。
- 面板发送时仍然算一次完整投影（`composeChatPrompt`），但用途有两个：写账本的 `windowText`（她当时看到的全文），以及把前缀交给 `notePanelTurn()` 缓存——pre-step 直接取缓存，不再重复读卡；超过 60 秒或原话对不上才重新组装。
- 观测：`GET /api/dsmp/status` 的 `inject = {mode, pending}`。
- 回滚：`settings.inject.mode = "send"` 即恢复旧行为（把投影拼进用户消息）；`lib/inject.js` 本身可留着。


## 记忆工具原生化（A3，2026-11-08）

记忆工具不再依赖 bridge 的 MCP 子进程：插件用 `ctx.tools.register` 直接注册 7 个 `dsmp_memory_*`，`qq_memory_*` 仍保留、两者并存（名字不冲突）。

| 工具 | 用途 | 写门 |
| --- | --- | --- |
| `dsmp_memory_search` | 历史聊天原文（热文件 + 归档），`query` 空格分隔关键词、可按日期段过滤 | 只读 |
| `dsmp_memory_recall` | 长期事实，整句问法路由到槽位/主题/主体；问课表先给结构化块；空结果给诊断与下一步 | 只读 |
| `dsmp_memory_window` | 按 `⟵ 窗口 … 轮 a–b` 展开当时的主人对白、她的话、当时的想法，可附窗口块；`sessionId` 可只给 8 位前缀，`episodeId` 可直接用情境段的 `ep-…` 短号 | 只读 |
| `dsmp_memory_write` | 她自己写一条事实（2–60 字，细节放 `text`），`dryRun` 只校验 | 需租约 |
| `dsmp_memory_edit` | 修订值/说明/有效期，旧值留历史 | 需租约 |
| `dsmp_memory_photo` | 按 sha1 取回记忆里的原图，经 `attachments.saveImages` 变成图片块 | 只读 |
| `dsmp_memory_todo` | 看待办 / 标完成 / 取消 | 改状态需租约 |

- 写门：`settings.memory.owner === 'dsmp'` 且租约在本机；否则返回 `DSMP_NOT_WRITER`，不会与 bridge 双写。
- `store` 的目录来自 `cfg()`（不接参数），所以 search 调用前后临时改 `QQ_MEMORY_DIR` 再还原，保证读的就是面板与账本那份数据。
- 观测：`GET /api/dsmp/status` 的 `tools = {registered, names}`。
- 注意：`inject` 必须声明 `tools`（Cordis 只认数组，`{required, optional}` 会被当成两个服务名、插件一直 pending）。
- 验证：`test/tools.test.mjs` 9 条；在线在 QQ 共用会话里调用 `dsmp_memory_recall` 45ms 返回生日事实。

## 测试期隔离

`settings.json` 的 `test` 段：

```json
{
  "test": {
    "enabled": true,
    "sessionPrefix": "session-dsmp-test-",
    "cwd": "<DSH_HOME>\\dsmp\\test\\cwd",
    "memoryDir": "<DSH_HOME>\\dsmp\\test\\memory",
    "allowLiveSessions": false
  }
}
```

- `enabled: true` 时，`SessionBridge.guard()` 拒绝任何非 `session-dsmp-test-*` 的会话（HTTP 403，`code: DSMP_TEST_ONLY`），真实 QQ 会话不会被 attach / resume / followup。
- `memoryDir` 指向生产记忆的**只读副本**，可用 robocopy 刷新（源目录不动）：
  ```cmd
  robocopy "<DSMP_MEMORY_DIR>" "<DSH_HOME>\dsmp\test\memory" /E
  ```
- 正式接入时把 `test.enabled` 改成 `false`；这一步要等 M2–M7 完工后由主人确认。

## 卸载

```cmd
"<DSH_HOME>\app\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove @local/dsmp
```

或手工三步（与安装对称）：

1. `dsh.profile.bundles` 里删掉 `"@local/dsmp"`；
2. `dependencies` 里删掉 `@local/dsmp`；
3. `cmd /c rmdir "<profile>\node_modules\@local\dsmp"`（只删链接，不删源目录）。

**不要删** `<DSMP_PLUGIN_ROOT>` 与 `<DSH_HOME>\dsmp`（后者存面板设置与会话锁）。

## 回滚

- 停用而不卸载：把 `bundles` 里的 `"@local/dsmp"` 删掉即可（热生效，路由变 401）；DSH 其余功能与 qq-bridge 旧路径完全不受影响。
- 设置写坏：删 `<DSH_HOME>\dsmp\settings.json`，下次读取自动重建默认值。
- 代码回滚：按里程碑打快照（约定备份到 `<DSMP_WORKSPACE>\_retired\_refbackup-<stamp>` 或 `_retired\DeepSeek partner-20261108-1536\backup`）。

## 数据位置

| 内容 | 路径 |
| --- | --- |
| 面板设置 | `<DSH_HOME>\dsmp\settings.json` |
| 测试期记忆副本 | `<DSH_HOME>\dsmp\test\memory` |
| 生产记忆（测试期只读） | `<DSMP_MEMORY_DIR>` |
| 角色卡 | `<DSMP_BRIDGE_DIR>\roles\*.md` + `state\current-role.json` |
| 测试会话日志 | `<DSH_HOME>\sessions\--D-…-dsmp-test-cwd--\session-dsmp-test-*\session.v4.jsonl.zstd` |

## 开发期热重载

宿主只重载插件**入口模块**，`import` 的兄弟模块命中 ESM 缓存。开发时：

1. 建 `<DSH_HOME>\dsmp\dev-reload.flag`（生产前删掉）；
2. `node dev/toggle-bundle.mjs off` 再 `on`，插件会用 data: URL 重新求值每个 `lib/*.js`；
3. 注意 `export const BUILD` 是模块导出，要 `const { BUILD } = await loadModule(...)` 解构，不能当类静态属性读。

**`toggle-bundle.mjs` 只做 JSON 级修改**（读 → `JSON.parse` → 改 `dsh.profile.bundles` → `JSON.stringify(obj, null, 2)` → 写 tmp → renames）。早期版本按行增删，删掉数组最后一项时会留下 `"…",\n]` 这种尾逗号，让整个 profile 无法解析、DSH 直接起不来（2026-11-07 实际发生过一次）。现在脚本写盘前会自己 `JSON.parse` 校验一遍，失败就抛错、不动原文件。

## 账本体检（P0，2026-11-07）

窗口账本 `window/*/turns.jsonl` 是追加写的，历史上被两类东西污染过：空行（三个字段全空）、以及 bridge 替补收尾留下的「重复轮」（user 空、reply 与上一轮一字不差、间隔几秒）。

```bat
node scripts\lint-window-ledger.mjs                 :: 只读体检
node scripts\lint-window-ledger.mjs --fix           :: 备份后隔离（打 quarantined 标记，不删行）
node scripts\lint-window-ledger.mjs --dir <记忆目录>
```

- **不删行**：删掉中间一行会让后续 turn 号与行号错位，`acceptance-check` 的「窗口轮次连续」会失败，情境段的 turn 锚点也会漂。隔离是给行打 `quarantined:true` + `quarantineReason`，内容清空、保留行号。
- **只动确定的两类**：`empty-row` 与 `dup-reply`。她的主动性发言（`reply-only`）与重复 turn 号只报告，不动——可能真是一次唤醒轮。
- `synthetic:true` 的轮转交接行永远跳过。
- 隔离前会整目录备份到 `<记忆目录>\backup\ledger-<stamp>\`。

## 已知限制

- **群聊历史只到 bridge 的 100 条**：`/api/socialV2/history` 默认返回最近 100 条，更早的群消息在面板「历史记录」里看不到（私聊与面板直连不受影响）。
- **M6 双引擎并存时的行为**：单写者租约生效时只有一个引擎记账。DSMP 持有租约时 bridge 的 `begin/finish-turn` 转发给 DSMP；bridge 持有租约时 DSMP 的写入口返回 409 `DSMP_NOT_WRITER`，面板仍可读。切回 bridge 需同时改 bridge `memory.owner` 与 DSMP `memory.owner` 并重启 bridge，详见「单写者租约」。
- **不做 STT**：语音只保存字节与元数据。QQ 语音消息在 bridge 侧只有 `[语音]` 占位、拿不到字节；她发出的 TTS 语音带原文（`textSource:'tts-input'`），语音库文件没有原文，需要识别得自己接 ASR。
- **导出只含绑定会话**：记忆包（B1）导出 `memory/**` + 当前绑定会话的 DSH 日志 + 人设卡；没有绑定关系的会话、以及 bridge 侧 `sessions.json` 的映射不在包里。
- **软单机锁**：`state/machine-heartbeat.json` 每 5 分钟心跳，导入时如果检测到另一台机器在心跳会提示；但它只是提示，不是硬锁——两台机器同时跑同一份记忆仍可能互相覆盖。
- **测试期/生产期由 `settings.test.enabled` 决定**：为 `true` 时账本写 `<DSH_HOME>/dsmp/test/memory`，为 `false` 时写 `settings.memory.dir`。升级前先确认这一项。
- **`vendor/memory` 是固定副本**：不跟随上游自动更新，刷新命令见文末「刷新 vendor/memory」。
- **`mode` 判定只看 bridge 端口与 `/api/status`**：不带控制台令牌时本机显示 `degraded`，但面板功能不受影响。
- **面板会话共用同一条 DSH 会话**：她正在回复时再发会返回 409 `DSMP_SESSION_BUSY`；没有独立的「离线草稿」。
- **已知未实测**：`0.2.1-rc.2` 宿主的真实运行本轮未复测（本机已是 `0.2.1-rc.5`）；插件市场尚未提交，材料见 `docs/市场提交材料.md`。

## 面板直连（默认）与离线兜底（P0）

**现在的默认是「面板直连」**：`session.via = "auto"` 时，面板消息由 DSMP 自己驱动那条 DSH 会话（`ctx.agents.get` 有活 agent 就复用，没有就 `resume`），**不经过 QQ bridge**；账本由 DSMP 直接写（它是单写者），所以面板轮也会记进 `turns.jsonl`（`mode:'panel'`）。

- bridge 在线时：QQ 消息仍由 bridge 驱动同一条会话，面板消息走 DSH 直连；两边是同一个 agent，DSH 自己串行化。
- bridge 离线时：面板照常聊（实测 54ms 返回、回复正常），只是 QQ 那一侧收不到消息。
- 她正在回复时再发会返回 409（`DSMP_SESSION_BUSY`）。
- 想回到旧行为（面板文字交给 bridge 转发）：`settings.json` 里 `session.via = "bridge"`。
- 兜底开关 `session.offlineFallback` 只在 `via:"bridge"` 时有意义：bridge 不可达则本地接管，响应 `via:'local'`。
- 关掉面板直发：`panel.liveSend=false`（此时 `via:"bridge"` 回 403；`auto` 不受影响，因为根本不走 bridge）。

防双写：bridge 也会观察 `session/event`，若对没有 `begin` 过的轮次调 `finish-turn`，DSMP 回 `DSMP_NO_DRAFT` 并计入 `skipped`——不会多出一条空轮。

实测见 `CHANGELOG.md` 的「面板直连」条目。

## 刷新 vendor/memory

```cmd
robocopy "<DSMP_WORKSPACE>\_retired\DeepSeek memory-20261108-1536" "<DSMP_PLUGIN_ROOT>\vendor\memory" /E /XD node_modules workbench backup scratch shadow .git
```

