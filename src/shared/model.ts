/**
 * Pure, dependency-free model shared by the Host half and the browser half of
 * dsh-archive-manager. Everything here is deterministic so it can be unit
 * tested with `node --test` without a running Harness.
 */

/** One archived Session as this plugin presents it. */
export interface ArchivedSessionView {
  readonly sessionId: string
  /** Session title; `null` when the Session has no title projection yet. */
  readonly title: string | null
  /** Session working directory (the project path); `null` for cwd-less Sessions. */
  readonly cwd: string | null
  /** Owning Workspace id, when a Workspace accounts for this Session. */
  readonly workspaceId: string | null
  /** Owning Workspace display title, when known. */
  readonly workspaceTitle: string | null
  /** Session creation time, epoch milliseconds. */
  readonly createdAt: number
  /** Last known activity time, epoch milliseconds. */
  readonly updatedAt: number
  /** On-disk footprint of the Session directory in bytes, when measurable. */
  readonly bytes: number | null
  /** Parent Session id, for subagent-origin Sessions. */
  readonly parentSessionId: string | null
  /** The Session's log still exists on disk (the Host could read its header). */
  readonly persisted: boolean
  /** The Session is loaded in the Host process right now. */
  readonly live: boolean
  /** An Agent is running a turn for this Session right now. */
  readonly running: boolean
  /** Active work kinds reported by the Harness (`turn`/`job`/`subagent`/`schedule`). */
  readonly activity: readonly string[]
}

/**
 * A row whose log is gone from disk but that is still held by the archive set
 * (a tombstone that keeps the sidebar hiding it) and/or by the Host process.
 */
export function isResidue(session: ArchivedSessionView): boolean {
  return !session.persisted
}

/** A group of archived Sessions shown under one project heading. */
export interface ArchiveGroup {
  /** `__none__` for the "no project" group, otherwise the Workspace id. */
  readonly key: string
  /** Heading text: the Workspace title, or the localized "no project" label. */
  readonly title: string
  readonly sessions: readonly ArchivedSessionView[]
}

/** Sort order of the archived list. */
export type ArchiveSort = 'updated' | 'created' | 'title'

/** Chat scope: every archived chat, only chats inside a project, or only those without one. */
export type ArchiveScope = 'all' | 'project' | 'none'

/** Project filter: every Session, only cwd-less Sessions, or one Workspace. */
export type ArchiveProjectFilter = '__all__' | '__none__' | string

/** Filter + sort request the browser half sends (all fields optional). */
export interface ArchiveQuery {
  readonly search?: string
  readonly sort?: ArchiveSort
  readonly project?: ArchiveProjectFilter
  readonly scope?: ArchiveScope
}

export const NO_PROJECT_KEY = '__none__'
export const ALL_PROJECTS_KEY = '__all__'

/**
 * Encode an arbitrary string as one safe path segment, mirroring the Harness
 * session-persistence layout so a Session directory can be found without the
 * persistence backend handing us a path.
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Build the human-navigable project directory name for a working directory,
 * mirroring `projectKey` in the Harness JSONL persistence backend: separator
 * runs collapse to one `-`, unsafe code units use the `~XXXX` escape, and the
 * result is wrapped in `--` and bounded to 251 characters.
 * @param cwd - the Session working directory.
 * @returns the project directory name beneath the sessions root.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const trimmed = readable.replace(/^-+/, '') || 'root'
  return `--${trimmed.slice(0, 251)}--`
}

/** Display title for a row: the Session title, or `fallback` when it has none. */
export function sessionDisplayTitle(session: ArchivedSessionView, fallback: string): string {
  const title = session.title?.trim()
  return title !== undefined && title.length > 0 ? title : fallback
}

/** Case-insensitive substring match over title, directory and session id. */
function matchesQuery(session: ArchivedSessionView, needle: string): boolean {
  if (needle.length === 0) return true
  const haystack = `${session.title ?? ''}\n${session.cwd ?? ''}\n${session.sessionId}`.toLowerCase()
  return haystack.includes(needle)
}

