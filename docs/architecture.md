# AgentDock Architecture Facts

This document is the provider-neutral source of truth for AgentDock's system architecture, process boundaries, communication protocols, and data ownership.

For visual diagrams and the interactive L1-L3 Architecture Matrix, see [docs/architecture/overview.md](docs/architecture/overview.md).
For the architecture maintenance policy, see [docs/architecture/maintenance.md](docs/architecture/maintenance.md).
For diagram provider settings, see [docs/architecture/diagram-provider.yaml](docs/architecture/diagram-provider.yaml).
For semantic architecture change history, see [docs/architecture/changes/](docs/architecture/changes/).

---

## 1. System Goals & Context

AgentDock is a hybrid Desktop and Web platform designed to orchestrate local and cloud-based autonomous coding and task agents. It integrates desktop workflow acceleration with enterprise collaboration channels (Lark, WeChat Work), secure sandboxing, and background scheduling.

Key capabilities:
- Multi-agent runtime orchestration via Agent Client Protocol (ACP)
- Secure isolation via Docker / OpenSandbox container runtimes
- Channel gateways bridging team messaging to agent sessions
- Background cron scheduling and automation monitors
- Local knowledge base indexing and retrieval

---

## 2. Process Boundaries & Public Entry Points

```
┌────────────────────────────────────────────────────────┐
│               Electron Shell (electron/)               │
│  - Spawns Local AI Core child process                  │
│  - Hosts BrowserWindow / Native menus / App lifecycle  │
└──────────────────────────┬─────────────────────────────┘
                           │ (Spawns & monitors)
                           ▼
┌────────────────────────────────────────────────────────┐
│           React Renderer (src/ - Port 5173)            │
│  - UI views: Threads, Workspaces, Automations, Skills  │
│  - State: Zustand stores (auth, channel, thread)       │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP REST & WebSocket
                           │ http://127.0.0.1:9831/api/local/v1/*
                           ▼
┌────────────────────────────────────────────────────────┐
│      Local AI Core Daemon (services/local-ai-core/)    │
│  - Port 9831 (HTTP server & WebSocket event bus)       │
│  - Workspace router & thread management                │
│  - ACP session coordinator & agent process spawner     │
│  - Cron scheduler & automation triggers                │
│  - Channel gateways: Lark, WeChat                      │
│  - SQLite local storage & knowledge index              │
└────────────┬─────────────────────────────┬─────────────┘
             │                             │
             │ HTTP NDJSON Bridge          │ Docker / OpenSandbox API
             ▼                             ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ Channel Gateways / Users │  │  Sandbox Container Layer │
│ - Lark Bot Webhooks/WS   │  │  - Agent execution env   │
│ - WeChat Work Inbound    │  │  - Isolated filesystem   │
└──────────────────────────┘  └──────────────────────────┘
```

### Public Entry Points

1. **Desktop App**: Launched via `electron/main.ts`. Spawns `services/local-ai-core/` using Node.js runtime (`ELECTRON_RUN_AS_NODE=1`), polls `http://127.0.0.1:9831/api/local/v1/health`, then opens the renderer window. Note: `electron/preload.ts` exposes no Electron IPC bridge; all frontend-to-backend communication strictly uses HTTP/WebSocket.
2. **Web Admin UI**: Served via Vite or production bundle. Interacts with Local AI Core via `/api/local/v1/*`.
3. **Local AI Core REST & WebSocket API**:
   - `GET /api/local/v1/health`: Daemon health probe
   - `/api/local/v1/workspaces/*`: Workspace configurations and route bindings
   - `/api/local/v1/threads/*`: Conversational threads, messages, and permission requests
   - `/api/local/v1/runs/*`: ACP agent execution runs and streaming events
   - `/api/local/v1/scheduler/*`: Recurring cron jobs and automated delivery
   - `/api/local/v1/automation/hooks/:hookId`: External inbound webhook triggers for event-driven monitors
   - `/api/local/v1/standards/*`: Standard packs catalog, AST security scanning, and installation
   - `/api/local/v1/workspaces/:workspaceId/standards/*`: Workspace standards configuration, materialization, and tech stack detection
   - `/api/local/v1/external/*`: External programmatic integration and per-run SSE streaming
