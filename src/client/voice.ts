/**
 * 语音停喊：零模型模板匹配（MFCC + 子序列 DTW），不下载任何模型。
 *
 * 模板 = 妈妈的回应「牛来！」（assets/reply.mp3 的 dataurl，运行时解码）。
 * 管线：getUserMedia → AudioContext → ScriptProcessor 取块 → 重采样 16k →
 * 25ms 窗 / 10ms 步分帧 → 13 维 MFCC + 一阶 delta（26 维）→ 与模板做子序列
 * DTW（起终点自由，天然容忍 ±50% 内的语速差；余弦代价 + 双端 CMN +
 * 非对角步惩罚），归一化距离低于 VOICE_MATCH_THRESHOLD 判中。
 * 帧 RMS 低于 VAD_RMS_FLOOR 时不评估（省 CPU、防静音误判）。
 *
 * 前半是纯 DSP（分帧/MFCC/DTW/匹配分 + LiveMatcher 增量匹配器），不碰浏览器
 * API，node --experimental-strip-types 可直接导入做离线判别力测试
 * （test/voice-matcher.mts，阈值即由它标定）；后半 startVoiceStop 是浏览器
 * 薄壳：解码模板、开麦取帧、命中回调、stop() 立即关麦停流。
 * @module dsh-niulai-pet/voice
 */

// ---- 参数（统一 16k 单声道；25ms 窗 / 10ms 步）----
export const SAMPLE_RATE = 16000
export const FRAME_LEN = 400 // 25ms
export const FRAME_STEP = 160 // 10ms
const FFT_SIZE = 512 // 400 样本零填充到 512
const MEL_FILTERS = 26
export const MFCC_DIM = 13

/**
 * 判中阈值：子序列 DTW 归一化距离（余弦代价 + 一阶 delta 特征 + 双端 CMN +
 * 非对角步惩罚 1.2）。由 test/voice-matcher.mts 标定（噪声样本每次生成
 * 模板/管线历次演进：初版（带噪模板、无谱减）正 ≤0.45 负 ≥0.71 阈值 0.57；
 * 2026-08-21 再演进：主模板换长切版（含衰减尾，reply_match.mp3）+ 带噪参考版
 * 取 min + 谱减 + 连续 2 次过阈防抖（短模板会被「妈妈」局部片段压线，踩过）：
 *   正样本（reply 本体 + ±8% 变调 / ±10% 变速 / 窄带）最高 ≈0.41
 *   负样本（mama1/mama2 喊声、mama.wav、静音、白噪）最低 ≈0.62
 *   （-25dB 全频段白噪正样本 0.64-0.75 判不中，已知限制：生产由浏览器
 *   noiseSuppression 前置清理，近场喊口令的 SNR 远高于合成极端样本）
 * 取 0.60 居中，双侧各 ≈0.09 间隔。宁偏紧：mama 喊声误判 = 循环自己停自己，
 * 是功能杀手；真人嗓音的召回率需真机麦克风验证后微调（上调警惕 mama 侧）。
 */
export const VOICE_MATCH_THRESHOLD = 0.52

/** 连续过阈次数才判命中（防抖）：滑窗每 50ms 评一次，2 次 ≈ 持续 100ms 都像才算。 */
export const HIT_CONSECUTIVE = 2

/** 能量门：帧 RMS（16bit 归一化）低于此值视为静音段，不做 DTW 评估。 */
export const VAD_RMS_FLOOR = 0.008

/** 监听滑窗（帧数）：3s。模板本体 ~1.8s，口令前后留气息余量。 */
export const RING_FRAMES = 300

/** 门挂起：能量超门后保持评估的帧数（250ms），覆盖字间停顿。 */
const GATE_HANGOVER = 25

/** DTW 评估间隔（帧）：每 50ms 评一次，命中延迟可忽略、CPU 克制。 */
const EVAL_EVERY = 5

// ---- 预计算表（纯数学，node 导入也安全）----

/** Hamming 窗。 */
const HAMMING = new Float64Array(FRAME_LEN)
for (let i = 0; i < FRAME_LEN; i++) {
  HAMMING[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1))
}

