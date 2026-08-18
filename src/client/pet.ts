/**
 * 桌宠本体：fixed 浮层 + Web Animations 状态机。
 *
 * 姿态素材只有单张站立图，"活"全靠程序化动画：
 *  - idle：呼吸（scaleY 正弦）+ 随机眨眼/小跳/转圈/趴睡
 *  - walk：横向踱步（rotate 交替 + 上下颠簸 + scaleX 朝向）
 *  - drag：指针拎起，松手抛物线落地回弹
 *  - celebrate：任务完成 —— 连跳 + "妈~~妈~~"气泡 + 随机喊声
 *
 * 交互：点击=蹦一下+喊；拖拽=换位（localStorage 记忆）；右键=菜单（静音/趴下）。
 */
export interface PetAssets {
  /** 站立全身图（dataurl）。 */
  image: string
  /** 喊"妈妈"的若干段（dataurl），随机挑播。 */
  sounds: string[]
}

export interface PetHandle {
  /** 任务完成触发（带节流）。 */
  celebrate(): void
  /** 主动戳一下（蹦+喊）。 */
  poke(): void
  destroy(): void
}

type Mood = 'idle' | 'walk' | 'drag' | 'celebrate' | 'sleep'

const STORE_KEY = 'dsh-niulai-pet:state-v1'
const BOTTOM = 18 // 距视口底 px
const PET_H = 120 // 显示高度 px

interface Persisted {
  x?: number
  muted?: boolean
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw === null ? {} : (JSON.parse(raw) as Persisted)
  } catch {
    return {}
  }
}

function savePersisted(p: Persisted): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p))
  } catch { /* 隐私模式放弃记忆 */ }
}

