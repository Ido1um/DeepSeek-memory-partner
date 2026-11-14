# SnowLuma 适配说明（历史方法，仅供参考）

> 本文档只保留「如何改造 SnowLuma / 如何换用其他 OneBot v11 网关」的方法。
> 由于 SnowLuma 上游停止更新，且其 QQ 登录方式已被腾讯限制，本项目**不再分发** SnowLuma 的源码或二进制。

## 1. bridge 对网关的要求

qq-bridge 只依赖 OneBot v11 的 HTTP(POST {action}) + WS 事件：

- 必需 action：`get_login_info`、`get_status`、`get_group_list`、`send_private_msg`、`send_group_msg`、`get_msg`、`get_group_msg_history`
- 语音（可选）：`get_record`，且需要扩展参数 `out_format: "wav"`（SILK→WAV 转码）
- 可选：`fetch_ptt_text`、`get_image`、`get_forward_msg`、`send_poke` / `group_poke`
- 鉴权：HTTP/WS 均用 Bearer accessToken（本机回环可关闭）

## 2. 当年 SnowLuma 的改造点（供参考）

1. `config/onebot_<QQ号>.json`：
   - `httpServers` 监听 `127.0.0.1:3000`，`wsServers` 监听 `127.0.0.1:3001`，分别填 accessToken；
   - `messageFormat: "array"`；`reportSelfMessage: false`。
2. `config/runtime.json`：`webuiPort: 5099`、`hookAutoLoad: true`、`webuiHost: 127.0.0.1`。
3. `launcher.bat`：把本目录加入 PATH 后依次执行 `check-node-version.cjs`、`index.mjs`（自带 `node.exe`，无需系统 Node）。
4. 只自动加载指定 QQ：`scripts/patch-snowluma-autoload-target.mjs` 会修改 `index.mjs` 里的
   `scheduleTargetAutoLoad` 与 `TARGET_UIN`，并写 `runtime.json` 的 `hookAutoLoad: true`；改前自动备份 `.bak`，幂等。
   - 如果目标不是这个 QQ，改脚本顶部的 `TARGET_UIN` / `SNOWLUMA_ROOT` 后重跑。
5. 启停：`start-snowluma-autostart.cmd`（`SNOWLUMA_HOOK_AUTOLOAD=1`，10 秒重启循环）、
   `stop-snowluma.cmd`（杀 launcher / autostart cmd / SnowLuma 的 node / 5099+3000+3001 监听者）。
6. WebUI：`http://127.0.0.1:5099`，首次设置密码；忘记可删 `config/webui.json` 重新生成。

## 3. 换用其他网关（推荐）

以 NapCat / LLOneBot 为例：

1. 按网关文档启动并登录机器人 QQ；
2. 开启 OneBot v11 的 HTTP 服务（默认 3000）与正向/反向 WS（默认 3001），记下 accessToken；
3. 修改 `components/DSH-QQ-bridge/config.json`：

```json
{
  "snowluma": {
    "httpUrl": "http://127.0.0.1:3000",
    "wsUrl": "ws://127.0.0.1:3001",
    "accessToken": "<你的网关令牌>"
  }
}
```

4. 重启 bridge，`GET /api/status` 的 `snowluma`/账号信息正常即为接通；
5. 若网关不支持 `get_record` 的 `out_format`，入站语音转写会降级为 `[语音]` 文本，不影响文字聊天。

## 4. 边界

- 旧版 SnowLuma 需要自行准备（本仓库不含任何 SnowLuma 文件）；它的账号库、WebUI 密码哈希、登录态都不要外传。
- 腾讯对第三方 QQ 协议客户端的风控随时可能变化，网关不可用时优先检查 QQ 版本与网关兼容性。
