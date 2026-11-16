# QQ ↔ DeepSeek Harness 桥接

**English**: [README.en.md](README.en.md) | **中文**: [README.md](README.md)

> 🗂️ 文档索引（全部文档一句话说明 + 是否仍然有效）见 **[docs/README.md](docs/README.md)**；仓库目录/脚本命名约定见 **[docs/FOLDER_MAP.md](docs/FOLDER_MAP.md)**。
>
> 🔒 QQ 会话的权限边界与安全承诺见 **[RULES.md](RULES.md)**。
>
> 🎤 独立的「发语音」工具已拆到仓库上一级的 **`../voice-tool/`**（命令行 `voice-cli.mjs` / 图形界面 `voice-gui.mjs`），不再依赖 qq-bridge 运行。

把 QQ 消息接入 DSH agent：QQ 好友/群发来的消息会变成 DSH 会话里的用户消息，agent 的回复（含提问、工具审批）会发回 QQ。

> ⚠️ **当前版本 `v0.2.1-r1`，适配 DSH 0.2.1-rc.2**（0.2.0-rc.2 亦兼容；两个版本上都逐项实测：`npm run verify:adaptation`）。
> 鉴权用 `~/.dsh` 里持久化的浏览器会话签名密钥**离线铸造 Cookie** —— DSH 0.1.7 起进程启动 token
> 只存在于内存、不再落盘，旧版「从 guard 日志里读 token」的方式已失效。agent preset 是 DSH 0.1.7 起的
> `@deepseek-ai/dsh-agent-preset` Cordis 行（`~/.dsh/.agent-presets/` 目录机制已废）。协议代次
> （Cookie 鉴权 / 斜杠 RPC / `/api/remote.mux` 事件流）自 DSH `0.1.2-alpha.1` 起引入，与更早的点号
> endpoint 协议不兼容 —— **DSH `0.1.1-rc.2` 及更早**请改用 tag
> [`v0.1.0`](https://github.com/Derpyu520/qq-bridge/releases/tag/v0.1.0)；**DSH 0.1.5-rc.1** 用
> [`v0.1.5`](https://github.com/Derpyu520/qq-bridge/releases/tag/v0.1.5)；**DSH 0.1.7-rc.2** 用
> [`v0.1.7`](https://github.com/Derpyu520/qq-bridge/releases/tag/v0.1.7)。
>
> v0.2.0 修的主要是**会话待处理队列读不出来**：桥接退役/重置 QQ 会话时要先清掉 DSH 侧没跑的队列，
> 而那段解析认的是一个**从来不存在的字段**（`session/control` baseline 的 `value.queues[<id>]`）——
> 于是**每一次**退役都抛 `invalid session/control baseline`，队列清不掉、旧任务继续在 DSH 里跑，
> 而日志里只有一行警告。**注意：这不是 0.2.0 引入的**——该代码随 v0.1.7 发布，报错日志早于
> 0.2.0-rc.2 的发布，0.2.0 只是把它翻了出来。现在读队列以一元 RPC `session/projections` 为主路径、
> 以 `projections[<id>].values.inbox` 为回退形状，并补了两条回归网。
> 同一轮还按 0.2.0 的真实工具清单重新对账了 QQ 安全守卫（新增 15 个必须隐藏的工具名，
> 含全局层默认启用的 `read_mcp_resource`、`plugin_manager`、`subagent_codex` 等）。
>
> 逐条改动说明见 [docs/guides/DSH_020_ADAPTATION.md](docs/guides/DSH_020_ADAPTATION.md)（0.2.0）
> 与 [docs/guides/DSH_021_ADAPTATION.md](docs/guides/DSH_021_ADAPTATION.md)（0.2.1）。
>
> **r4 主要改动**：QQ 表情包/动图链路（表情 CDN 优先、`emoji_id` 兜底、DNS 多地址故障切换）、
> 联网搜索改用与 DSH 同源的 DeepSeek 搜索（Bing 仅兜底）、`qq_wait_for_messages` 改 5 分钟长轮询、
> 控制台切模式被 5 秒轮询改回去、回合永久「繁忙」、机器人身份未注入等 issue 修复，外加一轮整体体检。
> 逐条见 [**Release v0.2.0-r4**](https://github.com/Derpyu520/qq-bridge/releases/tag/v0.2.0-r4)。
>
> **v0.2.1-r1 主要改动**：适配 DSH 0.2.1-rc.2。修掉一处 **P0**——persona 里的 `{{cwd}}`
> 提示词变量在 0.2.1 被删除，导致**每个回合在系统提示词装配阶段直接 error、模型一次都不跑**
> （QQ 侧表现为「发消息完全没反应」）；同时把 0.2.1 新进全局层的 `working_directory`
> 与 terminal / session-query / plugin_market 一族补进安全守卫名单。
> 逐条见 [docs/guides/DSH_021_ADAPTATION.md](docs/guides/DSH_021_ADAPTATION.md)。
>
> 默认分支 `main` **就是**本版本，`git clone` 直接拿到，无需切换分支。

```
QQ 消息 ──► SnowLuma（OneBot v11 WS）──► 本桥接进程 ──► DSH Web API (127.0.0.1:3080/api)
                                                ▲                      │
                                                └── agent 回复/提问/审批 ┘
```

## 项目展示

📽️ [AI 仿真群友 - 项目介绍视频](https://github.com/Derpyu520/qq-bridge/releases/download/v0.1.5/project-intro.mp4)（约 11 MB）

> 视频改由 **Release 附件**托管，不在仓库里——只想安装桥接的人不必再下载这 11 MB（它此前占整个仓库体积的 88%）。

## 架构

- **QQ 侧**：`@snowluma/sdk` 的 `SnowLumaWebSocketClient`（OneBot v11 WebSocket 客户端，自动重连）
- **DSH 侧**：适配 DSH 0.1.2 起引入、**0.2.1-rc.2 上逐项复核**的协议——用本机持久化签名密钥铸造会话 Cookie 鉴权、`/api/<namespace>/<method>` 斜杠 RPC、`/api/remote.mux` + `session/follow` 事件流（`session/control` 的队列读 `value.projections[<id>].values.inbox`，另有一元 `session/projections` 主路径）；复用 `AbstractApiClient` 传输层但不再依赖旧版 zod value schema。会话模型由桥接按 `config.json` 的 `dsh.model` 逐会话 `session.selectModel` 固定（默认 `deepseek-flash` = DeepSeek-V41-Flash，多模态）
- **agent 自主收发 QQ**：DSH 的 MCP 客户端（`~/.dsh/profiles/web/cordis.patch.yml` 配置）接入三个 MCP server：
  - `snowluma`（桥接自带 `src/mcp-snowluma-safe.js`）：QQ 动作**安全子集**（查状态/查群/查消息/发消息，发送强制白名单；发送工具支持可选 `replyToMessageId` 引用回复）
  - `snowluma-host`（桥接自带 `src/mcp-host-server.js`）：**只有** `snowluma_status`（只读探活 `get_login_info`）。
    ⚠️ **v0.1.5 起移除了 `start_snowluma` / `stop_snowluma`**（以及 `snowluma.allowProcessControl` 配置项）——
    原因是 **SnowLuma EULA §5.4** 规定「将其并入第三方安装包或 Docker 镜像、**通过自动化脚本部署**」
    须事先取得书面授权，而原生组件属专有组件。本程序**只探测、不部署**：SnowLuma 的安装、启动与扫码
    始终由你自己完成（详见 [LICENSE](LICENSE) 与 [RULES.md](RULES.md)）。
  - `web-search-safe`（桥接自带 `src/mcp-web-search-safe.js`）：只读 `web_search` / `web_fetch`（带 SSRF 防护），供 agent 查网络用语/资料。
    **搜索优先复用 DSH 原本的联网搜索**（同一个 DeepSeek Anthropic 兼容端点 + `web_search` 服务端工具，凭据按 `config.webSearch.apiKey` → 环境变量 `DEEPSEEK_API_KEY` → DSH 的 `.credentials.yaml` 顺序解析），
    因而结果质量与 DSH 内的搜索一致、且**不再默认把群聊关键词发给 Bing**（Bing RSS 只在 DeepSeek 不可用时兜底）。
    抓取仍由桥接自己做 SSRF 校验并限制正文大小；**黑话学习默认开启**，会把群聊里提取的词条交给所选的搜索后端。
    数据出机清单见 [LICENSE](LICENSE) 的「数据出机清单」，不需要就关掉黑话自动研究（`slang.autoResearch`）或把 `webSearch.provider` 设为 `bing`。
- **会话模型**：每个 QQ 会话（私聊/群）对应一个独立的 DSH 会话，统一归组到「QQ 聊天」工作区（不再散落未分组）；映射持久化在 `state/sessions.json`
- **性格定制**：QQ 会话默认使用 `qq-chat` agent preset，`reserved2` 使用 `qq-chat-v2`。DSH 0.1.7 起 preset 不再是 `~/.dsh/.agent-presets/<名>/` 目录，而是 `plugins/qq-agent-presets/` bundle 生成并插入 profile 的一条 `@deepseek-ai/dsh-agent-preset` 行（重启 DSH 后生效）；人格与默认 DSH 一致（coding agent），仅附加 QQ 场景规则；**角色扮演**是可选机制——由控制台或管理端设置 `state/current-role.json` 注入（群友无法更改）
- **本地控制台**：桥接自带 Web 控制台 `http://127.0.0.1:3100`——左侧按操作任务分为「运行总览 / 会话与审批 / 人格与角色 / 二代仿真 / 一代仿真 / 黑话词库 / 令牌与花费 / 访问与安全 / 调试与运维 / 工具参考」十个页面，右上角搜索框可跨页定位任意功能项；支持**浅色 / 深色双主题**（顶栏一键切换，未选择时跟随系统）；切换运行模式（chat / closed-agent / reserved / reserved2）、设置角色、静默开关、查看活动日志、修改管理员/控制台令牌，全部即时生效；访问需要令牌（`config.json` 的 `consoleToken`，未配置时自动生成并打印在启动日志；控制台内可手动修改或重新生成）
  - **令牌与花费看板**：实时显示 AI 的 token 消耗与折算金额（元），可下钻到**每个群 / 每个好友 / 每一轮对话**（轮次、步数、缓存命中/未命中输入、输出、命中率、花费、峰谷时段），并有**按时间的消耗走势图**（24 小时 / 3 天 / 7 天 / 30 天，柱子按高峰/空闲着色，一眼看出什么时候烧得凶、哪几个小时是 2 倍价）。累计总量取自 DSH 的 `tokenUsage` 投影（精确，含桥接启动前的历史），逐轮明细由 `assistant/message` 的 `usage` 折叠而来；金额按 DeepSeek 官方价目表折算并区分**高峰 / 空闲时段**（高峰单价为空闲的 2 倍，已内置中国法定节假日）。详见 [docs/guides/TOKEN_USAGE_CONSOLE.md](docs/guides/TOKEN_USAGE_CONSOLE.md)
  - **人格（角色扮演）管理**：列表点选即可载入查看/编辑提示词，支持新建、保存修改、改名（自动重命名文件）、另存为副本、删除；超过注入上限或含一代专用指令会实时提示
  - **两层提示词可分别查看与修改**：「仿真提示词」（预设内置，管行为与协议，保存后同步到 DSH，需重启生效）与「人格提示词」（`roles/*.md`，管人设与语气，保存即生效）；仿真层保存前做安全不变量校验与自动备份，可一键还原
  - **会话初始提示词**（二代仿真）：「二代仿真 → 初始提示词」里可以给某个群/私聊预写一段环境说明（圈子主题、群内氛围、常见话题、忌讳），AI **只在该会话第一次唤醒时收到一次**（之后已在会话上下文里，不再重复注入）。可在群还没说过话时提前写；AI 既读不到也改不了这份设置（仅控制台接口）。会话被重置（「会话映射」里的重置或「重置二代状态」）后，下一次首次唤醒会重新带上它。字数上限见 `socialV2.initialPromptMaxChars`
  - **DSH 思考强度**：默认 `max`，可选 `high` / `low`，档位从 DSH 实际公布的能力读取，保存后下一条消息生效；控制台会明示该设置同时写入 DSH 全局默认（`~/.dsh/settings.yaml`）
- **运行模式**：
  - `chat`：白名单群 + 白名单私聊 → qq-chat 安全聊天
  - `closed-agent`：仅私聊 owner（config.json 的 ownerQQ，可在控制台设置）→ 完整工具（默认用 DSH 自己声明的默认 preset，即 `standard`；可在控制台「closed-agent preset」下拉改为任意 DSH preset），可在 QQ 上操控 DSH
  - `reserved`（一代仿真）：仿真群友，观望/活跃/试探/退场状态机，选择性参与、按空格分句发送、主动收尾
  - `reserved2`（二代仿真，运行 `setup-dsh.mjs` 后 DSH 默认）：文本不自动转发，AI 通过 `qq_get_unread_messages` / `qq_send_message` 等工具自主看消息、发言、等待、设置唤醒/潜水；DSH 端使用 `qq-chat-v2` preset
- **交互增强**：
  - agent 通过 `ask_user_question` 提问时，问题会转发到 QQ，回复即自动应答
  - agent 请求工具审批时，转发到 QQ，回复「通过」/「拒绝」即可决策
  - 支持 DSH 斜杠命令（如 `/model`）与 `/reset`（重置会话上下文）
  - 群聊引用/回复会解析成「被引用人 + 原文」注入 DSH（如 `[引用 Derp：El Psy Kongroo是啥]机关的走狗`），让 AI 判断这句话是对谁说的，不会把群友之间引用第三方的对话误当成指向自己；引用机器人自己时会被视为必回
  - **图片/表情（含动图 GIF）**：表情包优先走 QQ 的 CDN 直链，`get_image` 失败时用 `emoji_id` 推出 CDN 地址兜底；媒体元数据保留 `emoji_id`/`summary`/`sub_type` 等字段。下载走同一套 SSRF 防护传输，并修掉了「DNS 先返回 IPv6、本机没有 IPv6 出口 → 每次白等 20 秒」的根因（改为 **IPv4 优先 + 逐地址故障切换**），动图表情不再时好时坏。单条消息上限默认 8MB / 64MP / 5 张（`socialV2.media`）
  - MCP 发送工具支持可选 `replyToMessageId`，并新增专用 `qq_reply` 工具：AI 可以先用 `qq_get_group_history` 拿到真实消息 id，再引用/回复某条消息（是否允许 AI 主动使用由人格/策略决定；桥接会检测发送类工具调用并自动跳过该回合的重复自动转发）
  - 一代仿真模式（`reserved`）下，AI 可以只输出 `[SILENT]` 表示“潜水/不接话”，桥接会静默不发送
  - 一代仿真模式（`reserved`）按空格分句：AI 用空格表示拆成多条消息；中英文/数字之间的空格也会被当成分条信号，不想分条就不要加空格（`reserved2` 不适用，分条请用 `qq_send_message` 数组）

## 前置条件

1. 运行中的 DeepSeek Harness Web（默认 `http://127.0.0.1:3080`）
2. 运行中的 SnowLuma，且配置好 OneBot WebSocket 与 HTTP API（默认 `ws://127.0.0.1:3001` / `http://127.0.0.1:3000`，`accessToken` 视配置填写）
3. Node.js ≥ 22.13

## 安装与配置

```bash
npm install        # 安装依赖（postinstall 会自动修补 @snowluma/sdk 的 ESM 打包 bug）
```

复制 `config.example.json` 为 `config.json` 后编辑：

> Windows CMD 用户请用：`copy config.example.json config.json`

> ⚠️ 真实 `config.json` 与 `state/` 不会进入公开仓库，仓库只提供脱敏的 `config.example.json` 模板。

| 字段 | 说明 |
| --- | --- |
| `dsh.baseUrl` | DSH Web 地址，默认 `http://127.0.0.1:3080` |
| `dsh.provider` / `dsh.model` / `dsh.reasoningEffort` | DSH 会话使用的模型/推理强度；若你的 DSH 没有示例中的模型，改成 DSH 设置页里可用的模型即可（选择失败只打日志，不阻塞启动） |
| `dsh.authToken` | DSH launch token（进程启动凭据）。**通常应留空**：留空时桥接用 `~/.dsh/.credentials.yaml` 里持久化的签名密钥**离线铸造**会话 Cookie，不依赖任何进程期状态（DSH 0.1.7 起启动 token 只存在于内存、日志里那条是上一个进程的陈旧值，换 Cookie 只会 401）。只有显式填了才会优先走 token 交换 |
| `dsh.authHeader` / `dsh.authPrefix` | 保留字段，当前新版 DSH 链路使用 Cookie 交换，不再直接发送该鉴权头 |
| `snowluma.wsUrl` | SnowLuma OneBot **WebSocket** 地址（如 `ws://127.0.0.1:3001`） |
| `snowluma.httpUrl` | OneBot **HTTP API** 地址（如 `http://127.0.0.1:3000`）；不要填 WebSocket 端口，否则会报 HTTP 426 |
| `snowluma.accessToken` | OneBot accessToken，未配置留空 |
| `snowluma.followDiscoveredEndpoint` | 默认 `true`。换 QQ 账号后 token 与端口都会变，桥接会自愈：重新发现并**跟随** SnowLuma 的端点（同时写回 `config.json`）。**想跑第二个实例 / 指向另一份 SnowLuma 安装（多账号、测试）时设为 `false`** —— 那时只自愈 token，绝不动 URL，也不写回 URL。详见「已知行为」 |
| `snowluma.silenceWarnMs` | 上游静默告警阈值（毫秒），默认 `600000`（10 分钟）。已连接但这么久没收到任何事件包（含心跳）时打警告；这只是**提示**，不确定性的判断交给 `good` |
| `snowluma.launcherPath` / `homeDir` | SnowLuma 安装目录（用于 token/端点自发现）。⚠️ 桥接**不会**启动或停止 SnowLuma（见 `LICENSE`） |
| `agentPreset` | QQ 会话使用的 DSH agent preset，默认 `qq-chat`（改性格见下文） |
| `socialV2.agentPreset` | `reserved2` 模式使用的 DSH agent preset，默认 `qq-chat-v2` |
| `socialV2.initialPromptMaxChars` | 会话「初始提示词」（控制台为某个群/私聊预写的环境说明）的字数上限，默认 2000，允许 100~8000。越界值会在启动时收敛并保持原文件不动 |
| `socialV2.media` | 图片/表情的上限：`maxBytes`（单条消息总字节，默认 8MB）、`maxPixels`（单张像素，默认 64MP）、`maxCount`（单条最多处理几张，默认 5）。越界值启动时收敛 |
| `webSearch.provider` | 联网搜索后端：`auto`（默认，优先 DeepSeek、失败回退 Bing）/ `deepseek`（仅 DeepSeek，无凭据时报错）/ `bing` |
| `webSearch.apiKeyEnv` / `apiKey` | 搜索凭据的环境变量名（默认 `DEEPSEEK_API_KEY`）/ 直接写死 key（不推荐）。都不设置时读 DSH 的 `$DSH_HOME/.credentials.yaml` 里同名 ref |
| `webSearch.baseURL` / `model` / `maxUses` / `maxResults` | 搜索端点（默认 `https://api.deepseek.com/anthropic/v1`，必须 https 且解析到公网）、模型（默认 `deepseek-v4-flash`）、单次搜索最多用几次工具、返回条数上限 |
| `workspaceTitle` | QQ 会话在 DSH 界面中的归组名称，默认「QQ 聊天」 |
| `allow.private` / `allow.groups` | 白名单（QQ 号/群号数组）；留空且 `allowAllWhenEmpty: true` 时放行全部 |
| `deny.*` | 黑名单，优先于白名单 |
| `ackMessage` | 消息投递后的立即回复，空字符串关闭 |
| `sendDelayMs` | QQ 连续发送间隔，防止触发频率限制 |
| `consolePort` | 本地控制台端口，默认 `3100` |
| `consoleToken` | 控制台访问令牌；留空时启动自动生成并保存到 `state/console-token` |

> ⚠️ `allowAllWhenEmpty: true` 表示「白名单没填就全部放行」——把 agent 接入 QQ 等于把账号控制权交给了模型，建议先填白名单。

### DSH 端安装（必做：装 preset + 挂 MCP）

桥接和控制台能跑起来还不够，DSH 端还需要安装两个聊天 preset（`qq-chat` / `qq-chat-v2`）并挂载 MCP。**单机新装同样必须执行这一步**（不是只有「另一台设备」才需要），装完还要**重启 DSH**：

```bash
node scripts/setup-dsh.mjs
```

> 全新环境下脚本会把 DSH 默认模式设为 **`reserved2`（二代仿真）**，并创建本地 `state/mode.json` 兜底；这样 AI 使用 `qq_send_message` 等工具收发消息时，DSH 会自动使用 `qq-chat-v2` 模式。如果本机已存在旧的 `state/mode.json` 或 DSH 设置值，脚本会保留不覆盖。之后可在**桥接控制台**（默认 `http://127.0.0.1:3100`）顶部按钮切换模式，控制台会同时写入 DSH 设置与本地兜底文件。

详细步骤见 **[docs/guides/DSH_SETUP.md](docs/guides/DSH_SETUP.md)**。

## 完整启动流程（从零开始）

共 6 步。DSH 已安装并运行，缺的是 SnowLuma 本体 + 桥接侧的 DSH 端安装（**第 2、3 步最容易漏，漏了 QQ 上会毫无反应**）：

1. **DSH**（已运行，无需操作）
   确认 `http://127.0.0.1:3080` 能打开即可。

2. **装桥接并复制配置**
   ```bash
   git clone https://github.com/Derpyu520/qq-bridge.git
   cd qq-bridge
   npm install
   ```
   Windows CMD 用 `copy config.example.json config.json`，其他平台用 `cp config.example.json config.json`。
   **示例模板里 `allow.private` / `allow.groups` 是空数组**——空白名单 + `allowAllWhenEmpty: false` 时桥接不响应任何消息（这是刻意的 fail-closed 默认值）。白名单在第 5 步填。

3. **装 DSH 端（preset + MCP），然后重启 DSH**
   ```bash
   node scripts/setup-dsh.mjs
   ```
   装完**必须重启 DSH**——preset 与 MCP 只在 DSH 启动时加载。
   跳过这步桥接不会崩，但群聊会话拿不到 `qq-chat` preset，桥接会**拒绝建会话**（有意的安全设计：绝不回退到带 bash/文件工具的默认 preset），表现同样是 QQ 上没反应。

4. **下载并解压 SnowLuma**
   - 下载：<https://github.com/SnowLuma/SnowLuma/releases/latest> 选 `SnowLuma-v<版本>-win-x64.zip`（完整版，自带 Node 运行时；Lite 版需本机 Node 22.13+）
   - 解压到任意目录（例如 `C:\SnowLuma`），双击 `launcher.bat`

5. **首次引导（WebUI）+ 填写桥接配置**
   - 打开启动日志里的 WebUI 地址（README 写的是 `http://localhost:5099`，以你启动日志里实际打印的为准）
   - 用**启动日志中的初始密码**登录，按引导：同意条款 → 设置密码 → 接入 QQ 进程（扫码登录）
   - 在 WebUI 里配置 OneBot 连接：开启 **WebSocket 服务端** 和 **HTTP API**，分别记下**端口**（默认 WS `3001`、HTTP `3000`）和 **accessToken**（若配置了）
   - 回到 `config.json` 填好 `snowluma` 段，并把 `allow.private` / `allow.groups` 换成**你自己的 QQ 号 / 群号**：

     ```json
     "snowluma": {
       "wsUrl": "ws://127.0.0.1:3001",
       "httpUrl": "http://127.0.0.1:3000",
       "accessToken": "你在 WebUI 里配置的 token（没配置就留空）"
     }
     ```

   `wsUrl` 是 OneBot **WebSocket** 端口，`httpUrl` 是 OneBot **HTTP API** 端口（不要填成同一个 WS 端口，否则 MCP 工具会报 HTTP 426）。

6. **启动桥接**
   ```bash
   npm start          # 前台运行（崩溃不自动重启）
   ```
   看到 `SnowLuma 已连接` 即成功；然后 QQ 上给机器人账号发条消息测试。
   Windows 想要「崩溃自动重启」请改用 `start.bat`（见下节）。

## 运行与运维

```bash
npm start          # 或双击 start.bat（守护模式：崩溃自动重启，关闭窗口即停止）
```

**⚠️ 重要**：
- **桥接只能运行一个实例**（有单实例锁，重复启动会被拒绝并提示"已有实例在运行"）
- **用 start.bat 启动**（守护模式），窗口别关——桥接崩溃会在 5 秒后自动拉起
- 桥接异常/消息无反应时：双击 `restart.bat`（自动杀旧实例 → 清理锁 → 重新启动守护）
- **重启 DSH 通常不需要动桥接**：每 5 秒探活，DSH 不可用期间收到的 QQ 消息在桥接进程内排队（最多 50 条/会话，满后丢最旧项），恢复后尝试补投。桥接进程退出会丢失内存队列；断线期间已经结束的回复暂不保证补发。
- 修改 `config.json` / `roles/` / `state/current-role.json` 后重启桥接生效；修改 `dsh/agent-presets/`（改完要跑 `node scripts/build-agent-preset-patches.mjs` 重新生成 bundle patch）或 MCP 配置后重启 DSH 生效

日志示例：

```
12:00:01 [bridge] SnowLuma 已连接：ws://127.0.0.1:3001
12:00:02 [bridge] 新会话 private:12345678 -> sess_xxxx
12:00:02 [bridge] 已投递 private:12345678: 你好
12:00:20 [bridge] agent 回复 (private:12345678) 42 字
```

## 7 天滚动记忆（窗口 + 日终维护 + 事实卡）

桥接会把**主人私聊**的聊天原文按天写进本地日志，最近 7 个自然日当成当前上下文；每天 23:00 做一次日终维护（归档窗口外日志 + 用模型刷新长期事实卡）；会话跨出 7 天窗口（或单会话累计文本超过阈值）时自动生成「交接摘要」、换一个新的 DSH 会话，旧原文永久归档、需要时用工具检索。群聊与他人私聊不落盘。

- 实现位置：独立包 `<DSMP_MEMORY_SRC>`（`@local/deepseek-memory`）；桥接通过 `src/bridge-memory.js` + `node_modules\@local\deepseek-memory` junction 引用，桥接内嵌的记忆逻辑已全部改为调用包内 `createMemoryEngine`；旧的 `src/memory-store.js`/`memory-digest.js` 已于 2026-10-29 删除（备份在 `backup/memory-phase5-20261029-090108`）。
- 数据目录：`config.json` 的 `memory.dir`（默认 `<DSMP_MEMORY_DIR>`）
  - `raw/hot/YYYY-MM-DD/private_<QQ>.jsonl`：窗口内的逐条原文（每行一个 JSON；窗口 = 今天 + 前 7 天，共 8 个日文件；旧布局 `hot/` 仍兼容读取）
  - `raw/archive/YYYY-MM/…-YYYY-MM-DD.jsonl`：窗口外的日文件，永久保留、不自动删除（旧布局 `archive/` 仍兼容读取）
  - `digests/…md`：每次轮转时生成的交接摘要（带 frontmatter）
  - `profile.md`：长期记忆事实卡（模型提炼的 bullet 列表：称呼/生日/口味/约定/计划…），每天日终刷新
  - `state/memory.json`：会话起点、字符数、轮转计数、待注入的交接摘要、事实卡已注入到哪个会话
- 窗口：`memory.windowDays`（默认 7）。今天 10-26 → 保留 10-19 起（含）的日目录；10-18 及更早整目录移到 `archive/`。窗口按自然日算，不按小时。
- 日终维护：`memory.dailyAt`（默认 `23:00`，本地时间）。维护内容 = 归档窗口外日志 + 模型刷新事实卡（`memory.profile`，模型失败回退关键词提取兜底）+ 顺手检查轮转。桥接启动后 5 秒先跑一次（补齐当天错过的日终）；`state/memory.json` 的 `lastDailyAt` 记录已完成的日终，重启不会重复跑。手动触发：`POST /api/socialV2/memory-maintenance`（控制台令牌，body `{"force":true}`，仅控制台可用）。
- 轮转条件：会话起点早于窗口起点（跨出 7 天，reason=`window`），或累计字符数 / 3 ≥ `memory.maxSessionTokens`（默认 60000，reason=`tokens`）。只在会话空闲（没有进行中/排队的 prompt）时轮转，避免打断回合。生成摘要期间如果有新消息建了新会话，这次轮转会取消，不会误停掉新会话。
- 交接摘要：默认调用模型（`memory.summary`，DeepSeek Anthropic 兼容端点，复用 `webSearch` 的 key）把窗口内原文压成「身份与约定 / 未完成话题 / 最近状态」三段；没 key、超时或报错时自动回退提取式摘要（`buildHandover`），轮转不会卡住。
- 注入：新会话的**第一条** prompt 前面会拼上「【长期记忆（事实卡）】」+「【7 天记忆交接】」。事实卡按 DSH sessionId 只注入一次（`profileInjectedFor`），交接摘要按 `consumedAt` 只注入一次（24 小时内可 `restoreHandover` 重试）。
- 新会话兜底：如果新会话既没有轮转生成的交接摘要、也没有任何待注入的 handover（例如 `state/sessions.json` 丢失），桥接会在投递前从日志补生成一次（`noteAutoHandover` 保证每个会话只检查一次），然后照常注入——不会出现「新会话只拿到事实卡、没有近 7 天上下文」。
- 去重：消息去重标记写进 `state/memory.json` 的 `recentIds`（最近 500 条），桥接重启后 SnowLuma 重放事件不会重复落盘。
- 检索工具：独立 MCP server `deepseek-memory` 的 `qq_memory_search`（DSH 里注册为 `mcp__deepseek-memory__qq_memory_search`），直接读 `raw/hot` + `raw/archive`，不依赖桥接常驻；桥接自带的同名工具与 `GET /api/socialV2/memory-search` 端点仍保留（端点需控制台令牌）。按关键词包含匹配、按日期过滤，返回日志原文；找不到返回空数组。
- 关掉的写法：`memory.enabled: false`（日志不再写、不再轮转），或 `socialV2.tools.memorySearch: false`（只关检索工具）；`memory.summary.enabled: false` 只关模型摘要、保留提取式；`memory.profile.enabled: false` 只关事实卡。
- 离线自测：包里 `node test/memory.test.mjs`（20 个场景，临时目录 + `QQ_MEMORY_DIR` 隔离）。桥接仓库旧的 `scripts/test-memory.mjs` 已于 2026-10-29 随旧实现一起移除（备份 `backup/test-memory.mjs.removed-20261029`）；桥接的 `npm run test:memory` 现在直接跑包内测试。
- 迁移旧布局：停桥接后 `node "<DSMP_MEMORY_SRC>\src\migrate.mjs"`（幂等，把 `hot/`、`archive/` 搬进 `raw/`）。
- DSH 原生记忆（`.dsh\memories`）：`node "<DSMP_MEMORY_SRC>\scripts\mirror-dsh-memories.mjs"` 镜像到 `persona\dsh-memories`；想做 junction（需 DSH 完全退出）用 `scripts\link-dsh-memories.mjs --yes`。

归档是**只增不减**的：要清理只能手工删 `archive/` 下的文件，桥接自己永远不会删。


- **阶段 5（2026-10-29）已完成**：桥接的记忆逻辑全部改为调用包内 `createMemoryEngine`（`src/bridge.js:26`），旧 `src/memory-store.js`/`memory-digest.js` 已删除；回滚用 `backup\memory-phase5-20261029-090108\` 覆盖 4 个文件并重启桥接，或跑 `install-adapter.mjs --uninstall --apply`。
- **启动自愈（2026-10-29）**：关机/杀进程打断生成会让 DSH 把会话留在 `running=true`，之后所有 prompt 永远排队（机器人看着在、实际不回消息）。桥接在 DSH 就绪时执行 `recoverStaleTurns()`，自动取消映射会话的遗留回合；见 HANDOFF 第 20 节。
## 日志目录

运行日志默认写在 `state/` 下：`bridge.log`（运行日志，最近 2000 行）、`qq-activity.log`（QQ 收发摘要，最近 500 行）、`token-usage.jsonl`（逐轮 token 明细）、`tool-calls.jsonl`（工具调用日志）。

想让日志和记忆放在同一个地方，在 `config.json` 顶层加：

```json
"logDir": "<DSMP_MEMORY_DIR>\\logs"
```

- 只影响上面四个**日志**文件；`sessions.json`、`social-v2.json` 这类状态仍必须留在 `state/`（换位置会让老映射与权限缓存全部失效）。
- 第一次切到外部目录时，桥接会把 `state/` 里的旧日志**复制**一份过去（原件保留，方便对照），之后只写新位置。
- 记忆本身（`hot/` `archive/` `digests/` `state/memory.json`）在 `memory.dir` 下，与 `logDir` 互不影响。

## 自测（不需要 SnowLuma / QQ）

离线回归（使用临时目录和模拟服务，不读取真实配置、不发 QQ 消息）：

```bash
npm run test:audit
```

reserved2 的 token 开销优化、消息水位协议、升级及回退说明（该专项分析为本地文档，未随仓库发布。）专项离线回归可运行 `npm run test:token`，已包含在上面的完整回归中。

控制台「令牌与花费」看板的账本与价目表回归（峰谷分时、幂等折叠、基线合并、压缩与容错）：

```bash
npm run test:tokens        # 单元测试
npm run test:console-ui    # 离线浏览器回归（含看板渲染与逐轮下钻）
```

本轮审查与修复明细为本地审计文档，未随仓库发布。升级后会为没有权限元数据的历史映射重建一次 QQ 会话；模式或 preset 变化也会自动重建，避免保留旧权限。旧历史仍在 DSH 中。

验证 DSH 侧链路是否打通（会创建一个独立测试会话，不影响现有会话）：

```bash
npm run self-test
```

预期输出：连接成功 → 测试会话创建 → prompt 被接受 → 打印 agent 回复。

## 目录结构

```
qq-bridge/
  config.example.json   # 配置模板（脱敏占位符；真实 config.json 不入库）
  README.md / README.en.md / RULES.md   # 根目录只留这三个文档，其余全在 docs/
  docs/
    README.md           # 文档索引（每篇一句话 + 是否仍然有效）
    FOLDER_MAP.md       # 目录结构与 scripts/ 命名约定
    guides/             # 面向使用者/运维：PROJECT_GUIDE / DSH_SETUP / VOICE / TOKEN_USAGE_CONSOLE / CONSOLE-UI-TESTING
    design/             # 设计与规划：GEN2_SIMULATION_PLAN / SOCIAL_MODE_PLAN / DSH_QQ_TOOLS_PLAN / 真人语感策略
    research/           # 调研：SnowLuma功能调研 / QQ消息免打扰 / 表情包能力 / 本地模型选型
    audits/             # 审查与优化报告（体检、控制台、token）
    legacy/             # 历史归档（已被取代或问题已全部修复的旧报告）
  audio/                # 语音库：把准备好的音频放这里，可作 QQ 语音发出（用法见 docs/README.md 文档索引）
  dsh/agent-presets/    # qq-chat / qq-chat-v2 的 DSH agent preset 模板
  plugins/qq-mode-console  # DSH 插件：注册 qq-mode 设置命名空间（仅 host 半，UI 卡片未实现）
  src/
    bridge.js           # 主程序
    dsh-client.js       # Node 版 DSH API 客户端（WS 下行）
    md-to-plain.js      # Markdown → QQ 纯文本
    self-test.js        # DSH 侧自测
  scripts/              # 测试/运维脚本（含 postinstall 的 patch-snowluma-sdk.mjs）
    patch-snowluma-sdk.mjs  # 修补 SDK 的 ESM 打包 bug（postinstall 自动执行）
  state/                # 运行时数据（不入库）
```

> 🎤 **独立的「发语音」工具不在这里**：它是仓库上一级的 [`../voice-tool/`](../voice-tool/)（`voice-cli.mjs` /
> `voice-gui.mjs` / `public/voice.html` / `发语音.cmd`）。图形界面双击上一级的「发语音-图形界面.cmd」。
> 它只依赖 SnowLuma，共享内核仍由本仓库 `src/voice-core.js` / `src/snowluma-conn.js` 提供（单一实现）。
>
> ```bash
> cd ../voice-tool
> node voice-cli.mjs status     # 账号/token 自动发现 + 连通性
> node voice-cli.mjs list       # 可发的群聊/私聊 + 语音库
> node voice-cli.mjs            # 交互菜单
> node voice-gui.mjs            # 图形界面（本地小服务 + 浏览器 UI）
> ```

## SnowLuma 版本与上游健康（「连上了但收不到消息」）

「注入」在这个技术栈里只发生在一处：**SnowLuma 用原生组件挂进 QQ 客户端进程**（它自己日志里叫
`[Hook]`，载体是安装目录的 `native/snowluma-win32-x64.{dll,node}`）。**本桥接没有任何原生/注入面**
（依赖全为纯 JS，源码里没有 `.dll` / `.node` / FFI / 进程注入），也不启动、不控制 SnowLuma 或 QQ ——
所以「QQ 注入失败」不可能是本桥接造成的。但**桥接过去无法把这个失败讲清楚**，于是它经常被误报成
「qq-bridge 的问题」。现在桥接会主动把上游健康报出来。

### 已知行为：连上了 ≠ 收得到

SnowLuma 的 `[Hook]` 会退化：它的进程和 OneBot WebSocket **都还活着**，但收不到 QQ 侧的数据。
它自己的日志长这样：

```
WARN [Hook] receive path stale: PID=… UIN=… silentFor=136193ms; reporting good=false
WARN [Hook] process enumeration timed out after 4000ms (worker abandoned)
```

这时桥接这边**一切正常**：WebSocket 通、日志打过 `SnowLuma 已连接`、控制台没有异常，但群里一条消息都不来。
桥接现在对此做两件事：

1. **主信号**：每 30 秒一次的 `meta_event/heartbeat` 载荷里的 `status.good`（SnowLuma 对「QQ → 原生 hook → 我」这条**接收链路**的自评，静默约 105 秒后翻 `false`）。心跳是 SnowLuma 自己的定时器无条件发的，所以这条信号免费且及时，且不需要较新的运行时。
   兜底：每 60 秒问一次 `get_status`（`{online, good}`）。加分项：`bot_status`（账号会话上下线，**SnowLuma 1.14.20 才真的有**）+「距最近一个事件包的时长」（只能证明进程/WS 还活着，**不能**证明收得到 QQ 数据 —— 心跳会一直来）。
   > ⚠️ **不要用 `get_login_info` 取 `good`**：它只返回 `{user_id, nickname}`，而 SDK 不校验 data 载荷 ⇒ 不会报错、`good` 永远是 `null`、这条判断变成永不触发的死代码。（本功能的第一版实现正是这么写错的，回归里已加反面断言钉住。）
2. 判定退化时：日志打**明确指向 SnowLuma `[Hook]`** 的警告、控制台「运行总览」出现 `SnowLuma 上游` 卡片、
   「访问与安全」页出现告警条，`GET /api/status` 的 `snowluma` 字段给出 `degraded` / `good` / `hint`。

排查顺序：控制台看 `SnowLuma 上游` 卡片 → 看 SnowLuma 的 `logs/snowluma-*.log` 里的 `[Hook]` 行 → 再考虑升级 SnowLuma（**升级不换原生组件，见下**）。

### 版本要求

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| SnowLuma **运行时**（QQ 网关本体） | **1.14.20 已实测**（1.14.9 亦兼容） | **实测记录（2026-10-03，SnowLuma 1.14.20 + QQ 在线）**：包 SHA256 与官方发布摘要一致；心跳 `status.good=true`／`interval=30000`；桥接走完「首次 1006 → 自愈 WS token → 已连接」；收到群消息（`lastPacketKind: message/group`）；完整往返成功（唤醒 → DSH 建会话挂 `qq-chat-v2` → 工具发送 1/1 条 → 实际发出两条回复）。 ⚠️ **升级运行时不会更换注入用的原生组件**：实测 `native/snowluma-win32-x64.{dll,node}` 与 `websocket-win32-x64.node` 在 **1.14.9 与 1.14.20 之间逐字节完全相同**（三方对比：官方 1.14.9 包 == 本机安装 == 官方 1.14.20 包），变的只有 `index.mjs`（+414 KB）等 JS 层。所以**升级能带来 OneBot 事件流水线、收发与新区块链路上的修复（`bot_status`、markdown 带 text、事件种类订阅更全），但不会修「原生 hook 挂不上 QQ」这类问题** —— 那种要走 SnowLuma 自己的排查。**升级 SnowLuma 是使用者自己的事**：本桥接只探测、不部署（见 [LICENSE](LICENSE) 与 [RULES.md](RULES.md)） |
| `@snowluma/sdk` / `@snowluma/mcp`（本仓库依赖） | 已钉 `^1.14.20` | 客户端库；OneBot v11 是稳定契约，新库可连旧运行时（本项目实测：库 1.14.20 + 运行时 1.14.9 可正常收发） |
| `bot_status`（账号上下线） | **1.14.20 有；1.14.9 没有** | 逐一核对的只有这两个版本：`bot_status` 在 1.14.9 的 `index.mjs` 里出现 **0** 次、1.14.20 里 **3** 次（带 `sub_type`/`user_id`）。**具体从哪个版本引入未逐版核对**。桥接对老运行时**优雅降级**：订阅不到就只靠心跳 `good` 与 `get_status` |

### 已知行为：HTTP token 与 WS token 是**两个不同的值**

SnowLuma 同一个账号的 **HTTP token（默认 3000 端口）与 WebSocket token（默认 3001 端口）并不相同**
（实测；`snowluma.accessToken` 里通常只能存一个 —— 存的是 HTTP 那个）。因此：

- **桥接每次启动的首次 WS 连接几乎必然失败一次**（日志里 `SnowLuma 连接断开（code=1006）` →
  `SnowLuma 首次连接未成功（将在后台自动重连并尝试自愈 WS token）`），随后自愈重新发现 WS token、
  重连成功，才打出 `SnowLuma 已连接`。**这条序列是正常的，不是故障。**
- 真正会一直连不上的情况：**自愈无从下手** —— `snowluma.homeDir` 没配 / 被移动 / 读不到
  SnowLuma 的 `config/onebot_<QQ号>.json`，或权限不足。这时日志里会有 `token 自愈失败`，
  而 QQ 侧表现为**完全收不到消息**。先确认 `homeDir` 指向真正的 SnowLuma 安装目录。

### 已知行为：端点自愈会覆盖你写的 `wsUrl`

换 QQ 账号后 OneBot 端口与 token 都会变，所以桥接在连不上时会自愈：重新发现 SnowLuma 的端点并
**写回 `config.json`**。这在主场景下是对的，但它不区分「配置里是个过期值」和「你就是要指向别处」——
想跑第二个实例或指向另一份 SnowLuma 安装时会连错账号。要关掉：

```json
"snowluma": { "followDiscoveredEndpoint": false }
```

关掉后**只自愈 token**（换账号仍能恢复），绝不动 URL、也不写回 URL。

## 已知限制

- agent 回复在回合结束时一次性发送（不做流式逐字转发）；回复超过 `socialV2.send.maxMessageChars`（默认 500 字，可用 `social.maxReplyChars` 调整）自动按句读/URL 边界分段
- 图片及部分表情可以通过安全下载接入多模态模型；语音/视频以及无法取得图片字节的消息仍使用占位文本
- **发**语音是支持的（独立工具的图形界面 / 命令行 / AI 工具，见 `docs/README.md` 的文档索引）；但**收**到的语音目前只显示占位文本，不做语音转写入上下文
- **AI 发语音默认关闭**（`socialV2.voice.enabled` 与 `tools.sendVoice` 默认 `false`）：先把音频放进 `audio/`，再到控制台打开开关；你自己发语音不受这个开关影响
- agent 的 Markdown 回复会转成纯文本（链接保留 `文字 (url)` 形式）
- `@snowluma/sdk` 的 npm 发布版存在 ESM 扩展名 bug，本仓库通过 postinstall 补丁修复（见 `scripts/patch-snowluma-sdk.mjs`）

## 合规提醒

SnowLuma 是独立第三方项目，与腾讯/QQ 无隶属关系，仅供学习与技术研究；使用前请阅读其 EULA 与《QQ 用户协议》。

## 端口自愈（2026-10-30）

隔离测试：`npm run test:dsh-port`（8 条，注入假 probe/假端口，不碰真实 DSH 与 config）。覆盖：当前端口可用不动、当前可用但无 qq-chat 要切走、优先选带 qq-chat-v2 的实例、无插件实例时保持不动、探测全失败给候选清单、回写失败仍用新端口、force 重新评估、`portsFrom` 解析。


DSH 桌面版每次重启都会换 Web 端口，`config.json` 的 `dsh.baseUrl` 过期后桥接不会报错，而是每 30 秒「本次收到 0 帧」（看起来像 DSH 没启动）。

`src/dsh-port.mjs` 会：启动时校准一次；运行中连续 3 次 0 帧再校准。候选端口只取「进程名像 DSH」的进程在 127.0.0.1 上 LISTENING 的端口，并用 `agentPresets/list` 探活；**优先选带 `qq-chat-v2` 的实例**（本机可能同时跑着不止一个 DSH，连错就建不了 QQ 会话）。选中后回写 `config.json`，日志打「DSH 端口自动纠正」。

## 轮转判据用 DSH 的压力值（2026-10-30）

记忆轮转不再只靠扫 `logs/token-usage.jsonl`：桥接每 60 秒调一次 `sessions.list`，把每个会话的 `projections.values.contextPressure` 缓存起来，引擎同步读取；拿不到（DSH 没就绪、会话被清）才回落日志扫描。好处是判断更及时、也不会因为映射失配读到 0。

## 机器人不说话了，先跑这两条

只读诊断，不碰配置、不重启任何东西：

```
npm run check:bot         # 注入 / OneBot / 桥接上游
npm run check:presets     # preset 清单 / 会话挂载
```

`check:bot` 一次说清四件事：SnowLuma WebUI 5099 在不在、OneBot 3000/3001 通不通、桥接有没有连上上游、账号在线与最近心跳多久之前。缺哪环会直接给出下一步（注入页 → 反向 ws 地址/token → 小号登录）。

两块的结论还会追加到 `state\boot-check.log`（带 ISO 时间戳、`bot` / `presets` 两种标签；超过 512 KB 自动只留最近一半，最多留 4 次开机记录的量）。开机后如果「没反应」，先翻这个文件，比几千行 bridge.log 快。

两条都已经接进 `start-bot.cmd`：开机各打一块结论，桥接/SnowLuma 还没起来就等到 25–30 秒，超时跳过，**不会阻塞、也不会让启动失败**（`--warn-only`）。

## preset 丢了怎么办

DSH 每次重启会换 Web 端口，而“那个实例有没有装 qq 预设”不由桥接决定。表现是群聊/仿真会话直接不回（日志里一行 `⛔ 缺少 preset "qq-chat-v2"，拒绝回退`）。先跑一条命令把三件事问清：

```
npm run check:presets      # 等价：node scripts/check-presets.mjs
```

启动脚本也接上了这一步：`start-bot.cmd` 最后会跑一次 `check-presets.mjs --wait=25 --warn-only`，开机直接打一行结论；桥接还没起来就跳过，**不会阻塞、也不会让启动失败**。

输出会告诉你：桥接连着哪个 DSH、它看见几个 preset、每个映射会话实际挂的是哪个、缺哪个。缺失时按提示走：确认 `~/.dsh/profiles/desktop/package.json` 里有 `qq-agent-presets` 的 link → `node scripts/setup-dsh.mjs desktop` → 重启 DSH。
