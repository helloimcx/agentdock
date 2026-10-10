# AgentDock Architecture

## Summary

AgentDock now runs as a Local AI Core-first desktop app:

- Electron is only the desktop shell
- Local AI Core owns runtime, threads, streaming, knowledge, scheduler state, native channel ingress, sandbox launch, and external run mappings
- The renderer talks to Local AI Core APIs directly or through the Electron shell
- External systems can use Local AI Core APIs directly without driving renderer or Electron

There is no `cc-connect` runtime, management API, or bridge compatibility path in the active architecture.

架构事实与治理规范：
- 架构事实与系统边界：[docs/architecture.md](../architecture.md)
- 架构维护策略：[docs/architecture/maintenance.md](maintenance.md)
- 图表 Provider 配置：[docs/architecture/diagram-provider.yaml](diagram-provider.yaml)
- 语义变更历史：[docs/architecture/changes/](changes/)

## Top-Level Flow

```mermaid
flowchart LR
  electron[Electron desktop shell] -->|Start| api[Local AI Core API]
  renderer[React / Web and Core SDK] -->|REST / SSE| api
  channels[Lark / Weixin] --> api
  external[External clients] --> api
  api --> kernel[Core kernel and workspace router]
  kernel --> sqlite[(SQLite)]
  kernel --> acp[ACP session runtime]
  kernel --> scheduler[Scheduler / Automation]
  scheduler --> acp
  acp --> agents[Local Pi / Codex / Claude / Hermes]
  kernel -->|稳定提交身份| durable[可选 Pi Durable worker]
  durable --> pidb[(Core 数据目录内的单一 pi-durable.sqlite)]
  durable -->|OpenAI 兼容 HTTPS| provider[已配置模型服务]
  acp --> sandbox[OpenSandbox]
  api -->|Public read-only node list; admin token for management| mesh[Mesh Gateway / Dispatcher]
  mesh --> kernel
  nodes[Mac / Linux / Windows / Android A11y nodes] -->|Outbound WebSocket: heartbeat / result| mesh
  mesh -->|Execute / cancel| nodes
  nodes -.->|Run-owned screen lease| screen[Visible status and target feedback]
```

Pi Durable 通过 Local AI Core 的单一 worker 接入；所有 Durable threads 共用一个 Harness 和 `runtime/pi-durable.sqlite`，每个 thread 保持独立 Conversation。工作区写入经 Core 的逐次审批、路径与基线校验后由 Core 原子落盘；shell、删除、MCP、sandbox 仍不可用。详细边界见[架构事实](../architecture.md)、[持久执行记录](changes/2026-10-03-durable-execution.md)和[写入审批变更](changes/2026-10-04-pi-durable-write-approval.md)。

## 架构资产矩阵 (Architecture-as-Code Matrix)

AgentDock 采用 Archify 建立多层活文档架构资产矩阵，并通过 `pnpm lint:arch` 在持续集成中严格校验：

| 层级 | 领域 / 模块 | 图表类型 | 交付物 (HTML / 图像) | 规范源文件 (JSON) | 对应设计文档 |
|---|---|---|---|---|---|
| **L1 全局系统** | 端到端系统架构与 Mesh | `architecture` | [交互全景图](system-architecture.html) · [浅色图](system-architecture.light.png) · [深色图](system-architecture.dark.png) | [`system-architecture.json`](system-architecture.json) | [架构总览](overview.md) |
| **L2 核心流程** | 定时调度与渠道主动投递 | `workflow` | [调度工作流](scheduled-delivery-workflow.html) · [浅色图](scheduled-delivery-workflow.light.png) · [深色图](scheduled-delivery-workflow.dark.png) | [`scheduled-delivery-workflow.json`](scheduled-delivery-workflow.json) | [定时投递架构](scheduled-delivery.md) |
| **L2 核心流程** | ACP 会话与沙箱桥接时序 | `sequence` | [通信时序图](acp-session-flow.html) · [浅色图](acp-session-flow.light.png) · [深色图](acp-session-flow.dark.png) | [`acp-session-flow.sequence.json`](acp-session-flow.sequence.json) | [ACP 协议运行时](acp-protocol.md) |
| **L2 核心流程** | 确定性技能路由与工具索引 | `workflow` | [路由工作流](skill-router.html) · [浅色图](skill-router.light.png) · [深色图](skill-router.dark.png) | [`skill-router.workflow.json`](skill-router.workflow.json) | [Core 内核与插件](local-core-kernel.md) |
| **L3 状态模型** | Agent Run 执行状态机 | `lifecycle` | [状态转移图](agent-run-lifecycle.html) · [浅色图](agent-run-lifecycle.light.png) · [深色图](agent-run-lifecycle.dark.png) | [`agent-run.lifecycle.json`](agent-run.lifecycle.json) | [状态所有权](state-ownership.md) |
| **L2 持久执行** | 提交、delivery outbox、运行快照、Pi Durable 与逐次写入审批 | `workflow` | [持久执行流程](durable-execution-workflow.html) · [浅色图](durable-execution-workflow.light.png) · [深色图](durable-execution-workflow.dark.png) | [`durable-execution.workflow.json`](durable-execution.workflow.json) | [持久执行记录](changes/2026-10-03-durable-execution.md) · [写入审批变更](changes/2026-10-04-pi-durable-write-approval.md) |


