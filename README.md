# dsh-archive-manager

DeepSeek Harness（DSH）的**已归档会话管理器**：一个类似 Codex「Archived chats」的设置页，用来集中查看、搜索、筛选、取消归档，以及**永久删除**已归档的会话。

Archived-chats manager for DeepSeek Harness — a Codex-style page to search, filter, unarchive and permanently delete archived sessions.

---

## 它解决什么问题

DSH 的归档本身只是一个**注册表级的会话 id 集合**（`workspace` 存储域 v2 的 `archivedSessionIds`）：

- 侧边栏可以用「显示/仅显示已归档」过滤，也能在会话行上取消归档；
- 但**没有任何页面**能集中管理这些会话；
- 更关键的是：DSH 全栈**不存在删除会话的 API**。`dsh-session-persistence` 的 README 写得很明确：*"No deletion or retention API"*；`dsh-session-persistence-jsonl`：*"Nothing deletes session files"*；`dsh-session-projection-cache`：*"No eviction or retention surface"*。全仓库唯一的 `_deleteSession` 只是 SQLite 搜索索引的对账逻辑。

本插件补上这两块：

| 能力 | 实现位置 |
| --- | --- |
| 归档会话的富列表（标题 / 项目 / 时间 / 占用 / 是否在运行） | 宿主 `GET /dsh-archive-manager/archived` |
| 取消归档 | 宿主 `POST /dsh-archive-manager/unarchive` |
| 单个 / 批量 / 全部永久删除 | 宿主 `POST /dsh-archive-manager/delete[-all]` |
| 「已归档的聊天」设置页（搜索 + 范围 + 项目筛选 + 分组 + 操作） | 客户端 `settings.section`（id `archived-sessions`） |

> 设置外壳本来就为 id 为 `archived-sessions` 的 section 预留了归档图标
> （`dsh-client-ui-settings-general` 的 `navIcon()`），本插件正是注册到那个 id 上。

## 安装

```powershell
# 1. 构建
npm install
npm run build

# 2. 装入 profile（写入 profile 的 package.json 与 cordis.patch.yml）
dsh plugin --profile desktop add "E:\Git\repositoris\dsh-archive-manager"
```

安装后打开 **设置 → 已归档的聊天**。本机已按此路径装好（profile 依赖为
`dsh-archive-manager: link:E:/Git/repositoris/dsh-archive-manager`），并在
`~/.dsh/profiles/desktop/cordis.patch.yml` 写入了默认配置：

```yaml
- id: dsh-archive-manager
  name: "dsh-archive-manager"
  config:
    skipLiveSessions: true
    maxDeleteBatch: 500
```

卸载：`plugin_manager` 的 `remove_bundle`（或 `dsh plugin --profile desktop remove dsh-archive-manager`）。

### 生效范围（重要）

- **新增/替换包**（改 `package.json`、装依赖）需要**重启 DSH 进程**；
- 宿主半 `lib/index.js` 的改动同样只在**下一次启动**时加载——运行中的进程会把已加载的
  ESM 模块缓存住，禁用/启用 bundle 也只会重新挂载 fiber，不会重新 import；
- 客户端半 `client/client.js` 重新构建后，已打开的页面由 `dsh-client-hmr` 的产物轮询热更新。

## 删除语义（重要）

「删除」是**不可恢复的物理删除**，按以下顺序执行（顺序有意如此）：

1. 拒绝在运行时删除：会话仍在宿主内存中（`ctx.sessions.get(id)`）时默认跳过，因为正在写入的会话会把文件重新写回来；
2. 从注册表归档集合中移除该 id（`workspaceRegistry.unarchiveSession`）——幂等，且顺带清掉「文件早已不存在」的悬空 id；
3. 从所属 Workspace 的记账中摘除（`Workspace.detachSession`），避免侧边栏留下幽灵行；
4. 删除会话目录 `<DSH_HOME>/sessions/<projectKey(cwd)>/<encoded-id>/`（经 `sessionPersistence.locate()` 定位，缺失时按 DSH 的目录布局回退计算，最后才用扫描兜底）；
5. 删除投影缓存行 `<DSH_HOME>/storages/session_projcache/sessions/<id>.json`；
6. SQLite 搜索索引无需处理：它在下一次对账时自行丢弃消失的行。

