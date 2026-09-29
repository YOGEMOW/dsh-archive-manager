#!/usr/bin/env node
/**
 * Post-build normalization of client/client.js.
 *
 * 1. Rolldown pretty-prints the tsdown banner into a three-line header, while
 *    the published contract is that the artifact STARTS with the exact one-line
 *    `window.__ModuleLoader__.load({ id: "…", factory: (require) => {` prefix.
 *    Fold the header onto one line and leave blank lines behind it so the
 *    sourcemap's line numbers stay valid.
 * 2. tsdown names the CSS module's virtual chunk by ABSOLUTE path, which would
 *    otherwise commit the builder's checkout path into the artifact.
 */
import fs from 'node:fs'

const file = 'client/client.js'
const name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`

let code = fs.readFileSync(file, 'utf8')

if (!code.startsWith(required)) {
  const lines = code.split('\n')
  const head = [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(name)},`,
    '\tfactory: (require) => {',
  ]
  if (lines[0] !== head[0] || lines[1] !== head[1] || lines[2] !== head[2]) {
    console.error(`normalize-client-banner: unexpected ${file} header:\n` + lines.slice(0, 3).join('\n'))
    process.exit(1)
  }
  lines[0] = required
  lines[1] = ''
  lines[2] = ''
  code = lines.join('\n')
}

// `\0dsh-archive-css:<abs>/src/client/X.module.css.mjs` → repo-relative form.
const root = process.cwd().replaceAll('\\', '/')
code = code.replace(/(dsh-archive-css:)([^\n"]*?)(src[/\\][^\n"]*?\.css\.mjs)/g, (_all, prefix, _dir, rel) =>
  prefix + rel.replaceAll('\\', '/'))

const escapes = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const leaks = [
  ...code.matchAll(new RegExp(escapes, 'g')),
  ...code.matchAll(/dsh-archive-css:(?:\/|[A-Za-z]:[/\\])[^\n"]*/g),
].map((match) => match[0].slice(0, 60))
if (leaks.length > 0) {
  console.error(`normalize-client-banner: absolute build path left in ${file}: ${leaks.slice(0, 3).join(', ')}`)
  process.exit(1)
}

fs.writeFileSync(file, code)
console.log(`normalize-client-banner ok: ${file}`)
