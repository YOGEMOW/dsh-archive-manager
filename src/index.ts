/**
 * dsh-archive-manager — Host half.
 *
 * DeepSeek Harness archives a Session by adding its id to the registry-global
 * `archivedSessionIds` set. Everything else about an archived Session is
 * ordinary session storage, and the Harness deliberately ships **no deletion
 * or retention API** ("Nothing deletes session files" — session-persistence-jsonl).
 *
 * This plugin adds the two things that are missing around that archive set:
 *
 *  1. a Host route that describes the archived Sessions richly enough for a
 *     management page (title, project, timestamps, on-disk footprint, live
 *     state), and
 *  2. permanent deletion: unarchive → detach from its Workspace accounting →
 *     remove the Session directory and its projection-cache row, letting the
 *     SQLite search index reconcile itself on its next pass.
 *
 * The Host half deliberately imports nothing from `@deepseek-ai/*` at runtime:
 * a third-party plugin resolves its own dependencies, and the DSH packages are
 * provided by the application, not by the profile. Only Node built-ins and the
 * cordis context are used.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { rm, stat as statPath } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  encodeSegment,
  projectKey,
  type ArchivedSessionView,
} from './shared/model.ts'

export const name = 'dsh-archive-manager'

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-archive-manager'

/** Injectable configuration (all optional). */
export interface Config {
  /**
   * Refuse to delete a Session that is currently loaded in this Host process.
   * Defaults to `true`: deleting a live Session's files would let the running
   * writer recreate them, so the row is reported as skipped instead.
   */
  skipLiveSessions?: boolean
  /** Maximum number of Sessions deleted per request. Defaults to 500. */
  maxDeleteBatch?: number
}

/* ------------------------------------------------------------------ *
 * Structural contracts (no monorepo type dependency at runtime)
 * ------------------------------------------------------------------ */

interface SessionHeaderLike {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly isSeeded?: boolean
}

interface SessionTitleSnapshotLike {
  readonly title: string
  readonly updatedAt?: number
}

type SessionTitleObservationResultLike =
  | { readonly sessionId: string; readonly status: 'fulfilled'; readonly value: { readonly title?: SessionTitleSnapshotLike } }
  | { readonly sessionId: string; readonly status: 'rejected'; readonly reason?: unknown }

interface SessionPersistenceSnapshotLike {
  readonly header: SessionHeaderLike
}

interface SessionPersistenceLike {
  stat(id: string, options?: unknown): Promise<SessionPersistenceSnapshotLike | undefined>
  /** Present on the shipped JSONL backend; not part of the abstract seam. */
  locate?(meta: SessionHeaderLike): { readonly path?: string } | undefined
}

interface SessionQueryLike {
  readTitleSnapshots?(sessionIds: readonly string[], signal?: AbortSignal): Promise<readonly SessionTitleObservationResultLike[]>
  readTitle?(sessionId: string, signal?: AbortSignal): Promise<SessionTitleSnapshotLike | undefined>
}

interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  detachSession(sessionId: string): Promise<void>
}

interface WorkspaceRegistryLike {
  readonly archivedSessionIds: readonly string[]
  list(): WorkspaceLike[]
  unarchiveSession(sessionId: string): Promise<void>
}

interface SessionsLike {
  get(id: string): unknown
}

interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  debug?(message: string): void
}

interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

interface HostContext {
  effect(callback: () => (() => void | Promise<void>) | void, label?: string): void
  inject(services: string[], callback: (ctx: HostContext) => void): void
  get(name: string): unknown
  logger?: LoggerLike
}

/* ------------------------------------------------------------------ *
 * Host-side helpers
 * ------------------------------------------------------------------ */

/** Resolve the Harness home the same way `@deepseek-ai/dsh-home-paths` does. */
export function resolveHarnessHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME?.trim()
  if (configured !== undefined && configured.length > 0) {
    if (configured === '~') return homedir()
    if (configured.startsWith('~/') || configured.startsWith('~\\')) return join(homedir(), configured.slice(2))
    return configured
  }
  return join(homedir(), '.dsh')
}

/** The sessions root a JSONL persistence backend is configured with. */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveHarnessHome(env), 'sessions')
}

