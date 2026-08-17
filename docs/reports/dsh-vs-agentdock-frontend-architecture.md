# DSH × AgentDock 前端 Web UI 架构对比报告

DSH = `/tmp/dsh-src/deepseek-harness-master`；AD = `/Users/momo/code/agentdock`。所有结论均已核实具体路径与符号。

## 一、DSH 前端亮点

**启动分层**：`apps/web/src/main.ts` 仅 6 行薄壳 `new AppWebEntry(el).run()`，UI 全在 `packages/client/*` 插件包；浏览器端是独立 cordis 插件树，settle 后一次性翻转进真 UI（`packages/client/ui-conversation/README.md`、`.agents/notes/.../2026-07-19-gui-web-client-architecture.md`）。

**事件驱动 + React 纯投影（核心）**：对象层 `runtime/src/client/sessions/` 完全 React-free。链路：`mux/host 帧→SessionManager→Session(seq去重,连续事件窗)→ConversationNodeAssembler→Notifier微任务合批→ConversationSnapshot(uSES)→组件`。**引用纪律**是性能前提：未变子结构保持引用，一次业务更新只换对应 key，token 流每帧至多物化一次，无关行不重渲染。

**对象 services 增量同步**：`runtime` 的 `ProjectionValueStore` 从历史 tail `projections` 恢复，`session/projection` 帧 higher-seq-wins 更新；workspace/会话列表用 upsert/removal/order 帧在 `pending→ready` baseline 上重放，断线重连以新 baseline 纠正。连接层（`packages/client/connection/`）：unary 用 HTTP POST，下行每逻辑流一个 WebSocket（`/api/events.mux`、`/api/events.host`），带 `/api` loopback/Host 头信任围栏。

**聊天日志投影 + keyed renderer**：`ConversationNodeAssembler` 把每个登录业务事件的注册 `Definition` 映射为稳定 `{kind,id}`，start 建 State、关联更新折叠、只物化脏 Context；keyed 渲染器注册到 `'conversation.chat.node'` 槽按 key 分发——**Chat 业务行是开放 registry 贡献，非内置关集**。ui-tool 递归渲染 `subCalls` 并声明 `'tool.call.toolview'` 子槽，`GenericToolCard` 兜底。

**插件化 UI 与 slots**：`ui-slots/README.md` 一次 `register({name,children?,store?,inject?,…},Component)` 同时占槽/声明子槽/声明 store/注入业务面，props 由四类 share 派生；壳只渲染 `'root'`。模块系统懒加载 CJS 表（`window.__ModuleLoader__.load`），boot 图来自 Host `__DSH_BOOT__`。

**i18n 工作流**：`README.i18n.yaml`/`CONTRIBUTING.i18n.yaml` 记双语文档 blob hash，`pnpm verify-translation-pairing --write` 自动校验中英一致。

**设计系统**：`docs/web-styling.md` 规定主题属 `ui-theme`（`--dsw-*` 语义 token），`ui-layout` 应用；特性组件**用 CSS Modules+clsx、明确禁用 Tailwind**，只消费 `--dsw-alias-*`。

**测试保真**：`apps/web/tests/` 大量 e2e（`chat-continuous-conversation.e2e.ts`、`seeded-history.e2e.ts`）+ `stress-tests/reasoning-chunks.stress.ts` + `complex-history.perf.ts`。`packages/web/` 把 search/fetch 经 `tool-web` 暴露给 model。

## 二、AgentDock 现状与差距

**数据流：SSE + 请求响应，非轮询。** `packages/core-sdk/src/client.ts` 用 EventSource 连 `${baseUrl}/events`（`127.0.0.1:9831/api/local/v1/events`），事件名在 `LOCAL_CORE_EVENT_NAMES`；连接按 baseUrl 共享、断线 1000ms 重连。**几乎无定时轮询**（仅 Lark/企微 QR 状态轮询，`workspace-hooks.ts`）。注意：本快照**无 `src/api/` 与 `src/store/auth.ts`**（CLAUDE.md 已过期），API 在 `@cc/core-sdk/*`，store 仅 `theme.ts`；路由**只有 HashRouter**（`src/main.tsx`）。

**聊天：内存状态驱动（非日志投影）。** ThreadChat（`ThreadChat.tsx`→`useThreadChatController`）消息存 useState、task 用 useReducer。历史 `useThreadChatSessionBrowser.ts getThread()` **全量拉取** `ThreadDetail.messages`；流式 `useThreadChatBridgeEvents.ts` 经 `onBridgeUpdated`（SSE `stream.updated`/`message.*` 提取 `DesktopBridgeEvent`）处理 `preview_start/update_message/reply`，`upsertStreamingPreview*` **原地改 preview 消息**。去重靠 `src/components/chat/chat-event-gate.ts` `createChatEventGate`（run 作用域 + 指纹去重 256 条 + settled-turn 过滤，全内存无持久序）。

