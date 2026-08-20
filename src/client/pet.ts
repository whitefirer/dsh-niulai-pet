/**
 * 桌宠本体：fixed 浮层 + Web Animations 状态机 + 数据驱动皮肤系统。
 *
 * 皮肤（SkinDef）：牛来（抠图+真声，签名连跳）、小黄（转圈）、奶牛（翻滚）、
 * 熊猫（翻滚）、蓝鲸（跃出水面），各带叫声（mp3 或 WebAudio 合成）。
 *  - idle：呼吸 + 随机小跳/踱步/趴睡/扭一扭 + 眨眼，偶尔气泡唠叨
 *  - walk / drag / sleep / fly（含 dive/arc 两种航迹）
 *  - celebrate：任务完成 —— 叫声 + 气泡（受开关/静音约束）+ 事件绑定动作
 *  - 喊叫期间嘴部张合（有张嘴图的皮肤）；2.5~6s 随机眨眼（有闭眼图的皮肤）
 *
 * 交互：点击=戳（喊+绑定动作）；拖拽=换位（localStorage 记忆，按设备）；右键=菜单
 * （声音 / 完成时喊 / 气泡唠叨为胶囊开关；动作与皮肤为循环项；另有飞一圈 /
 * 只喊不跳的喊一声 / 关于面板）。
 * 动作可绑定到事件，「签名」= 跟随当前皮肤的招牌动作，「随机」= 现场抽；
 * 绑定按皮肤记（config.ts 的 ConfigStore：dsh rc.7+ 走 settings scope，
 * 更老版本回退 localStorage），切换皮肤不清空另一皮肤的绑定。
 */

import { ConfigStore, loadPersisted, savePersisted, type Persisted } from './config.js'
import { startVoiceStop, type VoiceStopHandle } from './voice.js'
import { REPLY_REF } from './skins.js'

/** 叫声：mama=牛来真声 mp3；其余为 WebAudio 合成；null=无声。 */
export type VoiceName = 'mama' | 'moo' | 'whale' | 'squeak' | null

/** 可绑定到事件的动作。signature=当前皮肤签名动作。 */
export type ActionName =
  | 'signature' | 'fly' | 'dance' | 'spin' | 'hops' | 'roll' | 'breach' | 'sway' | 'random'

export interface SkinDef {
  id: string
  /** 菜单显示名。 */
  name: string
  /** 站立图（dataurl）。 */
  image: string
  /** 闭眼图（眨眼用，可选）。 */
  imageBlink?: string
  /** 张嘴图（喊叫嘴部张合用，可选）。 */
  imageShout?: string
  /** 飞行/俯冲图（fly 动作用，缺省用站立图）。 */
  imageFly?: string
  /** 飞行张嘴图（飞行中喊叫用，可选）。 */
  imageFlyShout?: string
  /** 喷水图（鲸鱼 breach 弧顶喷水，可选）。 */
  imageSpout?: string
  voice: VoiceName
  /** voice=mama 时的喊声 mp3（dataurl）若干。 */
  sounds?: string[]
  /** 妈妈的回应「牛来！」mp3（dataurl，可选；仅牛来系皮肤有）。 */
  replySound?: string
  /** 签名动作。 */
  signature: ActionName
  /** 喊叫/戳戳气泡文案。 */
  shoutBubble: string
  /** 皮肤专属唠叨语录（与全局语录合并）。 */
  quips?: string[]
}

export interface PetAssets {
  skins: SkinDef[]
  defaultSkin: string
}

export interface PetHandle {
  /** 任务完成触发（带节流）。 */
  celebrate(): void
  /** 主动戳一下（喊+绑定动作）。 */
  poke(): void
  /** AI 会话忙闲：忙时传入开始时间戳，闲时传 null（用于耗时气泡）。 */
  setBusy(busy: { since: number; label: string } | null): void
  /** 静音开关（试玩页角标等宿主 UI 用；与宠物菜单的「声音」同源）。 */
  setMuted(m: boolean): void
  isMuted(): boolean
  destroy(): void
}

type Mood = 'idle' | 'walk' | 'drag' | 'celebrate' | 'sleep' | 'fly'

const BOTTOM = 18 // 距视口底 px
const PET_H = 120 // 显示高度 px

/** 随机池（具体动作）。 */
const ACTION_POOL: ActionName[] = ['fly', 'dance', 'spin', 'hops', 'roll', 'breach', 'sway']
/** 动作全序（菜单循环顺序、设置卡片下拉项；新增动作时同步 host 半 index.js 的 ACTION_IDS）。 */
export const ACTION_ORDER: ActionName[] = ['signature', ...ACTION_POOL, 'random']
const ACTION_LABEL: Record<ActionName, string> = {
  signature: '签名动作', fly: '飞行', dance: '摇摆舞', spin: '转圈', hops: '连跳',
  roll: '翻滚', breach: '跃出水面', sway: '奶牛摇', random: '随机',
}

/** 全局气泡唠叨语录（与皮肤专属语录合并抽取）。 */
const QUIPS = [
  '哞？',
  '今天也是个写 bug 的好日子',
  '别卷了，起来活动下',
  '我在吃草，你在吃苦',
  '需求又改了？',
  '这代码我看得都着急',
  '喝口水吧',
]

function asAction(v: unknown, fallback: ActionName): ActionName {
  return typeof v === 'string' && (ACTION_ORDER as string[]).includes(v) ? (v as ActionName) : fallback
}

/** 秒 → "1分23秒" / "45秒"。 */
function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}

// ---- WebAudio 合成叫声（零素材、程序合成）----
let actx: AudioContext | null = null
function audioCtx(): AudioContext | null {
  try {
    if (actx === null) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC === undefined) return null
      actx = new AC()
    }
    if (actx.state === 'suspended') void actx.resume()
    return actx
  } catch {
    return null
  }
}

