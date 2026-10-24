# AgentDock Architecture Facts

This document is the provider-neutral source of truth for AgentDock's system architecture, process boundaries, communication protocols, and data ownership.

For visual diagrams and the interactive L1-L3 Architecture Matrix, see [architecture overview](architecture/overview.md).
For the architecture maintenance policy, see [architecture maintenance policy](architecture/maintenance.md).
For diagram provider settings, see [diagram provider settings](architecture/diagram-provider.yaml).
For semantic architecture change history, see [architecture change history](architecture/changes/).

---

## 1. System Goals & Context

AgentDock is a hybrid Desktop and Web platform designed to orchestrate local and cloud-based autonomous coding and task agents. It integrates desktop workflow acceleration with enterprise collaboration channels (Lark, WeChat Work), secure sandboxing, and background scheduling.

Key capabilities:
- Multi-agent runtime orchestration via Agent Client Protocol (ACP)
- Secure isolation via Docker / OpenSandbox container runtimes
- Channel gateways bridging team messaging to agent sessions
- Butler bot coordination across explicitly configured channel bots
- Background cron scheduling and automation monitors
- Local knowledge base indexing and retrieval

---

## 2. Process Boundaries & Public Entry Points

```
┌────────────────────────────────────────────────────────┐
│            Electron Shell (apps/desktop/)              │
│  - Spawns AgentDock Daemon child process               │
│  - Hosts BrowserWindow / Native menus / App lifecycle  │
└──────────────────────────┬─────────────────────────────┘
                           │ (Spawns & monitors)
                           ▼
┌────────────────────────────────────────────────────────┐
│         React Renderer (apps/web/ - Port 5173)         │
│  - UI views: Threads, Workspaces, Automations, Skills  │
│  - State: Zustand stores (auth, channel, thread)       │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP REST & WebSocket
                           │ http://127.0.0.1:9831/api/local/v1/*
                           ▼
┌────────────────────────────────────────────────────────┐
│         AgentDock Daemon (apps/daemon/)                │
│  - Port 9831 (HTTP server & WebSocket event bus)       │
│  - Workspace router & thread management                │
│  - ACP session coordinator & agent process spawner     │
│  - Butler Channel entry, LAC dispatch & durable checks │
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

1. **Desktop App**: Launched via `apps/desktop/src/main.ts`. Spawns `apps/daemon/` using Node.js runtime (`ELECTRON_RUN_AS_NODE=1`), polls `http://127.0.0.1:9831/api/local/v1/health`, then opens the renderer window. Note: `apps/desktop/src/preload.ts` exposes no Electron IPC bridge; all frontend-to-backend communication strictly uses HTTP/WebSocket via `@agentdock/sdk`.
2. **Web Admin UI**: Served via Vite or production bundle from `apps/web/`. Interacts with AgentDock Daemon via `/api/local/v1/*`.
3. **AgentDock Daemon REST & WebSocket API**:
   - `GET /api/local/v1/health`: Daemon health probe
   - `/api/local/v1/workspaces/*`: Workspace configurations and route bindings
   - `/api/local/v1/threads/*`: Conversational threads, messages, and permission requests
   - `/api/local/v1/runs/*`: ACP agent execution runs and streaming events
   - `/api/local/v1/scheduler/*`: Recurring cron jobs and automated delivery
   - `/api/local/v1/automation/hooks/:hookId`: External inbound webhook triggers for event-driven monitors
   - `/api/local/v1/standards/*`: Standard packs catalog, AST security scanning, and installation
   - `/api/local/v1/workspaces/:workspaceId/standards/*`: Workspace standards configuration, materialization, and tech stack detection
   - `/api/local/v1/external/*`: External programmatic integration and per-run SSE streaming
   - `/api/local/v1/butler/*`: Lark bot discovery, manager/managed bot profile, owner-scoped task operations, and worker reports protected by Core-issued thread/run capabilities
