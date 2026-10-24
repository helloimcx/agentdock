# Spec: 定时任务渠道投递韧性与终态收敛（Phase 1 - 3）

## 1. Goal
彻底解决定时任务（AI早报、ETF研报、代码分析等）投递飞书总结缺失、严重静默失败、状态双脑分裂悬挂及超长文本发送风险，建立解耦、健壮、可闭环观测的主动投递体系。

## 2. Scope
1. **Phase 1: 止血与解耦（Execution Context vs Delivery Route）**
   - 彻底解耦执行线程（`record.threadId`）与投递目标（`record.route`）；
   - 移除 `AutomationActionExecutor.ts` 中对 `binding?.thread_id === record.threadId` 的错误强校验，保证 `side-thread`、`same-thread` 及非绑定目标渠道的正常投递。
2. **Phase 2: 健壮性与健康度闭环（Error Categorization & Health Feedback Loop）**
   - 细化预检与错误分类，消除单一模糊报错；
   - 联动投递失败状态到 `automation_runs.error` 与 `automations.health`（标记为 `degraded`）；
   - 触发可观测性系统告警，消除静默失败；
   - 调度轮询允许 `degraded` 任务继续运行，投递成功后自愈恢复为 `healthy`。
3. **Phase 3: 渠道流式与终态收敛（Card State Convergence & Long Text Safety）**
   - 统一飞书端流式 Bridge 与 Outbox 终态：在任务结算时（成功或失败）原地 Patch 状态卡片（`✅` 或 `❌`），消除死卡片悬挂；
   - 飞书/微信传输层 Markdown 安全分段保护，防止超长研报/报告被渠道 API 拒绝。

## 3. Non-goals
- 不重写 Cron 调度引擎或触发器匹配逻辑；
- 不修改 ACP 底层与通用 Agent 运行时的通信协议；
- 不引入外部重量级第三方依赖。

## 4. Behavior & Interfaces
- **投递判定**：
  - 执行上下文校验：执行线程存在且工作区匹配；属主 Automation 及 Run 存在；
  - 路由有效性校验：`local` 平台直通；外部渠道仅校验 `channelId` 非空且网关 Runtime 就绪。
- **状态流转**：
  - 投递成功：`deliveryStatus: 'delivered'`，Run 保持 `succeeded`，Automation 维持/恢复 `healthy`；
  - 投递失败：`deliveryStatus: 'failed'`，Run 记录 `error`，Automation 降级为 `degraded`，触发诊断事件与 UI 广播。
- **卡片生命周期**：
  - 任务启动：发送带稳定句柄的初始状态卡片（`⏳`）；
  - 任务结算：原地 Patch 为终态卡片（`✅` 或 `❌`），再释放 Bridge。
- **长文本传输**：
  - 超过飞书安全阈值（20KB）时，语法感知切分（代码块自动闭合/重开、表格保护），按序多条发送。

## 5. Constraints & Compatibility
- SQLite 字段兼容：`automations.health` 本身存储为 TEXT，扩展 `'degraded'` 无需数据库迁移；
- 遵循架构分层：Outbox 存储不可变业务总结全文，分段处理仅限于 Channel Transport 层；
- 满足项目代码规范，保持圈复杂度与文件长度门禁在阈值内。

## 6. Acceptance Criteria
1. `side-thread` 模式下的定时任务能 100% 成功投递到飞书目标群，Outbox 状态为 `delivered`。
2. 投递失败场景下，`automation_runs` 记录明确具体错误，`automations.health` 降级为 `degraded` 并触发系统告警，不发生静默失败。
3. 飞书端流式进度卡片在任务结束或投递失败后，100% 收敛至终态（`✅` 或 `❌`），无残留悬挂卡片。
4. 超过 20KB 的超长 Markdown 文本在飞书端自动分段完整送达，排版不损坏。
5. 全量 CI 门禁（`pnpm typecheck`、`pnpm lint:gates`、`pnpm test`）100% 通过。
