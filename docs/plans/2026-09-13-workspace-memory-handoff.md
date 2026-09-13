# Plan: 工作区记忆与按需跨 Agent 会话交接实施计划 (Workspace Memory & On-Demand Cross-Agent Session Handoff)

## 1. 架构方案图 (Workflow Diagram)

本方案的端到端架构与处理时序已通过 Archify 生成交互式 HTML 画布并经 Showcase 质量门禁校验：
- **方案交互式 HTML 画布**：[`docs/architecture/changes/2026-09-13-workspace-memory-handoff.html`](../architecture/changes/2026-09-13-workspace-memory-handoff.html)
- **Archify DSL 规范定义**：`docs/architecture/changes/2026-09-13-workspace-memory-handoff.workflow.json`

全流程涵盖三阶段与三大核心泳道：
1. **Agent 切换与确定性提炼 (Switch & Deterministic Distillation)**：仅在 `/agent use` 发生切换时按需触发，Trace 抽取与首尾对话总结，严格执行 16KB Prompt / 2KB 工具上下文安全预算，**100% 纯本地确定性算法，零 LLM 开销，零网络延迟**；
2. **结构化存盘与 FTS 索引 (Structured Persistence & Indexing)**：SQLite `session_handoffs` 状态机存储 + `<workspace>/.agentdock/memory/` 物理目录（4类）与 SQLite FTS5 虚拟表双向增量同步；
3. **新 Agent 注入与自主检索 (Cross-Agent Injection & Skill Query)**：新 Agent 首条工作消息进行 Prompt 定界注入与原子翻转为 `consumed`，Managed Skill 暴露 `memory_query` / `memory_write` 工具，Desktop UI 呈现切换点交接卡片与 Memory 管理面板。

---

## 2. 关键设计取舍 (Key Architectural Tradeoffs)

1. **按需触发 (On-Demand) vs 每次 Run 盲目提取**：
   - 95% 的对话是在同一个 Agent 下进行，无需任何交接。仅在用户执行 `/agent use <agent>` 或切换线程 Agent 时**按需触发一次提炼**，彻底避免日常对话的冗余计算与数据库垃圾写入，同时交接卡片在切换点直接弹出，用户心智极其自然。
2. **纯本地确定性提取 (<2ms) vs 外部大模型蒸馏**：
   - 依赖外部大模型提炼会导致每次切换产生 1~3 秒卡顿并消耗 API 额度，网络异常还会阻塞会话；基于 ACP 本身的高保真 `run_spans`（工具调用、修改文件、退出状态）和 Assistant 回复，纯本地 TypeScript 正则与数据过滤**耗时 <2ms，零成本，零故障率**。
3. **纯 Markdown 文件系统为主 vs 纯 SQLite 数据库为主**：
   - 物理文件存储在 `<workspace>/.agentdock/memory/`（含 YAML Frontmatter），与代码一同纳入 Git 版本控制，可直接被 Obsidian 或外部编辑器打开；SQLite FTS5 仅作为毫秒级全文检索与元数据加速缓存层，双向增量同步，兼具开放性与极致性能。

---

## 3. 详细实施步骤 (TDD 顺序)

### 阶段一：共享契约与 SDK 定义 (Contracts & Core SDK)
1. **`packages/contracts/src/handoff.ts` [NEW]**
   - 定义 `SessionHandoffStatus` (`'pending' | 'consumed' | 'superseded'`)、`SessionHandoffPayload`、`SessionHandoffRecord`；
2. **`packages/contracts/src/memory.ts` [NEW]**
   - 定义 `MemoryCategory` (`'_rules' | 'decisions' | 'procedures' | 'gotchas'`)、`MemoryPageMeta`、`MemoryPage`、`MemoryQueryInput`、`MemoryPageWriteInput`、`MemorySearchResult`；
3. **`packages/contracts/src/index.ts` [MODIFY]**
   - 导出 `handoff` 与 `memory` 契约；
