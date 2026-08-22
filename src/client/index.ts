/**
 * dsh-niulai-pet client 入口：挂载桌宠 + 订阅 sessions 服务驱动庆祝/耗时气泡
 * + （dsh rc.7+）注册设置卡片。
 *
 * 皮肤注册表在 skins.ts（独立模块，demo 试玩页直接引它，不经过本入口——
 * 本入口引入设置卡片会带上 react，demo bundle 不含 react）。
 * @module dsh-niulai-pet/client
 */

import { mountPet, type PetHandle } from './pet.js'
import { SKINS, PackRegistry } from './skins.js'
import { defaultActionsFor } from './packs.js'
import { ConfigStore } from './config.js'
import { registerSettingsCard } from './card.js'
import { VoiceDebugBus } from './voice-debug.js'

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
  /** 人读标签：durable 标题，其次项目目录名，再退 session id。 */
  displayTitle?: string
}

interface SessionsService {
  list: Snapshot<{ byId: Record<string, SessionRow> }>
}

interface WatchCallbacks {
  /** 有会话完成时触发。 */
  onDone: () => void
  /** 忙闲沿变化：忙起传起始时间与会话标签，闲落传 null。 */
  onBusy: (busy: { since: number; label: string } | null) => void
}

/** 标签裁到 12 字（durable 标题可能很长）。 */
function shortLabel(title: string | undefined): string {
  const t = (title ?? '').trim()
  if (t === '') return 'AI'
  return t.length > 12 ? `${t.slice(0, 12)}…` : t
}

function watchSessions(ctx: ClientCtx, cb: WatchCallbacks): void {
  ctx.inject(['sessions'], (raw: unknown) => {
    const sessions = (raw as { sessions?: SessionsService } | undefined)?.sessions
    if (sessions === undefined || typeof sessions.list?.subscribe !== 'function') {
      console.warn('[dsh-niulai-pet] sessions 服务不在场（旧宿主？）——任务完成触发停用，仅手动交互')
      return
    }
    const prev = new Map<string, { running: boolean; completed: boolean }>()
    /** 各在跑会话的起跑观测点（快照无 startedAt 字段，只能从本页观测到 running 起算）。 */
    const runningSince = new Map<string, number>()
    const seed = sessions.list.getSnapshot()
    for (const [id, row] of Object.entries(seed.byId)) {
      prev.set(id, { running: row.running === true, completed: row.completed === true })
      if (row.running === true) runningSince.set(id, Date.now())
    }
    /** 当前在跑里起跑最早的那个（气泡报它的标签与耗时）。 */
    const currentBusy = (): { since: number; label: string } | null => {
      const snap = sessions.list.getSnapshot()
      let best: { since: number; label: string } | null = null
      for (const [id, since] of runningSince) {
        if (best !== null && since >= best.since) continue
        best = { since, label: shortLabel(snap.byId[id]?.displayTitle) }
      }
      return best
    }
    let wasAnyRunning = runningSince.size > 0
    if (wasAnyRunning) cb.onBusy(currentBusy())
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
          if (!before.running && now.running) runningSince.set(id, Date.now())
        }
        if (!now.running) runningSince.delete(id)
        prev.set(id, now)
      }
      for (const id of [...prev.keys()]) {
        if (!(id in snap.byId)) {
          prev.delete(id)
          runningSince.delete(id)
        }
      }
      const anyRunning = runningSince.size > 0
      // 忙中每个快照都推一次：标签可能滞后投影进来（displayTitle 先空后有）
      if (anyRunning) cb.onBusy(currentBusy())
      else if (wasAnyRunning) cb.onBusy(null)
      wasAnyRunning = anyRunning
    })
    ctx.effect(() => unsub, 'niulai-pet sessions watch')
  })
}

export function apply(ctx: ClientCtx): void {
  const start = (): void => {
    // 角色包注册表：内置先行，IndexedDB 自定义包异步装载后推送热更新
    // （桌宠换装、选择器扩项、ConfigStore 白名单放宽三路各自订阅）
    const registry = new PackRegistry()
    const store = new ConfigStore({ skinIds: registry.getSnapshot().skinIds, defaultSkin: 'niulai' })
    registry.subscribe(() => store.updateSkinIds(registry.getSnapshot().skinIds))
    const voiceDebug = new VoiceDebugBus()
    const pet = mountPet({
      skins: registry.getSnapshot().skins,
      defaultSkin: 'niulai',
      subscribeSkins: (fn) => registry.subscribe(() => fn(registry.getSnapshot().skins)),
      defaultActions: (gid) => defaultActionsFor(registry.getSnapshot().characters, gid),
    }, store, voiceDebug)
    void registry.init()
    watchSessions(ctx, { onDone: pet.celebrate, onBusy: pet.setBusy })
    // 设置卡片（dsh rc.7+）：可选注入——settingsScope/slots/locale 任一缺席
    // （rc.6 及更早）子 fiber 就永远等不到服务，静默没有卡片；桌宠与菜单
    // 不受影响，配置继续走 localStorage 后端。
    ctx.inject(['slots', 'locale', 'settingsScope', 'connection', 'remote'], (cardCtx: unknown) => {
      registerSettingsCard(cardCtx as Parameters<typeof registerSettingsCard>[0], store, voiceDebug, registry)
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
