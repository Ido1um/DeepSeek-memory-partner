# DSH 直连版「<PERSONA>」完整方案与可行性分析

- 日期：2026-10-29
- 状态：方案定稿，未开始写代码；2026-10-30 新增“全部放在 `<DSMP_WORKSPACE>`”的目录约束
- 目标：让「<PERSONA>」不依赖 QQ/SnowLuma/qq-bridge，也能在 DSH 里直接聊天；记忆与 QQ 版共用同一套独立记忆引擎。
- 前提：本机 DSH 为桌面版 44.7.0（harness 0.2.1-rc.2），已安装 `dsh-memory-evolve` 本地插件，可用来核对 DSH 插件 API。

---

### 0.1 项目根目录（2026-10-30 新增）

**DSH 直连版新增的全部内容，统一放在：**

```text
<DSMP_WORKSPACE>
```

包括：插件源码、预设、配置模板、脚本、测试、文档，以及开发期的临时运行数据。

边界必须分清：

- **现有 `<DSMP_BRIDGE_DIR>`、`SnowLuma`、线上 DSH profile 不放进去、不改动**；开发期不重启线上 DSH/QQ/桥接。
- **记忆数据不搬**：仍共用 `<DSMP_MEMORY_DIR>`，否则 QQ 版和直连版会分叉。
- **现有记忆引擎 `<DSMP_MEMORY_SRC>` 保留为源**；开工时在 `DeepSeek partner\vendor\deepseek-memory` 放一份固定副本，附 `SOURCE.md` 记录来源与哈希。开发只改副本，源目录不动；切换时再决定以哪份为准。
- 现有方案文档暂放 `DSH-QQ-bridge\docs`；开工时同步一份到 `DeepSeek partner\docs`，原处保留只读索引，避免“功能在 partner、说明找不到”。

---

## 0. 一句话结论

**可行，但不是“把 qq-bridge 搬进 DSH”**：正确做法是写一个 DSH 本地插件 `dsh-memory-host`，在 DSH 宿主里监听会话事件、读写现有独立记忆引擎，并用 DSH 的 `agents` 服务完成会话轮转。QQ 版继续保留，两边共用 `<DSMP_MEMORY_DIR>` 的记忆数据。真正的两个风险点是「注入时序」和「自动切新会话的 UI」，必须先用两个小 POC 锁死，不能直接铺代码。

---

## 1. 目标与非目标

### 1.1 目标

1. 在 DSH Web 里打开一个「<PERSONA>」会话，直接打字就能聊，不需要 QQ、SnowLuma、qq-bridge 任一进程在线。
2. 直接聊天产生的消息自动进入独立记忆：全文日志、7 天热窗口、归档、事实卡、交接摘要、检索。
3. 7 天窗口/ token 阈值到达时，能自动或半自动切换到新 DSH 会话，并把旧会话摘要注入新会话。
4. QQ 恢复时，QQ 聊天与 DSH 直聊共享同一份记忆；两边不重复、不丢、不乱序。
5. 全部本地：不依赖云端记忆服务、不依赖 QQ 登录、不引入新的在线授权。
6. 人格仍为「<PERSONA>」，`<PERSONA_ALT>` 只是小名；角色卡、语气、边界不因换入口而变。

### 1.2 非目标

- 不重写 DSH 的模型/会话内核。
- 不把 QQ 协议、SnowLuma 注入、OneBot 传输搬进 DSH 插件。
- 不做多用户/群聊；直连版只服务 owner（<OWNER_QQ>）。
- 不在第一阶段接 RVC、音乐生成、Qwen 改图等未完成能力。
- 不把记忆上传到任何外部服务；备份仍走本地 E 盘。

---

## 2. 现状与可复用边界

### 2.1 现有组件

