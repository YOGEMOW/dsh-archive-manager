/**
 * Unit tests for the pure archive model. They run against the built Host
 * output (`lib/shared/model.js`), so `npm test` builds the Host half first.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALL_PROJECTS_KEY,
  NO_PROJECT_KEY,
  encodeSegment,
  formatBytes,
  groupArchivedSessions,
  isResidue,
  projectKey,
  projectOptions,
  selectArchivedSessions,
  sessionDisplayTitle,
} from '../lib/shared/model.js'

/** @returns {import('../lib/shared/model.js').ArchivedSessionView} */
function session(overrides) {
  return {
    sessionId: 'session-1',
    title: 'T',
    cwd: null,
    workspaceId: null,
    workspaceTitle: null,
    createdAt: 1000,
    updatedAt: 2000,
    bytes: null,
    parentSessionId: null,
    persisted: true,
    live: false,
    running: false,
    activity: [],
    ...overrides,
  }
}

test('projectKey reproduces the layout observed on disk', () => {
  // These two directory names exist under ~/.dsh/sessions on the author machine.
  assert.equal(projectKey('E:\\Git\\repositoris'), '--E-Git-repositoris--')
  assert.equal(projectKey('E:\\DSH-workspace\\mineru-ocr'), '--E-DSH-workspace-mineru-ocr--')
  assert.equal(projectKey('/home/me/code'), '--home-me-code--')
  // A trailing separator is kept as a dash, exactly as the Harness' own projectKey does.
  assert.equal(projectKey('C:\\'), '--C---')
})

test('encodeSegment leaves a session id untouched and escapes the rest', () => {
  assert.equal(encodeSegment('session-021be412-6b80-48eb-8b9d-1e003d608ba6'), 'session-021be412-6b80-48eb-8b9d-1e003d608ba6')
  assert.equal(encodeSegment('..'), '~002E~002E')
  assert.equal(encodeSegment('a/b'), 'a~002Fb')
})

test('selectArchivedSessions filters by search, scope and project', () => {
  const rows = [
    session({ sessionId: 'a', title: '删除用户安装的Leinator市场', workspaceId: 'w1', workspaceTitle: 'repositoris', cwd: 'E:\\Git\\repositoris', updatedAt: 30 }),
    session({ sessionId: 'b', title: '排雪宠物无法唤醒', workspaceId: null, cwd: null, updatedAt: 20 }),
    session({ sessionId: 'c', title: '切换ChatGPT界面为中文', workspaceId: 'w2', workspaceTitle: 'DSH-workspace', cwd: 'E:\\DSH-workspace', updatedAt: 10 }),
  ]
  assert.deepEqual(selectArchivedSessions(rows).map((row) => row.sessionId), ['a', 'b', 'c'])
  assert.deepEqual(selectArchivedSessions(rows, { search: 'chatgpt' }).map((row) => row.sessionId), ['c'])
  assert.deepEqual(selectArchivedSessions(rows, { scope: 'project' }).map((row) => row.sessionId), ['a', 'c'])
  assert.deepEqual(selectArchivedSessions(rows, { scope: 'none' }).map((row) => row.sessionId), ['b'])
  assert.deepEqual(selectArchivedSessions(rows, { project: 'w2' }).map((row) => row.sessionId), ['c'])
  assert.deepEqual(selectArchivedSessions(rows, { project: NO_PROJECT_KEY }).map((row) => row.sessionId), ['b'])
  assert.deepEqual(selectArchivedSessions(rows, { project: ALL_PROJECTS_KEY, sort: 'created' }).map((row) => row.sessionId), ['a', 'b', 'c'])
})

test('selectArchivedSessions sorts by title when asked', () => {
  const rows = [
    session({ sessionId: 'a', title: 'beta' }),
    session({ sessionId: 'b', title: 'Alpha' }),
    session({ sessionId: 'c', title: null }),
  ]
  assert.deepEqual(selectArchivedSessions(rows, { sort: 'title' }).map((row) => row.sessionId), ['c', 'b', 'a'])
})

test('groupArchivedSessions puts the no-project group last', () => {
  const rows = [
    session({ sessionId: 'b', workspaceId: null, cwd: null }),
    session({ sessionId: 'a', workspaceId: 'w1', workspaceTitle: 'repositoris' }),
  ]
  const groups = groupArchivedSessions(rows, '无项目')
  assert.deepEqual(groups.map((group) => group.key), ['w1', NO_PROJECT_KEY])
  assert.deepEqual(groups.map((group) => group.title), ['repositoris', '无项目'])
  assert.equal(groups[1].sessions.length, 1)
})

test('projectOptions lists distinct projects plus the no-project choice', () => {
  const rows = [
    session({ sessionId: 'a', workspaceId: 'w2', workspaceTitle: 'Zeta' }),
    session({ sessionId: 'b', workspaceId: 'w1', workspaceTitle: 'Alpha' }),
    session({ sessionId: 'c', workspaceId: null }),
  ]
  assert.deepEqual(projectOptions(rows), [
    { key: 'w1', title: 'Alpha' },
    { key: 'w2', title: 'Zeta' },
    { key: NO_PROJECT_KEY, title: '' },
  ])
})

test('sessionDisplayTitle falls back for a blank or missing title', () => {
  assert.equal(sessionDisplayTitle(session({ title: '  x  ' }), '未命名'), 'x')
  assert.equal(sessionDisplayTitle(session({ title: null }), '未命名'), '未命名')
  assert.equal(sessionDisplayTitle(session({ title: '   ' }), '未命名'), '未命名')
})

test('formatBytes keeps sizes short and readable', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(999), '999 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatBytes(-1), '—')
})

test('isResidue marks rows whose log is gone from disk', () => {
  assert.equal(isResidue(session({ persisted: true, live: false })), false)
  assert.equal(isResidue(session({ persisted: false, live: false })), true)
  // A Session deleted while loaded is residue too: its log is gone.
  assert.equal(isResidue(session({ persisted: false, live: true })), true)
})
