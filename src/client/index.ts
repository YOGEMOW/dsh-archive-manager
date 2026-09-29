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
 * The Session controller is reached through a NESTED injection instead: the
 * page works without it, but uses its baseline refresh to reconcile rows whose
 * logs disappeared before this plugin announced removals.
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

/** The subset of the client Session controller this page uses. */
interface ClientSessionsLike {
  /** Re-list the real Session baseline (`ClientSessions.refresh`). */
  refresh?: () => unknown
}

/** Structural shape of a nested `ctx.inject` scope. */
interface ScopedContext {
  get?: (name: string) => unknown
  sessions?: ClientSessionsLike
}

interface ArchiveManagerClientContext {
  effect(callback: () => unknown, label?: string): void
  inject(services: string[], callback: (scoped: ScopedContext) => void): void
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

  // Resolved lazily through a nested injection so a Host without the Session
  // controller still mounts the page (it simply cannot re-list the sidebar).
  let sessions: ClientSessionsLike | undefined
  ctx.inject(['sessions'], (scoped) => {
    sessions = (scoped.get?.('sessions') ?? scoped.sessions) as ClientSessionsLike | undefined
  })
  const sessionRefresh = (): void => {
    try {
      void sessions?.refresh?.()
    } catch {
      /* a failed re-list leaves the sidebar as it was */
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t, locale: ctx.locale, sessionRefresh }),
  }, () => h(ArchiveManagerSection, { t, locale: ctx.locale, sessionRefresh })))
}