export function mountPet(assets: PetAssets): PetHandle {
  const persisted = loadPersisted()
  let muted = persisted.muted === true
  let mood: Mood = 'idle'
  let destroyed = false

  // ---- DOM ----
  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', `bottom:${BOTTOM}px`, 'left:0', `height:${PET_H}px`,
    'z-index:99999', 'user-select:none', '-webkit-user-select:none',
    'touch-action:none', 'cursor:grab', 'filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))',
  ].join(';')

  const img = document.createElement('img')
  img.src = assets.image
  img.draggable = false
  img.style.cssText = `height:${PET_H}px;display:block;transform-origin:50% 100%;pointer-events:none`

  const bubble = document.createElement('div')
  bubble.textContent = '妈~~妈~~'
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
    'border-radius:10px', 'padding:4px 0', 'display:none', 'min-width:88px',
    'box-shadow:0 6px 20px rgba(0,0,0,.4)', 'cursor:default',
  ].join(';')

  root.append(img, bubble, menu)
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
    Math.max(0, persisted.x ?? window.innerWidth - 320),
    window.innerWidth - 80,
  )
  let facing: 1 | -1 = 1 // 1=朝右
  const applyX = (): void => {
    root.style.transform = `translateX(${x}px) scaleX(${facing})`
    root.style.setProperty('--face', String(facing))
  }
  applyX()

  // ---- 音频 ----
  let audioUnlocked = false
  const playSound = (): void => {
    if (muted || assets.sounds.length === 0) return
    const src = assets.sounds[Math.floor(Math.random() * assets.sounds.length)]
    const audio = new Audio(src)
    void audio.play().catch(() => { /* 自动播放被拦：等用户首次交互 */ })
  }
  const unlock = (): void => {
    if (audioUnlocked) return
    audioUnlocked = true
    const a = new Audio()
    a.muted = true
    void a.play().catch(() => {})
  }
  document.addEventListener('pointerdown', unlock, { once: true, capture: true })

  // ---- 基础动画 ----
  const breathe = img.animate(
    [{ transform: 'scaleY(1) translateY(0)' }, { transform: 'scaleY(1.025) translateY(-1.5px)' }],
    { duration: 1100, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
  )

  const showBubble = (ms: number): void => {
    root.style.setProperty('--pop', '1')
    window.setTimeout(() => {
      root.style.setProperty('--pop', '0')
    }, ms)
  }

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
    if (!destroyed) breathe.play()
    mood = 'idle'
  }

  const sleepFor = async (ms: number): Promise<void> => {
    if (mood !== 'idle') return
    mood = 'sleep'
    breathe.pause()
    await img.animate(
      [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.78)' }],
      { duration: 500, fill: 'forwards', easing: 'ease-out' },
    ).finished.catch(() => {})
    img.style.filter = 'brightness(.82)'
    await new Promise((r) => window.setTimeout(r, ms))
    if (destroyed) return
    img.style.filter = ''
    await img.animate(
      [{ transform: 'scaleY(0.78)' }, { transform: 'scaleY(1)' }],
      { duration: 420, fill: 'forwards', easing: 'ease-out' },
    ).finished.catch(() => {})
    breathe.play()
    mood = 'idle'
  }

  const behave = (): void => {
    if (destroyed) return
    if (mood === 'idle') {
      const roll = Math.random()
      if (roll < 0.3) {
        void hop(26, 300) // 原地小跳
      } else if (roll < 0.62) {
        clampX()
        const span = Math.min(260, window.innerWidth * 0.2)
        const target = Math.min(Math.max(0, x + (Math.random() * 2 - 1) * span * 2), window.innerWidth - 70)
        if (Math.abs(target - x) > 40) void walkTo(target)
      } else if (roll < 0.78) {
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

  // ---- 触发 ----
  let lastCelebrate = 0
  const celebrate = (): void => {
    const now = Date.now()
    if (now - lastCelebrate < 6000 || mood === 'drag' || destroyed) return
    lastCelebrate = now
    const prevMood = mood
    mood = 'celebrate'
    playSound()
    showBubble(3600)
    void (async () => {
      for (let i = 0; i < 3; i++) {
        if (destroyed) return
        await hop(58 - i * 12, 420)
      }
      if (!destroyed) mood = prevMood === 'celebrate' ? 'idle' : prevMood
    })()
  }

  const poke = (): void => {
    if (mood === 'drag' || destroyed) return
    playSound()
    showBubble(1500)
    void hop()
  }

  // ---- 指针交互（点击 vs 拖拽）----
  let dragStartX = 0
  let dragStartY = 0
  let petStartX = 0
  let dragging = false
  let downAt = 0

  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    dragging = false
    downAt = performance.now()
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
      breathe.pause()
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
      savePersisted({ ...loadPersisted(), x })
      // 落地回弹
      void hop(20, 260)
      if (!destroyed) breathe.play()
    } else if (quick) {
      poke()
    }
    try { root.releasePointerCapture(ev.pointerId) } catch { /* 已释放 */ }
  })

  // ---- 右键菜单（静音 / 趴下或起床）----
  const rebuildMenu = (): void => {
    menu.textContent = ''
    const items: Array<[string, () => void]> = [
      [muted ? '🔇 取消静音' : '🔊 静音', () => {
        muted = !muted
        savePersisted({ ...loadPersisted(), muted })
      }],
      ['🐮 喊一声', () => { poke() }],
    ]
    for (const [label, fn] of items) {
      const row = document.createElement('div')
      row.textContent = label
      row.style.cssText = 'padding:2px 14px;cursor:pointer;border-radius:6px'
      row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,.12)' }
      row.onmouseleave = () => { row.style.background = '' }
      row.onclick = () => { menu.style.display = 'none'; fn() }
      menu.appendChild(row)
    }
  }
  root.addEventListener('contextmenu', (ev) => {
    ev.preventDefault()
    rebuildMenu()
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block'
  })
  document.addEventListener('pointerdown', (ev) => {
    if (!root.contains(ev.target as Node)) menu.style.display = 'none'
  })

  // 视口缩放时钳位
  const onResize = (): void => { clampX(); applyX() }
  window.addEventListener('resize', onResize)

  return {
    celebrate,
    poke,
    destroy() {
      destroyed = true
      keeper.disconnect()
      window.clearTimeout(behaveTimer)
      window.removeEventListener('resize', onResize)
      breathe.cancel()
      root.remove()
    },
  }
}
