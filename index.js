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

import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

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
const SKIN_IDS = ['niulai', 'orig', 'young', 'cow', 'panda', 'whale']

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
  /** 完成时连喊几声（1-3，默认 1）。 */
  shoutCount: z.number().step(1).min(1).max(3).default(1),
  /** 气泡唠叨（默认开）。 */
  talkative: z.boolean().default(true),
  /** 当前皮肤。 */
  skin: z.union(SKIN_IDS).default('niulai'),
  /** 按皮肤的动作绑定：{ [skinId]: { done, poke } }。 */
  actions: z.dict(z.object({ done: Action.default('signature'), poke: Action.default('hops') })).default({}),
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
}
