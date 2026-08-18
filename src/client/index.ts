/**
 * dsh-niulai-pet client 入口：挂桌宠 + 订阅 sessions 快照触发庆祝。
 *
 * 纯 client 插件（package.json 只有 dsh.client）：市场的 client-only shim
 * 挂载即可运行，刷新页面生效，更新免重启。
 *
 * 触发源：可选注入 client runtime 的 sessions 服务（ObservableSnapshot 模式），
 * 盯每个会话的 running / completed 变化：
 *  - running true→false：一轮任务跑完（含当前正在看的会话）
 *  - completed 新置 true：后台会话完成（sidebar 绿点同一信号）
 * 服务不在场（旧宿主）时降级为仅手动交互，打一条 warn。
 *
 * 素材 dataurl 内联（见 build.mjs）：assets/ 目录换文件 + npm run build +
 * 刷新页面即换形象/声音，assets/ 不入库。
 * @module dsh-niulai-pet/client
 */

import petImage from '../../assets/pet.png'
import mama1 from '../../assets/mama1.mp3'
import mama2 from '../../assets/mama2.mp3'
import mama3 from '../../assets/mama3.mp3'
import mama4 from '../../assets/mama4.mp3'
import { mountPet } from './pet.js'

/** 必需服务：无（slots 都不用 —— 桌宠是独立 fixed 浮层）。 */
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

function watchSessions(ctx: ClientCtx, onDone: () => void): void {
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
            onDone()
          }
        }
        prev.set(id, now)
      }
      for (const id of [...prev.keys()]) {
        if (!(id in snap.byId)) prev.delete(id)
      }
    })
    ctx.effect(() => unsub, 'niulai-pet sessions watch')
  })
}

export function apply(ctx: ClientCtx): void {
  const start = (): void => {
    const pet = mountPet({ image: petImage, sounds: [mama1, mama2, mama3, mama4] })
    watchSessions(ctx, pet.celebrate)
    ctx.effect(() => () => pet.destroy(), 'niulai-pet pet')
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
