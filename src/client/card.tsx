/**
 * 设置卡片（dsh rc.7+ 设置页 · 插件配置区）：牛来桌宠的命名空间卡片。
 *
 * 与官方卡片同一配对机制：host 半 installSettingsSection 注册命名空间，
 * 本半以同名字符串 key 注册进 `settings.plugin.item` slot，设置页自动配对。
 * 控件（switch/步进/下拉）自绘、即时写入（scope.set 自带 revision 乐观围栏，
 * 离散控件不需要官方 CardForm 的 staged/save 模型）；与浮层菜单共读同一份
 * ConfigStore，任一端改动经 subscribe 双向反映。
 *
 * React 由 dsh 运行时模块表提供（platform seed，构建时 external）。
 * @module dsh-niulai-pet/card
 */

import { useState } from 'react'
import type { ActionName } from './pet.js'
import { ACTION_ORDER } from './pet.js'
import { SKINS } from './skins.js'
import type { ConfigStore, PetConfig, PetConfigPatch, SettingsScopeLike } from './config.js'

/** 卡片编辑的命名空间（与 host 半 settingsNamespace('niulai-pet') 配对，改名两边同步）。 */
export const CARD_NS = 'niulai-pet'

/** 卡片字典（zh/en 双语，locale 服务要求两全）。 */
const zh = {
  title: '牛来桌宠',
  description: '右下角桌宠的叫声、气泡唠叨与动作绑定',
  sound: '声音',
  shoutOnDone: '完成时喊',
  shoutCount: '完成连喊',
  talkative: '气泡唠叨',
  skin: '皮肤',
  doneAction: '完成时动作',
  pokeAction: '戳我动作',
  readOnly: '当前 dsh 以只读模式运行，配置不可修改。',
  expand: '展开',
  collapse: '收起',
  'action.signature': '签名动作',
  'action.fly': '飞行',
  'action.dance': '摇摆舞',
  'action.spin': '转圈',
  'action.hops': '连跳',
  'action.roll': '翻滚',
  'action.breach': '跃出水面',
  'action.sway': '奶牛摇',
  'action.random': '随机',
}

const en: Record<keyof typeof zh, string> = {
  title: 'Niulai Pet',
  description: 'Voice, chatter bubbles, and per-skin action bindings of the corner pet',
  sound: 'Sound',
  shoutOnDone: 'Shout on task done',
  shoutCount: 'Shout repeats',
  talkative: 'Chatter bubbles',
  skin: 'Skin',
  doneAction: 'Action on done',
  pokeAction: 'Action on poke',
  readOnly: 'This dsh instance runs read-only; configuration cannot be changed.',
  expand: 'Expand',
  collapse: 'Collapse',
  'action.signature': 'Signature',
  'action.fly': 'Fly',
  'action.dance': 'Dance',
  'action.spin': 'Spin',
  'action.hops': 'Hops',
  'action.roll': 'Roll',
  'action.breach': 'Breach',
  'action.sway': 'Sway',
  'action.random': 'Random',
}

/** 卡片渲染快照：scope 可用性/可写性 + 生效配置。 */
export interface NiulaiCardState {
  /** false = 命名空间未被 Host serve（rc.6 形态）：卡片不渲染。 */
  ready: boolean
  writable: boolean
  cfg: PetConfig
}

/** slot 注入面（hooks 由渲染器绑定成 useNiulaiPet 选择器 hook，其余透传）。 */
export interface NiulaiCardFace {
  hooks: { niulaiPet: { getSnapshot(): NiulaiCardState; subscribe(fn: () => void): () => void } }
  set(patch: PetConfigPatch): void
  setSkinAction(skin: string, event: 'done' | 'poke', action: ActionName): void
}

/** 组件 props（框架 t 座 + 注入面绑定后的形态，结构化自描）。 */
export interface NiulaiCardProps {
  t(key: string, params?: Record<string, unknown>): string
  useNiulaiPet<S>(selector: (state: NiulaiCardState) => S): S
  set(patch: PetConfigPatch): void
  setSkinAction(skin: string, event: 'done' | 'poke', action: ActionName): void
}