4. **Channel Gateway Webhooks**: Inbound poller and webhooks for enterprise messaging channels (Lark, WeChat Work).
5. **ACP Inbound Bridge**: `lac acp serve --workspace <id>` (`apps/daemon/src/cli/acp-cli-handlers.ts`, `apps/daemon/src/acp/server/`). An optional local consumer process spawned by ACP clients (e.g. the Zed editor); speaks the Agent Client Protocol agent-side over stdio and drives workspace agents through the existing AgentDock Daemon HTTP+SSE surface (`/threads`, `/threads/:id/messages`, `/runs/:id/interrupt`, `/events`). ACP sessions map to threads in the bound workspace; the daemon itself gains no new route or trust boundary.
6. **Remote Workspace LAC Control**: Remote Mesh workspace launches include a host-side stdio MCP server and a restricted `lac` Shell compatibility route. Both reuse the AgentDock Daemon CLI handlers through one allowlisted dispatcher with launch workspace/thread context. Ordinary Shell commands continue to use the Mesh node. The MCP exposes read queries; the standalone CLI route supports selected no-file memory/scheduler/monitor/automation operations and scoped Butler task actions, including a worker report bound to its active run.

---

## 3. Component Responsibilities & Module Boundaries

| Component | Path | Responsibilities | Source Evidence |
|---|---|---|---|
| **Electron Shell** | `apps/desktop/` | Native app lifecycle, window creation, background daemon child process lifecycle management. | `apps/desktop/src/main.ts` |
| **Renderer UI** | `apps/web/` | Single-page application rendering threads, workspaces, automations, and settings using React 19, Zustand stores, and TailwindCSS. | `apps/web/src/pages/`, `apps/web/src/store/`, `apps/web/src/components/` |
| **Daemon Kernel** | `apps/daemon/src/kernel/` | Core lifecycle, error domains, configuration management, SQLite database migrations, and telemetry. | `apps/daemon/src/kernel/` |
| **Workspace Router** | `apps/daemon/src/router/` | Resolves target workspace, model provider, and channel bindings for incoming requests. | `apps/daemon/src/router/workspace-router.ts` |
| **Butler Orchestration** | `apps/daemon/src/butler/`, `apps/daemon/src/acp/store/butler-store.ts` | Manages the Butler Channel identity and configured worker bot bindings. New `core` tasks dispatch directly to the saved workspace runtime through WorkspaceRouter; supported agent commands require a run-scoped Core capability. Core persists goal/delegation/operation state, checkpoints, reports, check schedules and leases, owner principals, and task-scoped notifications; orphan recovery is limited to the matching owner principal. Legacy `channel` tasks retain app-scoped bot-to-bot group delivery. A definite HTTP 400 on an initial Channel submission is stored as failed; ambiguous failures remain unknown. Before a profile change, recovery closes only persisted HTTP 400 submissions with no run or message reference, using local ledger updates only. | `butler/butler-service.ts`, `butler/butler-dispatcher.ts`, `runtime/channel-service.ts`, `acp/store/butler-store.ts` |
| **ACP and Durable Runtime** | `apps/daemon/src/acp/`, `apps/daemon/src/agents/pi-durable/` | Core admits thread submissions and routes ordinary agents through ACP. The opt-in Pi Durable path uses one ESM worker/Harness per Core data directory; Core owns approval-gated workspace text writes and the filesystem side effect. | `acp/thread-submission-dispatcher.ts`, `acp/local-core-acp-backend.ts`, `agents/pi-durable/host.ts`, `agents/pi-durable/worker.mts` |
| **ACP Inbound Bridge** | `apps/daemon/src/acp/server/` | Optional stdio consumer that exposes workspace agents to external ACP clients (agent-side protocol), translating ACP sessions/prompts onto existing core routes and `stream.updated` bridge events. | `apps/daemon/src/acp/server/acp-stdio-server.ts`, `apps/daemon/src/cli/acp-cli-handlers.ts` |
| **Remote LAC Control** | `apps/daemon/src/execution/remote-mesh/` | Routes allowlisted standalone `lac` commands and structured read-only MCP queries to host CLI handlers for remote-workspace agents; preserves device execution for ordinary Shell commands. | `lac-control.ts`, `lac-control-mcp-server.ts`, `agentdock-mesh-shell.ts` |
| **Channel Gateways** | `apps/daemon/src/channel/` | Inbound message polling, signature verification, sender normalization, and outbound card/text delivery for Lark and WeChat; Lark routes explicitly mentioned bot-authored group messages and resolves each mention from the sender application's group-bot roster. | `apps/daemon/src/channel/lark/outbound-transport.ts`, `apps/daemon/src/channel/lark/local-core-lark-gateway.ts` |
| **Scheduler** | `apps/daemon/src/scheduler/` | Parses cron expressions, triggers scheduled runs, and delivers results to target threads/channels. | `apps/daemon/src/scheduler/` |
| **Sandbox Manager**| `apps/daemon/src/sandbox/` | Spawns and manages Docker or OpenSandbox containers for isolated code execution. | `apps/daemon/src/sandbox/` |
| **Shared Contracts**| `packages/contracts/` | Cross-process type definitions, desktop models, shared enums, and API interfaces (`@agentdock/contracts`). | `packages/contracts/src/` |
| **Plugin SDK** | `packages/plugin-sdk/` | Extension contracts and interfaces for AgentDock Daemon plugins (`@agentdock/plugin-sdk`). | `packages/plugin-sdk/src/` |
| **Knowledge Engine** | `packages/knowledge/` | Knowledge base SQLite store, indexing, and vector search abstractions (`@agentdock/knowledge`). | `packages/knowledge/src/` |
| **Client SDK** | `packages/sdk/` | Client SDK for AgentDock Daemon REST, WebSocket, and SSE APIs (`@agentdock/sdk`). | `packages/sdk/src/` |
| **Standards Layer** | `apps/daemon/src/standards/` | Multi-scope rule packs (builtin/user/workspace), AST security scan gate (T01-T04), Ponytail decision ladder, conditional rule rendering, and non-destructive marker materialization into AGENTS.md/CLAUDE.md. | `apps/daemon/src/standards/` |

