# Spec: 工作区记忆与按需跨 Agent 会话交接 (Workspace Memory & On-Demand Cross-Agent Session Handoff)

## 1. 目标与背景 (Goal & Context)

在多 Agent 协同开发（如在 Thread 内使用 `/agent use <agent>` 切换 Claude Code、Codex、Pi、OpenCode 或 Hermes）过程中，AgentDock 存在两项关键结构性断崖：
1. **跨 Agent 上下文断崖 (Context Cliff)**：
   切换 Agent 时，新 Agent 启动独立的 ACP 原生会话。尽管 Thread 原始对话流水历史依然存在，但新 Agent 接收到的是未经蒸馏的长文本流水，缺乏已确认的架构决策、已排除的失败路径、已修改的关键文件列表、未决问题和下一步规划，导致新 Agent 极易重复提问、偏离方向或重复踩坑；
2. **缺乏动态演进的项目工作记忆 (Living Workspace Memory Wiki)**：
   现有 `@cc/knowledge-api` 定位于外部文档检索型 RAG，无法胜任项目工程记忆的持续沉淀（ADR 架构决策、SOP 运维流程、踩坑 Gotchas、全局规则 Rules）。开发者和 Agent 缺乏一个物理存储在工作区内、纯 Markdown 格式、可由外部 Obsidian/VS Code 直接打开且具备本地毫秒级检索（SQLite FTS5）的工作记忆体系。

本规范（对应 Issue #86）基于用户审阅反馈，确立**“按需触发、零 LLM 开销”**的极简架构：
- **按需跨 Agent 会话交接 (On-Demand Session Handoff)**：仅在发生 Agent 切换（`/agent use <agent>`、`/agent reset` 或线程设置切换）时，基于上一任 Agent 在本线程内的 Trace 与消息执行**纯本地确定性提炼（零 LLM 调用，<2ms 瞬间完成）**，生成交接书并存入 SQLite `session_handoffs` 作为 `pending`；新 Agent 发起首条真实工作指令时前置注入并翻转为 `consumed`；
- **Workspace Memory Wiki**：基于 `<workspace>/.agentdock/memory/` 物理目录（`_rules/`、`decisions/`、`procedures/`、`gotchas/`）与 SQLite FTS5 虚拟表，实现双向增量同步、Managed Skill 自主读写与 UI 树形搜索管理。

---

## 2. 需求范围 (Scope)

- **公共契约扩展 (`packages/contracts/src/`)**：
  - `handoff.ts`：定义 `SessionHandoffPayload`、`SessionHandoffRecord`、`SessionHandoffStatus` (`'pending' | 'consumed' | 'superseded'`)；
  - `memory.ts`：定义 `MemoryPage`、`MemoryCategory` (`'_rules' | 'decisions' | 'procedures' | 'gotchas'`)、`MemoryQueryInput`、`MemoryPageWriteInput`、`MemorySearchResult`；
  - 导出至 `packages/contracts/src/index.ts`。
- **核心数据存储与索引 (`services/local-ai-core/src/acp/store/`)**：
  - `schema.ts`：新增 `session_handoffs`、`workspace_memory_pages` 表以及 `workspace_memory_fts`（FTS5 虚拟表及触发器）；
  - `session-handoff-store.ts`：Handoff 记录的增删查改与原子状态机流转；
  - `workspace-memory-store.ts`：FTS5 虚拟表查询、页面元数据存储与双向增量同步；
  - 挂载至 `LocalCoreAcpStore`。
