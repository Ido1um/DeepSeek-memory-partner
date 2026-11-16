# DSMP 内测版安装说明（2.0.10-beta.1）

本包是 DeepSeek Harness（DSH）插件 `@local/dsmp`（DeepSeek memory partner）的内测快照：一个插件同时提供记忆引擎、聊天面板、记忆速览与可选记忆工作台。

- 版本：`2.0.10-beta.1`（基于源码 2.0.10，2026-11-16 构建）
- 形态：DSH 本地插件（bundle），无需 npm / pnpm / Python
- 范围：插件本体 + `components/`（附带便携版 qq-bridge 源码与依赖）；**不含任何 QQ 网关（SnowLuma / NapCat）运行时**，也不含画图/语音引擎与运行数据
- 无 QQ 也能用：面板可独立聊天，记忆照常记录；人设卡放在记忆目录 `roles\` 下

> 说明：包内 README/代码示例中的 `<DSMP_PLUGIN_ROOT>`、`<DSMP_MEMORY_DIR>`、`<DSH_HOME>`、`<OWNER_QQ>` 等是脱敏占位符，安装时请替换为你的实际路径/账号。

---

## 1. 环境要求

| 项 | 要求 |
| --- | --- |
| 系统 | Windows 10 / 11 x64 |
| DSH | ≥ 0.2.1-rc.2（0.2.1-rc.5 实测） |
| Node | 使用 DSH 自带 Node（≥ 22.13），**不需要**另装 Node/npm/pnpm |
| 可选 | 可用的 OneBot v11 网关（自带 qq-bridge，或你已有的 SnowLuma / NapCat 等）+ QQ 客户端 |

---

## 2. 包内容

```text
DeepSeek-memory-partner/
├─ lib/                插件宿主端 + 客户端代码
├─ vendor/memory/      记忆引擎（固定副本，不依赖外部项目）
├─ workbench/          记忆工作台（可选，默认 127.0.0.1:7351）
├─ components/         QQ 组件（便携版 qq-bridge）
├─ README.md           完整功能说明（含面板/记忆/迁移等）
├─ README.en.md        英文说明
├─ CHANGELOG.md        变更记录
├─ LICENSE             MIT
├─ package.json        插件清单
├─ cordis.patch.yml    bundle 声明
└─ INSTALL.md          本文件
```

不包含：记忆/日志/state/备份等运行数据、本机配置与令牌、开发用 `docs/`、`dev/`、`test/`、SnowLuma 账号库（`data/`）、WebUI 密码哈希与 onebot 账号配置。`components/` 已剔除账号数据、运行状态与令牌（详见 `components/README.md`）。

> 说明：`components/DSH-QQ-bridge/node_modules/@snowluma/{sdk,mcp}` 是 bridge 运行所需的 **npm 客户端依赖**（`src/bridge.js` 顶部 `import { SnowLumaWebSocketClient } from '@snowluma/sdk'`），不是 SnowLuma 程序本体，故保留；仓库不含任何 SnowLuma 运行时/源码目录。

---

## 3. 安装（手工三落点）

### 3.1 解压到固定目录

例如 `D:\DSMP\DeepSeek-memory-partner`。不要放在 `C:\Program Files` 等受保护目录；路径可含中文与空格，但建议短路径。

### 3.2 找到 DSH 数据目录与 profile

- `DSH_HOME` 由 DSH 启动器决定（常见为本机数据目录下的 `.dsh`，不一定是 `%USERPROFILE%\.dsh`）
- profile 一般是 `<DSH_HOME>\profiles\desktop`
- 判断依据：该目录下存在 `package.json` 与 `cordis.patch.yml`

### 3.3 修改 profile 的 package.json（两个字段）

在 `profiles\desktop\package.json` 中：

1）`dependencies` 增加一行（link 路径用正斜杠）：

```json
"@local/dsmp": "link:D:/DSMP/DeepSeek-memory-partner"
```

2）`dsh.profile.bundles` 数组追加：

```json
"@local/dsmp"
```

### 3.4 建立目录联接（junction）

PowerShell 示例（把两个变量改成你的实际路径）：

```powershell
$DSH_HOME  = "D:\path\to\.dsh"
$profileDir = Join-Path $DSH_HOME "profiles\desktop"
$plugin     = "D:\DSMP\DeepSeek-memory-partner"

