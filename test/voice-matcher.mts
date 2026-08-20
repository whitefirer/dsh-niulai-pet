// 语音停喊模板匹配离线判别力测试（node --experimental-strip-types 直跑 TS）。
// 开发 VM 无麦克风，判别力全靠离线语料证明：
//   正样本 = reply.mp3 本体 + ffmpeg 扰动版（±8% 变调 / ±10% 变速 / -25dB 白噪等）
//   负样本 = mama1/mama2（宠物「妈妈」喊声，绝不能误判）+ mama.wav + 静音 + 白噪
// 语料统一 ffmpeg 转 16k 单声道 wav 再读；生成物在 /tmp/niulai-voice（不入库）。
// 跑法：node --experimental-strip-types test/voice-matcher.mts

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FRAME_METRIC,
  LiveMatcher,
  VOICE_MATCH_THRESHOLD,
  cepstralMeanSub,
  frameRmsSeries,
  matchScore,
  mfccFrames,
  subsequenceDtw,
  trimByEnergy,
  type FrameMetric,
} from '../src/client/voice.ts'

const REPO = new URL('..', import.meta.url).pathname
const TMP = '/tmp/niulai-voice'
mkdirSync(TMP, { recursive: true })

// ---- ffmpeg 语料生成（16k 单声道 wav）----
function ff(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'pipe' })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}: ${r.stderr}`)
}
/** 任意音频 → 16k mono wav（可带 -af 扰动链）。 */
function wav16k(out: string, src: string, af?: string): string {
  const dst = join(TMP, out)
  const args = ['-i', src]
  if (af !== undefined) args.push('-af', af)
  args.push('-ac', '1', '-ar', '16000', '-f', 'wav', dst)
  ff(args)
  return dst
}
/** reply.mp3 + 白噪 -25dB 混合。 */
function noisy(out: string, src: string, af?: string): string {
  const dst = join(TMP, out)
  const pre = af !== undefined ? `[0:a]${af}[s];` : ''
  ff([
    '-i', src, '-f', 'lavfi', '-i', 'anoisesrc=color=white',
    '-filter_complex', `${pre}[1:a]volume=0.056[n];${af !== undefined ? '[s]' : '[0:a]'}[n]amix=inputs=2:duration=first:normalize=0`,
    '-ac', '1', '-ar', '16000', '-f', 'wav', dst,
  ])
  return dst
}
function synth(out: string, lavfi: string, sec: number): string {
  const dst = join(TMP, out)
  ff(['-f', 'lavfi', '-i', lavfi, '-t', String(sec), '-ac', '1', '-ar', '16000', '-f', 'wav', dst])
  return dst
}

const REPLY = join(REPO, 'assets/reply.mp3')
const corpus: Array<{ name: string; path: string; positive: boolean }> = [
  // 正样本：模板本体 + 变调/变速/加噪/窄带（模拟真人喊的音色、语速、环境差）
  { name: 'reply 本体', path: wav16k('reply.wav', REPLY), positive: true },
  { name: 'reply +8% 变调', path: wav16k('reply-pitchup.wav', REPLY, 'asetrate=48000*1.08,aresample=48000'), positive: true },
  { name: 'reply -8% 变调', path: wav16k('reply-pitchdn.wav', REPLY, 'asetrate=48000*0.92,aresample=48000'), positive: true },
  { name: 'reply +10% 变速', path: wav16k('reply-tempoup.wav', REPLY, 'atempo=1.10'), positive: true },
  { name: 'reply -10% 变速', path: wav16k('reply-tempodn.wav', REPLY, 'atempo=0.90'), positive: true },
  { name: 'reply 窄带(电话音)', path: wav16k('reply-band.wav', REPLY, 'highpass=f=200,lowpass=f=4000'), positive: true },
  { name: 'reply -25dB 白噪', path: noisy('reply-noise.wav', REPLY), positive: true },
  { name: 'reply 变速+白噪', path: noisy('reply-tempo-noise.wav', REPLY, 'atempo=1.08'), positive: true },
  // 负样本：宠物的「妈妈」喊声（同场景最强干扰）+ mama.wav + 静音 + 白噪
  { name: 'mama1（喊妈妈）', path: wav16k('mama1.wav', join(REPO, 'assets/mama1.mp3')), positive: false },
  { name: 'mama2（喊妈妈）', path: wav16k('mama2.wav', join(REPO, 'assets/mama2.mp3')), positive: false },
  { name: '静音', path: synth('silence.wav', 'anullsrc=r=16000:cl=mono', 2), positive: false },
  { name: '白噪', path: synth('whitenoise.wav', 'anoisesrc=color=white:amplitude=0.5', 2), positive: false },
]
// 额外负样本：早期对比测试留下的 mama.wav（在则测，不在不挡）
const MAMA_WAV = '/tmp/niulai-sound/mama.wav'
if (existsSync(MAMA_WAV)) corpus.push({ name: 'mama.wav', path: wav16k('mama-ext.wav', MAMA_WAV), positive: false })

// ---- wav 读取（16bit PCM → Float32）----
function readWav(path: string): Float32Array {
  const b = readFileSync(path)
  let off = 12
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'data') {
      const n = Math.floor(size / 2)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(off + 8 + i * 2) / 32768
      return out
    }
    off += 8 + size + (size & 1)
  }
  throw new Error(`no data chunk: ${path}`)
}

// ---- 模板（生产同路径：mfcc + 能量裁剪）----
const tplPcm = readWav(join(TMP, 'reply.wav'))
const template = trimByEnergy(mfccFrames(tplPcm), frameRmsSeries(tplPcm))
console.log(`模板帧数 ${template.length}（${(template.length * 10 / 1000).toFixed(2)}s）`)

// ---- 判别力对比：4 种度量/归一化组合，给生产选型提供数据 ----
const pcms = corpus.map((c) => ({ ...c, pcm: readWav(c.path) }))
const variants: Array<{ tag: string; fn(t: number[][], s: number[][]): number }> = [
  { tag: 'euclid+CMN', fn: (t, s) => subsequenceDtw(cepstralMeanSub(t), cepstralMeanSub(s), 1, 'euclid') },
  { tag: 'cos+CMN', fn: (t, s) => subsequenceDtw(cepstralMeanSub(t), cepstralMeanSub(s), 1, 'cos') },
  { tag: 'cos 无CMN', fn: (t, s) => subsequenceDtw(t, s, 1, 'cos') },
  { tag: 'euclid 无CMN', fn: (t, s) => subsequenceDtw(t, s, 1, 'euclid') },
]
console.log('\n== 度量选型（正样本要整体低、负样本要整体高）==')
for (const v of variants) {
  const scores = pcms.map((c) => v.fn(template, mfccFrames(c.pcm)))
  const pos = scores.filter((_, i) => pcms[i].positive)
  const neg = scores.filter((_, i) => !pcms[i].positive)
  console.log(`${v.tag.padEnd(12)} 正[min ${Math.min(...pos).toFixed(3)} max ${Math.max(...pos).toFixed(3)}]  负[min ${Math.min(...neg).toFixed(3)} max ${Math.max(...neg).toFixed(3)}]`)
}

// ---- 生产路径（matchScore + FRAME_METRIC + VOICE_MATCH_THRESHOLD）----
console.log(`\n== 生产路径：matchScore（${FRAME_METRIC}），阈值 ${VOICE_MATCH_THRESHOLD} ==`)
let failures = 0
const check = (name: string, cond: boolean): void => {
  console.log(cond ? `ok   ${name}` : `FAIL ${name}`)
  if (!cond) failures++
}
const posScores: number[] = []
const negScores: number[] = []
for (const c of pcms) {
  const score = matchScore(template, mfccFrames(c.pcm))
  const row = `${c.positive ? '正' : '负'} ${c.name.padEnd(18)} score=${score.toFixed(3)}`
  if (c.positive) {
    posScores.push(score)
    check(`${row} < ${VOICE_MATCH_THRESHOLD}`, score < VOICE_MATCH_THRESHOLD)
  } else {
    negScores.push(score)
    check(`${row} > ${VOICE_MATCH_THRESHOLD}`, score > VOICE_MATCH_THRESHOLD)
  }
}
const maxPos = Math.max(...posScores)
const minNeg = Math.min(...negScores)
console.log(`\n间隔：正样本最高 ${maxPos.toFixed(3)} | 负样本最低 ${minNeg.toFixed(3)} | 阈值 ${VOICE_MATCH_THRESHOLD}`)
console.log(`margin：下侧 ${(VOICE_MATCH_THRESHOLD - maxPos).toFixed(3)} / 上侧 ${(minNeg - VOICE_MATCH_THRESHOLD).toFixed(3)}`)

// ---- 生产流式路径：LiveMatcher（含 VAD 门）逐块喂，正样本必须命中、负样本不得命中 ----
console.log('\n== LiveMatcher 流式（100ms 块，含能量门）==')
for (const c of pcms) {
  let hit = false
  const m = new LiveMatcher(template, () => { hit = true })
  for (let pos = 0; pos < c.pcm.length; pos += 1600) m.feed(c.pcm.slice(pos, pos + 1600))
  if (c.positive) {
    check(`正 ${c.name.padEnd(18)} 命中 (lastScore=${m.lastScore.toFixed(3)})`, hit)
  } else {
    check(`负 ${c.name.padEnd(18)} 不命中 (lastScore=${Number.isFinite(m.lastScore) ? m.lastScore.toFixed(3) : '—'})`, !hit)
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