/** 卡片状态源：合并 ConfigStore（生效配置）与 scope（ready/writable）为一个 observable。 */
class CardController {
  private state: NiulaiCardState
  private readonly listeners = new Set<() => void>()
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly store: ConfigStore,
    scope: SettingsScopeLike,
  ) {
    this.state = this.project(scope)
    const rebuild = (): void => {
      this.state = this.project(scope)
      for (const fn of this.listeners) fn()
    }
    this.disposers.push(store.subscribe(rebuild), scope.subscribe(rebuild))
  }

  private project(scope: SettingsScopeLike): NiulaiCardState {
    const snap = scope.getSnapshot()
    return { ready: snap.status === 'ready', writable: snap.writable, cfg: this.store.getSnapshot() }
  }

  readonly observable = {
    getSnapshot: (): NiulaiCardState => this.state,
    subscribe: (fn: () => void): (() => void) => {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }

  inject(): NiulaiCardFace {
    return {
      hooks: { niulaiPet: this.observable },
      set: (patch) => { this.store.set(patch) },
      setSkinAction: (skin, event, action) => { this.store.setSkinAction(skin, event, action) },
    }
  }

  dispose(): void {
    for (const d of this.disposers) d()
  }
}

// ---- 自绘控件（贴官方卡片的 --dsw-* 令牌观感，全部带回退色）----

const colors = {
  border: 'var(--dsw-alias-border-l2, rgba(255,255,255,.12))',
  bgCard: 'var(--dsw-alias-bg-layer-3, rgba(255,255,255,.03))',
  labelPrimary: 'var(--dsw-alias-label-primary, #e4e4e7)',
  labelTertiary: 'var(--dsw-alias-label-tertiary, #8b8b94)',
  brand: 'var(--dsw-alias-brand-primary, #3b82f6)',
  trackOff: 'var(--dsw-alias-bg-module-platform, #52525b)',
}

function Switch(props: { on: boolean; disabled: boolean; label: string; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => { props.onChange(!props.on) }}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 0, padding: 0, flex: 'none',
        position: 'relative', transition: 'background .15s',
        cursor: props.disabled ? 'default' : 'pointer',
        background: props.on ? colors.brand : colors.trackOff,
        opacity: props.disabled ? 0.4 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: props.on ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left .15s',
      }} />
    </button>
  )
}

function Stepper(props: { value: number; min: number; max: number; disabled: boolean; label: string; onChange(n: number): void }) {
  const btnStyle = (off: boolean): React.CSSProperties => ({
    width: 24, height: 24, borderRadius: 6, border: `1px solid ${colors.border}`, padding: 0,
    background: 'none', color: colors.labelPrimary, fontSize: 14, lineHeight: 1,
    cursor: off ? 'default' : 'pointer', opacity: off ? 0.35 : 1,
  })
  return (
    <span role="group" aria-label={props.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" style={btnStyle(props.disabled || props.value <= props.min)} disabled={props.disabled || props.value <= props.min} onClick={() => { props.onChange(props.value - 1) }}>−</button>
      <span style={{ minWidth: 14, textAlign: 'center', color: colors.labelPrimary, fontSize: 13 }}>{props.value}</span>
      <button type="button" style={btnStyle(props.disabled || props.value >= props.max)} disabled={props.disabled || props.value >= props.max} onClick={() => { props.onChange(props.value + 1) }}>+</button>
    </span>
  )
}

const selectStyle = (disabled: boolean): React.CSSProperties => ({
  appearance: 'none', border: `1px solid ${colors.border}`, borderRadius: 8,
  background: 'transparent', color: colors.labelPrimary, font: 'inherit', fontSize: 13,
  padding: '4px 10px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
  colorScheme: 'dark light',
})

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '9px 0' }}>
      <span style={{ fontSize: 13, color: colors.labelPrimary }}>{props.label}</span>
      {props.children}
    </div>
  )
}