| 组件 | 当前位置 | 作用 | 直连版是否依赖 |
|---|---|---|---|
| DSH 桌面/Web | 本机 DSH 44.7.0 | 聊天 UI、模型、会话、工具 | **是**（宿主） |
| `dsh-memory-evolve` | `<USER_HOME>\.dsh\local-plugins\dsh-memory-evolve` | 现成的 DSH 插件范例，证明事件/注入/建会话 API | 参考实现，不直接改 |
| 独立记忆引擎 | `<DSMP_MEMORY_SRC>` | 日志、7 天窗口、归档、事实卡、交接、检索 | **是**（核心） |
| 记忆数据 | `<DSMP_MEMORY_DIR>` | raw/hot/archive/digests/state | **是** |
| qq-bridge | `<DSMP_BRIDGE_DIR>` | QQ 传输、工具、人格、现有记忆钩子 | 直连版不依赖；共存时共用数据 |
| **直连版项目根** | **`<DSMP_WORKSPACE>`** | **DSH 直连版新增的插件/预设/脚本/配置模板/文档/测试** | **是（新增代码只放这里）** |
| SnowLuma | `<LOCAL_TOOLS>\SnowLuma` | QQ 注入/OneBot | 直连版不依赖 |
| A绘世/GPT-SoVITS | `<AI_ROOT>...` | 画图/语音 | 可选，不作为直连版前置 |

### 2.2 能直接复用的

- 记忆引擎的存储格式、7 天窗口、事实卡、交接摘要、`memory_search` 语义。
- 现有引擎的固定副本：开工时复制到 `<DSMP_WORKSPACE>\vendor\deepseek-memory`，附 `SOURCE.md`（来源、时间、哈希）；开发只改副本，`DeepSeek memory` 源目录保持不动。
- 角色卡 `<DSMP_BRIDGE_DIR>\roles\<PERSONA>.md` 与现有 DSH `dsh-persona` 预设机制。
- DSH 的 Web 聊天界面、模型选择、工具白名单、MCP 机制。
- `dsh-memory-evolve` 已经验证过的 DSH 插件骨架（事件、注入、建会话、Web API、客户端面板）。

### 2.3 不能直接复用的

- qq-bridge 的 `deliverPromptNow` / `ensureSession` / `retireSession` 是桥接自己的会话生命周期，不能原样搬进 DSH 插件。
- qq-bridge 的 `sendToQQ`、OneBot、SnowLuma 注入逻辑与直连版无关。
- 当前 qq-bridge 的 7 天记忆写入仍在 `src/bridge.js`（阶段 1 引擎已完成但桥接未完全切换），直连版不能假设“桥接已经用引擎”；需要按“双写/共用 schema”设计，不能靠口头约定。

---

## 3. 可行性结论（先看这张表）

| 能力 | 现有证据（本机代码） | 结论 | 风险 |
|---|---|---|---|
| 捕获 DSH 用户/助手消息 | `dsh-memory-evolve/lib/advisor/index.js:397` 监听 `session/event`，`{global:true}`；`observer.js` 使用 `session.ownEvents()` / `deriveMessages()` | **可行** | 事件类型/顺序随 DSH 版本变；需 POC |
| 生命周期管理 | 同文件 `:407` `agent/created`、`:411` `agent/disposed`、`:421` `session/disposed` | **可行** | 重连会重建 agent，需幂等 |
| 向当前回合注入记忆 | `lib/advisor/delivery.js:117` `agent.inject(message)`、`:126` `agent.steer(message)` | **API 存在** | 是否在模型看到用户消息前生效，必须 POC-1 |
| 自动创建新会话 | `lib/session-orch.js:645` 调 `ctx.agents.create({sessionId, meta:{cwd,agentPreset}, setup: presets.mount})` | **可行** | 要处理预设挂载、工作区 attach、UI 切换 |
| UI 切到新会话 | `lib/client.js:16227` 客户端 `sessions.open(sessionId)`（memory-evolve 的面板已用） | **可行，但需要客户端插件** | 没有客户端插件时只能让用户手点 |
| 人格/预设 | DSH `dsh-persona` + `roles\<PERSONA>.md` | **可行** | 角色卡路径/预设挂载别写死 |
| 独立记忆读写 | `DeepSeek memory` 引擎 + `<DSMP_MEMORY_DIR>` | **可行** | 与 qq-bridge 双写要加锁/去重 |
| QQ 不可用时直聊 | 直连版不依赖 QQ 进程 | **可行** | 记忆里 QQ 旧消息仍可读 |

### 3.1 两个必须先做的 POC（不做就不铺代码）

