/**
 * Host-side integration test for the destructive half. Deletion runs against a
 * throwaway DSH_HOME on the real filesystem, with the Harness services replaced
 * by small fakes that record what was asked of them.
 *
 * The rules under test are the ones the plugin learned the hard way:
 *  - a deleted Session must leave every surface, including already-connected
 *    browsers (the forwarded `api-session/removed` event);
 *  - its archive record must NOT be released while the Host still holds the
 *    Session, or the workspace stops hiding the row;
 *  - only a running turn justifies skipping a delete; loaded-but-idle is fine.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteArchivedSessions, listArchivedSessions, purgeArchiveRecords, resolveHarnessHome } from '../lib/index.js'
import { projectKey } from '../lib/shared/model.js'

/** Create `<home>/sessions/<project>/<id>/session.jsonl.zstd` plus a projcache row. */
async function seedSession(home, id, cwd) {
  const dir = join(home, 'sessions', projectKey(cwd), id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.jsonl.zstd'), 'x'.repeat(64))
  const cache = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, `${id}.json`), JSON.stringify({ version: 2, record: { sessionId: id } }))
  return dir
}

/** Fake every Host service deletion touches, recording each call. */
function fakeServices({ archivedIds, headers = {}, workspaces = [], live = [], running = [], activity = {}, withLocate = true, withStorageDomain = false }) {
  const unarchived = []
  const announced = []
  const cacheDeletes = []
  const dirOf = (id) => {
    const cwd = headers[id]?.cwd
    return cwd === undefined ? join('_no-cwd', id) : join(projectKey(cwd), id)
  }
  return {
    unarchived,
    announced,
    cacheDeletes,
    services: {
      registry: {
        get archivedSessionIds() {
          return archivedIds.filter((id) => !unarchived.includes(id))
        },
        list: () => workspaces,
        async unarchiveSession(id) {
          unarchived.push(id)
        },
      },
      persistence: {
        async stat(id) {
          return headers[id] === undefined ? undefined : { header: headers[id] }
        },
        ...(withLocate
          ? {
            locate(header) {
              return { path: join(header.home, 'sessions', dirOf(header.id), 'session.jsonl.zstd') }
            },
          }
          : {}),
      },
      sessions: { get: (id) => (live.includes(id) ? { header: headers[id] } : undefined) },
      agents: { get: (id) => (running.includes(id) ? { status: 'running' } : { status: 'idle' }) },
      readActivity: async (id) => activity[id] ?? [],
      ...(withStorageDomain
        ? {
          storageDomain: {
            get: (name) => (name === 'session_projcache'
              ? { table: (table) => (table === 'sessions' ? { delete: (key) => { cacheDeletes.push(key) } } : undefined) }
              : undefined),
          },
        }
        : {}),
      announceRemoved: (id) => announced.push(id),
    },
  }
}

test('resolveHarnessHome honours DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(resolveHarnessHome({ DSH_HOME: 'C:\\tmp\\dsh-test' }), 'C:\\tmp\\dsh-test')
  assert.match(resolveHarnessHome({}), /\.dsh$/)
})

test('deleting an idle archived session removes its files and releases the record', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-delete-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-021be412-6b80-48eb-8b9d-1e003d608ba6'
  const dir = await seedSession(home, id, cwd)
  assert.ok(existsSync(dir))

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1785778490000, home } },
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })

  assert.deepEqual(outcomes, [{ sessionId: id, status: 'deleted' }])
  assert.equal(existsSync(dir), false, 'session directory must be gone')
  assert.equal(existsSync(join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)), false, 'cache row must be gone')
  // Nothing can resurrect it, so the archive record goes too — otherwise the
  // archived page would keep listing a record with no content.
  assert.deepEqual(harness.unarchived, [id])
  assert.deepEqual(harness.services.registry.archivedSessionIds, [])
  // And every connected browser is told to drop the row.
  assert.deepEqual(harness.announced, [id])
})

test('a session the Host still holds keeps its archive record as a tombstone', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-residue-'))
  const cwd = 'E:\\DSH-workspace'
  const id = 'session-loaded'
  const dir = await seedSession(home, id, cwd)

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1, home } },
    live: [id],
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })

  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].status, 'deleted')
  assert.equal(outcomes[0].residue, true)
  assert.equal(existsSync(dir), false, 'the log is still removed')
  // The record stays: it is what keeps the workspace hiding the row while the
  // in-memory Session keeps the id alive.
  assert.deepEqual(harness.unarchived, [])
  assert.deepEqual(harness.services.registry.archivedSessionIds, [id])
  assert.deepEqual(harness.announced, [id])
})

test('a session whose turn is running is skipped untouched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-running-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-running'
  const dir = await seedSession(home, id, cwd)

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1, home } },
    live: [id],
    running: [id],
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })

  assert.deepEqual(outcomes, [{ sessionId: id, status: 'skipped-running', detail: 'active work: turn' }])
  assert.ok(existsSync(dir), 'a running session keeps its files')
  assert.deepEqual(harness.services.registry.archivedSessionIds, [id])
  assert.deepEqual(harness.announced, [])
})

test('any reported activity (job, subagent, schedule) also blocks deletion', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-activity-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-job'
  const dir = await seedSession(home, id, cwd)

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1, home } },
    activity: { [id]: ['job'] },
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })
  assert.deepEqual(outcomes, [{ sessionId: id, status: 'skipped-running', detail: 'active work: job' }])
  assert.ok(existsSync(dir))
})

