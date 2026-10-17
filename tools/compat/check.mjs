#!/usr/bin/env node
/**
 * dsh-niulai-pet 兼容性自检（跨平台，CI 与 Linux/macOS 用）。
 *
 * 和 tools/compat/check.ps1 同一套逻辑：在临时 DSH_HOME 建 scratch web profile，
 * 把当前仓库作为插件装进去，用 `dsh --dump-config-schema` 让宿主真实 import
 * 插件 host 半并投影 Config，然后只看 dsh-niulai-pet 这条 entry。
 *
 * 用法：
 *   node tools/compat/check.mjs [--dsh <path>] [--repo <path>] [--report <file.md>] [--keep]
 *
 * 退出码：0 通过；2 兼容性失败；1 环境/安装失败（不是兼容性结论）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}
const keep = argv.includes('--keep')
const repo = resolve(option('--repo', join(dirname(fileURLToPath(import.meta.url)), '..', '..')))
const reportPath = option('--report', '')
const explicitCli = option('--dsh', process.env.DSH_CLI ?? '')
const cli = explicitCli || 'dsh'
// .cmd 需要经过 cmd.exe；Windows 上裸命令名（dsh）也交给 shell 解析。
const useShell = /\.cmd$/i.test(cli) || (process.platform === 'win32' && !/[\\/]/.test(cli))

const logChunks = []
const started = Date.now()

function append(label, result) {
  const tail = (value, max) => {
    const text = String(value ?? '')
    return text.length > max ? `…(${text.length - max} chars omitted)…\n${text.slice(-max)}` : text
  }
  logChunks.push(
    `== ${label} (exit ${result.status ?? 'spawn-error'}) ==\n`
      + `${tail(result.stdout, 8000)}\n`
      + `-- stderr --\n${tail(result.stderr, 8000)}\n`,
  )
}

function shellQuote(value) {
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function run(args) {
  let result
  if (useShell) {
    // .cmd 需要经过 cmd.exe；路径/参数可能含空格，逐个加引号。
    const command = [cli, ...args].map(shellQuote).join(' ')
    result = spawnSync(command, {
      encoding: 'utf8',
      env: process.env,
      shell: true,
      maxBuffer: 128 * 1024 * 1024,
    })
  } else {
    result = spawnSync(cli, args, {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 128 * 1024 * 1024,
    })
  }
  if (result.error && result.status === null) {
    const error = new Error(`无法执行 ${cli}: ${result.error.message}`)
    error.environment = true
    throw error
  }
  return result
}

function markdown(entry, version, diagnostics, fields, failure, phase) {
  const lines = []
  lines.push('# dsh-niulai-pet 兼容检查')
  lines.push('')
  lines.push(`- 时间：${new Date().toISOString()}`)
  lines.push(`- 平台：\`${process.platform}/${process.arch}\`，Node \`${process.version}\``)
  lines.push(`- dsh 版本：\`${version}\``)
  lines.push(`- 结果：**${failure ? 'FAIL' : 'PASS'}**（${phase}）`)
  lines.push(`- 耗时：${Math.round((Date.now() - started) / 1000)}s`)
  lines.push(`- 插件仓库：\`${repo}\``)
  lines.push(`- dsh CLI：\`${cli}\``)
  if (entry) lines.push(`- entry：\`${entry.id}\` status=\`${entry.status}\` path=\`${entry.path}\``)
  if (fields.length > 0) lines.push(`- Config 字段数：${fields.length}`)
  lines.push('')
  lines.push('## 诊断（仅该 entry）')
  lines.push('')
  if (diagnostics.length > 0) {
    lines.push('| level | path | message |')
    lines.push('|---|---|---|')
    for (const item of diagnostics) {
      lines.push(`| ${item.level} | ${item.path} | ${String(item.message).replaceAll('|', '\\|')} |`)
    }
  } else {
    lines.push('无。')
  }
  if (failure) {
    lines.push('')
    lines.push('## 失败原因')
    lines.push('')
    lines.push('```')
    lines.push(failure)
    lines.push('```')
  }
  lines.push('')
  lines.push('> 只覆盖 host 半 import + Config；client 半的 slot/服务改名需要浏览器冒烟。')
  lines.push('')
  return lines.join('\n')
}

function configFields(schema, entry) {
  const match = /^#\/\$defs\/(.+)$/.exec(String(entry?.configRef ?? ''))
  if (match === null) return []
  const def = schema.$defs?.[match[1]]
  const branch = (def?.anyOf ?? []).find((item) => item !== null && typeof item === 'object' && item.properties)
  return branch === undefined ? [] : Object.keys(branch.properties)
}

let version = ''
let entry = null
let diagnostics = []
let fields = []
let failure = ''
let phase = 'init'
let scratch = ''
let report = ''

try {
  const versionRun = run(['--version'])
  append('version', versionRun)
  version = String(versionRun.stdout ?? '').trim().split(/\r?\n/)[0].trim()
  if (versionRun.status !== 0 || version === '') {
    const error = new Error(`dsh --version 失败（exit ${versionRun.status}）`)
    error.environment = true
    throw error
  }

  scratch = mkdtempSync(join(tmpdir(), 'dsh-niulai-compat-'))
  process.env.DSH_HOME = scratch

  phase = 'profile'
  const profileRun = run(['--profile', 'compat', '--from-default-profile', 'web', '--dump-config'])
  append('profile', profileRun)
  if (!existsSync(join(scratch, 'profiles', 'compat', 'package.json'))) {
    const error = new Error('创建 scratch profile 失败：没生成 profiles/compat/package.json')
    error.environment = true
    throw error
  }

  phase = 'install'
  const installRun = run(['plugin', '--profile', 'compat', 'add', `file:${repo}`])
  append('install', installRun)
  if (installRun.status !== 0) {
    const error = new Error(`安装插件到 scratch profile 失败（pnpm exit ${installRun.status}）`)
    error.environment = true
    throw error
  }

  phase = 'schema'
  const schemaRun = run(['--profile', 'compat', '--dump-config-schema'])
  append('schema', schemaRun)
  if (schemaRun.stdout.length < 1024) {
    throw new Error(`--dump-config-schema 没有产出有效 JSON（exit ${schemaRun.status}）`)
  }
  const schema = JSON.parse(schemaRun.stdout)
  const reportTree = schema['x-cordis']
  if (reportTree === undefined) throw new Error('schema 输出缺少 x-cordis 报告')

  entry = (reportTree.entries ?? []).find((item) => item.name === 'dsh-niulai-pet') ?? null
  if (entry === null) {
    throw new Error('插件 entry 没有出现在 x-cordis.entries 里：host 半 import 可能失败')
  }

  diagnostics = (reportTree.diagnostics ?? []).filter(
    (item) => item.path === entry.path || String(item.path).startsWith(`${entry.path}/`),
  )
  const errors = diagnostics.filter((item) => item.level === 'error')
  if (!['schema', 'partial'].includes(entry.status)) {
    throw new Error(`entry status = ${entry.status}（应为 schema/partial）`)
  }
  if (errors.length > 0) {
    throw new Error(`entry 有 ${errors.length} 条 error 诊断：${errors[0].message}`)
  }

  fields = configFields(schema, entry)
  if (fields.length === 0) throw new Error('无法从 Config schema 解析出字段（schema 结构可能变了）')
  const required = ['muted', 'skin', 'walkEnabled', 'extraPets', 'voiceEngine', 'micGain']
  const missing = required.filter((field) => !fields.includes(field))
  if (missing.length > 0) throw new Error(`Config schema 缺少核心字段：${missing.join(', ')}`)

  phase = 'done'
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  if (error?.environment === true || phase === 'init') phase = 'environment'
} finally {
  if (scratch !== '' && !keep) {
    try { rmSync(scratch, { recursive: true, force: true }) } catch { }
  }
}

const passed = failure === ''
const phaseText = {
  environment: '环境/安装失败（不是兼容性结论）',
  profile: 'scratch profile 创建失败',
  install: '插件安装失败',
  schema: '兼容性检查失败',
  done: '完成',
}[phase] ?? phase

report = markdown(entry, version, diagnostics, fields, failure, phaseText)
if (reportPath !== '') {
  mkdirSync(dirname(resolve(reportPath)), { recursive: true })
  writeFileSync(reportPath, report, 'utf8')
  writeFileSync(`${reportPath}.log`, logChunks.join('\n'), 'utf8')
}

console.log(`dsh ${version}：${passed ? 'PASS' : 'FAIL'}（${phaseText}）`)
if (failure !== '') console.log(`原因：${failure}`)
if (reportPath !== '') console.log(`报告：${reportPath}`)
if (keep && scratch !== '') console.log(`临时 DSH_HOME：${scratch}`)

process.exit(passed ? 0 : phase === 'environment' ? 1 : 2)