- **确定性交接提炼引擎与 Prompt 注入 (`services/local-ai-core/src/`)**：
  - `session-handoff-distiller.ts`：纯本地正则与 Trace 提炼器，**100% 零 LLM 调用**，从上一任 Agent 的 Trace Spans（`run_spans`：文件修改、工具调用）与 Assistant 消息中提取决策、产物、未决问题与下一步，单工具限制 2KB，Prompt 限制 16KB；
  - `thread-command-service.ts`：在 `/agent use <agent>` 与 `/agent reset` 成功切换 Agent 时，立即按需触发提炼，生成交接书存盘并附带交接卡片事件；
  - `workspace-router.ts` & `agent-message-policy.ts`：在新 Agent 接收第一条实际工作消息时，前置注入 `[Session Handoff from <fromAgent> to <toAgent>] ... [/Session Handoff]`，并原子翻转为 `consumed`。
- **工作区记忆物理服务与双向同步 (`services/local-ai-core/src/memory/`)**：
  - `workspace-memory-service.ts`：管理 `<workspace>/.agentdock/memory/` 目录结构与 YAML Frontmatter 解析；写穿透（落盘 + 同步更新 FTS5）；基于 `mtime` 和 `sha256` 探测外部（如 Obsidian）变动并增量刷新索引；路径穿越安全防护。
- **REST 路由与 Core SDK (`packages/core-sdk/`)**：
  - 暴露 `/api/local/v1/threads/:threadId/handoffs` 系列接口；
  - 暴露 `/api/local/v1/workspaces/:workspaceId/memory/*` 系列接口（pages、query、sync）；
  - 在 `@cc/core-sdk` 挂载 `memory` 与扩展 `threads` SDK 客户端。
- **Managed Skill 与 CLI 工具链 (`electron/managed-skills/` & `cli/`)**：
  - 新增 `electron/managed-skills/memory/SKILL.md`，配套 `scripts/memory-query.sh` 与 `scripts/memory-write.sh`；
  - 在 `lac.ts` 扩展 `lac memory query`、`lac memory write`、`lac memory list`、`lac memory sync`。
- **Desktop UI 交互与展示 (`src/pages/`)**：
  - ThreadChat：在 Agent 切换点及消息流中渲染可折叠的 `<SessionHandoffCard />` 组件；
  - Desktop Workspace：新增 `'memory'` 标签页，提供树形目录浏览、FTS 搜索、Markdown 在线预览与编辑保存，标注外部 Obsidian 打开指引。

---

## 3. 非目标 (Non-Goals)

- 不在普通轮次结束时无脑调用后台提炼，消除 95% 无意义计算与 I/O；
- 不调用任何次级大模型进行交接蒸馏（纯本地规则确定性提取，零 Token 消耗、零外部网络依赖）；
- 不替代面向大文档集语义切片的外部 RAG 向量知识库（二者职责分明：知识库用于外部参考资料检索，Memory Wiki 专供项目工程共识与决策沉淀）；
- 不引入除 SQLite 外的额外独立数据库服务；
- 不实现实时协同冲突解决算法（以本地文件系统原子写入与 `mtime` 覆盖为准，历史由 Git 托管）。

---

## 4. 核心接口与数据模型 (Interfaces & Data Models)

```typescript
// 1. Session Handoff 契约
export type SessionHandoffStatus = 'pending' | 'consumed' | 'superseded';

export interface SessionHandoffPayload {
  threadId: string;
  runId: string;
  fromAgent: string;
  toAgent?: string;
  summary: string;
  decisions: string[];
  openQuestions: string[];
  nextSteps: string[];
  artifacts: string[];
  toolSummary?: Record<string, unknown>;
}

export interface SessionHandoffRecord extends SessionHandoffPayload {
  id: string;
  status: SessionHandoffStatus;
  createdAt: string;
  consumedAt?: string | null;
  consumedByRunId?: string | null;
}

// 2. Workspace Memory 契约
export type MemoryCategory = '_rules' | 'decisions' | 'procedures' | 'gotchas';

export interface MemoryPageMeta {
  title: string;
  category: MemoryCategory;
  tags: string[];
  summary?: string;
  updatedAt: string;
  author?: string;
}

export interface MemoryPage extends MemoryPageMeta {
  id: string;             // <workspaceId>:<category>/<slug>
  workspaceId: string;
  slug: string;           // e.g. "sqlite-wal-locking"
  relativePath: string;   // e.g. ".agentdock/memory/gotchas/sqlite-wal-locking.md"
  content: string;        // Markdown 正文 (不含 frontmatter)
  rawMarkdown: string;    // 含 YAML frontmatter 的完整文本
  mtimeMs: number;
}

export interface MemorySearchResult {
  page: MemoryPage;
  snippet?: string;
  rank?: number;
}
```

