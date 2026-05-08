# AgentDock Architecture

## Summary

AgentDock now runs as a Local AI Core-first desktop app:

- Electron is only the desktop shell
- Local AI Core owns runtime, threads, streaming, knowledge, scheduler state, and native channel ingress
- The renderer talks to Local AI Core APIs directly or through the Electron shell

There is no `cc-connect` runtime, management API, or bridge compatibility path in the active architecture.

## Top-Level Flow

```mermaid
flowchart LR
  U[User] --> R[React Renderer]
  R --> DP[Desktop API Provider]
  DP -->|electron| E[Electron Shell]
  DP -->|local_core| C[Local AI Core HTTP/SSE]
  E --> C
  C --> ACP[ACP Agent Backends]
  C --> KB[Knowledge Provider]
  C --> SCHED[Scheduler]
  C --> CH[Native Channel Gateways]
  SCHED --> ACP
  SCHED --> CH
```

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
- owns thread routing, SQLite persistence, ACP streaming, scheduler execution, and channel ingress/delivery

Local AI Core keeps scheduler responsibilities split by lifecycle:

- `ScheduledJobApplicationService` resolves scheduled job create/update input and derives channel routes from thread bindings.
- `SchedulerService` owns due polling, run concurrency, and adapter selection.
- `ScheduledConversationExecutor` turns a scheduled job into an ACP conversation and injects the channel runtime environment for the run.
- `channel-execution-policy.ts` resolves same-thread or side-thread targets for channel jobs.
- `ScheduledBridgeSession` binds the scheduled ACP session to the channel route so Lark/Weixin process updates, tool progress, permission cards, and final replies stream through channel gateways.
- Platform scheduler adapters select delivery mode. Local uses `thread-only`; Lark/Weixin use `bridge-stream` while preserving instance ids for delivery.

See [Scheduled Delivery Architecture](scheduled-delivery.md) for the full route and delivery model.

### Shared Packages

- `packages/contracts`: shared API and data contracts
- `packages/core-sdk`: Local AI Core browser client
- `packages/knowledge-api`: knowledge abstraction and `ai_vector` implementation

## Runtime Model

The renderer uses one of two local providers:

- `electron`: desktop shell is available
- `local_core`: direct Local AI Core access is available

Both providers target the same Local AI Core API surface.