4. **`packages/core-sdk/src/memory.ts` [NEW] & `threads.ts` [MODIFY]**
   - 封装 Memory REST API（list, get, write, delete, query, sync）与 Thread Handoff REST API；
5. **契约测试 (`tests/contracts/session-handoff-contracts.test.ts`) [NEW]**
   - 验证数据结构序列化、反序列化与边界检验。

### 阶段二：存储层与 SQLite FTS5 全文索引 (TDD: RED -> GREEN)
1. **`services/local-ai-core/src/acp/store/schema.ts` [MODIFY]**
   - 新增 `session_handoffs`、`workspace_memory_pages` 表以及 `workspace_memory_fts` FTS5 虚拟表与索引；
2. **`services/local-ai-core/src/acp/store/session-handoff-store.ts` [NEW]**
   - 实现 Handoff 的 CRUD、`getPendingHandoff(threadId)`、`markHandoffConsumed(id, runId)`；
3. **`services/local-ai-core/src/acp/store/workspace-memory-store.ts` [NEW]**
   - 实现 Memory 页面元数据增删改查、FTS5 全文检索匹配（`MATCH`）、标签与分类过滤；
4. **`services/local-ai-core/src/acp/store/local-core-acp-store.ts` [MODIFY]**
   - 组装并暴露 `sessionHandoffs` 与 `workspaceMemory` 实例；
5. **单测 (`tests/electron/workspace-memory-store.test.ts`) [NEW]**
   - 验证 FTS5 全文检索、中文/英文分词匹配、事务更新与删除。

### 阶段三：确定性交接提炼引擎与按需切换挂钩 (TDD: RED -> GREEN)
1. **`services/local-ai-core/src/acp/session-handoff-distiller.ts` [NEW]**
   - 实现基于历史 `run_spans` 与 Assistant 消息的纯本地结构化提炼；
   - 强制执行 16KB Prompt 上限与 2KB 工具上下文安全预算，**零 LLM 调用**；
2. **`services/local-ai-core/src/thread/thread-command-service.ts` [MODIFY]**
   - 在 `executeAgentCommand` 的 `use` 和 `reset` 成功切换分支中，按需调用提炼器生成 `pending` 交接书并存盘，同时在回复中附加交接卡片指引；
3. **`services/local-ai-core/src/thread/agent-message-policy.ts` & `workspace-router.ts` [MODIFY]**
   - 在 `prepareAgentMessage` 中检查待注入的 pending handoff；
   - 组装 `[Session Handoff from <fromAgent> to <toAgent>] ... [/Session Handoff]` 定界块前置注入；
   - 在新 Agent 发送实际工作消息时原子翻转为 `consumed`；
4. **单测 (`tests/electron/session-handoff-distiller.test.ts`) [NEW]**
   - 验证空历史降级、16KB/2KB 预算截断、跨多轮修改文件提取、decisions/openQuestions/nextSteps 提取准确性；
5. **集成测试 (`tests/integration/cross-agent-handoff.test.ts`) [NEW]**
   - 端到端验证：Agent A 运行 ➔ 执行 `/agent use <agent_b>` ➔ 触发提炼生成 pending handoff ➔ Agent B 首条工作消息触发 ➔ 首条 prompt 成功注入交接块 ➔ handoff 状态变为 consumed。

### 阶段四：物理目录服务与双向增量同步 (TDD: RED -> GREEN)
1. **`services/local-ai-core/src/memory/workspace-memory-service.ts` [NEW]**
   - 目录初始化（`<workspace>/.agentdock/memory/{_rules,decisions,procedures,gotchas}`）；
   - 标准 YAML Frontmatter 解析与原子落盘（`atomicWriteFileSync`）；
   - 基于 `mtime` 和 `sha256` 检测外部文件（Obsidian/VS Code）增删改并增量刷新 SQLite；
   - 严格的路径穿越安全防护（禁止 `..` 与非法字符）；