---

## 4. Dependency Direction & Protocol Contracts

1. **One-Way Inward Dependency**:
   - `apps/web/` (Renderer) depends on `packages/contracts/` and `packages/sdk/`. It does not import Electron main or Daemon internals.
   - `apps/desktop/` depends on `packages/contracts/`. It launches AgentDock Daemon as an isolated Node child process.
   - `apps/daemon/` depends on `packages/*`. It does not import renderer code or desktop shell code.
   - Shared libraries (`packages/*`) have zero dependencies on application shells (`apps/*`).
2. **Communication Protocols**:
   - UI to AgentDock Daemon: HTTP REST + WebSocket (`ws://127.0.0.1:9831/api/local/v1/events`).
   - AgentDock Daemon to Agents: ACP (Agent Client Protocol) over stdio or HTTP NDJSON bridge.
   - Remote-workspace LAC access: a dedicated stdio MCP server and the transparent Shell proxy call the host LAC dispatcher; dispatcher requests use the host-configured Local AI Core API URL and launch context. Ordinary remote Shell traffic uses `POST /api/local/v1/mesh/shell/execute` with a signed, expiring node-scoped token.
   - Butler `core` transport: Core dispatches a worker operation to the saved workspace thread through WorkspaceRouter; a report is accepted only with a Core-issued capability whose thread/run match an active Butler operation. `lac` is a command surface into Core, not a host-shell proxy. Selected standalone Butler commands may pass through the remote Mesh LAC dispatcher; ordinary remote Shell remains node-bound. This does not sandbox arbitrary local Shell or raw localhost API calls.
   - Butler legacy `channel` transport: Lark native group text messages with an explicit `<at user_id="ou_…">` mention. Open IDs are app-scoped: Core resolves the exact group-visible bot name under the sending runtime's app credentials before delivery and resolves the expected sender under the receiving runtime's app credentials before accepting a callback. The bot roster lookup is cached by `(appId, chatId)` for 30 seconds and fails closed on missing or ambiguous names. An HTTP 400 response to an initial submission is a definite rejection; other transport failures keep the delivery unknown and are never automatically retried. Profile-save recovery locally closes only an exact persisted HTTP 400 record without a run or platform message ID; it sends no follow-up or cancellation message.
   - Local AI Core to Pi Durable: a private JSON-lines protocol over worker stdio; the worker exclusively owns the Pi SQLite database. Correlated write requests return through this protocol to Core's per-write approval and filesystem commit path.
   - External Systems to Local AI Core: HTTP REST + Server-Sent Events (SSE).

