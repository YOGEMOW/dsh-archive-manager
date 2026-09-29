/**
 * Host-side integration test for the destructive half: permanent deletion runs
 * against a throwaway DSH_HOME on the real filesystem, with the Harness
 * services replaced by small fakes that record what was asked of them.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteArchivedSessions, listArchivedSessions, resolveHarnessHome } from '../lib/index.js'
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

/** Fake the three Host services deletion touches, recording every call. */
function fakeServices({ archivedIds, headers = {}, workspaces = [], live = [], withLocate = true }) {
  const unarchived = []
  const detached = []
  const dirOf = (id) => {
    const cwd = headers[id]?.cwd
    return cwd === undefined ? join('_no-cwd', id) : join(projectKey(cwd), id)
  }
  return {
    unarchived,
    detached,
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
      sessions: { get: (id) => (live.includes(id) ? { id } : undefined) },
    },
  }
}

test('resolveHarnessHome honours DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(resolveHarnessHome({ DSH_HOME: 'C:\\tmp\\dsh-test' }), 'C:\\tmp\\dsh-test')
  assert.match(resolveHarnessHome({}), /\.dsh$/)
})

test('deleting an archived session removes its files, its cache row and its accounting', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-delete-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-021be412-6b80-48eb-8b9d-1e003d608ba6'
  const dir = await seedSession(home, id, cwd)
  assert.ok(existsSync(dir))

  const workspace = {
    id: 'w1',
    path: cwd,
    title: 'repositoris',
    sessionIds: [id],
    detached: [],
    async detachSession(sessionId) {
      this.detached.push(sessionId)
      this.sessionIds = this.sessionIds.filter((value) => value !== sessionId)
    },
  }
  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1785778490000, home } },
    workspaces: [workspace],
  })
  // `locate` receives the header, so give it the home the fake needs.
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipLive: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })

  assert.deepEqual(outcomes, [{ sessionId: id, status: 'deleted' }])
  assert.equal(existsSync(dir), false, 'session directory must be gone')
  assert.equal(existsSync(join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)), false, 'cache row must be gone')
  assert.deepEqual(harness.unarchived, [id])
  assert.deepEqual(workspace.detached, [id])
  assert.deepEqual(harness.services.registry.archivedSessionIds, [])
})

test('a session still loaded in the Host process is skipped, not deleted', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-live-'))
  const cwd = 'E:\\DSH-workspace'
  const id = 'session-live'
  const dir = await seedSession(home, id, cwd)

  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1, home } },
    live: [id],
  })
  const outcomes = await deleteArchivedSessions(harness.services, [id], {
    skipLive: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })

  assert.deepEqual(outcomes, [{ sessionId: id, status: 'skipped-live' }])
  assert.ok(existsSync(dir), 'a running session keeps its files')
  assert.deepEqual(harness.services.registry.archivedSessionIds, [id])
})

test('an archived id whose files are already gone still leaves the archive set', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-ghost-'))
  const harness = fakeServices({ archivedIds: ['session-ghost'], withLocate: false })
  const outcomes = await deleteArchivedSessions(harness.services, ['session-ghost'], {
    skipLive: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })
  assert.deepEqual(outcomes, [{ sessionId: 'session-ghost', status: 'missing' }])
  assert.deepEqual(harness.services.registry.archivedSessionIds, [])
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
    skipLive: true,
    maxBatch: 10,
    env: { DSH_HOME: home },
  })
  assert.deepEqual(outcomes, [{ sessionId: id, status: 'deleted' }])
  assert.equal(existsSync(dir), false)
})

test('listing reports title, project, size and integer timestamps', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-list-'))
  const cwd = 'E:\\Git\\repositoris'
  const id = 'session-aaa'
  await seedSession(home, id, cwd)

  const workspace = { id: 'w1', path: cwd, title: 'repositoris', sessionIds: [id], async detachSession() {} }
  const harness = fakeServices({
    archivedIds: [id],
    headers: { [id]: { id, cwd, createdAt: 1785778490000, home } },
    workspaces: [workspace],
  })
  const views = await listArchivedSessions({
    ...harness.services,
    query: {
      async readTitleSnapshots() {
        return [{ sessionId: id, status: 'fulfilled', value: { title: { title: '删除用户安装的Leinator市场', updatedAt: 1785778490500 } } }]
      },
    },
    log: undefined,
  }, { DSH_HOME: home })

  assert.equal(views.length, 1)
  const view = views[0]
  assert.equal(view.sessionId, id)
  assert.equal(view.title, '删除用户安装的Leinator市场')
  assert.equal(view.cwd, cwd)
  assert.equal(view.workspaceId, 'w1')
  assert.equal(view.workspaceTitle, 'repositoris')
  assert.equal(view.createdAt, 1785778490000)
  assert.equal(view.live, false)
  assert.equal(view.bytes, 64)
  assert.equal(view.parentSessionId, null)
  // updatedAt is the newest of creation, last write and title event, as an integer.
  assert.ok(Number.isInteger(view.updatedAt), 'updatedAt must be an integer epoch')
  assert.ok(view.updatedAt >= 1785778490500, 'updatedAt must not predate the title event')
})