**Desktop/Workspace：请求-响应，无推送。** `Workspace.tsx` 一次性 `readRuntimeConfig()+listModelProviders()`，useState 持 draft。订阅只在 `src/app/runtime.ts useRuntimeCapabilityStore`（`onRuntimeUpdated` 刷能力快照控制路由显隐）。

**Electron 确无 IPC**：`preload.ts` 仅 `export {}`；`main.ts` spawn 本地 core 并 HTTP 健康检查后加载 renderer。renderer 直连 HTTP/SSE，CORS 后端放行 loopback/localhost/null。

**扩展点：半静态 registry。** `src/app/ui-contributions.tsx` 的 `RendererUiContributionRegistry` 模块加载即注册全部内置 route/nav，有 `registerRoute/registerNavItem` API 但**无开放动态入口**，显隐仅靠 `RuntimeFeatureSupport`+`guarded()`。`src/components/ui/` 为 Radix 同质封装。

**i18n**：`src/i18n/index.ts` lazy import 5 个扁平 JSON（`locales/*.json`），存 `localStorage.cc_lang`。

### 差距表

| 维度 | DSH | AD | 差距 |
|---|---|---|---|
| 事件输运 | WS 双流+seq 去重复放 | SSE+桥接门指纹去重 | 同向，AD 无持久游标 |
| 渲染驱动 | 日志→Node装配→uSES快照 | useState 原地改 preview | **大**：不可变快照/引用纪律缺失 |
| 状态归属 | React-free 对象层 | 页面 hook+局部 state | 大：切会话即重拉 |
| 增量同步 | projection+列表重放 | 历史全量 getThread | 中：无分页 |
| 扩展点 | cordis 插件树+slots | 静态 registry | 大：无动态入口 |
| 样式 | CSS Modules+语义 token | Tailwind | 中 |
| i18n | yaml 工作流+hash 校验 | 手写 JSON | 中 |
| 测试 | e2e/stress/perf | 仅 permission.test | 大 |

## 三、落地方案（按优先级）

### P0
- **P0-1 会话级不可变快照+增量分页**：`getThread` 改 tail 窗口+向上分页，消息库存为 keyed 不可变快照，SSE 按 id upsert 替代 preview 原地替换。改 `src/pages/Threads/*`、`packages/core-sdk/threads.ts`。**L**/风险中，先做分页小步。
- **P0-2 事件游标+幂等上收**：`chat-event-gate` 加 seq 游标（只收 >seq），`run.updated` 等 last-wins，下沉到 `core-sdk` 复用。改 `chat-event-gate.ts`+`client.ts`。**M**/风险低。

### P1
- **P1-1 打开动态注册面 + 聊天 keyed 渲染槽**：registry 改显式 export API，给消息区引入 `chat.node.<kind>` 槽（对齐 DSH `'conversation.chat.node'`），让 tool/状态卡可插拔。改 `ui-contributions.tsx`+`ThreadChatMessage.tsx`。**M**/风险低，性价比最高。
- **P1-2 样式语义 token 层**：`index.css` 定 `:root` 语义 token，组件消费之（不必弃 Tailwind)。**S–M**/低。
- **P1-3 i18n 加键集校验+分区**：脚本校验 5 JSON 键一致，`nav.*`/`threads.*` 分区。**S**/低。
- **P1-4 补流式/历史 UI 测试**：仿 DSH 建 reasoning-chunks 类 stress 与分页 seeded 场景，复用现有 test runner 纯函数模式。**M**/低。

### P2
- **P2-1 实时指标投影**：仿 DSH `tokenUsage/sessionStats`，为 ThreadChat 尾补 token/TTFT/上下文占用。**M**/中，依赖 P0 事件模型。
- **P2-2 会话常驻吃帧**：对齐 DSH 会话常驻、断线冻结只读，避免重拉跳变。**L**/中。
- **P2-3 补齐双路由（BrowserRouter/Web）**：本快照缺失。**S–M**/低。

## 结论
AD 已走对方向（SSE 事件驱动、无 IPC、core-sdk 共享包、半静态 registry、5 语言）。**根本差距在认知**：DSH 把事件当**持久日志投影出不可变快照**，AD 把事件当**即时通知写入内存可变状态**。优先落地 P0（不可变快照+增量分页+事件游标）与 P1-1（动态 keyed 槽）即可获得最大收益；P2 属锦上添花。