/** 设置卡片组件：命名空间未 serve 时不渲染（与官方卡片同语义）。 */
export function NiulaiCard(props: NiulaiCardProps) {
  const [open, setOpen] = useState(false)
  const { t } = props
  const state = props.useNiulaiPet((s) => s)
  if (!state.ready) return null
  const { cfg, writable } = state
  const disabled = !writable
  const skinName = SKINS.find((s) => s.id === cfg.skin)?.name ?? cfg.skin
  const doneAction = cfg.actions[cfg.skin]?.done ?? 'signature'
  const pokeAction = cfg.actions[cfg.skin]?.poke ?? 'hops'
  return (
    <li style={{
      listStyle: 'none', border: `1px solid ${colors.border}`, borderRadius: 12,
      background: colors.bgCard, transition: 'border-color .16s',
    }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
        style={{
          width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit',
          color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: colors.labelPrimary }}>🐮 {t('title')}</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: colors.labelTertiary }}>{t('description')}</span>
        </span>
        <span style={{
          flex: 'none', color: colors.labelTertiary, transition: 'transform .16s',
          transform: open ? 'rotate(180deg)' : undefined,
        }}>▾</span>
      </button>
      {open
        ? (
          <div style={{ borderTop: `1px solid ${colors.border}`, margin: '0 16px', padding: '4px 0 12px' }}>
            {!writable ? <p role="status" style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: colors.labelTertiary }}>{t('readOnly')}</p> : null}
            <Row label={t('sound')}>
              <Switch on={!cfg.muted} disabled={disabled} label={t('sound')} onChange={(on) => { props.set({ muted: !on }) }} />
            </Row>
            <Row label={t('shoutOnDone')}>
              <Switch on={cfg.shoutOnDone} disabled={disabled} label={t('shoutOnDone')} onChange={(on) => { props.set({ shoutOnDone: on }) }} />
            </Row>
            <Row label={t('shoutCount')}>
              <Stepper value={cfg.shoutCount} min={1} max={3} disabled={disabled} label={t('shoutCount')} onChange={(n) => { props.set({ shoutCount: n }) }} />
            </Row>
            <Row label={t('talkative')}>
              <Switch on={cfg.talkative} disabled={disabled} label={t('talkative')} onChange={(on) => { props.set({ talkative: on }) }} />
            </Row>
            <Row label={t('skin')}>
              <select
                style={selectStyle(disabled)}
                value={cfg.skin}
                disabled={disabled}
                onChange={(e) => { props.set({ skin: e.target.value }) }}
              >
                {SKINS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Row>
            <Row label={`${t('doneAction')} · ${skinName}`}>
              <select
                style={selectStyle(disabled)}
                value={doneAction}
                disabled={disabled}
                onChange={(e) => { props.setSkinAction(cfg.skin, 'done', e.target.value as ActionName) }}
              >
                {ACTION_ORDER.map((a) => <option key={a} value={a}>{t(`action.${a}`)}</option>)}
              </select>
            </Row>
            <Row label={`${t('pokeAction')} · ${skinName}`}>
              <select
                style={selectStyle(disabled)}
                value={pokeAction}
                disabled={disabled}
                onChange={(e) => { props.setSkinAction(cfg.skin, 'poke', e.target.value as ActionName) }}
              >
                {ACTION_ORDER.map((a) => <option key={a} value={a}>{t(`action.${a}`)}</option>)}
              </select>
            </Row>
          </div>
        )
        : null}
    </li>
  )
}

/** 卡片半需要的 client ctx 面（cordis 子 fiber 注入后保证在场，结构化自描）。 */
interface CardCtx {
  settingsScope: { bind(spec: { namespace: string }): SettingsScopeLike }
  locale: { register(ns: string, dicts: Record<string, Record<string, string>>): () => void }
  slots: {
    inject(key: string, callback: () => (() => void)): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  effect(fn: () => void | (() => void), label?: string): void
}

/**
 * 注册设置卡片：bind 命名空间 scope（ConfigStore 切换后端 + 旧值迁移）、
 * 注册双语字典、按 slot 声明生命周期注册卡片。rc.6 无这些服务时
 * 本函数所在的 ctx.inject 子 fiber 永不激活，什么都不会发生。
 */
export function registerSettingsCard(ctx: CardCtx, store: ConfigStore): void {
  const scope = ctx.settingsScope.bind({ namespace: CARD_NS })
  ctx.effect(() => store.attachScope(scope), 'niulai-pet settings scope')
  ctx.effect(() => ctx.locale.register(CARD_NS, { zh, en }), 'niulai-pet card locales')
  const controller = new CardController(store, scope)
  ctx.effect(() => () => { controller.dispose() }, 'niulai-pet card controller')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: CARD_NS,
    locale: CARD_NS,
    inject: () => controller.inject(),
  }, NiulaiCard))
}