4. **Channel Gateway Webhooks**: Inbound poller and webhooks for enterprise messaging channels (Lark, WeChat Work).
5. **ACP Inbound Bridge**: `lac acp serve --workspace <id>` (`services/local-ai-core/src/cli/acp-cli-handlers.ts`, `services/local-ai-core/src/acp/server/`). An optional local consumer process spawned by ACP clients (e.g. the Zed editor); speaks the Agent Client Protocol agent-side over stdio and drives workspace agents through the existing Local AI Core HTTP+SSE surface (`/threads`, `/threads/:id/messages`, `/runs/:id/interrupt`, `/events`). ACP sessions map to threads in the bound workspace; the daemon itself gains no new route or trust boundary.

---

## 3. Component Responsibilities & Module Boundaries

| Component | Path | Responsibilities | Source Evidence |
|---|---|---|---|
| **Electron Shell** | `electron/` | Native app lifecycle, window creation, background core child process lifecycle management. | `electron/main.ts` |
| **Renderer UI** | `src/` | Single-page application rendering threads, workspaces, automations, and settings using React 19, Zustand stores, and TailwindCSS. | `src/pages/`, `src/store/`, `src/components/` |
| **Local Core Kernel** | `services/local-ai-core/src/kernel/` | Core lifecycle, error domains, configuration management, SQLite database migrations, and telemetry. | `services/local-ai-core/src/kernel/` |
| **Workspace Router** | `services/local-ai-core/src/router/` | Resolves target workspace, model provider, and channel bindings for incoming requests. | `services/local-ai-core/src/router/workspace-router.ts` |
| **ACP and Durable Runtime** | `services/local-ai-core/src/acp/`, `services/local-ai-core/src/agents/pi-durable/` | Core admits thread submissions and routes ordinary agents through ACP. The opt-in Pi Durable path uses one ESM worker/Harness per Core data directory; Core owns approval-gated workspace text writes and the filesystem side effect. | `acp/thread-submission-dispatcher.ts`, `acp/local-core-acp-backend.ts`, `agents/pi-durable/host.ts`, `agents/pi-durable/worker.mts` |
| **ACP Inbound Bridge** | `services/local-ai-core/src/acp/server/` | Optional stdio consumer that exposes workspace agents to external ACP clients (agent-side protocol), translating ACP sessions/prompts onto existing core routes and `stream.updated` bridge events. | `services/local-ai-core/src/acp/server/acp-stdio-server.ts`, `services/local-ai-core/src/cli/acp-cli-handlers.ts` |
| **Channel Gateways** | `services/local-ai-core/src/channel/` | Inbound message polling, signature verification, message normalization, and outbound card rendering for Lark and WeChat. | `services/local-ai-core/src/channel/` |
| **Scheduler** | `services/local-ai-core/src/scheduler/` | Parses cron expressions, triggers scheduled runs, and delivers results to target threads/channels. | `services/local-ai-core/src/scheduler/` |
| **Sandbox Manager**| `services/local-ai-core/src/sandbox/` | Spawns and manages Docker or OpenSandbox containers for isolated code execution. | `services/local-ai-core/src/sandbox/` |
| **Shared Contracts**| `shared/`, `packages/superai-contracts/` | Cross-process type definitions, shared enums, and API interfaces. | `shared/desktop.ts`, `packages/superai-contracts/` |
| **Plugin SDK** | `packages/plugin-sdk/` | Extension contracts and interfaces for Local AI Core plugins. | `packages/plugin-sdk/` |
| **Standards Layer** | `services/local-ai-core/src/standards/` | Multi-scope rule packs (builtin/user/workspace), AST security scan gate (T01-T04), Ponytail decision ladder, conditional rule rendering, and non-destructive marker materialization into AGENTS.md/CLAUDE.md. | `services/local-ai-core/src/standards/` |

---

## 4. Dependency Direction & Protocol Contracts

1. **One-Way Inward Dependency**:
   - `src/` (Renderer) depends on `shared/` contracts and `src/api/` client. It does not import Electron main or Local AI Core internals.
   - `electron/` depends on `shared/` contracts. It launches Local AI Core as an isolated Node child process.
   - `services/local-ai-core/` depends on `packages/*` and `shared/`. It does not import renderer code.
   - Shared contracts (`shared/`, `packages/*`) have zero dependencies on higher layers.