test('the projection-cache row is dropped through its storage domain when mounted', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-cache-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-cached'
  await seedSession(home, id, cwd)

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1, home } },
    withStorageDomain: true,
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })
  assert.equal(outcomes[0].status, 'deleted')
  // The domain owns both the in-memory row and the file; going through it is
  // what stops the next checkpoint from writing the row back.
  assert.deepEqual(harness.cacheDeletes, [id])
})

test('a loaded-but-idle session is deletable (only running blocks)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-idle-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-idle'
  const dir = await seedSession(home, id, cwd)

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1, home } },
    live: [id],
    running: [],
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], { skipRunning: true, maxBatch: 10, env: { DSH_HOME: home } })
  assert.equal(outcomes[0].status, 'deleted')
  assert.equal(existsSync(dir), false)
})

test('an archived id whose files are already gone releases its record and clears clients', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-ghost-'))
  const harness = fakeServices({ archivedIds: ['session-ghost'], withLocate: false })
  const outcomes = await deleteArchivedSessions(harness.services, ['session-ghost'], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })
  assert.deepEqual(outcomes, [{ sessionId: 'session-ghost', status: 'missing' }])
  assert.deepEqual(harness.services.registry.archivedSessionIds, [])
  assert.deepEqual(harness.announced, ['session-ghost'])
})

test('an id that is no longer archived is not an error, and still clears clients', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-stale-'))
  const harness = fakeServices({ archivedIds: [] })
  const outcomes = await deleteArchivedSessions(harness.services, ['session-stale'], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })
  assert.equal(outcomes[0].status, 'missing')
  assert.deepEqual(harness.announced, ['session-stale'])
})

test('deletion falls back to the on-disk layout when persistence cannot locate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-fallback-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-fallback'
  const dir = await seedSession(home, id, cwd)

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1, home } },
    withLocate: false,
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipRunning: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })
  assert.deepEqual(outcomes, [{ sessionId: id, status: 'deleted' }])
  assert.equal(existsSync(dir), false)
})

test('listing reports persisted, live and running state with integer timestamps', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-list-'))
  const cwd = 'E:\\Git\\repositoris'
  const onDisk = 'session-on-disk'
  const loadedOnly = 'session-loaded-only'
  await seedSession(home, onDisk, cwd)

  const headers = {
    [onDisk]: { id: onDisk, cwd, createdAt: 1785778490000, home },
    [loadedOnly]: { id: loadedOnly, cwd, createdAt: 1785778400000, home },
  }
  const workspace = { id: 'w1', path: cwd, title: 'repositoris', sessionIds: [onDisk, loadedOnly] }
  const harness = fakeServices({
    archivedIds: [onDisk, loadedOnly],
    headers,
    workspaces: [workspace],
    live: [loadedOnly],
    running: [loadedOnly],
  })
  const views = await listArchivedSessions({
    ...harness.services,
    // Only the seeded id has a log; the other exists only in memory.
    persistence: {
      async stat(id) {
        return id === onDisk ? { header: headers[id] } : undefined
      },
      locate(header) {
        return { path: join(header.home, 'sessions', projectKey(header.cwd), header.id, 'session.jsonl.zstd') }
      },
    },
    query: {
      async readTitleSnapshots() {
        return [{ sessionId: onDisk, status: 'fulfilled', value: { title: { title: '删除用户安装的Leinator市场', updatedAt: 1785778490500 } } }]
      },
    },
    log: undefined,
  }, { DSH_HOME: home })

  assert.equal(views.length, 2)
  const disk = views.find((view) => view.sessionId === onDisk)
  assert.equal(disk.persisted, true)
  assert.equal(disk.live, false)
  assert.equal(disk.running, false)
  assert.equal(disk.title, '删除用户安装的Leinator市场')
  assert.equal(disk.cwd, cwd)
  assert.equal(disk.workspaceId, 'w1')
  assert.equal(disk.createdAt, 1785778490000)
  assert.equal(disk.bytes, 64)
  assert.ok(Number.isInteger(disk.updatedAt), 'updatedAt must be an integer epoch')
  assert.ok(disk.updatedAt >= 1785778490500, 'updatedAt must not predate the title event')

  const memory = views.find((view) => view.sessionId === loadedOnly)
  assert.equal(memory.persisted, false, 'no log on disk')
  assert.equal(memory.live, true)
  assert.equal(memory.running, true, 'an Agent is running this one')
  assert.equal(memory.cwd, cwd, 'the live header still describes it')
})

test('purge releases only records whose log is gone and whose session is unloaded', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-purge-'))
  const cwd = 'E:\\Git\\repositoris'
  const ghost = 'session-ghost'
  const withLog = 'session-with-log'
  const loaded = 'session-loaded'
  await seedSession(home, withLog, cwd)

  const harness = fakeServices({
    archivedIds: [ghost, withLog, loaded],
    headers: {
      [withLog]: { id: withLog, cwd, createdAt: 1, home },
      [loaded]: { id: loaded, cwd, createdAt: 2, home },
    },
    live: [loaded],
  })
  const outcomes = await purgeArchiveRecords(harness.services, [ghost, withLog, loaded], { DSH_HOME: home })

  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['purged', 'kept', 'kept'])
  assert.match(outcomes[1].detail, /log still exists/)
  assert.match(outcomes[2].detail, /still loaded/)
  assert.deepEqual(harness.unarchived, [ghost])
  assert.deepEqual(harness.announced, [ghost])
})
