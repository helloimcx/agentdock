# 会话存储/事件日志数据层对比：DSH vs AgentDock

> 结论基于两套代码库的实际源码与文档。DSH 取 `deepseek-harness-master`，AgentDock 取本仓库 head。

---

## 一、DSH 会话数据层亮点

DSH 把"会话"定义为一个 **append-only 的事件日志**（append-only `SessionEvent` log），是智能体全部交互历史的**唯一事实源**；模型历史、UI、续聊、回放、血缘全部由它派生。核心概念见 `packages/core/session/src/types.ts` 与 `docs/subsystems/session.md`。

| 机制 | 说明 | 路径引用 |
|---|---|---|
| **append-only 事件日志** | 一束强类型化 `SessionEventMap` 合并扩展事件：`turn/start`、`assistant/chunk`（保留 token 级回放保真）、`user/message`、`assistant/message`、`tool/call`、`tool/result`、`todo/write`、`request/header` 等。`seq = log.length` 保证连续。 | `docs/subsystems/session.md:9-125` |
| **"模型可见即已记录"** | 凡是进入模型请求的内容必须能从日志重建；运行时不变式断言。新增模型可见输入=新增事件，从日志渲染。 | `docs/architecture.md:92-96` |
| **派生历史 `deriveMessages()`** | ML 历史**不是单独存储**，而是由日志经 `SurfaceOp`/`surfaceOp` 折叠派生，缓存+冻结（每 surface 节点只投影一次）。 | `docs/subsystems/session.md:521-530` |
| **持久化 seam（抽象+JSONL/SQLite 双后端）** | `SessionPersistence` 抽象服务；`session-persistence-jsonl`（每会话一条 JSONL，Zstd 分帧/校验和，崩溃安全原子写）；`session-persistence-sqlite`（每事件一行，列与事件 1:1）。崩溃修复补齐孤儿 turn（合成 `interrupted`），不截断。 | `docs/subsystems/persistence.md:231-236`, `9-19` |
| **投影 seam + 日志驱动标题** | `session-projection*`、`session-title`；标题由日志折叠得出（`readTitle` 绑同一 event 观察）。 | `docs/subsystems/session-query.md:54-64` |
| **fork/resume/replay / end-seed 边界** | `ctx.sessions.fork(source, boundary?, childId)`，`boundary` 落在 turn 之间；`session/end-seed` 标记日志中种子与活工作分界，使回放/续聊/子会话可区分血缘。 | `docs/subsystems/session.md:532-538, 583-590` |
| **逻辑语料库/有界读取/血缘/事件关系** | `ctx.sessionQuery`：逻辑会话语料（live 优先）+ `filterSessions/filterEvents`、bounded event 窗口读出、`traceSession`（祖先/后代树）、`traceEvent`（source/replaced/direct links）。 | `docs/subsystems/session-query.md:259-331` |
| **全文检索（SQLite FTS）** | `session-query-sqlite` 实现 `searchSessions/searchEvents`，语义文本索引、光标分页、摘要 excerpt；查询按数据处理不看作可执行语法。 | `docs/subsystems/session-query.md:145-217` |
| **压缩 seam（compaction）** | `ctx.compaction` 抽象 + `compaction-basic` 后端 + `command-compact` 命令 + `compaction-tool-result-pruner`；通过 `compaction/start-summary-end` 三事件实现 crash 可检测的锁；压缩摘要以 `user/message + surfaceOp: replace` 遮蔽旧节点，`sourceEventSeqs` 记录被遮蔽 seq 保证可追溯。 | `docs/subsystems/compaction.md:9-118` |
| **附件/spill** | `attachment`（内容寻址附件存储，`attachment`/`attachment-local`）；`spill`（溢出机制，`spill`/`spill-local`/`spill-policy`）。 | `packages/attachment/`, `packages/spill/` |
| **事件编目** | `docs/persistence-catalog.md` 由脚本生成，逐事件枚举 payload/surface 徽标/声明点。 | `docs/persistence-catalog.md:1-47` |

要点：DSH 的一切（消息、标题、传输 header、todo）都是**可回放的事件派生**，UI 通过单一 `session/event` 消防通道订阅，读端有统一 query seam。

