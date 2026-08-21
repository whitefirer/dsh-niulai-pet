/**
 * dsh-niulai-pet — host 半：注册 settings 命名空间 niulai-pet（dsh rc.7+ 设置卡片
 * 的配对键），持久化由 dsh host 白拿（~/.dsh/settings.yaml，三层：schema 默认
 * < cordis entry < user 文档）。rc.6 及更早没有 settings 服务时
 * installSettingsSection 内部的 ctx.inject 永远等不到，注册静默跳过，
 * 插件其余能力（client 半桌宠）不受影响。
 *
 * 桌宠本体在 client 半（lib/client.js）；cordis.patch.yml + 本入口
 * 同时满足 `dsh plugin add` 的安装识别（awesome 收录硬性要求）。
 * @module dsh-niulai-pet
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/**
 * KWS 引擎 wasm 资产目录（随 npm 包分发）。dsh 只伺服 /plugins/<id>/client.js，
 * 其余文件得自己开路由：这里注册 /niulai-kws/<file> 前缀，浏览器同源拉取
 * loader/wasm/int8 模型（约 17MB，局域网秒级；client 半按 ?v=<插件版本> 破缓存）。
 * webServer 服务仅 web 形态存在，TUI 形态下 inject 永远不触发，静默跳过。
 */
const KWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kws')

/** 白名单文件名 → content-type（只放行这五个构建产物，无目录穿越面）。 */
const KWS_FILES = {
  'sherpa-onnx-wasm-kws-main.js': 'text/javascript; charset=utf-8',
  'sherpa-onnx-kws.js': 'text/javascript; charset=utf-8',
  'sherpa-onnx-wasm-kws-main.wasm': 'application/wasm',
  'sherpa-onnx-wasm-kws-main.data': 'application/octet-stream',
  'kws-worker.js': 'text/javascript; charset=utf-8',
}

