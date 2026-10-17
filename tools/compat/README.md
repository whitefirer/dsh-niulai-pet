# dsh-niulai-pet 兼容性自检（本机）

检测本机 DeepSeek Harness 的 dsh 版本，**版本变化时**在临时 `DSH_HOME` 里建一个
scratch web profile，把当前仓库作为插件装进去，用 `dsh --dump-config-schema`
让 dsh 真实 import 插件 host 半并投影 Config，最后把结果写成报告并弹通知。

不碰你真实的 desktop profile，也不联网（依赖走本机 pnpm store；首次可能从镜像拉）。

## 用法

```powershell
# 手动跑一次（dsh 版本没变也会强制跑）
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\compat\check.ps1 -Force

# 只在该 dsh 版本没检查过（或上次失败）时跑
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\compat\check.ps1

# 注册计划任务：每天 12:00（当前用户，不需要管理员）
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\compat\check.ps1 -InstallTask
```

`-InstallTask` 会建两个：
- `dsh-niulai-compat`：每天 12:00，覆盖应用一直开着、中途自动更新的情况；
- `dsh-niulai-compat-logon`：登录时检查一次。**这个需要管理员权限**，非管理员
  下会跳过并打印手动命令；只想要每日任务可以忽略。

任务里 dsh 版本没变时脚本会秒退，不会重复跑完整检查。

报告与状态在 `%LOCALAPPDATA%\dsh-niulai-compat\`：

```
state.json                 # 上次检查的 dsh 版本/结果
reports\latest.md          # 最近一次报告
reports\compat-<时间>-<版本>.md
reports\compat-<时间>-<版本>.log
```

## 检查什么

- 插件 entry 是否出现在 `x-cordis.entries`（host 半 import 成功）
- entry `status` 是否为 `schema` / `partial`（error/unsupported 即失败）
- 指向该 entry 的 `level: error` 诊断（例如 `installSettingsSection` 没了、
  `.optional()` 之类模块级异常）
- Config schema 是否还能解析出核心字段（muted / skin / walkEnabled / extraPets /
  voiceEngine / micGain）

注意 `--dump-config-schema` 对不同 Node/loader 版本的退出码可能是 1，而且整棵
profile 里其它 bundle 也会产生诊断；脚本只看 `dsh-niulai-pet` 这条 entry 的
path，不拿退出码当结论。

## 跨平台（Linux / macOS / CI）

同一套检查有一个 Node 版 `tools/compat/check.mjs`，不依赖 PowerShell：

```sh
node tools/compat/check.mjs --report /tmp/compat.md
# 指定 CLI / 仓库 / 保留临时目录
node tools/compat/check.mjs --dsh /path/to/dsh --repo /path/to/repo --keep
```

Linux 用 cron、macOS 用 launchd，把这条命令写成定时任务即可；通知各自接
`notify-send` / `osascript`。

## GitHub Actions

`.github/workflows/compat.yml`：

- 每天 03:00 UTC（北京时间 11:00）检查 npm 上的 `@deepseek-ai/dsh@latest`；
- `workflow_dispatch` 可手动指定 `dsh_version`；
- push 到 master 且改动 `index.js` / `lib/client.js` / `src/client/**` /
  `tools/compat/**` 时也跑；
- job matrix：`ubuntu-latest` + `macos-latest`；
- 失败自动开/追加 issue `[compat] dsh 兼容检查失败`，恢复后自动关闭；
- 报告作为 artifact 上传（`compat-report-<os>`），含 `.md` 和 `.log`。

## 局限

- 只覆盖 **host 半 import + Config**。client 半的 slot/服务改名（比如
  `settings.plugin.item` → `settings.plugins.tab`）需要真实浏览器冒烟，属于下一层
  Playwright 检查，尚未包含。
- 本机计划任务检查的是“本机安装的这份 dsh”；npm 上发布的新版本由
  `compat.yml` 覆盖，两者可能滞后/超前。
- 本机计划任务用的是当前用户，电脑没开机/没登录时不会跑；mac/Linux 本机定时
  任务没有内置，用 `check.mjs` + cron/launchd。
- 如果 `dsh plugin add` 本身失败（镜像/网络），报告会标成“环境/安装失败”，
  不是兼容性失败。
