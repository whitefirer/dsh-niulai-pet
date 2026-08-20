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

import { useEffect, useState } from 'react'
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
  doneDelay: '完成延迟（秒）',
  shoutLoop: '循环喊到互动停止',
  replyNiulai: '妈妈回应「牛来」',
  voiceControl: '语音停喊（喊「牛来」）',
  voiceUnsupported: '当前访问方式不支持麦克风（需 https 或 localhost 打开）',
  voiceDenied: '麦克风授权被拒——若在 cenacle 内嵌窗口里，请换独立标签页打开 dsh 再开',
  voiceNoMic: '没检测到麦克风设备，语音停喊未开启',
  micDevice: '麦克风设备',
  micDefault: '系统默认',
  micTest: '测试',
  micTestStop: '停止',
  micTestHint: '说句话，电平条应起伏',
  voiceGranted: '状态：已授权（仅循环喊期间开麦）',
  voiceIdle: '状态：未授权',
  talkative: '气泡唠叨',
  quips: '唠叨语录',
  quipsHint: '一行一条；设置后替换内置通用语录（皮肤专属语录不受影响），留空恢复内置。',
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
  doneDelay: 'Done delay (s)',
  shoutLoop: 'Loop shout until touched',
  replyNiulai: 'Mom answers "Niulai!"',
  voiceControl: 'Voice stop (shout "Niulai!")',
  voiceUnsupported: 'Microphone is unavailable on this origin (needs https or localhost)',
  voiceDenied: 'Microphone permission denied — if inside an embedded (cenacle) window, open dsh in its own tab and retry',
  voiceNoMic: 'No microphone device detected; voice stop stays off',
  micDevice: 'Microphone',
  micDefault: 'System default',
  micTest: 'Test',
  micTestStop: 'Stop',
  micTestHint: 'Say something — the level bar should move',
  voiceGranted: 'Status: granted (mic is live only while loop-shouting)',
  voiceIdle: 'Status: not granted',
  talkative: 'Chatter bubbles',
  quips: 'Chatter lines',
  quipsHint: 'One per line; replaces the built-in shared pool when non-empty (skin-specific lines always stay). Clear to restore defaults.',
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
        width: 36, height: 20, borderRadius: 10, border: `1px solid ${colors.border}`, padding: 0, flex: 'none',
        boxSizing: 'border-box',
        position: 'relative', transition: 'background .15s',
        cursor: props.disabled ? 'default' : 'pointer',
        background: props.on ? 'var(--dsw-alias-state-success-primary, #22c55e)' : colors.trackOff,
        opacity: props.disabled ? 0.4 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: props.on ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left .15s',
        // 浅色主题下轨道近白，白圆球会融进去：描边+投影保证两主题都可见。
        boxShadow: '0 0 0 1px rgba(0,0,0,.18), 0 1px 2px rgba(0,0,0,.25)',
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

/**
 * 下拉展开列表是原生控件：背景随系统/浏览器主题走，而 option 文字默认继承
 * select 的前景 → 主题不匹配时白字白底看不见。option 跟随 dsh 主题令牌
 * （亮色/暗色主题各自定义了这组值，自定义属性可继承进 option），
 * 无令牌环境（demo 页）回退深字浅底。
 */
const optionStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-primary, #18181b)',
  backgroundColor: 'var(--dsw-alias-bg-layer-2, #fff)',
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '9px 0' }}>
      <span style={{ fontSize: 13, color: colors.labelPrimary }}>{props.label}</span>
      {props.children}
    </div>
  )
}