/** /niulai-kws/<file> 静态伺服（语音停喊 KWS 引擎的运行时与模型）。 */
async function serveKws(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).slice('/niulai-kws/'.length)
  const type = KWS_FILES[name]
  if (type === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const body = await readFile(path.join(KWS_DIR, name))
    res.writeHead(200, {
      'content-type': type,
      // 同 URL 在插件版本内内容不变（升级靠 client 半 ?v= 破缓存），长缓存安全
      'cache-control': 'public, max-age=86400',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/**
 * settings 命名空间：与 client 半卡片注册（settings.plugin.item 的 key）配对。
 * 两边写的是同一个字符串，改名必须两边一起改。
 */
export const NIULAI_PET_NS = settingsNamespace('niulai-pet')

/**
 * 可绑定到事件的动作集合（与 client 半 pet.ts 的 ACTION_ORDER 同源，
 * 新增动作时两边同步）。
 */
const ACTION_IDS = ['signature', 'fly', 'dance', 'spin', 'hops', 'roll', 'breach', 'sway', 'random']

/**
 * 皮肤 id 集合（抄自 client 半 src/client/skins.ts 的 SKINS 注册表——host 半
 * 不能 import 它（会拖进素材 dataurl），加皮肤时两边同步。
 */
const SKIN_IDS = ['niulai', 'orig', 'young', 'cow', 'panda', 'whale', 'nailong']

const Action = z.union(ACTION_IDS)

/**
 * 配置模型：行为键全局通用；完成/戳一一动作绑定按皮肤记（actions 以皮肤 id
 * 为键），切换皮肤不清空另一皮肤的绑定；某皮肤没配过时由 client 半回落
 * 该皮肤默认（done=签名动作，poke=连跳）。位置 x 按设备留 localStorage，不进这里。
 */
export const Config = z.object({
  /** 静音（默认开声）。 */
  muted: z.boolean().default(false),
  /** 任务完成时喊（默认开）。 */
  shoutOnDone: z.boolean().default(true),
  /** 完成时连喊几声（1-99 自定，默认 1；循环模式下此键无意义）。 */
  shoutCount: z.number().step(1).min(1).max(99).default(1),
  /** 气泡唠叨（默认开）。 */
  talkative: z.boolean().default(true),
  /** 当前皮肤。 */
  skin: z.union(SKIN_IDS).default('niulai'),
  /** 按皮肤的动作绑定：{ [skinId]: { done, poke } }。 */
  actions: z.dict(z.object({ done: Action.default('signature'), poke: Action.default('hops') })).default({}),
  /** 音量 0-100（默认 100；静音开关之外的细粒度）。 */
  volume: z.number().step(1).min(0).max(100).default(100),
  /** 自定义唠叨语录（空 = 用内置通用池；非空时替换内置通用池，皮肤专属语录不受影响）。 */
  quips: z.array(z.string()).default([]),
  /** 完成动作延迟秒数（0 = 立即，上限 120）。 */
  doneDelaySec: z.number().step(1).min(0).max(120).default(0),
  /** 完成后循环喊直到互动停止（戳/拖/新任务开始/静音或本开关关闭；60 声兜底自停）。 */
  shoutLoop: z.boolean().default(false),
  /** 喊完（或循环喊被互动打断）时妈妈回一句「牛来！」（默认开）。 */
  replyNiulai: z.boolean().default(true),
  /** 语音停喊：循环喊期间开麦，喊「牛来」即停（需 https/localhost + 麦克风授权）。 */
  voiceControl: z.boolean().default(false),
  /** 麦克风设备 id（空 = 系统默认；deviceId 按浏览器源发放，换浏览器缺此设备自动回落默认）。 */
  micDeviceId: z.string().default(''),
  /** 识别阈值（越小越严）：默认 0.52；真机「喊牛来/喊别的得分差不多」时，
   *  用卡片里的测试看两边得分，把阈值调到两组得分之间。 */
  voiceThreshold: z.number().min(0.3).max(0.85).default(0.54),
  /** 用户自录「牛来」模板（16k mono wav 的 dataurl，空=没录）。
   *  自录模板对本人嗓音匹配远强于电影录音，是跨说话人场景的终极解法。 */
  voiceTemplate: z.string().default(''),
  /** 语音停喊引擎：kws=真语音识别模型（sherpa-onnx wasm，17MB 同源加载，准）；
   *  template=零下载模板匹配（MFCC+DTW，轻但判别力弱）。kws 加载失败自动回落 template。 */
  voiceEngine: z.union(['kws', 'template']).default('kws'),
  /** kws 引擎的指令词（预设 id 列表，喊任一即停；可选值见 client 半 kws.ts 的
   *  KWS_KEYWORD_PRESETS，至少一个）。模板引擎无此概念（模板是什么词就认什么词）。 */
  voiceKeywords: z.array(z.string()).default(['niulai']),
  /** 麦克风软件增益 1.0-4.0（默认 1=直通；浏览器 autoGainControl 之外叠加，
   *  tanh 软削波防爆音——真机"声音小识别不到"时调大）。 */
  micGain: z.number().min(1).max(4).default(1),
})

/**
 * cordis host 插件入口：注册 settings 命名空间。entry config（cordis.yml 层）
 * 当前恒为空对象，解析成全默认后作为 base 层叠在用户文档之下。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config) {
  installSettingsSection(ctx, NIULAI_PET_NS, Config, Config(config ?? {}), {
    // 宿主半没有派生状态要重建（消费全在浏览器半）：hooks 空转即可，
    // 注册行为本身才是目的（Host serve 该命名空间 → 设置页派发卡片）。
    setSource: () => {},
    onChange: () => {},
  })
  // KWS 资产路由（web 形态才有 webServer；TUI 形态下永远不触发）。
  // 拆卸走 sctx.effect（同 dsh-settings 的惯例）：插件重载/卸载时摘掉路由。
  ctx.inject(['webServer'], (sctx) => {
    const dispose = sctx.webServer.register({ kind: 'prefix', path: '/niulai-kws', handler: serveKws })
    sctx.effect(() => dispose)
  })
}
