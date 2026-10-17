/**
 * 客户端自检诊断面：给 tools/compat/ui.mjs 的 Playwright 冒烟读取。
 *
 * 只写结构性事实（桌宠挂没挂上、slot 有没有注册成功），不涉及用户数据；
 * 页面 URL 不带 ?petdebug 也会存在，方便 CI 断言。
 * @module dsh-niulai-pet/diag
 */

export interface NiulaiDiag {
  /** 桌宠挂载完成（client 半 apply 已经跑到 mountPet 之后）。 */
  petMounted?: boolean
  /** 0.1 宿主：settings.plugin.item slot 注册回调已触发。 */
  settingsPluginItem?: boolean
  /** 0.2+ 宿主：plugins.bundle.config slot 注册回调已触发。 */
  bundleConfigSlot?: boolean
  /** 设置卡片组件至少渲染过一次（打开插件页或悬浮面板时）。 */
  cardMounted?: boolean
}

/** 合并写入 window.__niulaiDiag，保留之前写入的字段。 */
export function markDiag(patch: NiulaiDiag): void {
  if (typeof window === 'undefined') return
  const holder = window as unknown as { __niulaiDiag?: NiulaiDiag }
  holder.__niulaiDiag = { ...holder.__niulaiDiag, ...patch }
}