删除**不会**触碰全局附件对象存储（`~/.dsh/attachments`）：那是内容寻址的共享对象，其他会话可能仍在引用同一份对象。

### 配置项（`cordis.patch.yml` 的 `config`）

```yaml
- id: dsh-archive-manager
  name: 'dsh-archive-manager'
  config:
    skipLiveSessions: true   # 默认 true：跳过仍在运行的会话
    maxDeleteBatch: 500      # 单次请求最多删除多少个会话
```

## 目录结构

```
src/index.ts                     宿主半：HTTP 路由 + 删除编排
src/shared/model.ts              两端共享的纯逻辑（路径编码、筛选、分组、格式化）
src/client/index.ts              客户端半：注册 settings.section 与词典
src/client/ArchiveManagerSection.tsx  页面本体
src/client/ArchiveManager.module.css  页面样式（全部走 dsw 主题 token）
tests/model.test.mjs             纯逻辑单元测试
```

宿主半**不 import 任何 `@deepseek-ai/*` 运行时包**：第三方插件的依赖由 profile 解析，
而 DSH 自身包由应用提供。宿主只用 Node 内建模块与 cordis 上下文，因此不存在解析失败风险。

## 开发

```powershell
npm run typecheck   # 宿主 + 客户端两个 TS 工程
npm run build       # tsc -> lib/ ；tsdown -> client/client.js
npm test            # 纯逻辑 + 宿主删除集成测试（先构建宿主半）
npm run test:render # jsdom 渲染测试（先打包测试壳）
npm run test:all    # 全部
```

三类测试各自的职责：

| 套件 | 覆盖 |
| --- | --- |
| `tests/model.test.mjs` | 路径编码（对齐 DSH 的 `projectKey`/`encodeSegment`）、搜索/范围/项目筛选、分组、排序、格式化 |
| `tests/delete.test.mjs` | **真实文件系统**上的删除编排：临时 `DSH_HOME` 造会话目录与投影缓存 → 断言目录/缓存被删、归档集合被清理、Workspace 记账被摘除；运行中会话被跳过；悬空 id 只清理集合；`locate()` 缺失时回退到目录布局 |
| `tests/render.test.mjs` | jsdom 中挂载真实页面组件：分组/行/徽标/字节渲染、搜索过滤、取消归档请求、删除确认（未勾选确认前不得发请求）、全部删除的 id 集合 |

渲染测试把 `@deepseek-ai/dsh-client-ui-primitives` 别名到 `tests/render/primitives-stub.tsx`：
真实 primitives 只能在浏览器的加载器模块表里运行（它的 ESM 入口 import 十几个 CSS 模块和
markdown/高亮依赖）。桩件同名同 props、同无障碍结构，因此测的是页面自身的行为
（状态机、宿主调用、菜单、确认门控）。真实组件的 props 契约由 `npm run typecheck` 对着
npm 上 `0.2.0-rc.2` 的 `.d.ts` 校验。

客户端产物必须是经典脚本，且以

```js
window.__ModuleLoader__.load({ id: "dsh-archive-manager", factory: (require) => {
```

开头（`scripts/normalize-client-banner.mjs` 负责把 rolldown 折行后的 banner 折回一行）；
`require` 只能解析加载器模块表里的种子（`react`、`react/jsx-runtime`、
`@deepseek-ai/dsh-client-ui-primitives`），其余一律内联。

## 已知边界

- 归档集合本身不保存归档时间，因此列表按「最近活动时间」排序（取标题事件时间、日志文件 mtime、创建时间的最大值）。
- 没有「恢复已删除会话」的逆向操作：DSH 的删除是文件系统级的。
- 运行中的会话会被跳过，界面会用一条状态提示告知跳过的数量。
