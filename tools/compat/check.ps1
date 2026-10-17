#requires -Version 5.1
<#
.SYNOPSIS
  dsh-niulai-pet 本机兼容性自检。

.DESCRIPTION
  检测本机 DeepSeek Harness 的 dsh 版本；版本变化（或上次失败 / -Force）时，
  在临时 DSH_HOME 里建 scratch web profile、把当前仓库作为插件装进去，用
  dsh --dump-config-schema 让宿主真实 import 插件 host 半并投影 Config，
  最后写报告 + 弹通知。不碰真实 desktop profile。

.PARAMETER Force
  版本没变也强制检查。

.PARAMETER Quiet
  不打印控制台摘要（计划任务用；通知仍然会弹）。

.PARAMETER InstallTask
  注册/覆盖每天 12:00 的计划任务 dsh-niulai-compat。

.PARAMETER KeepScratch
  保留临时 DSH_HOME（排障用），默认检查完删除。

.PARAMETER RepoPath
  插件仓库根目录，默认脚本所在目录的上两级。

.PARAMETER DshCli
  dsh CLI 路径；默认依次找 DSH_CLI 环境变量、PATH 上的 dsh、桌面版安装目录。
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$Quiet,
  [switch]$InstallTask,
  [switch]$KeepScratch,
  [string]$RepoPath,
  [string]$DshCli
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Write-Log([string]$Message) {
  Write-Host $Message
}

function Resolve-RepoPath {
  if ($RepoPath) {
    if (-not (Test-Path $RepoPath)) { throw "RepoPath 不存在: $RepoPath" }
    return (Resolve-Path $RepoPath).Path
  }
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Resolve-DshCli {
  if ($DshCli) {
    if (-not (Test-Path $DshCli)) { throw "DshCli 不存在: $DshCli" }
    return (Resolve-Path $DshCli).Path
  }
  if ($env:DSH_CLI -and (Test-Path $env:DSH_CLI)) {
    return (Resolve-Path $env:DSH_CLI).Path
  }
  $cmd = Get-Command 'dsh' -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw "找不到 dsh CLI：请用 -DshCli 指定，或设置 DSH_CLI。"
}

function Get-DshVersion([string]$Cli) {
  $raw = (& $Cli --version 2>$null | Out-String).Trim()
  if (-not $raw) { throw "dsh --version 没有输出。" }
  $line = ($raw -split "`r?`n")[0].Trim()
  return $line
}

function Show-Toast {
  param([string]$Title, [string]$Body, [string]$Kind = 'Info')
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    if ($Kind -eq 'Error') {
      $icon.Icon = [System.Drawing.SystemIcons]::Error
    } else {
      $icon.Icon = [System.Drawing.SystemIcons]::Information
    }
    $icon.BalloonTipTitle = $Title
    $icon.BalloonTipText = $Body
    $icon.Visible = $true
    $icon.ShowBalloonTip(8000)
    Start-Sleep -Seconds 5
    $icon.Dispose()
  } catch {
    Write-Host ("[toast 不可用] {0} - {1}" -f $Title, $Body)
  }
}

function Install-CompatTask([string]$ScriptPath) {
  $action = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -Quiet' -f $ScriptPath
  $ok = $true
  # 每天 12:00：覆盖“应用一直在跑、中途自动更新”的情况
  & schtasks.exe /Create /F /TN 'dsh-niulai-compat' /TR $action /SC DAILY /ST 12:00 /RL LIMITED 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) {
    $ok = $false
    Write-Host ('创建每日任务失败；可手动执行：schtasks /Create /F /TN dsh-niulai-compat /TR "{0}" /SC DAILY /ST 12:00 /RL LIMITED' -f $action)
  } else {
    Write-Host '已注册计划任务 dsh-niulai-compat：每天 12:00 检查一次。'
  }
  # 登录时：覆盖“更新后重启应用/系统”的情况（版本没变时脚本本身会秒退）。
  # ONLOGON 任务在非管理员下通常会被拒绝，失败不影响每日任务。
  & schtasks.exe /Create /F /TN 'dsh-niulai-compat-logon' /TR $action /SC ONLOGON /RL LIMITED 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) {
    Write-Host '登录任务需要管理员权限，已跳过（每日 12:00 任务仍然有效）。'
    Write-Host ('如需登录即查，可在管理员 PowerShell 执行：schtasks /Create /F /TN dsh-niulai-compat-logon /TR "{0}" /SC ONLOGON /RL LIMITED' -f $action)
  } else {
    Write-Host '已注册计划任务 dsh-niulai-compat-logon：每次登录检查一次。'
  }
  return $ok
}

function Get-EntryConfigFields($Schema, $Entry) {
  $ref = [string]$Entry.configRef
  if ($ref -notmatch '^#/\$defs/(?<name>.+)$') { return @() }
  $defName = $Matches['name']
  $defs = $Schema.'$defs'
  if ($null -eq $defs) { return @() }
  $def = $defs.$defName
  if ($null -eq $def) { return @() }
  $branch = @($def.anyOf | Where-Object { $_.PSObject.Properties.Name -contains 'properties' })[0]
  if ($null -eq $branch) { return @() }
  return @($branch.properties.PSObject.Properties.Name)
}

