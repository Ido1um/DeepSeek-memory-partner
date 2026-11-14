# DSH 免安装迁移方案

> 状态：**方案保留，暂不执行**（2026-10-26）
>
> 目标：另一台没有安装 DSH 的 Windows 电脑，直接复制程序 + 用户数据 + 工作区，尽量做到“无感迁移”。
>
> 本文只记录方案和盘点结果；没有执行迁移、没有改动当前 DSH/机器人配置。

---

## 1. 方案结论

DSH 可以按“绿色便携软件”迁移，不需要在目标机安装：

```text
程序目录 + C:\Users\<用户>\.dsh + 工作区
```

最稳的条件是目标机保持相同布局：

| 项目 | 当前路径 | 大小 |
|---|---|---:|
| DSH 程序 | `<LOCAL_TOOLS>\tools\DeepSeekHarness` | 约 1.04GB |
| DSH 用户数据 | `<USER_HOME>\.dsh` | 约 1.19GB |
| QQ 机器人项目 | `<DSMP_BRIDGE_DIR>` | 约 46MB |
| 当前工作区 | `<DSH_WORKSPACE>` | 约 2.6MB |
| 机器人记忆日志 | `<DSMP_MEMORY_DIR>` | 约 1.1MB |

合计约 **2.3GB**，目标机至少留 **3GB**。

推荐条件：

- 目标机用户名：`admin`
- 目标机有 `D:` 盘
- 程序路径：`<LOCAL_TOOLS>\tools\DeepSeekHarness`
- 用户数据路径：`<USER_HOME>\.dsh`

---

## 2. 源机准备

1. 关闭 QQ 机器人：

```bat
<DSMP_BRIDGE_DIR>\stop-bot.cmd
```

2. 完全退出 DSH 桌面端。
3. 确认没有 `DeepSeek Harness.exe`、`node.exe` 仍在写 `.dsh`。
4. 复制以下内容到移动硬盘或目标机：

```text
<LOCAL_TOOLS>\tools\DeepSeekHarness
<USER_HOME>\.dsh
<DSMP_BRIDGE_DIR>
<DSH_WORKSPACE>
```

复制建议使用 7-Zip 的符号链接模式，或：

```bat
robocopy "源" "目标" /E /COPYALL /SL /R:1 /W:1
```

不要直接用资源管理器拖拽，原因：

- `<USER_HOME>\.dsh\plugins` 里的 QQ 插件是 junction；
- `profiles\desktop\node_modules` 里有 2 个 junction；
- 直接拖拽可能把链接复制成普通目录。

---

## 3. 目标机恢复

1. 放回程序目录：

```text
<LOCAL_TOOLS>\tools\DeepSeekHarness
```

2. 放回用户数据：

```text
<USER_HOME>\.dsh
```

3. 放回 QQ 机器人项目（如果也要迁机器人）：

```text
<DSMP_BRIDGE_DIR>
```

4. 放回工作区：

```text
<DSH_WORKSPACE>
```

5. 如果 junction 丢失，用管理员 CMD 重建：

```bat
mklink /J "<USER_HOME>\.dsh\plugins\qq-agent-presets" "<DSMP_BRIDGE_DIR>\plugins\qq-agent-presets"
mklink /J "<USER_HOME>\.dsh\plugins\qq-mode-console" "<DSMP_BRIDGE_DIR>\plugins\qq-mode-console"
mklink /J "<USER_HOME>\.dsh\profiles\desktop\node_modules\qq-agent-presets" "<USER_HOME>\.dsh\plugins\qq-agent-presets"
mklink /J "<USER_HOME>\.dsh\profiles\desktop\node_modules\qq-mode-console" "<USER_HOME>\.dsh\plugins\qq-mode-console"
```

6. 双击：

```text
<LOCAL_TOOLS>\tools\DeepSeekHarness\DeepSeek Harness.exe
```

7. 首次启动检查：
   - 版本 `0.2.1-rc.2`
   - profile 为 `desktop`
   - 模型服务商与 API Key 可用
   - 会话历史可见
   - 预设/MCP 工具完整
   - 记忆读写正常

---

## 4. 可能的登录问题

`.dsh\.credentials.yaml` 是登录凭证。复制后如果目标机的 Windows 用户 SID 不同，可能无法解密，DSH 会要求重新登录或重新填写 API Key。

这是“无感迁移”唯一的现实边界：**重新登录一次即可**，其他配置不需要重做。

---

## 5. 用户名或盘符不同的处理

如果目标机不是 `admin`，或没有 `D:`，不建议硬拷，需要路径适配：

1. 尽量创建 `D:` 分区，保持工作区路径。
2. 修改：

```text
<USER_HOME>\.dsh\profiles\desktop\package.json
```

把 `<USER_HOME>/...` 替换为目标用户路径。
3. 重建上面的 4 个 junction。
4. `.dsh\memories` 中的历史文本路径不影响启动，可按需替换。
5. `sessions` 目录名按工作区路径生成；工作区路径改变可能导致旧会话显示不出来，所以工作区路径尽量保持不变。

结论：**最稳的是目标机创建 `admin` 本地用户并保留 D 盘。**

---

## 6. QQ 机器人是否一起迁

### 只迁 DSH

复制：

- DSH 程序
- `.dsh`
- `<DSH_WORKSPACE>`

QQ 机器人留在旧电脑。

### 连 QQ 机器人一起迁

还需要：

- `<DSMP_BRIDGE_DIR>`
- `<LOCAL_TOOLS>\SnowLuma`
- 可选 A绘世/GPT-SoVITS 及其模型

QQ 部分不能完全无感：需要在新电脑登录小号 `<BOT_QQ>`，SnowLuma 手动注入，确认 OneBot 3000/3001 和桥接 3100。

---

## 7. 迁移后验证清单

- [ ] DSH 正常启动，版本 `0.2.1-rc.2`
- [ ] profile 为 `desktop`
- [ ] 模型服务商/API Key 可用
- [ ] 原会话历史可见
- [ ] 预设/MCP 工具列表完整
- [ ] 记忆读写正常
- [ ] 文件工具能打开原工作区
- [ ] 如迁 QQ：3100/5099/3000/3001 正常

---

## 8. 执行前待确认

1. 目标机用户名是否也是 `admin`？
2. 目标机有没有 `D:` 盘？
3. 只迁 DSH，还是连 QQ 机器人/SnowLuma 一起迁？
4. 是否有移动硬盘或局域网传输条件？

确认后再生成迁移包和 `restore.ps1`；当前不执行任何迁移操作。