---

## 5. 约束与兼容性 (Constraints & Compatibility)

1. **单向依赖架构与代码防腐**：
   - Strict Inward Dependency：`contracts` ➔ `services/local-ai-core` ➔ `core-sdk` ➔ `renderer (src/)`；
   - 严禁渲染层或 SDK 直接导入 SQLite、本地 Core 或 Node.js 文件系统模块；
   - 单文件代码行数严格控制在 1000 行以内，复杂度严格控制在 ESLint 门禁阈值内。
2. **提炼有界性与 Token 安全边界**：
   - 纯本地提取，单工具 Span 输出截断不超过 2KB；
   - 提取输入 Prompt 截断不超过 16KB；
   - 注入的 `[Session Handoff]` 区块控制在 3KB 字符以内，防止压缩新 Agent 的工作窗口。
3. **文件系统安全性**：
   - 严格防范目录穿越漏洞（`..` 校验与绝对路径规范化），所有读写严格限制在 `<workspacePath>/.agentdock/memory/` 之下；
   - 写入操作采用临时文件 + 原子重命名（`atomicWriteFileSync`），防止写中断造成文件损坏。
4. **向后兼容性**：
   - SQLite 使用 `CREATE TABLE IF NOT EXISTS` 与 `CREATE VIRTUAL TABLE IF NOT EXISTS`，存量数据库无缝升级；
   - 存量 Thread 无 pending handoff 时行为与既有代码 100% 一致。

---

## 6. 验收标准 (Acceptance Criteria)

- **AC-1**：执行 `/agent use <agent>` 或 `/agent reset` 切换 Agent 时，系统按需触发纯本地提取，并在 `session_handoffs` 插入一条 `status: 'pending'` 的交接记录，记录包含上一任 Agent 的 summary、decisions、openQuestions、nextSteps 和修改过的 artifacts。
- **AC-2**：切换后的新 Agent 收到第一条实际工作消息时，Prompt 首部必须无缝包含 `[Session Handoff from <fromAgent> to <toAgent>]` 定界块，且该 handoff 记录原子流转为 `status: 'consumed'`。
- **AC-3**：普通对话轮次（未发生 Agent 切换）不触发多余的交接提炼与数据库写入，保证零无效性能损耗。
- **AC-4**：ThreadChat 界面在 Agent 切换点直接展示可折叠的 `<SessionHandoffCard />` 组件，清晰呈现从源 Agent 交接给目标 Agent 的决策与文件。
- **AC-5**：工作区 `.agentdock/memory/` 下包含 `_rules/`、`decisions/`、`procedures/`、`gotchas/` 四类子目录，读写标准 Markdown 与 YAML frontmatter。
- **AC-6**：SQLite FTS5 虚拟表支持毫秒级全文与标签检索；外部（如 Obsidian）对 `.md` 文件的增删改在查询或同步时被增量刷新至索引。
- **AC-7**：Agent 可通过 Managed Skill 脚本（`memory-query.sh` / `memory-write.sh`）或 `lac memory` CLI 命令自主完成检索与沉淀。
- **AC-8**：Workspace 详情面板的 `Memory` 标签页支持树形浏览、关键词全文检索、Markdown 预览与在线编辑保存。
- **AC-9**：架构变更方案图与 HTML 画布通过 Archify 9 项 showcase 验证，通过 `pnpm lint:arch`；全量测试与静态质量门禁 100% 绿灯。
