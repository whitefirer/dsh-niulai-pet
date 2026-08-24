# 自定义角色包制作指南 — dsh-niulai-pet

> 给人和 AI 助手都看的一份文档。AI 助手请注意：本指南自足（self-contained），
> 照做即可产出一个可导入的角色包；更底层的规范见 `docs/skin-pack-schema.md`。

一个**角色包**就是一个 zip 文件：一张清单 `pack.json` + 若干图片/声音素材。
在 dsh 设置 → 插件配置 → 牛来桌宠 → 自定义角色 → 导入角色包，选这个 zip 即用。

## 1. 包结构

```
my-pet.nlpack.zip          # 普通 zip，建议后缀 .nlpack.zip
├── pack.json              # 必填，角色清单
├── assets/                # 角色级共享素材（声音）
│   └── shout.mp3
└── skins/                 # 皮肤素材（按皮肤 id 分目录）
    └── default/
        ├── stand.png      # 必填，站立图（透明底）
        ├── blink.png      # 可选，眨眼
        └── shout.png      # 可选，张嘴
```

## 2. 最小可用 pack.json

```json
{
  "spec": 1,
  "type": "character",
  "id": "my-pet",
  "name": "我的宠物",
  "version": "1.0.0",
  "voice": { "type": "samples", "samples": ["assets/shout.mp3"] },
  "skins": [
    { "id": "default", "name": "标准", "images": { "stand": "skins/default/stand.png" } }
  ]
}
```

只要 **1 张透明底 png + 1 个 mp3** 就是一个活的角色（喊叫时物理变形生效）。

## 3. 字段参考

### 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `spec` | 是 | 固定 `1` |
| `type` | 是 | `character` 完整角色；`variant` 派生覆盖包（见 §6） |
| `id` | 是 | 角色 id，2~32 位小写字母/数字/连字符，全局唯一 |
| `name` | 是 | 显示名 |
| `version` | 是 | 如 `"1.0.0"` |
| `author` / `description` | 否 | 展示用 |
| `voice` | 是 | 见下 |
| `events` | 否 | `{ "done": "signature", "poke": "hops" }`，事件默认动作绑定 |
| `quips` | 否 | 唠叨语录数组（角色级，与皮肤级合并） |
| `skins` | 是 | 皮肤数组，≥1 个 |

### voice

- `{ "type": "samples", "samples": ["a.mp3", "b.mp3"], "reply": "r.mp3" }`
  - `samples`：完成/喊叫音，≥1 个，多个随机播放
  - `reply`：可选，语音停喊成功后的回应音
- `{ "type": "synth", "preset": "moo" }`：内置合成音色，仅限 `moo`/`squeak`/`whale`

### skins[] 每项

| 字段 | 说明 |
|---|---|
| `id` | 皮肤 id（包内唯一，1~32 位小写字母/数字/连字符） |
| `name` | 显示名；角色有多个皮肤时选择器显示「角色名·皮肤名」 |
| `default` | `true` 标默认皮肤（最多一个，缺省取第一个） |
| `images.stand` | **必填**，站立图（透明底 png/webp） |
| `images.blink` | 眨眼图（同尺寸，闭眼版） |
| `images.shout` | 张嘴图（喊叫嘴型；与 shoutAnim 二选一） |
| `images.fly` / `flyShout` | fly 动作图 / 飞行张嘴图 |
| `images.spout` | breach 跃出水面弧顶特效图 |
| `shoutAnim` | 喊叫演出帧：`[{"src":"anim.webp","at":0}]`；at 为 0~1 升序，`rock:true` 附加倒地摇摆。**推荐单个动画 webp**（at:0 一帧到底，原生播放最平滑） |
| `signature` | 签名动作（不能是 signature/random） |
| `shoutBubble` | 喊叫气泡文案 |
| `quips` | 皮肤级语录 |
| `jelly` | `true` 果冻体质：落地多段阻尼弹跳（替代单次压扁）+ 走路身体挤压摆动，适合史莱姆类软体角色 |
| `size` | 默认显示高度 px（72~200 整数；选用该皮肤时大小落到它，用户另行调整优先，缺省 120） |
| `opacity` | 默认不透明度 %（20~100 整数；选用该皮肤时透明度落到它，用户另行调整优先，缺省 100） |
| `hue` | 默认色相旋转 °（0~360 整数；选用该皮肤时色相落到它，用户另行调整优先，缺省 0=原色） |

