/**
 * jsdom render test for the archived-chats page. It mounts the real component
 * against the real `@deepseek-ai/dsh-client-ui-primitives` build, with the Host
 * route stubbed, and drives the unarchive and delete flows end to end.
 *
 * Run through `npm run test:render`, which bundles the harness first.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

/** One row as the stubbed Host route returns it. */
function row(overrides) {
  return {
    sessionId: 'session-x',
    title: 'T',
    cwd: null,
    workspaceId: null,
    workspaceTitle: null,
    createdAt: 1785778490000,
    updatedAt: 1785778490000,
    bytes: null,
    parentSessionId: null,
    persisted: true,
    live: false,
    running: false,
    activity: [],
    ...overrides,
  }
}

/** Rows the stubbed Host route returns. */
const ARCHIVED = [
  row({
    sessionId: 'session-a',
    title: '删除用户安装的Leinator市场',
    cwd: 'E:\\Git\\repositoris',
    workspaceId: 'w1',
    workspaceTitle: 'repositoris',
    bytes: 2048,
  }),
  row({
    sessionId: 'session-b',
    title: null,
    createdAt: 1785686490000,
    updatedAt: 1785686490000,
  }),
  row({
    sessionId: 'session-c',
    title: '切换ChatGPT界面为中文',
    cwd: 'E:\\DSH-workspace',
    workspaceId: 'w2',
    workspaceTitle: 'DSH-workspace',
    createdAt: 1785590490000,
    updatedAt: 1785590490000,
    live: true,
    bytes: 4096,
  }),
  row({
    sessionId: 'session-d',
    title: '已经删掉的会话',
    cwd: 'E:\\Git\\repositoris',
    createdAt: 1785504090000,
    updatedAt: 1785504090000,
    persisted: false,
  }),
  row({
    sessionId: 'session-e',
    title: '正在跑任务的会话',
    cwd: 'E:\\Git\\repositoris',
    workspaceId: 'w3',
    workspaceTitle: 'repositoris',
    createdAt: 1785417690000,
    updatedAt: 1785417690000,
    running: true,
    activity: ['turn'],
    bytes: 512,
  }),
]

/** Sessions the page treats as content (log on disk). */
const CONTENT_IDS = ['session-a', 'session-b', 'session-c', 'session-e']

/** Install a minimal DOM before anything imports react-dom. */
function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:19387/',
    pretendToBeVisual: true,
  })
  const globals = [
    'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event',
    'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame',
    'cancelAnimationFrame', 'MutationObserver', 'DocumentFragment', 'SVGElement', 'ResizeObserver',
  ]
  for (const key of globals) {
    if (dom.window[key] === undefined) continue
    // Node 22 exposes some of these (navigator) as getter-only globals.
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return dom
}

