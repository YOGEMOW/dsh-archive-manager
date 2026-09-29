/**
 * The archived-chats page: search, scope/project filters, grouped rows, and the
 * two destructive-free actions (`unarchive`, `delete`) plus `delete all`.
 *
 * Data comes from this plugin's own Host route rather than from the client
 * workspace store, because the Harness' session projections carry neither a
 * title-with-timestamp pair nor an on-disk footprint, and because deletion is
 * a Host-side capability that has no client model at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconArchiveOutlineRegular,
  IconChevronDownOutlineRegular,
  IconLoadingOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  IconUnarchiveOutlineRegular,
  RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ALL_PROJECTS_KEY,
  NO_PROJECT_KEY,
  formatBytes,
  groupArchivedSessions,
  projectOptions,
  selectArchivedSessions,
  sessionDisplayTitle,
  type ArchiveScope,
  type ArchivedSessionView,
} from '../shared/model.ts'
import css from './ArchiveManager.module.css'

/** Route prefix registered by the Host half. */
const ROUTE = '/dsh-archive-manager'

/** Minimal translate surface this page needs. */
export type Translate = (key: string) => string

/** Minimal locale-service surface this page needs. */
export interface LocaleLike {
  getSnapshot?: () => { active?: string } | undefined
}

/** Owner props the settings shell hands to one section. */
export interface ArchiveManagerSectionProps {
  readonly t: Translate
  readonly locale?: LocaleLike
  /** Standard prop of `settings.section`: a selector hook over the workspace snapshot. */
  readonly useWorkspaces?: (selector: (state: unknown) => unknown) => unknown
}

interface Notice {
  readonly tone: 'info' | 'error'
  readonly text: string
}

interface ArchivedPayload {
  readonly sessions: readonly ArchivedSessionView[]
  readonly total: number
}

interface DeletePayload {
  readonly outcomes: readonly { readonly sessionId: string; readonly status: string; readonly detail?: string }[]
  readonly deleted: number
  readonly remaining: number
}

/** Replace `{name}` placeholders in a localized template. */
function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}

/** POST a JSON body to this plugin's Host route and surface route failures. */
async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(ROUTE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => undefined)) as { ok?: boolean; error?: string } | undefined
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }
  return payload
}

/** Read the archived list from the Host. */
async function fetchArchived(signal: AbortSignal): Promise<ArchivedPayload> {
  const response = await fetch(`${ROUTE}/archived`, { signal, headers: { accept: 'application/json' } })
  const payload = (await response.json().catch(() => undefined)) as
    | ({ ok?: boolean; error?: string } & Partial<ArchivedPayload>)
    | undefined
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }
  return { sessions: payload.sessions ?? [], total: payload.total ?? 0 }
}

/** A localized tag for `Intl` formatting, read from the active locale. */
function resolveLocaleTag(locale: LocaleLike | undefined): string {
  try {
    const active = locale?.getSnapshot?.()?.active
    if (typeof active === 'string' && active.length > 0) return active
  } catch {
    /* fall through */
  }
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') return navigator.language
  return 'zh-CN'
}