/** 整数输入（0-120 这类范围大的，步进器要点几十下不现实）：本地草稿 + blur/Enter 提交并夹取。 */
function NumberField(props: { value: number; min: number; max: number; disabled: boolean; label: string; onCommit(n: number): void }) {
  const [draft, setDraft] = useState(String(props.value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== String(props.value)) setDraft(String(props.value))
  const commit = (): void => {
    const n = Math.round(Number(draft))
    if (!Number.isFinite(n)) { setDraft(String(props.value)); return }
    props.onCommit(Math.min(props.max, Math.max(props.min, n)))
  }
  return (
    <input
      type="number"
      min={props.min}
      max={props.max}
      step={1}
      aria-label={props.label}
      style={{
        width: 72, font: 'inherit', fontSize: 13, padding: '4px 10px', borderRadius: 8,
        border: `1px solid ${colors.border}`, background: 'transparent',
        color: colors.labelPrimary, opacity: props.disabled ? 0.4 : 1,
      }}
      value={draft}
      disabled={props.disabled}
      onFocus={() => { setFocused(true) }}
      onBlur={() => { setFocused(false); commit() }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      onChange={(e) => { setDraft(e.target.value) }}
    />
  )
}

/**
 * 语录编辑：本地草稿 + blur 提交（逐键入直接 scope.set 会把半个句子落盘，
 * 且每键一次 RPC）。外部变更（菜单端/另一设备）在非聚焦时同步进草稿。
 */
function QuipsField(props: { value: string[]; disabled: boolean; placeholder: string; onCommit(quips: string[]): void }) {
  const joined = props.value.join('\n')
  const [draft, setDraft] = useState(joined)
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== joined) setDraft(joined) // render 期同步（React 支持的模式）
  return (
    <textarea
      rows={4}
      style={{
        width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit', fontSize: 13,
        lineHeight: 1.6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${colors.border}`,
        background: 'transparent', color: colors.labelPrimary, opacity: props.disabled ? 0.4 : 1,
      }}
      value={draft}
      disabled={props.disabled}
      placeholder={props.placeholder}
      onFocus={() => { setFocused(true) }}
      onBlur={() => {
        setFocused(false)
        const next = draft.split('\n').map((q) => q.trim()).filter((q) => q.length > 0)
        if (next.join('\n') !== joined) props.onCommit(next)
      }}
      onChange={(e) => { setDraft(e.target.value) }}
    />
  )
}

/** 麦克风可用性：非安全上下文（局域网 http）下 getUserMedia 直接不存在，只能禁用说明。 */
function micSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/** 已授权的麦克风设备列表（label 要授权后才拿得到，未授权时只剩 deviceId）。 */
function useMicDevices(active: boolean): Array<{ deviceId: string; label: string }> {  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([])
  useEffect(() => {
    if (!active || !micSupported()) return
    let stale = false
    const load = (): void => {
      navigator.mediaDevices.enumerateDevices().then((all) => {
        if (stale) return
        setDevices(all.filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })))
      }, () => {})
    }
    load()
    navigator.mediaDevices.addEventListener?.('devicechange', load)
    return () => {
      stale = true
      navigator.mediaDevices.removeEventListener?.('devicechange', load)
    }
  }, [active])
  return devices
}

/** 麦克风电平测试：开测后 RMS 电平条实时起伏；关测/换设备/卸载即停流。 */
function MicTest(props: { deviceId: string; labels: { test: string; stop: string; hint: string } }) {
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!testing) return
    let stop = false
    let raf = 0
    let stream: MediaStream | null = null
    let actx: AudioContext | null = null
    navigator.mediaDevices.getUserMedia({
      audio: props.deviceId !== '' ? { deviceId: { exact: props.deviceId } } : true,
    }).then((s) => {
      if (stop) { for (const t of s.getTracks()) t.stop(); return }
      stream = s
      actx = new AudioContext()
      const src = actx.createMediaStreamSource(s)
      const analyser = actx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      const tick = (): void => {
        if (stop) return
        analyser.getByteTimeDomainData(buf)
        let acc = 0
        for (const v of buf) { const d = (v - 128) / 128; acc += d * d }
        setLevel(Math.min(1, Math.sqrt(acc / buf.length) * 4)) // RMS ×4 视觉增益
        raf = requestAnimationFrame(tick)
      }
      tick()
    }, () => { setTesting(false) })
    return () => {
      stop = true
      cancelAnimationFrame(raf)
      if (stream !== null) for (const t of stream.getTracks()) t.stop()
      if (actx !== null) void actx.close().catch(() => {})
      setLevel(0)
    }
  }, [testing, props.deviceId])
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        style={{
          font: 'inherit', fontSize: 12, padding: '3px 12px', borderRadius: 7, cursor: 'pointer',
          border: `1px solid ${colors.border}`, background: 'none', color: colors.labelPrimary,
        }}
        onClick={() => { setTesting(!testing) }}
      >{testing ? props.labels.stop : props.labels.test}</button>
      {testing
        ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={props.labels.hint}>
            <span style={{ width: 90, height: 8, borderRadius: 4, border: `1px solid ${colors.border}`, overflow: 'hidden', display: 'inline-block' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.round(level * 100)}%`, background: 'var(--dsw-alias-state-success-primary, #22c55e)', transition: 'width .06s' }} />
            </span>
          </span>
        )
        : null}
    </span>
  )
}