const hzToMel = (f: number): number => 2595 * Math.log10(1 + f / 700)
const melToHz = (m: number): number => 700 * (10 ** (m / 2595) - 1)

/** 26 个三角 mel 滤波器（0–8kHz），存 [bin, weight] 稀疏表。 */
const MEL_BANK: Array<Array<[number, number]>> = (() => {
  const points: number[] = []
  for (let m = 0; m < MEL_FILTERS + 2; m++) {
    const hz = melToHz((hzToMel(8000) * m) / (MEL_FILTERS + 1))
    points.push(Math.floor(((FFT_SIZE + 1) * hz) / SAMPLE_RATE))
  }
  const bank: Array<Array<[number, number]>> = []
  for (let m = 1; m <= MEL_FILTERS; m++) {
    const [lo, mid, hi] = [points[m - 1], points[m], points[m + 1]]
    const taps: Array<[number, number]> = []
    for (let k = lo; k < mid; k++) taps.push([k, (k - lo) / Math.max(1, mid - lo)])
    for (let k = mid; k <= hi; k++) taps.push([k, (hi - k) / Math.max(1, hi - mid)])
    bank.push(taps)
  }
  return bank
})()

/** DCT-II 基向量：MFCC_DIM × MEL_FILTERS。 */
const DCT: number[][] = (() => {
  const rows: number[][] = []
  for (let n = 0; n < MFCC_DIM; n++) {
    const row: number[] = []
    for (let k = 0; k < MEL_FILTERS; k++) row.push(Math.cos((Math.PI * n * (k + 0.5)) / MEL_FILTERS))
    rows.push(row)
  }
  return rows
})()

// ---- FFT（迭代 radix-2，就地）----
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j |= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1
      let cwi = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = i + k + len / 2
        const xr = re[b] * cwr - im[b] * cwi
        const xi = re[b] * cwi + im[b] * cwr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const nwr = cwr * wr - cwi * wi
        cwi = cwr * wi + cwi * wr
        cwr = nwr
      }
    }
  }
}

/** 预加重（0.97）+ 分帧加窗 + 512 点 FFT + mel 滤波能量（log/DCT 前）。 */
function melEnergies(y: Float64Array, start: number): Float64Array {
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  for (let i = 0; i < FRAME_LEN; i++) re[i] = y[start + i] * HAMMING[i]
  fft(re, im)
  const e = new Float64Array(MEL_FILTERS)
  for (let m = 0; m < MEL_FILTERS; m++) {
    let acc = 0
    for (const [bin, w] of MEL_BANK[m]) acc += (re[bin] * re[bin] + im[bin] * im[bin]) * w
    e[m] = acc
  }
  return e
}

/** mel 能量 → log + DCT-II → 13 维；给 noise（逐 mel  bin 底噪能量）时先做谱减。 */
function mfccFromMel(e: Float64Array, noise?: Float64Array): number[] {
  const logE = new Float64Array(MEL_FILTERS)
  for (let m = 0; m < MEL_FILTERS; m++) {
    // 谱减：削掉底噪抬升的基底，0.05e 托底防负值/过度消减吃掉语音
    const v = noise === undefined ? e[m] : Math.max(e[m] - 1.3 * noise[m], 0.05 * e[m])
    logE[m] = Math.log(Math.max(v, 1e-10))
  }
  const out: number[] = []
  for (let n = 0; n < MFCC_DIM; n++) {
    let s = 0
    const basis = DCT[n]
    for (let k = 0; k < MEL_FILTERS; k++) s += logE[k] * basis[k]
    out.push(s)
  }
  return out
}

/** 单帧 MFCC（无谱减，LiveMatcher 内联路径以外的地方用）。 */
function mfccOfFrame(y: Float64Array, start: number, noise?: Float64Array): number[] {
  return mfccFromMel(melEnergies(y, start), noise)
}

/** 预加重后的整段信号（mfccOfFrame 的输入）。 */
function preEmphasis(pcm: Float32Array): Float64Array {
  const y = new Float64Array(pcm.length)
  y[0] = pcm[0]
  for (let i = 1; i < pcm.length; i++) y[i] = pcm[i] - 0.97 * pcm[i - 1]
  return y
}

