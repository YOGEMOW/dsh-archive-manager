/**
 * dsh-archive-manager — browser half.
 *
 * Registers one settings page, `已归档的聊天 / Archived chats`, into the
 * settings shell's `settings.section` sunburst, using the id the shell already
 * reserves an archive glyph for (`archived-sessions`).
 *
 * Built by tsdown into the `window.__ModuleLoader__` factory artifact at
 * `client/client.js`; the only externals are the loader module table's react
 * entries and `@deepseek-ai/dsh-client-ui-primitives`.
 */

import { createElement as h } from 'react'
import { ArchiveManagerSection, type LocaleLike, type Translate } from './ArchiveManagerSection.tsx'
import { en, zh } from './locales.ts'

/** Locale namespace owned by this plugin. */
const NS = 'dsh-archive-manager'

/** Settings-section id the shell maps to the archive glyph. */
const SECTION_ID = 'archived-sessions'

export const name = 'dsh-archive-manager'

/**
 * `slots` and `locale` are the whole surface this half needs; the workspace
 * snapshot arrives as a standard prop of `settings.section`, so no extra
 * service has to be required (a missing one would unmount the page entirely).
 */
export const inject = ['slots', 'locale']

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

interface LocaleService extends LocaleLike {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): (key: string) => string
}

interface ArchiveManagerClientContext {
  effect(callback: () => unknown, label?: string): void
  slots: SlotsService
  locale: LocaleService
}

/**
 * Register the archived-chats settings page.
 * @param ctx - the client cordis context of this plugin's package.
 */
export function apply(ctx: ArchiveManagerClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-archive-manager: dictionaries')
  const t = ctx.locale.bind(NS) as Translate

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t, locale: ctx.locale }),
  }, () => h(ArchiveManagerSection, { t, locale: ctx.locale })))
}
