# components — 可选 QQ 接入组件（便携版，2.0.3-beta.1）

本目录随仓库与 zip 分发，包含可选的 QQ bridge；已剔除账号数据、运行状态、日志、备份、本机配置与令牌。
**SnowLuma**：仓库里不含（上游停止更新且被腾讯封禁），只保留历史改造方法 `DSH-QQ-bridge/docs/SNOWLUMA-ADAPT.md`；
**本地 zip 内额外附带 SnowLuma 1.14.20 便携副本**（已剔除账号库 `data/`、日志、WebUI 密码与 onebot 账号配置，首次使用需自行登录）。

## 包含
- `DSH-QQ-bridge/`：qq-bridge 源码 + `node_modules`（无需 npm install），控制台默认 `http://127.0.0.1:3100`

## 首次使用

1）补齐两个目录联接（bridge 通过 `tools\node-runtime` 使用 DSH 自带 Node）：

```powershell
$pkg    = "D:\DSMP\DeepSeek-memory-partner"
$bridge = "$pkg\components\DSH-QQ-bridge"
$dshApp = "D:\...\DeepSeek Harness\app"   # 你的 DSH 安装目录
cmd /c mklink /J "$bridge\tools\node-runtime" "$dshApp\resources\runtime\primary-runtime\dependencies\node"
cmd /c mklink /J "$bridge\tools\dsh-app" "$dshApp"
```

2）配置 bridge：复制 `DSH-QQ-bridge\config.example.json` 为 `config.json`，
   按注释填 `dsh.baseUrl`（DSH 当前 Web 端口）、`memory.dir`（记忆目录）、`ownerQQ`；
   `consoleToken` 填一个自定义随机串。

3）启动 bridge：双击 `DSH-QQ-bridge\start-bridge.cmd`，
   确认 `http://127.0.0.1:3100/api/status` 返回 200。

4）在 DSMP 面板「设置」填 bridge 地址与令牌文件 `state\console-token`；
   群/私聊白名单在 bridge `config.json` 的 `allow` 里改，默认只允许 `ownerQQ`。

5）QQ 网关（可选）：
   - zip 已附带 SnowLuma 便携副本（`components/SnowLuma`），登录后按下面的端口/token 配置 bridge；
   - 也可换任一 OneBot v11 网关（NapCat / LLOneBot 等）；
   - 按网关文档暴露 HTTP 3000 / WS 3001（或自定义端口），拿到 accessToken；
   - 把网关地址与 token 填进 bridge `config.json` 的 `snowluma.httpUrl`、`snowluma.wsUrl`、
     `snowluma.accessToken`，重启 bridge；
   - SnowLuma 的具体改造点（端口/token/自动加载补丁）见 `DSH-QQ-bridge/docs/SNOWLUMA-ADAPT.md`。

## 注意
- 不含 QQ 账号数据：首次登录需自行扫码/密码登录，QQ 客户端需自备。
- 画图（A1111/ComfyUI）、TTS（GPT-SoVITS）不在本包内，相关配置留空即自动跳过。
- 组件内 `.cmd/.ps1` 已做脱敏，出现 `<...>` 占位符时按上面步骤替换为真实路径。