---

## 二、AgentDock 现状与差距

AgentDock 的数据层是**"SQLite 整条消息 + ACP 本地续聊 + 桥接事件流"**，与 DSH 的事件日志范式有本质差异。

### 现状（已实现）

**服务端持久化**（统一 `local-core.db`，WAL + busy_timeout，`schema.ts:11-14`；路由存于 `runtime/local-core.db`）：

| 表/机制 | 说明 | 路径 |
|---|---|---|
| `threads` | 线程元数据：`id, workspace_id, session_id, title, history_count, excerpt, acp_session_id, acp_supports_load, agent_mode` | `acp/store/schema.ts:19-33` |
| `messages` | **整条消息**：`id, thread_id, role, content, tool_call_json, bridge_kind, bridge_status, timestamp, kind('final'\|'progress'\|'system'), seq`，索引 `(thread_id,seq)` | `schema.ts:35-48` |
| `runs`/`run_spans` | run 状态机 + 可观测 span（preview 截断 200/500 字符，非可回放日志） | `schema.ts:49-73`, `trace-store.ts` |
| 写入路径 | 用户消息 append `kind='final'`；运行期 assistant/thought/tool/plan 以 `kind='progress'` 整段写库（thought 原地 upsert）；run 完成再写一条独立 `kind='final'` 整条 | `acp/local-core-acp-backend.ts:203,461`、`turn-coordinator.ts` |

- **续聊/resume —— 已实现（ACP 原生）**：`thread-store.updateSession` 存 `acp_session_id + acp_supports_load`（`thread-store.ts:271`）；`session-coordinator.ts:110-124` 命中时向 agent 发 `session/load` 回放，`loadReplayMode` 期间丢弃 agent 回放通知避免重复写库（`turn-coordinator.ts:277-279`）。**注意**：历史由 **agent 自己**按 sessionId 加载，`messages` 表只是给 UI/bridge 的权威历史，不用于向 agent 重放。

**前端渲染**（`src/pages/Threads/`）：

- 桥接事件是**消息级**：`preview_start`→`update_message`（流式更新 preview）→`reply` 定稿；内部 progress（thought/plan/tool/status/permission）走 `bridgeKind`（`thread-chat-model.ts:120-163`, `useThreadChatBridgeEvents.ts:176-225`）。`ChatMessage.preview/previewHandle` 表示进行中消息。
- 历史加载：`get(threadId)` 按 `seq` 拉全量 messages，`toMessagesFromThread()` 映射成 `ChatMessage[]`（`thread-chat-model.ts:234-251`）。
- 会话检索：前端仅对 `name/excerpt/bridgeSessionKey` 做 `includes` 子串匹配（`thread-chat-model.ts:277-283`）；服务端 `/search` 命令同样只匹配 title/id/excerpt（`session-command-service.ts` search）。
- `shared/desktop.ts` 桥接类型：`DesktopBridgeEventKind`（assistant/thought/plan/tool/status/permission）+ `DesktopBridgeEvent`（reply/update_message/delete_message/…，`desktop.ts:317-353`）。**无会话事件日志概念**。

### 差距

| 能力 | AgentDock 现状 |
|---|---|
| 事件日志 / chunk 级存储 | **无**。不存在 append-only `SessionEvent` 日志；只有整条 messages。运行期只写 progress 段落快照，非 per-token/event |
| 派生历史 / 日志驱动 UI | **无**。UI 直接渲染持久化的整条消息，非从事件派生 |
| fork / 分支 | **无**。服务端与前端均无 fork/分支命令 |
| 上下文压缩(compaction) | **无**。`run_spans` preview 截断只是观测；`compactToolInput`（`turn-coordinator.ts:576`）仅压工具入参，与上下文压缩无关 |
| 全文检索（消息） | **无**。无 FTS 表；仅 title/excerpt/子串扫描 |
| 语义检索 | `knowledge-api` 是**知识库 RAG**（`knowledge.db`：folders/kbs/files/thread_knowledge_bases），非会话消息语义检索。`ai-vector-provider.ts` 只服务知识库 |
| 血缘/回放 | 无 traceSession/traceEvent；`run_spans` 是观测 span 非回放 |
| 续聊 | **有**（靠 ACP `session/load`），但依赖 agent 原生支持，服务端不自建可回放日志 |