## Mesh Device Plane

[Mesh](mesh.md) describes Core-owned device pairing and request history, outbound node connections, read-only file capabilities and explicitly enabled command execution. The Mesh page reads node metadata without a Mesh admin token; pairing, revocation, execution and request history remain protected. Remote tool requests do not change ACP run routing.

## Main Layers

### Renderer

- lives in `src/`
- renders Dashboard, Workspace, Threads, Knowledge
- consumes Local AI Core runtime and SSE events

### Electron

- lives in `electron/`
- opens the desktop window
- starts Local AI Core as a local companion process
- does not own chat routing or platform gateway logic

### Local AI Core

- lives in `services/local-ai-core/`
- exposes `/api/local/v1/*`
- owns thread routing, SQLite persistence, ACP streaming, scheduler execution, channel ingress/delivery, sandbox launch, coding standards materialization, and external API mappings
- provides multi-scope rule pack loading, security scan gates (T01-T04), Ponytail 5-level decision ladder rendering, and non-destructive materialization into target instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`)

Local AI Core exposes external run APIs under `/api/local/v1/external/*`:

- `POST /external/projects` creates or reuses an external workspace mapping.
- `POST /external/runs` ensures the workspace/thread, sends the prompt, and returns the run id and per-run SSE URL.
- `GET /external/runs/:runId/events` streams the run snapshot and bridge updates for that run.

Cloud sandbox mode is configured on projects and materialized at runtime:

- sandbox providers select OpenSandbox connection details and auth env.
- runtime images select the agent ACP image, bridge transport, ports, and mount paths.
- Local AI Core mounts workspace and agent state, starts the sandbox through OpenSandbox, and communicates with the container through HTTP NDJSON ACP.

Local AI Core keeps scheduler responsibilities split by lifecycle:

- `ScheduledJobApplicationService` resolves scheduled job create/update input and derives channel routes from thread bindings.
- `SchedulerService` owns due polling, run concurrency, and adapter selection.
- `ScheduledConversationExecutor` turns a scheduled job into an ACP conversation and injects the channel runtime environment for the run.
- `channel-execution-policy.ts` resolves same-thread or side-thread targets for channel jobs.
- `ScheduledBridgeSession` binds the scheduled ACP session to the channel route so Lark/Weixin process updates, tool progress, permission cards, and final replies stream through channel gateways.
- Platform scheduler adapters select delivery mode. Local uses `thread-only`; Lark/Weixin use `bridge-stream` while preserving instance ids for delivery.

See [Scheduled Delivery Architecture](scheduled-delivery.md) for the full route and delivery model.

See [Cloud Sandbox And External Agent API](cloud-sandbox-and-external-api.md) for sandbox launch, external workspace mapping, and per-run SSE details.

### Shared Packages

- `packages/contracts`: shared API and data contracts
- `packages/core-sdk`: Local AI Core browser client
- `packages/knowledge-api`: knowledge abstraction and noop fallback runtime
- `packages/plugin-sdk`: plugin, agent runtime, channel, scheduler, monitor, and sandbox launch contracts

## Runtime Model

The renderer uses one of two local providers:

- `electron`: desktop shell is available
- `local_core`: direct Local AI Core access is available

Both providers target the same Local AI Core API surface.

### Android Mobile Screen Lifecycle

[L2 Android screen flow](mobile-screen.workflow.html) ([typed source](mobile-screen.workflow.json)) records task-owned acquisition, Core heartbeat and device-local cleanup. ACP runPrompt owns the lifecycle through an independent screen coordinator and existing executeMesh transport; this adds no persisted state or scheduler/skill-router changes. [Session change record](changes/2026-10-04-mobile-screen-session.md) records the ownership and visible feedback upgrade.