/** True when a Session survives the project filter. */
function matchesProject(session: ArchivedSessionView, project: ArchiveProjectFilter): boolean {
  if (project === ALL_PROJECTS_KEY) return true
  if (project === NO_PROJECT_KEY) return session.workspaceId === null
  return session.workspaceId === project
}

/** True when a Session survives the chat-scope filter. */
function matchesScope(session: ArchivedSessionView, scope: ArchiveScope): boolean {
  if (scope === 'project') return session.cwd !== null
  if (scope === 'none') return session.cwd === null
  return true
}

/** Compare two Sessions according to the requested sort order. */
function compareSessions(a: ArchivedSessionView, b: ArchivedSessionView, sort: ArchiveSort): number {
  if (sort === 'created') return b.createdAt - a.createdAt || a.sessionId.localeCompare(b.sessionId)
  if (sort === 'title') {
    const at = (a.title ?? '').toLowerCase()
    const bt = (b.title ?? '').toLowerCase()
    return at.localeCompare(bt) || b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId)
  }
  return b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId)
}

/**
 * Apply the browser half's query to the archived list.
 * @param sessions - every archived Session the Host knows about.
 * @param query - search text, sort order and project filter.
 * @returns the filtered, sorted list (a new array).
 */
export function selectArchivedSessions(
  sessions: readonly ArchivedSessionView[],
  query: ArchiveQuery = {},
): ArchivedSessionView[] {
  const needle = (query.search ?? '').trim().toLowerCase()
  const project = query.project ?? ALL_PROJECTS_KEY
  const scope = query.scope ?? 'all'
  const sort = query.sort ?? 'updated'
  return sessions
    .filter((session) => matchesScope(session, scope) && matchesProject(session, project) && matchesQuery(session, needle))
    .sort((a, b) => compareSessions(a, b, sort))
}

/**
 * Group the selected Sessions for display. Sessions whose Workspace is unknown
 * (or that belong to no Workspace) fall into one trailing "no project" group.
 * @param sessions - the already filtered and sorted list.
 * @param noProjectTitle - localized heading for the cwd-less/unknown group.
 * @returns groups in list order, with the "no project" group last.
 */
export function groupArchivedSessions(
  sessions: readonly ArchivedSessionView[],
  noProjectTitle: string,
): ArchiveGroup[] {
  const groups = new Map<string, ArchivedSessionView[]>()
  for (const session of sessions) {
    const key = session.workspaceId ?? NO_PROJECT_KEY
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [session])
    else bucket.push(session)
  }
  const ordered: ArchiveGroup[] = []
  for (const [key, bucket] of groups) {
    if (key === NO_PROJECT_KEY) continue
    const first = bucket[0]
    ordered.push({
      key,
      title: first?.workspaceTitle !== null && first?.workspaceTitle !== undefined ? first.workspaceTitle : key,
      sessions: bucket,
    })
  }
  const none = groups.get(NO_PROJECT_KEY)
  if (none !== undefined) ordered.push({ key: NO_PROJECT_KEY, title: noProjectTitle, sessions: none })
  return ordered
}

/**
 * Distinct project choices for the project menu, derived from the full archived
 * list so the menu never depends on the current search.
 * @param sessions - every archived Session.
 * @returns one option per owning Workspace, plus the "no project" option.
 */
export function projectOptions(
  sessions: readonly ArchivedSessionView[],
): Array<{ key: string; title: string }> {
  const seen = new Map<string, string>()
  let hasNone = false
  for (const session of sessions) {
    if (session.workspaceId === null) {
      hasNone = true
      continue
    }
    if (!seen.has(session.workspaceId)) {
      seen.set(session.workspaceId, session.workspaceTitle ?? session.workspaceId)
    }
  }
  const options = [...seen].map(([key, title]) => ({ key, title })).sort((a, b) => a.title.localeCompare(b.title))
  if (hasNone) options.push({ key: NO_PROJECT_KEY, title: '' })
  return options
}

/**
 * Human-readable byte count, matching the Harness' own fileSizeText wording
 * closely enough for a management page.
 * @param bytes - non-negative byte count.
 * @returns a short label such as `1.4 MB`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value < 10 ? 1 : 0
  return `${value.toFixed(digits)} ${units[unit] ?? 'TB'}`
}
