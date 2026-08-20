/**
 * 配置存取层：桌宠与设置卡片共用的 ConfigStore。
 *
 * 双路径后端：
 *  - localStorage（`dsh-niulai-pet:state-v1`）：现状逻辑，dsh rc.6 及更早
 *    （无 settingsScope 服务）的回退路径，也是 standalone 试玩页的唯一路径。
 *  - dsh settings scope（rc.7+）：Host 持久化 ~/.dsh/settings.yaml
 *    （schema 默认 < cordis entry < user 文档三层），scope.set/unset 带
 *    revision 乐观围栏；写入未落地期间用 pending 覆盖层做乐观回显。
 *
 * 位置 x 不进本模块（按设备的，永远留 localStorage，pet.ts 自行读写）。
 *
 * 旧版文档迁移（loadPersisted 内一次性完成）：全局 doneAction/pokeAction
 * 改写为按皮肤的 actions 映射（忠实起见全皮肤铺同一旧绑定）；皮肤 id
 * `classic` 改写为 defaultSkin。scope 路径首次 ready 时再把 localStorage
 * 旧值 seed 进 user 层（仅 user 层没有的字段，不覆盖设置页已改过的值）。
 */

import type { ActionName } from './pet.js'

/** localStorage 文档键（v1：位置 x 与配置同文档；x 由 pet.ts 直读直写）。 */
const STORE_KEY = 'dsh-niulai-pet:state-v1'

/** 一个皮肤的动作绑定（完成/戳一下）。 */
export interface SkinActionBinding {
  done?: ActionName
  poke?: ActionName
}

/** 解析后的完整生效配置。 */
export interface PetConfig {
  muted: boolean
  /** 任务完成时喊（默认开）。 */
  shoutOnDone: boolean
  /** 完成时连喊几声（1-3）。 */
  shoutCount: number
  /** 气泡唠叨（默认开）。 */
  talkative: boolean
  /** 当前皮肤 id。 */
  skin: string
  /** 按皮肤的动作绑定；缺配的皮肤由消费端回落默认（done=签名，poke=连跳）。 */
  actions: Record<string, SkinActionBinding>
  /** 自定义唠叨语录（空 = 用内置通用池；非空时替换它，皮肤专属语录仍并入）。 */
  quips: string[]
  /** 完成动作延迟秒数（0 = 立即）。 */
  doneDelaySec: number
  /** 完成后循环喊直到互动停止。 */
  shoutLoop: boolean
  /** 喊完/循环被打断时妈妈回一句「牛来！」。 */
  replyNiulai: boolean
  /** 语音停喊：循环喊期间开麦识别「牛来」（默认关；开启需麦克风授权）。 */
  voiceControl: boolean
  /** 麦克风设备 id（空 = 系统默认）。 */
  micDeviceId: string
  /** 识别阈值（越小越严，0.3-0.85）。 */
  voiceThreshold: number
  /** 用户自录「牛来」模板（wav dataurl，空=没录）。 */
  voiceTemplate: string
}

/** 可写子集（整棵 actions 映射一次替换，调用方负责读-并-写）。 */
export type PetConfigPatch = Partial<PetConfig>

/** localStorage 文档形状（含仅迁移期读取的旧键）。 */
export interface Persisted {
  x?: number
  muted?: boolean
  shoutOnDone?: boolean
  talkative?: boolean
  skin?: string
  shoutCount?: number
  actions?: Record<string, SkinActionBinding>
  quips?: string[]
  doneDelaySec?: number
  shoutLoop?: boolean
  replyNiulai?: boolean
  voiceControl?: boolean
  micDeviceId?: string
  voiceThreshold?: number
  voiceTemplate?: string
  /** 旧全局绑定（仅迁移读取，见模块注释）。 */
  doneAction?: ActionName
  pokeAction?: ActionName
}

/** settings scope 最小面（dsh client runtime 的发布形状，结构化自描）。 */
export interface SettingsScopeLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value?: unknown
    user?: unknown
    writable: boolean
  }
  subscribe(fn: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 语录清洗：只留字符串、去空白、丢空条；上限 50 条 / 每条 120 字（防撑爆气泡）。 */
function sanitizeQuips(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim().slice(0, 120))
    .filter((q) => q.length > 0)
    .slice(0, 50)
}

/**
 * 读 localStorage 文档，顺手完成一次性旧版迁移（见模块注释）。
 * 迁移写回失败（隐私模式）时内存里照样用迁移后的值。
 */