### 可绑定动作（闭集）

`fly` 飞行 · `dance` 摇摆舞 · `spin` 转圈 · `hops` 连跳 · `roll` 翻滚 ·
`breach` 跃出水面 · `sway` 奶牛摇 · `split` 分裂（主图隐身，2~3 个小号克隆散开乱跳再聚拢合体，软体角色绝配） · `random` 随机 · `signature` 签名动作占位

## 4. 素材规格

- **图片**：png（透明底）或 webp；高度建议 300~600px；单张软上限 2MB
- **声音**：mp3；时长 1~5s 最佳
- **整包**：软上限 8MB
- stand/blink/shout 必须**同尺寸同站位**，否则切换瞬间会跳

### AI 生成素材的提示词参考

- 三视图/立绘：「<角色描述>，正面站立全身像，纯色（白或绿幕）背景，无阴影，卡通渲染，干净边缘」
- **逐帧连续动作条（一图多帧，强烈推荐）**：「以这张图为角色（图生图），保持同一角色、
  同一画风、同一比例，白色背景，生成逐帧连续动作 N 张横向排列：从 <起始姿态> 到
  <目标姿态>，动作连贯分解，每张全身完整、不被裁切」——N 取 4~8；生成后按列切分
  （**动作会越出等分列界，切分时向邻列留重叠窗口**，再按最大连通域取本体），
  逐帧去底后用 `shoutAnim` 时间轴串帧。参考：内置小奶龙就是这条路
  （豆包一图 4 帧「指自己张嘴喊」→ 切帧 → `at: 0/0.15/0.34/0.75`，帧文件见 `assets/xiaonailong/`）。
  最小可导入样例包见 `docs/assets/robot.nlpack.zip`（单帧 + 一声，可直接拖入试玩页验证流程）
- 透明底：生成后用抠图工具去底（rembg / PIL 按背景色连通域，参考本仓库 `tools/cutout/`）
- 单帧微调（张嘴/眨眼）：优先让生图模型出变体（「同一角色，同姿势，张嘴大喊」），
  比手工 P 图自然；手工兜底见 `tools/cutout/make_shout.py`、`make_blink.py`
- 声音：TTS（edge-tts 等）或视频切片提取（yt-dlp + ffmpeg），去背景音
- 动画 webp：视频切片抽帧 → 逐帧去底 → `img2webp -loop 0 -d 100` 合成（参考奶龙管线）

## 5. 打包与导入

```bash
cd my-pack-dir && zip -r ../my-pet.nlpack.zip . -x '.*'
```

导入：dsh 设置 → 插件配置 → 牛来桌宠 → 自定义角色 → **导入角色包**。
校验错误会精确到字段（如 `skins.0.images.stand: 文件 ... 不存在`），照改即可；
警告（未引用文件、动作缺配套图等）可确认后继续。

## 6. 派生包（改内置/已有角色）

```json
{
  "spec": 1, "type": "variant", "extends": "niulai",
  "id": "niulai-xmas", "name": "圣诞牛来", "version": "1.0.0",
  "skins": [{ "id": "default", "images": { "stand": "skins/default/xmas.png" } }]
}
```

写了的字段覆盖，没写的继承；同 id 皮肤深合并，新 id 皮肤追加。删除派生包即还原。
注意：派生包的 `voice` 目前按完整声明处理（v1 限制，想继承原声音就把原声明抄上）。

## 7. 给 AI 助手的执行要点

1. 读完本指南后先问清：角色名、外观、声音文案、想要的动作
2. 素材逐张给用户过目再进包
3. 打包前按 §3 表格自检必填字段与路径引用
4. 产出 zip 后告诉用户导入路径（设置 → 插件配置 → 牛来桌宠 → 自定义角色）
5. 用户导入若报错，把错误原文当字段级修复指引处理
