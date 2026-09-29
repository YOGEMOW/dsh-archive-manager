/**
 * Bundle the browser page for a Node-hosted jsdom test.
 *
 * react/react-dom stay external (Node resolves the real packages) and
 * `@deepseek-ai/dsh-client-ui-primitives` is aliased to a local test double:
 * the real package only runs inside the browser's loader module table. CSS
 * modules compile to class maps, exactly as the shipped client build does.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const NODE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'react-dom/test-utils',
  'react-dom/server',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-archive-test-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

export default defineConfig({
  entry: { entry: 'tests/render/entry.tsx' },
  outDir: 'tests/.build',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: true,
  alias: {
    '@deepseek-ai/dsh-client-ui-primitives': resolvePath('tests/render/primitives-stub.tsx'),
  },
  external: [...NODE_EXTERNALS],
  noExternal: (source: string) => (NODE_EXTERNALS.includes(source) ? undefined : true),
  define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  plugins: [{
    name: 'dsh-archive-test-css',
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
      const { exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return `export default ${JSON.stringify(classMap)};`
    },
  }],
  outputOptions: {
    entryFileNames: 'entry.mjs',
    banner: '/* jsdom render harness for dsh-archive-manager */',
  },
})
