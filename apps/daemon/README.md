# Local AI Core

`services/local-ai-core` 是桌面端本地核心服务，统一承接：

- runtime/service 状态管理
- 线程与消息路由（本地 ACP）
- 本地 SQLite 持久化
- Feishu/Lark 与 Weixin 原生 channel 网关
- 定时任务创建、执行与 channel 投递
- HTTP API + SSE 事件流

## 目录分层

```txt
src/
  acp/       # ACP backend / store / permission formatting
  channel/   # 平台 channel 网关与通用 channel contract 适配
  router/    # workspace 路由与配置归一化
  runtime/   # 本地服务入口（HTTP/SSE server、standalone 启动）
  scheduler/ # 定时任务调度、执行策略与平台适配
  thread/    # 线程 ID 编解码与 Thread DTO 映射
```

## 核心文件

- `src/runtime/server.ts`: Local AI Core HTTP/SSE 服务
- `src/runtime/standalone.ts`: standalone 启动入口
- `src/router/workspace-router.ts`: workspace 级路由主入口
- `src/channel/lark/local-core-lark-gateway.ts`: Feishu/Lark 原生通道网关
- `src/channel/weixin/local-core-weixin-gateway.ts`: Weixin 原生通道网关
- `src/acp/local-core-acp-backend.ts`: ACP 子进程桥接与流式事件处理
- `src/acp/store/local-core-acp-store.ts`: SQLite 持久化层 facade
- `src/automation/automation-monitor-service.ts`: 事件监控、provider 订阅/轮询、条件判断与触发执行入口
- `src/scheduler/scheduled-job-application-service.ts`: 定时任务创建、路由解析与 controller/bridge 应用层入口
- `src/scheduler/scheduler-service.ts`: 定时任务调度主入口

## ACP 分层

当前 ACP 子系统按职责拆成四层：

- `src/acp/local-core-acp-transport.ts`
  只负责 ACP 子进程、stdin/stdout、JSON-RPC request/response、pipe failure。
- `src/acp/local-core-acp-turn-coordinator.ts`
  只负责 permission 请求、tool/progress update、preview bridge 事件。
- `src/acp/local-core-acp-session-coordinator.ts`
  只负责 session 容器、`session/load`、`session/new`、run interrupt、异常收尾。
- `src/acp/local-core-acp-response-processor.ts`
  只负责 assistant 最终输出后处理，包括 slash fallback 和 `[CRON_*]` fallback。

`src/acp/local-core-acp-backend.ts` 现在主要做装配：连接 thread API、run 启停与上述各层。

## Scheduler 分层

当前 scheduler 子系统按职责拆成应用层、调度层、执行层和投递层：

- `src/scheduler/scheduled-job-application-service.ts`
  只负责定时任务应用语义：创建/更新输入归一化、从 `platform_thread_bindings` 解析 channel 投递路由、为 controller 和 workspace router bridge 提供统一入口。
- `src/scheduler/scheduled-job-route.ts`
  只负责 platform 与 route 的共享解析规则，包括 `lark:<instanceId>` / `weixin:<instanceId>` 这类实例化 platform 的 base 匹配、instanceId 提取和 route 派生。
- `src/scheduler/scheduler-service.ts`
  只负责轮询、due 判断、并发控制、adapter 选择。
- `src/scheduler/scheduler-run-lifecycle.ts`
  只负责 `scheduled_job_runs` 的状态迁移、delivery 可观测字段和对应 job 状态回写。
- `src/scheduler/scheduled-conversation-executor.ts`
  只负责把一次定时任务转换成一次 conversation execution：注入 channel runtime env、发消息、等 run、取最终 reply。
- `src/scheduler/channel-execution-policy.ts`
  提供 Lark/Weixin 共用的 same-thread / side-thread execution policy，避免平台策略重复实现。
- `src/scheduler/scheduled-bridge-session.ts`
  在定时任务执行期间临时注册 `sessionKey -> channel route`，让 ACP 过程、工具进度、权限卡片和最终回答通过 channel gateway 回传。
- `src/scheduler/local-schedule-adapter.ts`
  只负责本地 thread 定时任务执行，使用 `deliveryMode: 'thread-only'`，不做 channel 投递。
- `src/scheduler/lark-schedule-adapter.ts` / `src/scheduler/weixin-schedule-adapter.ts`
  只负责选择平台执行策略并声明 `deliveryMode: 'bridge-stream'`。adapter 选择按 platform base 匹配，实际回传由 channel gateway 使用 `route.instanceId` 发送，确保多 Lark/Weixin 实例不会串投。

更完整的 scheduled delivery 设计见 [`docs/architecture/scheduled-delivery.md`](../../docs/architecture/scheduled-delivery.md)。

## Automation Monitor 分层

Monitor 子系统和 scheduler 共享“自动发起 ACP 任务并通过 channel 回传”的执行链路，但触发来源不同：scheduler 由时间触发，monitor 由 provider 事件触发。

- `src/automation/automation-monitor-service.ts`
  负责 monitor 创建/更新/删除、provider 订阅、30 秒轮询、条件判断、cooldown、并发控制和事件发布。
