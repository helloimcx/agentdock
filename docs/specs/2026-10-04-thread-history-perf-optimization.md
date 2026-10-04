# Spec: 历史消息详情页面加载性能全链路优化

## 1. 目标（Goal）

彻底解决 AgentDock 历史消息详情页面在远程/Web 访问（如 Tailscale/公网环境）及桌面端下加载缓慢、首屏白屏时间长、切换会话卡顿的问题：
1. **消除前端请求瀑布流**：进入带会话 URL 或切换会话时，毫秒级直接并行请求目标会话详情，不被系统全量工作区和会话遍历阻塞；
2. **削减网络传输体积与开销**：后端提供 HTTP Gzip 压缩传输，会话详情支持窗口化分页查询（默认拉取最新窗口消息，向上滚动按需加载历史），防范超大工具日志撑爆请求；
3. **消除前端主线程渲染长任务**：避免上百条历史消息同时进入 DOM 并同步执行复杂 Markdown 解析与代码语法高亮，引入视口懒渲染与懒高亮机制；
4. **会话秒开切换体验**：建立前端轻量 SWR 内存缓存，在左侧切换历史会话时实现 0 白屏秒开。

---

## 2. 范围（Scope）

1. **前端请求编排重构（消除 Waterfall）**：
   - 重构 `src/pages/Threads/useThreadChatSessionBrowser.ts`：在解析到 URL 或用户选择的目标 `workspaceId` + `threadId` 后，立即并行触发 `getThread(threadId)`；
   - 避免等待 `listWorkspaces()` 及所有工作区的 `refreshThreadsForWorkspace()` 全量串行循环结束后才被动查找目标。
2. **后端 HTTP Gzip 压缩**：
   - 在 `services/local-ai-core/src/runtime/server-helpers.ts` 与 `local-core-runtime-server.ts` 中针对 JSON 响应支持 `Accept-Encoding: gzip` 自动流式压缩（阈值 > 1 KiB），针对长文本与历史消息大幅减少传输字节（节省 70%~90% 带宽）。
3. **后端消息分页与窗口化查询支持**：
   - `packages/contracts/src/local-core.ts` 与 `@cc/core-sdk/threads.ts`：支持查询参数 `limit` 与 `beforeSeq`；
   - `services/local-ai-core/src/acp/store/thread-store.ts`：`get(threadId, options)` 支持基于 `seq` 的窗口分页查询，返回最新 N 条消息（默认 50 条）以及 `hasMore` 标识，保证旧调用完全向下兼容；
   - 工具输出防爆：单条过大的历史输出在基础会话详情中提供安全截断长度保护，避免单次数十兆文本传输。
4. **前端视口懒渲染与代码高亮延迟加载**：
   - 优化 `src/pages/Threads/ThreadChatMessage.tsx` 与 `src/components/chat/ChatMarkdown.tsx`：
   - 对非可见视口或大量历史消息采用轻量占位/懒加载，避免首屏触发数百次 `highlight.js` 正则引擎计算。
5. **前端 SWR 内存缓存层**：
   - 在 `useThreadChatSessionBrowser.ts` 或会话控制器中增加最近访问会话的内存缓存，切换时立即呈现已有快照，随后后台静默更新。

---

## 3. 非目标（Non-goals）

1. **不修改底层 SQLite 数据结构**：不需要修改 `threads` 与 `messages` 的 Schema 结构（现有的 `(thread_id, seq)` 联合索引已完全支持倒序/正序切片查询）。
2. **不破坏既有实时通信协议**：ACP WebSocket 实时推送事件、预览流（Streaming Preview）、权限决策卡片等交互逻辑保持不变。
3. **不影响其它子系统的独立列表**：不涉及知识库文件上传、自动化监控执行等非会话详情模块的业务协议。

---

## 4. 行为与接口契约（Behavior & Interfaces）

### 4.1 REST API 分页参数与返回契约

`GET /api/local/v1/threads/:threadId?limit=50&before_seq=120`

请求参数：
- `limit` (可选，number): 请求消息条数，默认 50（不传时兼容模式下返回全部或默认上限）；
- `before_seq` (可选，number): 获取指定序列号之前的历史消息（用于向上滚动加载历史）。

响应结构扩展（完全兼容现有 `ThreadDetail`）：
```ts
export interface ThreadDetail extends ThreadSummary {
  messages: ThreadMessage[];
  selectedKnowledgeBaseIds: string[];
  pendingPermissionRequest?: ThreadPendingPermissionRequest | null;
  hasMore?: boolean;
  firstSeq?: number;
  lastSeq?: number;
}
```

### 4.2 HTTP 响应头
当客户端请求头带有 `Accept-Encoding: gzip` 且响应体为 JSON 且体积 > 1024 字节时：
- 返回响应头：`Content-Encoding: gzip`
- 响应体：经过 `node:zlib.gzipSync` 或流式 Gzip 压缩的二进制 Buffer。

---

## 5. 约束与边界条件（Constraints & Edge Cases）

1. **向后兼容性（Backward Compatibility）**：
   - 外部调用方（如 SDK、桌面旧客户端）若不传 `limit`，仍然能正常获取数据，不能破坏既有单测与集成测试；
2. **实时流拼接完整性**：
   - 当历史消息按窗口分页拉取最新 50 条时，后续通过 WebSocket / Bridge 进来的实时消息（`progress`, `reply`, `tool`）仍需能够按 `order` / `timestamp` 平滑追加，不发生错位或漏掉。
3. **滚动条位置保持**：
   - 向上滚动加载更早历史时，必须保持用户当前的视口滚动相对偏移，避免突然跳变到底部。

---

## 6. 验收标准（Acceptance Criteria）

- [ ] **AC-1（请求解耦与并行预载）**：在 URL 带有 `project` 与 `session` 时，进入页面后 `getThread` 与 `listWorkspaces` 并行发出，不再等待全量工作区线程列表循环拉取完毕才发起。
- [ ] **AC-2（HTTP Gzip 压缩）**：向 `GET /api/local/v1/threads/:threadId` 发送带 `Accept-Encoding: gzip` 请求时，返回 `Content-Encoding: gzip`，压缩后传输字节数显著降低（>= 60% 减少）。
- [ ] **AC-3（后端窗口化查询）**：`GET /threads/:threadId?limit=20` 正确返回最新的 20 条消息及 `hasMore: true`；传入 `before_seq` 可获取上一页历史。
- [ ] **AC-4（渲染性能无长任务卡顿）**：在包含 200+ 条历史消息、多段代码块的大型会话中，首屏渲染不引发超过 200ms 的 JavaScript 长任务，页面即时呈现。
- [ ] **AC-5（切换会话内存秒开）**：在左侧两个历史会话之间来回切换时，命中内存缓存即时展示，无需展示整页骨架或空白等待。
- [ ] **AC-6（质量门禁）**：`pnpm typecheck`、相关单元与集成测试、代码质量门禁 100% 通过。
