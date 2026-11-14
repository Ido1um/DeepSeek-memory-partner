# @local/deepseek-memory

QQ 机器人（qq-bridge）的「7 天滚动记忆」独立包：日志落盘、窗口归档、原文检索、模型交接摘要、长期事实卡、MCP 检索工具。

- 数据目录：`<DSMP_MEMORY_DIR>`
- 代码目录：`<DSMP_MEMORY_SRC>`（本包）
- 使用方：`<DSMP_BRIDGE_DIR>`（通过 `node_modules\@local\deepseek-memory` junction 引用）
- 可视化工作台：`workbench\`（零依赖，127.0.0.1:7351；查状态、调参数、改记忆目录、一键打开桥接控制台）
- 打包边界与换机步骤：`PACKAGE.md`

## 目录

```
src/
  config.mjs      读 qq-bridge config.json（memory / webSearch / ownerQQ），解析 DeepSeek key
  store.mjs       日志写入/去重、窗口归档、检索、会话状态、交接摘要、事实卡
  digest.mjs      模型交接摘要 summarizeHandover / 事实卡 summarizeProfile + 提取式兜底
  migrate.mjs     旧布局（hot/、archive/）→ 新布局（raw/hot、raw/archive），幂等
  engine.mjs      记忆引擎：轮转 / 新会话兜底 / 注入拼装 / 日终维护 / 定时 tick（宿主无关）
  host.mjs        宿主接口 + createNullHost（测试与 CLI 用）
  mcp-server.mjs  独立 MCP server：qq_memory_search（stdio）
test/
  memory.test.mjs 20 个离线场景（临时目录，不碰生产日志）
  engine.test.mjs 7 个引擎契约场景（node --test）
```

## 数据布局

```
<DSMP_MEMORY_DIR>\
  raw\hot\<YYYY-MM-DD>\private_<OWNER_QQ>.jsonl   最近 8 个日文件（今天 + 前 7 天）
  raw\archive\<YYYY-MM>\private_<OWNER_QQ>-<day>.jsonl  窗口外的日文件，永久保留
  digests\<key>-<ISO>.md                        每次轮转的交接摘要（markdown）
  profile.md                                    长期事实卡（模型合并旧卡，≤ profile.maxChars）
  state\memory.json                             会话起点/chars/轮转次数/待注入摘要/去重 recentIds
  logs\                                         桥接日志（tool-calls / token-usage / bridge 等）
```

兼容：迁移没跑完时旧 `hot/`、`archive/` 也会被读取；`node src/migrate.mjs` 幂等。

## 与配置的关系

本包读 qq-bridge 的 `config.json`（默认 `<DSMP_BRIDGE_DIR>\config.json`），可用环境变量覆盖：

- `QQ_MEMORY_CONFIG`：config.json 路径
- `QQ_MEMORY_DIR`：数据目录（测试隔离用）
- `DSH_HOME`：找 `.credentials.yaml` 里的 DeepSeek key（默认 `~/.dsh`）

关键配置项（`memory` 段）：`enabled`、`dir`、`windowDays`（默认 7）、`dailyAt`（默认 23:00）、`maxSessionTokens`、`handoverMaxChars`、`profile.enabled/maxChars`、`summary.enabled/maxChars/timeoutMs`。

## MCP

DSH 的 `cordis.patch.yml` 增加一条 MCP：

```yaml
- insert:
    - id: mcp-deepseek-memory
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: deepseek-memory
        transport: stdio
        command: '<LOCAL_TOOLS>\tools\DeepSeekHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
        args:
          - '<DSMP_MEMORY_SRC>\src\mcp-server.mjs'
```

暴露工具：`qq_memory_search`（key/query/from/to/limit，只允许主人私聊）。
改动 MCP 代码或注册项后需要重启 DSH（或触发 MCP 重连）才会刷新。

## 引擎（宿主无关）

桥接里原本内联的「轮转 / 兜底 / 注入 / 日终维护」逻辑已经抽成 `src/engine.mjs`，由宿主注入 8 个方法：

```js
import { createMemoryEngine } from '@local/deepseek-memory/engine';
import { createNullHost } from '@local/deepseek-memory/host';

const host = createNullHost({ ownerKey: 'private:<OWNER_QQ>' });
const engine = createMemoryEngine({ host });

const composed = engine.composePrompt(key, sessionId, promptText);   // 事实卡 + 交接摘要，返回 {text, profile, handover}
// ……发给模型，成功后再提交：
engine.commitInjections(key, sessionId, composed);                  // 标记已消费，保证只注入一次
await engine.ensureFallbackHandover(key, sessionId);                 // 新会话没有现成摘要时补一份
await engine.rotate(key, { force: false });                          // 满 7 天 / 超阈值则轮转
await engine.runDailyMaintenance();                                  // 23:00 归档 + 刷新事实卡
engine.startMaintenance();                                           // 启动 5 秒后 tick，之后每 10 分钟
```

host 契约：`log` / `listSessions` / `getSessionId` / `retireSession` / `isBusy` / `isDshReady` / `afterRotate` / `getOwnerKey`。
引擎只依赖 store/digest 的纯函数，不读桥接 state，因此可独立测试、也可被未来的独立进程复用。

## 测试

```powershell
cd '<DSMP_MEMORY_SRC>'
& '<LOCAL_TOOLS>\tools\DeepSeekHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe' test/memory.test.mjs
& '<LOCAL_TOOLS>\tools\DeepSeekHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe' --test test/engine.test.mjs
```

覆盖：日志写入/去重/范围、检索（关键词/日期/无结果/limit）、窗口边界、轮转（窗口/tokens/会话不匹配）、归档、交接摘要与事实卡、跨进程持久化、新会话兜底标记。

## 迁移（旧 → 新）

1. 停桥接：`<DSMP_BRIDGE_DIR>\stop-bridge.cmd`
2. `node src/migrate.mjs --dry-run` 看数量
3. `node src/migrate.mjs`
4. 启桥接：`<DSMP_BRIDGE_DIR>\start.bat`（需带 PATH，见桥接 README）

## 已知限制

- 检索是关键词包含匹配（不是语义搜索），最多 8 个词、按命中数+时间排序。
- 事实卡是模型提炼，不保证逐条准确；细节以日志原文为准。
- 图片/语音消息只记录占位标签，不存文件本体。
- 归档只增不减；清理需要人工。
