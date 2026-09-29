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
    skipRunningSessions: true   # 只跳过真正在跑的会话
    maxDeleteBatch: 500
```

卸载：`plugin_manager` 的 `remove_bundle`（或 `dsh plugin --profile desktop remove dsh-archive-manager`）。

### 生效范围（重要）

- **新增/替换包**（改 `package.json`、装依赖）需要**重启 DSH 进程**；
- 宿主半 `lib/index.js` 的改动同样只在**下一次启动**时加载——运行中的进程会把已加载的
  ESM 模块缓存住，禁用/启用 bundle 也只会重新挂载 fiber，不会重新 import；
- 客户端半 `client/client.js` 重新构建后，已打开的页面由 `dsh-client-hmr` 的产物轮询热更新。

## 删除语义（重要）

「删除」是**不可恢复的物理删除**。每一步都对应一个真实踩过的坑：

1. **只跳过真正在跑的会话**。判定用 `agents.get(id).status === 'running'` **加上**
   `workspace/session-activity` waterfall（`turn`/`job`/`subagent`/`schedule`，与
   `Workspace.archiveSession` 的准入检查同源）。仅仅"已加载在内存里但空闲"的会话
   **可以删除**——这正是之前被误判成"运行中"而删不掉的那种。
2. **只有确认会话已不在宿主进程中时才释放归档记录**。DSH 正是靠归档集合把会话从工作区
   隐藏起来：以前先 `unarchiveSession` 再删文件，等于当场把行放回侧边栏，这就是"删除后
   又出现在工作区"的直接原因。会话仍驻留内存时，归档记录**保留**为墓碑，工作区继续隐藏它。
3. **删除后广播 `api-session/removed`**。浏览器的会话列表是按连接世代拉取一次的**快照**，
   文件消失不会产生任何帧；`@deepseek-ai/dsh-api-remotes` 会把该事件转发给每个已连接的
   客户端，客户端把该行从列表快照里移除——这是唯一能让"已经打开着的窗口"立刻更新的通道。
4. 删除会话目录 `<DSH_HOME>/sessions/<projectKey(cwd)>/<encoded-id>/`（经
   `sessionPersistence.locate()` 定位，缺失时按 DSH 的目录布局回退计算，最后才扫描兜底）。
5. 删除投影缓存行时**走存储域**（`storageDomain.get('session_projcache').table('sessions').delete(id)`），
   而不是裸 `rm` 文件：裸删只会删掉文件，内存里的行还在，下一次 checkpoint 会把文件写回来；
   存储域未挂载时才回退到直接删文件。
6. SQLite 搜索索引无需处理（本部署把它挂成 `:memory:` + `openAt: 'never'`，且从不喂给侧边栏）。

删除**不会**触碰全局附件对象存储（`~/.dsh/attachments`）：那是内容寻址的共享对象，其他会话可能仍在引用同一份对象。

### 残留记录（墓碑）

删除某个"仍驻留内存"的会话后，归档集合里会留下一条没有内容的记录——它是工作区继续隐藏
该行的依据。页面底部会把它们单列成「已删除的残留记录」：

- 会话仍驻留内存时，按钮禁用并提示**重启 DSH 后再清理**；
- 重启后（会话不再驻留内存），可以点「清理记录」把它从归档集合里摘掉，归档列表彻底干净。

### 配置项（`cordis.patch.yml` 的 `config`）

```yaml
- id: dsh-archive-manager
  name: 'dsh-archive-manager'
  config:
    skipRunningSessions: true   # 默认 true：跳过 turn/job/subagent/schedule 仍在活动的会话
    maxDeleteBatch: 500         # 单次请求最多删除多少个会话
```

（`skipLiveSessions` 是旧键名，仍兼容，但语义已从"跳过已加载"改为"跳过在运行"。）

## 目录结构

```
src/index.ts                     宿主半：HTTP 路由 + 删除/清理编排
src/shared/model.ts              两端共享的纯逻辑（路径编码、筛选、分组、格式化）
src/client/index.ts              客户端半：注册 settings.section、词典、会话列表刷新
src/client/ArchiveManagerSection.tsx  页面本体
src/client/ArchiveManager.module.css  页面样式（全部走 dsw 主题 token）
tests/model.test.mjs             纯逻辑单元测试
tests/delete.test.mjs            真实文件系统上的删除/清理集成测试
tests/render.test.mjs            jsdom 渲染测试
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
| `tests/model.test.mjs` | 路径编码（对齐 DSH 的 `projectKey`/`encodeSegment`）、搜索/范围/项目筛选、分组、排序、格式化、残留判定 |
| `tests/delete.test.mjs` | **真实文件系统**上的删除/清理编排：临时 `DSH_HOME` 造会话目录与投影缓存 → 断言目录与缓存被删、`api-session/removed` 被广播、归档记录在"会话未驻留内存"时被释放而"仍驻留"时保留为墓碑、运行中/有 job 的会话被跳过、经存储域删缓存、`locate()` 缺失时回退目录布局、清理只放行无日志且未驻留的记录 |
| `tests/render.test.mjs` | jsdom 中挂载真实页面组件：分组/行/徽标（运行中 vs 已加载）/字节渲染、残留区与主列表分离、运行中行删除按钮禁用、搜索过滤、取消归档请求、删除确认（未勾选确认前不得发请求）、全部删除只针对有内容的行、挂载时调用会话列表刷新 |

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
- 会话仍在运行（turn/job/subagent/schedule）时删除会被跳过，界面用一条状态提示告知跳过的数量。
- 删除"仍驻留内存"的会话会留下一条墓碑记录（工作区继续隐藏它），重启 DSH 后可在页面底部清理。
- DSH 在本部署的搜索索引是 `:memory:` 且 `openAt: 'never'`，删除后无需维护它；若将来换成持久索引，
  它会在下一次对账时自行丢弃消失的行。
