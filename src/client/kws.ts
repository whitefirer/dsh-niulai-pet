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

/**
 * 指令词预设表（sherpa keywords 行：音素序列 @词，变体 @词+字母后缀，
 * 命中上报变体文本、按前缀归并显示）。每条预设的音素变体都经
 * /tmp/niulai-stt/kws-multi-test.js 离线标定：四词共存时各词 TTS 正样本
 * 命中自身、零串词，妈妈喊声/静音/白噪/他人语音/歌声零误报
 * （已知限制：重口音/超速语音会漏检，加声调/鼻音变体救不回——实测
 * 方言变体猜修无效，不再堆变体；用户换个自己喊着顺的词即可）。
 * 加新词 = 这里加一条 + 重新跑交叉验证。
 */
export interface KwsKeywordPreset {
  id: string
  /** 显示名（也是 @ 输出词的前缀）。 */
  label: string
  /** sherpa keywords 行（多行：主词 + 发音变体）。 */
  lines: string
}

export const KWS_KEYWORD_PRESETS: readonly KwsKeywordPreset[] = [
  {
    id: 'niulai',
    label: '牛来',
    lines: 'n iú l ái @牛来\nn ǐ y òu l ái @牛来A\nn ǐ y ǒu l ái @牛来B\nn iú y òu l ái @牛来C',
  },
  {
    id: 'biehanle',
    label: '别喊了',
    lines: 'b ié h ǎn l e @别喊了\nb ié h ǎn l a @别喊了A',
  },
  {
    id: 'anjing',
    label: '安静',
    lines: 'ān j ìng @安静\nān j īng @安静A',
  },
  {
    id: 'tingxia',
    label: '停下',
    lines: 't íng x ià @停下\nt íng x iā @停下A',
  },
]

/** 启用词 id 列表 → sherpa keywords 内联串（空列表回落「牛来」——至少得有一个词）。 */
export function kwsKeywordsKey(ids: readonly string[]): string {
  const lines = KWS_KEYWORD_PRESETS.filter((p) => ids.includes(p.id)).map((p) => p.lines)
  return lines.length > 0 ? lines.join('\n') : KWS_KEYWORD_PRESETS[0].lines
}

/** 命中上报文本（@词 / @词A）→ 预设显示名；匹配不上原样返回。 */
export function kwsKeywordLabel(keyword: string): string {
  const hit = KWS_KEYWORD_PRESETS.find((p) => keyword.startsWith(p.label))
  return hit?.label ?? keyword
}

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

let runtime: { key: string; promise: Promise<KwsInstance> } | null = null

/**
 * 加载并创建 KWS 实例（按关键词串做单例；并发调用共享同一 promise）。
 * 关键词变了：先释放旧实例再新建（模型驻留 wasm 堆，512MB INITIAL_MEMORY
 * 不允许两实例并存）；调用方（pet syncConfig / 卡片测试）保证旧监听的
 * stream 已 destroy。加载失败清空缓存，下次调用重试。
 */
export function loadKwsRuntime(keywordsKey: string): Promise<KwsInstance> {
  if (runtime !== null && runtime.key === keywordsKey) return runtime.promise
  const old = runtime
  runtime = null
  const promise = (async (): Promise<KwsInstance> => {
    if (old !== null) {
      try { (await old.promise).free() } catch { /* 旧实例加载失败过/已释放：不挡新建 */ }
    }
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
      keywords: keywordsKey,
    })
    console.log('[dsh-niulai-pet] kws engine ready')
    return kws
  })()
  runtime = { key: keywordsKey, promise }
  promise.catch(() => {
    if (runtime?.key === keywordsKey) runtime = null
  })
  return promise
}

/**
 * 一次监听的 KWS 匹配器（与 LiveMatcher 同形：feed 16k PCM 块，命中回调一次，
 * 回调参数 = 命中的关键词文本（@词/@词A 变体原文，显示用 kwsKeywordLabel 归并））。
 * 每条监听独占一条 stream；destroy 时 reset+free 归还，KWS 实例本体留单例。
 */
export class KwsMatcher {
  private readonly kws: KwsInstance
  private readonly stream: KwsStream
  private readonly onHit: (keyword: string) => void
  private fired = false

  constructor(kws: KwsInstance, onHit: (keyword: string) => void) {
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
        this.onHit(r.keyword)
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