/** Stub `fetch` against a path table and record every call. */
function stubFetch(routes) {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '')
    calls.push({ path, method: init.method ?? 'GET', body: init.body })
    const handler = routes[path]
    const payload = handler === undefined ? { ok: false, error: `no stub for ${path}` } : handler(init)
    return new Response(JSON.stringify(payload), {
      status: handler === undefined ? 404 : 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return calls
}

/** Click an element the way React's synthetic events expect. */
function click(window, element) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** Find one button by its visible text. */
function buttonByText(text) {
  return [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes(text))
}

test('the archived-chats page renders groups, rows and filters', async () => {
  setupDom()
  const calls = stubFetch({
    '/dsh-archive-manager/archived': (init) => ({ ok: true, sessions: ARCHIVED, total: ARCHIVED.length }),
  })
  const harness = await import('./.build/entry.mjs')
  const t = (key) => harness.zh[key] ?? key
  const container = document.getElementById('root')
  const root = harness.createRoot(container)
  let refreshed = 0
  await harness.act(async () => {
    root.render(harness.React.createElement(harness.ArchiveManagerSection, { t, sessionRefresh: () => { refreshed += 1 } }))
  })

  assert.equal(calls[0].path, '/dsh-archive-manager/archived')
  // Opening the page re-lists the workspace baseline once, which is how rows
  // whose logs vanished before removals were announced get reconciled.
  assert.equal(refreshed, 1)
  const text = container.textContent
  assert.match(text, /已归档的聊天/)
  assert.match(text, /全部删除/)
  // The search box is identified by its placeholder, not by rendered text.
  assert.equal(container.querySelector('input[type="search"]').placeholder, '搜索已归档的聊天')
  // Both project groups plus the trailing "no project" group.
  assert.match(text, /repositoris/)
  assert.match(text, /DSH-workspace/)
  assert.match(text, /无项目/)
  // Rows: one named title and the untitled fallback.
  assert.match(text, /删除用户安装的Leinator市场/)
  assert.match(text, /未命名会话/)
  // A running turn and a merely loaded Session read differently.
  assert.match(text, /正在跑任务的会话/)
  assert.match(text, /运行中/)
  assert.match(text, /已加载/)
  // Group heading counts.
  assert.match(text, /1 个聊天/)
  // Byte footprint is rendered for measurable sessions.
  assert.match(text, /2\.0 KB/)

  // A Session whose log is gone is NOT a normal row any more: it moves to the
  // residue section, where its archive record can be released.
  assert.match(text, /已删除的残留记录/)
  assert.match(text, /已经删掉的会话/)
  assert.doesNotMatch(text, /已经删掉的会话[\s\S]*取消归档/)

  // The running Session's delete control is disabled; the idle one's is not.
  const runningRow = [...container.querySelectorAll('li')].find((li) => (li.textContent ?? '').includes('正在跑任务的会话'))
  assert.ok(runningRow, 'expected the running row')
  assert.equal(runningRow.querySelector('button[aria-label^="删除 "]').disabled, true)
  const idleRow = [...container.querySelectorAll('li')].find((li) => (li.textContent ?? '').includes('删除用户安装的Leinator市场'))
  assert.equal(idleRow.querySelector('button[aria-label^="删除 "]').disabled, false)

  // The search box narrows the list without another Host round-trip.
  const input = container.querySelector('input[type="search"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await harness.act(async () => {
    setter.call(input, 'chatgpt')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  assert.doesNotMatch(container.textContent, /删除用户安装的Leinator市场/)
  assert.match(container.textContent, /切换ChatGPT界面为中文/)

  await harness.act(async () => { root.unmount() })
})

test('unarchive and permanent delete call the Host routes', async () => {
  setupDom()
  const calls = stubFetch({
    '/dsh-archive-manager/archived': () => ({ ok: true, sessions: ARCHIVED, total: ARCHIVED.length }),
    '/dsh-archive-manager/unarchive': () => ({ ok: true, restored: ['session-a'] }),
    '/dsh-archive-manager/delete': () => ({
      ok: true,
      outcomes: [{ sessionId: 'session-a', status: 'deleted' }],
      deleted: 1,
      remaining: 2,
    }),
  })
  const harness = await import('./.build/entry.mjs')
  const t = (key) => harness.zh[key] ?? key
  const container = document.getElementById('root')
  const root = harness.createRoot(container)
  await harness.act(async () => {
    root.render(harness.React.createElement(harness.ArchiveManagerSection, { t }))
  })

  // Unarchive the first row.
  const unarchive = [...container.querySelectorAll('button')].find((button) => (button.textContent ?? '') === '取消归档')
  assert.ok(unarchive, 'expected an unarchive button')
  await harness.act(async () => {
    click(window, unarchive)
  })
  const unarchiveCall = calls.find((call) => call.path === '/dsh-archive-manager/unarchive')
  assert.ok(unarchiveCall, 'expected an unarchive request')
  assert.deepEqual(JSON.parse(unarchiveCall.body), { sessionIds: ['session-a'] })

  // Delete the first row: the confirmation dialog gates the request until the
  // acknowledgement checkbox is ticked.
  const trash = container.querySelector('button[aria-label^="删除 "]')
  assert.ok(trash, 'expected a per-row delete button')
  await harness.act(async () => {
    click(window, trash)
  })
  assert.match(document.body.textContent, /删除 1 个已归档会话？/)
  assert.equal(calls.some((call) => call.path === '/dsh-archive-manager/delete'), false, 'delete must wait for confirmation')

  const checkbox = document.body.querySelector('input[type="checkbox"]')
  assert.ok(checkbox, 'expected the acknowledgement checkbox')
  // React maps a checkbox's onChange to the native click event.
  await harness.act(async () => {
    click(window, checkbox)
  })
  await harness.act(async () => {
    const confirm = buttonByText('永久删除')
    assert.ok(confirm, 'expected the confirm button')
    click(window, confirm)
  })
  const deleteCall = calls.find((call) => call.path === '/dsh-archive-manager/delete')
  assert.ok(deleteCall, 'expected a delete request after confirmation')
  assert.deepEqual(JSON.parse(deleteCall.body), { sessionIds: ['session-a'] })

  await harness.act(async () => { root.unmount() })
})

test('the live variant reads the archive set through the injected selector hook', async () => {
  setupDom()
  const calls = stubFetch({
    '/dsh-archive-manager/archived': () => ({ ok: true, sessions: ARCHIVED, total: ARCHIVED.length }),
  })
  const harness = await import('./.build/entry.mjs')
  const t = (key) => harness.zh[key] ?? key
  // The settings shell passes exactly this shape: a selector hook over the
  // workspace snapshot. It is called unconditionally inside its own component.
  const selections = []
  const useWorkspaces = (selector) => {
    selections.push(selector({ archivedSessionIds: ['session-a', 'session-b'] }))
    return selector({ archivedSessionIds: ['session-a', 'session-b'] })
  }
  const container = document.getElementById('root')
  const root = harness.createRoot(container)
  await harness.act(async () => {
    root.render(harness.React.createElement(harness.ArchiveManagerSection, { t, useWorkspaces }))
  })

  assert.ok(selections.length > 0, 'the selector must be read')
  assert.equal(selections[0], 'session-a|session-b')
  assert.match(container.textContent, /删除用户安装的Leinator市场/)
  assert.equal(calls.filter((call) => call.path === '/dsh-archive-manager/archived').length >= 1, true)

  await harness.act(async () => { root.unmount() })
})

test('delete-all targets every archived session', async () => {
  setupDom()
  const calls = stubFetch({
    '/dsh-archive-manager/archived': () => ({ ok: true, sessions: ARCHIVED, total: ARCHIVED.length }),
    '/dsh-archive-manager/delete': () => ({
      ok: true,
      outcomes: ARCHIVED.map((row) => ({ sessionId: row.sessionId, status: 'deleted' })),
      deleted: ARCHIVED.length,
      remaining: 0,
    }),
  })
  const harness = await import('./.build/entry.mjs')
  const t = (key) => harness.zh[key] ?? key
  const container = document.getElementById('root')
  const root = harness.createRoot(container)
  await harness.act(async () => {
    root.render(harness.React.createElement(harness.ArchiveManagerSection, { t }))
  })

  const deleteAll = buttonByText('全部删除')
  assert.ok(deleteAll, 'expected the delete-all button')
  await harness.act(async () => {
    click(window, deleteAll)
  })
  assert.match(document.body.textContent, /删除全部 4 个已归档会话？/)
  const checkbox = document.body.querySelector('input[type="checkbox"]')
  assert.ok(checkbox, 'expected the acknowledgement checkbox')
  await harness.act(async () => {
    click(window, checkbox)
  })
  await harness.act(async () => {
    click(window, buttonByText('永久删除'))
  })
  const deleteCall = calls.find((call) => call.path === '/dsh-archive-manager/delete')
  assert.ok(deleteCall, 'expected a delete-all request after confirmation')
  // Delete-all targets every Session that still has content, in Host order —
  // residue rows are not deletions, they are record releases.
  assert.deepEqual(JSON.parse(deleteCall.body), { sessionIds: CONTENT_IDS })
  await harness.act(async () => { root.unmount() })
})
