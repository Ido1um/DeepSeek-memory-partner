## 2.0.3 — 备份面板可选手动路径、保留 2 份（2026-11-15）

- 备份与恢复卡片新增「备份目录」输入 + 浏览…/保存路径/恢复默认：目录留空用默认 <DSH_HOME>/dsmp/backups，自定义目录在首次备份时自动创建。
- 新增 `POST /api/dsmp/backup/pick-dir`（Windows 文件夹选择器，180s 超时），设置保存校验目录必须是绝对路径。
- 备份保留数默认从 10 改为 2（界面提示「只保留最近 2 份」，可在设置里改）。

## 2.0.2 — 修复聊天面板不显示当前 QQ 会话（2026-11-14）

- 根因：`/api/dsmp/history/sessions` 与 QQ 合并历史把「带 `parentSession` 的会话」一律当子代理过滤；而 `sessions.fork` 出来的会话也会带 `parentSession`（指向分叉来源），于是当前 QQ 会话从下拉框和时间线里消失，面板自然找不到「当前会话」。
- 改为只按 `origin === 'subagent'` 或 `delegationDepth > 0` 过滤；fork 会话恢复显示，合并历史仍按 role|at|文本前 80 字去重，不会与分叉前重复。
- 验证：`/api/dsmp/history/sessions?limit=60` 返回 bound=1 / bridgeLive=true；`/api/dsmp/history?scope=qq` 能取到该会话最后一段对话。
- 顺手修：`installClientErrorHooks` 在无 `window.addEventListener` 的环境（测试桩）直接跳过；`test/dsmp.test.mjs` 的 React 桩补 `Component`，全套 **216/216**。

## 2.0.1 — 设置页签移到选项栏最右侧（2026-11-14）

- 面板顶栏页签顺序改为：聊天 / 历史记录 / 记忆速览 / QQ 通道 / **设置**；「设置」只排在最后，不做额外右推。
- 只改 `lib/client.js`（刷新页面生效）；host 侧仅版本号与 CHANGELOG 更新。

## 2.0.0 — QQ bridge 并入 DSMP（2026-11-14）

- **结构性变化**：QQ bridge 与 SnowLuma 实体归位到插件目录 `components\{DSH-QQ-bridge,SnowLuma}`（旧目录改名 `.moved-*` 观察），插件从「记忆 + 面板」升级为「记忆 + 面板 + QQ 通道 + 本地能力」单包。按版本约定（主版本只在数据/架构级变化时跳），本次进入 **2.0.0**。
- **QQ 通道页**：新增 8 个子页（总览 / 人设 / 仿真 / 会话 / 黑话 / 访问 / 消费 / 运维），读走 `lib/qq-proxy.js`（`x-console-token`，每请求读 tokenFile、不回显），写走 `lib/qq-write.js` + `POST /api/dsmp/qq/write`（写令牌保护，mode/role/role-mode/security/whitelist/socialV2/test-send/restart，二次确认，审计 `<DSH_HOME>\dsmp\logs\qq-audit.jsonl`）。
- **网关抽象**：`components\gateway.json`（active + profiles snowluma/napcat/onebot11），`lib/qq-gateway.js` 契约自检 / 写 bridge 四值 / 备份回滚；`lib/qq-channel.js` 提供面板启停（qq-boot.ps1 / qq-halt.ps1）与状态。切换非 SnowLuma 时强制 `followDiscoveredEndpoint=false` + `homeDir=""` 防自愈。
- **迁移工具**：`tools\dsmp-qq-migrate\`（migrate-components.mjs / qq-boot.ps1 / qq-halt.ps1 / apply-production.cmd / rollback-production.cmd / 验收清单），支持 dry-run、apply、journal 回滚、folded YAML 路径归一、junction 重建、vendor/memory 的 MCP 依赖补链。
- **本地服务**：面板「本地服务」统一管理 QQ 机器人（bridge 3100）、画图引擎 ComfyUI（8188）、GPT-SoVITS（9880）、记忆工作台（7351）；draw 已从 A绘世切到 ComfyUI，启动等待 120s。
- **面板**：QQ 通道改为 bridge 控制台式布局（左侧 4 组 8 项导航 + topbar + 内容区），全部颜色改用 DSH 主题令牌 `--dsw-alias-*`；记忆页签保留 19 视图；新增 `PanelErrorBoundary` 与客户端错误上报（`POST /api/dsmp/client-error`）。
- **验证**：测试 21 文件 **216/216**；生产迁移后 components 就位、4 条 MCP 在线、bridge `dshReady=true`、面板启停 boot 24.1s / halt 10.6s；QQ 通道 8 分区在线全 200。

## 1.15.14 — UI 颜色统一到 DSH 系统主题（2026-11-13）

- **统一取色**：插件所有页签不再使用自己的深蓝/深绿硬编码色板，全部改为 DSH 主题令牌 `--dsw-alias-*`：底色 `bg-base`、卡片/侧栏 `bg-elevated`、文字 `label-primary/secondary/tertiary`、边框 `border-l1/l2`、主色 `brand-primary`、按钮 `button-primary-fill` + `label-primary-foreground`、状态色 `state-success/warn/error`。深浅色随 DSH 主题自动切换，删除了原先按 `prefers-color-scheme` 复制的两套色板。
- **范围**：对话/历史/记忆速览/设置/QQ 通道全部生效；「记忆」页签 `.dsmp-wb` 与「QQ 通道」`.dsmp-qqc` 的 CSS 变量改为映射 DSH 令牌，聊天气泡、输入框、表格、错误/警告条、按钮同步。
- **保留**：星图 canvas 的节点色（hard/long/general/temp/人物/主题/日期）属于可视化语义色，不跟主题变。
# CHANGELOG

## 1.15.13 — 面板渲染错误兜底与上报（2026-11-13）

- **黑屏兜底**：面板顶层加 `PanelErrorBoundary`，任何页签渲染抛错只显示错误文本，不再让整个窗口变黑；QQ 通道每个分区单独 try/catch（`renderSectionSafe`），出错时只影响该分区并上报。
- **错误上报**：client 侧安装 `window.error` / `unhandledrejection` 钩子，通过 `POST /api/dsmp/client-error` 把消息、堆栈、URL 追加到 `<DSH_HOME>\dsmp\logs\client-error.log`（正文上限 32KB），用于定位「点 QQ 通道其他功能黑屏」的具体原因。
- **验证**：`node --check lib/client.js lib/index.js` 通过；刷新页面后操作可复现路径，日志即写入。

## 1.15.12 — QQ 通道跟随系统浅色（2026-11-13）

- **浅色配色**：QQ 控制台样式的颜色全部收敛到 `.dsmp-qqc` CSS 变量，新增 `@media (prefers-color-scheme: light)` 覆盖：底 `#f7f8fb`、卡片/侧栏 `#fff`、边框 `#e3e8f1`、文字 `#202635`、主色 `#4d6bfe`；深色值保持原样。错误/警告底与提示条边框也改为主题变量，浅色下不再出现浅红/浅黄看不清的问题。
- **验证**：`node --check lib/client.js` 通过、React 桩加载模块通过；系统切换深/浅色时页面自动跟随（无需刷新）。

## 1.15.11 — QQ 通道改成 bridge 控制台样式（2026-11-13）

- **UI 重构**：`QqChannelTab` 从「横向按钮 + 单列卡片」改成 bridge 控制台式布局：左侧 200px 固定导航（QQ Bridge 品牌、4 组 8 项、底部 bridge 端口/就位状态），右侧 52px topbar（面包屑 QQ 通道 / 当前页、DSH 与账号状态、刷新）+ 可滚动内容区（max 1080）。
- **视觉**：配色对齐 bridge 控制台深色版（`#0d1016` 底 / `#6b86ff` 主色）；新增卡片、指标格、行、表格、chip、按钮、输入框的统一样式；概览页改为 4 指标（模式/网关/角色/DSH）+ 运行状态卡 + 活动日志卡。
- **验证**：`node --check lib/client.js` 通过、React 桩加载模块通过；刷新页面生效。

## 1.15.10 — QQ 通道修复滚动（2026-11-13）

- **修复**：`QqChannelTab` 最外层从裸 `div` 改为 `flex:1 1 auto + minHeight:0 + overflowY:auto` 的滚动容器。面板根 `styles.page` 是固定高度、`overflow:hidden` 的 flex column，QQ 通道内容超过一屏时会被裁掉且无法滚动；现在与「记忆速览」一致，在页签内部滚动。
- **验证**：`node --check lib/client.js` 通过；刷新页面后 QQ 通道（网关卡 + 8 子页）可上下滚动。

## 1.15.9 — 面板体检修复（2026-11-13）

- **契约自检**：`get_msg` 用空 `message_id:1` 探测时真实网关必回 retcode 100「消息不存在」，旧逻辑判 fail，导致面板「契约自检」永远不过；现按 `lenientNotFound` 处理（HTTP 200 + retcode 100 / not found 判 ok），并在明细里注明「空 id 探测：消息不存在，端点本身可用」。
- **网关探测**：未安装的占位 profile（NapCat / OneBot11 无 homeDir、无启停脚本、httpUrl 沿用 SnowLuma 3000）不再拿 SnowLuma 的结果冒充，直接返回 `GATEWAY_NOT_INSTALLED`「该网关未安装」。
- **本地服务**：`POST /api/dsmp/services` 对未知服务名由 500 改为 400（「未知服务：xxx」），脚本执行失败仍 500。
- **文案**：记忆页签左栏品牌副标题「旧 7351 工作台 · 已并入插件」→「记忆工作台 · 已并入插件」。
- **验证**：4 文件 `node --check` 通过；热重载后 probe snowluma `ok=true`（required 5/5）、napcat/onebot11 `ok=false code=GATEWAY_NOT_INSTALLED`；services `nope` HTTP 400；全套 **216/216**。

## 1.15.8 — 画图引擎切 ComfyUI（2026-11-13）

- **本地服务**：`draw` 服务由 A绘世（7860 / `scripts\start-ai-api.cmd`）改为 ComfyUI（8188 / `scripts\start-comfy-api.cmd`、`scripts\stop-comfy-api.cmd`），标签/提示同步为「ComfyUI · ComfyUI API · 8188」。
- **启动等待**：`draw` 从 60s 放宽到 120s（ComfyUI 冷启动要拉起 Python/torch，比 A1111 慢）。
- **诊断**：`/api/dsmp/diagnostics` 的端口聚合 `7860` → `8188`（仍含 3100/7351/9880）。
- **面板**：设置页本地服务卡底部说明改为「ComfyUI / GPT-SoVITS 由 bridge 在空闲 10 分钟后自动关闭」。
- **背景**：bridge 的 `imageGen.backend` 已是 `comfy`（QQ 画图已走 ComfyUI）；A绘世脚本与 7860 仍保留作回滚，只是不再出现在面板里。
- **验证**：`node --check` 4 个改动文件全过；热重载后 `GET /api/dsmp/services` 显示 `draw` 为「ComfyUI / 8188 / scriptExists:true」；面板 API 启动 **20.1s** 后 8188 监听（`/system_stats` 返回 ComfyUI 0.45.0 + RTX 5060），停止 **1.4s** 后端口释放；`/api/dsmp/diagnostics` 端口表为 3100/7351/8188/9880。

## 1.15.7 — QQ 通道写操作批次（2026-11-13）

- **新增** `lib/qq-write.js` + `POST /api/dsmp/qq/write`（写令牌保护）：
  - `mode`（运行模式 + 封闭预设）、`role`（切换角色，null 清空）、`role-mode`（active/silent）
  - `security`（interceptNotify 开关 / rehardenStateDir 重试收紧）
  - `whitelist`（allow/deny/ownerQQ 全量写，数字去重与上限 200）
  - `socialV2`（enabled / tools 布尔 / wake / send / wait 局部 patch，只接受白名单字段，≤8KB）
  - `test-send`（真实发 QQ，必须 `confirmText=确认发送`）
  - `restart`（重启 bridge，必须 `confirmText=确认重启`）
  - 每次尝试（含被拒）追加 `<DSH_HOME>\dsmp\logs\qq-audit.jsonl`
- **面板**：概览加模式/角色模式快捷按钮；人设卡可直接切换角色；仿真页可开关仿真、一键启用被关工具；访问页可增删白名单号码、切换拦截通知、重试收紧 state；运维页加「测试发送」与「重启 bridge」（各带二次确认输入）。
- **验证**：`test/qq-write.test.mjs` 12 条（mock bridge：各 op 路径/body、枚举校验、白名单去重、patch 过滤、confirm 门、审计落盘）；全套 21 文件 **216/216**；在线安全写入实测 mode/role/security/socialV2 全部 ok、bridge 状态不变、审计 6 行。

## 1.15.6 — QQ 通道 8 子页（只读镜像）（2026-11-13）

- **新增** `lib/qq-proxy.js`：把 bridge 控制台 API 收敛成 8 个只读分区——`overview`（状态/白名单/活动）、`persona`（角色卡/上限/正文预览）、`sim`（仿真开关/工具计数/唤醒/发送/语音/TTS）、`sessions`（映射+唤醒状态合并）、`slang`（词条列表）、`access`（白名单/安全/state 目录收紧）、`usage`（QQ 侧 token 账本 totals/按会话）、`ops`（桥接地址/暂停/令牌/活动）。全部走 `x-console-token`，令牌每次读文件，不回显。
- **新增路由**：`GET /api/dsmp/qq/{overview|persona|sim|sessions|slang|access|usage|ops}`（只读；写操作仍只走 `/api/dsmp/qq/channel`）。
- **面板**：QQ 通道页改为「网关卡 + 8 子页导航 + 只读分区内容」；表格/徽标/活动日志按记忆页签同一套 `.dsmp-wb` 视觉。
- **状态**：still components 未迁移 → 页头提示先跑 `tools/dsmp-qq-migrate/apply-production.cmd`；网关启停按钮禁用。桥接读取在未迁移时也能看到实时状态（3100 可达）。
- **验证**：`test/qq-proxy.test.mjs` 10 条（本地 mock bridge：鉴权、8 分区形状、未知分区、缺令牌/不可达降级）；全套 20 文件 **204/204**；在线 8 个分区对真实 bridge 全部 200（overview 1.6KB、slang 7.3KB、usage 1.5KB）。

## 1.15.5 — QQ 通道骨架（components 迁移前只读提示）（2026-11-13）

- **新增模块**：`lib/qq-gateway.js`（gateway.json 读写、契约自检、bridge 四值应用/回读/恢复）+ `lib/qq-channel.js`（网关状态、profile 探测、desired/current 切换、qq-boot/qq-halt 启停）。
- **新增路由**：`GET/POST /api/dsmp/qq/channel`（GET 状态；POST `probe|set-active|boot|halt`，写保护走 `WRITE_PATHS`）。
- **面板**：新增顶级页签「QQ 通道」——组件目录/桥接/令牌/期望与运行/上次切换；每个 profile 卡显示能力、契约自检、设为期望；启动/停止按钮在 `components` 未就位时禁用并提示先跑迁移。
- **当前状态**：生产尚未执行 components 迁移，页面显示「未安装」；迁移执行包在 `<DSH_WORKSPACE>\tools\dsmp-qq-migrate`（`apply-production.cmd` / `rollback-production.cmd`），迁移后需重启 DSH 并再 reload 一次插件。
- **验证**：沙箱 `test_work\dsmp-qq-v2` 全绿（gateway 8/8、qq-boot/halt e2e 23 断言、迁移 25 断言、qq-channel 5/5）；生产 `node --check` 通过、`GET /api/dsmp/qq/channel` 200 `{componentsPresent:false,profiles:[]}`、`POST probe` 返回 `{ok:false,error:"GATEWAY_NO_FILE"}` 不 500。

## 1.15.4 — 注入提示不再进入聊天面板（2026-11-12）