**POC-1：注入时序**
- 在一个测试 DSH 会话里装一个最小插件：`session/event` 收到 `user/message` 时，用 `agent.steer` 注入一段带随机标记的 `【MEMORY-TEST-xxxx】`。
- 验证模型本轮回复是否看到该标记（让它复述标记）。
- 若看不到：改用 `systemPrompt` 前缀/`dsh-persona` 方案；若两种都不行，直连版只能做“会话开始注入 + 手动新会话”，不能声称每轮自动注入。

**POC-2：自动切新会话**
- 用 `ctx.agents.create` 建一个测试会话，再用客户端 `sessions.open` 打开；验证左侧列表、输入框、预设工具都正常。
- 验证旧会话不丢、不重复写；新会话第一条消息能拿到旧会话交接。
- 若 UI 无法自动切：退化为“轮转按钮/命令 + 自动建会话”，不能假装全自动。

**结论：POC-1/2 都过，才进入 Phase 2；任一不过，方案降级但直连聊天仍可做（Phase 1 先交付）。**

---

## 4. 目标架构

```
DSH Web UI
   │
   ▼
DSH host (44.7.0)
   ├─ <PERSONA> preset (dsh-persona + 工具白名单)
   ├─ dsh-memory-host (本地方案插件)
   │     ├─ session/event 捕获
   │     ├─ agent.steer / systemPrompt 注入
   │     ├─ ctx.agents.create 轮转
   │     └─ webServer /api/memory-host/* 状态与手动操作
   └─ memory_search MCP（只读检索，可复用 DeepSeek memory）
          │
          ▼
独立记忆引擎 <DSMP_MEMORY_SRC>
          │
          ▼
<DSMP_MEMORY_DIR>
   raw/  hot/  archive/  digests/  state/

QQ（可选，恢复时）
QQ → SnowLuma → qq-bridge ──共用同一记忆目录──► 同一引擎
```

### 4.1 组件

1. **`dsh-memory-host`**（新，DSH 本地插件）
   - 运行在 DSH host 内，随 DSH 启停。
   - 只做：捕获、注入、轮转、状态 API、手动命令。
   - 不直接做 QQ/网络/大模型调用。

2. **`dsh-memory-ui`**（可选，DSH 客户端插件）
   - 只负责：显示记忆状态、`轮转`按钮、切到新会话。
   - 没有它，Phase 1/2 仍可用命令行/手动新会话；Phase 3 的“自动切”需要它。

3. **`shenming` agent preset**
   - 角色卡：`roles\<PERSONA>.md`。
   - 工具白名单：`memory_search`、`memory_recent`、`memory_status`（只读），以及用户明确需要的安全工具；不默认开 shell/fs/网络。
   - 每轮/每会话由 preset 与 host 插件共同决定注入。

4. **记忆引擎**
   - 复用 `DeepSeek memory` 的 engine，不另写一套 JSONL 语义。
   - 如果 engine 接口缺“按 surface 写/去重”，在 engine 内补，不在插件里复制逻辑。

---

## 5. 数据模型

### 5.1 统一 key

推荐：

- 规范 key：`private:<OWNER_QQ>`（owner 的私聊键，沿用 QQ 侧现有 key）。
- 每条消息增加：
  ```json
  {
    "ts": "2026-10-29T23:00:00+08:00",
    "key": "private:<OWNER_QQ>",
    "surface": "dsh",
    "conversationId": "session-...",
    "messageId": "dsh:session-...:seq",
    "role": "user",
    "text": "..."
  }
  ```
- `surface`: `qq` / `dsh`。
- 去重键：`surface + conversationId + messageId`；引擎写入前查重。
- 这样 DSH 直聊和 QQ 私聊共享同一份 7 天记忆；QQ 不可用时不影响读取。

备选（如果用户想隔离）：`dsh:<OWNER_QQ>` 独立 key，QQ 与 DSH 各自 7 天；不推荐，除非明确要求“两个入口记忆分开”。

### 5.2 存储布局

沿用：

```
<DSMP_MEMORY_DIR>\
  raw\YYYY-MM-DD.jsonl        # 全量原文
  hot\YYYY-MM-DD\...jsonl     # 7 天窗口
  archive\YYYY-MM\...         # 7 天前
  digests\                    # 交接摘要
  state\memory.json           # 游标/事实卡/注入标记
```

