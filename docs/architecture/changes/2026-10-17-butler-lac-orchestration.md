# 2026-10-17 — 管家 LAC 内部委派与持续跟踪

- Status: Core/LAC implementation, run-scoped capabilities, cancellation settlement, owner-thread recovery, and the confirmed Butler renderer are implemented; automated validation and independent review are complete. Real Feishu/Ubuntu/fnOS validation and formal release remain pending. Production configuration and running server were not changed.
- Architecture Impact: Required.
- Base revision: `46a60fb`.
- Provider: Archify; current sources are [L1 system architecture](../system-architecture.json) and [Butler workflow](../butler-orchestration.workflow.json). Stable render outputs are linked from the [architecture overview](../overview.md).
- [Specification](../../specs/2026-10-17-butler-lac-orchestration.md) · [Plan and delivery status](../../plans/2026-10-17-butler-lac-orchestration.md) · [Butler architecture facts](../butler-orchestration.md).
- Prior semantic records: [2026-10-16 app-scoped Lark mentions](2026-10-16-butler-app-scoped-lark-mentions.md) and [2026-10-13 concrete bot management](2026-10-13-butler-channel-bot-management.md).

## Semantic delta

| Before (`46a60fb`) | Implemented in this branch |
| --- | --- |
| Butler tasks dispatched to a managed Lark bot through a shared group; the callback then started the target workspace agent. | `transport=core` dispatches the worker operation directly to the configured bot's captured workspace execution binding through WorkspaceRouter. The legacy `channel` transport remains available, and a task keeps its selected transport. |
| Butler setup required connected managed bots, a shared group chat, and both app-perspective bot names. | Core transport still requires a connected manager Channel, but does not require managed-bot Channel connectivity or shared-group fields. Managed bot identity remains an explicit allowlisted selector; workspace/runtime/agent/provider are stored separately and revalidated. |
| A completed ACP submission completed the business delegation. | Core worker completion settles one Operation only. The worker reports a final outcome; `waiting_external` starts a durable manager decision, and `succeeded` enters review. The manager must accept the exact report version before the delegation completes and dependencies are released. |
| There was no durable representation of an external task ID/check plan owned by Butler. | Worker `report --phase checkpoint` stores external IDs before a run ends. Manager `watch` stores read-only instructions, interval, deadline, budget, next-check time, failure count, and a lease in the existing Butler SQLite ledger. Core checks the exact external reference and does not repeat the original submit operation. |
| Remote Mesh standalone LAC did not route Butler operations. | The parsed standalone `lac butler` action allowlist routes selected operations through trusted host workspace/thread/run context. Worker reports are scoped to the current run; ordinary remote Shell remains on the device. |
| Agent calls depended on thread/run headers alone; owner deletion failed active goals and external cancel could conflate run interruption with external task cancellation. | Core now issues an expiring HMAC capability for each Butler thread/run, bound to manager or worker Task/Delegation scope. External cancel uses a distinct cancel Operation after interrupting a live worker. Deleted owners pause and preserve tasks/notices until a configured Butler conversation with the same Lark identity or local workspace principal reattaches them. Reassociation moves only that task's notice and preserves terminal status. |
| An initial Channel submission rejection was recorded as uncertain, and old rejected tasks could block profile changes. | An explicit HTTP 400 becomes a failed initial delivery. Profile setup locally closes only historical matching rejected submits with no run or platform message ID; ambiguous outcomes remain untouched and no bot message is sent. |

## Ownership, trust, and compatibility