---

## 5. Data Ownership & Storage

- **Core SQLite (`runtime/local-core.db`)**: Owns workspaces, thread histories, transactional submissions, permission lifecycle, run results, runtime snapshot revisions/partials, delivery outbox attempts, scheduler/channel state, and Butler task, delegation, operation, worker checkpoint/report, due-check lease, callback-deduplication and acceptance records.
- **Pi Durable SQLite (`runtime/pi-durable.sqlite`)**: Optional and separate, one global database per Core user-data directory. One ESM worker owns one Harness and multiplexes independent thread Conversations. Core submissions remain the business identity and stable upstream request keys reconcile both stores. A kernel-held local socket lock rejects a second owner. Node executor capability (upstream engine requirement plus `node:sqlite`) is checked before worker startup. The worker requests each workspace text write through a private correlated approval protocol; Core persists/audits the approval, verifies path and file baseline, and performs the atomic filesystem update. Pending write approvals expire on restart and tool side effects are never replayed automatically. Delete, shell, MCP, and sandbox tools remain unavailable.
- **Runtime snapshots**: Core exposes an atomic REST baseline and versioned SSE watch. Reconnect subscribes before reading the baseline and uses bounded buffering. Partial assistant text is coalesced, and stale ACP approvals expire on process recovery.
- **Delivery outbox**: Core stores final report content and immutable destinations separately from Agent execution. A channel send is delivered only after a confirmed platform acknowledgement; ambiguous results remain unknown until an audited operator decision.
- **Renderer Zustand Stores**: Ephemeral presentation and session state (active workspace, current thread, UI theme, connection status).
- **Workspace Repositories**: Source code and local configuration files owned by the user in the host filesystem or mounted inside sandboxes.

---

## 6. Architecture Matrix & Specifications

The L1-L3 Architecture Matrix is defined in typed JSON specifications. `pnpm lint:arch` always checks their JSON syntax and runs Archify Showcase validation when the optional CLI is installed:

- **L1 System Architecture**: [system architecture spec](architecture/system-architecture.json)
- **L2 ACP Session Flow (Sequence)**: [ACP session flow](architecture/acp-session-flow.sequence.json)
- **L2 Scheduled Delivery (Workflow)**: [scheduled delivery workflow](architecture/scheduled-delivery-workflow.json)
- **L2 Skill Router (Workflow)**: [skill router workflow](architecture/skill-router.workflow.json)
- **L2 Butler Orchestration (Workflow)**: [Butler orchestration workflow](architecture/butler-orchestration.workflow.json)
- **L2 Remote Workspace LAC Control (Workflow)**: [remote LAC control workflow](architecture/remote-lac-control.workflow.json)
- **L3 Agent Run Lifecycle (State Machine)**: [agent run lifecycle](architecture/agent-run.lifecycle.json)

For navigation across specs, dual-theme images, and interactive HTML canvases, visit [architecture overview](architecture/overview.md).

## AgentDock Mesh Device Plane