直连版不新建第二套目录；否则 QQ 恢复后会读到两份不一致的记忆。

### 5.3 事实卡与交接

- 事实卡：`profile.md`，按 key 生成，按 `sessionId` 只注入一次。
- 交接摘要：`digests/`，轮转时生成；新会话第一条 prompt 注入一次。
- 失败回退：模型不可用时用提取式摘要；事实卡保留旧卡，不覆盖空卡。

---

## 6. 会话生命周期

### 6.1 捕获

监听：

- `session/event` 的 `user/message`（`source.kind === 'user'`）、`assistant/message`、`turn/end`。
- `agent/created`：登记 `agent.id -> sessionId`、开始时间、cwd、preset。
- `agent/disposed` / `session/disposed`：刷盘、清理计时器、保留映射。

实现要点：

- 只记录**可见对话**；不记录 `tool/result`、advisor 注入、系统提示。
- 用 `session.deriveMessages()` 取权威消息序列，按 messageId 去重；不要只靠事件增量。
- 每条消息写入是异步的，但不阻塞 DSH 回合；写失败进重试队列，不能静默丢。
- DSH 重连会 `agent/disposed -> agent/created`，必须按 sessionId 幂等，不能重复写。

### 6.2 注入

**首选通道**：`agent.steer`（POC-1 验证时序）。
**备选通道**：`systemPrompt` 前缀 / `dsh-persona` 的 prompt 前缀（若 steer 晚于模型）。

注入内容：

```
【长期记忆（事实卡）】
...（仅新会话首次）

【7 天记忆交接】
...（仅新会话首次/轮转后首次）

【检索提示】
需要更早的事，调用 memory_search；不要凭空编造旧事。
```

规则：

- 事实卡按 `sessionId` 只注入一次（`profileInjectedFor`）。
- 交接按 `consumedAt` 只注入一次；注入成功后 commit（标记 consumed），不能失败也标。
- 失败重试不能重复注入；下一轮可补。
- 注入文本有长度上限（建议事实卡 ≤ 2000 字，交接 ≤ 4000 字），超长截断并保留“可检索”提示。
- 注入不得进入正文日志（否则自我污染）；只记一条 `injection` 元数据。

### 6.3 轮转

触发条件（与 QQ 版一致）：

- `session.startedAt` 早于 7 天窗口起点；或
- 会话 tokens ≥ `maxSessionTokens`（建议 60000）；或
- 用户手动点“轮转”。

流程：

1. 当前回合结束后（`turn/end`）检查，绝不在 turn 中切。
2. 生成交接摘要（引擎/模型；失败回退提取式）。
3. `ctx.agents.create({ sessionId: newId, meta: { cwd, agentPreset }, setup: presets.mount })`。
4. 新会话第一条用户消息注入交接；旧会话标记 archived，不再接收新消息。
5. 客户端 `sessions.open(newId)` 切换；无客户端则 UI 提示“新会话已创建，请点左侧”。
6. 失败处理：不删旧会话、不标记 consumed；保留原会话继续可用。

**关键限制**：`ctx.agents.create` 能建会话，但 GUI 是否愿意自动切到新会话取决于客户端 API；POC-2 必须先验证。不要在没有 POC 的情况下承诺“无感轮转”。

### 6.4 日终维护

- 复用引擎 `tick/startMaintenance`：每天 `dailyAt` 做归档 + 事实卡刷新。
- DSH 插件只调用引擎，不自己实现归档逻辑。
- 跨天、DSH 未启动时由 QQ 桥或下一次 DSH 启动补齐；两处都要幂等。

---

## 7. DSH 预设、人格与工具

### 7.1 预设

建议新增 `shenming` preset（不动现有 `qq-chat-v2`）：

- persona：`roles\<PERSONA>.md`（主名<PERSONA>，小名<PERSONA_ALT>）。
- 工具：`memory_search` / `memory_recent` / `memory_status`（只读），按需加 `read_image` 等安全工具。
- 不默认加载 QQ MCP；否则 QQ 不在线时工具列表会报错。
- 直连版和 QQ 版可以共用同一角色卡，但**不共用 QQ 工具白名单**。