/** 哞——：锯齿波下滑 + 低频震颤 + 低通。 */
function synthMoo(ctx: AudioContext): void {
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(150, t0)
  osc.frequency.exponentialRampToValueAtTime(92, t0 + 0.75)
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 5.5
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 9
  lfo.connect(lfoGain)
  lfoGain.connect(osc.frequency)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 460
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.09)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9)
  osc.connect(lp); lp.connect(g); g.connect(ctx.destination)
  osc.start(t0); lfo.start(t0)
  osc.stop(t0 + 0.95); lfo.stop(t0 + 0.95)
}

/** 鲸鸣：正弦长音先扬后抑 + 慢颤音。 */
function synthWhale(ctx: AudioContext): void {
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(210, t0)
  osc.frequency.exponentialRampToValueAtTime(430, t0 + 0.5)
  osc.frequency.exponentialRampToValueAtTime(120, t0 + 1.5)
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 3
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 22
  lfo.connect(lfoGain)
  lfoGain.connect(osc.frequency)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.25)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6)
  osc.connect(lp); lp.connect(g); g.connect(ctx.destination)
  osc.start(t0); lfo.start(t0)
  osc.stop(t0 + 1.65); lfo.stop(t0 + 1.65)
}

/** 熊猫吱声：两声短促三角波上挑。 */
function synthSqueak(ctx: AudioContext): void {
  const t0 = ctx.currentTime
  for (const off of [0, 0.22]) {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(950, t0 + off)
    osc.frequency.exponentialRampToValueAtTime(1500, t0 + off + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0 + off)
    g.gain.exponentialRampToValueAtTime(0.2, t0 + off + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.16)
    osc.connect(g); g.connect(ctx.destination)
    osc.start(t0 + off); osc.stop(t0 + off + 0.18)
  }
}