---

## 三、可借鉴/可落地的改进建议

> 优先级按价值/成本。所有改动限于 AgentDock 现有边界，逐步演进，不必照搬 DSH 全文。

### P0（高价值、低成本、风险低）

| 建议 | 具体做法 | 改动范围 | 工作量 | 风险 |
|---|---|---|---|---|
| 给 `messages` 加 SQLite FTS 全文检索 | 建 `messages_fts` 虚拟表（或普通表 + LIKE），`kind='final'` 落库时同步索引；`getThread` 或新端点返回命中消息。复用 `threads` 检索路径，在 `/search` 与前端侧栏加"搜消息内容" | `schema.ts` + `thread-store.ts` + `core-sdk/threads.ts` + 前端 | S | 低：纯增量 |
| 落库前做消息归一化层 | 把"progress 整段写库"收敛到一个 `MessageStore` 接口（append/upsert/get by seq），为将来事件日志铺路；消除 `turn-coordinator` 直接碰表 | 抽取 `thread-store` 之上薄封装 | S | 低 |

### P1（中价值、中成本）

| 建议 | 具体做法 | 改动范围 | 工作量 | 风险 |
|---|---|---|---|---|
| 引入**轻量 append-only 事件日志**（chunk 级） | 仿 DSH：新增 `session_events` 表（`thread_id, seq, type, data_json, time`，`(thread_id,seq)` 唯一连续）+ 一个 `append()` seam；turn-coordinator 在 `assistant/chunk`、`tool/call`、`tool/result`、`user/message` 处 append。`messages` 表可保留为整条投影，但**派生**自事件（`toMessagesFromThread` 改为折叠） | `schema.ts` 新表 + `acp/` turn-coordinator + 新 store + 前端映射 | M | 中：写入路径经 turn-coordinator 多处改动，需迁移既有 `messages` |
| 补齐服务端**续聊漏斗**（对 ACP `supportsLoad=false` 的 agent） | 当 agent 不支持 `load` 时，用事件/messages 回放构造 agent 可读历史（如 DSH 的 `deriveMessages` 等价物），使 opencode 等也可靠 resume；不再只依赖 agent 原生 | `session-coordinator` + turn-coordinator 回放分支 | M | 中 |
| **fork/分支**（基于事件日志） | 借鉴 `ctx.sessions.fork(source, boundary)`：新端点复制某 thread 到 `boundary` seq 的子线程（`parent_thread_id/seed_seq`），前端"从此处分叉/继续"按钮 | `thread-store` + ACP 会话拉起 + 前端 | M | 中 |

### P2（高价值、高成本）

| 建议 | 具体做法 | 改动范围 | 工作量 | 风险 |
|---|---|---|---|---|
| 上下文**压缩(compaction)** | 仿 `compaction-basic`：给事件日志加"summary 替换"操作（被遮罩 seq 记录于 `replaced_by/source_event_seqs`），`pre-step` 按 token 阈值触发，摘要以 `user/message` + replace 语义入日志。需先有 P1 事件日志 | `compaction` 模块 + 触发策略 + UI 卡片 | L | 高 |
| 血缘/回放/语义检索 | 加 `traceSession`（parent/descendant）、`traceEvent`（source/replaced links）、事件级语义检索（向量或 FTS）。可复用 `knowledge` 已有向量 provider 基建到消息文本 | session-query 式新包 + 前端 | L | 高 |

### 落地次序建议

1. P0 先做 **FTS 检索**（最大的 UX 短期增量，风险最低）。
2. 在 `local-core-acp-turn-coordinator` 每次写入处先归一化再 P1 的**事件日志**——这是 fork/compaction/血缘的地基，也是与 DSH 拉开数据层差距的分水岭。
3. 事件日志稳定后，P1 补充续聊漏斗 + fork；P2 再上压缩与血缘。

> 边界提醒：`messages` 表现有数据需一次性投影进事件日志才能无缝切换；resume 仍需保留 ACP sessionId 路径做兼容。