/** A small, self-contained pill dropdown: DSH styling, no shared menu state. */
function SelectMenu(props: {
  readonly label: string
  readonly options: readonly { key: string; title: string }[]
  readonly activeKey: string
  readonly onPick: (key: string) => void
  readonly disabled?: boolean
}): React.ReactElement {
  const { label, options, activeKey, onPick, disabled = false } = props
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const node = anchor.current
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className={css.menuAnchor} ref={anchor}>
      <button
        type="button"
        className={css.menuButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={css.menuLabel}>{label}</span>
        <IconChevronDownOutlineRegular size={14} />
      </button>
      {open ? (
        <div className={css.menuSurface} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === activeKey}
              data-active={option.key === activeKey}
              className={css.menuOption}
              onClick={() => {
                setOpen(false)
                onPick(option.key)
              }}
            >
              {option.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The page itself. Rendered by the settings shell; also exported for tests.
 * @param props - localized copy, the locale service, and the workspace selector hook.
 * @returns the archived-chats page.
 */
export function ArchiveManagerSection(props: ArchiveManagerSectionProps): React.ReactElement {
  const { t, locale, useWorkspaces } = props
  const [sessions, setSessions] = useState<readonly ArchivedSessionView[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ArchiveScope>('all')
  const [project, setProject] = useState<string>(ALL_PROJECTS_KEY)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ ids: readonly string[]; all: boolean } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  // The workspace snapshot is the cheapest live signal that the archive set
  // changed (including changes made from the sidebar). Absent on Hosts that do
  // not project it into section props — the page then refreshes on its own
  // actions only.
  const revision = useWorkspaces === undefined
    ? ''
    : String(useWorkspaces((state) => {
      const ids = (state as { archivedSessionIds?: unknown } | null)?.archivedSessionIds
      return Array.isArray(ids) ? ids.join('|') : ''
    }) ?? '')

  const refresh = useCallback(async (): Promise<void> => {
    const controller = new AbortController()
    try {
      const payload = await fetchArchived(controller.signal)
      setSessions(payload.sessions)
      setPhase('ready')
      setError(null)
    } catch (cause) {
      if (controller.signal.aborted) return
      setPhase('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, revision])

  const localeTag = resolveLocaleTag(locale)
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    [localeTag],
  )

  const selected = useMemo(
    () => selectArchivedSessions(sessions, { search: query, scope, project }),
    [sessions, query, scope, project],
  )

  const groups = useMemo(() => groupArchivedSessions(selected, t('group.none')), [selected, t])

  const projects = useMemo(() => projectOptions(sessions), [sessions])

  const scopeOptions = useMemo(() => [
    { key: 'all', title: t('scope.all') },
    { key: 'project', title: t('scope.project') },
    { key: 'none', title: t('scope.none') },
  ], [t])

  const projectOptionsList = useMemo(() => [
    { key: ALL_PROJECTS_KEY, title: t('project.all') },
    ...projects.map((option) => ({
      key: option.key,
      title: option.key === NO_PROJECT_KEY ? t('project.none') : option.title,
    })),
  ], [projects, t])

  const scopeLabel = scopeOptions.find((option) => option.key === scope)?.title ?? t('scope.all')
  const projectLabel = projectOptionsList.find((option) => option.key === project)?.title ?? t('project.all')

  const runDelete = useCallback(async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      const payload = (await postJson('/delete', { sessionIds: ids })) as DeletePayload
      const skipped = payload.outcomes.filter((outcome) => outcome.status === 'skipped-live').length
      const failed = payload.outcomes.filter((outcome) => outcome.status === 'failed').length
      const parts = [fill(t('toast.deleted'), { n: payload.deleted })]
      if (skipped > 0) parts.push(fill(t('toast.skipped'), { n: skipped }))
      if (failed > 0) parts.push(fill(t('toast.failed'), { n: failed }))
      setNotice({ tone: failed > 0 ? 'error' : 'info', text: parts.join(' · ') })
      await refresh()
    } catch (cause) {
      setNotice({ tone: 'error', text: fill(t('toast.error'), { message: cause instanceof Error ? cause.message : String(cause) }) })
    } finally {
      setBusy(false)
    }
  }, [refresh, t])

  const runUnarchive = useCallback(async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      await postJson('/unarchive', { sessionIds: ids })
      setNotice({ tone: 'info', text: fill(t('toast.unarchived'), { n: ids.length }) })
      await refresh()
    } catch (cause) {
      setNotice({ tone: 'error', text: fill(t('toast.error'), { message: cause instanceof Error ? cause.message : String(cause) }) })
    } finally {
      setBusy(false)
    }
  }, [refresh, t])

  const filtering = query.trim().length > 0 || scope !== 'all' || project !== ALL_PROJECTS_KEY

  return (
    <div className={css.page}>
      <header className={css.head}>
        <h2 className={css.title}>{t('nav')}</h2>
        <button
          type="button"
          className={css.deleteAll}
          disabled={busy || sessions.length === 0}
          onClick={() => {
            setAcknowledged(false)
            setPending({ ids: sessions.map((session) => session.sessionId), all: true })
          }}
        >
          <IconTrashOutlineRegular size={14} />
          {t('header.deleteAll')}
        </button>
      </header>

      <div className={css.toolbar}>
        <div className={css.search}>
          <span className={css.searchIcon} aria-hidden="true">
            <IconSearchOutlineRegular size={14} />
          </span>
          <input
            className={css.searchInput}
            type="search"
            value={query}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SelectMenu
          label={scopeLabel}
          options={scopeOptions}
          activeKey={scope}
          disabled={busy}
          onPick={(key) => setScope(key as ArchiveScope)}
        />
        <SelectMenu
          label={projectLabel}
          options={projectOptionsList}
          activeKey={project}
          disabled={busy}
          onPick={setProject}
        />
      </div>

      {notice !== null ? (
        <div className={css.stateHint} role="status" style={{ paddingBottom: 10, color: notice.tone === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' }}>
          {notice.text}
        </div>
      ) : null}

      <div className={css.body}>
        {phase === 'loading' ? (
          <div className={css.state}>
            <span className={css.stateIcon}><IconLoadingOutlineRegular size={20} /></span>
            <div className={css.stateTitle}>{t('state.loading')}</div>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className={css.state}>
            <span className={css.stateIcon}><IconArchiveOutlineRegular size={24} /></span>
            <div className={css.stateTitle}>{t('state.error')}</div>
            <div className={css.stateHint}>{error}</div>
            <button type="button" className={css.retryButton} onClick={() => { setPhase('loading'); void refresh() }}>
              {t('state.retry')}
            </button>
          </div>
        ) : null}

        {phase === 'ready' && groups.length === 0 ? (
          <div className={css.state}>
            <span className={css.stateIcon}><IconArchiveOutlineRegular size={24} /></span>
            <div className={css.stateTitle}>{filtering ? t('empty.filtered') : t('empty.none')}</div>
            <div className={css.stateHint}>{filtering ? t('empty.filteredHint') : t('empty.noneHint')}</div>
            {filtering ? (
              <button
                type="button"
                className={css.retryButton}
                onClick={() => { setQuery(''); setScope('all'); setProject(ALL_PROJECTS_KEY) }}
              >
                {t('scope.all')} · {t('project.all')}
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === 'ready'
          ? groups.map((group) => (
            <section className={css.group} key={group.key}>
              <div className={css.groupHead}>
                <IconArchiveOutlineRegular size={14} />
                <span className={css.groupTitle}>{group.title}</span>
                <span className={css.groupCount}>
                  {fill(t('group.count'), { n: group.sessions.length })}
                </span>
              </div>
              <ul className={css.list}>
                {group.sessions.map((session) => (
                  <li className={css.row} key={session.sessionId}>
                    <div className={css.rowMain}>
                      <div className={css.rowTitleLine}>
                        <span className={css.rowTitle} title={session.title ?? undefined}>
                          {sessionDisplayTitle(session, t('row.untitled'))}
                        </span>
                        {session.live ? <span className={css.badge}>{t('row.live')}</span> : null}
                      </div>
                      <div className={css.rowTime}>
                        {session.updatedAt > 0 ? timeFormat.format(new Date(session.updatedAt)) : '—'}
                        {session.bytes !== null ? ` · ${formatBytes(session.bytes)}` : ''}
                        {session.cwd !== null ? ` · ${session.cwd}` : ''}
                      </div>
                    </div>
                    <div className={css.rowActions}>
                      <button
                        type="button"
                        className={css.iconButton}
                        title={t('row.delete')}
                        aria-label={`${t('row.delete')} ${sessionDisplayTitle(session, t('row.untitled'))}`}
                        disabled={busy}
                        onClick={() => {
                          setAcknowledged(false)
                          setPending({ ids: [session.sessionId], all: false })
                        }}
                      >
                        <IconTrashOutlineRegular size={16} />
                      </button>
                      <button
                        type="button"
                        className={css.secondaryButton}
                        disabled={busy}
                        onClick={() => { void runUnarchive([session.sessionId]) }}
                      >
                        <IconUnarchiveOutlineRegular size={14} />
                        <span style={{ marginInlineStart: 4 }}>{t('row.unarchive')}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
          : null}
      </div>

      <RiskConfirmation
        open={pending !== null}
        title={fill(pending?.all === true ? t('confirm.deleteAllTitle') : t('confirm.deleteTitle'), { n: pending?.ids.length ?? 0 })}
        description={t('confirm.body')}
        acknowledgeLabel={t('confirm.ack')}
        confirmLabel={t('confirm.confirm')}
        cancelLabel={t('confirm.cancel')}
        closeLabel={t('confirm.close')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setPending(null); setAcknowledged(false) }}
        onConfirm={() => {
          const target = pending
          setPending(null)
          setAcknowledged(false)
          if (target !== null) void runDelete(target.ids)
        }}
      />
    </div>
  )
}

export default ArchiveManagerSection