- **症状**：面板对话里出现整段【规则（手写 · 优先级最高）】+【长期记忆（事实卡）】，像主人发了 1800 字。
- **根因**：bridge 的部分唤醒 prompt 只带规则与事实卡、没有【本次消息快照】/【面板消息】标记；`session-log.js` 的 `panelOrigin()` 落到最后的 plain 分支，把整段注入当成了主人发言。
- **修法**：没有快照/面板标记且正文以 `【规则` 开头或包含 `【长期记忆（事实卡）】` 时，一律归为 host、`displayText` 置空并在生成气泡时丢弃；新增回归测试（只有规则与卡片的日志不产生主人气泡）。
- **验证**：`test/dsmp.test.mjs` 58/58；真实合并历史里「规则（手写」命中 0。
## 1.15.3 — 面板消息投到旧会话的修复（2026-11-12）

- **症状**：面板点发送后，自己发的文字不出现，像「发不出去」；实际上写接口已通过。
- **根因**：`settings.session.liveId` 停留在旧会话 `session-724c03d0…`，而 bridge 已把 `private:<OWNER_QQ>` 映射到新会话 `session-6a062976…`。`chat/send` 信任本地记录的 id，把消息投进了没人读的旧会话，面板的合并历史里自然看不到，她也不会回复。
- **修法**：`chat/send` 先向 bridge 取当前映射（优先 `settings.channel.key` 对应的行），发现本地 liveId 过期就改投映射会话，并回写 `settings.session.liveId`；后续请求都用新 id。
- **验证**：用旧 id + 空文本探测 → 400「消息不能为空」，同时 `settings.json` 的 liveId 已自动改为 `session-6a062976…`；误投到旧账本的两条「晚安」turn 176/177 已标 quarantined。

## 1.15.2 — 面板写操作 403 修复（2026-11-11）

- **症状**：面板发消息、上传图片/语音、保存设置时报「写操作需要 x-dsmp-token（或同源请求）」。
- **根因**：写守卫只认 `Sec-Fetch-Site: same-origin`；Electron/自定义协议渲染层不会发这个头，而客户端此前从不带 `x-dsmp-token`，于是所有写请求都被 403 挡下（读请求不受影响）。
- **修法**：① `GET /api/dsmp/status` 无条件返回 `writeToken`（跨站页面读不到响应体，服务端也没有 CORS 头；本机进程本来就能读令牌文件，不增加暴露面）；② `lib/client.js` 增加 `apiFetch`，首次写请求前取一次令牌，所有非 GET 的 `/api/dsmp/*` 自动带 `x-dsmp-token`；③ `guardWrite` 增加 Origin/Referer 与 Host 同主机兜底，`Sec-Fetch-Site` 缺失时仍能识别同源。
- **验证**：裸 POST 与 `sec-fetch-site: cross-site` 仍 403；带令牌 POST 200（面板路径打通）；robustness 10/10。

## 1.15.1 — 消费账单/记忆星图对齐旧工作台 + 记忆页签换皮（2026-11-11）

- **消费账单**：`usageView` 从「按天简表」升级为 7351 同口径的全量账单——`days/scope/session/turn` 过滤；只统计 `logs/token-usage.jsonl` 的 `k=turn` 逐轮采样（`k=base` 计入 `baselineRows`）；桶取 `b.cacheHit/cacheMiss/cacheWrite/output`，按 `lib/price-table.js`（从桥接 `src/model-prices.js` 复制，零外部依赖，含峰谷/节假日）现算成本；用 `window/<sid>/turns.jsonl` 判定 owner（有主人原话）/wake（synthetic 或派生）/unknown（查不到轮次）/setup（无 turn）；返回 totals/scopes/bySession/byKind/byDay/byModel + 记忆侧 `logs/memory-usage.jsonl` 的 memory.totals/byCaller + priceVersion。面板账单页重做：范围/会话/轮次类型筛选、四张轮次类型卡、六格总计、按天/按会话/按模型三表、记忆侧表与口径脚注，金额 `¥x.toFixed(3)`。
- **记忆星图**：`graphView` 对齐旧 `buildGraph`（TOPIC_RULES 主题归类、label 回退 value 前 8 字、invalid/expired/due/size、about/topic/due 连线、tiers 浅色、byType/truncated）；`lib/client.js` 移植旧 `starmap.js` 为 canvas 3D 力导向 `StarMap`——斐波那契球面初排 + 斥力/弹簧/阻尼模拟、深空底色与星层、按深度渐隐的二次曲线连线、按 z 排序的节点、人物/主题/日期/悬停标签、拖拽旋转/滚轮缩放/点击事实开详情/空闲自转/重排/硬事实与待办筛选/全屏（Esc 退出）/ResizeObserver 自适应，替换原 SVG 静态网格。
- **记忆页签换皮**：改为 `.dsmp-wb` 作用域外壳——CSS 变量（深色默认 + `prefers-color-scheme: light` 覆盖）对齐旧工作台令牌，左侧 208px 分组导航（运行/记忆/工具）、topbar + 卡片内容区；卡片/输入/按钮/表格全部令牌化。只作用于记忆页签，其它页签仍走 fallback 原色。
- **服务端配套**：`configureWorkbench({ vendorDir, libDir })` 新增 LIB_DIR 与按 mtime 破缓存的 `lib()`（data: URL 热重载下不能相对 import）；`index.js` 的 usage 分支透传 `days/scope/session/turn`，默认 14 天。
- **验证**：`node --check` client/state/index 通过；全套 19 个测试文件 **193/193**（`workbench-views` 的 usage 用例改为新结构，并覆盖 scope/turn 过滤）；bundle off（401）→on 后在线 usage 14 天 200（calls 2187、cost ¥41.267、hitRate 97.97%）、7 天 owner 200（762 次 / ¥13.444）、graph 200（202 节点 / 364 链接）。
- **小调整**：星图在记忆页签左侧导航置顶（不带分组标题）；星图改成按事实节点投影均值动态垂直居中（每帧对齐到画布 44% 高度，替代固定 `h*0.46`），画布高度改为 `clamp(380px, 56vh, 560px)` 避免在面板里被裁切——星星不再整体偏下。
- **未验证**：DSH Web GUI 需要启动令牌，agent 侧无法直接截图，需刷新页面目视；星图斥力参数如需更舒展可微调 `starStep` 的 K/G。

## 1.15.0 — 记忆工作台并入面板（7351 移植，2026-11-11）

- **目标**：把 7351 独立记忆工作台的能力整体搬进插件「记忆」页签，迁移期 7351 只作对照，不再需要单独开服务。
- **服务端（`lib/workbench/state.js` 723→约 900 行；`lib/workbench-write.js`）**：
  - 新增视图：概览（事实/主题/情境/窗口/媒体/账本/体积）、事实卡预览（与注入同源 `buildTreeCard`，含收录/挤出统计）、上下文与轮转（阈值 70 万、每会话 max5 占用、折叠与策略）、会话与策略、生效配置、星图、媒体墙、折叠记录、导出、单条事实详情（`v10.explain`）。
  - 深化：`factsView` 加 topicTitle/score/grade/tier/hits/ageDays（修 `topic.title` 字段名 bug）；`windowView` 增 feels/blocks/mediaRefs；`topicsView` 按 slot 折叠（同槽留 3 条、孤儿计数）；`usageView` 增 byDay/byKey/day 过滤。
  - 写：`factHistory` 并入 longterm 事件流（`h-ep-eda5c188` 从 0 条→6 条），desired 草稿（`<DSH_HOME>\dsmp\workbench-desired.json`，14 键 + scoring + policies）与 apply（备份 bridge config → 写 memory.*/profile.maxChars/scoring/policy.keys → 可选重启 QQ）。
- **客户端（`lib/client.js`）**：记忆页签 19 个视图；事实行内编辑/调档/调分/还原/拆开/详情抽屉/历史链；窗口会话下拉、语气与图片缩略图；检索路由解释与 limit 4/6/10；激活页补 salienceFloor；设置页生效配置表单（保存草稿 / 稍后重启 / 立即重启二次确认）。
- **过渡开关**：`settings.ui.legacyWorkbench` 默认 `false`，默认隐藏 7351 入口（能力已在记忆页签）；需要对照时改成 `true` 并刷新页面。
- **验证**：`node --check` 四个文件通过；全套 193/193（新增 `test/workbench-views.test.mjs` 11 条）；bundle off（401）→on 后在线 GET 19 个视图全 200，desired-save 200 并落盘 967B。
- **热重载注意**：bundle off/on 只有在 `lib/index.js` 自身 mtime 变化时才重新 import；改 `lib/*` 后先 touch index.js 再 toggle。

## 1.14.1 — 聊天记录不再混入子代理提示词（2026-11-11）

- **症状**：面板「对话/历史记录」里出现「你是翻译小组的译员，负责把一篇加速器物理 + 机器学习论文完整翻译成中文」这类提示词，看起来像主人说的话。
- **根因**：主会话与它派出的子代理共用同一个 cwd（`<DSMP_MEMORY_DIR>\agent`），1.13.4 的合并逻辑只按 cwd 归并，把 `origin:'subagent'`、带 `parentSession`、`delegationDepth>0` 的会话也并了进来；这些会话的第一条 `user` 消息是派发任务时的提示词，没有 QQ 来源。
- **修法**：`lib/session-log.js` 的 `scanSessions()` 回传 `origin/parentSession/delegationDepth`；`lib/index.js` 的 `qqHistoryEntries()` 排除子代理会话（三条件任一命中即跳过），`/api/dsmp/history/sessions` 的会话下拉同样排除。
- 验证：合并会话 16 → 11，`scope=qq&q=翻译小组` 命中 0；子代理完成通知（「Background subagent … finished」）也从聊天记录中剔除；主人的正常消息与 wait 消息不受影响。测试 182/182。

## 1.14.0 — 长期记忆按重要度分排序（2026-11-11）

- **统一分数**：新增 `vendor/memory/src/importance.mjs`，`W = 0.55×I + 0.45×档位基值 + 作者/类别/提及次数小加成`，`score = 100 × W × R`（R 仍是时间衰减，hard 不衰减）；分档 核心 ≥80 / 重要 60–79 / 一般 40–59 / 边缘 <40。分数读取时计算，不写回数据。
- **面板「长期事实」**：`lib/workbench/state.js` 的 `factsView` 增加 `score/grade/tier/hits/ageDays`，排序改为「正常 → 旧事 → 已作废，组内分数降序」；`lib/client.js` 增加分数徽标、档位/提及次数/最近天数、六个筛选 chip、50 条一页的「显示更多」。
- **检索公式（默认关）**：`vendor/memory/src/scoring-runner.mjs` 新增 `memory.scoring.ranking.{applyToSearch,scoreWeight}`，默认 `false` 保持旧行为；打开后去掉 `档位×1000`，改 `结构命中 + 命中 500 + score×4 + 提及×10`。`describe` 结果多回 `importance` 与 `weight`。
- **对比**：10 条真实问法（生日/相机/课表/考研/摄影/英语/保研/地平线/我们/计划）旧 vs 新，**top-1 全部一致**，只有第 3–5 名互换；因此先只开面板，检索开关观察一周后再定。
- 验证：新增 `test/importance.test.mjs` 6 条；全套 18 个测试文件逐个跑 **182/182**；`/api/dsmp/workbench?view=facts` 返回 `sort=score`、`grades={core:38,important:24,normal:1,edge:93}`。
- 回滚：还原 `score.mjs`/`scoring-runner.mjs`/`state.js`/`client.js`（快照 `<BACKUP_ROOT>\dsmp-rank-20261111-1235`），或把 `applyToSearch` 置回 `false`。

## 1.13.6 — 等待期间收到的图片也能显示（2026-11-11）

- **1.13.5 的遗留**：wait 结果里的消息补了文字，但 `images` 留空，像 11-10 22:55 那张「[图片]」只有占位没有图。
- **图片引用来源**：主人发图后她通常调用 `qq_get_message_images` 看图，图片以 DSH 附件块（`attachmentId`、`bytes`、`width`、`height`）存在那条 `tool/result` 里。`lib/session-log.js` 新增 `imageRefsByMessageId()` 预扫描：按「工具调用参数里的 messageId → 紧随其后结果里的 image 块」建映射，wait 消息按 `row.messageId` 取回附件引用。
- **直接出图**：`lib/index.js` 给这类图片生成 `url=/api/dsmp/media/attachment?id=…&mt=…&b=…&w=…&h=…`，并把该路由扩成 GET（原来只支持 POST），`<img src>` 可直接取 200 字节；`lib/client.js` 的 `MediaThumb` 优先用 `item.url`。
- 验证：22:55 那条现在带 `images[0].attachmentId=sha256:7d7b51cc…`，GET 该 url 返回 200 / image/jpeg / 473,000 B；17 个测试文件 176/176。

## 1.13.5 — 补上「等待期间收到的消息」（2026-11-11）

- **缺失原因**：桥接用 `qq_wait_for_messages` 收到新消息时，那条话只出现在 `tool/result` 的 `newMessages` 里，不会再有独立的 `user/message` 行；面板原来只解析 `user/message`，于是「她等了一会儿才回你」的那类消息整体缺失（例如 11-10 22:56「其实我还是喜欢看你穿礼服的那版」）。
- **修法**：`lib/session-log.js` 的 `itemsFromLines` 增加 `tool/result` 分支，解析结果里的 `newMessages` / `messages`，把 `isOwner && !isSelf` 的行补成主人气泡（id `w-<seq>-<messageId>`，时间取工具返回时刻）。
- **去重**：同一条消息可能既在 wait 结果里、又出现在下一轮 prompt 的 `user/message` 里；15 分钟内同文只保留一条。
- 验证：该条现在出现在合并时间线（id `w-80-1848323638`，11-10 22:56:13）；合并记录 794 → 1129 条；17 个测试文件 176/176。

## 1.13.4 — 聊天记录按 QQ 全部会话合并显示（2026-11-10）

- **「记录不全」的根因**：QQ 每轮轮转/策略变化都会新建一个 DSH 会话，聊天记录被拆在 11 份日志里。面板「对话」只读当前绑定的那一份（从 11-09 开始），更早的 10-27 起记录看不到。
- **合并时间线**：`GET /api/dsmp/history?scope=qq` 按 `settings.session.liveCwd` 找出全部 QQ 会话日志，解析后按时间合并、按角色+时间+文本去重，返回 `total / hasMore / sessions`；图片仍按时间就近补 `sha1`。实测合并 11 个会话共 794 条（2026-10-27 → 11-10）。
- **对话页**：当前 QQ 会话改用 `scope=qq` 拉最近 120 条，向上滚到顶自动加载更早一页（`before` 游标），顶部提示「↑ 向上滚动加载更早的记录」。
- **历史记录页**：会话下拉顶部新增「QQ 全部会话（合并）」并设为默认；状态行显示「共 N 条 · 合并 M 个会话」，翻页同样按时间游标。
- 生效方式：服务端随插件重载已生效；页面要刷新一次（Ctrl+R）用新的客户端渲染。

## 1.13.3 — 启动自检的假红项与「重新检查」（2026-11-10）

- **「生产模式（无 dev-reload.flag）」不再算失败**：它本来是模式信息，旧代码却用 `ok = !devMode`，开发标记存在时标红；标记删掉后结果还是启动时那份缓存，于是一直显示「1 项待处理」。现在两种模式都算通过，文案分别为「生产模式（无 dev-reload.flag（正常））」与「开发热重载（存在 dev-reload.flag）」。
- **「重新检查」真的重跑**：新增 `GET/POST /api/dsmp/selfcheck`，调用 `runSelfCheck()` 并回最新六项；面板按钮从「刷新 status」改为先 POST 再刷新。`status.selfCheck` 仍然只回缓存（启动时算一次），避免每次轮询都探测 bridge。
- 测试：`robustness.test.mjs` 的失败清单断言同步（`dev-reload` 不再出现）。

## 1.13.2 — 面板聊天只显示真实对话（2026-11-10）

面板的「对话 / 历史记录」按 QQ 聊天记录的样子显示：只留双方真正发出去的话，不再夹带会话窗口里的注入内容。