export function loadPersisted(skinIds: readonly string[] = [], defaultSkin = 'niulai'): Persisted {
  let p: Persisted = {}
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw !== null) p = JSON.parse(raw) as Persisted
  } catch {
    return {}
  }
  let changed = false
  if (p.skin === 'classic') {
    p.skin = defaultSkin
    changed = true
  }
  if (p.doneAction !== undefined || p.pokeAction !== undefined) {
    // 旧绑定全局生效，忠实迁移 = 全皮肤铺上旧值（只铺存在的键，
    // 缺席的键留空由消费端回落该皮肤默认）
    const actions: Record<string, SkinActionBinding> = {}
    for (const id of skinIds) {
      const entry: SkinActionBinding = {}
      if (p.doneAction !== undefined) entry.done = p.doneAction
      if (p.pokeAction !== undefined) entry.poke = p.pokeAction
      actions[id] = entry
    }
    if (skinIds.length > 0) {
      p.actions = { ...p.actions, ...actions }
      changed = true
    }
    delete p.doneAction
    delete p.pokeAction
    changed = true
  }
  if (changed) savePersisted(p)
  return p
}

export function savePersisted(p: Persisted): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p))
  } catch { /* 隐私模式放弃记忆 */ }
}

/** 配置读写门面：localStorage / settings scope 双后端，对消费端透明。 */
export class ConfigStore {
  private scope: SettingsScopeLike | undefined
  /** scope 写入未落地期间的乐观覆盖层（字段级）。 */
  private readonly pending = new Map<string, unknown>()
  private snapshot: PetConfig
  private readonly listeners = new Set<() => void>()
  private readonly skinIds: readonly string[]
  private readonly defaultSkin: string

  constructor(opts: { skinIds: readonly string[]; defaultSkin: string }) {
    this.skinIds = opts.skinIds
    this.defaultSkin = opts.defaultSkin
    this.snapshot = this.resolve()
  }

  /** 当前生效配置（稳定引用：无变更时返回同一对象，可直供 uSES）。 */
  getSnapshot(): PetConfig {
    return this.snapshot
  }

