/**
 * Browser client bundle for dsh-archive-manager, mirroring the DeepSeek Harness
 * client preset for an external package: a closure-factory artifact calling
 * `window.__ModuleLoader__.load({ id, factory })` and resolving externals
 * through the injected `require` (the loader module table).
 *
 * CSS Modules compile through lightningcss inside the bundle: importing
 * `x.module.css` yields the hashed class map and auto-injects one
 * `<style data-plugin>` tag at factory execution.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const id = 'dsh-archive-manager'

/** Externals answered by the loader module table at runtime. */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-archive-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * A machine-independent name for one stylesheet. lightningcss folds this string
 * into the `[hash]` of every generated class, so an absolute path made the
 * committed bundle differ from the one CI built from the same source.
 * @param fileId - absolute path of the stylesheet being compiled.
 * @returns the checkout-relative path, or the bare basename when it escapes.
 */
function stableName(fileId: string): string {
  const local = relative(process.cwd(), fileId)
  if (local === '' || local.startsWith(`..${sep}`) || isAbsolute(local)) return basename(fileId)
  return local.split(sep).join('/')
}

/**
 * lightningcss returns its class map in an unstable key order, which alone made
 * two builds of identical source differ; sorting restores reproducibility.
 * @param classMap - generated local-name to hashed-name map.
 * @returns the same map with sorted keys.
 */
function sortedClassMap(classMap: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(classMap).sort()) sorted[key] = classMap[key] as string
  return sorted
}

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  plugins: [{
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(this: { addWatchFile(file: string): void }, virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: stableName(fileId),
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
        targets: { chrome: 90 << 16, firefox: 100 << 16, safari: 13 << 16, edge: 90 << 16 },
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(id)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(sortedClassMap(classMap))};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
