#!/usr/bin/env node
/**
 * dsh-niulai-pet UI 冒烟（Playwright）。
 *
 * 打开一个已经 boot 的 dsh web 页面（必须带 dsh 打印的 ?token=），断言：
 *   1. 桌宠根节点 [data-niulai-pet] 出现（client 半加载并 mount）；
 *   2. window.__niulaiDiag.petMounted === true；
 *   3. 设置卡片挂点注册成功（0.2: bundleConfigSlot / 0.1: settingsPluginItem）。
 *
 * 用法：
 *   node tools/compat/ui.mjs --url "http://127.0.0.1:PORT/?token=..." [--report <file.md>]
 *
 * 退出码：0 通过；2 UI 断言失败；1 环境问题（缺 url / 没装 playwright）。
 * 注意：URL 里的 token 是会话凭据，报告里会打码。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}
const url = option('--url', process.env.DSH_UI_URL ?? '')
const reportPath = option('--report', '')
const timeout = Number(option('--timeout', '30000'))
const redacted = url.replace(/token=[^&]+/u, 'token=***')

if (url === '') {
  console.error('缺少 --url 或 DSH_UI_URL（用 dsh web 启动日志里的带 token URL）。')
  process.exit(1)
}

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('没有安装 playwright。先 npm i -D playwright && npx playwright install chromium。')
  process.exit(1)
}

const started = Date.now()
const errors = []
const failures = []
let diag = null
let browser
let screenshotPath = ''

try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (error) => { errors.push(`pageerror: ${error.message}`) })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForSelector('[data-niulai-pet]', { state: 'attached', timeout })
  await page.waitForFunction(() => {
    const value = globalThis.__niulaiDiag
    return value !== undefined && value.petMounted === true
  }, undefined, { timeout })

  diag = await page.evaluate(() => globalThis.__niulaiDiag ?? null)
  if (diag === null || diag.petMounted !== true) failures.push('petMounted !== true')
  const cardSlot = diag?.bundleConfigSlot === true || diag?.settingsPluginItem === true
  if (!cardSlot) failures.push('设置卡片 slot 未注册（bundleConfigSlot / settingsPluginItem 都不是 true）')

  // 只让插件自己的报错判定失败；页面里其它插件/浏览器的噪音不背锅。
  const pluginErrors = errors.filter((line) => /niulai/iu.test(line))
  failures.push(...pluginErrors)
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
} finally {
  if (browser !== undefined) {
    try {
      const pages = browser.contexts().flatMap((context) => context.pages())
      if (pages.length > 0 && reportPath !== '') {
        screenshotPath = `${reportPath}.png`
        mkdirSync(dirname(resolve(reportPath)), { recursive: true })
        await pages[0].screenshot({ path: screenshotPath }).catch(() => { screenshotPath = '' })
      }
    } catch { }
    await browser.close().catch(() => { })
  }
}

const passed = failures.length === 0
const elapsed = Math.round((Date.now() - started) / 1000)
const lines = [
  '# dsh-niulai-pet UI 冒烟',
  '',
  `- 时间：${new Date().toISOString()}`,
  `- 页面：\`${redacted}\``,
  `- 结果：**${passed ? 'PASS' : 'FAIL'}**`,
  `- 耗时：${elapsed}s`,
  `- 诊断：\`${JSON.stringify(diag ?? null)}\``,
]
if (failures.length > 0) {
  lines.push('', '## 失败项', '')
  for (const item of failures) lines.push(`- ${item}`)
}
if (errors.length > 0) {
  lines.push('', '## 页面错误（全部）', '')
  for (const item of errors.slice(0, 20)) lines.push(`- \`${item}\``)
}
lines.push('', '> 断言：pet root 出现、diag.petMounted、卡片 slot 注册；不含视觉对比。', '')

if (reportPath !== '') {
  mkdirSync(dirname(resolve(reportPath)), { recursive: true })
  writeFileSync(reportPath, lines.join('\n'), 'utf8')
}
console.log(`UI 冒烟：${passed ? 'PASS' : 'FAIL'}（${elapsed}s）`)
if (!passed) for (const item of failures) console.log(`  - ${item}`)
if (reportPath !== '') console.log(`报告：${reportPath}`)

process.exit(passed ? 0 : 2)
