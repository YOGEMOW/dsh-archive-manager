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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rm, stat as statPath } from 'node:fs/promises';
import { encodeSegment, projectKey, } from "./shared/model.js";
export const name = 'dsh-archive-manager';
/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-archive-manager';
/** The storage domain the persisted projection cache is mounted under. */
const PROJECTION_CACHE_DOMAIN = 'session_projcache';
const PROJECTION_CACHE_TABLE = 'sessions';
/* ------------------------------------------------------------------ *
 * Host-side helpers
 * ------------------------------------------------------------------ */
/** Resolve the Harness home the same way `@deepseek-ai/dsh-home-paths` does. */
export function resolveHarnessHome(env = process.env) {
    const configured = env.DSH_HOME?.trim();
    if (configured !== undefined && configured.length > 0) {
        if (configured === '~')
            return homedir();
        if (configured.startsWith('~/') || configured.startsWith('~\\'))
            return join(homedir(), configured.slice(2));
        return configured;
    }
    return join(homedir(), '.dsh');
}
/** The sessions root a JSONL persistence backend is configured with. */
export function sessionsRoot(env = process.env) {
    return join(resolveHarnessHome(env), 'sessions');
}
/** Path of one Session's projection-cache row. */
function projectionCacheFile(sessionId, env = process.env) {
    return join(resolveHarnessHome(env), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`);
}
/** True when the path exists (file or directory). */
async function pathExists(path) {
    try {
        await statPath(path);
        return true;
    }
    catch {
        return false;
    }
}
/** Best-effort directory size, bounded so a pathological directory cannot stall a page load. */
async function measureDirectory(dir, maxEntries = 512) {
    const { readdir } = await import('node:fs/promises');
    let total = 0;
    let seen = 0;
    const queue = [dir];
    while (queue.length > 0) {
        const current = queue.pop();
        if (current === undefined)
            break;
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (seen++ > maxEntries)
                return total;
            const child = join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(child);
                continue;
            }
            try {
                const info = await statPath(child);
                total += info.size;
            }
            catch {
                /* a file that vanished mid-walk contributes nothing */
            }
        }
    }
    return total;
}
/** Newest modification time among the Session's files, or `null`. */
async function newestWriteTime(dir) {
    const { readdir } = await import('node:fs/promises');
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        let newest = null;
        for (const entry of entries) {
            const child = join(dir, entry.name);
            try {
                const info = await statPath(child);
                if (newest === null || info.mtimeMs > newest)
                    newest = info.mtimeMs;
            }
            catch {
                /* ignore */
            }
        }
        return newest;
    }
    catch {
        return null;
    }
}
/** Locate one Session's directory, preferring the persistence backend's own answer. */
export async function locateSessionDir(sessionId, header, persistence, env = process.env) {
    if (header !== undefined && persistence?.locate !== undefined) {
        try {
            const located = persistence.locate(header);
            if (located?.path !== undefined && located.path.length > 0) {
                const { dirname } = await import('node:path');
                return dirname(located.path);
            }
        }
        catch {
            /* fall through to the layout fallback */
        }
    }
    const root = sessionsRoot(env);
    const segment = encodeSegment(sessionId);
    if (header !== undefined) {
        const expected = join(header.cwd === undefined ? join(root, '_no-cwd') : join(root, projectKey(header.cwd)), segment);
        try {
            const info = await statPath(expected);
            if (info.isDirectory())
                return expected;
        }
        catch {
            /* fall through to the scan */
        }
    }
    // Last resort: scan the project directories for a matching session directory.
    const { readdir } = await import('node:fs/promises');
    try {
        const projects = await readdir(root, { withFileTypes: true });
        for (const project of projects) {
            if (!project.isDirectory())
                continue;
            const candidate = join(root, project.name, segment);
            try {
                const info = await statPath(candidate);
                if (info.isDirectory())
                    return candidate;
            }
            catch {
                /* keep scanning */
            }
        }
    }
    catch {
        return null;
    }
    return null;
}
/** JSON response helper. */
function sendJson(response, status, body) {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
}
/** Read a JSON request body with a hard size bound. */
async function readJsonBody(request, limit = 256 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > limit)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return undefined;
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/**
 * Same-origin guard for mutating requests: a browser sends `Origin` on POST,
 * and a request whose origin host differs from the Host header is refused.
 */
function sameOrigin(request) {
    const origin = request.headers.origin;
    if (origin === undefined)
        return true;
    try {
        const parsed = new URL(origin);
        return parsed.host === request.headers.host;
    }
    catch {
        return false;
    }
}
/** Read a `string[]` field defensively. */
function stringArray(value, field) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error(`\`${field}\` must be an array`);
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string' || item.length === 0)
            throw new Error(`\`${field}\` must contain non-empty strings`);
        out.push(item);
    }
    return out;
}
/** Drop one Session's projection-cache row through its owning storage domain. */
async function dropProjectionCacheRow(services, sessionId) {
    const table = services.storageDomain?.get(PROJECTION_CACHE_DOMAIN)?.table(PROJECTION_CACHE_TABLE);
    if (table !== undefined) {
        // The domain owns both the in-memory row and the file; a raw rm would leave
        // the row behind and the next checkpoint would write the file back.
        await table.delete(sessionId);
        return 'domain';
    }
    return 'file';
}
/** Assemble the archived-session views for the management page. */
export async function listArchivedSessions(services, env = process.env) {
    const { registry, query, persistence, sessions, agents, readActivity } = services;
    if (registry === undefined)
        return [];
    const ids = [...registry.archivedSessionIds];
    if (ids.length === 0)
        return [];
    const workspaces = safeList(registry);
    const bySession = new Map();
    for (const workspace of workspaces) {
        for (const sessionId of workspace.sessionIds)
            bySession.set(sessionId, workspace);
    }
    const persisted = new Map();
    if (persistence !== undefined) {
        const snapshots = await Promise.all(ids.map(async (id) => {
            try {
                return await persistence.stat(id);
            }
            catch {
                return undefined;
            }
        }));
        snapshots.forEach((snapshot, index) => {
            const id = ids[index];
            if (snapshot !== undefined && id !== undefined)
                persisted.set(id, snapshot.header);
        });
    }
    const titles = await readTitles(query, ids);
    const views = [];
    for (const id of ids) {
        const live = sessions?.get(id);
        // A Session can be loaded in the Host process while its log is already
        // gone; its in-memory header still describes it, so prefer the durable one
        // and fall back to the live one rather than reporting an empty row.
        const header = persisted.get(id) ?? live?.header;
        const dir = await locateSessionDir(id, header, persistence, env);
        const [bytes, mtime] = dir === null
            ? [null, null]
            : await Promise.all([measureDirectory(dir), newestWriteTime(dir)]);
        const workspace = bySession.get(id);
        const fallbackWorkspace = header?.cwd === undefined
            ? undefined
            : workspaces.find((candidate) => candidate.path === header.cwd);
        const owner = workspace ?? fallbackWorkspace;
        const title = titles.get(id);
        const createdAt = header?.createdAt ?? 0;
        const activity = readActivity === undefined ? [] : await readActivity(id);
        views.push({
            sessionId: id,
            title: title?.title ?? null,
            cwd: header?.cwd ?? null,
            workspaceId: owner?.id ?? null,
            workspaceTitle: owner?.title ?? null,
            createdAt,
            updatedAt: Math.round(Math.max(createdAt, mtime ?? 0, title?.updatedAt ?? 0)),
            bytes,
            parentSessionId: header?.parentSession ?? null,
            persisted: persisted.has(id),
            live: live !== undefined,
            running: agents?.get(id)?.status === 'running' || activity.length > 0,
            activity,
        });
    }
    return views;
}
function safeList(registry) {
    try {
        return registry.list();
    }
    catch {
        return [];
    }
}
/** Read titles, preferring the batch API and degrading to per-Session reads. */
async function readTitles(query, ids) {
    const out = new Map();
    if (query === undefined)
        return out;
    if (query.readTitleSnapshots !== undefined) {
        try {
            const results = await query.readTitleSnapshots([...ids]);
            for (const result of results) {
                if (result.status !== 'fulfilled')
                    continue;
                const title = result.value.title;
                if (title !== undefined)
                    out.set(result.sessionId, title);
            }
            return out;
        }
        catch {
            /* fall through to the per-Session path */
        }
    }
    if (query.readTitle !== undefined) {
        await Promise.all(ids.map(async (id) => {
            try {
                const title = await query.readTitle?.(id);
                if (title !== undefined)
                    out.set(id, title);
            }
            catch {
                /* a title we cannot read is simply absent */
            }
        }));
    }
    return out;
}
/**
 * Permanently delete archived Sessions.
 *
 * Three rules, each of which exists because of a failure mode this plugin hit
 * in practice:
 *
 * 1. **Never unarchive while the Session is loaded.** DSH hides archived rows
 *    from the workspace, so dropping the archive id is what made a deleted
 *    Session "come back" in the sidebar. The id is released only once the
 *    Session is gone from the Host process too — then nothing can resurrect it.
 * 2. **Announce the removal.** The browser's Session list is a snapshot: a file
 *    disappearing produces no frame, so the client keeps the row. Emitting the
 *    forwarded `api-session/removed` event removes it live, in every window.
 * 3. **Skip only what is actually running.** `ctx.sessions` holds *loaded*
 *    Sessions, including idle ones; the running question is the Agent's
 *    `status`, exactly as the Session controller answers it.
 */