/** 整段 PCM → MFCC 帧序列（尾不足一窗丢弃）。denoise=true 时先按全体帧的
 *  逐 bin 能量 10% 分位估计底噪，再做谱减（对白噪/风扇这类平稳噪声显著更稳）。 */
export function mfccFrames(pcm: Float32Array, denoise = false): number[][] {
  const y = preEmphasis(pcm)
  const frames: number[][] = []
  if (!denoise) {
    for (let start = 0; start + FRAME_LEN <= pcm.length; start += FRAME_STEP) {
      frames.push(mfccOfFrame(y, start))
    }
    return frames
  }
  const mels: Float64Array[] = []
  for (let start = 0; start + FRAME_LEN <= pcm.length; start += FRAME_STEP) {
    mels.push(melEnergies(y, start))
  }
  if (mels.length === 0) return frames
  const noise = new Float64Array(MEL_FILTERS)
  const col: number[] = []
  for (let m = 0; m < MEL_FILTERS; m++) {
    col.length = 0
    for (const e of mels) col.push(e[m])
    col.sort((a, b) => a - b)
    noise[m] = col[Math.floor(col.length * 0.1)]
  }
  for (const e of mels) frames.push(mfccFromMel(e, noise))
  return frames
}

/** 与 mfccFrames 对齐的逐帧 RMS（未预加重的原始 PCM 上算）。 */
export function frameRmsSeries(pcm: Float32Array): number[] {
  const out: number[] = []
  for (let start = 0; start + FRAME_LEN <= pcm.length; start += FRAME_STEP) {
    let acc = 0
    for (let i = 0; i < FRAME_LEN; i++) acc += pcm[start + i] * pcm[start + i]
    out.push(Math.sqrt(acc / FRAME_LEN))
  }
  return out
}

/** 模板裁剪：去掉首尾低于 maxRMS×ratio 的静音帧（前后各留 1 帧气息）。 */
export function trimByEnergy(frames: number[][], rms: number[], ratio = 0.2): number[][] {
  if (frames.length === 0) return frames
  let peak = 0
  for (const r of rms) peak = Math.max(peak, r)
  const floor = peak * ratio
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi && rms[lo] < floor) lo++
  while (hi > lo && rms[hi] < floor) hi--
  return frames.slice(Math.max(0, lo - 1), Math.min(frames.length, hi + 2))
}

/** 倒谱均值归一（CMN）：逐维减去全序列均值，抗录音通道差异。 */
export function cepstralMeanSub(frames: number[][]): number[][] {
  if (frames.length === 0) return frames
  const dim = frames[0].length
  const mean = new Float64Array(dim)
  for (const f of frames) for (let d = 0; d < dim; d++) mean[d] += f[d]
  for (let d = 0; d < dim; d++) mean[d] /= frames.length
  return frames.map((f) => f.map((v, d) => v - mean[d]))
}

/** 逐帧距离度量：euclid=c[lo..dim) 欧氏距；cos=余弦距离（对静音/白噪的退化匹配更稳）。 */
export type FrameMetric = 'euclid' | 'cos'

/** 生产用度量：cos——标定对比中唯一把静音/白噪顶到 ~1.0 的量（见 test/voice-matcher.mts）。 */
export const FRAME_METRIC: FrameMetric = 'cos'

/** 非对角步惩罚：压负样本靠过度弯折硬贴合的空间（标定：mama 侧 0.55→0.71+）。 */
export const OFF_DIAG_PENALTY = 1.2

/**
 * 子序列 DTW：模板必须整段匹配，输入的起终点自由（在输入里找最优连续段）。
 * 返回按模板长度归一化的累计距离（= 路径平均逐帧代价，越小越像）。
 * 逐帧代价默认丢 c0（整体能量/响度），响度无关；非对角步（弯折）乘 offPen。
 */
