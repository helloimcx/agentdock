# Butler pipeline fixes: flexible acceptance, execution observation and fair concurrency (#297, #299, #298)

Date: 2026-11-15. Base revision: `1b1ac00` (`origin/main`). Implementation branch: `codex/2026-11-15-butler-pipeline-fixes`.

## Architecture delta

Butler task management now provides manual user acceptance channels and bounded workspace concurrency without starving background or sibling delegations.

1. **Acceptance Lifecycle & Terminal Immutability (#297)**:
   `ButlerService.complete()` now supports explicit manual acceptance (`manual?: boolean`, `force?: boolean`, `reason?: string`), allowing tasks with reviewing, cancelled, or failed delegations to be accepted and closed by the owner without forcing artificial task cancellation. Pending reviewing delegations are automatically promoted to `completed` upon acceptance. `deriveTaskStatus` and `ButlerDispatcher.aggregate()` lock `completed` and `cancelled` tasks so background sweeps cannot revert accepted tasks back to `failed` or `blocked`.

2. **Execution Observability & Blocker Projection (#299)**:
   `ButlerDelegation` contracts extend `lastHeartbeatAt` and `lastWorkerMessage` (truncated to 500 characters), which are dynamically projected by `observeDelegation` from real-time run updates, assistant turn messages, and partial streaming rows. `blockedReason` is widened to `ButlerBlockedReason` (`pending_approval | workspace_busy | execution_uncertain | waiting_external`). Channel bot protocol (`task.progress`) encodes and synchronizes `blockedReason`, heartbeat, and worker messages cross-process to manager bots.

3. **Bounded Workspace Concurrency & Queue Transparency (#298)**:
   Workspace concurrency checking (`workspaceBusy`) transitions from a coarse binary lock (1 job max per workspace) to bounded concurrency (default max 4, configurable via `trackingPolicy.maxWorkspaceConcurrency`). Non-execution submissions (permission responses, slash commands) are excluded from the busy count. Queued delegations explicitly track and display `queueReason` (`waiting_dependency:<keys>`, `waiting_thread`, `workspace_busy`). Channel bot transports enforce single-turn serialized access per bot to prevent shared group interaction collisions, while Core mode allows parallel execution threads.

## Affected components and data flow

- `packages/contracts/src/butler.ts`: Extends `ButlerDelegation`, `ButlerBotProtocolMessage`, `ButlerTask`, `ButlerCompleteInput`, and `ButlerTrackingPolicy`.
- `apps/daemon/src/butler/butler-service.ts`: Flexible acceptance validation, auto-promotion of reviewing delegations, manual acceptance audit properties, and concurrency policy resolution.
- `apps/daemon/src/butler/butler-dispatcher.ts`: Terminal task state locking in `aggregate` and `deriveTaskStatus`, bounded queue dispatching, Channel protocol synchronization of `blockedReason`, and thread-aware check deferrals.
- `apps/daemon/src/butler/butler-observation.ts`: Real-time extraction of `lastHeartbeatAt` and `lastWorkerMessage`, bounded `workspaceActiveExecutionCount` calculation.
- `apps/daemon/src/butler/butler-bot-protocol.ts`: Validation and serialization of `blockedReason` in protocol envelopes.
- `apps/daemon/src/cli/butler-cli-handlers.ts`: CLI parameter exposure for `--manual`, `--force`, `--reason`, and structured output.
- `tests/integration/butler-service.test.ts`: Verification of partial acceptance, terminal immutability, observation projection, and concurrency queue semantics.

## Rationale and compatibility

- **Compatibility**: All contract extensions are optional fields. No SQLite schema migrations are required; state extensions persist transparently inside existing task `data` JSON columns.
- **Safety**: Tasks with outstanding execution turns (`childHasOutstandingExecution`) remain strictly rejected from acceptance (HTTP 409), preventing concurrent state mutation.
- **Fairness**: Long-running background jobs (e.g. downloading, media rendering) no longer monopolize the entire workspace slot, allowing lightweight sibling queries to execute in parallel.

## Evidence

- Tests: 52 tests pass in `tests/integration/butler-service.test.ts` (0 failures).
- CLI tests: 10 tests pass in `tests/electron/lac-cli-butler.test.ts` (0 failures).
- Typecheck: `pnpm typecheck` passed cleanly across all monorepo workspaces.
