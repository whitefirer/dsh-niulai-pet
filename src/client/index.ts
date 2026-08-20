/**
 * dsh-niulai-pet client 入口：挂载桌宠 + 订阅 sessions 服务驱动庆祝/耗时气泡
 * + （dsh rc.7+）注册设置卡片。
 *
 * 皮肤注册表在 skins.ts（独立模块，demo 试玩页直接引它，不经过本入口——
 * 本入口引入设置卡片会带上 react，demo bundle 不含 react）。
 * @module dsh-niulai-pet/client
 */

import { mountPet, type PetHandle } from './pet.js'
import { SKINS } from './skins.js'
import { ConfigStore } from './config.js'
import { registerSettingsCard } from './card.js'

export { SKINS } from './skins.js'
export type { SkinDef } from './pet.js'

/** 必需服务：无 —— 桌宠本体不依赖任何宿主服务；设置卡片走可选子 fiber。 */
export const inject: string[] = []

/** client ctx 面（cordis-client-runner guard 代理兼容，照 dsh-browser-fs）。 */
interface ClientCtx {
  effect(fn: () => void | (() => void), label?: string): void
  inject(names: string[], fn: (ctx: unknown) => void): void
}

/** ObservableSnapshot 最小面（dsh client runtime 的发布形状）。 */
interface Snapshot<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

interface SessionRow {
  running?: boolean
  completed?: boolean
}

interface SessionsService {
  list: Snapshot<{ byId: Record<string, SessionRow> }>
}

interface WatchCallbacks {
  /** 有会话完成时触发。 */
  onDone: () => void
  /** 忙闲沿变化：忙起传时间戳，闲落传 null。 */
  onBusy: (since: number | null) => void
}

function watchSessions(ctx: ClientCtx, cb: WatchCallbacks): void {
  ctx.inject(['sessions'], (raw: unknown) => {
    const sessions = (raw as { sessions?: SessionsService } | undefined)?.sessions
    if (sessions === undefined || typeof sessions.list?.subscribe !== 'function') {
      console.warn('[dsh-niulai-pet] sessions 服务不在场（旧宿主？）——任务完成触发停用，仅手动交互')
      return
    }
    const prev = new Map<string, { running: boolean; completed: boolean }>()
    const seed = sessions.list.getSnapshot()
    for (const [id, row] of Object.entries(seed.byId)) {
      prev.set(id, { running: row.running === true, completed: row.completed === true })
    }
    // 挂载时已有在跑会话：忙基线从页面加载算起
    let wasAnyRunning = [...prev.values()].some((r) => r.running)
    if (wasAnyRunning) cb.onBusy(Date.now())
    console.log(`[dsh-niulai-pet] ready, sessions watch on (baseline ${prev.size})`)
    const unsub = sessions.list.subscribe(() => {
      const snap = sessions.list.getSnapshot()
      for (const [id, row] of Object.entries(snap.byId)) {
        const before = prev.get(id)
        const now = { running: row.running === true, completed: row.completed === true }
        if (before !== undefined) {
          const finished = (before.running && !now.running) || (!before.completed && now.completed)
          if (finished) {
            console.log(`[dsh-niulai-pet] task done detected: ${id.slice(0, 8)} (running ${before.running}->${now.running}, completed ${before.completed}->${now.completed})`)
            cb.onDone()
          }
        }
        prev.set(id, now)
      }
      for (const id of [...prev.keys()]) {
        if (!(id in snap.byId)) prev.delete(id)
      }
      const anyRunning = [...prev.values()].some((r) => r.running)
      if (anyRunning && !wasAnyRunning) cb.onBusy(Date.now())
      else if (!anyRunning && wasAnyRunning) cb.onBusy(null)
      wasAnyRunning = anyRunning
    })
    ctx.effect(() => unsub, 'niulai-pet sessions watch')
  })
}

export function apply(ctx: ClientCtx): void {
  const start = (): void => {
    const store = new ConfigStore({ skinIds: SKINS.map((s) => s.id), defaultSkin: 'niulai' })
    const pet = mountPet({ skins: SKINS, defaultSkin: 'niulai' }, store)
    watchSessions(ctx, { onDone: pet.celebrate, onBusy: pet.setBusy })
    // 设置卡片（dsh rc.7+）：可选注入——settingsScope/slots/locale 任一缺席
    // （rc.6 及更早）子 fiber 就永远等不到服务，静默没有卡片；桌宠与菜单
    // 不受影响，配置继续走 localStorage 后端。
    ctx.inject(['slots', 'locale', 'settingsScope', 'connection', 'remote'], (cardCtx: unknown) => {
      registerSettingsCard(cardCtx as Parameters<typeof registerSettingsCard>[0], store)
    })
    // 验证钩子：?petdebug=1 时暴露句柄（playwright 触发 celebrate/fly 等）
    if (new URLSearchParams(location.search).has('petdebug')) {
      ;(window as unknown as { __niulai?: PetHandle }).__niulai = pet
    }
    ctx.effect(() => () => pet.destroy(), 'niulai-pet pet')
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
