/**
 * standalone 试玩页入口：与 dsh 插件同一套 pet.ts + SKINS 注册表，
 * 唯一差别是把 sessions 订阅换成模拟任务驱动（证明纯 client 架构：
 * 去掉宿主服务订阅，同一份 bundle 跑在裸页面上）。
 *
 * 产物 demo/niulai-standalone.js（esbuild iife，素材 dataurl 内联），
 * 由 demo/index.html 直接 <script> 引入。
 * @module dsh-niulai-pet/demo
 */

import { SKINS } from './index.js'
import { mountPet, type PetHandle } from './pet.js'

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
    pet.setBusy(t0)
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

const start = (): void => {
  const pet = mountPet({ skins: SKINS, defaultSkin: 'niulai' })
  mountSim(pet)
  // 验证钩子（playwright 冒烟用）
  ;(window as unknown as { __niulai?: PetHandle }).__niulai = pet
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
