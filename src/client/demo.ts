/**
 * standalone 试玩页入口：与 dsh 插件同一套 pet.ts + SKINS 注册表，
 * 唯一差别是把 sessions 订阅换成模拟任务驱动（证明纯 client 架构：
 * 去掉宿主服务订阅，同一份 bundle 跑在裸页面上）。
 *
 * 产物 demo/niulai-standalone.js（esbuild iife，素材 dataurl 内联），
 * 由 demo/index.html 直接 <script> 引入。
 * @module dsh-niulai-pet/demo
 */

import { SKINS } from './skins.js'
import { BUILTIN_PACKS, applyVariant, expandCharacters, parsePack, PackParseError } from './packs.js'
import type { CharacterDef } from './packs.js'
import { mountPet, type PetHandle, type SkinDef } from './pet.js'
import { ConfigStore } from './config.js'
import { voiceCapable } from './voice.js'

/** 模拟 agent 任务卡片：跑任务 → 忙（耗时气泡）→ 完成 → 庆祝喊妈。 */
function mountSim(pet: PetHandle): void {
  const card = document.createElement('div')
  card.style.cssText = [
    'position:fixed', 'left:16px', 'top:16px', 'z-index:99998', 'width:240px',
    'background:rgba(20,24,45,.92)', 'color:#fff', 'border:1px solid rgba(255,255,255,.12)',
    'border-radius:12px', 'padding:14px 16px', 'font:14px/1.6 system-ui,sans-serif',
    'backdrop-filter:blur(6px)',
  ].join(';')
  card.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px">模拟 agent 任务</div>
    <div data-st style="color:rgba(255,255,255,.6);margin-bottom:8px">空闲中</div>
    <div style="height:6px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden;margin-bottom:10px">
      <div data-bar style="height:100%;width:0%;background:#f0a830;transition:width .3s"></div>
    </div>
    <button data-run style="width:100%;padding:7px 0;border:0;border-radius:8px;background:#f0a830;color:#1a1405;font-weight:700;cursor:pointer">跑一个任务</button>
    <div style="margin-top:10px;color:rgba(255,255,255,.45);font-size:12px">也会自动跑（约每 20 秒一个）。戳桌宠、开菜单都能玩。</div>
  `
  document.body.appendChild(card)
  const st = card.querySelector('[data-st]') as HTMLDivElement
  const bar = card.querySelector('[data-bar]') as HTMLDivElement
  const btn = card.querySelector('[data-run]') as HTMLButtonElement

  let running = false
  const run = (): void => {
    if (running) return
    running = true
    btn.disabled = true
    btn.style.opacity = '.5'
    const dur = 4000 + Math.random() * 4000
    const t0 = Date.now()
    pet.setBusy({ since: t0, label: '演示任务' })
    st.textContent = '任务运行中…'
    const tick = (): void => {
      const p = Math.min(1, (Date.now() - t0) / dur)
      bar.style.width = `${Math.round(p * 100)}%`
      if (p < 1) {
        requestAnimationFrame(tick)
        return
      }
      pet.setBusy(null)
      pet.celebrate()
      st.textContent = '任务完成！'
      bar.style.width = '0%'
      running = false
      btn.disabled = false
      btn.style.opacity = '1'
      window.setTimeout(() => { if (!running) st.textContent = '空闲中' }, 4000)
    }
    requestAnimationFrame(tick)
  }
  btn.addEventListener('click', run)
  // 自动演示：约每 20s 跑一个（仅页面可见时；celebrate 自身有 6s 节流）
  window.setInterval(() => { if (!document.hidden) run() }, 18000 + Math.random() * 8000)
}

/** 右上角静音角标：展示 + 控制，和宠物菜单「声音」同源同步。 */
function mountMuteBtn(pet: PetHandle): void {
  const btn = document.createElement('button')
  btn.style.cssText = [
    'position:fixed', 'right:16px', 'top:16px', 'z-index:99998',
    'width:40px', 'height:40px', 'border-radius:10px',
    'border:1px solid rgba(255,255,255,.12)', 'background:rgba(20,24,45,.92)',
    'font-size:19px', 'cursor:pointer', 'backdrop-filter:blur(6px)',
  ].join(';')
  const sync = (): void => {
    const m = pet.isMuted()
    btn.textContent = m ? '🔇' : '🔊'
    btn.title = m ? '已静音，点我开声' : '声音开，点我静音'
    btn.setAttribute('aria-label', btn.title)
  }
  btn.addEventListener('click', () => { pet.setMuted(!pet.isMuted()); sync() })
  sync()
  window.setInterval(sync, 1000) // 菜单里拨开关也同步角标
  document.body.appendChild(btn)
}

/** 语音停喊角标（🎤）：demo 没有设置卡片，开关落 localStorage 后端。
 *  开前真试一次授权（原生授权框），被拒不落配置；环境不支持（非 https/localhost）禁用。 */
function mountVoiceBtn(store: ConfigStore): void {
  const btn = document.createElement('button')
  btn.style.cssText = [
    'position:fixed', 'right:64px', 'top:16px', 'z-index:99998',
    'width:40px', 'height:40px', 'border-radius:10px',
    'border:1px solid rgba(255,255,255,.12)', 'background:rgba(20,24,45,.92)',
    'font-size:19px', 'cursor:pointer', 'backdrop-filter:blur(6px)',
  ].join(';')
  btn.textContent = '🎤'
  const capable = voiceCapable()
  const sync = (): void => {
    const on = store.getSnapshot().voiceControl
    btn.style.opacity = !capable ? '.3' : on ? '1' : '.5'
    btn.title = !capable
      ? '当前访问方式不支持麦克风（需 https 或 localhost 打开）'
      : on
        ? '语音停喊开（循环喊时喊一声「牛来」即停），点我关'
        : '语音停喊关，点我开（会先弹麦克风授权）'
    btn.setAttribute('aria-label', btn.title)
  }
  btn.addEventListener('click', () => {
    if (!capable) return
    if (store.getSnapshot().voiceControl) {
      store.set({ voiceControl: false })
      return
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        for (const track of stream.getTracks()) track.stop()
        store.set({ voiceControl: true })
      },
      () => { console.warn('[niulai-demo] 麦克风授权被拒，语音停喊未开启') },
    )
  })
  sync()
  store.subscribe(sync)
  document.body.appendChild(btn)
}

/** 自定义角色包试玩：📦 按钮/拖入 zip → parsePack 校验 → 并入皮肤列表（仅内存，
 *  试玩不落库）并切过去。皮肤试用间——做包不用装就能先看效果。 */
function mountPackImport(ctx: DemoCtx): void {
  const btn = document.createElement('button')
  btn.style.cssText = [
    'position:fixed', 'right:112px', 'top:16px', 'z-index:99998',
    'width:40px', 'height:40px', 'border-radius:10px',
    'border:1px solid rgba(255,255,255,.12)', 'background:rgba(20,24,45,.92)',
    'font-size:19px', 'cursor:pointer', 'backdrop-filter:blur(6px)',
  ].join(';')
  btn.textContent = '📦'
  btn.title = '试玩自定义角色包（.nlpack.zip），也可直接拖进页面'
  btn.setAttribute('aria-label', btn.title)
  document.body.appendChild(btn)

  const toast = document.createElement('div')
  toast.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
    'z-index:99998', 'max-width:80vw', 'padding:8px 16px', 'border-radius:10px',
    'background:rgba(20,24,45,.95)', 'border:1px solid rgba(255,255,255,.15)',
    'color:#fff', 'font:13px/1.6 system-ui,sans-serif', 'display:none',
    'white-space:pre-wrap', 'backdrop-filter:blur(6px)',
  ].join(';')
  document.body.appendChild(toast)
  let toastTimer = 0
  const showToast = (msg: string, err = false): void => {
    toast.textContent = msg
    toast.style.borderColor = err ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)'
    toast.style.display = 'block'
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { toast.style.display = 'none' }, err ? 8000 : 3200)
  }

  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.zip,.nlpack.zip'
  fileInput.style.display = 'none'
  document.body.appendChild(fileInput)
  btn.addEventListener('click', () => { fileInput.click() })
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    fileInput.value = ''
    if (f !== undefined) void importFile(f)
  })
  document.addEventListener('dragover', (e) => { e.preventDefault() })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (f !== undefined) void importFile(f)
  })

  const importFile = async (f: File): Promise<void> => {
    try {
      const data = new Uint8Array(await f.arrayBuffer())
      const known = [...BUILTIN_PACKS.map((c) => c.id), ...ctx.customs.map((c) => c.id)]
      let { def, warnings } = parsePack(data, known)
      if (def.extendedFrom !== undefined) {
        const target = [...BUILTIN_PACKS, ...ctx.customs].find((c) => c.id === def.extendedFrom)
        if (target !== undefined) def = applyVariant(target, def)
      }
      ctx.customs = [...ctx.customs.filter((c) => c.id !== def.id), def]
      const skins = [...SKINS, ...expandCharacters(ctx.customs)]
      ctx.pushSkins(skins)
      ctx.store.set({ skin: def.skins[0].id }) // 切过去看效果
      showToast(`已载入「${def.name}」（试玩不过夜，刷新即还原）${warnings.length > 0 ? `\n提醒：\n· ${warnings.join('\n· ')}` : ''}`, warnings.length > 0)
    } catch (e) {
      showToast(e instanceof PackParseError ? e.message : String(e), true)
    }
  }
}

/** demo 侧共享状态：自定义包（内存）+ 皮肤推送通道 + ConfigStore。 */
interface DemoCtx {
  customs: CharacterDef[]
  store: ConfigStore
  pushSkins(next: SkinDef[]): void
}

const start = (): void => {
  let currentSkins = SKINS
  const skinListeners = new Set<(s: SkinDef[]) => void>()
  const store = new ConfigStore({ skinIds: SKINS.map((s) => s.id), defaultSkin: 'niulai' })
  const ctx: DemoCtx = {
    customs: [],
    store,
    pushSkins(next) {
      currentSkins = next
      store.updateSkinIds(next.map((s) => s.id))
      for (const fn of skinListeners) fn(next)
    },
  }
  const pet = mountPet({
    skins: currentSkins,
    defaultSkin: 'niulai',
    subscribeSkins: (fn) => { skinListeners.add(fn); return () => { skinListeners.delete(fn) } },
  }, store)
  // 额外表实例管家（同 index.ts；试玩页也开乐园模式）
  const extraPets = new Map<string, PetHandle>()
  const syncExtraPets = (): void => {
    const want = store.getSnapshot().extraPets
    want.forEach((p, idx) => {
      if (!extraPets.has(p.id)) {
        extraPets.set(p.id, mountPet({
          skins: currentSkins,
          defaultSkin: 'niulai',
          petId: p.id,
          defaultX: Math.max(0, window.innerWidth - 320 - 150 * (idx + 1)),
          subscribeSkins: (fn) => { skinListeners.add(fn); return () => { skinListeners.delete(fn) } },
        }, store))
      }
    })
    for (const [id, h] of extraPets) {
      if (!want.some((p) => p.id === id)) {
        h.destroy()
        extraPets.delete(id)
      }
    }
  }
  syncExtraPets()
  store.subscribe(syncExtraPets)
  mountSim(pet)
  mountMuteBtn(pet)
  mountVoiceBtn(store)
  mountPackImport(ctx)
  // 验证钩子（playwright 冒烟用）
  ;(window as unknown as { __niulai?: PetHandle }).__niulai = pet
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
