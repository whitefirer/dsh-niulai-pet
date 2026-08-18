/**
 * dsh-niulai-pet 构建脚本（产物契约照 dsh client 插件惯例，同 dsh-browser-fs）：
 * 纯 client 插件 —— 只产 lib/client.js（CJS 闭包，首尾包装
 * window.__ModuleLoader__.load）。无 host 半：安装即市场的 client-only shim
 * 挂载，刷新页面生效，更新免重启。
 *
 * 素材（assets/*.png|*.mp3）以 dataurl 内联进 bundle：换素材 = 替换 assets/
 * 下的文件后 `npm run build`，再刷新页面即可。assets/ 素材
 * 管线见 README。
 */
import { build } from 'esbuild'

const PLUGIN_ID = 'dsh-niulai-pet'

await build({
  bundle: true,
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  loader: {
    '.png': 'dataurl',
    '.mp3': 'dataurl',
  },
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

console.log('build ok: lib/client.js (browser, cjs closure, assets inlined)')