2. **Communication Protocols**:
   - UI to Local AI Core: HTTP REST + WebSocket (`ws://127.0.0.1:9831/api/local/v1/events`).
   - Local AI Core to Agents: ACP (Agent Client Protocol) over stdio or HTTP NDJSON bridge.
   - Local AI Core to Pi Durable: a private JSON-lines protocol over worker stdio; the worker exclusively owns the Pi SQLite database. Correlated write requests return through this protocol to Core's per-write approval and filesystem commit path.
   - External Systems to Local AI Core: HTTP REST + Server-Sent Events (SSE).

---

## 5. Data Ownership & Storage

- **Core SQLite (`runtime/local-core.db`)**: Owns workspaces, thread histories, transactional submissions, permission lifecycle, run results, runtime snapshot revisions/partials, delivery outbox attempts, and scheduler/channel state.
- **Pi Durable SQLite (`runtime/pi-durable.sqlite`)**: Optional and separate, one global database per Core user-data directory. One ESM worker owns one Harness and multiplexes independent thread Conversations. Core submissions remain the business identity and stable upstream request keys reconcile both stores. A kernel-held local socket lock rejects a second owner. Node executor capability (upstream engine requirement plus `node:sqlite`) is checked before worker startup. The worker requests each workspace text write through a private correlated approval protocol; Core persists/audits the approval, verifies path and file baseline, and performs the atomic filesystem update. Pending write approvals expire on restart and tool side effects are never replayed automatically. Delete, shell, MCP, and sandbox tools remain unavailable.
- **Runtime snapshots**: Core exposes an atomic REST baseline and versioned SSE watch. Reconnect subscribes before reading the baseline and uses bounded buffering. Partial assistant text is coalesced, and stale ACP approvals expire on process recovery.
- **Delivery outbox**: Core stores final report content and immutable destinations separately from Agent execution. A channel send is delivered only after a confirmed platform acknowledgement; ambiguous results remain unknown until an audited operator decision.
- **Renderer Zustand Stores**: Ephemeral presentation and session state (active workspace, current thread, UI theme, connection status).
- **Workspace Repositories**: Source code and local configuration files owned by the user in the host filesystem or mounted inside sandboxes.

---

## 6. Architecture Matrix & Specifications

The L1-L3 Architecture Matrix is defined in typed JSON specifications validated via `pnpm lint:arch` with Archify:

- **L1 System Architecture**: [docs/architecture/system-architecture.json](docs/architecture/system-architecture.json)
- **L2 ACP Session Flow (Sequence)**: [docs/architecture/acp-session-flow.sequence.json](docs/architecture/acp-session-flow.sequence.json)
- **L2 Scheduled Delivery (Workflow)**: [docs/architecture/scheduled-delivery-workflow.json](docs/architecture/scheduled-delivery-workflow.json)
- **L2 Skill Router (Workflow)**: [docs/architecture/skill-router.workflow.json](docs/architecture/skill-router.workflow.json)
- **L3 Agent Run Lifecycle (State Machine)**: [docs/architecture/agent-run.lifecycle.json](docs/architecture/agent-run.lifecycle.json)

For navigation across specs, dual-theme images, and interactive HTML canvases, visit [docs/architecture/overview.md](docs/architecture/overview.md).

## AgentDock Mesh Device Plane

Local AI Core owns the Mesh device registry and remote tool request lifecycle in its existing SQLite database (`mesh_nodes`, `mesh_executions`). `MeshGateway` attaches authenticated administration routes and device-authenticated outbound WebSocket sessions to the Core HTTP server. `agentdock-node` executes bounded read-only file capabilities and optional commands with local policy; React and Core SDK provide device management and request inspection. The bundled web server forwards the Mesh WebSocket upgrade.

Mesh requests have their own identities and terminal history. They do not replace ACP sessions or alter workspace agent-task routing. Disconnect/restart marks unresolved operations interrupted without replay; cancellation and timeout may leave an uncertain remote outcome. Pairing is single-use and expiring, device credentials are retained only as hashes by Core, revocation invalidates active connections, and shell requires server and node opt-in. See [Mesh boundaries and usage](architecture/mesh.md) and [the semantic change record](architecture/changes/2026-10-03-agentdock-mesh.md).

The README and overview use the configured Mermaid fallback. Pi Durable has a separate global SQLite per Core data directory; the current implementation and provider artifact evidence are recorded in [the durable execution change](architecture/changes/2026-10-03-durable-execution.md).