export function subsequenceDtw(
  template: number[][],
  input: number[][],
  lo = 1,
  metric: FrameMetric = FRAME_METRIC,
  offPen = OFF_DIAG_PENALTY,
): number {
  const n = template.length
  const m = input.length
  if (n === 0 || m === 0) return Infinity
  const dim = template[0].length
  // 余弦度量预计算行范数
  const tNorm = metric === 'cos' ? template.map((t) => Math.hypot(...t.slice(lo))) : null
  const sNorm = metric === 'cos' ? input.map((s) => Math.hypot(...s.slice(lo))) : null
  // prev[j] = dp[i-1][j]；curr[j] = dp[i][j]；j 从 1 起（0 列 = 哨兵）
  const prev = new Float64Array(m + 1)
  const curr = new Float64Array(m + 1)
  // i=0 行全 0：模板起点可落在输入任意位置
  for (let i = 1; i <= n; i++) {
    const t = template[i - 1]
    curr[0] = Infinity // 模板必须逐帧匹配，不允许跳过模板帧
    for (let j = 1; j <= m; j++) {
      const s = input[j - 1]
      let cost: number
      if (metric === 'cos') {
        let dot = 0
        for (let d = lo; d < dim; d++) dot += t[d] * s[d]
        cost = 1 - dot / (((tNorm as number[])[i - 1] * (sNorm as number[])[j - 1]) + 1e-9)
      } else {
        let acc = 0
        for (let d = lo; d < dim; d++) {
          const diff = t[d] - s[d]
          acc += diff * diff
        }
        cost = Math.sqrt(acc)
      }
      curr[j] = cost + Math.min(prev[j - 1], prev[j] * offPen, curr[j - 1] * offPen)
    }
    prev.set(curr)
  }
  let best = Infinity
  for (let j = 1; j <= m; j++) best = Math.min(best, prev[j])
  return best / n
}

/** 一阶 delta 特征：(f[i+1]-f[i-1])/2，边缘复制，拼在原特征后（13 维 → 26 维）。 */
export function appendDeltas(frames: number[][]): number[][] {
  return frames.map((f, i) => {
    const prev = frames[Math.max(0, i - 1)]
    const next = frames[Math.min(frames.length - 1, i + 1)]
    return [...f, ...f.map((_, d) => (next[d] - prev[d]) / 2)]
  })
}

/** 生产匹配分：拼 delta → 双端 CMN → 子序列 DTW（模板传入前应先 trimByEnergy）。 */
export function matchScore(template: number[][], input: number[][], metric: FrameMetric = FRAME_METRIC): number {
  return subsequenceDtw(
    cepstralMeanSub(appendDeltas(template)),
    cepstralMeanSub(appendDeltas(input)),
    1,
    metric,
  )
}

/**
 * 增量匹配器（纯 TS，浏览器/node 通用）：喂 16k PCM 块，内部分帧、
 * 维护 RING_FRAMES 滑窗、能量门 + 每 EVAL_EVERY 帧评估一次，命中回调一次。
 */
export class LiveMatcher {
  private readonly ring: number[][] = []
  private carry = new Float32Array(0)
  /** 逐 mel bin 底噪能量 EMA（低于语音门的帧喂入），谱减用。 */
  private noise: Float64Array | null = null
  private gateLeft = 0
  private sinceEval = 0
  private fired = false
  /** 连续低于阈值的评估次数（防抖：单次跨界不命中，见 HIT_CONSECUTIVE）。 */
  private hitStreak = 0
  private readonly templates: number[][][]
  private readonly onHit: () => void
  private readonly threshold: number
  private readonly onScore?: (score: number) => void
  /** 最近一次评估分（调试/测试观测用；未评估过为 Infinity）。 */
  lastScore = Infinity

  /** 多模板：同一句话的两条录音（干净版+带底噪版），打分取 min——带噪输入
   *  对带噪模板更友好，干净输入对干净模板更准，互补。 */
  constructor(templates: number[][][] | number[][], onHit: () => void, threshold: number = VOICE_MATCH_THRESHOLD,
    onScore?: (score: number) => void) {
    this.templates = Array.isArray(templates[0]?.[0]) ? templates as number[][][] : [templates as number[][]]
    this.onHit = onHit
    this.threshold = threshold
    this.onScore = onScore
  }

