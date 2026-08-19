# AGENTS.md — dsh-niulai-pet

> 桌宠插件的完整维护手册。用户面介绍看 README.md；本文件写给改代码的人/agent。
> 未来规划（自定义皮肤、语音控制）与 STT 选型调研见 `docs/roadmap.md`。

## 是什么

dsh（DeepSeek Harness）web 的**客户端插件**：右下角 fixed 浮层桌宠，5 个皮肤，
订阅 sessions 服务在 agent 任务完成时庆祝（喊声+气泡+动作）。全部能力在
client 半（`lib/client.js`）；host 半 `index.js` 是空插件，`dsh.bundle`
manifest + `cordis.patch.yml` 仅为官方 CLI 安装识别（awesome 收录硬性要求）。
**若早期经 pnpm file + market client-only shim 装过，需用官方 CLI 重装一次**
（`dsh plugin --profile web add file:...`）让它进 bundles 层栈。

## 构建与调试

```sh
npm run build      # esbuild → lib/client.js（素材 dataurl 内联）
npm run typecheck  # tsc --noEmit
```

- 安装调试：`cd ~/.dsh/profiles/web && pnpm add file:<本仓库路径>`，首次重启一次
  dsh web；之后 `build + 刷新页面`即可。
- 验证钩子：页面 URL 加 `?petdebug=1` → `window.__niulai`（PetHandle）。
- playwright 可用，从绝对路径 import：
  `/home/tenbox/Desktop/Devspace/cenacle/web/node_modules/playwright/index.mjs`。
  dsh web 直连 `http://127.0.0.1:3080/`。**别用 `waitUntil:'networkidle'`**
  （ws 长连接永不 idle），用 `domcontentloaded` + 固定等待。
- 冒烟脚本范式在 /tmp/niulai/smoke*.mjs（临时目录，不保证还在）：
  按 `z-index=99999` 找桌宠 root，菜单是 `min-width:170px` 的子 div。

## 架构

```
src/client/index.ts  入口：素材 import、SKINS 皮肤注册表、sessions 订阅（含忙闲沿）
src/client/pet.ts    桌宠本体：DOM + 状态机 + 动画 + 菜单 + 叫声
```

**SkinDef（index.ts）**：`{ id, name, image, imageBlink?, imageShout?, imageFly?,
imageFlyShout?, imageSpout?, voice, sounds?, signature, shoutBubble, quips? }`。
加新皮肤 = 加素材 + 注册一条，零改 pet.ts。

**pet.ts 状态机**：`mood ∈ idle/walk/drag/celebrate/sleep/fly`。
行为循环只在 `idle` 触发；动作派发 `runAction(name)` 解析
`signature→当前皮肤签名`、`random→ACTION_POOL 现场抽`。

**持久化**（localStorage `dsh-niulai-pet:state-v1`）：
`x / muted / shoutOnDone / talkative / skin / doneAction / pokeAction / shoutCount`。

## 动画的三条铁律（都踩过坑）

1. **WAAPI 的 pause 不等于移除**：暂停的 breathe 动画仍然压着 `img.style.transform`
   （WAAPI 在级联里压内联样式）。凡是写内联 transform 的（flight 旋转、roll、
   拖拽倾斜），必须 `breathe.cancel()`，完事 `breathe.play()` 重启。
   用 `img.animate` 的（hop/dance/spin/sway）后启动者天然覆盖，pause 即可。
2. **镜像父级内的 rotate 不要乘方向 dir**：root 有 `scaleX(facing)`，镜像会把
   精灵图和旋转一起翻转，两个方向自洽。乘了 dir 会底朝天（v5 实测）。
3. **协程收尾不得无条件重置 mood**：walkTo/sleepFor 尾部只在自己仍是
   `walk`/`sleep` 时才置回 `idle`，否则会把并发启动的 fly 绞杀在半路。

## 嘴型与叫声

- 嘴型时间线（mouthShout）：开 240ms → 合 120ms → 开并保持到音频结束
  （「妈~~」尾音是开口音，全程打机关枪是错的）。时长来自挂载时预读的
  mp3 metadata（soundDur map），不是写死的。
- 飞行中喊叫用 `imageFlyShout`（飞行张嘴帧）；没有张嘴图的皮肤跳过嘴型。
- 连喊（shoutCount 1-3）：chain 递归，一声放完接下声（mouthShout 的 onDone）。
- 合成叫声（moo/whale/squeak）是 WebAudio 实时合成，参数在 pet.ts 顶部
  `synth*` 函数；AudioContext 在首次 pointerdown 暖场（自动播放策略）。

## 素材管线（tools/）

assets/ 与 lib/ 均入库。
重建/修改素材的脚本全在 tools/：

- `tools/cutout/`（牛来/小黄系，PIL+numpy，路径内的 /tmp/niulai 需自备源帧）：
  cutout2.py（源帧抠图，犄角暗色阈值）→ repair_hooves.py（腿部重建+蹄冠：
  微梯形+分趾缝+渐变+微外八）→ make_shout.py（张嘴：口腔+舌头+高光）、
  make_young.py（去角+抛物线削顶+HSV 黄亮调色）、make_blink.py（闭眼帧）、
  cutout_fly.py（-70° 旋转出飞行图）。pitch.py 是音频基频分析（鉴别变调段）。
  **顺序敏感**：pet.png 是链根，改它必须重跑全部派生。
- `tools/drawn/`（奶牛/熊猫/鲸鱼，原创 SVG）：`node render.mjs x.svg out.png W H`
  渲染 + `python3 post.py` 预乘 alpha 降采样去白边；*.snip 是 blink/spout
  变体补丁；whale 参考图抓取 grab_ref.mjs。
- 喊声降噪链（F 档，从原始 cut 重新生成）：
  `ffmpeg -i in.mp3 -af "highpass=f=280,highpass=f=280,afftdn=nr=22:nf=-32,lowpass=f=6200,volume=5dB" out.mp3`
  背景音焊死在音轨里，更强会出"水下音"，F/G 档已对比选定 F。

## 演示视频制作（带声）

系统 PulseAudio monitor 抓取在本机实测**拿不到数据**（record 流 0 字节，
挂起疑与管道/PipeWire 有关，未解），所以走后期配音：

1. Xvfb 虚拟屏：`Xvfb :99 -screen 0 1920x1080x24`
2. ffmpeg 纯画面：`x11grab -i :99 -c:v libx264 -preset ultrafast`（先保流畅）
3. playwright headed（`env DISPLAY=:99`）跑编排，**每次开喊记 `Date.now()`**
4. 后期对齐混音：`adelay=ms|ms` 每声一条 + `amix=normalize=0` + `apad/atrim`，
   再 `-preset slow -crf 20` 精编码。成品：Workspace/niulai-pet-demo.mp4。

## 其它坑

- 菜单行点击曾被 root 的 `setPointerCapture` 截胡成 poke——root 的 pointerdown
  对 menu/about 区域直接 return。
- `ctx.effect(fn)` 立即执行；清理函数要 `() => () => cleanup()`。
- body 直挂节点会被 dsh 首屏 React 清掉：MutationObserver 守灵重挂。
- 气泡/菜单文字在 `scaleX` 根下会镜像：用 `scaleX(var(--face))` 抵消，
  flight 改朝向时记得同步 `--face`。
- 候选音频段有加速变调（音调升高失真），用基频甄别（pitch.py：800-889Hz
  为正常奶声，516-552Hz 为变调段，已弃用）。
