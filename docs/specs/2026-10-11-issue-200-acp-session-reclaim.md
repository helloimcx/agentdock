# Spec: Issue #200 Local-mode ACP 会话空闲回收与恢复

## 1. 背景与目标 (Background & Goals)

生产环境中，单台轻量服务器（如 3.6GB 内存 CVM）发生 OOM 崩溃。排查确认根本原因为：本地模式（local / remote-mesh-shell 等非沙箱模式）下，ACP Agent 子进程（如 `claude` CLI、`claude-agent-acp` 适配器）在 run 完成后从未被释放，也没有任何空闲回收机制。每个线程的 Agent 进程随上下文增长至 200MB~365MB，累积多个线程后常驻内存超过 1.4GB，极易击穿系统内存与 Swap，最终被内核 OOM Killer 杀掉。

**目标**：
1. 本地及非沙箱模式的 ACP 会话在 run 完成或中断后，统一走 release 路径，并进入空闲回收倒计时（默认 900 秒 / 15 分钟，可通过 `AGENTDOCK_ACP_IDLE_SECONDS` 环境变量配置）。
2. 在空闲倒计时内有新交互时，重用现有会话并取消定时器，保持快速响应。
3. 空闲超时触发后，正常退出 Agent 子进程，完全回收内存。
4. 进程回收后，若该线程再次收到新消息，通过线程表已记录的 `acp_session_id` 与 `acp_supports_load` 能力自动调用 `session/load` 恢复会话上下文，用户无感续聊。

## 2. 范围 (Scope)

- **包含 (In Scope)**：
  - `services/local-ai-core/src/acp/local-core-acp-backend.ts`：在 `runPrompt` 的 `finally` 阶段，无条件调用 `this.sessionCoordinator.releaseThreadSession(threadId, config)`，使 local / mesh 模式在 run 结束后与 sandbox 一样进入 release 流程。
  - `services/local-ai-core/src/acp/local-core-acp-session-coordinator.ts`：
    - `releaseThreadSession` 支持非沙箱模式的空闲回收倒计时。
    - 提供 `AGENTDOCK_ACP_IDLE_SECONDS` 可配置项（默认 900 秒）。
    - 完善日志输出（区分 local / sandbox 模式）。
    - 确保有活跃 run 时保护不被误杀、会话关闭时清理定时器。
  - 回归测试与单元测试覆盖：针对本地会话 idle 超时回收、活跃 run 保护、新请求 load 恢复进行自动化测试。

- **不包含 (Non-goals)**：
  - 不引入全局 Agent 并发限制与排队系统（Issue #200 中的可选加固项，作为独立后续演进）。
  - 不改变数据库表结构与公共接口协议。

## 3. 行为与接口契约 (Behavior & Contract)

### 3.1 会话释放与空闲回收
- `releaseThreadSession(threadId, config)`：
  - 若 `config.sandbox?.enabled`：
    - 若 `lifecycle === 'per_run'` 或 `stateScope === 'run'`：立即调用 `closeThreadSession(threadId)`。
    - 否则：调用 `scheduleIdleClose(session, config.sandbox.idleSeconds)`。
  - 若非沙箱（local / mesh 等模式）：
    - 解析空闲时间：优先取 `process.env.AGENTDOCK_ACP_IDLE_SECONDS`（需为有限正整数），缺省为 900 秒。
    - 调用 `scheduleIdleClose(session, idleSeconds)`。

### 3.2 空闲触发检查
- `scheduleIdleClose` 定时器到期时：
  - 检查会话是否有效、未关闭 (`!session.closed`) 且当前无正在执行的 run (`!session.currentRunId`)。
  - 满足条件则执行 `closeThreadSession(threadId)`，释放子进程并从 `sessions` 映射中删除。

### 3.3 会话重建与上下文恢复
- 当线程收到下一条消息且当前无活跃会话时，`ensureSession`：
  - 启动新的 Agent 进程并执行 initialize。
  - 若数据表中 `acp_session_id` 存在且 `row.acp_supports_load && session.supportsLoad`：
    - 调用 `session/load` 恢复原有上下文。
    - 恢复成功则沿用原有 `sessionId`；若不支持或失败则自动降级执行 `session/new`。

## 4. 验收标准 (Acceptance Criteria)

1. [AC-1] Local 模式 run 完成后，会话进入空闲计时，默认 900s（支持环境变量 `AGENTDOCK_ACP_IDLE_SECONDS` 覆盖）。
2. [AC-2] 空闲超时到期后，子进程被正常关闭，内存释放，会话从活跃列表中移除。
3. [AC-3] 空闲计时期间，若会话有正在运行的 run (`currentRunId !== null`)，计时器不会关闭会话。
4. [AC-4] 空闲计时期间，若新消息到达，会话被重用并清除空闲计时器。
5. [AC-5] 会话被空闲回收后，新消息到达能够通过 `session/load` 恢复原有会话并无感续聊。
6. [AC-6] Run 被中断（cancelled / interrupted）后，也能正确进入 release 流程并受空闲回收管理。
7. [AC-7] 现有测试与代码质量门禁全部通过。
