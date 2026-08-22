/**
 * 设置卡片「点预览图高亮对应桌宠」的瞬时事件总线（card → 各 pet 实例）。
 * 纯 UI 事件，不落配置；多只时各自比对 petId 自认领。
 * @module dsh-niulai-pet/highlight
 */

export class HighlightBus {
  private readonly listeners = new Set<(petId: string) => void>()

  // 箭头属性形态：消费端以方法引用方式提取，普通 class 方法会丢 this（踩过）
  readonly subscribe = (fn: (petId: string) => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  readonly emit = (petId: string): void => {
    for (const fn of this.listeners) fn(petId)
  }
}