if ($InstallTask) {
  $installed = Install-CompatTask $PSCommandPath
  if (-not $installed) { exit 1 }
  exit 0
}

$repo = Resolve-RepoPath
$cli = Resolve-DshCli
$version = Get-DshVersion $cli

$stateDir = Join-Path $env:LOCALAPPDATA 'dsh-niulai-compat'
$reportsDir = Join-Path $stateDir 'reports'
New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
$stateFile = Join-Path $stateDir 'state.json'

$state = $null
if (Test-Path $stateFile) {
  try { $state = Get-Content $stateFile -Raw | ConvertFrom-Json } catch { $state = $null }
}

if (-not $Force -and $state -and $state.lastVersion -eq $version -and $state.lastResult -eq 'pass') {
  if (-not $Quiet) { Write-Log ("dsh {0} 已经检查过且通过；跳过（-Force 可强制）。" -f $version) }
  return
}

$started = Get-Date
$scratch = Join-Path $env:TEMP ('dsh-niulai-compat-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$oldDshHome = $env:DSH_HOME
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $reportsDir ('compat-{0}-{1}.md' -f $stamp, $version)
$logPath = Join-Path $reportsDir ('compat-{0}-{1}.log' -f $stamp, $version)
$schemaPath = Join-Path $scratch 'schema.json'
$schemaErrPath = Join-Path $scratch 'schema.err'

$result = 'fail'
$phase = 'init'
$errorText = ''
$entry = $null
$entryDiagnostics = @()
$fields = @()
$missingFields = @()
$schemaErrReportPath = ''

try {
  New-Item -ItemType Directory -Force -Path $scratch | Out-Null
  $env:DSH_HOME = $scratch
  ('== {0} dsh {1} ==' -f (Get-Date).ToString('s'), $version) | Out-File $logPath -Encoding utf8

  # 1) 建 scratch web profile（不启动，只要模板落盘）
  $phase = 'profile'
  & $cli --profile compat --from-default-profile web --dump-config 2>&1 | Out-File $logPath -Append -Encoding utf8
  $profileManifest = Join-Path $scratch 'profiles\compat\package.json'
  if (-not (Test-Path $profileManifest)) {
    throw '创建 scratch profile 失败：没生成 profiles\compat\package.json'
  }

  # 2) 把当前仓库作为插件装进 scratch profile
  $phase = 'install'
  & $cli plugin --profile compat add ('file:{0}' -f $repo) 2>&1 | Out-File $logPath -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) {
    # 安装失败通常是镜像/网络/依赖问题，和插件兼容性无关
    $phase = 'environment'
    throw ('安装插件到 scratch profile 失败（pnpm exit {0}），见日志：{1}' -f $LASTEXITCODE, $logPath)
  }

  # 3) 让宿主真实 import host 半并投影 Config
  $phase = 'schema'
  & $cli --profile compat --dump-config-schema 1>$schemaPath 2>$schemaErrPath
  $schemaExit = $LASTEXITCODE
  ('schema exit={0}' -f $schemaExit) | Out-File $logPath -Append -Encoding utf8
  if (Test-Path $schemaErrPath) {
    $schemaErrReportPath = Join-Path $reportsDir ('compat-{0}-{1}.schema.err' -f $stamp, $version)
    Copy-Item $schemaErrPath $schemaErrReportPath -Force
  }
  if (-not (Test-Path $schemaPath) -or (Get-Item $schemaPath).Length -lt 1024) {
    throw ('--dump-config-schema 没有产出有效 JSON（exit {0}）' -f $schemaExit)
  }

  $schema = Get-Content $schemaPath -Raw | ConvertFrom-Json
  $x = $schema.'x-cordis'
  if ($null -eq $x) { throw 'schema 输出缺少 x-cordis 报告。' }

  $entry = @($x.entries | Where-Object { $_.name -eq 'dsh-niulai-pet' })[0]
  if ($null -eq $entry) {
    throw '插件 entry 没有出现在 x-cordis.entries 里：host 半 import 可能失败。'
  }

  $entryDiagnostics = @($x.diagnostics | Where-Object {
    $_.path -eq $entry.path -or $_.path -like ($entry.path + '/*')
  })
  $entryErrors = @($entryDiagnostics | Where-Object { $_.level -eq 'error' })

  if ($entry.status -notin @('schema', 'partial')) {
    throw ('entry status = {0}（应为 schema/partial）' -f $entry.status)
  }
  if ($entryErrors.Count -gt 0) {
    throw ('entry 有 {0} 条 error 诊断：{1}' -f $entryErrors.Count, $entryErrors[0].message)
  }

  $fields = Get-EntryConfigFields $schema $entry
  if ($fields.Count -eq 0) { throw '无法从 Config schema 解析出字段（schema 结构可能变了）。' }
  $required = @('muted', 'skin', 'walkEnabled', 'extraPets', 'voiceEngine', 'micGain')
  $missingFields = @($required | Where-Object { $fields -notcontains $_ })
  if ($missingFields.Count -gt 0) {
    throw ('Config schema 缺少核心字段：{0}' -f ($missingFields -join ', '))
  }

  $result = 'pass'
  $phase = 'done'
} catch {
  $errorText = $_.Exception.Message
  if ($phase -eq 'init') { $phase = 'environment' }
} finally {
  if ($oldDshHome) { $env:DSH_HOME = $oldDshHome } else { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
  if ($KeepScratch) {
    Write-Log ('临时 DSH_HOME 保留在：{0}' -f $scratch)
  } else {
    try { Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue } catch { }
  }
}

$finished = Get-Date
$duration = [int]($finished - $started).TotalSeconds
$statusText = if ($result -eq 'pass') { 'PASS' } else { 'FAIL' }
$phaseText = switch ($phase) {
  'environment' { '环境/安装失败（不是兼容性结论）' }
  'profile' { 'scratch profile 创建失败' }
  'install' { '插件安装失败' }
  'schema' { '兼容性检查失败' }
  'done' { '完成' }
  default { $phase }
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('# dsh-niulai-pet 兼容检查')
$lines.Add('')
$lines.Add(('- 时间：{0}' -f $finished.ToString('yyyy-MM-dd HH:mm:ss')))
$lines.Add(('- dsh 版本：`{0}`' -f $version))
$lines.Add(('- 结果：**{0}**（{1}）' -f $statusText, $phaseText))
$lines.Add(('- 耗时：{0}s' -f $duration))
$lines.Add(('- 插件仓库：`{0}`' -f $repo))
$lines.Add(('- dsh CLI：`{0}`' -f $cli))
if ($entry) {
  $lines.Add(('- entry：`{0}` status=`{1}` path=`{2}`' -f $entry.id, $entry.status, $entry.path))
}
if ($fields.Count -gt 0) {
  $lines.Add(('- Config 字段数：{0}' -f $fields.Count))
}
if ($missingFields.Count -gt 0) {
  $lines.Add(('- 缺失字段：{0}' -f ($missingFields -join ', ')))
}
$lines.Add('')
$lines.Add('## 诊断（仅该 entry）')
$lines.Add('')
if ($entryDiagnostics.Count -gt 0) {
  $lines.Add('| level | path | message |')
  $lines.Add('|---|---|---|')
  foreach ($d in $entryDiagnostics) {
    $msg = ([string]$d.message).Replace('|', '\|')
    $lines.Add(('| {0} | {1} | {2} |' -f $d.level, $d.path, $msg))
  }
} else {
  $lines.Add('无。')
}
if ($errorText) {
  $lines.Add('')
  $lines.Add('## 失败原因')
  $lines.Add('')
  $lines.Add('```')
  $lines.Add($errorText)
  $lines.Add('```')
}
$lines.Add('')
$lines.Add('## 日志')
$lines.Add('')
$lines.Add(('- 运行日志：`{0}`' -f $logPath))
$lines.Add(('- schema stderr：`{0}`' -f $(if ($schemaErrReportPath) { $schemaErrReportPath } else { '(未生成)' })))
$lines.Add('')
$lines.Add('> 只覆盖 host 半 import + Config；client 半的 slot/服务改名需要浏览器冒烟。')

try {
  $lines -join "`r`n" | Out-File $reportPath -Encoding utf8
  Copy-Item $reportPath (Join-Path $reportsDir 'latest.md') -Force
} catch {
  Write-Log ('写报告失败：{0}' -f $_.Exception.Message)
}

$stateObject = [ordered]@{
  lastVersion = $version
  lastCheck = $finished.ToString('o')
  lastResult = $result
  lastPhase = $phase
  lastReport = $reportPath
}
try {
  $stateObject | ConvertTo-Json | Out-File $stateFile -Encoding utf8
} catch {
  Write-Log ('写状态失败：{0}' -f $_.Exception.Message)
}

if (-not $Quiet) {
  Write-Log ''
  Write-Log ('dsh {0}：{1}（{2}）' -f $version, $statusText, $phaseText)
  if ($errorText) { Write-Log ('原因：{0}' -f $errorText) }
  Write-Log ('报告：{0}' -f $reportPath)
}

if ($result -eq 'pass') {
  Show-Toast '牛来桌宠兼容检查通过' ('dsh {0} 下 host 半 import 与 Config 正常。' -f $version) 'Info'
  exit 0
} else {
  $toastBody = if ($errorText) { $errorText } else { '见报告' }
  if ($toastBody.Length -gt 180) { $toastBody = $toastBody.Substring(0, 180) + '…' }
  Show-Toast '牛来桌宠兼容检查失败' ('dsh {0}：{1}' -f $version, $toastBody) 'Error'
  if ($phase -eq 'environment') { exit 1 } else { exit 2 }
}