- Butler task/delegation/operation/checkpoint/report/lease state stays in Core SQLite. ACP submission and run lifecycle remain owned by their existing stores. Task IDs, delegation IDs, operation IDs, thread IDs, run IDs, and external system IDs remain distinct.
- Task recovery is scoped to a persisted owner principal (Lark workspace/instance/user or local workspace). New tasks persist that principal at creation and recheck the owner identity and Butler profile snapshot after asynchronous resolution; legacy Lark ownership is backfilled only from a still-current platform binding. Ambiguous unbound legacy tasks remain fail-closed rather than being reclassified as local. Notification send completion uses a compare-and-set so a late old-owner send cannot overwrite reassociation.
- A profile save may recover only a persisted initial Channel submission with the exact definite HTTP 400 rejection, no run ID, and no platform message ID; this is a local ledger update after configuration validation, not a retry or a channel send.
- Core derives worker identity from the trusted active submission thread and run. A worker can only report against its current operation; it cannot choose owner, target workspace, recipient, or another task. Manager actions are limited to the configured Butler conversation and roster. Existing ACP permissions remain in force; Butler never approves a worker permission.
- The capability controls supported Butler CLI/API calls. Local Core management HTTP routes retain the existing same-user trust model; arbitrary local Shell or raw localhost HTTP is not treated as an OS-isolated security boundary.
- A failed run after a checkpoint leaves the external reference persisted and the delegation blocked for manager action. Checks and historic report text are framed as untrusted data and the worker is instructed to query only the recorded reference. This feature narrows Butler/LAC routing; it does not claim to sandbox other Shell access that a workspace agent already has.
- Existing Channel profiles/tasks retain their channel transport and app-scoped mention validation. There is no automatic mode migration or fallback between transports. No Feishu application permissions or production data were changed by this branch.

## Code evidence

- Contracts and API/CLI: `packages/contracts/src/butler.ts`, `packages/core-sdk/src/butler.ts`, `services/local-ai-core/src/runtime/butler-routes.ts`, `runtime/handlers/butler-handler.ts`, and `cli/butler-cli-handlers.ts`.
- Dispatch, report scope, checks, rejection recovery and cancellation: `services/local-ai-core/src/butler/butler-service.ts`, `butler-dispatcher.ts`, `butler-observation.ts`, and `butler-notifications.ts`.
- Persistence and trusted Mesh route: `services/local-ai-core/src/acp/store/butler-store.ts`, `services/local-ai-core/src/execution/remote-mesh/lac-control.ts`, and `services/local-ai-core/src/acp/local-core-acp-session-coordinator.ts`.
- Behavioral tests: `tests/integration/butler-service.test.ts`, `tests/integration/butler-entry.test.ts`, `tests/electron/lac-cli-butler.test.ts`, and `tests/electron/remote-lac-control.test.ts`.

## Validation and delivery state

- Validation details are tracked in the [implementation plan](../../plans/2026-10-17-butler-lac-orchestration.md). Main and BDD typechecks, Electron/Core build, renderer build, static lint gates, architecture lint, 1103 Node tests, 80 BDD scenarios, coverage thresholds, and `git diff --check` passed. Current coverage is 75.52% lines, 75.52% statements, 82.19% functions, and 73.67% branches. The shared `node_modules` symlink required a temporary Vite config alias for renderer build and `NODE_PATH` during tests; no project config or shared dependency was modified.
- No real Feishu command, Ubuntu server deployment, or fnOS download was run in this branch. A test double covers one download ID, repeated read-only checks, restart recovery, and acceptance; it is not evidence of production behavior.
- The full clickable prototype at `design/index.html` was confirmed by the user on 2026-10-17. Butler renderer/i18n now implement core/channel transport, workspace/runtime-specific bot bindings, tracking policy, and task progress details.
- `[PASS]` Local browser smoke used an isolated mock Local AI Core: verified config loads, disconnected workers remain selectable for core transport, shared-channel mode requires connected workers, and task details show progress, external references, next check, and remaining budget. This was not a real Feishu/fnOS/Ubuntu integration test.
- `[PENDING]` Real Feishu/fnOS/Ubuntu end-to-end validation and PR preparation remain.
- `[BLOCKED]` Real Ubuntu/Feishu/fnOS workflow, measured production dispatch latency, and deployment are outside this local validation environment.

The stable current workflow artifact is generated from `docs/architecture/butler-orchestration.workflow.json` and validated by the architecture lint. The change-folder HTML is the approved-design comparison artifact; the stable Butler workflow HTML is the as-built delivery view.
