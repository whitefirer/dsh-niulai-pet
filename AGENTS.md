# AGENTS.md — dsh-niulai-pet

> 桌宠插件的完整维护手册。用户面介绍看 README.md；本文件写给改代码的人/agent。
> 未来规划（自定义皮肤、语音控制、设置卡片、图片识别协同）与 STT 选型调研见 `docs/roadmap.md`。

## 是什么

dsh（DeepSeek Harness）web 的桌宠插件：右下角 fixed 浮层，6 个皮肤，
订阅 sessions 服务在 agent 任务完成时庆祝（喊声+气泡+动作）。
- **client 半**（`lib/client.js`）：桌宠本体 + 设置卡片（dsh rc.7+ 设置页
  「插件配置」区，React 组件，react 由宿主模块表提供、构建时 external）。
- **host 半**（`index.js`）：仅注册 settings 命名空间 `niulai-pet`
  （`installSettingsSection`，schemastery schema）——这是设置卡片的配对键，
  持久化由 dsh host 白拿（`~/.dsh/settings.yaml`）。rc.6 无 settings 服务时
  installSettingsSection 内部 inject 永远等不到，静默跳过。
`dsh.bundle` manifest + `cordis.patch.yml` 同时满足官方 CLI 安装识别
（awesome 收录硬性要求）。**若早期经 pnpm file + market client-only shim
装过，需用官方 CLI 重装一次**（`dsh plugin --profile web add file:...`）
让它进 bundles 层栈。

## 构建与调试

```sh
npm run build      # esbuild → lib/client.js + demo/niulai-standalone.js（素材 dataurl 内联）
npm run typecheck  # tsc --noEmit
```

- **standalone 试玩页**：`demo/index.html` + `niulai-standalone.js`（同一套 pet.ts +
  SKINS，sessions 订阅换成 `src/client/demo.ts` 的模拟任务卡片）。本地直接
  浏览器打开 `demo/index.html` 即可玩；线上部署 = 把 demo/ 两文件拷到任意静态目录
  （当前挂在博客 `static/niulai-pet/` → whitefirer.org/niulai-pet/）。
- 安装调试：`cd ~/.dsh/profiles/web && pnpm add file:<本仓库路径>`，首次重启一次
  dsh web；之后 `build + 刷新页面`即可（lib/client.js 与注入副本是同一 inode
  硬链，esbuild 原地写自动同步）。**注意 pnpm file: 注入缓存**：改了
  `index.js` / `cordis.patch.yml` / `package.json`（非构建产物）pnpm 不会重同步
  （2026-08-21 踩过：注入目录残留 0.1.0 的 package.json），要手动
  `cp index.js cordis.patch.yml package.json ~/.dsh/profiles/web/node_modules/dsh-niulai-pet/`
  再重启 dsh web（host 半改动必须重启才加载）。新 dependencies 由 pnpm 正常解析
  进 profile 顶层 node_modules，无需手动管。
- 验证钩子：页面 URL 加 `?petdebug=1` → `window.__niulai`（PetHandle）。
- playwright 可用，从绝对路径 import：
  `/home/tenbox/Desktop/Devspace/cenacle/web/node_modules/playwright/index.mjs`。
  dsh web 直连 `http://127.0.0.1:3080/`。**别用 `waitUntil:'networkidle'`**
  （ws 长连接永不 idle），用 `domcontentloaded` + 固定等待。
- 冒烟脚本范式在 /tmp/niulai/smoke*.mjs（临时目录，不保证还在）：
  按 `z-index=99999` 找桌宠 root，菜单是 `min-width:170px` 的子 div。

## 发布

推 `v*` tag 触发 GitHub Action 自动发 npm（`.github/workflows/publish.yml`，
secret `NPM_TOKEN`）：先改 package.json 版本号并合入主干，再打同号 tag——
workflow 会校验 tag 与版本号一致，不符直接失败。手动兜底：本机 `npm publish`
（`publishConfig` 已钉官方源，provenance 只有 CI 路径有）。

## 架构

```
src/client/index.ts   入口：ConfigStore 创建、sessions 订阅（含忙闲沿）、卡片子 fiber
src/client/skins.ts   SKINS 皮肤注册表（导出）+ 素材 import；独立成模块让 demo 不带 react
src/client/pet.ts     桌宠本体：DOM + 状态机 + 动画 + 菜单 + 叫声
src/client/config.ts  ConfigStore：localStorage / settings scope 双后端 + 旧版迁移
src/client/card.tsx   设置卡片：React 组件 + CardController + registerSettingsCard
src/client/demo.ts    standalone 试玩页入口：复用 SKINS + mountPet，模拟任务驱动庆祝
```

**SkinDef（pet.ts）**：`{ id, name, image, imageBlink?, imageShout?, shoutAnim?, imageFly?,
imageFlyShout?, imageSpout?, voice, sounds?, signature, shoutBubble, quips? }`。
`shoutAnim` = 喊叫帧序列（`{src, at, rock?}[]`，at 为占喊声全长比例）——配了它喊叫
不走「开-合-开」嘴型，改按时间线逐帧演出（奶龙 23 帧：站笑抖肚→抱头弯腰→仰头→
倒地蹬腿）。帧尺寸按「统一物理缩放」换算（帧高/序列最高帧 × PET_H，倒地不再巨大），
宽帧以站立帧中心锚定并钳进视口；演出期间移动类动作让位（animTakesOver，静音兜底
才跑 done/poke 绑定动作）。注意 `img.style.height` 只能设具体 px，置 `''` 会清掉
内联高度让图按自然尺寸炸开（踩过）。加新皮肤 = 加素材 + skins.ts
注册一条 + host 半 index.js 的 SKIN_IDS 同步加 id，零改 pet.ts。