export function mountPet(assets: PetAssets, store?: ConfigStore): PetHandle {
  const skins = assets.skins.length > 0
    ? assets.skins
    : [{ id: 'fallback', name: '桌宠', image: '', voice: null, signature: 'hops' as ActionName, shoutBubble: '' }]
  const skinIds = skins.map((s) => s.id)
  // 行为配置统一走 ConfigStore（localStorage / dsh settings scope 双后端）；
  // 下方局部变量只是它的快照镜像，写一律经 config.set / config.setSkinAction
  const config = store ?? new ConfigStore({ skinIds, defaultSkin: assets.defaultSkin })
  /** 位置 x 的文档读写（按设备，永远 localStorage；行为键不归这里管）。 */
  const loadDoc = (): Persisted => loadPersisted(skinIds, assets.defaultSkin)
  const findSkin = (id: string | undefined): SkinDef =>
    skins.find((s) => s.id === id) ?? skins[0]
  const initCfg = config.getSnapshot()
  let skin: SkinDef = findSkin(initCfg.skin)
  let muted = initCfg.muted
  let shoutOnDone = initCfg.shoutOnDone
  let talkative = initCfg.talkative
  let shoutCount = initCfg.shoutCount
  let doneDelaySec = initCfg.doneDelaySec
  let shoutLoopOn = initCfg.shoutLoop
  let replyOn = initCfg.replyNiulai
  let voiceControlOn = initCfg.voiceControl
  let micDeviceId = initCfg.micDeviceId
  let mood: Mood = 'idle'
  let destroyed = false
  let busyInfo: { since: number; label: string } | null = null

  const cur = (): SkinDef => skin
  const skinIdle = (): string => skin.image
  const skinShout = (): string => skin.imageShout ?? skin.image

  // ---- DOM ----
  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', `bottom:${BOTTOM}px`, 'left:0', `height:${PET_H}px`,
    'z-index:99999', 'user-select:none', '-webkit-user-select:none',
    'touch-action:none', 'cursor:grab', 'filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))',
  ].join(';')

  const img = document.createElement('img')
  img.src = skinIdle()
  img.draggable = false
  img.style.cssText = `height:${PET_H}px;display:block;transform-origin:50% 100%;pointer-events:none`

  const bubble = document.createElement('div')
  // --face 抵消 root 的 scaleX 朝向翻转（文字不能镜像）；--pop 控制显隐缩放
  bubble.style.cssText = [
    'position:absolute', 'bottom:105%', 'left:50%',
    'transform:translateX(-50%) scale(var(--pop,0)) scaleX(var(--face,1))',
    'background:#fff', 'color:#c2502a', 'font:700 15px/1.6 system-ui,sans-serif',
    'padding:2px 12px', 'border-radius:14px', 'border:2px solid #c2502a',
    'white-space:nowrap', 'pointer-events:none', 'transition:transform .18s ease-out',
  ].join(';')

  const menu = document.createElement('div')
  menu.style.cssText = [
    'position:absolute', 'bottom:105%', 'left:50%',
    'transform:translateX(-50%) scaleX(var(--face,1))',
    'background:rgba(30,30,34,.96)', 'color:#eee', 'font:13px/1.9 system-ui,sans-serif',
    'border-radius:10px', 'padding:4px 0', 'display:none', 'min-width:170px',
    'box-shadow:0 6px 20px rgba(0,0,0,.4)', 'cursor:default',
  ].join(';')

  const about = document.createElement('div')
  about.style.cssText = [
    'position:absolute', 'bottom:105%', 'left:50%',
    'transform:translateX(-50%) scaleX(var(--face,1))',
    'background:rgba(30,30,34,.96)', 'color:#eee', 'font:13px/1.8 system-ui,sans-serif',
    'border-radius:10px', 'padding:10px 16px', 'display:none', 'min-width:190px',
    'box-shadow:0 6px 20px rgba(0,0,0,.4)', 'cursor:default', 'white-space:nowrap',
  ].join(';')
  const aboutTitle = document.createElement('div')
  aboutTitle.textContent = '🐮 牛来桌宠'
  aboutTitle.style.cssText = 'font-weight:700;font-size:14px'
  const aboutVer = document.createElement('div')
  // 版本号由构建期 define 注入（build.mjs 读 package.json），发版自动跟随
  aboutVer.textContent = `dsh-niulai-pet v${__NIULAI_VERSION__} · by whitefirer`
  aboutVer.style.cssText = 'color:#a1a1aa;font-size:12px'
  const aboutNote = document.createElement('div')
  aboutNote.textContent = '动作与叫声均为程序生成'
  aboutNote.style.cssText = 'color:#a1a1aa;font-size:12px'
  const aboutQuote = document.createElement('div')
  aboutQuote.textContent = '「我尽力了，只能做成这样了😂」'
  aboutQuote.style.cssText = 'margin-top:6px;color:#fbbf24;font-size:12px'
  about.append(aboutTitle, aboutVer, aboutNote, aboutQuote)

  root.append(img, bubble, menu, about)
  document.body.appendChild(root)

  // 守灵：dsh 首屏 React 挂载后会置换 body 内容，把直挂节点清掉——
  // 观察 body childList，被清就重新挂回（含后续任何时机的清理）。
  // appendChild 触发的二次回调里 contains 已为 true，不会循环。
  const keeper = new MutationObserver(() => {
    if (!destroyed && !document.body.contains(root)) {
      document.body.appendChild(root)
    }
  })
  keeper.observe(document.body, { childList: true })

  // 起始 x（记忆或默认右下偏左，避开右下角卡片区）
  let x = Math.min(
    Math.max(0, loadDoc().x ?? window.innerWidth - 320),
    window.innerWidth - 80,
  )
  let facing: 1 | -1 = 1 // 1=朝右
  const applyX = (): void => {
    root.style.transform = `translateX(${x}px) scaleX(${facing})`
    root.style.setProperty('--face', String(facing))
  }
  applyX()

  // ---- 叫声 ----
  // 预读 mp3 元数据拿真实时长：嘴部张合/气泡要撑满「妈~~~~」的长尾音
  const soundDur = new Map<string, number>()
  for (const s of assets.skins) {
    for (const src of [...(s.sounds ?? []), ...(s.replySound !== undefined ? [s.replySound] : [])]) {
      const probe = new Audio()
      probe.preload = 'metadata'
      probe.addEventListener('loadedmetadata', () => { soundDur.set(src, probe.duration) })
      probe.src = src
    }
  }

  /** 放一声当前皮肤的叫声，返回时长 ms（0=无声/被静音）。 */
  const playVoice = (): number => {
    if (muted) return 0
    const s = cur()
    if (s.voice === 'mama') {
      const list = s.sounds ?? []
      if (list.length === 0) return 0
      const src = list[Math.floor(Math.random() * list.length)]
      const audio = new Audio(src)
      void audio.play().catch(() => { /* 自动播放被拦：等用户首次交互 */ })
      const d = soundDur.get(src)
      return d !== undefined ? Math.round(d * 1000) + 150 : 2600
    }
    if (s.voice === 'moo' || s.voice === 'whale' || s.voice === 'squeak') {
      const ctx = audioCtx()
      if (ctx === null) return 0
      if (s.voice === 'moo') { synthMoo(ctx); return 950 }
      if (s.voice === 'whale') { synthWhale(ctx); return 1650 }
      synthSqueak(ctx)
      return 450
    }
    return 0
  }

  /**
   * 妈妈的回应「牛来！」：只放声+气泡，不动嘴（不是宠物在喊）。
   * 时机：连喊接龙放完（循环模式关），或循环喊被互动打断时。
   */
  /** 回应去重：打断循环的即时回应与喊声尾部的回应不重复（喊开始后回过就不再回）。 */
  let lastReplyAt = 0
  const playReply = (): void => {
    if (muted || !replyOn || destroyed) return
    const src = cur().replySound
    if (src === undefined) return
    lastReplyAt = Date.now()
    const audio = new Audio(src)
    void audio.play().catch(() => {})
    const d = soundDur.get(src)
    showBubble('牛来！', Math.max(1500, Math.round((d ?? 1.8) * 1000) + 300))
  }
  // 浏览器自动播放策略：首次任意交互时暖一下 AudioContext
  const unlock = (): void => { audioCtx() }
  document.addEventListener('pointerdown', unlock, { once: true, capture: true })

  // ---- 基础动画 ----
  const breathe = img.animate(
    [{ transform: 'scaleY(1) translateY(0)' }, { transform: 'scaleY(1.025) translateY(-1.5px)' }],
    { duration: 1100, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
  )

  let bubbleTimer = 0
  const showBubble = (text: string, ms: number): void => {
    if (text === '') return
    bubble.textContent = text
    root.style.setProperty('--pop', '1')
    window.clearTimeout(bubbleTimer)
    bubbleTimer = window.setTimeout(() => {
      root.style.setProperty('--pop', '0')
    }, ms)
  }

  // 嘴型：「妈-妈~~」两个音节 = 开-合-开，长尾音是开口音——保持张开到声止再闭。
  // 飞行中若皮肤有飞行张嘴帧（imageFlyShout）则照样开合。
  let mouthTimers: number[] = []
  let shouting = false // 喊声播放中（含尾音保持）：sleep 压扁变暗、眨眼都要让位
  const mouthOpen = (): void => {
    if (cur().imageShout === undefined) return
    img.src = mood === 'fly'
      ? (cur().imageFlyShout ?? cur().imageFly ?? cur().image)
      : skinShout()
  }
  const mouthShut = (): void => {
    img.src = mood === 'fly' ? (cur().imageFly ?? cur().image) : skinIdle()
  }
  const mouthIdle = (): void => {
    for (const t of mouthTimers) window.clearTimeout(t)
    mouthTimers = []
    shouting = false
    if (mood !== 'fly') img.src = skinIdle()
  }
  /** 一声的嘴型时间线：开 240ms → 合 120ms → 开并保持 → ms 时合上，onDone 接龙。 */
  const mouthShout = (ms: number, onDone?: () => void): void => {
    for (const t of mouthTimers) window.clearTimeout(t)
    mouthTimers = []
    shouting = true
    mouthOpen()
    mouthTimers.push(window.setTimeout(mouthShut, 240))
    mouthTimers.push(window.setTimeout(mouthOpen, 360))
    mouthTimers.push(window.setTimeout(() => { mouthShut(); shouting = false; onDone?.() }, Math.max(ms, 420)))
  }

  // 眨眼：2.5~6.4s 随机间隔闭 130ms（喊叫/飞行/拖拽时让位）
  let blinkTimer = 0
  let blinkResetTimer = 0
  const scheduleBlink = (): void => {
    blinkTimer = window.setTimeout(() => {
      const canBlink = !destroyed && (mood === 'idle' || mood === 'walk')
        && !shouting && cur().imageBlink !== undefined
      if (canBlink) {
        img.src = cur().imageBlink as string
        blinkResetTimer = window.setTimeout(() => {
          if (!destroyed && mood !== 'fly' && !shouting) img.src = skinIdle()
        }, 130)
      }
      scheduleBlink()
    }, 2600 + Math.random() * 3800)
  }
  scheduleBlink()

  /** 一次蹦跳（dur ms、height px 上抛）。 */
  const hop = (height = 44, dur = 380): Promise<void> => {
    breathe.pause()
    const anim = img.animate(
      [
        { transform: 'translateY(0) scale(1,1)', offset: 0 },
        { transform: `translateY(4px) scale(1.06,0.9)`, offset: 0.18 },
        { transform: `translateY(-${height}px) scale(0.94,1.08)`, offset: 0.55 },
        { transform: 'translateY(0) scale(1.04,0.94)', offset: 0.86 },
        { transform: 'translateY(0) scale(1,1)', offset: 1 },
      ],
      { duration: dur, easing: 'ease-out' },
    )
    return anim.finished.then(() => { if (!destroyed) breathe.play() }).catch(() => {})
  }

  /** 连跳三下（庆祝经典款）。 */
  const hops3 = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      if (destroyed) return
      await hop(58 - i * 12, 420)
    }
  }

  /** 摇摆舞：左右摇摆 + 小跳收尾。 */
  const dance = async (): Promise<void> => {
    breathe.pause()
    await img.animate(
      [
        { transform: 'rotate(0deg) translateY(0)', offset: 0 },
        { transform: 'rotate(-13deg) translateY(-7px)', offset: 0.14 },
        { transform: 'rotate(0deg) translateY(0)', offset: 0.28 },
        { transform: 'rotate(13deg) translateY(-7px)', offset: 0.42 },
        { transform: 'rotate(0deg) translateY(0)', offset: 0.56 },
        { transform: 'rotate(-10deg) translateY(-12px)', offset: 0.7 },
        { transform: 'rotate(10deg) translateY(-12px)', offset: 0.84 },
        { transform: 'rotate(0deg) translateY(0)', offset: 1 },
      ],
      { duration: 1600, easing: 'ease-in-out' },
    ).finished.catch(() => {})
    if (!destroyed) breathe.play()
  }

  /** 奶牛摇（波兰牛 meme）：脚底支点大振幅快节拍摇摆。 */
  const sway = async (): Promise<void> => {
    breathe.pause()
    await img.animate(
      [
        { transform: 'rotate(0deg)', offset: 0 },
        { transform: 'rotate(-19deg) translateY(-5px)', offset: 0.13 },
        { transform: 'rotate(0deg)', offset: 0.25 },
        { transform: 'rotate(19deg) translateY(-5px)', offset: 0.38 },
        { transform: 'rotate(0deg)', offset: 0.5 },
        { transform: 'rotate(-19deg) translateY(-5px)', offset: 0.63 },
        { transform: 'rotate(0deg)', offset: 0.75 },
        { transform: 'rotate(19deg) translateY(-5px)', offset: 0.88 },
        { transform: 'rotate(0deg)', offset: 1 },
      ],
      { duration: 1750, easing: 'ease-in-out' },
    ).finished.catch(() => {})
    if (!destroyed) breathe.play()
  }

  /** 原地转圈（绕脚底支点一圈，带点小跳）。 */
  const spin = async (): Promise<void> => {
    breathe.pause()
    await img.animate(
      [
        { transform: 'rotate(0deg) translateY(0)', offset: 0 },
        { transform: 'rotate(180deg) translateY(-14px)', offset: 0.5 },
        { transform: 'rotate(360deg) translateY(0)', offset: 1 },
      ],
      { duration: 720, easing: 'ease-in-out' },
    ).finished.catch(() => {})
    if (!destroyed) breathe.play()
  }

  /** 熊猫翻滚：绕重心滚 360° 并向朝向平移一段。 */
  const roll = async (): Promise<void> => {
    breathe.cancel() // 内联 transform 与 pause 态的 breathe 叠加会被顶掉，必须 cancel
    const from = x
    let target = from + 210 * facing
    target = Math.min(Math.max(0, target), window.innerWidth - 70)
    const dist = target - from
    const dir = dist === 0 ? facing : Math.sign(dist)
    img.style.transformOrigin = '50% 50%'
    const dur = 950
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const step = (now: number): void => {
        if (destroyed || mood !== 'celebrate') { resolve(); return }
        const t = Math.min(1, (now - start) / dur)
        x = from + dist * t
        const yOff = -Math.sin(t * Math.PI) * 16
        root.style.transform = `translateX(${x}px) translateY(${yOff}px) scaleX(${facing})`
        img.style.transform = `rotate(${360 * dir * t}deg)`
        if (t < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    img.style.transform = ''
    img.style.transformOrigin = '50% 100%'
    applyX()
    if (!destroyed) breathe.play()
  }

  // ---- 行为循环 ----
  let behaveTimer = 0
  const clampX = (): void => {
    x = Math.min(Math.max(0, x), window.innerWidth - 70)
  }

  const walkTo = async (target: number): Promise<void> => {
    if (mood !== 'idle') return
    mood = 'walk'
    facing = target > x ? 1 : -1
    const from = x
    const dist = Math.abs(target - from)
    const dur = Math.max(500, (dist / 60) * 1000) // ~60px/s
    breathe.pause()
    const wobble = img.animate(
      [
        { transform: 'rotate(4deg) translateY(0)' },
        { transform: 'rotate(-4deg) translateY(-3px)' },
        { transform: 'rotate(4deg) translateY(0)' },
      ],
      { duration: 320, iterations: Math.max(1, Math.round(dur / 320)) },
    )
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const step = (now: number): void => {
        if (destroyed || mood !== 'walk') { resolve(); return }
        const t = Math.min(1, (now - start) / dur)
        x = from + (target - from) * t
        applyX()
        if (t < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    wobble.cancel()
    // 被 celebrate/拖拽等打断时不抢状态（否则会把 fly 等 mood 踩回 idle）
    if (mood === 'walk') {
      if (!destroyed) breathe.play()
      mood = 'idle'
    }
  }

  const sleepFor = async (ms: number): Promise<void> => {
    if (mood !== 'idle' || shouting) return // 叫唤着不许睡：压扁+变暗会把喊妈演成梦游
    mood = 'sleep'
    breathe.pause()
    const squash = img.animate(
      [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.78)' }],
      { duration: 500, fill: 'forwards', easing: 'ease-out' },
    )
    await squash.finished.catch(() => {})
    img.style.filter = 'brightness(.82)'
    await new Promise((r) => window.setTimeout(r, ms))
    if (destroyed) return
    img.style.filter = ''
    if (mood !== 'sleep') {
      squash.cancel() // 被打断：解除压扁，不抢 transform 与 mood
      return
    }
    const wake = img.animate(
      [{ transform: 'scaleY(0.78)' }, { transform: 'scaleY(1)' }],
      { duration: 420, fill: 'forwards', easing: 'ease-out' },
    )
    await wake.finished.catch(() => {})
    squash.cancel()
    wake.cancel()
    breathe.play()
    mood = 'idle'
  }

  /** 飞行统一航迹：dive=中低空平飞掠场（两度轻柔起伏），arc=弧线跃出再落下（两端低中间高）。 */
  const flight = async (path: 'dive' | 'arc'): Promise<void> => {
    if (mood === 'drag' || mood === 'fly' || destroyed) return
    mood = 'fly'
    breathe.cancel() // 内联 transform 会被 pause 态 breathe 的 WAAPI 效果顶掉，必须 cancel
    const homeX = x
    const s = cur()
    img.src = (path === 'dive' ? s.imageFly : undefined) ?? s.image
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1
    facing = dir
    root.style.setProperty('--face', String(dir)) // 气泡文字靠它抵消镜像
    const startX = dir === 1 ? -200 : window.innerWidth + 120
    const endX = dir === 1 ? window.innerWidth + 120 : -200
    const amp = window.innerHeight * 0.42 // 弧顶高度
    const dur = 2600
    const start = performance.now()
    let spouted = false
    await new Promise<void>((resolve) => {
      const step = (now: number): void => {
        if (destroyed || mood !== 'fly') { resolve(); return }
        const t = Math.min(1, (now - start) / dur)
        x = startX + (endX - startX) * t
        let yOff: number
        let rot: number
        if (path === 'dive') {
          // 向上抛物线飞越（两端低、弧顶高）。飞行图固有姿态≈头朝右水平微低头，
          // 旋转给切线补偿：起攀抬头→弧顶水平→下落低头。
          // 注意：镜像父级内 rotate 方向随镜像自洽，不能再乘 dir（实测乘了就底朝天）
          yOff = -Math.sin(Math.PI * t) * amp
          rot = -5 - Math.cos(Math.PI * t) * 45
        } else {
          // 跃出水面弧线：两端低、弧顶高；抬头跃出、低头落回（沿切线，同样不乘 dir）
          yOff = -Math.sin(Math.PI * t) * amp
          rot = -Math.cos(Math.PI * t) * 48
        }
        root.style.transform = `translateX(${x}px) translateY(${yOff}px) scaleX(${facing})`
        img.style.transform = `rotate(${rot}deg)`
        // 鲸鱼弧顶喷水窗
        if (path === 'arc' && s.imageSpout !== undefined) {
          if (!spouted && t > 0.42 && t < 0.62) {
            spouted = true
            img.src = s.imageSpout
          } else if (spouted && t >= 0.62) {
            img.src = s.image
          }
        }
        if (t < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    if (destroyed) return
    if (mood !== 'fly') return // 飞行中被拎走/接管：不抢状态
    x = homeX
    img.style.transform = ''
    img.src = skinIdle()
    applyX()
    breathe.play()
    mood = 'idle'
  }

  const flyAcross = (): Promise<void> => flight('dive')

  /** 当前皮肤的完成绑定（按皮肤记，缺配回落签名动作）。 */
  const doneAction = (): ActionName => asAction(config.getSnapshot().actions[skin.id]?.done, 'signature')
  /** 当前皮肤的戳一下绑定（按皮肤记，缺配回落连跳）。 */
  const pokeAction = (): ActionName => asAction(config.getSnapshot().actions[skin.id]?.poke, 'hops')

  /** 事件动作派发：signature 解析为当前皮肤签名；random 现场抽。 */
  const runAction = (name: ActionName): void => {
    if (destroyed || mood === 'drag' || mood === 'fly') return
    let pick = name
    if (pick === 'signature') pick = cur().signature
    if (pick === 'random') pick = ACTION_POOL[Math.floor(Math.random() * ACTION_POOL.length)]
    if (pick === 'fly') {
      void flyAcross()
      return
    }
    if (pick === 'breach') {
      void flight('arc')
      return
    }
    mood = 'celebrate'
    const done = (): void => { if (!destroyed && mood === 'celebrate') mood = 'idle' }
    const run = pick === 'dance' ? dance()
      : pick === 'spin' ? spin()
        : pick === 'sway' ? sway()
          : pick === 'roll' ? roll()
            : hops3()
    void run.then(done)
  }

  const behave = (): void => {
    if (destroyed) return
    if (mood === 'idle') {
      const rollDie = Math.random()
      if (rollDie < 0.3) {
        void hop(26, 300) // 原地小跳
      } else if (rollDie < 0.62) {
        clampX()
        const span = Math.min(260, window.innerWidth * 0.2)
        const target = Math.min(Math.max(0, x + (Math.random() * 2 - 1) * span * 2), window.innerWidth - 70)
        if (Math.abs(target - x) > 40) void walkTo(target)
      } else if (rollDie < 0.78) {
        void sleepFor(4000 + Math.random() * 4000)
      } else {
        // 原地扭一扭
        breathe.pause()
        void img.animate(
          [{ transform: 'rotate(0)' }, { transform: 'rotate(7deg)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(0)' }],
          { duration: 620, easing: 'ease-in-out' },
        ).finished.then(() => { if (!destroyed) breathe.play() }).catch(() => {})
      }
    }
    behaveTimer = window.setTimeout(behave, 6000 + Math.random() * 8000)
  }
  behaveTimer = window.setTimeout(behave, 5000)

  // ---- 气泡唠叨：AI 忙时报耗时，闲时随机吐槽 ----
  let chatterTimer = 0
  const chatter = (): void => {
    if (!destroyed && talkative && mood === 'idle') {
      if (busyInfo !== null) {
        const sec = Math.floor((Date.now() - busyInfo.since) / 1000)
        if (sec >= 30) showBubble(`「${busyInfo.label}」的AI已经跑了 ${fmtDur(sec)}…`, 2800)
      } else if (Math.random() < 0.6) {
        // 自定义语录非空时替换内置通用池；皮肤专属语录始终并入
        const custom = config.getSnapshot().quips
        const pool = (custom.length > 0 ? custom : QUIPS).concat(cur().quips ?? [])
        showBubble(pool[Math.floor(Math.random() * pool.length)], 2400)
      }
    }
    chatterTimer = window.setTimeout(chatter, 35000 + Math.random() * 40000)
  }
  chatterTimer = window.setTimeout(chatter, 20000)

  // ---- 触发 ----
  let lastCelebrate = 0
  // 循环喊（shoutLoop）：完成后每隔 ~2.4s+喊声全长 再喊一声，直到互动停止
  // （戳/拖/新任务开始/静音或开关关闭）；60 声兜底自停，防忘关叫一宿。
  let shoutLoopTimer = 0
  let shoutLoopLeft = 0
  /** 停循环；withReply=true（互动/新任务打断）且循环确实在跑时，妈妈回一句。 */
  const stopShoutLoop = (withReply = false): void => {
    const wasActive = shoutLoopTimer !== 0 || shoutLoopLeft > 0
    window.clearTimeout(shoutLoopTimer)
    shoutLoopTimer = 0
    shoutLoopLeft = 0
    if (withReply && wasActive) playReply()
    syncVoice() // 循环停 → 立即关麦停流
  }

  // ---- 语音停喊（voiceControl）：循环喊期间开麦识别「牛来」，命中即停循环 ----
  // 模板就是妈妈的回应音 replySound（「牛来！」），识别命中回调 stopShoutLoop(true)
  // ——停止时妈妈回一句，闭环达成。不常驻：只在循环喊进行中开麦。
  let voice: VoiceStopHandle | null = null
  let voiceStarting = false
  /** 开听条件：开关开 + 非静音 + 循环喊在跑 + 当前皮肤有回应音（无模板无法识别）。 */
  const voiceWanted = (): boolean =>
    voiceControlOn && !muted && !destroyed && cur().replySound !== undefined
    && (shoutLoopTimer !== 0 || shoutLoopLeft > 0)
  const syncVoice = (): void => {
    if (!voiceWanted()) {
      if (voice !== null) { voice.stop(); voice = null }
      return
    }
    if (voice !== null || voiceStarting) return
    voiceStarting = true
    const handle = startVoiceStop({
      templateSrcs: () => [cur().replySound, REPLY_REF],
      micDeviceId: () => micDeviceId,
      onMatch: () => { stopShoutLoop(true) },
    })
    void handle.ready.then((ok) => {
      voiceStarting = false
      if (!ok) return
      if (voiceWanted()) {
        voice = handle
      } else {
        handle.stop() // 就绪期间循环已被互动停掉：立即关麦，不留尾巴
      }
    })
  }

  const shoutLoopTick = (): void => {
    shoutLoopTimer = 0
    if (destroyed || !shoutLoopOn || muted || shoutLoopLeft <= 0 || mood === 'drag' || mood === 'fly') {
      stopShoutLoop()
      return
    }
    shoutLoopLeft--
    const ms = playVoice()
    if (ms > 0) mouthShout(ms)
    const text = cur().shoutBubble
    showBubble(text === '' ? '！' : text, Math.max(1500, ms + 300))
    shoutLoopTimer = window.setTimeout(shoutLoopTick, Math.max(ms, 600) + 2400)
  }

  const fireCelebrate = (): void => {
    if (destroyed) return
    if (shoutOnDone && !muted) {
      // 连喊 N 声串行接龙：一声放完接下声；每声「开-合-开-保持」，声止嘴合
      const chain = (n: number): void => {
        if (destroyed) return
        if (n <= 0) {
          // 接龙放完：非循环模式时妈妈回一句；循环模式的回应在打断时给
          if (!shoutLoopOn) playReply()
          return
        }
        const ms = playVoice()
        if (ms <= 0) return
        const next = (): void => chain(n - 1)
        if (cur().imageShout === undefined) window.setTimeout(next, ms)
        else mouthShout(ms, next)
      }
      chain(shoutCount)
      const text = cur().shoutBubble
      showBubble(Array(shoutCount).fill(text).join(' '), 1400 + shoutCount * 2200)
      // 接龙放完再进入循环（留一口气）
      if (shoutLoopOn) {
        shoutLoopLeft = 60
        shoutLoopTimer = window.setTimeout(shoutLoopTick, shoutCount * 2600 + 1600)
        syncVoice() // 循环喊开始 → 语音停喊开听（开关开着且环境支持时）
      }
    }
    runAction(doneAction()) // 安静模式也照做动作，只是没声没气泡
  }

  const celebrate = (): void => {
    const now = Date.now()
    if (now - lastCelebrate < 6000 || mood === 'drag' || mood === 'fly' || destroyed) return
    lastCelebrate = now
    stopShoutLoop() // 新一轮完成顶掉上一轮未停的循环
    const delayMs = doneDelaySec * 1000
    if (delayMs > 0) {
      window.setTimeout(() => { if (!destroyed) fireCelebrate() }, delayMs)
      return
    }
    fireCelebrate()
  }

  /** 只喊不跳（菜单「喊一声」/戳一下的出声部分）：嘴部张合与气泡都撑满喊声全长，
   *  喊完妈妈回一句（开关控制；loop 打断已回过的不重复）。 */
  const shout = (): void => {
    if (mood === 'drag' || mood === 'fly' || destroyed) return
    const ms = playVoice()
    if (ms > 0) {
      mouthShout(ms)
      const shoutAt = Date.now()
      window.setTimeout(() => { if (lastReplyAt < shoutAt) playReply() }, ms)
    }
    showBubble(cur().shoutBubble === '' ? '！' : cur().shoutBubble, Math.max(1500, ms + 300))
  }

  /** 戳一下（点击宠物）：喊 + 绑定动作，肯定要跳；互动即停循环喊（妈妈回一句）。 */
  const poke = (): void => {
    if (mood === 'drag' || mood === 'fly' || destroyed) return
    stopShoutLoop(true)
    shout()
    runAction(pokeAction())
  }

  // ---- 指针交互（点击 vs 拖拽）----
  let dragStartX = 0
  let dragStartY = 0
  let petStartX = 0
  let dragging = false
  let downAt = 0

  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    // 菜单/关于面板内的点击：不进入拖拽与戳判定（否则 setPointerCapture
    // 会把行点击截胡成 poke —— 历史上"点菜单=喊一声"的 bug 就出自这里）
    if (menu.contains(ev.target as Node) || about.contains(ev.target as Node)) return
    dragging = false
    downAt = performance.now()
    stopShoutLoop(true) // 任意上手互动（含拖拽与点击预备）都停循环喊，妈妈回一句
    dragStartX = ev.clientX
    dragStartY = ev.clientY
    petStartX = x
    root.setPointerCapture(ev.pointerId)
  })

  root.addEventListener('pointermove', (ev) => {
    if (downAt === 0) return
    const dx = ev.clientX - dragStartX
    const dy = ev.clientY - dragStartY
    if (!dragging && Math.hypot(dx, dy) > 6) {
      dragging = true
      mood = 'drag'
      breathe.cancel() // 拎起倾斜用的是内联 transform，pause 态 breathe 会顶掉它
      img.src = skinIdle() // 若正飞行中被拎起，先换回站立图
      root.style.cursor = 'grabbing'
    }
    if (dragging) {
      // root 变换是 translateX 叠 scaleX：屏幕位移与 x 恒 1:1，与朝向无关
      x = petStartX + dx
      clampX()
      root.style.transform = `translateX(${x}px) scaleX(${facing}) translateY(${Math.min(0, dy) * 0.3}px)`
      img.style.transform = `rotate(${Math.max(-14, Math.min(14, dx / 8))}deg)`
    }
  })

  root.addEventListener('pointerup', (ev) => {
    const wasDragging = dragging
    const quick = performance.now() - downAt < 350
    dragging = false
    downAt = 0
    root.style.cursor = 'grab'
    img.style.transform = ''
    if (wasDragging) {
      mood = 'idle'
      root.style.transform = `translateX(${x}px) scaleX(${facing})`
      savePersisted({ ...loadDoc(), x })
      // 落地回弹
      void hop(20, 260)
      if (!destroyed) breathe.play()
    } else if (quick) {
      poke()
    }
    try { root.releasePointerCapture(ev.pointerId) } catch { /* 已释放 */ }
  })

  // ---- 右键菜单 ----
  type Row =
    | { kind: 'bool'; label: string; on: boolean; fn: () => void }
    | { kind: 'cycle'; label: string; value: string; fn: () => void }
    | { kind: 'action'; label: string; fn: () => void }

  const rebuildMenu = (): void => {
    menu.textContent = ''
    const cycleAction = (a: ActionName): ActionName =>
      ACTION_ORDER[(ACTION_ORDER.indexOf(a) + 1) % ACTION_ORDER.length]
    const skinIdx = skins.indexOf(skin)
    const nextSkin = skins[(skinIdx + 1) % skins.length]
    // 读写都走 ConfigStore：菜单行只发写请求，显示值来自 store 快照镜像
    // （store 变更 → 文末订阅 → syncConfig + 菜单就地重建，设置卡片同理）
    const rows: Row[] = [
      { kind: 'bool', label: '🔊 声音', on: !muted, fn: () => { config.set({ muted: !muted }) } },
      { kind: 'bool', label: '📣 完成时喊', on: shoutOnDone, fn: () => { config.set({ shoutOnDone: !shoutOnDone }) } },
      { kind: 'cycle', label: '🔁 完成连喊', value: `${shoutCount}声`, fn: () => { config.set({ shoutCount: shoutCount % 3 + 1 }) } },
      { kind: 'bool', label: '💬 气泡唠叨', on: talkative, fn: () => { config.set({ talkative: !talkative }) } },
      { kind: 'cycle', label: '🎬 完成时动作', value: ACTION_LABEL[doneAction()], fn: () => { config.setSkinAction(skin.id, 'done', cycleAction(doneAction())) } },
      { kind: 'cycle', label: '👉 戳我动作', value: ACTION_LABEL[pokeAction()], fn: () => { config.setSkinAction(skin.id, 'poke', cycleAction(pokeAction())) } },
      { kind: 'cycle', label: '🎨 皮肤', value: skin.name, fn: () => { config.set({ skin: nextSkin.id }) } },
      { kind: 'action', label: '🕊 飞一圈', fn: () => { void flyAcross() } },
      { kind: 'action', label: '📢 喊一声', fn: () => { shout() } },
      // 找不到打开设置页的宿主 API（rc.7 无此服务），气泡指路代替跳转
      { kind: 'action', label: '⚙️ 设置', fn: () => { showBubble('去 设置 → 插件配置 → 牛来桌宠', 3200) } },
      { kind: 'action', label: 'ℹ️ 关于', fn: () => { about.style.display = about.style.display === 'block' ? 'none' : 'block' } },
    ]
    for (const r of rows) {
      const row = document.createElement('div')
      row.style.cssText = 'padding:3px 14px;cursor:pointer;border-radius:6px;white-space:nowrap;display:flex;align-items:center;justify-content:space-between;gap:14px'
      const label = document.createElement('span')
      label.textContent = r.kind === 'cycle' ? `${r.label}：${r.value}` : r.label
      row.appendChild(label)
      if (r.kind === 'bool') {
        // 胶囊 switch：点击行任意处翻转
        const sw = document.createElement('span')
        sw.style.cssText = `width:28px;height:16px;border-radius:8px;flex:none;position:relative;transition:background .15s;background:${r.on ? '#3b82f6' : '#52525b'}`
        const knob = document.createElement('span')
        knob.style.cssText = `position:absolute;top:2px;left:${r.on ? '14px' : '2px'};width:12px;height:12px;border-radius:50%;background:#fff;transition:left .15s`
        sw.appendChild(knob)
        row.appendChild(sw)
      }
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,.12)' }
      row.onmouseleave = () => { row.style.background = '' }
      row.onclick = () => {
        r.fn()
        if (r.kind === 'action') {
          menu.style.display = 'none'
        } else {
          rebuildMenu() // 开关/循环项：就地重建刷新，菜单不收起
        }
      }
      menu.appendChild(row)
    }
  }
  root.addEventListener('contextmenu', (ev) => {
    ev.preventDefault()
    about.style.display = 'none'
    rebuildMenu()
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block'
  })
  document.addEventListener('pointerdown', (ev) => {
    if (!root.contains(ev.target as Node)) {
      menu.style.display = 'none'
      about.style.display = 'none'
    }
  })

  // 视口缩放时钳位
  const onResize = (): void => { clampX(); applyX() }
  window.addEventListener('resize', onResize)

  // 配置同步：菜单/设置卡片/迁移 seed 任一端改动，经 store 订阅收敛到
  // 局部镜像；皮肤变化换装；菜单开着时就地重建刷新显示值
  const syncConfig = (): void => {
    const c = config.getSnapshot()
    muted = c.muted
    shoutOnDone = c.shoutOnDone
    talkative = c.talkative
    shoutCount = c.shoutCount
    doneDelaySec = c.doneDelaySec
    shoutLoopOn = c.shoutLoop
    replyOn = c.replyNiulai
    voiceControlOn = c.voiceControl
    if (c.micDeviceId !== micDeviceId) {
      // 换麦克风：正在听就重启监听用上新设备
      micDeviceId = c.micDeviceId
      if (voice !== null) { voice.stop(); voice = null }
      syncVoice()
    }
    if (muted || !shoutLoopOn) stopShoutLoop() // 静音/关循环立即生效（设置开关不算互动，不回一句）
    else syncVoice() // 循环跑着时开/关语音开关或静音，立即反映到麦克风
    const next = findSkin(c.skin)
    if (next !== skin) {
      skin = next
      if (mood !== 'fly') img.src = skinIdle()
    }
  }
  const unsubConfig = config.subscribe(() => {
    if (destroyed) return
    syncConfig()
    if (menu.style.display === 'block') rebuildMenu()
  })

  return {
    celebrate,
    poke,
    setBusy(busy) {
      busyInfo = busy
      if (busy !== null) stopShoutLoop(true) // 新任务开跑：别再喊了；打断时妈妈回一句
    },
    setMuted(m) {
      config.set({ muted: m })
    },
    isMuted() {
      return muted
    },
    destroy() {
      destroyed = true
      unsubConfig()
      keeper.disconnect()
      if (voice !== null) { voice.stop(); voice = null }
      window.clearTimeout(behaveTimer)
      window.clearTimeout(chatterTimer)
      window.clearTimeout(shoutLoopTimer)
      window.clearTimeout(bubbleTimer)
      window.clearTimeout(blinkTimer)
      window.clearTimeout(blinkResetTimer)
      window.removeEventListener('resize', onResize)
      breathe.cancel()
      mouthIdle()
      root.remove()
    },
  }
}
