# Spec: Butler P1 管道联合修复 (#297, #299, #298)

## 1. Goal
在单个 PR 中系统性解决管家（Butler）子系统在多 Agent 长周期任务落地中的三大核心阻断问题：
1. **消除验收死胡同 (#297)**：用户现场确认成果后，能够通过人工裁决通道顺利验收任务并结案，避免被迫以 `cancel` 告终导致审计历史颠倒。
2. **打通全链路执行可观测性 (#299)**：在 CLI 和跨进程通道中透出 Worker 实时运行心跳、最新输出片段与细粒度阻断原因（`blockedReason`），不再依赖直查底层 SQLite。
3. **解除工作区单槽位串行饥饿 (#298)**：将工作区粗粒度二元锁升级为有界并发调度模型，支持同工作区独立任务并行执行，并在排队时明确展示排队原因（`queueReason`）。

---

## 2. Scope
- `packages/contracts/src/butler.ts`：扩展数据契约（验收输入、委派可观测字段、排队原因、协议 Envelope）。
- `apps/daemon/src/butler/butler-service.ts`：重构 `complete()` 验收准入守卫，增加人工裁决路径与 `reviewing` 自动级联晋升。
- `apps/daemon/src/butler/butler-observation.ts`：实现 `observeDelegation` 中的心跳、最新消息、审批详情采集；升级 `workspaceBusy` 为有界并发检测。
- `apps/daemon/src/butler/butler-dispatcher.ts`：重构 `dispatchReady()` 并发分发与排队原因计算；打通通道模式 `blockedReason` 传输；增加终态锁定保护。
- `apps/daemon/src/butler/butler-bot-protocol.ts`：协议编解码支持 `blockedReason`。
- `apps/daemon/src/cli/butler-cli-handlers.ts`：CLI `lac butler complete` 扩展参数；`lac butler info` 格式化呈现新增观测字段。
- 对应集成测试与回归测试。

---

## 3. Non-goals
- 不修改底层 SQLite 数据表的 DDL 结构（所有新增字段均通过已有 JSON 结构平滑扩展）。
- 不取消任务显式 `dependsOn` 的 DAG 依赖顺序约束。
- 不引入外部分布式锁或独立消息队列中间件。

---

## 4. Behavior & Interfaces

### 4.1 验收生命周期 (#297)
1. **人工裁决验收通道**：
   - `lac butler complete <task-id> --summary "<text>" [--manual] [--reason "<reason>"]`
   - 当传入 `--manual` 或普通调用中子任务已完成/待复核时：
     - 若底层专属线程无正在写操作的活跃 Turn（`childHasOutstandingExecution === false`），允许执行验收。
     - 自动将所有处于 `reviewing` 状态的委派晋升为 `completed`（记录 `acceptedReportVersion`）。
     - 保留已失败、已取消或已阻塞委派的原始状态与错误日志作为真实审计凭据。
     - 记录任务级审计属性：`acceptedBy: 'user'`，`manualAcceptanceReason: reason`。
2. **终态锁定与防回退**：
   - `deriveTaskStatus` 与 `aggregate` 增加守卫：一旦任务状态为 `completed` 或 `cancelled`，后台周期扫描 `reconcile()` 绝不将任务逆向改写为 `failed`。

### 4.2 执行可观测性 (#299)
1. **实时指标采集**：
   - `lastHeartbeatAt`：动态提取 underlying run 的 `updatedAt`/`startedAt`、`thread_runtime_partials`（流式输出）与 assistant 消息时间戳的最新值。
   - `lastWorkerMessage`：截取流式 Partial 或最新 Assistant 消息的前 500 字符。
   - `blockedReason`：枚举覆盖 `'pending_approval' | 'workspace_busy' | 'execution_uncertain' | 'waiting_external'`。
   - `approvals`：结构化透出当前待处理审批的 `id`, `title`, `status`, `createdAt`。
2. **跨通道协议传递**：
   - Lark/Channel 模式下的 `task.progress` 与 `task.result` 完整编解码并持久化 `blockedReason`、心跳和 worker 消息。

### 4.3 有界并发与排队透出 (#298)
1. **工作区并发模型**：
   - 过滤掉权限回复、命令行等非执行类 submission，仅统计真实的活跃执行。
   - 同工作区默认允许并发度最高为 4（支持 `trackingPolicy.maxWorkspaceConcurrency` 配置）。
2. **排队原因追踪 (`queueReason`)**：
   - 依赖未就绪：`waiting_dependency:<keys>`
   - 自身线程占用：`waiting_thread`
   - 工作区满载：`workspace_busy`
   - 分发成功进入执行后，清空 `queueReason`。

---

## 5. Constraints & Compatibility
- 契约所有新增字段均为 `optional`，完全向后兼容历史持久化数据。
- 遵循 TypeScript strict 模式，Zero-tolerance 循环引用。
- Architecture Impact 判定为 `Required`，更新对应架构变更记录与规范。

---

## 6. Acceptance Criteria
- [AC-1] 在子任务包含 reviewing、failed 或 cancelled 时，用户执行 `lac butler complete` 能够成功结案为 `completed`，且后续后台扫描不回退为 `failed`。
- [AC-2] `lac butler info` 及 `--json` 能够清晰输出 `lastHeartbeatAt`、`lastWorkerMessage`、待审批详情及阻断原因。
- [AC-3] 同一工作区下两个无依赖的独立委派能够并行启动执行，长任务不再卡死后续任务。
- [AC-4] 因并发满载或依赖排队的委派，其 `queueReason` 在 `info` 中清晰可见。
- [AC-5] 全量现有测试与新增集成测试 100% 通过，`pnpm typecheck` 零错误。