  feed(chunk: Float32Array): void {
    if (this.fired) return
    const joined = new Float32Array(this.carry.length + chunk.length)
    joined.set(this.carry)
    joined.set(chunk, this.carry.length)
    let pos = 0
    while (pos + FRAME_LEN <= joined.length) {
      // 帧能量（原始 PCM）
      let acc = 0
      for (let i = 0; i < FRAME_LEN; i++) acc += joined[pos + i] * joined[pos + i]
      const rms = Math.sqrt(acc / FRAME_LEN)
      // MFCC（预加重单帧内联，避免整段重算）；低能帧顺手喂底噪 EMA 做谱减
      const y = new Float64Array(FRAME_LEN)
      y[0] = joined[pos]
      for (let i = 1; i < FRAME_LEN; i++) y[i] = joined[pos + i] - 0.97 * joined[pos + i - 1]
      const mel = melEnergies(y, 0)
      if (rms < VAD_RMS_FLOOR) {
        if (this.noise === null) this.noise = new Float64Array(mel)
        else for (let m = 0; m < MEL_FILTERS; m++) this.noise[m] = 0.92 * this.noise[m] + 0.08 * mel[m]
      }
      this.ring.push(mfccFromMel(mel, this.noise ?? undefined))
      if (this.ring.length > RING_FRAMES) this.ring.shift()
      // 能量门 + 挂起
      if (rms >= VAD_RMS_FLOOR) this.gateLeft = GATE_HANGOVER
      else if (this.gateLeft > 0) this.gateLeft--
      // 滑窗不足模板 0.6 倍不评：过短的输入会让模板过度压缩出假命中。
      // 多模板各自守门，分 = 各模板最小值（任一模板命中即算命中）
      if (this.gateLeft > 0 && ++this.sinceEval >= EVAL_EVERY) {
        const usable = this.templates.filter((t) => this.ring.length >= Math.ceil(t.length * 0.6))
        if (usable.length === 0) { pos += FRAME_STEP; continue }
        this.sinceEval = 0
        this.lastScore = Math.min(...usable.map((t) => matchScore(t, this.ring)))
        this.onScore?.(this.lastScore)
        // 防抖：连续 HIT_CONSECUTIVE 次过阈才命中。短模板（0.5s 级）下「妈妈」
        // 的某个局部片段能单次压线，但不像真口令那样在一串滑窗上持续走低
        if (this.lastScore < this.threshold) {
          this.hitStreak++
          if (this.hitStreak >= HIT_CONSECUTIVE) {
            this.fired = true
            console.log(`[dsh-niulai-pet] voice-stop matched (score ${this.lastScore.toFixed(3)})`)
            this.onHit()
            return
          }
        } else {
          this.hitStreak = 0
        }
      }
      pos += FRAME_STEP
    }
    this.carry = joined.slice(pos)
  }
}

// ---- 浏览器薄壳（以下函数体内部才碰浏览器 API，模块顶层不碰）----

export interface VoiceStopOptions {
  /** 模板音 dataurl 列表（主模板=当前皮肤 replySound，另有带噪参考模板兜底）。 */
  templateSrcs(): Array<string | undefined>
  /** 麦克风设备 id（空串 = 系统默认；设备不在时回落默认再试一次）。 */
  micDeviceId?(): string
  /** 命中回调（pet 接线 stopShoutLoop(false)：用户已亲自喊「牛来」，不再播妈妈录音）。 */
  onMatch(): void
  /** 每次评估报分（调试用：卡片状态行显示「识别到什么程度了」）。 */
  onScore?(score: number): void
  onError?(err: unknown): void
}

export interface VoiceStopHandle {
  /** 模板就绪且麦克风已开 → true；环境不支持/被拒/无模板 → false。 */
  ready: Promise<boolean>
  /** 立即关麦停流（MediaStreamTrack.stop + AudioContext.close），幂等。 */
  stop(): void
}

/** dataurl → decodeAudioData → 线性重采样到 16k 单声道。 */
async function decodeToPcm16k(dataurl: string): Promise<Float32Array> {
  const buf = await (await fetch(dataurl)).arrayBuffer()
  const AC = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (AC === undefined) throw new Error('AudioContext unavailable')
  const dctx = new AC()
  try {
    const audio = await dctx.decodeAudioData(buf)
    return resampleTo16k(audio.getChannelData(0), audio.sampleRate)
  } finally {
    void dctx.close().catch(() => {})
  }
}

