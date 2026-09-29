/**
 * Verify the package-display metadata the way `dsh-app-boot` reads it:
 * resolve `<pkg>/package.json` and `<pkg>/locale/en.json` through Node's
 * resolver from the profile directory, then re-check the icon rules.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const profileDir = process.argv[2] ?? 'C:\\Users\\YOGIMOV\\.dsh\\profiles\\desktop'
const parentURL = pathToFileURL(resolve(profileDir, 'package.json')).href
const require = createRequire(parentURL)
const pkg = 'dsh-archive-manager'

function optional(specifier) {
  try {
    return require.resolve(specifier)
  } catch (error) {
    console.log(`  ${specifier} -> UNRESOLVED (${error.code})`)
    return undefined
  }
}

console.log(`base: ${parentURL}`)
const manifestPath = optional(`${pkg}/package.json`)
const englishPath = optional(`${pkg}/locale/en.json`)
console.log(`  ${pkg}/locale/zh.json -> ${optional(`${pkg}/locale/zh.json`) ?? 'MISSING'}`)

if (manifestPath === undefined || englishPath === undefined) {
  console.log('FAIL: metadata resources are not resolvable')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const directory = resolve(dirname(manifestPath))
const icon = manifest.icon
console.log(`icon field: ${JSON.stringify(icon)}`)
if (typeof icon !== 'string' || icon.length === 0) {
  console.log('FAIL: no icon declared')
  process.exit(1)
}
if (isAbsolute(icon) || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon)) {
  console.log('FAIL: icon must be a relative file')
  process.exit(1)
}
const media = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(icon).toLowerCase()]
if (media === undefined) {
  console.log('FAIL: icon must be SVG, PNG, JPEG, or WebP')
  process.exit(1)
}
const file = resolve(directory, icon)
const local = relative(directory, file)
if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
  console.log('FAIL: icon escapes the package directory')
  process.exit(1)
}
const info = statSync(file)
const bytes = readFileSync(file)
console.log(`icon: ${local}, ${info.size} bytes, ${media}`)
if (bytes.length > 256 * 1024) {
  console.log('FAIL: icon exceeds 256 KiB')
  process.exit(1)
}

const en = JSON.parse(readFileSync(englishPath, 'utf8'))
const zh = JSON.parse(readFileSync(optional(`${pkg}/locale/zh.json`), 'utf8'))
console.log(`en.meta = ${JSON.stringify(en.meta)}`)
console.log(`zh.meta = ${JSON.stringify(zh.meta)}`)
if (typeof en.meta?.title !== 'string' || typeof zh.meta?.title !== 'string') {
  console.log('FAIL: locale files must carry meta.title')
  process.exit(1)
}

// The locale directory must contain only language-id filenames (dictionariesOf rejects others).
const { readdirSync } = await import('node:fs')
const languageId = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/u
for (const entry of readdirSync(dirname(englishPath))) {
  if (!entry.endsWith('.json')) {
    console.log(`FAIL: stray file in locale/: ${entry}`)
    process.exit(1)
  }
  if (!languageId.test(entry.slice(0, -5))) {
    console.log(`FAIL: locale filename is not a language id: ${entry}`)
    process.exit(1)
  }
}
console.log('OK: display metadata resolves, validates and carries both locales')
console.log(`installed at ${existsSync(dirname(manifestPath)) ? dirname(manifestPath) : '??'}`)
void fileURLToPath