2. **REST 路由挂载 (`services/local-ai-core/src/runtime/`) [MODIFY/NEW]**
   - 在 `server-routes.ts` 注册路由；
   - 在 `handlers/memory-handler.ts` [NEW] 与 `handlers/thread-handler.ts` 实现 HTTP 处理器；
3. **单测 (`tests/electron/workspace-memory-service.test.ts`) [NEW]**
   - 验证外部修改增量发现、路径防穿越、YAML 容错与原子写入。

### 阶段五：CLI 工具链与 Managed Skill 集成 (TDD: RED -> GREEN)
1. **`services/local-ai-core/src/cli/lac.ts` & `memory-cli-handlers.ts` [NEW]**
   - 实现 `lac memory query / write / list / sync` 命令行套件；
2. **`electron/managed-skills/memory/` [NEW]**
   - `SKILL.md`：Agent 认知规范（何时检索、何时沉淀）；
   - `scripts/memory-query.sh`：便捷检索辅助脚本；
   - `scripts/memory-write.sh`：便捷写入辅助脚本；
3. **`scripts/copy-managed-skills.mjs`**
   - 确认打包流程将 `memory` skill 正确同步至 `dist-electron/`；
4. **单测 (`tests/electron/memory-skill.test.ts`) [NEW]**
   - 验证 Skill Catalog 加载与 CLI 行为。

### 阶段六：Renderer 前端界面集成 (UI Components & Pages)
1. **ThreadChat 交接卡片 (`src/pages/Threads/`)**
   - 新增 `SessionHandoffCard.tsx`：折叠/展开、源 Agent 与目标 Agent 徽标、决策 Chips、未决问题、修改文件列表；
   - 在 `ThreadChatMessage.tsx` 与 `ThreadChat.tsx` 中嵌入；
2. **Workspace Memory 管理面板 (`src/pages/Desktop/`)**
   - `workspace-model.ts` 扩充 `ProjectTab` 支持 `'memory'`；
   - `workspace-components.tsx` 增加 Memory 选项卡；
   - 新增 `WorkspaceMemorySection.tsx`：左侧 4 类树形目录、实时 FTS5 搜索栏、新建按钮；右侧 Markdown 预览/编辑双模态、Frontmatter 属性栏、Obsidian 路径指引。

### 阶段七：架构与全量门禁检验 (Quality Gates & Verification)
1. 运行 `pnpm typecheck`；
2. 运行 `pnpm lint:gates`（验证 0 循环依赖、dead-code、超长函数与复杂度）；
3. 运行 `pnpm lint:arch`（验证 Archify showcase 门禁）；
4. 运行 `pnpm test`（全量单测、集成测试与 BDD 测试 100% 通过）；
5. 运行 `pnpm coverage`（覆盖率达标）。

---

## 4. 验证计划 (Verification Plan)

### 4.1 自动化测试
- `pnpm typecheck`
- `pnpm lint:gates`
- `pnpm lint:arch`
- `pnpm test`
- `pnpm coverage`

### 4.2 真实主路径验证
- 验证路径 1：在 Thread 中使用 Agent A 运行任务生成/修改文件；
- 验证路径 2：输入 `/agent use <agent_b>` 切换 Agent，观察立即生成从 Agent A 到 Agent B 的交接书，并在 UI 显示交接卡片；
- 验证路径 3：发送给 Agent B 一条任务消息，验证 Agent B 的首条 Prompt 成功注入前置交接上下文，且状态流转为 consumed；
- 验证路径 4：在工作区创建 Memory 页面，外部使用 Obsidian 打开并编辑，在 AgentDock 搜索验证增量同步；
- 验证路径 5：通过 Managed Skill 脚本执行 `memory-query.sh` 与 `memory-write.sh` 验证 Agent 自主检索与沉淀。