/** 线性插值重采样到 16k（定点低数据量，无需 OfflineAudioContext）。 */
export function resampleTo16k(pcm: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return pcm
  const ratio = fromRate / SAMPLE_RATE
  const outLen = Math.max(1, Math.floor(pcm.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = pcm[i0]
    const b = i0 + 1 < pcm.length ? pcm[i0 + 1] : a
    out[i] = a + (b - a) * frac
  }
  return out
}

/** 当前环境能否开麦（非安全上下文下 getUserMedia 不存在）。 */
export function voiceCapable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/**
 * 启动一次语音停喊监听（pet 在循环喊开始/进行中调用；循环停即 stop）。
 * 生命周期一次性：stop() 后不可复用，重新监听需重新 startVoiceStop。
 */
export function startVoiceStop(opts: VoiceStopOptions): VoiceStopHandle {
  let stopped = false
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let proc: ScriptProcessorNode | null = null

  const cleanup = (): void => {
    if (stopped) return
    stopped = true
    if (proc !== null) { proc.onaudioprocess = null; proc.disconnect(); proc = null }
    if (stream !== null) { for (const t of stream.getTracks()) t.stop(); stream = null }
    if (ctx !== null) { void ctx.close().catch(() => {}); ctx = null }
    console.log('[dsh-niulai-pet] voice-stop stopped')
  }
  const fail = (err: unknown): boolean => {
    console.warn('[dsh-niulai-pet] voice-stop unavailable:', err)
    opts.onError?.(err)
    cleanup()
    return false
  }

  const ready = (async (): Promise<boolean> => {    if (!voiceCapable()) return false
    const srcs = opts.templateSrcs().filter((s): s is string => s !== undefined)
    if (srcs.length === 0) return false
    let templates: number[][][]
    try {
      templates = []
      for (const src of srcs) {
        const pcm = await decodeToPcm16k(src)
        if (stopped) return false
        // ratio 0.08（松）：识别模板要保住衰减尾——尾巴也是词形的一部分，
        // 裁狠了短模板会被「妈妈」的某个局部片段强对齐（踩过）
        const tpl = trimByEnergy(mfccFrames(pcm, true), frameRmsSeries(pcm), 0.08)
        if (tpl.length >= 10) templates.push(tpl)
      }
      if (templates.length === 0) return false
    } catch (err) {
      return fail(err)
    }
    const wantDevice = opts.micDeviceId?.() ?? ''
    const audioConstraint = (deviceId: string): MediaTrackConstraints => ({
      channelCount: 1, echoCancellation: true, noiseSuppression: true,
      ...(deviceId !== '' ? { deviceId: { exact: deviceId } } : {}),
    })
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint(wantDevice) })
    } catch (err) {
      // 指定设备可能已不在（换浏览器/拔掉）：回落系统默认再试一次
      if (wantDevice !== '' && (err as DOMException | null)?.name !== 'NotAllowedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint('') })
        } catch (err2) {
          return fail(err2)
        }
      } else {
        return fail(err)
      }
    }
    if (stopped) {
      for (const t of stream.getTracks()) t.stop()
      stream = null
      return false
    }
    try {
      const AC = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC === undefined) return false
      ctx = new AC()
      if (ctx.state === 'suspended') void ctx.resume()
      const rate = ctx.sampleRate
      const matcher = new LiveMatcher(templates, () => { opts.onMatch() }, VOICE_MATCH_THRESHOLD, (score) => { opts.onScore?.(score) })
      const source = ctx.createMediaStreamSource(stream)
      proc = ctx.createScriptProcessor(4096, 1, 1)
      proc.onaudioprocess = (e) => {
        if (stopped) return
        try {
          matcher.feed(resampleTo16k(e.inputBuffer.getChannelData(0), rate))
        } catch (err) {
          opts.onError?.(err)
        }
      }
      source.connect(proc)
      // 输出缓冲不写 = 静音；接 destination 仅为让 ScriptProcessor 跑起来（不建声桥）
      proc.connect(ctx.destination)
      console.log('[dsh-niulai-pet] voice-stop listening')
      return true
    } catch (err) {
      return fail(err)
    }
  })()

  return { ready, stop: cleanup }
}
