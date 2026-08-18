# dsh-niulai-pet

牛来桌宠 —— dsh web 界面角落里养一头《牛来》的小牛。平时呼吸、眨眼、踱步、打盹；
agent 任务一完成，它就蹦出来喊一声「妈~~妈~~」。

纯客户端插件（只有 `dsh.client` 没有 `dsh.bundle`）：安装经 dsh-market 的
client-only shim 挂载，**刷新页面即生效，更新免重启**。

## 行为

| 交互 | 反应 |
|---|---|
| 待着不动 | 呼吸浮动；随机小跳 / 踱步 / 趴下打盹 / 扭身子 |
| 点击 | 向上蹦一下 + 喊「妈~~妈~~」（多段音频随机） |
| 拖拽 | 拎着走，松手落地回弹；位置记忆（localStorage） |
| 右键 | 小菜单：静音开关、手动喊一声 |
| 任务完成 | 连蹦三下 + 「妈~~妈~~」气泡 + 喊声（6 秒节流） |

任务完成信号来自 client runtime 的 `sessions.list` 快照订阅：
`running true→false`（当前会话跑完）或 `completed` 新置位（后台会话完成，
即侧边栏绿点的同一信号）。宿主太旧没有 sessions 服务时降级为仅手动交互。

## 素材说明

`assets/` 目录（`pet.png` + `mama1..4.mp3`）**随库发布**。
想换形象请覆盖 `assets/` 后：

```sh
npm run build   # 素材以 dataurl 内联进 lib/client.js
# 刷新 dsh web 页面即生效（无需重启宿主）
```

素材经精修，
自用分享无妨。

## 开发

```sh
npm install
npm run build      # 产物 lib/client.js（CJS 闭包 + __ModuleLoader__ 包装）
npm run typecheck
```

装进 profile 调试：

```sh
cd ~/.dsh/profiles/web && pnpm add file:/path/to/dsh-niulai-pet
# 首次安装重启一次 dsh web（市场 shim 在宿主启动时挂载）；之后改代码只需
# npm run build + 刷新页面
```

## 实现要点（给后来的维护者）

- `ctx.effect` 的回调是**立即执行**的，清理函数要再包一层返回
  （`ctx.effect(() => () => cleanup())`）——写错会在 apply 时直接把桌宠销毁。
- dsh 首屏 React 挂载会置换 `document.body` 的直挂节点：插件用
  MutationObserver 守灵，被清就自动重挂。
- 朝向翻转放在根节点 `scaleX`，气泡/菜单用 `scaleX(var(--face))` 抵消，
  否则文字会镜像。