New-Item -ItemType Directory -Force (Join-Path $profileDir "node_modules\@local") | Out-Null
cmd /c mklink /J "$profileDir\node_modules\@local\dsmp" "$plugin"
```

注意：联接的目标目录必须真实存在；`node_modules\@local\dsmp` 不能已存在。

### 3.5 重载

- 刷新 DSH 页面即可（`dsh.profile.bundles` 增删会触发宿主热加载：约 2 秒卸载、4 秒重载；客户端 UI 需刷新页面重新拉插件清单）
- 若侧栏没有「记忆面板」：完全退出 DSH（含托盘）后重新启动
- 不推荐用 `dsh plugin add`（会走 pnpm，本机环境可能因 store 不一致失败）

---

## 4. 首次配置

打开侧栏「记忆面板」→「设置」：

1. **记忆目录**：填一个可写目录，例如 `D:\DSMP\memory` 或你已有的记忆目录。首次使用必须设置，否则记忆功能不可用。
2. **模型**：沿用 DSH 当前默认模型即可。
3. **人设卡**：把 `*.md` 角色卡放到 `<记忆目录>\roles\`，面板可切换/编辑。
4. 如果面板提示记忆目录未配置，也可以先设环境变量再重启 DSH：`DSMP_MEMORY_DIR=D:\DSMP\memory`（用户级环境变量），或在设置里直接填绝对路径。

### 验证

```text
GET http://127.0.0.1:<DSH 端口>/api/dsmp/status
```

应返回 `ok: true`、`version`（2.0.10）、`mode`（无 QQ 时为 `local`）。在面板发一条消息，输入框下方应出现「记忆已注入：事实 N 条 · 卡 X 字 · 规则 Y 字」，记忆页签能看到新事实即安装成功。

---

## 5. 可选：接入 QQ（`components/` 附带 qq-bridge）

`components/` 目录附带便携版 qq-bridge（源码 + `node_modules`，解压即用；已剔除账号数据、运行状态与令牌）：

- `components/DSH-QQ-bridge/`：qq-bridge，控制台默认 `http://127.0.0.1:3100`
- **QQ 网关**：本包不含（SnowLuma / NapCat 均需自备）。bridge 通过 OneBot v11 与网关通信，改 `config.json` 的 `snowluma.wsUrl / httpUrl / accessToken` 指向你的网关（默认 `ws://127.0.0.1:3001`、`http://127.0.0.1:3000`）即可；接 SnowLuma 的具体改造方法见 [`components/DSH-QQ-bridge/docs/SNOWLUMA-ADAPT.md`](components/DSH-QQ-bridge/docs/SNOWLUMA-ADAPT.md)。

首次使用按 [`components/README.md`](components/README.md) 操作：创建目录联接 → 复制并填写 `config.example.json` → 启动你自己的 OneBot v11 网关（SnowLuma / NapCat 等）并登录 QQ → 运行 `start-bridge.cmd` → 在面板设置里填 bridge 地址与 `state\console-token`。

也支持任意 OneBot v11 网关（NapCat 等）：改 bridge `config.json` 的 `snowluma.wsUrl / httpUrl / accessToken` 即可。未接入时插件按 `local` 模式运行，不影响记忆与面板聊天。

---

## 6. 数据、备份与迁移

| 数据 | 位置 |
| --- | --- |
| 记忆（事实/窗口/情境/媒体/语音/人设卡/agent 工作区） | 你设置的「记忆目录」 |
| 插件运行时状态（settings、日志、导入导出临时文件） | `<DSH_HOME>\dsmp` |
| 工作台配置 | `工作台目录\config.json`（本包已排除，首次运行生成） |

- 升级/重装插件只需替换安装目录，**数据不在安装目录**，不会被覆盖
- 备份：停止聊天机器人后整体复制记忆目录；或使用面板「备份 / 一键换机」
- 换机：面板导出记忆包 → 新机安装插件后导入（详见 README「迁移」章节）

---

## 7. 升级与卸载

**升级**：替换安装目录内容 → 重启 DSH（或刷新页面）。

**卸载**：

1. 停止聊天机器人/面板（如有）
2. `profiles\desktop\package.json`：从 `dependencies` 删除 `@local/dsmp`，从 `dsh.profile.bundles` 删除 `@local/dsmp`
3. 删除联接（只删联接，不删目标）：`cmd /c rmdir "<profileDir>\node_modules\@local\dsmp"`
4. 删除安装目录；记忆目录与 `<DSH_HOME>\dsmp` 默认保留（需要时手动清理）

---

## 8. 已知限制（内测）

- 内测快照，接口与数据结构仍可能变动；升级前请备份记忆目录
- QQ 组件在 `components/`（已脱敏，不含账号数据/令牌）；本包不含 QQ 网关，画图、TTS/STT 引擎也不在包内，相关能力默认关闭（面板留了配置入口）
- 记忆工作台（7351）需手动启动；面板内「记忆速览」不依赖它
- 设计文档 `docs/`、开发脚本 `dev/`、测试 `test/` 未随包提供
- 版本号：`2.0.10-beta.1`（源码 `2.0.10`）

---

## 9. 反馈

请附：DSH 版本、`/api/dsmp/status` 输出、`<DSH_HOME>\dsmp\logs` 相关日志、复现步骤。内测期间优先看面板「设置 → 诊断与自检」。