- **空快照不再漏 JSON**：唤醒提示的 `【本次消息快照】` 里 `messages:[]` 是常态（本次没有新消息），旧代码 `parsed.messages || …` 把空数组当有效值，于是整段 JSON 变成一条主人气泡。现在 `messages` 为空时取 `recent` 里主人最后一句；两者都没有（空唤醒）就整条丢弃。
- **流程提醒不进面板**：桥接塞进 user 回合的「你还没有完成回合收尾 / 沉睡前强制等待 / 首回复节奏 / 行动前」等提示按 host 处理，不再生成气泡。
- **气泡去掉调试信息**：不再显示「用到：qq_send_message」和模型名；历史记录的每条消息只留时间，去掉 `kind` 标签与 `#轮次`。
- 生效方式：服务端解析改动已随插件重载生效；气泡样式是客户端代码，刷新面板页面（Ctrl+R）后生效。

## 1.13.1 — 面板图片显示修复（2026-11-10）

- **图片一直是「加载中…」或裂图**：`lib/client.js` 的 `MediaThumb` 把 `src` 放进了 `useEffect` 依赖。`setSrc(blobUrl)` 触发 re-render 后，React 先执行上一轮 effect 的 cleanup，把刚创建的 blob URL `revokeObjectURL` 掉，`<img>` 随即指向已撤销的地址。改为只依赖 `attachmentId`，cleanup 只在卸载时撤销；另加 `onError` 兜底「图片已失效」。
- **服务端补 sha1**：DSH 会话日志里的入站图只带 `attachmentId`（宿主附件引用），原来面板只能逐个 POST 取 blob。现在 `/api/dsmp/history` 用轮次账本的 `mediaRefs` 与媒体库索引按时间就近配对，把 `sha1` 一并回给前端，面板直接 `<img src="/api/dsmp/media/file?…">`，不再依赖 blob。
- 这种图只出现在 QQ 入站图；面板自己上传的图走 `sha1` 直链，本来正常。
- 生效方式：服务端改动已随插件重载生效；旧页面里的历史气泡下一次加载/轮询就会带上 `sha1`。若仍看到裂图，刷新一次面板页面（Esc 后再打开，或 Ctrl+R）。

## 1.13.0 — 记忆去重与过期降权（2026-11-10）

同一件事写几次不再叠版本；过期/作废的事实默认不再挤占检索前几名。

- **近同义判重**（新增 `vendor/memory/src/value-dedupe.mjs`）：归一化全等、长串包含短串（≥8 字）、共享 ≥2 个型号/编号（A7R3 + 2470GM）、字符二元组 Dice ≥ 0.85 视为同一条。不做「共享中文二元组」合并——那会把「电子学基础 周二」和「周五」判成一条，也会并掉「不喜欢被叫<PERSONA_NICK>」与「README 不许出现<PERSONA_NICK>」。
- **她自己写**：同 topic+slot 命中近同义事实时，self→self 走 `ev:'revise'`（合并成更完整的那句），self→extract 返回 `action:'duplicate'` 不再叠加。
- **抽取补写**：多值槽位按值哈希分条会绕过 `prev` 检查，现在补一层同槽位近同义检查，命中记 `skippedDup`。
- **过期降权**：检索默认跳过 `expired` 事实（旧课表、作废的安排不再占名额）；只有问「以前/过去/作废/取消/过期」等或显式要历史版本才放回。结果层再按同 topic+slot 近似去重。
- **卡面**：`nearDup`/`dedupeEntries` 改用同一套判重，同槽位近似条目只留一条。
- **存量清理**：一次性脚本按 topic+slot 归并同类项、保留 self/高 I/较新的一条，其余 `invalidate`（可回滚）。本次清理 5 对（GT3RS、408 纠正、基础物理实验 II、器材两条），备份在 `<BACKUP_ROOT>\dsmp-memory\backup\longterm.jsonl.bak-dedupe-2026-11-10T14-32-18-227Z`。
- **热重载**：`lib/tools.js`、`lib/workbench/state.js`、`lib/memory-engine.js` 的 vendor 导入按 mtime 破缓存，bundle 开关后能拿到新引擎模块。
- **测试**：新增 `test/dedupe.test.mjs` 5 条；全套 176/176。
- **回滚**：还原 `vendor/memory/src/{value-dedupe,self-write,extract-episode,scoring-runner,card-hygiene}.mjs` 与三个 lib 文件；数据侧还原上面的备份。

## 1.12.0 — 摘要可展开（2026-11-10）

把「摘要里的锚点」从看得见变成点得开：事实行、情境段、面板三条路都能回到原文。

- **window 接受会话前缀**：`dsmp_memory_window` 的 `sessionId` 可以只给 recall 行里的 8 位，工具扫 `window/*/` 匹配（多个命中取最近并在标题注明）；完整 `session-…` 仍优先。
- **情境段带短号**：注入里的情境段行尾追加 `（#ep-xxxxxxxx-nn）`（8 位会话 + 起始轮）；`dsmp_memory_window` 新增 `episodeId`，按段的 `sessionId/turnFrom/turnTo` 自动展开，短号/带 `#`/完整 id 都认。
- **面板跳转**：「情境索引」每段新增「展开原文」，跳到「窗口回放」并只显示该段轮次（`view=window&sessionId=&from=&to=`），顶部显示「正在看情境段：第 a–b 轮」与「看最近」。
- **工作台接口**：`windowView(dir, sessionId, limit, {from,to})` 增加轮次过滤，返回 `matched`。
- **测试**：新增 `test/expand.test.mjs` 3 条（前缀展开、episodeId 展开、注入行带短号）；全套 171/171。
- **回滚**：还原 `lib/tools.js`、`lib/client.js`、`lib/workbench/state.js`、`vendor/memory/src/retrieval.mjs` 与 `lib/index.js` 的 window 分支。

## 1.11.1 — 面板补齐 1.11.0 能力（2026-11-10）

不动记忆引擎与工作台星图，只把面板漏掉的新能力接上，并修几个显示 bug。

- **月摘要视图**：记忆速览新增「月摘要」，显示 `rolling.md` 正文、字数、条数与更新时间；`GET /api/dsmp/workbench?view=monthly`。空时提示「日终维护会自动生成」。
- **待裁决角标**：`status.disputes.pending` 驱动的两级角标——主标签「记忆速览 (N)」与子页签「待裁决 (N)」；裁决成功后自动刷新 status，角标立即回落。
- **裁决后刷新**：`write()` 在 `action:'dispute'` 成功后调用 `onRefresh`（`MemoryTab` 之前没接 status，角标与刷新都不生效）。
- **设置页**：记忆速览说明改 10 个视图；新增「待裁决 N 条」「月摘要 X 字 · N 条 · 更新时间」「自写配额 20 条/天 · 总 600」「语音转写 provider · phase」四行。
- **修**：`renderWindow` 在 `sessionId` 为空时显示 `undefined`，改为 `—`；README 的「八视图」同步为十视图。
- **验证**：15 个测试文件逐个跑 **168/168**；bundle off/on 后 `status` 返回 `disputes.pending=0`、`monthly{chars:630,facts:67,month:"2026-11"}`；`view=monthly` 200 / 630 字。回滚：还原 `lib/client.js`、`lib/index.js`。

---

## 1.11.0 — 记忆自主化（她为主）与轮转月摘要（2026-11-10）

抽取向「<PERSONA>先记、模型只补、冲突人工」改；轮转注入增加第四层月摘要。

### 抽取：self 优先，冲突进人工队列

- **她为主**：`dsmp_memory_write` 的配额从 5 条/天放宽到 20 条/天、总 300→600；人设规则新增「值得记当场写、拿不准写 note、改口用 edit」三条，`lib/tools.js` 写库时真正带上 `selfWrite` 配置（此前不传 cfg，落的是默认 5/300）。
- **模型只补充**：`writeEntries` 里遇到「她写过同主题+槽位、抽取器给出不同值」时，不写事实、不悄悄丢，记一条 `state/disputes.jsonl`（pending），抽取结果计数进 `out.conflicts`。
- **人工裁决**：新增 `vendor/memory/src/disputes.mjs`（事件式 conflict/resolve，同事实同值只记一次，pending 上限 50）；四个动作 `keep_self / use_extract / merge / dismiss`，采用或合并走 `supersede` 并标 `author:'correction'`。
- **面板**：记忆速览新增「待裁决」视图，列出「她：…／补充：…／引文」，三个按钮直接裁决；`GET /api/dsmp/workbench?view=disputes`、`POST /api/dsmp/workbench/write {action:'dispute'}`（写令牌 + etag）。

### 轮转：四层注入

- **月摘要**：新增 `vendor/memory/src/monthly.mjs`，从长期库挑「硬事实 + 近 30 天的计划/进度/任务/事件/立场」，排除寒暄、情绪、过期与开发元讨论，按型号串与单值槽去重，渲染 ≤700 字（`【近 30 天摘要】`），写 `state/monthly/rolling.md`、`YYYY-MM.md` 与 `index.json`；`monthlyForInjection` 7 天内复用缓存，过期自动重建。
- **注入顺序**：`【最近一天原话】→【七天摘要】→【月摘要】`，总长 `handoverMaxChars` 3500→5200；月摘要最后拼接、超预算先被截断。
- **日终**：事实卡投影后构建月摘要并记日志；同时把 pending 冲突数写进日终返回与日志（`记忆冲突：N 条待裁决`）。
- **配置**：`memory.monthly{enabled,maxChars:700,days:30}`、`memory.conflicts{maxPending:50}`、`memory.selfWrite{maxPerDay:20,maxTotal:600}`、`handoverMaxChars:5200`；bridge `config.json` 与 DSMP `settings.json` 均已写入。

### 验证

- 插件单测 167/167（新增 `disputes` 7 条、`monthly` 4 条）。
- 真实数据冒烟：月摘要 630 字 / 67 条（含生日、考研、摄影器材、关系约定；无重复器材、无「记忆/插件」开发笔记），`pending disputes = 0`。
- 在线：`GET /api/dsmp/workbench?view=disputes` 200；bundle off/on 后新视图与模块生效；bridge 重启后加载新引擎。
- 回滚：`_retired\_memauto-20261110-131709`（86 文件：vendor/memory/src + lib + 两份配置 + rules.md）。

---

## 1.10.0 — QQ 语音转写（2026-11-10）

主人在 QQ 发的语音，会先用 DSH 自带的 SenseVoice 转成文字再进模型；模型不再只看到 `[语音]`。

- **复用宿主能力**：`@deepseek-ai/dsh-experimental-voice-input-bundle` 提供的 `speechToText`（`ctx.get('speechToText')`，不 import、不新增 inject）；provider `sensevoice-local`，int8 模型 239 MB，首次唤醒较慢，之后 `standby` 常驻。
- **链路**：bridge `get_record(out_format:'wav')` 让 SnowLuma 解 SILK → 本机 ffmpeg 归一化并削掉 LIST 块（provider 只认 44 字节标准头）→ `POST /api/dsmp/voice/transcribe` → `speechToText.transcribe()` → 本轮文本变成 `[语音转写] 文字`。
- **DSMP**：新增 `lib/voice-stt.js`（严格校验 16k/单声道/PCM16、4 MB/110 s 上限、sha1 缓存、prepare 轮询、20 s 超时）；配置 `media.voice.stt{enabled,provider,language,timeoutMs,maxSeconds,maxBytes,prepareTimeoutMs}`；`status.stt` 暴露 provider/phase；路由进 `WRITE_PATHS` 与 `INTERNAL_PATHS`（桥接凭 `x-dsmp-internal` 免令牌）。
- **bridge**：`segmentsToText` 支持 `recordTexts`；`handleIncoming` 把语音转写提前到拼 `textContent` 之前；`forwardInboundVoice`/`forwardOutboundVoice` 补 `x-dsmp-internal: bridge`（缺这个头时 DSMP 1.8 的写令牌会 403，这也是入站语音一直没落库的原因之一）。
- **边界**：转写只进语音库与本轮 prompt，**不进事实卡/记忆抽取**；超时或失败回退 `[语音]`，绝不影响回复文字。
- **验证**：插件单测 157/157（新增 19 条 `voice-stt`）；在线用 5.84 s 中文语音打 `/api/dsmp/voice/transcribe` 返回 200、2.2 s 出字并落库；不带 `x-dsmp-internal` 时 403。
- **回滚**：`_retired\_voice-stt-20261110-1235`（lib 31 个 + bridge.js + config.json + package.json）；DSMP 侧删 `lib/voice-stt.js` 与路由，bridge 侧还原三处调用即可。

## 1.9.3 — 「在学：上的事」误抽修复（2026-11-09）

`vendor/memory/src/facts.mjs` 的技能规则把「聊了太多学习上的事」里的「学习」当动词，抽出技能值「上的事」，写进<PERSONA>的长期事实（`h-20261109-01496f`，tier:hard、I:0.88）。

- **规则**：skill 正则改为 `/(在学(?!校|院|期|生|的|习)|正在学|开始学|学会|学习(?!上|中|过|的|了|时|氛|压|成|计|方|效|状|阶))/`；新增 `valueGuard` 挡住「上的/中的/过的/的/了/着/是/和/跟/与」开头的值；抽取循环统一执行 `p.valueGuard(value)`。
- **数据**：`h-20261109-01496f` 追加 `invalidate`（原因「规则误抽：学习上的事 被拆成技能「上的事」」），不删行。
- **验证**：原句与「我在学习上还算自觉」→ 0 条；「我在学吉他」「我在学习量子力学」→ 正常 skill；`optimize-1102.test.mjs` 加回归后 7/7；插件单测 138/138、验收 19/19、沙箱 25/25；卡片 1499 字不再含「在学：上的事」。
- **备份/回滚**：`<DSMP_MEMORY_DIR>\backup\zaixue-20261109-1935\longterm.jsonl`；代码回滚=还原 `vendor/memory/src/facts.mjs` 与测试文件。

## 1.9.2 — 面板体检与命名统一（2026-11-09）

只修面板真实 bug 与命名，不改记忆算法、不删旧工作台。

- **命名统一**：插件面板叫「记忆面板」，面板内记忆页签叫「记忆速览」（8 个视图），7351 叫「记忆工作台」（去掉「旧」字）。侧栏固定「记忆面板」，角色名只出现在 header chip、聊天气泡与会话标题，不再把「<PERSONA>」写进产品名。服务端 `panelLabel` 默认前缀改为空（`ui.panelLabelPrefix` 默认 `''`），`status.panel.label` 直接是角色名；`roles.fallbackName` 默认空，兜底显示「助手」。
- **语音发送真 bug**：`queueVoice` 的 `useCallback` 依赖为空，闭包锁死挂载时的空 `channelKey`，点「发这条」会带空 key；依赖改为 `[channelKey]`。
- **测试期文案残留**：聊天空态、输入框 placeholder、新建会话标题、上传语音提示、错误文案里的「测试期 / session-dsmp-test-*」全部按当前模式改写；空会话不再提示「先新建一个测试会话」。
- **设置页三行重复**：合并为「记忆」一行（打开速览 / 启动记忆工作台）+ 记忆速览说明 + 记忆目录 + 长期事实；删除「旧记忆工作台」「工作台已内嵌 6 个视图」两行。
- **写死的状态行**：QQ 白名单改读 `status.qq.allowPrivate / allowGroups`（`私聊 N 人 · 群 N 个` 或「未配置」）；发送方式按 `status.mode === 'qq' && qq.ok` 判断，不再因为 `test.allowLiveSend=false` 误报「测试期只入队」。
- **记忆工作台按钮**：启动成功后回调刷新 status（按钮立刻变「打开记忆工作台」，不必手动刷新）；文案与兜底提示同步改。
- **其他**：人设卡默认选中不再写死「<PERSONA>」；历史页无会话时显示「没有会话记录」而不是永远「读取中…」；服务按钮成功后按真实结果提示「已启动/已关闭」；`FALLBACK_VERSION` 从 `1.0.0` 改为 `0.0.0`（不再与 package.json 脱节）；README 修正「验证版本 1.0.0 / test.enabled 恒 true / 打包不带 workbench」三处过时描述。
- **验证**：`node --check` 五个改动文件通过；12 个测试文件逐个跑 **138/138**；bundle off/on 后 `/api/dsmp/services` 已显示「记忆工作台」、`/api/dsmp/status` 的 `panel.label` 为「<PERSONA>」。
- **回滚**：`_retired\_a3-20261109-1919`（lib 全量 + workbench/public + package.json + README，36 文件）；本轮另改 `CHANGELOG.md`、`test/dsmp.test.mjs`。