- `src/automation/automation-monitor-repository.ts`
  负责把 monitor 应用层访问收敛到 Local Core ACP store。
- `src/automation/condition-evaluator.ts`
  负责安全的条件判断，支持简单比较和受限的 `&&` / `||` 表达式，不执行任意 JS。
- `src/automation/automation-conversation-executor.ts`
  负责把触发事件渲染成 prompt，启动 ACP thread run，并复用 `ScheduledBridgeSession` 通过 channel 回传过程和最终结果。
- `src/acp/store/automation-monitor-store.ts`
  负责 `automation_monitors` 与 `automation_monitor_runs` 持久化。
- `packages/plugin-sdk/src/index.ts`
  定义 `MonitorPlugin` / `MonitorProviderRuntime` 插件协议。内置股票监控只是一个 provider 插件，其他事件源应通过插件扩展。

更完整的 monitor 设计见 [`docs/architecture/automation-monitor.md`](../../docs/architecture/automation-monitor.md)。

## Scheduler Execution Policy

`src/scheduler/execution-policy.ts` 定义了 scheduler 执行策略接口：

- `resolveTarget(job)`
- `beforeExecute(target, job)`
- `afterExecute(target, job)`

当前任务模型支持：

- `executionMode: 'same-thread'`
- `executionMode: 'side-thread'`

`same-thread` 会复用原对话 thread；`side-thread` 会为该 job 复用或创建一个专用的 `[Scheduled:Lark] ...` / `[Scheduled:Weixin] ...` / `[Scheduled] ...` 线程。平台 side-thread 策略仍识别历史 `[Scheduled] ...` 标题，避免老任务升级后重复创建线程。当前默认值仍是 `same-thread`，以保持现有行为兼容。

后续若要继续演进到 side-run 或更复杂的 execution target，应优先扩展 execution policy，而不是把新逻辑继续塞回 adapter 或 scheduler service。

## Scheduler Channel 投递约束

- 创建入口只应通过 `ScheduledJobApplicationService` 解析 platform/route；controller、workspace router bridge 和 CLI 不应各自复制 channel 绑定解析。
- `platform` 可以是 `lark:<instanceId>` 或 `weixin:<instanceId>`；adapter 支持判断必须使用 base platform，投递必须保留 instanceId。
- 从 channel thread 创建任务时，route 来自 `platform_thread_bindings`，包含 chat id、platform user id 和 instance id。
- 明确传入 route 创建任务时，持久化 route 不应绑定旧 ACP thread id；same-thread/side-thread 的执行目标由 execution policy 决定。
- `ScheduledConversationExecutor` 会为定时 ACP 会话注入 `LOCAL_AI_PLATFORM`、`LOCAL_AI_ROUTE_TYPE`、`LOCAL_AI_PLATFORM_INSTANCE_ID`、`LOCAL_AI_CHAT_ID`、`LOCAL_AI_PLATFORM_USER_ID`，让会话内的 channel-aware 工具能投递到当前任务目标。
- Lark/Weixin 定时任务使用 `ScheduledBridgeSession` 走 `bridge-stream`：过程消息、工具进度、权限卡片和最终回答都由现有 channel bridge 回传，不应再由 scheduler adapter 单独发送最终消息。
- `ScheduledBridgeSession` 会在 ACP 执行前先发送 `⏰ <任务描述>` 状态消息，让 channel 用户先知道是哪一个定时任务开始执行。
- `scheduled_job_runs` 同时记录执行状态和 delivery 诊断字段，包括 `deliveryMode`、`deliveryStatus`、`deliveryError`、`lastBridgeEventAt` 和 `platformMessageIds`。这些字段用于排障，不应成为 scheduler 成功判定的唯一依据。

## 对外接口（概览）

- 健康检查：`GET /api/local/v1/health`
- runtime：`/api/local/v1/runtime/*`
- 配置：`/api/local/v1/config*`
- 线程：`/api/local/v1/threads*`
- 知识库：`/api/local/v1/knowledge*`
- Lark 网关：`/api/local/v1/platforms/lark/*`
- Weixin 网关：`/api/local/v1/platforms/weixin/*`
- 事件流：`GET /api/local/v1/events`（SSE）

> 具体路由定义以 `src/runtime/server.ts` 为准。

## 本地开发与验证

在仓库根目录执行：

```bash
pnpm build:electron
pnpm test
```

仅启动本地核心（已构建产物）：

```bash
pnpm start:core
```

开发模式（构建并启动本地核心）：

```bash
pnpm dev:core
```

## 设计约束

- 内部平台类型统一使用 `lark`、`weixin`、`local` 的 base id；channel 多实例使用 `<base>:<instanceId>` 并通过 `scheduled-job-route.ts` 解析
- Local AI Core 为本地线程与事件流的统一入口
- 本仓库默认运行形态为 Local AI Core 单核运行时，不依赖 `cc-connect`
- ACP、scheduler、gateway 三层之间优先通过显式接口协作，不应在单个文件里同时混合 transport、state machine、platform delivery 与持久化状态迁移