/** Path of one Session's projection-cache row. */
function projectionCacheFile(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveHarnessHome(env), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
}

/** True when the path exists (file or directory). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await statPath(path)
    return true
  } catch {
    return false
  }
}

/** Best-effort directory size, bounded so a pathological directory cannot stall a page load. */
async function measureDirectory(dir: string, maxEntries = 512): Promise<number | null> {
  const { readdir } = await import('node:fs/promises')
  let total = 0
  let seen = 0
  const queue: string[] = [dir]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined) break
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (seen++ > maxEntries) return total
      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(child)
        continue
      }
      try {
        const info = await statPath(child)
        total += info.size
      } catch {
        /* a file that vanished mid-walk contributes nothing */
      }
    }
  }
  return total
}

/** Newest modification time among the Session's files, or `null`. */
async function newestWriteTime(dir: string): Promise<number | null> {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    let newest: number | null = null
    for (const entry of entries) {
      const child = join(dir, entry.name)
      try {
        const info = await statPath(child)
        if (newest === null || info.mtimeMs > newest) newest = info.mtimeMs
      } catch {
        /* ignore */
      }
    }
    return newest
  } catch {
    return null
  }
}

/** Locate one Session's directory, preferring the persistence backend's own answer. */
export async function locateSessionDir(
  sessionId: string,
  header: SessionHeaderLike | undefined,
  persistence: SessionPersistenceLike | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (header !== undefined && persistence?.locate !== undefined) {
    try {
      const located = persistence.locate(header)
      if (located?.path !== undefined && located.path.length > 0) {
        const { dirname } = await import('node:path')
        return dirname(located.path)
      }
    } catch {
      /* fall through to the layout fallback */
    }
  }
  const root = sessionsRoot(env)
  const segment = encodeSegment(sessionId)
  if (header !== undefined) {
    const expected = join(header.cwd === undefined ? join(root, '_no-cwd') : join(root, projectKey(header.cwd)), segment)
    try {
      const info = await statPath(expected)
      if (info.isDirectory()) return expected
    } catch {
      /* fall through to the scan */
    }
  }
  // Last resort: scan the project directories for a matching session directory.
  const { readdir } = await import('node:fs/promises')
  try {
    const projects = await readdir(root, { withFileTypes: true })
    for (const project of projects) {
      if (!project.isDirectory()) continue
      const candidate = join(root, project.name, segment)
      try {
        const info = await statPath(candidate)
        if (info.isDirectory()) return candidate
      } catch {
        /* keep scanning */
      }
    }
  } catch {
    return null
  }
  return null
}

/** JSON response helper. */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/** Read a JSON request body with a hard size bound. */
async function readJsonBody(request: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/**
 * Same-origin guard for mutating requests: a browser sends `Origin` on POST,
 * and a request whose origin host differs from the Host header is refused.
 */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return parsed.host === request.headers.host
  } catch {
    return false
  }
}

/** Read a `string[]` field defensively. */
function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`\`${field}\` must be an array`)
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) throw new Error(`\`${field}\` must contain non-empty strings`)
    out.push(item)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The archived-session service this plugin exposes to its own browser half
 * ------------------------------------------------------------------ */

interface DeleteOutcome {
  readonly sessionId: string
  readonly status: 'deleted' | 'skipped-live' | 'missing' | 'failed'
  readonly detail?: string
}

interface HostServices {
  readonly registry: WorkspaceRegistryLike | undefined
  readonly query: SessionQueryLike | undefined
  readonly persistence: SessionPersistenceLike | undefined
  readonly sessions: SessionsLike | undefined
  readonly log: LoggerLike | undefined
}

