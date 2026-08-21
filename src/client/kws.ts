/**
 * KWS 引擎：sherpa-onnx zipformer（wenetspeech-3.3M，int8 三件套）的 wasm 移植，
 * 真语音识别模型，判别力远超模板匹配（MFCC+DTW）——嗓音差异/背景音/语速变化
 * 都稳（浏览器冒烟：28 条语料 21 过，失败集是升调/加速加噪对抗样本，负样本
 * 零误报，与 node int8 逐样本一致；构建与冒烟见 wasm-build 的 BUILD-NOTES.md）。
 *
 * 资产（loader 80K + wasm 12M + int8 模型 data 4.8M + glue 9.7K）随 npm 包分发，
 * 由 host 半注册的 /niulai-kws/<file> 路由同源伺服；本模块负责懒加载：
 * 首次启用时注入两个经典脚本（emscripten loader + createKws glue），wasm 与
 * 模型经 Module.locateFile 指到同源路由（?v=<插件版本> 破缓存，长缓存）。
 * 加载失败（老 dsh 无 webServer、移动端实例化 512MB INITIAL_MEMORY 被拒等）
 * 抛给调用方回落模板引擎。KWS 实例是页面级单例（建一次 ~1s，模型驻留 wasm
 * 堆），每次监听只开一条 stream，stop 时 reset+free。
 * @module dsh-niulai-pet/kws
 */

/** 关键词：主词 + 三条实际发音变体（node 侧语料标定的结论，同冒烟配置）。
 *  thr 0.1 / score 1.5；「你又来」发音会误触发是音素变体的已知代价。 */
const KEYWORDS =
  'n iú l ái @牛来\n' +
  'n ǐ y òu l ái @牛来A\n' +
  'n ǐ y ǒu l ái @牛来B\n' +
  'n iú y òu l ái @牛来C\n'

/** host 半静态路由前缀（见 index.js serveKws）。 */
const KWS_BASE = '/niulai-kws'

// ---- emscripten / sherpa glue 的最小类型面（经典脚本全局，非 ESM）----

interface SherpaModule {
  onRuntimeInitialized?: () => void
  locateFile?: (file: string, prefix: string) => string
}

interface KwsStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void
  free(): void
}

interface KwsResult {
  keyword?: string
}

export interface KwsInstance {
  createStream(): KwsStream
  isReady(stream: KwsStream): boolean
  decode(stream: KwsStream): void
  getResult(stream: KwsStream): KwsResult
  reset(stream: KwsStream): void
  free(): void
}

declare global {
  interface Window {
    Module?: SherpaModule
    createKws?: (module: SherpaModule, config: unknown) => KwsInstance
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.onload = () => { resolve() }
    el.onerror = () => { reject(new Error(`script load failed: ${src}`)) }
    document.head.appendChild(el)
  })
}

let runtimePromise: Promise<KwsInstance> | null = null

/**
 * 加载并创建 KWS 实例（单例；并发调用共享同一 promise）。
 * 失败时清空单例缓存，下次调用重试（资产可能随插件升级就位）。
 */
export function loadKwsRuntime(): Promise<KwsInstance> {
  if (runtimePromise !== null) return runtimePromise
  const promise = (async (): Promise<KwsInstance> => {
    const q = `?v=${__NIULAI_VERSION__}`
    // 本地变量与 window.Module 同一引用：emscripten 就地扩展该对象
    const module: SherpaModule = {}
    const initialized = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('kws wasm init timeout (30s)')) }, 30_000)
      module.locateFile = (file: string) => `${KWS_BASE}/${file}${q}`
      module.onRuntimeInitialized = () => {
        clearTimeout(timer)
        resolve()
      }
      window.Module = module
    })
    await loadScript(`${KWS_BASE}/sherpa-onnx-wasm-kws-main.js${q}`)
    await initialized
    await loadScript(`${KWS_BASE}/sherpa-onnx-kws.js${q}`)
    const create = window.createKws
    if (create === undefined) throw new Error('createKws global missing after glue load')
    const kws = create(module, {
      featConfig: { samplingRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: './encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx',
          decoder: './decoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx',
          joiner: './joiner-epoch-99-avg-1-chunk-16-left-64.int8.onnx',
        },
        tokens: './tokens.txt',
        provider: 'cpu',
        numThreads: 1,
        debug: 0,
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: 1.5,
      keywordsThreshold: 0.1,
      keywords: KEYWORDS,
    })
    console.log('[dsh-niulai-pet] kws engine ready')
    return kws
  })()
  runtimePromise = promise
  promise.catch(() => { runtimePromise = null })
  return promise
}

/**
 * 一次监听的 KWS 匹配器（与 LiveMatcher 同形：feed 16k PCM 块，命中回调一次）。
 * 每条监听独占一条 stream；destroy 时 reset+free 归还，KWS 实例本体留单例。
 */
export class KwsMatcher {
  private readonly kws: KwsInstance
  private readonly stream: KwsStream
  private readonly onHit: () => void
  private fired = false

  constructor(kws: KwsInstance, onHit: () => void) {
    this.kws = kws
    this.stream = kws.createStream()
    this.onHit = onHit
  }

  feed(chunk: Float32Array): void {
    if (this.fired) return
    this.stream.acceptWaveform(16000, chunk)
    while (this.kws.isReady(this.stream)) {
      this.kws.decode(this.stream)
      const r = this.kws.getResult(this.stream)
      if (r.keyword !== undefined && r.keyword !== '') {
        this.fired = true
        console.log(`[dsh-niulai-pet] voice-stop matched by kws (${r.keyword})`)
        this.onHit()
        return
      }
    }
  }

  destroy(): void {
    try {
      this.kws.reset(this.stream)
      this.stream.free()
    } catch (err) {
      console.warn('[dsh-niulai-pet] kws stream cleanup failed:', err)
    }
  }
}