## 1.9.1 — 课表结构化与记忆去重（2026-11-09）

修三个真实数据问题：课表被长文上限拆成两条后按星期搜不到、过期课程没过期、生日/称呼多版本重复占排序。

- **课表结构化**：`dev/repair-courses-20261109.mjs` 把「周一–周五」整表拆成 17 条 `slot:'course'` 事实（`course:{name,day,start,end,parity,weekFrom,weekTo,location,semester}`，主题 `t-schedule`，作者 `correction`），旧整表与 5 条碎片全部 `invalidate`；另清掉 8 条「拆成两条记录」类技术噪声。
- **过期**：`h-ep-c560942d`（11-05 英语课）补 `validUntil`，卡面降级为「旧事」。
- **去重**：生日收敛为 2 条规范事实（主人 <OWNER_BIRTHDAY>、<PERSONA> <BOT_BIRTHDAY>），称呼收敛为 1 条规范式 + 1 条「主人可叫主人/<OWNER_NICK>」；旧 4 条生日、6 条称呼 `invalidate`。
- **检索**：`route.mjs` 识别「周X/星期X/礼拜X」并算出日期与星期；`schedule.mjs` 的 `dayHintOf` 同步；`scoring-runner.mjs` 的 `dayHit` 4000→8000、`scheduleHit` 1500→6000；`card-tree.mjs` 的 `SLOT_CAPS.course=5`，课程按 `day/start` 排序后截断。
- **验证**：`周五的课` 前三全是周五课程（rank 12710）、`英语课什么时候` 首条命中「英文小说欣赏（英语课）」（10830）、`明天有课吗` 返回周二课程、生日/称呼首条均为规范事实；卡片 1499 字含 5 门课；单测 138/138、验收 19/19、沙箱 25/25。
- **数据备份**：`<DSMP_MEMORY_DIR>\backup\repair-courses-202611090546\`、`backup\wingap-202611091352\`（回滚=还原 longterm.jsonl/topics.jsonl/memory.json）。代码回滚=还原 `vendor/memory/src` 四个文件。

## 1.9.0 — 发布准备（2026-11-08）

本版只做发布准备，不改功能行为。

- **元数据**：`package.json` 升到 `1.9.0`，补 `license: MIT`、`author: Ido1um`、`repository`、`keywords`，并新增 `files` 白名单（`lib/`、`vendor/memory/`、`workbench/` 源码、`scripts/`、`test/`、`cordis.patch.yml`、`README.md`、`README.en.md`、`CHANGELOG.md`、`LICENSE`）。`engines.dsh` 仍为 `>=0.2.1-rc.2`。
- **许可证**：新增根目录 `LICENSE`（MIT，2026 Ido1um）。
- **打包**：`scripts/pack.mjs` 的入包清单加入 `workbench/`、`README.en.md`、`LICENSE`；`workbench/config.json`（含本机数据目录与策略键）与 `workbench/.workbench-token`（活令牌）明确排除，绝不入包。
- **文档**：README 新增英文摘要（是什么 / 装什么 / 三条命令 / 边界）与「5 分钟上手」；「已知限制」整节重写为当前真实边界（群聊历史 100 条、M6 双引擎并存、不做 STT、导出只含绑定会话、软单机锁等）。新增 `README.en.md`（英文全量说明）与 `docs/市场提交材料.md`（市场用简介、bundle 名建议、截图清单、变更说明、隐私声明）。
- **兼容性**：本机宿主实测 `dsh --version` = `0.2.1-rc.5`，`engines.dsh >=0.2.1-rc.2` 满足；`0.2.1-rc.2` 本轮**未实测**（本机已是 rc.5，见发布记录）。`dsh plugin --profile desktop add <目录>` 的权威扫描因本机 pnpm store 不一致（`ERR_PNPM_UNEXPECTED_STORE`）未能执行，不是 DSMP 的不兼容项。
- **打包产物**：`dist/deepseek-memory-partner-1.9.0.tgz`。
- 测试：全套 **138/138**；验收 **18 通过 / 1 失败（窗口反向对账，数据态，非代码）**；沙箱 **25/25**。
- 回滚：还原 `_retired\_c-<stamp>\before\` 的 `package.json`、`README.md`、`CHANGELOG.md`、`scripts/pack.mjs`，删除新增的 `LICENSE`、`README.en.md`、`docs/市场提交材料.md`，再用 1.8.1 tgz 重装。

## 1.8.1 — 情境索引显示修复（2026-11-08）

- **问题**：面板「情景索引」每一条都显示「（未摘要）」。根因是 `lib/workbench/state.js` 的 `episodesView()` 只读 `row.summary` 与 `row.at`，而真实情境段（vendor/memory 的 `episode.mjs` 产出）把叙事存在 `title` / `scene` / `topics`，时间在 `atFrom` / `atTo`，摘要完成的标志是 `summarized`——三者都没被投影出来。
- **修复**：`episodesView()` 现在同时兼容两种行：
  - 新行：`title`、`scene`、`topics`，`summary = title：scene`（没有则退回 `row.summary`），`at = atTo || atFrom || at || createdAt`，`summarized = row.summarized !== false && !!summary`；
  - 旧行/可移植行：保留 `row.summary` 单字段。
- 面板 `renderEpisodes` 改为「标题 + 日期·轮次·是否摘要 + 场景 + 主题」，只有真的没有叙事时才显示「（未摘要）」。
- `lib/load.js` 两处修正：DSH_HOME 统一走 `paths.js` 的 `dshHome()`（此前回落到用户目录下的 `.dsh`，导致 dev-reload.flag 放对地方也读不到）；生产分支给模块 URL 加 `?v=<mtime>`，bundle 开关重跑 `apply()` 时能真正拿到新模块，不必整机重启（data:URL 的 dev 分支不变）。
- 测试：新增 `test/episodes.test.mjs` 3 条（title/scene 不再显示未摘要、旧 summary 兼容与空段仍标未摘要、day 过滤与新→旧排序）。全套 **138/138**；验收 **19/19**；沙箱 **25/25**。
- 打包：`dist/deepseek-memory-partner-1.8.1.tgz`。
- 注意：本次改的是宿主侧模块，正在运行的 DSH 需重启（或等下一次 bundle 重载由新的 `load.js` 生效）后，面板再刷新才会显示修复结果。
- 回滚：还原 `_retired\_epfix-20261108-2230` 的 `lib/workbench/state.js`、`lib/client.js`、`lib/load.js`、`package.json`。

## 1.8.0 — D 健壮性（写令牌 / 诊断 / 乐观锁 / 启动自检，2026-11-08）

- **D1 写接口令牌**：新增 `lib/robustness.js` 的 `ensureWriteToken()`，插件启动时在 `<DSH_HOME>\dsmp\api-token` 生成 32 位 hex（已存在且格式正确则不重写）。所有写路由经 `guardWrite()`：`GET/HEAD/OPTIONS` 放行；带 `x-dsmp-token` 放行；浏览器同源（`sec-fetch-site: same-origin`）放行；bridge 内部路径用 `x-dsmp-internal: bridge` 放行；其余 `403 DSMP_WRITE_FORBIDDEN`。面板不需要保存令牌——`/api/dsmp/status` 仅在同源请求时回 `writeToken`。这是 CSRF/误调用防护，不防同一用户下的本机进程。
- **D2 诊断页**：新增 `GET /api/dsmp/diagnostics`，聚合 3100/7351/7860/9880 端口状态（open/refused/timeout/blocked）、租约 owner/live/age、残留 `panel-lock`、`.exporting`/`.importing`/未完成迁移、`service-*.log`·`dsmp-*.log`·bridge 日志尾部 20 行、以及 6 项启动自检。面板设置页新增「诊断与自检」折叠卡。
- **D3 乐观锁**：`/api/dsmp/workbench?view=facts|claims|activation|history` 响应附 `etag`（`state/longterm.jsonl`、`claims.jsonl`、`topics.jsonl`、`activation.json` 的 mtime+size 取 sha1 前 16 位）。`POST /api/dsmp/workbench/write` 接受 `ifMatch`，不一致回 `409 DSMP_STALE` + 当前 `etag`；面板收到 409 提示「数据已更新，已刷新」并自动重载。覆盖 claims / fact-edit / fact / activation 四类写。
- **D4 启动自检**：`apply()` 结束 1.2s 后跑一次 `runSelfCheck()`（记忆目录存在且可写、租约是否本机、bridge 在线（不阻塞启动）、残留 panel-lock 超过 5 分钟且 pid 已死则清理、`dev-reload.flag` 生产应为 false、写令牌就绪），结果进 `status.selfCheck[]`；面板顶部有失败项时显示黄条 + 「重新检查」，设置页诊断卡可看逐项 detail。
- `lib/index.js`：新增 `webRegister(route)` 统一包装 48 处 `ctx.webServer.register`，33 条写路由 + 6 条 bridge 内部路径走 `guardWrite`；`buildStatus` 增 `selfCheck` / `security`。
- 测试：新增 `test/robustness.test.mjs` 10 条（令牌生成/幂等/坏文件重建、guard 五种放行与拒绝、etag 变化、端口探针、pid、锁清理、临时标记、日志尾部、自检六项、诊断聚合）。全套 **135/135**；验收 **19/19**；沙箱 **25/25**。
- 在线自检（DSH 53466，`dev/verify-d.mjs`）：**15 通过 / 0 失败**——status 1.8.0、selfCheck 六项全绿、同源回 writeToken、诊断四端口与 6 个日志、跨站写 403、同源写 200、带令牌写 200、facts 带 etag、过期 ifMatch 409 `DSMP_STALE`。
- 打包：`dist/deepseek-memory-partner-1.8.0.tgz` **约 385 KB / 89 文件**，解包复扫本机路径与 QQ 号零命中。
- 回滚：还原 `_retired\_d-20261108-2144` 的 `lib/index.js`、`lib/client.js`、`package.json`，删除 `lib/robustness.js`、`test/robustness.test.mjs`、`dev/verify-d.mjs`；令牌文件 `api-token` 留着无害。

## 1.7.0 — B3 她说过的语音（2026-11-08）

- 语音库分向：`state/voice.jsonl` 每行新增 `direction`（`in`/`out`）、`speaker`（`owner`/`shenming`）、`text`、`textSource`（`tts-input`/`stt`/`library-meta`/`manual`）。旧行没有这些字段，按 `direction:'in'`、`speaker:'owner'` 兼容。
- 新增 `POST /api/dsmp/voice/sent`：她发出去的语音入库。TTS 的原文直接随发送参数带过来（`textSource:'tts-input'`），**不需要语音识别**；语音库文件没有原文时留空，面板显示「（没有原文）」，以后可补。
- `lib/media-store.js`：`save()` 接 `direction/speaker/text/textSource`；已有 sha1 只补缺失的文本，后到的空文本不会冲掉已有原文，`manual` 可以人工覆盖，`direction`/`speaker` 不翻转。
- `lib/voice-inbound.js`：抽出 `decodeVoice()` 统一两个方向的 base64 校验；`saveOutboundVoice()` 落 `direction:'out'`、`speaker:'shenming'`、`alt:'<PERSONA>发出'`，原文压空白、截 2000 字。
- `bridge/src/bridge.js`：新增 `forwardOutboundVoice()`。`/api/socialV2/tts` 成功后带 `text` + `textSource:'tts-input'` 回报；`/api/socialV2/send-voice` 成功后只报音频（没有原文）。失败只记日志，不影响发送。
- 面板 `VoiceCard` 分两组：「她说过的」（带原文/「（识别）」/「（没有原文）」与「发这条」）和「主人发来的」（只听）。`qq-outbound` 的来源标签是「QQ · 她说」。
- 测试：`test/voice-inbound.test.mjs` 增 4 条（TTS 原文、无原文留空、后补原文不覆盖人工修订、同段先 in 后 out 不翻转）。全套 125/125；验收 19/19；沙箱 25/25。
- 在线自检（DSH 53466，`dev/verify-b3.mjs`）：`POST /voice/sent` 200 → sha1 `065810d3…`、4044 B、`direction:'out'`、`textSource:'tts-input'`；列表返回 out/shenming/原文；不带原文重报 `dup:true` 且原文未被冲掉；`media/file` 逐字节一致。
- 踩坑：`voice-inbound.js` 不能在模块顶层 `import './media-store.js'`——开发期 data:URL 热重载会 `ERR_UNSUPPORTED_RESOLVE_REQUEST` 让整个插件激活失败（表现为 `/api/dsmp/*` 全 404）。现在音频嗅探内置在该模块里，落库时 media-store 再判一次。
- 回滚：还原 `_retired\_b3-20261108-2107` 的 6 个文件；已写入的 `direction`/`text` 字段向后兼容，可保留。

## 1.6.0 — B2 面板备份 / 恢复（2026-11-08）

- 新增 `lib/backup.js`：面板侧备份。`createBackup()` 复用 `archive.buildExport` 生成记忆包，先 `verifyArchive` 自检（不过就 `DSMP_BACKUP_VERIFY`、不落盘），再原子写入 `<root>/<YYYYMMDD-HHmmss>-<名字>.zip` + 同名 `.json` sidecar（文件数/字节/manifest 摘要/来源机器）；`pruneBackups()` 只删最新 `keep` 份之外的。
- `restoreBackup()`：先校验 manifest 与逐文件 sha256；非空目标必须 `overwrite`；恢复时把当前记忆目录整体改名 `*.before-restore-<stamp>`（永不删），解压只落 `memory/`、`roles/`、`workspace/agent/`，**跳过 `sessions/` 与 `dsmp/settings.json`**（这两个属 B1 换机，不属记忆回滚）；任一步失败回滚，不留半成品。
- 设置：`backup = { dir: '', keep: 10 }`；`dir` 为空落 `<DSH_HOME>/dsmp/backups`，`keep` 夹在 1–50。
- 路由：`GET /api/dsmp/backup`（根目录/保留数/列表）、`POST /api/dsmp/backup/now`（写者门）、`POST /api/dsmp/backup/restore`（写者门，`dryRun` 预检 / `overwrite` 确认）；`buildStatus` 增 `backup{root,keep,count}`。
- `lib/client.js`：设置页新增「备份与恢复」卡片——备份目录、已有份数、立即备份、最近 5 份列表（时间/大小）与逐份「恢复…」；恢复两段式：先预检（包内记忆/人设/工作区数与来源目录），再确认（提示会先改名备份）。
- `lib/inject.js`：新增 `clearPending()`，恢复成功后清掉 60s 注入组合缓存，下一轮立即用新卡。
- 测试：新增 `test/backup.test.mjs` 8 条（默认根目录、zip+sidecar、keep 清理、自检失败不落盘、源目录缺失、dryRun、非空目标需 overwrite 且安全副本、校验失败/文件缺失）。全套 121/121；验收 19/19；沙箱 25/25。
- 在线自检（DSH 53466）：面板 `POST /backup/now` 生成 `20261108-200155-memory.zip`（5,266,436 B / 547 文件）→ `POST /backup/restore {dryRun}` 预检 540 记忆 / 4 人设 → `dev/verify-b2.mjs` 在 `%TEMP%` 隔离恢复 **14/14**（安全副本、记忆/人设落位、不恢复 sessions 与 settings、二次恢复被拒）。
- 回滚：删三条 backup 路由与 `lib/backup.js`；已生成备份在备份目录，恢复过的旧目录在 `*.before-restore-*`。

## 1.5.0 — B1 一键换机（2026-11-08）

- 新增 `lib/machine.js`：单机身份与心跳——`machine.json`（machineId/name/createdAt/dsmpVersion/boundSessionId/cwd）、`state/machine-heartbeat.json`（每 5 分钟）、`state/machine-history.jsonl`（adopt 记录）；`lockState()` 在目标目录 10 分钟内有别的 machineId 心跳时判「别机正在用」。
- 新增 `lib/machine-pack.js`：`dsmp-machine-pack` v1 换机包。导出=记忆目录（排除 backup/sessions/node_modules…）+ `machine.json` + 选定 DSH 会话日志 + `roles/*.md` + `dsmp/settings.json`，manifest 记旧 `cwd`、`sessionIds`、逐文件 sha256；导入=整包哈希校验 → 目标先备份 → 记忆整体 rename → 会话按 `escapeCwd(newCwd)` 落位并逐帧改写 `header.cwd` → `workspace.json` 改路径 → bridge `sessionCwd` → DSMP `memoryDir`/`liveCwd` → 新 `machine.json` + history；任一步失败回滚，不留半成品。
- `escapeCwd()` 复刻 DSH 的目录转义（冒号丢弃、斜杠转 `-`、非 ASCII 写 `~XXXX`），已用真实目录对拍。
- 新路由：`GET /api/dsmp/machine`、`POST /api/dsmp/machine/export`（写者门）、`POST /api/dsmp/machine/upload`（浏览器上传 zip 到 `<DSH_HOME>\dsmp\imports`）、`POST /api/dsmp/machine/import`（`dryRun` 预演 / `overwrite` 替换 / `force` 破锁）。
- `lib/client.js`：设置页新增「一键换机」卡片——本机身份/心跳、导出换机包、选包预检（旧/新工作区、文件数、目标是否已存在）、确认导入；导入目标目录与新机器名可就地填。
- 测试：新增 `test/machine-pack.test.mjs` 8 条（escapeCwd 对拍、导出内容与 manifest、并发导出锁、导入全链路、非空目标拒绝、篡改一字节校验、dryRun 不落盘、单机锁三态）。全套 113/113；验收 19/19；沙箱 25/25。
- 在线自检（DSH 53466）：生产记忆副本导出 `5,266,549 B / 550 文件`（manifest 含 `cwd=<DSMP_MEMORY_DIR>\agent`、1 个会话）→ dry-run 预检 `549 文件 / 542 记忆 / 4 人设` → `dev/verify-b1.mjs` 在 `%TEMP%` 隔离导入 **12/12**（记忆、人设、会话、header.cwd、workspace、settings、machine.json、会话数、无残留）。
- 回滚：删掉四条 machine 路由与两个 lib 文件；已导入的数据在目标目录，旧目录保留 `.before-import-*`。

## 1.4.0 — P1 听 QQ 语音（2026-11-08）

- 新增 `lib/voice-inbound.js`：`POST /api/dsmp/voice/inbound` 接收 bridge 转来的语音字节（base64），按内容寻址存进语音库（`voice/YYYY-MM/<sha1>.<ext>` + `state/voice.jsonl`），元数据带 `source:'qq'`、`msgId`、`key`、`alt`（来自谁）、`duration`。OGG/Opus、WAV、MP3、M4A 按魔数识别，超过 `media.maxVoiceBytes`（默认 16MB）或不是音频一律 400，不落盘。
- `lib/media-store.js`：`save()` 支持 `duration`，同 sha1 重复只补空字段，不重复写索引。
- `lib/client.js`：语音库卡片改为可播放列表——标题、条数、「刷新」按钮，最多 5 条 `<audio controls preload=none>` + 来源/大小/时长/时间；本地生成或上传的语音仍可「发这条」。
- `bridge.js`：① 入站 `record` 段解析成 `{kind:'voice'}`；② 入站时向 SnowLuma `get_record` 取音频地址（支持 `base64://`），用 `safeFetchBuffer` 限 16MB 取字节并校验魔数；③ 取到后 `POST` 给 DSMP 语音库（20s 超时，失败只记日志，绝不影响回复）；每条消息最多处理 2 条语音。
- 测试：新增 `test/voice-inbound.test.mjs` 6 条（WAV 落库与元数据、同字节去重、超限拒绝、非音频拒绝、坏 base64、MP3 识别）。全套 105/105；验收 19/19；沙箱 25/25。
- 在线自检：`dev/verify-voice.mjs --base <GUI>` 生成 0.25s WAV → POST → list（`source=qq`）→ 取回逐字节一致（sha1 `f5fad40e…`，4044 B）。
- 回滚：删掉 `POST /api/dsmp/voice/inbound` 路由与 `voice-inbound.js`，并把 `bridge.js` 的 `forwardInboundVoice` 调用去掉；已入库的语音文件可留可删（只影响语音库，不影响事实）。

## 1.3.0 — A2 记忆日终 + A1 注入 + A3 原生记忆工具（2026-11-08）

### A3：记忆工具原生化（`dsmp_memory_*`）

- 新增 `lib/tools.js`：用 `ctx.tools.register` 注册 7 个原生工具，替代 bridge 的 `qq_memory_*` MCP 子进程——
  `dsmp_memory_search`（历史原文，含归档）、`dsmp_memory_recall`（长期事实 + 问法路由 + 课表块 + 空结果诊断）、
  `dsmp_memory_window`（按轮展开当时的窗口 / 想法）、`dsmp_memory_write`（她自己写一条事实，含 dryRun）、
  `dsmp_memory_edit`（修订留痕）、`dsmp_memory_photo`（sha1 取原图，走 `ctx.attachments.saveImages`）、
  `dsmp_memory_todo`（列 / 完成 / 取消）。
- 写类工具（write / edit / todo done|cancel）前置单写者租约门：DSMP 不是 writer 时返回 `DSMP_NOT_WRITER`，绝不与 bridge 抢写。
- `store` 的目录来自 `cfg()`，所以 search 在调用前后临时改 `QQ_MEMORY_DIR` 再还原（`withDir()`），保证与面板/账本读同一份数据。
- `lib/index.js`：`inject` 增 `tools`（Cordis 只认数组形式，`{required, optional}` 会被当成两个服务名而一直 pending）；`apply()` 里注册并在 effect 销毁时反注册；`status.tools = {registered, names}`。
- 测试：新增 `test/tools.test.mjs` 9 条（7 个工具与 schema、无 tools 服务时跳过、写类租约门、photo 非法 sha1、缺 channel key、空目录 search/recall/todo、render 回退）。
- 在线验证（DSH 52817，QQ 共用会话 `session-724c03d0`）：`status.tools.registered=7`；面板发「用 dsmp_memory_recall 查一下主人的生日」→ 会话日志出现 `tool/call dsmp_memory_recall {"query":"主人的生日是哪天","limit":8}` → `tool/result` 45ms 返回含「主人 2007 年 9 月 5 日生」的事实行，回合正常结束。
- 回滚：删除 `lib/tools.js` 的注册 effect 或把 `inject` 的 `tools` 去掉即回到 MCP 工具（两者可并存，名字不冲突）。

### A1：注入搬到 `agent/pre-step`

- 新增 `lib/inject.js`：`preStep()` 在 `next()` 之后取 `decision.messages`，把一条固定 id（`dsmp-memory-<sessionId>`）、`source.kind='dsmp-inject'` 的上下文消息插在最后一条用户消息**前面**；每一步原地替换，不追加。用户消息保持主人原话。
- 只对绑定会话生效；QQ prompt（含 `【本次消息快照】` / `【面板消息】` / `【来自桌面面板`）直接跳过，避免双重注入。
- `lib/index.js` 的 `/api/dsmp/chat/send` 面板直连分支改为投递原始 `text`；发送时仍算一次 `composeChatPrompt` 用于账本 `windowText`，并把前缀缓存给 `notePanelTurn()`，pre-step 命中缓存就不重复读卡。
- 新增 `settings.inject.mode`（`pre-step` 默认 / `send` 回滚），`status.inject = {mode, pending}`。
- 测试：`test/inject.test.mjs` 9 条（原话保持、同轮原地替换、QQ 跳过、非绑定跳过、缓存命中不重建、回滚模式、非 enter 原样返回、空文本跳过、状态字段）。全套 **90/90**。

### A2：记忆日终搬进 DSMP

- 新增 `lib/memory-engine.js`：自建 `createMemoryEngine` + 60 秒巡检（首跑 15 秒），每次巡检先验 `memory.owner==='dsmp'` 与租约归属，不是本机写者就跳过（`skipped:"not-writer"`），不与 bridge 双跑。
- `lib/index.js`：`status.memory.engine` 暴露运行状态；新增 `GET|POST /api/dsmp/memory/engine`（`tick` / `daily` / `start` / `stop`）；`settings` 变更后按新目录重配引擎；插件启动即开启巡检。
- bridge `src/bridge.js` 的 `startMemoryMaintenance`：租约在 DSMP 手上时不启动自己的维护定时器，并每 5 分钟复查——DSMP 掉线/租约过期后自动接管。
- 验证：`acceptance-check` 19/0/0、`sandbox-check` 25/25；bridge 日志不再出现「7 天记忆已启用」，仍照常 `记忆单写者：owner=dsmp，租约=dsmp（有效）`。


## 1.2.1 — 旧记忆工作台回到插件内（2026-11-08）

- `workbench/` 整份复制进插件（`server.mjs` + `public/`，零依赖、仅 127.0.0.1），`server.mjs` 的引擎 import 由 `../src/` 改为 `../vendor/memory/src/`。
- `workbench/start.cmd` 改用 `%DSMP_NODE%`（面板注入当前 Node，双击时回落 `node`）；`stop.cmd` 用 `ping` 代替 `timeout`（重定向 stdin 时 `timeout` 会以退出码 1 失败，导致「停止」永远报错）。
- `lib/services.js`：新增 `workbench` 服务（7351，`root:'plugin'`）；`configureServices({pluginRoot})` 由 `index.js` 注入；`scriptPath()` 支持插件内脚本；`spawnEnv()` 注入 `DSMP_NODE`。
- `lib/client.js`：设置页「旧记忆工作台」改成 `WorkbenchButton`——未监听时「启动并打开」（先起服务再开新标签），已在跑时「打开旧工作台」。
- 修复：`activationOp` 写盘后调用 `v10.invalidateV10(dir)`，否则同一毫秒内的两次写入会命中 mtime 缓存、面板读到旧开关值（Windows 毫秒级时间戳碰撞）。

## 1.2.0 — M9 记忆写操作并入插件（2026-11-08）

旧 7351 工作台退役后，写操作全部搬进 DSMP 的「记忆」页签，不再需要另起服务：

- 新增 `lib/workbench-write.js`：`claimsOp`（确认 / 驳回候选）、`factEdit`（`reviseFact` 修订值/正文/有效期）、`factOp`（invalidate / reinstate / manual / reset / badhit / unmerge / feel）、`activationGet` / `activationOp`（7 个开关 + salienceFloor 夹取）、`factHistory`（修订链）。统一 `guardWrite`：目录缺失/迁移中/非本机写者三类拒绝；每次写前 `backup()`、写后 `logs/dsmp-workbench-audit.jsonl` 记审计。
- `lib/index.js` 新增 `POST /api/dsmp/workbench/write`（`action=claims|fact-edit|fact|activation`），GET 增 `view=activation`、`view=history&id=`；`view` 的数据源目录从测试副本改成 `memoryWriteDir()`。
- `lib/client.js`「记忆」页签加「待确认」「激活开关」两个子页；长期事实每条带「编辑 / 作废 / 恢复 / 历史」，编辑为就地输入（值 + 原因），历史展开显示最近 8 条事件。
- 作废状态可见：`factsView` 读 `state/facts-invalidated.json`，行上标「已作废」且按钮变成「恢复」；`factHistory` 把审计日志里的 invalidate/reinstate 也并进修订链（原先只读 longterm 事件，看不到作废记录）。
- 测试：新增 `test/workbench-write.test.mjs` 7 条（守卫三态、作废→恢复的 tombstone + 备份 + 审计、manual 非法入参、feel 截断、激活开关持久化与备份、revise + 历史、claims 驳回）。
- 修复：`backup()` 对根级 `activation.json` 推断错（曾写到记忆目录之外），改为 `state` 上一级 vs 根目录。

> 注意：本版改的是 `lib/*.js`，宿主不会重新 import 依赖模块，**需要完整重启 DSH 才会生效**；`lib/client.js` 只需刷新页面。

## 1.1.0 — 旧目录退役（2026-11-08 15:40）

`<DSMP_WORKSPACE>` 与 `<DSMP_MEMORY_SRC>` 已改名进
`<DSMP_WORKSPACE>\_retired\`，观察 7 天后删除。退役前把 6 处引用逐一改到新家：

- profile `cordis.patch.yml` 的 `mcp-deepseek-memory` → `vendor\memory\src\mcp-server.mjs`；
- bridge `node_modules\@local\deepseek-memory` junction → `vendor\memory`（版本 3.1.3）；
- bridge `package.json` 的 `test:memory` → `vendor\memory\test\memory.test.mjs`；
- bridge `scripts\setup-dsh.mjs` / `apply-memory-junction.ps1` / `freeze-runtime.ps1` 的默认路径 → vendor；
- profile `dependencies` 移除已停用的 `@local/dsh-qq-history`（及其 node_modules junction）；
- 删除 `记忆工作台.lnk`（7351 旧工作台随记忆目录退役；面板「记忆」页签已内嵌六视图，旧 `.lnk` 备份在 `_retired\_refbackup-20261108-153322`）。

验证：`/api/dsmp/status` 仍是 `mode=qq`、`lease=dsmp`、`rolesMirror=3`；`memory/preview` 156 条事实 / 卡 1497 字；
`workbench` facts/usage、`history`、`roles`、`models` 全部 200；bridge 重启后日志仍是「记忆单写者：owner=dsmp，租约=dsmp（有效）」。
**注意**：`_retired\DeepSeek partner-*\plugins\dsmp` 是指向本插件目录的 junction，将来删除 `_retired` 前必须先用 `cmd /c rmdir` 拆掉它，不能直接递归删除。

## 1.1.0 — P2 收口（2026-11-08 15:30）

P2 只做「交付前收口」：修掉会丢轮的那条路径、同步 vendor、关掉测试期开关、把打包脱敏做干净。不新增功能。

- **bridge 收尾兜底（会丢轮）**：`DSMP_NO_DRAFT` 表示「这一轮的 begin 当时落在 bridge 本地」，原先只记日志不写账本 → 真丢一轮。
  现在 `finishWindowTurn` 在收到该错误码时回落本地 `memoryWindow.finishTurn`，并记「M6 转发 finish-turn 被拒（DSMP_NO_DRAFT），回落本地收尾」。
  `postDsmpMemory` 也补回 `code` 字段（原先只有 `error`，拿不到错误码）。
- **vendor/memory 同步 3.1.3**：从 `DeepSeek memory` 刷新（213 → 216 文件，src 50 个文件 SHA256 全一致），
  含 `tierAfter()` 的待办 TTL 修复与 `annotateRelativeTime`。
- **测试期开关关闭**：`settings.test.enabled = false`。媒体库、账本、注入全部走生产目录 `<DSMP_MEMORY_DIR>`；
  `status.test.note` 不再显示「测试期」提示。
- **默认值去个人化**：`settings.channel.key`、`settings.session.liveId/liveCwd` 默认留空，
  `/api/dsmp/chat/send` 与语音发送在未配置时返回 `DSMP_NO_CHANNEL_KEY` 而不是写死主人的 QQ 号；
  `status.channelKey` 供面板取用。本机实测值仍保存在 `<DSH_HOME>\dsmp\settings.json`，行为不变。
- **打包脱敏**：`scripts/pack.mjs` 的 `PATH_MAP` 增加插件根目录与 `<OWNER_QQ>` → `<OWNER_QQ>`；
  重新打包 `dist/deepseek-memory-partner-1.1.0.tgz`（333,118 B / 82 条目），全包不再出现本机绝对路径与主人 QQ。
- **文档收口**：M0–M7 验证记录、主方案、后续修改方案全部并入 `docs/`。

## 1.1.0 — P0 数据一致性（2026-11-07 22:45）

P0 处理「账本里的脏数据 + 长时间运行的恢复路径」，不新增功能。版本从 1.0.0 升到 1.1.0。

- **账本体检/隔离工具（新）**：`scripts/lint-window-ledger.mjs`，扫 `window/*/turns.jsonl`，识别
  `empty-row`（user/spoken/reply 全空、非 synthetic）、`dup-reply`（user 为空、reply 与上一轮相同且 ≤60s，bridge 替补收尾的产物）、
  `reply-only`（她的主动性发言，只报告不动）、`dup-turn`（只报告）。
  `--fix` 先整目录备份到 `<记忆目录>\backup\ledger-<stamp>\`，再给问题行打 `quarantined:true` + `quarantineReason`，
  **保留行号**（删行会让后续 turn 不连续，`acceptance-check` 的「窗口轮次连续」会失败）。
  实测：turn 94（`mode:reserved2`、`user:""`、reply 与 turn 93 相同、间隔 2s）被隔离；其余 15 条 reply-only 保留。
- **验收新增一条**：`窗口账本无空行/重复收尾`（跳过 synthetic 的轮转交接行）；`acceptance-check` 由 18 项变 **19 项**。
- **窗口缺口回填**：锁修复前那次连发让会话多了一条主人消息、账本没有对应轮；
  `node scripts\repair-window-gaps.mjs --days 2 --write` 回填 2 轮（「行，我来改一下」「现在应该修好了」）。
- **锁的存活判定**：`lib/panel-lock.js` 的 `tryAcquire` 遇到已有锁时读 `pid`，持锁进程已死（`process.kill(pid,0)` 失败）立即抢占，
  不必等 180s TTL；新增导出 `pidAlive(pid)`。DSH 被强杀后用户不会再被「会话忙」卡 3 分钟。
- **失联面板轮清理**：`lib/index.js` 加 60s 巡检，把「开轮超过 5 分钟、且此刻 `bridge.isBusy()` 为假」的 `panelTurns` 收掉，
  同时释放 `panel-lock`、清 `panelBusy`，日志记一条。agent 崩了不发 `turn/end` 时不再依赖 TTL。
- 门禁：单测 **66/66**、`acceptance-check` **19/19**、`sandbox-check` **25/25**。
- 备份：`<DSMP_MEMORY_DIR>\backup\ledger-2026-11-07T14-41-37-871Z`（首次清理前）、
  `...\ledger-2026-11-07T14-42-36-754Z`（改隔离前）。

### P1 运行质量（同一版本，2026-11-07 23:10）

- **会话日志缓存**：`lib/session-log.js` 新增 `LOG_CACHE`（按 `file + mtime + size`，保留 3 个会话）与 `ITEM_CACHE`、`itemsOfSession(file)`；
  `historyFromFile` 改走缓存。实测同一会话第二次读 `91ms → 0ms`（2190 帧 / 149 条气泡）。文件一变缓存自动失效（mtime/size 变了就重新解）。
- **聊天增量轮询**：`SessionBridge.snapshot(sessionId,{after})` 只返回 `idx > after` 的新消息，并回 `lastIdx`；消息 `push` 时递增 `msgIdx`。
  `GET /api/dsmp/chat/messages` 接 `?after=`；客户端 2.5s 轮询改「取增量 → 接在已有列表后面」（切会话时 `cursorRef` 归零、整屏替换）。
- **「当前对话」不再写死**：`lib/index.js` 新增 `currentLiveSessionId()`，`/api/dsmp/history` 缺 `sessionId` 时先向 bridge 取实时映射
  （bridge 换会话会自动跟随），查不到才回 `settings.session.boundId || liveId`。
- **live 会话发图置灰**：`lib/client.js` 的「发图」按钮在 `isLive` 时 `disabled` + title 说明；粘贴/拖入也由 `isLiveRef` 挡住并提示，
  不再等点完才收 400。
- 门禁：单测 **68/68**、`acceptance-check` **19/19**、`sandbox-check` **25/25**、`render-smoke` 通过。
- 注意：`lib/*.js` 改动**需完整重启 DSH** 才生效（`client.js` 只需刷新页面）。

## 1.0.0 — 全链路自检与五个真 bug 修复（2026-11-07 22:05）

自检方式：`node --check` 全部 lib、65 条单测、全部 GET/负例路由探针、真实会话连发实测、账本逐行核对。

- **连发丢一轮（已修）**：`isBusy` 要等 followup 之后才置位，两条并发请求都能通过检查；实测两条用户消息进了会话，账本只写 1 条（前一份 draft 被覆盖）。修法：`panelBusy` 内存 Set + `lib/panel-lock.js` 跨实例文件锁（`O_EXCL` 创建，180s TTL，回合结束/出错删除）。实测：第二条 409、锁文件在回合结束时消失。
- **bridge 替面板轮收尾（已修）**：`openTurns` 只记「开过」，不记「谁开的」；bridge 也对同一会话调 `finish-turn`，于是多出一条 `mode:'reserved2'`、`user:''` 的重复轮（账本 turn 94）。修法：`beginTurn` 记 `source`（`panel`/`bridge`），跨驱动者收尾一律 `DSMP_NO_DRAFT`。
- **历史分页游标失效（已修）**：`before` 找不到时会把最后一页原样返回，客户端「加载更多」无限重复。修法：返回空页 + `staleBefore:true`。
- **人设卡取不存在回显绝对路径（已修）**：`GET /api/dsmp/roles?name=…` 走 raw `ENOENT` 400。修法：404 `DSMP_ROLE_MISSING`，只回卡名，不回路径。
- **记忆写入信任入参目录（已修）**：`memory-writer.targetDir()` 曾优先 `payload.dir`（HTTP 入参），等于给了任意目录写权限。修法：只认宿主配置的 `writeDir`。
- 门禁：单测 **65/65**、`acceptance-check` **18/18**、`sandbox-check` **25/25**、`render-smoke` 通过。
- 备份：`<DSMP_WORKSPACE>\backup\dsmp-selfcheck-20261107-2204`（26 文件 / 422,100 B）。
- 已知数据残渣（未动）：账本 turn 94 是上面第 2 条留下的空 user 行；另外锁修复前那次连发让会话里多了一条用户消息、账本没有对应轮（属窗口缺口，日终 `repairGaps` 会按 raw 回填）。

## 1.0.0 — 面板直连（DSMP 依附 DSH，不再依附 bridge，2026-11-07）

- 目的：面板聊天只依赖 DSH；bridge 退回纯 QQ 传输层。掉了 bridge 面板照样能聊、照样记账。
- 实现：`session.via` 新增，默认 `"auto"` —— `/api/dsmp/chat/send` 命中当前对话时先走 DSH 直连（`agents.get` 复用活 agent，否则 `resume` 同一 session），只有显式 `via:"bridge"` 才继续走 bridge 转发（旧行为，保留离线兜底）。
- 记账：面板轮由 DSMP 自己 `begin-turn` / `finish-turn`（它是单写者），`mode:'panel'`、`userRaw` 只有主人原话，不再出现「不记账」。
- 防双写：bridge 也观察 `session/event`，对没有 `begin` 过的轮次调 `finish-turn` 会得到 `DSMP_NO_DRAFT` 并计入 `skipped`——避免多出一条空轮（此前实测出现过 `mode:'reserved2'`、`user:""` 的重复行）。
- 并发：agent 正在回复时返回 409 `DSMP_SESSION_BUSY`。
- 面板：`via:'local'` 时提示「面板直连（不依赖 QQ 桥接）」。
- 真实实测：停 bridge（15.0s）→ `mode:"local"` → 面板发送 **54ms** 返回 `via:'local'`、`ledger:'dsmp'` → 回复「面板直连成功」，账本 91→92 单条；启 bridge（31.8s）后在同一会话再发 → 仍 `via:'local'`、50ms、账本只 +1（92→93），bridge 的重复 finish 被拒（`skipped:1`）；第三次 75ms、账本 94→95、`turn.userRaw`=「依赖自检三：请只回「只记一条」」、回复「只记一条」。
- 门禁：`node --test` **60/60**、`acceptance-check` **18/18**、`sandbox-check` **25/25**。
- 备份：`<DSMP_WORKSPACE>\backup\dsmp-direct-20261107-2150`。
- 回滚：`settings.json` 设 `session.via="bridge"`（或用设置接口 PUT），面板即回到经 bridge 转发的旧路径。

## 1.0.0 — 记忆单写者切到 DSMP（P2，2026-11-07）

- 目的：把窗口账本（`window/*/turns.jsonl`）的写入者从 bridge 换成 DSMP，bridge 只转发，避免两个进程各写一半。
- 实现：`settings.memory.dir` 显式指向生产记忆目录（否则测试期会落到 `test/memory` 副本）；`lease` 与 `memory-writer` 的目录改走 `memoryWriteDir()`；bridge `config.json` 的 `memory.owner='dsmp'` 后，`beginWindowTurn / stripFeelForSend / finishWindowTurn` 改为 `POST /api/dsmp/memory/begin-turn|note-spoken|finish-turn`，失败只记日志、不回落本地写（宁可少记一轮也不双写）。
- 账本净化：面板消息经 bridge 转发时会被包一层「【来自桌面面板 · 不发 QQ】…【面板消息】」，写入前用 `ownerTextOf()` 截到 `【面板消息】` 之后，`turn.userRaw.text` 只留主人原话。
- 热更新：`index.js` 在每次 `apply()` 后把 `memory-writer` 标脏，首次写入口调用时重新 `loadModule` 并注入配置——改 `lib/memory-writer.js` 后只需 toggle bundle，不必重启 DSH。
- 真实实测：切 owner 后租约落 `<DSMP_MEMORY_DIR>\state\engine-lease.json`（owner=dsmp/live）；bridge 重启日志「记忆单写者：owner=dsmp，租约=dsmp（有效）」；面板发一句 → 账本 90→91、`writer {begun:1,finished:1,errors:0}`、`userRaw` = 「P2 第三次自检：回「账本只有原话」」、回复「账本只有原话」。
- 门禁：`node --test` **59/59**、`acceptance-check` **18/18**、`sandbox-check` **25/25**。
- 备份：`<DSMP_WORKSPACE>\backup\dsmp-p2-20261107-2057`（含 bridge config、dsmp settings、profile、生产 window/state 全量）。
- 回滚：bridge `memory.owner` 改回 `bridge`（或删键）+ DSMP `memory.owner='bridge'` + 重启 bridge。

## 1.0.0 — 面板离线兜底（P0，2026-11-07）

- 目的：QQ 桥接离线时，面板仍能和<PERSONA>说话，并且说的还是同一条 DSH 会话（不是新会话）。
- 实现：`/api/dsmp/chat/send` 命中当前对话（bridge 映射的会话）时仍先走 bridge 转发；若 bridge 不可达（`UNREACHABLE`/`TIMEOUT` 或端口不在监听）且 `settings.session.offlineFallback` 为真，则改用 `ctx.agents.resume` 接管同一 session 并 `followup`，响应带 `via:'local'` 与提示「本轮不记账」。bridge 若主动返回「面板直发未开启」（配置选择，不是故障）不会触发兜底。
- 并发保护：`SessionBridge.isBusy()` 检测到该会话正在回复时返回 409 `DSMP_SESSION_BUSY`，避免把第二个 turn 塞进正在跑的 agent。
- 隔离：兜底只读注入（规则 + 事实卡 + 快照），并且只在 `allowLive` 显式置位时绕过测试期守卫；生产记忆的写入仍归 bridge（P2 才切 `owner=dsmp`）。
- 面板提示：本地直连成功后输入框上方显示「QQ 桥接离线 · 本轮由 DSH 本地直连同一会话（不记账）」。
- 真实实测：停 bridge（16.8s）→ 面板发送 144ms 返回 `via:'local'` → 10 秒后会话日志新增 `panel/assistant` 两条、回复「本地直连已生效」；再启动 bridge（52.9s）→ `mode:'qq'`、`online:true`。
- 门禁：`node --test` **57/57**、`acceptance-check` **18/18**、`sandbox-check` **25/25**。

## 1.0.0 — 修设置页人设卡右侧溢出（2026-11-07）

- 现象：设置页「人设卡」卡片的下拉框与文本框右边缘超出面板可视区。
- 根因：`styles.input` 没有 `boxSizing: border-box`，而卡片里用的是 `width: '100%'`，于是实际宽度 = 100% 内容宽 + 20px 左右 padding + 2px 边框，正好把卡片撑出去；`styles.card` 本身也没有 `minWidth/maxWidth` 约束，在 flex 列里会被这个超宽子元素带着一起变宽。
- 修法：`styles.input` 加 `boxSizing: 'border-box'` + `maxWidth: '100%'`；`styles.card` 加 `boxSizing: 'border-box'` + `minWidth: 0` + `maxWidth: '100%'`；按钮行改 `flexWrap: 'wrap'` + `rowGap: 6`，字数/提示文案加 `overflowWrap: 'anywhere'`，长提示不再把行撑爆。
- 验证：`dev/ui-overflow-check.html`（1:1 复刻卡片样式，面板宽 420px）实测 `card.scrollWidth 388 / clientWidth 388`（相等，无溢出）；把 `box-sizing` 改回 `content-box` 后 `scrollWidth 396 > clientWidth 388`（复现原问题）。`node --check`、render smoke、`node --test` **55/55**。

## 1.0.0 — 修 dev/toggle-bundle.mjs 写出非法 JSON（2026-11-07）

- 事故：`dev/toggle-bundle.mjs` 旧的 `off` 是「按行删掉 `"@local/dsmp",` 那一行」，当它正好是 bundles 数组最后一项时，前一项的逗号失去后继 → `"@local/dsh-badge-hider",\n]` → 整个 profile `package.json` 无法解析 → DSH 起不来（本次由 Codex 手工删逗号恢复，16 个 bundle 全保留）。
- 修法：改成 JSON 级编辑——`JSON.parse` → 过滤/前插 `dsh.profile.bundles` → `JSON.stringify(data, null, 2)`（保持 CRLF）→ 写 `.tmp` 后 `rename`；写盘前先 `JSON.parse(text)` 自检，并检查是否有重复条目。
- 验证：`status` → `off`（parse 通过）→ `on`（parse 通过、16 个 bundle、`@local/dsmp` 在首位）；profile 无 BOM，`dependencies` 19 条、`@local/dsmp` 仍指新家。
- 教训：凡改 profile / DSH storage，一律「解析-改-序列化」，不要做字符串级增删。

## 1.0.0 — 人设卡删除与镜像清理（2026-11-07）

- 新增 `deleteRoleText(name, settings)`（`lib/role.js`）：先把原卡复制成 `.bak-dsmp-*` 再删；拒绝删除当前正在使用的那张（`DSMP_ROLE_ACTIVE`）、不存在时回 `DSMP_ROLE_MISSING`、坏文件名回 `DSMP_ROLE_NAME`。
- `syncRolesToMemory` 增 `prune`（默认开）：同步完成后扫描镜像目录，把源目录里已经不存在的 `*.md` 删掉，结果放在 `removed[]`；`README.md`、`active.json`、`.bak-*`、`.tmp-*` 不受影响。
- 新增 `DELETE /api/dsmp/roles?name=`；面板人设卡加「删除 → 确认删除」两段式按钮（当前卡禁用，并提示要先切换），删完自动重载列表与新的当前卡。
- 校验：`node --test` **55/55**、render smoke 通过、生产镜像复跑 `written:[] removed:[]`（无副作用）；`acceptance-check` 18/18、`sandbox-check` 25/25 保持。

## 1.0.0 — 人设卡镜像到记忆目录 + 插件自检（2026-11-07）

- 新增 `syncRolesToMemory({settings, memoryDir, now})` / `mirrorSummary(memoryDir)` / `mirrorDirOf(memoryDir)`（`lib/role.js`）：把 bridge `roles\*.md` 复制到 `<记忆目录>\roles\`，跳过 `README.md`/`.bak-*`/`.tmp-*`，内容相同不重写（幂等），并写 `active.json`（`{role,source,syncedAt}`）。
- 触发点：插件启动、`POST /api/dsmp/roles` 保存后、手动 `POST /api/dsmp/roles/sync`；`GET /api/dsmp/roles` 与 `/api/dsmp/status` 都带镜像摘要。
- 镜像目标固定为 `settings.memoryDir`（生产记忆目录），不受测试期隔离影响——人设卡属于配置，要跟着记忆目录一起搬/一起导出。
- 已实测生产同步：`<DSMP_MEMORY_DIR>\roles\` ← <PERSONA>.md / 傲娇助手.md / <PERSONA_ALT2>.md + active.json（role=<PERSONA>）。
- 自检：`node --test` **54/54**、`acceptance-check` **18/18**、`sandbox-check` **25/25**；全部 `/api/dsmp/*` 端点 200，本地聊天、改名/删除、面板直发均实测通过。
- 顺手补数据：`scripts/repair-window-gaps.mjs --days 1 --write` 回填 7 轮（18:23–18:29 那段的 QQ 对话），验收从 17/18 回到 18/18。

## 1.0.0 — 面板直发：面板消息经 bridge 进同一会话（2026-11-07）

- bridge 新增 `POST /api/socialV2/panel-message`（控制台令牌）：给同一会话投递「来自桌面面板、不发 QQ」的消息，模型只用文字回答，不会被要求调用任何 QQ 发送工具；返回 `{ok,key,delivered}`。
- DSMP 新增 `panel.liveSend`（默认开）。当目标会话就是 bridge 正在驱动的那条时，`/api/dsmp/chat/send` 不再本地起 agent，改为转发给 bridge；返回 `live:true`、`memory.skipped=live-forward`。面板发图在该会话上暂不支持（明确 400）。
- `GET /api/dsmp/history/sessions` 会问 bridge 当前的会话映射（`bridgeLive`），因此 mode 切换后「当前对话」仍指向真正在用的那条（本次实测 `closed-agent` 映射到 `session-4a516d67…`）。
- 会话日志解析补两处：注入里的 `【面板消息】` 标记只显示其后原文；QQ 入站的整段提示（时间/规则/卡）按 `【管理员】…` 这类发送者行截断，只显示对方真正说的话。
- 客户端：当前对话不再禁用输入框，placeholder 写明「面板直发，不发 QQ」，提示行标注投递路径。

## 1.0.0 — 设置里加「打开旧工作台」（2026-11-07）

- 设置 → 记忆卡片新增一行「旧记忆工作台」，按钮直接在新窗口打开 `settings.workbench.url`（默认 `http://127.0.0.1:7351`），并用状态探测结果标注「运行中」或「7351 未监听，需先启动工作台」。
- 原来只有「打开记忆页签」（内嵌六视图），现在旧的 7351 工作台也能一键打开，作为对照/过渡入口。
- 校验：`node --check`、render smoke、`node --test` **53/53**；`/api/dsmp/status` 的 `workbench` 返回 `{url:'http://127.0.0.1:7351', http:200}`。纯客户端改动，刷新页面生效。

## 1.0.0 — 人设卡默认为<PERSONA>（2026-11-07）

- 人设卡下拉以前默认选目录里排序第一个（`傲娇助手`），现在默认选**正在使用的那张**：优先 `state/current-role.json` 的 `role`，取不到回落 `<PERSONA>`（`roles.fallbackName`）。
- `README.md` 是说明文档、不是人设卡，服务端 `listRoles()` 与客户端下拉都把它过滤掉（之前会混在选项里）。
- 默认路径从旧 junction 改为真实目录：`<DSMP_BRIDGE_DIR>\{roles,state\current-role.json}`；运行中的 `settings.json` 也已同步指向新目录。
- 校验：`node --check` 三文件、render smoke、`node --test` **53/53**；`/api/dsmp/roles` 返回 `current:{name:"<PERSONA>",source:"current-role.json"}`，默认选中「<PERSONA>」，`GET ?name=<PERSONA>` 读回 5130 字。

## 1.0.0 — 会话栏接入「当前对话」并置顶（2026-11-07）

- 会话栏以前只列 `session-dsmp-test-*` 测试会话，看不到真正在聊的那个。
- 现在 `ChatTab.loadSessions()` 会额外读 `/api/dsmp/history/sessions`，把 `bound:true` 的会话（`settings.session.liveId`，当前 QQ 会话）补进列表并**置顶**，标题「<PERSONA>（当前对话）」，左侧 `▍` 标记、副标题 `当前 · …`，头部显示「当前 · QQ」徽标。
- 选中它时消息来自 `/api/dsmp/history`（会话日志真实内容，含 QQ 来源与面板来源），不是内存镜像；**重命名/删除按钮对该会话隐藏**（避免误把真实会话从面板移除）。
- 发送仍被测试期护栏拦住：输入区换成说明「这是当前对话（由 QQ 通道驱动），面板暂不直接发送，避免双写者」。要开启面板直发需要先解决同一会话的双写者问题（bridge 与插件同时驱动）。
- 校验：`node --check`、render smoke、`node --test` **53/53**；纯客户端改动，刷新页面即可。

## 1.0.0 — 历史记录默认显示当前会话（2026-11-07）

- 现象：打开「历史记录」默认落在会话列表的第一条（按 mtime 排序），经常是别的会话（比如 DSH 自己的会话），不是正在聊的那个。
- 修复：`lib/client.js` 的 `HistoryTab.loadSessions()` 改为优先选 `bound:true` 的会话（即 `settings.session.liveId`，当前绑定的 QQ 会话），没有再回落第一条。
- 实测：`/api/dsmp/history/sessions` 里 `session-724c03d0…` 是 `bound:true` 但按 mtime 排第 5；修复后历史页默认打开它（`total:112`，首条「两点睡到十二点，这觉够本…」）。
- 只需刷新页面（`lib/client.js` 不要求重启 DSH）；`node --check` 与 render smoke 通过。

## 1.0.0 — 服务按钮只起一个 PowerShell（2026-11-07）

- 现象：每次点「启动/关闭 QQ 机器人」，屏幕上刷出一排 PowerShell 控制台。
- 根因：`start-bot.cmd` 分六次调用 `powershell`、`stop-bot.cmd` 分四次 `call` 子脚本，子脚本内部又各自调 `powershell`；面板侧还用 `detached` 启动，`DETACHED_PROCESS` 会给子进程新建控制台，于是每步一个窗口。
- 修复：
  - 新增 `scripts\dsmp-boot.ps1`（QQ 检查 → 必要时拉起 DSH → 等 4s → `sync-dsh-now.ps1` → SnowLuma hidden → 等 5099 → bridge hidden → 等 3100）与 `scripts\dsmp-halt.ps1`（stop-bridge / stop-snowluma / stop-ai / stop-tts + 4s）。`start-bot.cmd`、`stop-bot.cmd` 现在各只起**一个** `powershell -WindowStyle Hidden -File`。
  - `lib/services.js` 的 spawn 改为非 detached + `windowsHide`（`CREATE_NO_WINDOW`），并传 `DSMP_HEADLESS=1`；`start-bot.cmd` 在 headless 下不再自动打开 SnowLuma WebUI。
- 实测（面板接口）：`stop` 14s → `running:false`；`start` 28s → `running:true`；`node --test` **53/53**，`acceptance-check` **18/18**。
- 注意：`lib/services.js` 的改动同样要**重启 DSH** 才被面板加载；两个 `.cmd` 与两个 `.ps1` 每次运行都重新读取，立即生效。

## 1.0.0 — 服务按钮以端口为准：关闭真的关掉（2026-11-07）

- 现象：设置页点「关闭 QQ 机器人」，日志显示 `stop-bridge done`，但 3100 仍在监听、机器人还在跑；点「启动」偶尔又直接返回 `already:true`。
- 根因一：`stop-bridge.cmd` 只杀「命令行里带 `DSH-QQ-bridge` 路径」的 `cmd.exe`，而监督进程是 `cmd.exe /c start-bridge.cmd`（相对名），匹配不到 → 桥接被杀后 5 秒内被重新拉起。
- 根因二：`state\bridge.lock` 里的 pid 活着但 3100 没监听时，新启动判「已有实例在运行」直接退出。
- 修复：
  - 重写 `stop-bridge.cmd`：按脚本名 `start(-bridge|-bot)?\.(bat|cmd)` 匹配（连 `start-bot.cmd` 一起杀、排除 restart/stop/自身）、杀 `bridge.js` 的 node、杀监听 3100 的 pid，1200ms 后复查，最多 3 轮。
  - `services.startService` 启动前 `clearStaleLock()`（杀锁里的 pid 再删 `bridge.lock`）。
  - `runScript` 增 `wait` 选项：`stop` 会等脚本真正退出（`stop-bot.cmd` 约 10s）；`start` 用 `waitPort` 等端口监听（bridge ≤90s、引擎 ≤60s），返回带 `running:true`；没到位回 `ok:false` + `tail`。
- 实测（本机直连 `lib/services.js`，`dev/verify-services-local.mjs`）：`stop` **13.7s** 返回 `running:false`、3100 `refused`；`start` **38.5s** 返回 `running:true`、3100 `open`；随后 `/api/dsmp/status` 恢复 `mode:"qq" role:"<PERSONA>" dshReady:true`。
- 校验：`node --test test/*.test.mjs` **53/53**。
- 注意：本次改动只改了 `lib/services.js`，**要重启 DSH 才会被面板用上**（bundle 开关只重跑 `apply()`，不重新 import 模块）。

## 1.0.0 — 服务按钮修复：PowerShell 7 + 不再依赖宿主 PATH（2026-11-07）

- 现象：设置页「启动/关闭 QQ 机器人」报「调用 powershell 异常」，且没有可读的错误信息。
- 根因：`runScript` 用相对命令名 `cmd.exe` + `stdio:'ignore'` 分离进程，宿主（Electron）的环境块可能早于用户终端，`PATH` 里缺 `%SystemRoot%\System32\WindowsPowerShell\v1.0`，脚本里的 `powershell` 直接报「不是内部或外部命令」；同时输出被丢弃，面板只能显示一句「失败」。
- 修复：
  - 用绝对路径 `%SystemRoot%\System32\cmd.exe` 启动，并显式构造 `PATH`（`C:\Program Files\PowerShell\7` → `System32\WindowsPowerShell\v1.0` → `System32` → `%SystemRoot%` → 原 PATH 去重），不再依赖宿主环境。
  - stdout/stderr 写到 `<DSH_HOME>\dsmp\logs\service-<name>.log`（文件 fd，非管道）；脚本非 0 退出时 POST 返回 `{ok:false,code,error,tail}`，面板直接展示错误与日志末尾。
  - 每个服务新增「日志」按钮：`GET /api/dsmp/services?log=<name>` 读末尾 20000 字。
- 本机 PowerShell：系统 5.1.26100.9444 之外，安装 **PowerShell 7.6.9**（`C:\Program Files\PowerShell\7\pwsh.exe`）。`winget`（MSIX）在本机会报 `0x80070422`——`wuauserv` 被禁用；改用官方 MSI 静默安装成功。
- 实测：`POST /api/dsmp/services {action:'stop',name:'qq'}` → 3100 down；4 秒后 `{action:'start'}` → 25 秒内 3100 up；`?log=qq` 能读到两次脚本完整输出。
- 校验：`node --check` 三个文件通过；render smoke 通过；`node --test test/*.test.mjs` **53/53**；`acceptance-check` **18/18**；`sandbox-check` **25/25**。

## 1.0.0 — 会话改名/删除 + 本地服务控制（2026-11-07）

- 会话可改名、可删除：聊天页标题旁「重命名 / 删除」，删除需二次确认；名字与隐藏标记存 `<DSH_HOME>\dsmp\session-meta.json`，**只动面板不动会话日志**（隐藏可清除恢复）。
- 会话列表改由「内存镜像 + 磁盘扫描」合并：插件重载后 `session-dsmp-test-*` 会话仍在列表里，可继续改名、删除、接着聊。
- 设置页新增「本地服务」卡片：QQ 机器人 / A绘世 / GPT-SoVITS 的启动、关闭与运行状态（端口探测 + 脚本存在性），全部只调用已有脚本。
- 10 分钟空闲自动关闭保持原样（bridge 的 `idleStopProcessMs` / `idleStopMs`）；另加 `services.startIdleWatch` 兜底：bridge 离线时关闭面板启动后闲置 10 分钟的引擎。
- 设置页「记忆与工作台」加「打开记忆页签」快捷按钮（无需再开 7351）。
- 新增路由：`POST /api/dsmp/chat/rename`、`POST /api/dsmp/chat/delete`、`GET|POST /api/dsmp/services`；新增模块 `lib/session-meta.js`、`lib/services.js`。
- 校验：`node --check` 通过；styles 引用 70/70 无缺失；render smoke 通过；`node --test test/*.test.mjs` **53/53**；`acceptance-check` **18/18**；`sandbox-check` **25/25**。

## 1.0.0 — 记忆/设置页签可滚动（2026-11-07）

- 修「记忆」「设置」两个页签内容超出窗口时无法上下滚动：`styles.page` 是 `height:100% + overflow:hidden` 的 flex 列，两个页签的根节点只是会随内容撑高、却没有自己的滚动容器，超出部分被直接裁掉。
- 新增 `styles.scroll`（`flex:1 1 auto`、`minHeight:0`、`overflowY:auto`、`paddingRight:6`、`scrollbarGutter:'stable'`）：设置页整页用它；记忆页把六个子视图的正文包进它，子页签固定在顶部不随内容滚走。
- 校验：`node --check` 通过；render smoke 通过；`node --test test/*.test.mjs` 50/50。

## 1.0.0 — 会话栏可折叠 + 历史从下往上翻（2026-11-07）

- 聊天页左侧会话栏可折叠：标题行新增「收起」按钮，收起后变成 46px 竖条（展开按钮 + 新建按钮），状态写 `localStorage['dsmp.rail.collapsed']`，刷新后保持。
- 历史记录改为「从下往上翻」：
  - 打开会话时自动定位到最新一条（列表底部），向上滚动即自动加载更早的消息，不再需要点「加载更早的消息」按钮。
  - 旧消息前插时用「高度差补偿」保持视口不跳动（`prevHeightRef` + `scrollTop += delta`），到顶后显示「已经到最早一条」。
  - 搜索后同样从结果的最新一条开始。
- 新增 `ChevronLeftIcon` / `ChevronRightIcon`、`styles.railCollapsed`；`dev/patch-ui-2.mjs` 记录本次改动。
- 校验：`node --check lib/client.js` 通过；render smoke 通过；`node --test test/*.test.mjs` 50/50。

## 1.0.0 — 聊天面板 UI 改版（2026-11-07）

- 聊天页重做为「左会话栏 + 右对话流 + 底部输入条」的三段式布局，向 DSH 自带聊天窗口靠拢：
  - 左侧会话栏（宽 212）列出测试会话，当前项高亮，右上角 `+` 新建；会话 ID 后 8 位作为副标题。
  - 对话流居中（max-width 760），按天分组；「<PERSONA>」消息带头像、名字、时间、模型，正文 13.5px/1.72 行高；主人消息右对齐圆角气泡（accent 淡底），时间在气泡下方。
  - 底部输入条改为圆角容器：图片/语音图标按钮 + 无边框多行输入 + 圆形发送按钮，下方一行小字提示（记忆注入状态 · 模型 · Enter/Shift+Enter 用法）。
  - QQ 通道与语音库收进底部细条，默认不占视觉；语音库按需展开。
- **修掉一批样式缺失**：旧样式表里 `userBubble / buttonPrimary / toolbar / input / status / list` 六个键只被引用、从未定义，导致多个页签的按钮与输入框没有边框/配色（`{...undefined}` 静默变空）。本次一次补齐，并顺带统一了页签样式（下划线式，替代胶囊按钮）。
- 新增 `dev/rewrite-chat.mjs`（本次改版的代码搬运脚本，保留作参考）与 `dev/render-smoke.mjs`（用最小 React shim 在 Node 里真渲染 `DsmpPanel`/每个 slot 组件，能提前抓 JSX 级错误）。
- 校验：`node --check lib/client.js` 通过；样式/配色引用零缺失（64/64）；render smoke 通过；`node --test test/*.test.mjs` 50/50。

## 1.0.0 — M7 搬家归位（2026-11-07）

- 插件实体搬到 `<DSMP_PLUGIN_ROOT>`（robocopy 排除 `node_modules / backup / dist / .git`，259 文件逐文件 SHA256 对账，0 处不一致）。
- profile 三落点重绑：`dependencies["@local/dsmp"]` 指向新家、`dsh.profile.bundles` 保留、`node_modules\@local\dsmp` junction 重指。
- 旧路径 `<DSMP_WORKSPACE>\plugins\dsmp` 改为指向新家的 junction（实体改名为 `dsmp.moved-20261107-133441`），避免宿主内存里的旧 URL 与磁盘分叉。
- 清掉 `vendor\memory\[object Object],…\state\topics.jsonl` 历史垃圾目录（已存档到备份 `dsmp-m7-move-20261107-133204\stray-vendor-dir\`）。
- 新家单测 50/50 pass；`status.pluginRoot` 需重启 DSH 后才会显示新路径。
- 记录：`docs\DSMP-M7-验证记录.md`（含回滚 3 步与旧目录退役前置条件）。

## 1.0.0 — M6 单写者租约（2026-11-07）

- 新增 `lib/lease.js`：`<记忆目录>/state/engine-lease.json` 抢占/心跳/释放/摘要；活租约被他人持有时拒绝抢占，过期租约可接管（记录 `tookOverFrom`）。
- 新增 `lib/memory-writer.js`：把 bridge 转发来的 `begin-turn / note-spoken / finish-turn` 落到 vendor `window.mjs`；非写者一律 `409 DSMP_NOT_WRITER`，不静默写。
- 新路由：`GET/POST /api/dsmp/memory/lease`、`POST /api/dsmp/memory/begin-turn|note-spoken|finish-turn`、`GET /api/dsmp/memory/writer`。
- `settings.memory = { owner: "bridge", leaseTtlMs: 60000, heartbeatMs: 15000 }`，默认 `bridge` = 生产行为不变；改成 `dsmp` 才抢租约，设置页可改。
- bridge 侧（`<DSMP_BRIDGE_DIR>\src\bridge.js`）：新增 `memoryLeaseInfo()` / `dsmpWriterOn()` / `postDsmpMemory()`，`beginWindowTurn` / `stripFeelForSend` / `finishWindowTurn` 三处在 owner=dsmp 且租约有效时改为**按会话串行转发**；转发失败只记日志、不回落本地写入；启动日志打一行「记忆单写者：owner=…，租约=…」。
- 记忆引擎 bug 修复（3.1.3）：`score.mjs` 的 `tierAfter()` 对 `task` 只在 `dueAt + taskTtlDays` 之后才判过期；新增 `expireReasonOf()`，`scoring-runner` 的过期原因按真实分支记录（task-overdue / event-ttl / temp-ttl / expired-other）。修复了「11-09 的待办在 11-06 被 temp TTL 误杀且原因写成 task-overdue」。
- 新增 `test/task-ttl.test.mjs` 6 条、`test/dsmp.test.mjs` M6 5 条（租约抢占/过期接管/非写者拒绝/409/转发落账本）。
- 门禁：`node --test test/*.test.mjs` 50/50（DSMP）、512/512（memory）；`acceptance-check` 18/18；`sandbox-check` 25/25。
- 实测（测试记忆目录，非生产）：owner=dsmp 抢到租约 → begin/note/finish 落 `window/<sid>/turns.jsonl`（turn 1）→ 改回 bridge 后租约文件消失、再转发返回 409；生产目录无租约、无测试会话。

## 1.0.0 — M5 迁移 / 记忆包 / 打包（2026-11-07）

- 新增 `lib/zip.js`：零依赖 zip 读写（crc32、`createZip`、`readZip`）；UTF-8 文件名、CRC 与长度逐条校验。
- 新增 `lib/migrate.js`：Journal 迁移 `copy → verify → switch → cleanup → done`；`preflight` 检查源/目标/空间/嵌套；cleanup 只改名 `<源>.migrated-<stamp>`，**从不删源**；`rollback` 按改名记录搬回；`rewriteSessionCwd` 改会话头 cwd 后**按行重新分帧**（整份压成单帧会让 DSH 判空并让会话消失）。
- 新增 `lib/archive.js`：记忆包导出（`manifest.json` + `memory/**` + `workspace/agent/**` + `sessions/**` + `roles/**` + `dsmp/settings.json`）、`verifyArchive`（sha256/缺件/额外文件）、`importArchive`（先验后写，只写记忆树）。
- 新路由：`GET/POST /api/dsmp/migrate`、`POST /api/dsmp/memory/export|import|verify`；测试期迁移生产目录返回 403 `DSMP_TEST_ONLY`。
- 新增 `scripts/pack.mjs`：自写 ustar+gzip 打 `dist/deepseek-memory-partner-1.0.0.tgz`；打包时把本机路径替换为 `<DSMP_MEMORY_DIR>` / `<DSMP_BRIDGE_DIR>` / `<DSH_HOME>` 占位符，`lib/settings.js` 运行时从同名 env 展开；不含 `dev/test/dist/backup` 与 vendor 的开发文档。
- 新增 `test/m5.test.mjs` 8 条（zip 往返与 CRC、迁移+回滚、preflight、按行分帧、导出/校验/导入、篡改检测、tgz 内容）。
- 演练：1097 文件迁移 + 回滚；导出 489 条目 / 4,253,424 B；导入 482 文件且 `longterm.jsonl` 逐字节一致；导入副本 acceptance 18/18；会话日志 112 条气泡可解析；tgz 75 条目 / 277,547 B，`work program` 零命中。
- 门禁：`node --test test/*.test.mjs` 45/45；`acceptance-check` 17 通过 / 0 失败 / 1 跳过（生产库无带日期待办）；`sandbox-check` 25/25。

## 1.0.0 — M4 历史 + 设置 + 工作台并入（2026-11-07）

- 新增 `lib/session-log.js`：多帧 zstd 逐帧解压（`zstdDecompressSync` 只解首帧，故自走帧头）、`findSessionLog`/`scanSessions`/`historyFromFile`；她真正发出去的话取自 `mcp__snowluma__qq_send_message` 的 tool/call 参数，同一 turn 的工作笔记自动丢弃；用户气泡从 `【本次消息快照】` 取原文，宿主注入前缀不进气泡。
- 新增 `GET /api/dsmp/history`（`before` 游标、`q` 搜索、缺会话 404 `DSMP_HISTORY_MISSING`）与 `GET /api/dsmp/history/sessions`（首帧读 cwd/预设，按 mtime 倒序）。
- 新增 `lib/workbench/state.js` 与 `GET /api/dsmp/workbench`：长期事实 / 主题簇 / 窗口回放 / 情境索引 / 消费账单 / 检索调试 / 待确认纠正，纯只读；账单只统计 `k=turn`，`base` 基线不计。
- 面板加「记忆」页签（六视图子页签），历史页签按天分组 + 来源徽标（QQ/面板/笔记）+ 搜索 + 加载更早。
- 设置页签补齐「模型与 API」（`GET/POST /api/dsmp/models`，写 `settings.chat.{provider,model}`）、「人设卡」（`GET/POST /api/dsmp/roles`，≤30000 字，写前备份 `.bak-dsmp-*`）、消费卡。
- 测试 35 → 37 条（人设卡备份与校验、模型选择写回），全绿。
- 门禁：`node --test test/*.test.mjs` 37/37；`acceptance-check` 17 通过 / 0 失败 / 1 跳过；`sandbox-check` 25/25。

## 1.0.0 — M3 媒体：图片收发/查看 + 语音播放/入队（2026-11-07）

- 新增 `lib/media-store.js`：内容寻址媒体库（图片 `media/YYYY-MM`、语音 `voice/YYYY-MM`，索引 `state/media.jsonl` / `state/voice.jsonl`），sha1 去重、tmp+rename 原子写入、索引每 sha1 只追加一行；`sniff()` 用魔数识别 PNG/JPEG/GIF/WebP/WAV/OGG/MP3/MP4，服务端不解码图像（零依赖）。
- `lib/http.js`：`readRawBody`（16MB 上限、独立错误码 `DSMP_MEDIA_TOO_LARGE`）与 `sendBuffer`（强 ETag、`If-None-Match`→304、单区间 `Range`→206、越界→416、`immutable` 缓存）。
- 新增 6 条路由：`media/upload`、`media/file`、`media/list`、`media/attachment`、`voice/send`、`voice/outbox`。
- `chat/send` 支持 `images: [sha1]`（最多 4 张）：先查媒体库取字节，再用 `ctx.attachments.saveImages` 转成 `ImageAttachmentRef`，最后以 `{type:'image', attachment}` 内容块投递；允许「只发图不写字」。
- `session-bridge`：`send` 接受 `images`；`observe` 投影 `images`；`message` 增 `origin / displayText`——含 `【本次消息快照】` 的注入串只显示标记之后的原文，宿主注入不再出现在气泡里。
- client：发图按钮 + 粘贴 + 拖拽上传、待发送缩略图与移除、气泡内图片条；语音卡片（`<audio>` 播放、显示体积、一键入队）与「上传语音」。
- 测试 32/32（新增媒体库三条、上传/取回/ETag、图片内容块、语音入队）。
- 真实联调：96×96 红方块+蓝圆测试图（sha1 `635d96bd…`，711 B）上传两次 `dup:true` 且索引仍 1 条；带图提问三次，回复分别是「白底上就两样：左上角一个红色的正方形，右下角一个蓝色的圆形」「图里恰好有两个形状…」「还是两个——左上红方块、右下蓝圆圈」——模型确实看见了图；语音 WAV 上传后 `Range: bytes=0-999` 返回 206（1000 B / 16044 B），入队记录进 `voice-outbox.jsonl`。
- 已知限制：QQ 入站语音 bridge 只落 `[语音]` 文本，播放 QQ 语音要等 bridge 把字节也存进记忆媒体库；语音「真发」仍需 agent token，测试期只入队。
## 1.0.0 — M0 骨架 + M1/M1b 本地聊天与记忆注入（2026-11-06）

### M0 骨架

- 新建单包插件 `@local/dsmp`（host + web client），`dsh.bundle.patch` 指向 `cordis.patch.yml`。
- host：`/api/dsmp/status`（模式/桥接/记忆/工作台/角色）、`/api/dsmp/settings`（GET/POST，白名单键）、`/api/dsmp/roles`（列表）。
- 角色卡跟随：读 `state/current-role.json`，缺失或损坏回落「<PERSONA>」；面板名 = `聊天-<角色名>`。
- 三模式探测：`local`（bridge 不可达）/ `degraded`（bridge 在线但状态未确认）/ `qq`（`/api/status` 200）。
- client：侧边栏图标 + 整页「聊天 / 历史记录 / 设置」三页签。

### M1 本地聊天（只测试）

- `lib/session-bridge.js`：`attach`（有活 agent 复用、否则 `resume`）、`createTestSession`（挂 `agentPresets` 的 `setup`、先建 cwd、清 seed inbox）、`send`（`followup`）、`observe`（`session/event` 投影成气泡）、`dispose`、`listSessions`。
- 测试期护栏：`test.enabled` 时 `guard()` 拒绝非 `session-dsmp-test-*` 会话（403 `DSMP_TEST_ONLY`）。
- `lib/models.js` + `/api/dsmp/models`：provider / model 目录、当前默认选择、DSMP 覆盖值。
- Chat 路由：`/chat/sessions`（列表/新建）、`/chat/send`、`/chat/messages`、`/chat/attach`、`/chat/dispose`、`/chat/live`。
- 真实 host 实测：建会话 → 发消息 → 12 秒拿到回复；会话日志 834 B → 56 KB；dispose 后 `resume` 仍记得上文。

### M1b 记忆注入（只读）

- `vendor/memory/`：记忆引擎固定副本（213 文件 / 2.09 MB）。
- `lib/memory-context.js`：`composeChatPrompt` 按「规则 → 事实卡 → 【本次消息快照】」拼注入文本；`buildFactCard` 走 `buildTreeCard`（主题树），`memoryDataPresent` 兼容 `state/longterm.jsonl` 与根目录两种布局。全部只读。
- `/api/dsmp/chat/send` 现在先组 prompt 再投递，响应带 `memory` 元信息（事实条数/卡字数/规则字数/模式）。
- 新增 `/api/dsmp/memory/preview`：只读预览注入文本与各段长度。
- 实测：`rules 194 字 + card 1494 字`（130 条事实、13 个主题、tree 模式）；问「主人生日」回答 `<OWNER_BIRTHDAY>`；会话日志里能查到完整事实卡。
- 修复：建会话不传 `agentOptions` 时 persona 段的 `{{model}}` 为空导致回合失败 → 现在总是显式传主机默认模型。
- `listSessions` 补 `title / messages / lastAt / attached`，聊天页签可直接显示会话名。

### M2 QQ 通道（只读 + 只入队，2026-11-07）

- `lib/bridge-client.js`：控制台令牌走 `x-console-token`（不是 Bearer）；`status()` 归一成 `{mode,role,roleMode,dshReady,ownerQQ,allowPrivate,allowGroups,paused,snowluma,channel}`；`recent()` / `unread()` / `states()` 只读；`sendMessage()` 在 `test.allowLiveSend=false` 时**只写 outbox 并返回 `dryRun:true`，不发任何请求**。
- `channelModeOf()`：无桥 → `local`、通道非 qq → `degraded`、账号在线 → `qq`；`/api/dsmp/status` 用它的结果覆盖 `mode`，并附 `qq` 段（`ok`、角色、账号在线、白名单）。
- `validateInbound()`：key 必须是 `private:<QQ>` / `group:<群号>`，消息可为字符串或对象，归一成 `{text,sender?,msgId?,at?}`。
- 新路由：`/api/dsmp/bridge/status|recent|send`、`/api/dsmp/inbound`（GET/POST）、`/api/dsmp/inbox`、`/api/dsmp/outbox`；入站落 `<DSH_HOME>/dsmp/bridge-inbox.jsonl`，出站落 `outbox.jsonl`。
- client：聊天页顶部「QQ 通道（测试投递）」栏（最近入站 + 模拟入站按钮），设置页新增「QQ 通道」卡（在线角色/账号、发送方式、会话 key）。
- 为什么出站只能是 dry-run：reserved2 模式下 `/api/socialV2/send-message` 要求 `x-agent-token`（每会话 `state/social-v2.json.agentToken`），DSMP 只有控制台令牌；真发推迟到接入阶段或改由 bridge 转发。
- 实测（只读）：`mode:"qq"`、`role:"<PERSONA>"`、`snowluma{connected:true,accountOnline:true}`、`recent` 返回真实 3 条、`send` 返回 `dryRun:true`。

### 数据布局规范化（2026-11-07，M3 前置）

- 新增语音库 `voice\`（与图片库 `media\` 平级）+ 空索引 `state\voice.jsonl`；图片/语音都按 sha1 内容寻址。
- 移走 9 个散落备份（`profile.md.bak-*` ×5、`state\*.bak-*` ×4）到 `backup\shenming-layout-20261107-001817\moved\`，附 `manifest.json`。
- 新增 `scripts/check-memory-layout.mjs`：检查必需目录/文件、bak 回潮、索引与文件数一致性（23 项，只读）。
- 引擎硬编码路径（`state\`、`raw\`、`window\`、`episodes\`、`media\`、`profile.md`、`rules.md`）一律不改名；改名前必须先改 vendor 与 bridge 源副本并在 M6 做。

### 测试

- `test/dsmp.test.mjs` **26 条全过**；`acceptance-check` 生产库 17 通过 / 0 失败 / 1 跳过（库里已无「未过期的带日期待办」，同一副本加一条活待办后 18/18）；`sandbox-check` 25/25。
- M2 期间生产记忆零写入（`state/longterm.jsonl` 未由 DSMP 改动）；QQ 真实消息零发送。