  /** 监听变更（本地写入、scope 落地、外部变更、后端切换都会触发）。 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** 写配置（local 同步落盘；scope 乐观回显 + 异步落地）。 */
  set(patch: PetConfigPatch): void {
    const scope = this.scope
    if (scope === undefined) {
      savePersisted({ ...loadPersisted(this.skinIds, this.defaultSkin), ...patch })
      this.republish()
      return
    }
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue
      this.pending.set(field, value)
      // 落地（resolve）时**不急着清**乐观覆盖：host 接受与文档回播之间有个窗口，
      // 此刻清掉会让快照闪回旧值（订阅方看到开关抖动——循环喊曾被这么闪停过）。
      // pending 在 resolve() 里等快照真正反映出该值时才落槌；拒绝/3s 兜底才清。
      void scope.set(field, value).then(
        () => { this.republish() },
        () => { this.pending.delete(field); this.republish() },
      )
      const captured = value
      setTimeout(() => {
        if (JSON.stringify(this.pending.get(field)) === JSON.stringify(captured)) {
          this.pending.delete(field)
          this.republish()
        }
      }, 3000)
    }
    this.republish()
  }

  /** 改一个皮肤的动作绑定（读-并-写整棵映射）。 */
  setSkinAction(skin: string, event: 'done' | 'poke', action: ActionName): void {
    const actions = { ...this.snapshot.actions }
    actions[skin] = { ...actions[skin], [event]: action }
    this.set({ actions })
  }

  /**
   * 接入 settings scope（rc.7+）：就绪后切后端并把 localStorage 旧值 seed
   * 进 user 层（仅 user 层缺席的字段）。返回 detach（服务下线时调，
   * 回退 localStorage 后端）。
   */
  attachScope(scope: SettingsScopeLike): () => void {
    const sync = (): void => {
      if (this.scope !== scope) {
        // 只在首次 ready 时切换：loading 期间保持 localStorage 后端，
        // unavailable（rc.6 形态/namespace 未被 serve）永不切换
        if (scope.getSnapshot().status !== 'ready') return
        this.scope = scope
        this.seedFromLegacy(scope)
      }
      this.republish()
    }
    sync()
    const unsub = scope.subscribe(sync)
    return () => {
      unsub()
      if (this.scope === scope) {
        this.scope = undefined
        this.pending.clear()
        this.republish()
      }
    }
  }

  /** 把 localStorage 旧值 seed 进 user 层空缺的字段（乐观层先行，免闪默认值）。 */
  private seedFromLegacy(scope: SettingsScopeLike): void {
    const user = scope.getSnapshot().user
    const legacy = loadPersisted(this.skinIds, this.defaultSkin)
    const writes: Array<[string, unknown]> = []
    const cfg = this.fromPersisted(legacy) // 复用校验（类型/范围/皮肤白名单）
    for (const field of ['muted', 'shoutOnDone', 'shoutCount', 'talkative', 'skin', 'quips', 'doneDelaySec', 'shoutLoop', 'replyNiulai', 'voiceControl', 'micDeviceId', 'voiceThreshold', 'voiceTemplate'] as const) {
      if (legacy[field] !== undefined && !(isRecord(user) && field in user)) {
        writes.push([field, cfg[field]])
      }
    }
    if (legacy.actions !== undefined && Object.keys(legacy.actions).length > 0
      && !(isRecord(user) && 'actions' in user)) {
      writes.push(['actions', cfg.actions])
    }
    for (const [field, value] of writes) {
      this.pending.set(field, value)
      void scope.set(field, value).then(
        () => { this.pending.delete(field); this.republish() },
        () => { this.pending.delete(field); this.republish() },
      )
    }
  }

  private republish(): void {
    this.snapshot = this.resolve()
    for (const fn of this.listeners) fn()
  }

  /** 从当前后端解析生效配置（scope 模式叠 pending 乐观层；快照已反映的 pending 落槌清除）。 */
  private resolve(): PetConfig {
    const scope = this.scope
    if (scope === undefined) return this.fromPersisted(loadPersisted(this.skinIds, this.defaultSkin))
    const cfg = this.fromUnknown(scope.getSnapshot().value)
    if (this.pending.size === 0) return cfg
    const merged: PetConfig = { ...cfg, actions: { ...cfg.actions } }
    for (const [field, value] of this.pending) {
      // host 快照已反映出该值 → 落槌（值以快照为准），不再叠乐观层
      if (JSON.stringify(cfg[field as keyof PetConfig]) === JSON.stringify(value)) {
        this.pending.delete(field)
        continue
      }
      if (field === 'actions' && isRecord(value)) {
        merged.actions = this.sanitizeActions(value)
      } else if (field in merged) {
        Object.assign(merged, { [field]: value })
      }
    }
    return merged
  }

  /** localStorage 文档 → 生效配置（含校验与回落）。 */
  private fromPersisted(p: Persisted): PetConfig {
    return {
      muted: p.muted === true,
      shoutOnDone: p.shoutOnDone !== false,
      shoutCount: typeof p.shoutCount === 'number' && Number.isInteger(p.shoutCount)
        ? Math.min(99, Math.max(1, p.shoutCount)) : 1,
      talkative: p.talkative !== false,
      skin: this.validSkin(p.skin),
      actions: this.sanitizeActions(p.actions),
      quips: sanitizeQuips(p.quips),
      doneDelaySec: typeof p.doneDelaySec === 'number' && Number.isInteger(p.doneDelaySec)
        ? Math.min(120, Math.max(0, p.doneDelaySec)) : 0,
      shoutLoop: p.shoutLoop === true,
      replyNiulai: p.replyNiulai !== false,
      voiceControl: p.voiceControl === true,
      micDeviceId: typeof p.micDeviceId === 'string' ? p.micDeviceId : '',
      voiceThreshold: typeof p.voiceThreshold === 'number' && p.voiceThreshold >= 0.3 && p.voiceThreshold <= 0.85
        ? p.voiceThreshold : 0.52,
      voiceTemplate: typeof p.voiceTemplate === 'string' && p.voiceTemplate.startsWith('data:audio/') && p.voiceTemplate.length < 300_000
        ? p.voiceTemplate : '',
    }
  }

  /** scope 解析值（schema 已过）→ 生效配置（仍防御性校验一遍）。 */
  private fromUnknown(v: unknown): PetConfig {
    const r = isRecord(v) ? v : {}
    return this.fromPersisted({
      muted: r.muted === true,
      shoutOnDone: r.shoutOnDone !== false,
      talkative: r.talkative !== false,
      shoutCount: typeof r.shoutCount === 'number' ? r.shoutCount : undefined,
      skin: typeof r.skin === 'string' ? r.skin : undefined,
      actions: isRecord(r.actions) ? r.actions as Record<string, SkinActionBinding> : undefined,
      quips: Array.isArray(r.quips) ? r.quips as string[] : undefined,
      doneDelaySec: typeof r.doneDelaySec === 'number' ? r.doneDelaySec : undefined,
      shoutLoop: r.shoutLoop === true,
      replyNiulai: r.replyNiulai !== false,
      voiceControl: r.voiceControl === true,
      micDeviceId: typeof r.micDeviceId === 'string' ? r.micDeviceId : undefined,
      voiceThreshold: typeof r.voiceThreshold === 'number' ? r.voiceThreshold : undefined,
      voiceTemplate: typeof r.voiceTemplate === 'string' ? r.voiceTemplate : undefined,
    })
  }

  private validSkin(id: string | undefined): string {
    if (id !== undefined && this.skinIds.includes(id)) return id
    return this.defaultSkin
  }

  /** 绑定清洗：皮肤 id 白名单 + 字段形状；动作名合法性由消费端 asAction 回落与 Host schema 共同围栏。 */
  private sanitizeActions(input: Record<string, unknown> | undefined): Record<string, SkinActionBinding> {
    const out: Record<string, SkinActionBinding> = {}
    if (input === undefined) return out
    for (const [skin, binding] of Object.entries(input)) {
      if (!this.skinIds.includes(skin) || !isRecord(binding)) continue
      const entry: SkinActionBinding = {}
      if (typeof binding.done === 'string') entry.done = binding.done as ActionName
      if (typeof binding.poke === 'string') entry.poke = binding.poke as ActionName
      if (entry.done !== undefined || entry.poke !== undefined) out[skin] = entry
    }
    return out
  }
}