export async function deleteArchivedSessions(services, ids, options = { skipRunning: true, maxBatch: 500 }) {
    const { registry, persistence, sessions, agents, log, readActivity, announceRemoved } = services;
    const env = options.env ?? process.env;
    if (registry === undefined)
        throw new Error('the workspace registry service is unavailable');
    const archived = new Set(registry.archivedSessionIds);
    const outcomes = [];
    const batch = ids.slice(0, Math.max(1, options.maxBatch));
    for (const id of batch) {
        try {
            if (!archived.has(id)) {
                // Idempotent: a Session that already left the archive set is not an
                // error, and a client may still show a stale row for it.
                announceRemoved?.(id);
                outcomes.push({ sessionId: id, status: 'missing', detail: 'not archived' });
                continue;
            }
            // Busy means a running turn or any work the Harness' own activity
            // providers report (job, subagent, schedule) — the same question
            // `Workspace.archiveSession` asks before it admits a Session.
            const activity = readActivity === undefined ? [] : await readActivity(id);
            const runningTurn = agents?.get(id)?.status === 'running';
            if (options.skipRunning && (runningTurn || activity.length > 0)) {
                outcomes.push({
                    sessionId: id,
                    status: 'skipped-running',
                    detail: `active work: ${runningTurn ? 'turn' : ''}${runningTurn && activity.length > 0 ? '/' : ''}${activity.join('/')}`,
                });
                continue;
            }
            const snapshot = persistence === undefined
                ? undefined
                : await persistence.stat(id).catch(() => undefined);
            const header = snapshot?.header ?? sessions?.get(id)?.header;
            const dir = await locateSessionDir(id, header, persistence, env);
            // Remove the Session directory and its projection-cache row. The
            // in-memory search index needs no call: it reconciles the vanished rows
            // against persistence on its next pass.
            const present = dir !== null && await pathExists(dir);
            if (present && dir !== null)
                await rm(dir, { recursive: true, force: true });
            const dropped = await dropProjectionCacheRow(services, id);
            if (dropped === 'file')
                await rm(projectionCacheFile(id, env), { force: true });
            if (present && dir !== null && await pathExists(dir)) {
                throw new Error(`the session directory survived removal: ${dir}`);
            }
            const residue = sessions?.get(id) !== undefined;
            if (!residue) {
                await registry.unarchiveSession(id);
                archived.delete(id);
            }
            announceRemoved?.(id);
            outcomes.push({
                sessionId: id,
                status: present ? 'deleted' : 'missing',
                ...(residue
                    ? { residue: true, detail: 'the session is still loaded in this Host process; its archive record is kept so the workspace keeps hiding it' }
                    : {}),
            });
            log?.info?.(`[dsh-archive-manager] deleted archived session ${id}${residue ? ' (live residue)' : ''}`);
        }
        catch (error) {
            outcomes.push({ sessionId: id, status: 'failed', detail: errorMessage(error) });
            log?.warn?.(`[dsh-archive-manager] deleting ${id} failed: ${errorMessage(error)}`);
        }
    }
    return outcomes;
}
/**
 * Release the archive records of Sessions whose logs are already gone.
 *
 * `deleteArchivedSessions` keeps such a record only while the Session is still
 * loaded (the record is what keeps the workspace hiding it). Once the Host
 * process has released it, the record is pure residue and can be dropped —
 * but only then, or the row would reappear.
 */