/** Assemble the archived-session views for the management page. */
export async function listArchivedSessions(services: HostServices, env: NodeJS.ProcessEnv = process.env): Promise<ArchivedSessionView[]> {
  const { registry, query, persistence, sessions } = services
  if (registry === undefined) return []
  const ids = [...registry.archivedSessionIds]
  if (ids.length === 0) return []

  const workspaces = safeList(registry)
  const bySession = new Map<string, WorkspaceLike>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) bySession.set(sessionId, workspace)
  }

  const headers = new Map<string, SessionHeaderLike>()
  if (persistence !== undefined) {
    const snapshots = await Promise.all(
      ids.map(async (id) => {
        try {
          return await persistence.stat(id)
        } catch {
          return undefined
        }
      }),
    )
    snapshots.forEach((snapshot, index) => {
      const id = ids[index]
      if (snapshot !== undefined && id !== undefined) headers.set(id, snapshot.header)
    })
  }

  const titles = await readTitles(query, ids)

  const views: ArchivedSessionView[] = []
  for (const id of ids) {
    const header = headers.get(id)
    const dir = await locateSessionDir(id, header, persistence, env)
    const [bytes, mtime] = dir === null
      ? [null, null]
      : await Promise.all([measureDirectory(dir), newestWriteTime(dir)])
    const workspace = bySession.get(id)
    const fallbackWorkspace = header?.cwd === undefined
      ? undefined
      : workspaces.find((candidate) => candidate.path === header.cwd)
    const owner = workspace ?? fallbackWorkspace
    const title = titles.get(id)
    const createdAt = header?.createdAt ?? 0
    const updatedAt = Math.max(
      createdAt,
      mtime ?? 0,
      title?.updatedAt ?? 0,
    )
    views.push({
      sessionId: id,
      title: title?.title ?? null,
      cwd: header?.cwd ?? null,
      workspaceId: owner?.id ?? null,
      workspaceTitle: owner?.title ?? null,
      createdAt,
      updatedAt: Math.round(Math.max(createdAt, mtime ?? 0, title?.updatedAt ?? 0)),
      live: sessions?.get(id) !== undefined,
      bytes,
      parentSessionId: header?.parentSession ?? null,
    })
  }
  return views
}

function safeList(registry: WorkspaceRegistryLike): WorkspaceLike[] {
  try {
    return registry.list()
  } catch {
    return []
  }
}

/** Read titles, preferring the batch API and degrading to per-Session reads. */
async function readTitles(
  query: SessionQueryLike | undefined,
  ids: readonly string[],
): Promise<Map<string, SessionTitleSnapshotLike>> {
  const out = new Map<string, SessionTitleSnapshotLike>()
  if (query === undefined) return out
  if (query.readTitleSnapshots !== undefined) {
    try {
      const results = await query.readTitleSnapshots([...ids])
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        const title = result.value.title
        if (title !== undefined) out.set(result.sessionId, title)
      }
      return out
    } catch {
      /* fall through to the per-Session path */
    }
  }
  if (query.readTitle !== undefined) {
    await Promise.all(ids.map(async (id) => {
      try {
        const title = await query.readTitle?.(id)
        if (title !== undefined) out.set(id, title)
      } catch {
        /* a title we cannot read is simply absent */
      }
    }))
  }
  return out
}

/**
 * Permanently delete archived Sessions.
 *
 * Order matters: the Session leaves the archive set and its Workspace
 * accounting **before** its files go, so no surface can expose an id whose
 * content is already gone, and the SQLite search index simply reconciles the
 * vanished rows on its next pass (it has no separate deletion call).
 */