/** 设置卡片组件：命名空间未 serve 时不渲染（与官方卡片同语义）。 */
export function NiulaiCard(props: NiulaiCardProps) {
  const [open, setOpen] = useState(false)
  // 语音开关的失败原因分态：denied=授权被拒/iframe 策略；no-mic=无设备（NotFoundError）
  const [voiceIssue, setVoiceIssue] = useState<'denied' | 'no-mic' | null>(null)
  const { t } = props
  const state = props.useNiulaiPet((s) => s)
  if (!state.ready) return null
  const { cfg, writable } = state
  const disabled = !writable
  const micOk = micSupported()
  // 语音停喊开关：打开前先真试一次授权（浏览器原生授权框），拿到流才写入 true；
  // 被拒则不落配置，受控开关自然弹回关位。试授权的流立即停掉，不常驻。
  const onVoice = (on: boolean): void => {
    if (!on) {
      setVoiceIssue(null)
      props.set({ voiceControl: false })
      return
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        for (const track of stream.getTracks()) track.stop()
        setVoiceIssue(null)
        props.set({ voiceControl: true })
      },
      (err: unknown) => {
        // NotFoundError/OverconstrainedError = 没有可用设备；NotAllowedError 才是
        // 真的被拒（含 iframe 未放麦克风权限的策略拒绝）。分态提示，别一律说被拒。
        const name = (err as DOMException | null)?.name
        console.warn('[dsh-niulai-pet] mic request failed:', name, err)
        setVoiceIssue(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no-mic' : 'denied')
      },
    )
  }
  const voiceNote = !micOk ? t('voiceUnsupported')
    : voiceIssue === 'no-mic' ? t('voiceNoMic')
      : voiceIssue === 'denied' ? t('voiceDenied')
        : cfg.voiceControl ? t('voiceGranted') : t('voiceIdle')
  const micDevices = useMicDevices(micOk && cfg.voiceControl)
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
            <Row label={t('doneDelay')}>
              <NumberField value={cfg.doneDelaySec} min={0} max={120} disabled={disabled} label={t('doneDelay')}
                onCommit={(n) => { props.set({ doneDelaySec: n }) }} />
            </Row>
            <Row label={t('shoutLoop')}>
              <Switch on={cfg.shoutLoop} disabled={disabled} label={t('shoutLoop')} onChange={(on) => { props.set({ shoutLoop: on }) }} />
            </Row>
            <Row label={t('replyNiulai')}>
              <Switch on={cfg.replyNiulai} disabled={disabled} label={t('replyNiulai')} onChange={(on) => { props.set({ replyNiulai: on }) }} />
            </Row>
            <Row label={t('voiceControl')}>
              <Switch on={cfg.voiceControl} disabled={disabled || !micOk} label={t('voiceControl')} onChange={onVoice} />
            </Row>
            <div role="status" style={{ margin: '-4px 0 4px', fontSize: 12, lineHeight: 1.5, color: colors.labelTertiary }}>{voiceNote}</div>
            {micOk && cfg.voiceControl
              ? (
                <Row label={t('micDevice')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <select
                      style={selectStyle(disabled)}
                      value={cfg.micDeviceId}
                      disabled={disabled}
                      onChange={(e) => { props.set({ micDeviceId: e.target.value }) }}
                    >
                      <option value="" style={optionStyle}>{t('micDefault')}</option>
                      {micDevices.map((d) => <option key={d.deviceId} value={d.deviceId} style={optionStyle}>{d.label}</option>)}
                    </select>
                    <MicTest deviceId={cfg.micDeviceId} labels={{ test: t('micTest'), stop: t('micTestStop'), hint: t('micTestHint') }} />
                  </span>
                </Row>
              )
              : null}
            <Row label={t('talkative')}>
              <Switch on={cfg.talkative} disabled={disabled} label={t('talkative')} onChange={(on) => { props.set({ talkative: on }) }} />
            </Row>
            <div style={{ padding: '9px 0' }}>
              <div style={{ fontSize: 13, color: colors.labelPrimary, marginBottom: 6 }}>{t('quips')}</div>
              <QuipsField value={cfg.quips} disabled={disabled} placeholder={t('quipsHint')}
                onCommit={(quips) => { props.set({ quips }) }} />
              <div style={{ fontSize: 12, lineHeight: 1.5, color: colors.labelTertiary, marginTop: 6 }}>{t('quipsHint')}</div>
            </div>
            <Row label={t('skin')}>
              <select
                style={selectStyle(disabled)}
                value={cfg.skin}
                disabled={disabled}
                onChange={(e) => { props.set({ skin: e.target.value }) }}
              >
                {SKINS.map((s) => <option key={s.id} value={s.id} style={optionStyle}>{s.name}</option>)}
              </select>
            </Row>
            <Row label={`${t('doneAction')} · ${skinName}`}>
              <select
                style={selectStyle(disabled)}
                value={doneAction}
                disabled={disabled}
                onChange={(e) => { props.setSkinAction(cfg.skin, 'done', e.target.value as ActionName) }}
              >
                {ACTION_ORDER.map((a) => <option key={a} value={a} style={optionStyle}>{t(`action.${a}`)}</option>)}
              </select>
            </Row>
            <Row label={`${t('pokeAction')} · ${skinName}`}>
              <select
                style={selectStyle(disabled)}
                value={pokeAction}
                disabled={disabled}
                onChange={(e) => { props.setSkinAction(cfg.skin, 'poke', e.target.value as ActionName) }}
              >
                {ACTION_ORDER.map((a) => <option key={a} value={a} style={optionStyle}>{t(`action.${a}`)}</option>)}
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