export async function purgeArchiveRecords(services, ids, env = process.env) {
    const { registry, persistence, sessions, log, announceRemoved } = services;
    if (registry === undefined)
        throw new Error('the workspace registry service is unavailable');
    const out = [];
    for (const id of ids) {
        try {
            if (!registry.archivedSessionIds.includes(id)) {
                out.push({ sessionId: id, status: 'kept', detail: 'not archived' });
                continue;
            }
            if (sessions?.get(id) !== undefined) {
                out.push({ sessionId: id, status: 'kept', detail: 'the session is still loaded; restart DSH first' });
                continue;
            }
            if (persistence !== undefined && await persistence.stat(id).catch(() => undefined) !== undefined) {
                out.push({ sessionId: id, status: 'kept', detail: 'the session log still exists; delete it instead' });
                continue;
            }
            await registry.unarchiveSession(id);
            announceRemoved?.(id);
            out.push({ sessionId: id, status: 'purged' });
        }
        catch (error) {
            out.push({ sessionId: id, status: 'failed', detail: errorMessage(error) });
            log?.warn?.(`[dsh-archive-manager] purging the record of ${id} failed: ${errorMessage(error)}`);
        }
    }
    void env;
    return out;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/* ------------------------------------------------------------------ *
 * Plugin entry
 * ------------------------------------------------------------------ */
/**
 * Register the archive-manager HTTP surface.
 * @param ctx - Host context that may acquire the web server and session services.
 * @param config - Optional loader configuration.
 */
export function apply(ctx, config) {
    const skipRunning = config?.skipRunningSessions ?? config?.skipLiveSessions ?? true;
    const maxBatch = config?.maxDeleteBatch ?? 500;
    ctx.inject(['webServer'], (hostCtx) => {
        const webServer = hostCtx.get('webServer');
        if (webServer === undefined)
            return;
        const services = () => ({
            registry: hostCtx.get('workspaceRegistry'),
            query: hostCtx.get('sessionQuery'),
            persistence: hostCtx.get('sessionPersistence'),
            sessions: hostCtx.get('sessions'),
            agents: hostCtx.get('agents'),
            storageDomain: hostCtx.get('storageDomain'),
            log: hostCtx.logger,
            readActivity: async (sessionId) => {
                // Best effort: a composition without activity providers simply reports none.
                try {
                    const result = await hostCtx.waterfall?.('workspace/session-activity', { sessionId }, () => Promise.resolve([]));
                    if (!Array.isArray(result))
                        return [];
                    return result.map((entry) => {
                        const kind = entry?.kind;
                        return typeof kind === 'string' ? kind : 'unknown';
                    });
                }
                catch {
                    return [];
                }
            },
            announceRemoved: (sessionId) => hostCtx.emit?.('api-session/removed', sessionId),
        });
        const dispose = webServer.register({
            kind: 'prefix',
            path: ROUTE_PREFIX,
            handler: async (request, response) => {
                const url = new URL(request.url ?? '/', 'http://localhost');
                const route = url.pathname.slice(ROUTE_PREFIX.length) || '/';
                const method = request.method ?? 'GET';
                try {
                    if (method === 'GET' && route === '/archived') {
                        const views = await listArchivedSessions(services());
                        sendJson(response, 200, { ok: true, sessions: views, total: views.length });
                        return;
                    }
                    if (method === 'POST' && (route === '/delete' || route === '/delete-all' || route === '/purge-records')) {
                        if (!sameOrigin(request)) {
                            sendJson(response, 403, { ok: false, error: 'cross-origin request refused' });
                            return;
                        }
                        const body = await readJsonBody(request);
                        const requested = route === '/delete-all'
                            ? [...(services().registry?.archivedSessionIds ?? [])]
                            : stringArray(body?.sessionIds, 'sessionIds');
                        if (requested.length === 0) {
                            sendJson(response, 200, { ok: true, outcomes: [], deleted: 0 });
                            return;
                        }
                        if (route === '/purge-records') {
                            const purged = await purgeArchiveRecords(services(), requested);
                            sendJson(response, 200, {
                                ok: true,
                                outcomes: purged,
                                purged: purged.filter((outcome) => outcome.status === 'purged').length,
                                remaining: services().registry?.archivedSessionIds?.length ?? 0,
                            });
                            return;
                        }
                        const outcomes = await deleteArchivedSessions(services(), requested, { skipRunning, maxBatch });
                        sendJson(response, 200, {
                            ok: true,
                            outcomes,
                            deleted: outcomes.filter((outcome) => outcome.status === 'deleted').length,
                            remaining: services().registry?.archivedSessionIds?.length ?? 0,
                        });
                        return;
                    }
                    if (method === 'POST' && route === '/unarchive') {
                        if (!sameOrigin(request)) {
                            sendJson(response, 403, { ok: false, error: 'cross-origin request refused' });
                            return;
                        }
                        const body = await readJsonBody(request);
                        const ids = stringArray(body?.sessionIds, 'sessionIds');
                        const registry = services().registry;
                        if (registry === undefined)
                            throw new Error('the workspace registry service is unavailable');
                        const restored = [];
                        for (const id of ids) {
                            await registry.unarchiveSession(id);
                            restored.push(id);
                        }
                        sendJson(response, 200, { ok: true, restored });
                        return;
                    }
                    sendJson(response, 404, { ok: false, error: `unknown route ${method} ${route}` });
                }
                catch (error) {
                    sendJson(response, 400, { ok: false, error: errorMessage(error) });
                }
            },
        });
        hostCtx.effect(() => dispose, 'dsh-archive-manager: http routes');
    });
}