export async function deleteArchivedSessions(
  services: HostServices,
  ids: readonly string[],
  options: { skipLive: boolean; maxBatch: number; env?: NodeJS.ProcessEnv } = { skipLive: true, maxBatch: 500 },
): Promise<DeleteOutcome[]> {
  const { registry, persistence, sessions, log } = services
  const env = options.env ?? process.env
  if (registry === undefined) throw new Error('the workspace registry service is unavailable')
  const archived = new Set(registry.archivedSessionIds)
  const outcomes: DeleteOutcome[] = []
  const batch = ids.slice(0, Math.max(1, options.maxBatch))

  for (const id of batch) {
    try {
      if (!archived.has(id)) {
        // Idempotent: a Session that already left the archive set is not an error.
        outcomes.push({ sessionId: id, status: 'missing', detail: 'not archived' })
        continue
      }
      if (options.skipLive && sessions?.get(id) !== undefined) {
        outcomes.push({ sessionId: id, status: 'skipped-live' })
        continue
      }

      const snapshot = persistence === undefined
        ? undefined
        : await persistence.stat(id).catch(() => undefined)
      const header = snapshot?.header
      const dir = await locateSessionDir(id, header, persistence, env)

      // 1. Leave the archive set (also clears any stale id whose files are gone).
      await registry.unarchiveSession(id)
      archived.delete(id)

      // 2. Drop Workspace accounting so the sidebar cannot render a ghost row.
      for (const workspace of safeList(registry)) {
        if (!workspace.sessionIds.includes(id)) continue
        try {
          await workspace.detachSession(id)
        } catch (error) {
          log?.warn?.(`[dsh-archive-manager] detachSession(${id}) failed: ${errorMessage(error)}`)
        }
      }

      // 3. Remove the Session directory and its projection-cache row.
      const present = dir !== null && await pathExists(dir)
      if (present && dir !== null) await rm(dir, { recursive: true, force: true })
      await rm(projectionCacheFile(id, env), { force: true })
      if (present && dir !== null && await pathExists(dir)) {
        throw new Error(`the session directory survived removal: ${dir}`)
      }

      outcomes.push({ sessionId: id, status: present ? 'deleted' : 'missing' })
      log?.info?.(`[dsh-archive-manager] deleted archived session ${id}`)
    } catch (error) {
      outcomes.push({ sessionId: id, status: 'failed', detail: errorMessage(error) })
      log?.warn?.(`[dsh-archive-manager] deleting ${id} failed: ${errorMessage(error)}`)
    }
  }
  return outcomes
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* ------------------------------------------------------------------ *
 * Plugin entry
 * ------------------------------------------------------------------ */

/**
 * Register the archive-manager HTTP surface.
 * @param ctx - Host context that may acquire the web server and session services.
 * @param config - Optional loader configuration.
 */
export function apply(ctx: HostContext, config?: Config): void {
  const skipLive = config?.skipLiveSessions ?? true
  const maxBatch = config?.maxDeleteBatch ?? 500

  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.get('webServer') as { register(route: WebRoute): () => void } | undefined
    if (webServer === undefined) return
    const services = (): HostServices => ({
      registry: hostCtx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined,
      query: hostCtx.get('sessionQuery') as SessionQueryLike | undefined,
      persistence: hostCtx.get('sessionPersistence') as SessionPersistenceLike | undefined,
      sessions: hostCtx.get('sessions') as SessionsLike | undefined,
      log: hostCtx.logger,
    })

    const dispose = webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
        const method = request.method ?? 'GET'
        try {
          if (method === 'GET' && route === '/archived') {
            const views = await listArchivedSessions(services())
            sendJson(response, 200, { ok: true, sessions: views, total: views.length })
            return
          }
          if (method === 'POST' && (route === '/delete' || route === '/delete-all')) {
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
              return
            }
            const body = await readJsonBody(request)
            const requested = route === '/delete-all'
              ? [...(services().registry?.archivedSessionIds ?? [])]
              : stringArray((body as { sessionIds?: unknown } | undefined)?.sessionIds, 'sessionIds')
            if (requested.length === 0) {
              sendJson(response, 200, { ok: true, outcomes: [], deleted: 0 })
              return
            }
            const outcomes = await deleteArchivedSessions(services(), requested, { skipLive, maxBatch })
            const remaining = services().registry?.archivedSessionIds?.length ?? 0
            sendJson(response, 200, {
              ok: true,
              outcomes,
              deleted: outcomes.filter((outcome) => outcome.status === 'deleted').length,
              remaining,
            })
            return
          }
          if (method === 'POST' && route === '/unarchive') {
            if (!sameOrigin(request)) {
              sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
              return
            }
            const body = await readJsonBody(request)
            const ids = stringArray((body as { sessionIds?: unknown } | undefined)?.sessionIds, 'sessionIds')
            const registry = services().registry
            if (registry === undefined) throw new Error('the workspace registry service is unavailable')
            const restored: string[] = []
            for (const id of ids) {
              await registry.unarchiveSession(id)
              restored.push(id)
            }
            sendJson(response, 200, { ok: true, restored })
            return
          }
          sendJson(response, 404, { ok: false, error: `unknown route ${method} ${route}` })
        } catch (error) {
          sendJson(response, 400, { ok: false, error: errorMessage(error) })
        }
      },
    })
    hostCtx.effect(() => dispose, 'dsh-archive-manager: http routes')
  })
}