### 7.2 人格边界

- 主人只有 QQ <OWNER_QQ>；DSH 直聊的 owner 也是同一个人，但不在 QQ 场景，不模拟 QQ 群/拍一拍。
- 角色卡里的“QQ 群唤醒/拍一拍”规则对直连版不生效；直连版按 1:1 聊天。
- 不因为入口变化改口癖/称呼；`<PERSONA_ALT>` 只在被叫小名时回应。

---

## 8. 与 QQ 版共存 / 降级

### 8.1 共享

- 同一记忆目录、同一引擎、同一 key；`surface` 区分来源。
- 两边写入前按 `surface+conversationId+messageId` 去重。
- 两边都读同一份事实卡/交接；不各自生成两份互相矛盾的摘要。

### 8.2 降级

| 场景 | 行为 |
|---|---|
| QQ/SnowLuma 不在 | DSH 直聊正常；`memory_search` 仍可查旧 QQ 记忆 |
| DSH 不在 | QQ 版继续用桥接记忆；不影响已存数据 |
| 记忆引擎不可用 | DSH 仍可聊天，注入降级为“记忆暂不可用”；写入进重试队列 |
| 轮转失败 | 旧会话继续用；不丢消息；提示手动重试 |
| 双写冲突 | 以 messageId 去重；冲突记审计日志，不覆盖 |

### 8.3 迁移

- 现有 QQ 记忆 key 已是 `private:<OWNER_QQ>`；DSH 直聊直接用同 key，无需重写历史。
- 旧消息没有 `surface` 字段：读取时默认 `qq`。
- 首次启用直连版前做一次热备份（已有每周任务；可手动立即跑一次）。

---

## 9. 实施阶段（完整版，不偷懒）

| 阶段 | 内容 | 交付物 | 预计 | 验收 |
|---|---|---|---|---|
| Phase 0 | 备份/冻结；建插件骨架与 `shenming` preset；不写记忆 | 可启动空插件；DSH 能加载 preset | 0.5–1 天 | 插件加载无报错；preset 可选；不影响 QQ |
| Phase 1 | 捕获 + 写入 + 只读 `memory_search`；不注入/不轮转 | 直聊消息进 raw/hot；检索可查 | 2–3 天 | 3 轮对话全入库；重启不重复；QQ 记忆可查 |
| Phase 2 | 注入事实卡/交接；POC-1 时序验证；失败回退 | 新会话首条 prompt 带记忆；不重复 | 3–4 天 | 模型能复述注入标记；失败不阻塞聊天 |
| Phase 3 | 轮转 + 新会话 + UI 切换；POC-2 | 自动/半自动轮转；旧会话归档 | 4–5 天 | 强制轮转成功；新会话首条带交接；UI 可切 |
| Phase 4 | QQ 共用/双写去重/降级/安全/文档 | 双入口共存；恢复演练 | 3–4 天 | QQ 停/DSH 停均可用；不重复；文档齐全 |
| Phase 5 | 硬化/验收/打包 | 可运行快照 + 使用说明 | 1–2 天 | 全量验收清单通过 |

**总计约 12–18 个工作日**（含测试）。如果 POC-1/2 任一失败，Phase 2/3 改降级方案，不硬凑“全自动”。

---

## 10. 验证与验收

### 10.1 单元/集成

- 捕获：user/assistant 消息、工具消息过滤、重复事件幂等。
- 注入：首次注入一次、失败重试、注入不进正文、长度截断。
- 轮转：窗口/token 触发、turn 中不切、失败保留旧会话。
- 检索：7 天内/归档/跨 surface 查询；空结果不编造。
- 双写：QQ/DSH 同 key 并发写；去重键生效；无覆盖。

### 10.2 场景验收

1. DSH 直聊 3 轮 → raw/hot 有完整记录；重启 DSH 不重复。
2. 新会话首条消息 → 事实卡 + 交接各一次；第二条不再注入。
3. 强制轮转 → 新会话建立、旧会话归档、UI 切换、交接可见。
4. QQ 停 → DSH 直聊正常；旧 QQ 记忆可检索。
5. DSH 停 → QQ 正常；QQ 消息恢复后能被 DSH 检索。
6. 记忆引擎/模型失败 → 聊天不阻塞、错误可见、数据不丢。
7. 备份恢复 → 从 E 盘快照恢复后，DSH 直聊仍能读到同一段记忆。