**语音停喊双引擎**（voice.ts + kws.ts）：`voiceEngine` 配置二选一。
（演进/数据/复跑脚本单一来源 = `docs/voice-stop-engine.md`，改动同步它。）
template=本文件的 MFCC+DTW（零下载）；kws=sherpa-onnx zipformer
（wenetspeech-3.3M int8）wasm，判别力远超模板。**kws 跑在 Web Worker**
（kws/kws-worker.js，postMessage 协议见文件头：init/open/feed/hit/close，
stream id 多路复用，卡片测试与正式监听共存）——wasm 线性内存
（INITIAL_MEMORY=32MB——实测高水位：16MB 不够、32MB 全程不涨；ALLOW_MEMORY_GROWTH 兜底）只涨不缩，
`worker.terminate()` 是唯一可证明的物理释放：kws.ts 引用计数归零且空闲
10s 即 terminate，下次监听重建（wasm/HTTP 缓存秒级），推理顺带离主线程。
wasm/模型不在 bundle 里——随 npm 包的
`kws/` 目录分发，**host 半 index.js 注册了 `/niulai-kws/<file>` 前缀路由**
（`ctx.inject(['webServer'])` + 白名单五文件，dsh 只伺服 client.js 其余
得自己开路由），client 半 `Module.locateFile` 指过去（`?v=__NIULAI_VERSION__`
破缓存）。kws 装载失败 voice.ts 自动回落 template。注意：**kws/ 目录也要
手动同步**进 profile（同 index.js 的 pnpm file: 缓存坑）：
`mkdir -p .../dsh-niulai-pet/kws && cp -l kws/* .../dsh-niulai-pet/kws/`。
指令词 = `KWS_KEYWORD_PRESETS` 预设表（id/label/音素变体行，变体 @词+字母、
显示按 label 前缀归并）；**加新词 = 表里加一条 + 跑交叉验证**
（/tmp/niulai-stt/kws-multi-test.js：四词共存零串词、负样本零误报；
重口音/超速漏检是已知限制，声调/鼻音变体猜修无效别堆）。
thr 0.1/score 1.5 与 wasm 构建+冒烟见
`/home/tenbox/wasm-build/BUILD-NOTES.md`；同源 e2e 复跑：
`node /home/tenbox/resize-diag/kws-e2e-worker.js`（worker 协议全链路）。
已知限制：「你又来」近音会误触发；INITIAL_MEMORY=512MB，低端移动浏览器
可能实例化失败（回落模板兜底）。

**pet.ts 状态机**：`mood ∈ idle/walk/drag/celebrate/sleep/fly`。
行为循环只在 `idle` 触发；动作派发 `runAction(name)` 解析
`signature→当前皮肤签名`、`random→ACTION_POOL 现场抽`。
**喊声是独立状态**：`shouting` 旗标（mouthShout 置位/复归）——sleep、眨眼等
idle 行为必须查它让位（喊声不改 mood，只查 mood 会演出"边喊边趴下变暗"）。

**持久化**（ConfigStore，config.ts）：行为键 muted/shoutOnDone/shoutCount/
talkative/skin 全局通用；动作绑定按皮肤记（`actions: { [skinId]: {done,poke} }`，
缺配回落 done=签名/poke=连跳）。dsh rc.7+ 走 settings scope（Host 持久化，
scope.set 乐观回显 pending 层）；更老版本回退 localStorage
（`dsh-niulai-pet:state-v1`）。位置 `x` 按设备永远留 localStorage，pet.ts 直读直写。
旧文档迁移：全局 doneAction/pokeAction 一次性改写为全皮肤 actions，
`classic` 皮肤 id 改写为默认皮肤。

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
- `tools/cutout/cutout_orig_db.py` + `variants_orig_db.py`（牛来原皮系，独立短链）：
  源是 AI 生图三视图（正面全身白底，用户提供）——近白阈值抠图 +
  腿部以下阴影区规则（防蹄底搭桥封腿缝）+ 腿缝泛洪清除（全填孔保嘴套高光），
  派生张嘴/眨眼。无角是设定：牛来幼时无角，勿当缺陷修掉。
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

- **设置卡片配对**：host 半 `installSettingsSection(ctx, NS, …)` 注册的命名空间
  与浏览器半 `settings.plugin.item` 的 `key` 以字符串配对（都是 `niulai-pet`），
  设置页自动配对渲染；被 serve 却无人认领的命名空间不渲染，反之亦然。
  dsh vendored cordis **没有** `{required:false}` 可选注入语法——可选 = 顶层
  `inject` 保持空，apply 内 `ctx.inject([...], cb)` 子 fiber 等服务
  （settingsScope/slots/locale/connection/remote 缺一即永不激活，rc.6 静默无卡片）。
  卡片控件即时写（离散控件不套官方 CardForm 的 staged/save）；读侧是
  ConfigStore 的 subscribe，uSES 要求 getSnapshot 稳定引用（不变时同一对象）。
- 菜单行点击曾被 root 的 `setPointerCapture` 截胡成 poke——root 的 pointerdown
  对 menu/about 区域直接 return。
- `ctx.effect(fn)` 立即执行；清理函数要 `() => () => cleanup()`。
- body 直挂节点会被 dsh 首屏 React 清掉：MutationObserver 守灵重挂。
- 气泡/菜单文字在 `scaleX` 根下会镜像：用 `scaleX(var(--face))` 抵消，
  flight 改朝向时记得同步 `--face`。
- 候选音频段有加速变调（音调升高失真），用基频甄别（pitch.py：800-889Hz
  为正常奶声，516-552Hz 为变调段，已弃用）。
