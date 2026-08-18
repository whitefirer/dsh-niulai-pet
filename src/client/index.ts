/**
 * dsh-niulai-pet client 入口：挂载桌宠 + 订阅 sessions 服务驱动庆祝/耗时气泡。
 *
 * 皮肤素材全部从本地 assets/ 内联（esbuild dataurl），随库发布；
 * 奶牛/熊猫/鲸鱼为手绘扁平风。刷新页面即换形象/声音。
 * @module dsh-niulai-pet/client
 */

import petImage from '../../assets/pet.png'
import petShout from '../../assets/pet_shout.png'
import petBlink from '../../assets/pet_blink.png'
import petYoung from '../../assets/pet_young.png'
import petYoungShout from '../../assets/pet_young_shout.png'
import petYoungBlink from '../../assets/pet_young_blink.png'
import petFly from '../../assets/pet_fly.png'
import petFlyShout from '../../assets/pet_fly_shout.png'
import petYoungFly from '../../assets/pet_young_fly.png'
import petYoungFlyShout from '../../assets/pet_young_fly_shout.png'
import cowImage from '../../assets/cow.png'
import cowBlink from '../../assets/cow_blink.png'
import pandaImage from '../../assets/panda.png'
import pandaBlink from '../../assets/panda_blink.png'
import whaleImage from '../../assets/whale.png'
import whaleBlink from '../../assets/whale_blink.png'
import whaleSpout from '../../assets/whale_spout.png'
import mama1 from '../../assets/mama1.mp3'
import mama2 from '../../assets/mama2.mp3'
import { mountPet, type PetHandle, type SkinDef } from './pet.js'

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

/** 皮肤注册表：新角色在这里挂素材即上线。 */
const SKINS: SkinDef[] = [
  {
    id: 'niulai',
    name: '牛来',
    image: petImage,
    imageShout: petShout,
    imageBlink: petBlink,
    imageFly: petFly,
    imageFlyShout: petFlyShout,
    voice: 'mama',
    sounds: [mama1, mama2],
    signature: 'hops',
    shoutBubble: '妈~~妈~~',
    quips: ['妈——！', '我会飞你信不信'],
  },
  {
    id: 'young',
    name: '小黄',
    image: petYoung,
    imageShout: petYoungShout,
    imageBlink: petYoungBlink,
    imageFly: petYoungFly,
    imageFlyShout: petYoungFlyShout,
    voice: 'mama',
    sounds: [mama1, mama2],
    signature: 'roll',
    shoutBubble: '妈~~',
    quips: ['我还小，别卷我'],
  },
  {
    id: 'cow',
    name: '奶牛',
    image: cowImage,
    imageBlink: cowBlink,
    voice: 'moo',
    signature: 'roll',
    shoutBubble: '哞——！',
    quips: ['今天的奶产量达标了吗', '黑白配，永不过时'],
  },
  {
    id: 'panda',
    name: '熊猫',
    image: pandaImage,
    imageBlink: pandaBlink,
    voice: 'squeak',
    signature: 'roll',
    shoutBubble: '嗯嗯！',
    quips: ['竹子比 bug 好吃', '滚滚滚，别催'],
  },
  {
    id: 'whale',
    name: '蓝鲸',
    image: whaleImage,
    imageBlink: whaleBlink,
    imageSpout: whaleSpout,
    voice: 'whale',
    signature: 'breach',
    shoutBubble: '噗——！',
    quips: ['深海里没有 deadline', '咕嘟咕嘟'],
  },
]

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
    const pet = mountPet({ skins: SKINS, defaultSkin: 'niulai' })
    watchSessions(ctx, { onDone: pet.celebrate, onBusy: pet.setBusy })
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