### 10.3 安全

- 插件只读写记忆目录；拒绝任意路径/命令/网络。
- 工具白名单最小化；不默认暴露 shell/fs。
- 日志含聊天原文，按现有 E 盘备份保密策略处理，不上传。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| DSH 插件 API 变动 | 插件失效 | 冻结 DSH 44.7.0；本地插件随快照备份；不自动升级 |
| `agent.steer` 注入晚于模型 | 本轮看不到记忆 | POC-1；失败改 systemPrompt/persona 前缀；再不行降级为会话开始注入 |
| UI 不能自动切新会话 | 轮转体验断 | POC-2；客户端 `sessions.open`；失败退化为按钮/提示 |
| 双写重复/乱序 | 记忆污染 | messageId 去重 + 单写队列 + 审计日志；桥接最终切到同一引擎 |
| 现有桥接记忆未完全引擎化 | 两边格式不一致 | Phase 4 加 bridge adapter；直连版先按 schema 写，不依赖桥接 |
| 会话重建/重连 | 重复注入/重复写 | `profileInjectedFor`/`consumedAt` + 幂等键 |
| 上下文过长 | 模型变慢/爆窗 | token 阈值轮转；注入有上限；归档 |
| 角色卡/预设路径写死 | 换机失效 | 预设内用相对路径；文档记录；快照包含 |
| 隐私泄露 | 聊天记录外泄 | 全本地；E 盘访问控制；备份不上传 |

---

## 12. 需要用户确认的决策

1. **记忆共享**：DSH 直聊与 QQ 私聊共用 `private:<OWNER_QQ>` 一份 7 天记忆（推荐），还是分开两个 key？
2. **轮转体验**：自动切新会话（需要客户端插件，POC-2）还是“自动建会话 + 用户点一下左侧”（更稳）？
3. **工具面**：直连版只给 `memory_search` 等只读记忆工具，还是要同时给画图/TTS 工具？
4. **实施节奏**：先做 Phase 1 可用版（约 3–4 天），还是等 POC-1/2 通过后一次做到 Phase 5（约 12–18 天）？

---

## 13. 不做的部分

- 不复制 qq-bridge 的 QQ 传输/OneBot/SnowLuma 代码到 DSH 插件。
- 不做多用户/群聊/拍一拍模拟。
- 不做云端同步、在线授权、自动更新。
- 不在本方案内接 RVC/音乐/Qwen 改图。
- 不承诺“完全无感轮转”直到 POC-2 通过。

---

## 14. 建议的下一步

1. 先做 **POC-1 注入时序**（半天）：最小插件 + `agent.steer` 标记复述。
2. 再做 **POC-2 建会话/切 UI**（半天到一天）：`ctx.agents.create` + `sessions.open`。
3. 两个 POC 都过 → 按 Phase 0→5 实施；任一不过 → 先交付 Phase 1（捕获+检索+会话开始注入），轮转降级。
4. 每个 Phase 结束做一次热备份，并在 E 盘 runtime 快照旁保留本方案与验收记录。

---

## 15. 证据索引（本机）

- `<USER_HOME>\.dsh\local-plugins\dsh-memory-evolve\lib\advisor\index.js:397`：`session/event` 全局监听。
- 同文件 `:407` / `:411` / `:421`：`agent/created` / `agent/disposed` / `session/disposed`。
- `...\lib\advisor\delivery.js:117`：`agent.inject(message)`；`:126`：`agent.steer(message)`。
- `...\lib\session-orch.js:645`：`ctx.agents.create({ sessionId, meta, setup })` 的实际用法。
- `...\lib\client.js:16227`：客户端 `sessions.open(sessionId)`。
- `...\lib\advisor\observer.js:188`：`session.deriveMessages()` 取权威消息。
- 现有角色卡：`<DSMP_BRIDGE_DIR>\roles\<PERSONA>.md`。
- 现有记忆引擎：`<DSMP_MEMORY_SRC>\src\engine.mjs`。
- 现有记忆数据：`<DSMP_MEMORY_DIR>`。