Local AI Core owns the Mesh device registry and remote tool request lifecycle in its existing SQLite database (`mesh_nodes`, `mesh_executions`). `MeshGateway` attaches administrator-authenticated management routes and device-authenticated outbound WebSocket sessions to the Core HTTP server. When Mesh is enabled, `GET /mesh/nodes` is readable without a Mesh admin token; it exposes node IDs, labels, platform, capabilities and presence to callers that can reach the route. `POST /mesh/shell/execute` instead requires a Core-signed, expiring node-scoped token; other management operations (including peer discovery `/mesh/tailscale/status` and device registration `/mesh/tailscale/bind`) remain administrator-authenticated. Discovered Tailscale devices are registered as offline inventory records (`node:ts:<sanitized-name>`); dispatching executions still requires the target device to establish an authenticated WebSocket session via `agentdock-node pair/connect`. `agentdock-node` executes bounded read-only file capabilities and optional commands with local policy; React and Core SDK provide the node overview and optional administrative device binding when supplied with a management token. The bundled web server forwards the Mesh WebSocket upgrade.

Mesh requests have their own identities and terminal history. They do not replace ACP sessions or alter workspace agent-task routing. Disconnect/restart marks unresolved operations interrupted without replay; cancellation and timeout may leave an uncertain remote outcome. Pairing is single-use and expiring, device credentials are retained only as hashes by Core, revocation invalidates active connections, and shell requires server and node opt-in. Remote-workspace shell calls use a Core-signed expiring bearer limited by the gateway to the launch node and `shell.exec`; the global Mesh administrator token is removed from the agent environment. The LAC dispatcher allows only listed no-file CLI operations and never evaluates a raw Shell string on the host. See [Mesh boundaries and usage](architecture/mesh.md), [the original Mesh change record](architecture/changes/2026-10-03-agentdock-mesh.md), and [the remote LAC change record](architecture/changes/2026-10-12-remote-lac-routing.md).

The README and overview use the configured inline Mermaid mode. Archify L1 validation and interactive/static export replacement were rerun during the Android screen-lease change; the current diagram includes the Device Plane. Detailed screen behavior is captured in the L2 mobile-screen workflow.

Pi Durable has a separate global SQLite per Core data directory; the current implementation and provider artifact evidence are recorded in [the durable execution change](architecture/changes/2026-10-03-durable-execution.md).

## Android Screen Lease

The Android node operates as an All-in-One native APK (`agentdock-a11y`) embedding a direct outbound WebSocket Mesh client (eliminating device-loopback HTTP and listening ports on 127.0.0.1:19832). Commands (`mobile-ui`, `mobile-apps`, `termux-*`) and screen leases are dispatched in-process. `mobile-ui screen` (or screen API) reports screen/keyguard/owner state and manages acquire/renew/release with an owner. Actual ACP runId owns the lease: Core invokes existing executeMesh before prompt, renews every 30 seconds with a 120-second monotonic device expiry, and stops/releases on finalization, cancellation, transport close and shutdown. Ordinary UI calls validate unlocked state without creating manual holds. Manual CLI commands use a separate default owner. Missing legacy endpoints cannot provide managed keep-awake; other failures stop the managed run. Renewal cannot recreate an expired or cleared owner. Network loss may prevent release delivery; local expiry bounds recovery. Multiple owners prevent cross-run release, not simultaneous UI isolation.

ScreenController owns one non-focusable, non-touchable TYPE_ACCESSIBILITY_OVERLAY with FLAG_KEEP_SCREEN_ON. Canvas status/edge feedback and short target ripples do not generate input or renew leases. Accessibility descendants are excluded; OS screenshots may include the layer. Main-thread dispatch serializes UI effects and ScreenLease owner deadlines. Owner release/expiry preserves remaining owners; screen-off/local user stop/service teardown clear all. Process death removes OS-owned windows. Secure unlock stays user-owned; no global timeout settings, ADB dependency or durable screen state are added. HyperOS touch/focus and display behavior require separate physical-device verification. NodeCatalog indices remain aligned across dump/click/input.

Evidence: `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/`, `apps/daemon/src/mesh/mobile-ui/`, ACP backend lifecycle hooks and remote device instructions. See [screen flow](architecture/mobile-screen.workflow.html) and [session change record](architecture/changes/2026-10-04-android-a11y-mesh-client.md).
