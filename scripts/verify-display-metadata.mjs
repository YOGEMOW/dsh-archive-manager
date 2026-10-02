/**
 * Verify the package display metadata the way `dsh-app-boot` reads it.
 *
 * Two layers, so this runs both on a developer machine and in CI:
 *
 *  1. **Always** — validate this repository's own metadata against the rules
 *     DSH enforces: `package.json` `icon` naming a relative SVG/PNG/JPEG/WebP
 *     file inside the package of at most 256 KiB, and `locale/` holding
 *     language-id `.json` files that share one directory and carry
 *     `meta.title` / `meta.description`.
 *  2. **When the plugin is installed in a profile** — additionally resolve
 *     `<pkg>/package.json` and `<pkg>/locale/<lang>.json` through Node's
 *     resolver from that profile, which is what proves the `exports` mapping is
 *     right. Skipped (not failed) when the package is not installed there.
 *
 * Usage: node scripts/verify-display-metadata.mjs [profileDirectory]
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const ICON_MEDIA_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])
const MAX_ICON_BYTES = 256 * 1024
const LANGUAGE_ID = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/u

const failures = []
const fail = (message) => failures.push(message)

const repoRoot = resolve(import.meta.dirname, '..')
const manifestPath = join(repoRoot, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const name = manifest.name

/* 1. The repository's own metadata. ---------------------------------------- */

if (typeof manifest.icon !== 'string' || manifest.icon.length === 0) {
  fail('package.json has no `icon` field (the plugin row falls back to the generic artwork)')
} else {
  const icon = manifest.icon
  if (isAbsolute(icon) || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon)) {
    fail(`icon must be a relative file, got ${JSON.stringify(icon)}`)
  } else {
    const mediaType = ICON_MEDIA_TYPES.get(extname(icon).toLowerCase())
    if (mediaType === undefined) fail(`icon must be SVG, PNG, JPEG, or WebP, got ${icon}`)
    else {
      const file = resolve(repoRoot, icon)
      const local = relative(repoRoot, file)
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        fail(`icon must remain inside the package directory, got ${icon}`)
      } else if (!existsSync(file)) {
        fail(`icon file does not exist: ${icon}`)
      } else {
        const info = statSync(file)
        if (!info.isFile()) fail(`icon must be a regular file: ${icon}`)
        else if (info.size > MAX_ICON_BYTES) fail(`icon exceeds 256 KiB: ${icon} (${info.size} bytes)`)
        else console.log(`icon ok: ${local} · ${info.size} bytes · ${mediaType}`)
      }
    }
  }
}

const localeDir = join(repoRoot, 'locale')
if (!existsSync(join(localeDir, 'en.json'))) {
  // DSH anchors the whole locale scan on the English resource.
  fail('locale/en.json is required: the Harness scans locale/ from that file')
} else {
  const languages = []
  for (const entry of readdirSync(localeDir)) {
    if (!entry.endsWith('.json')) {
      fail(`locale/ may only contain .json language files, found ${entry}`)
      continue
    }
    const language = entry.slice(0, -5)
    if (!LANGUAGE_ID.test(language)) {
      fail(`locale filename is not a language id: ${entry}`)
      continue
    }
    const parsed = JSON.parse(readFileSync(join(localeDir, entry), 'utf8'))
    const title = parsed?.meta?.title
    const description = parsed?.meta?.description
    if (typeof title !== 'string' || title.length === 0) fail(`locale/${entry} needs meta.title`)
    if (typeof description !== 'string' || description.length === 0) fail(`locale/${entry} needs meta.description`)
    languages.push(language)
  }
  if (languages.length > 0) console.log(`locale ok: ${languages.sort().join(', ')}`)
}

if (!Array.isArray(manifest.files) || !manifest.files.includes('locale') || !manifest.files.includes('icon.svg')) {
  fail('package.json `files` must include `locale` and `icon.svg` so a published tarball keeps them')
}

/* 2. Resolution from a profile, when the plugin is installed there. --------- */

const candidate = process.argv[2] ?? process.env.DSH_PROFILE_DIR ?? join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  '.dsh', 'profiles', 'desktop',
)
const profileDir = candidate === '' ? undefined : candidate
if (profileDir !== undefined && existsSync(join(profileDir, 'package.json'))) {
  const require = createRequire(pathToFileURL(join(profileDir, 'package.json')).href)
  const optional = (specifier) => {
    try {
      return require.resolve(specifier)
    } catch {
      return undefined
    }
  }
  if (optional(name) === undefined) {
    console.log(`profile ${profileDir}: ${name} is not installed there — resolution layer skipped`)
  } else {
    const en = optional(`${name}/locale/en.json`)
    if (en === undefined) {
      fail(`exports do not expose locale files: add "./locale/*.json": "./locale/*.json" (resolving ${name}/locale/en.json from the profile failed)`)
    } else {
      console.log(`profile resolution ok: ${relative(profileDir, en) || en}`)
      for (const entry of readdirSync(dirname(en))) {
        if (optional(`${name}/locale/${entry}`) === undefined) fail(`${name}/locale/${entry} does not resolve through exports`)
      }
    }
    if (optional(`${name}/package.json`) === undefined) fail(`${name}/package.json is not exported`)
  }
} else {
  console.log(`profile ${String(profileDir)}: none found — resolution layer skipped`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('display metadata ok')
