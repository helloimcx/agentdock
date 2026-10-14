# 2026-10-12 — Butler cross-workspace task coordination

- Architecture Impact: Required.
- Base revision: `ab7c192` (`origin/main`); implementation is in the isolated worktree branch `codex/2026-10-12-butler-orchestration`.
- Active provider: Archify. Current facts are represented by the official L1 architecture and L2 Butler workflow specifications.

## Semantic delta

- Local AI Core now owns a Butler coordination service and durable SQLite records for parent goals, child delegations, assignment dependencies, owner identity, queued follow-ups, cancellation intent, and notification operations.
- The configured Butler is a local workspace/thread whose Agent can invoke the Core CLI. The Butler delegates to existing workspaces through WorkspaceRouter. Child Agents retain their workspace's normal permission rules; no Butler allow-all or permission bypass propagates.
- Butler tracks exact child thread/submission/run identities and execution snapshots, persists important state notifications, and reconciles on runtime events plus a bounded timer. Distinct workspaces may run concurrently; work targeting the same workspace is serialized.
- Agent run completion is an execution fact, not parent goal acceptance. The parent goal enters `reviewing` until its owner explicitly accepts a summary. Uncertain interrupted executions remain visible and are not replayed automatically.
- Renderer, SDK and CLI gain profile setup, task inspection, follow-up, cancellation, and acceptance over the existing Local AI Core HTTP boundary. No new process, database, channel connector, trust domain, or agent runtime is introduced.

## Rationale and compatibility

Users asked for one primary Butler that could hand work to named workspace Agents and keep tracking multiple assignments. Reusing normal workspace Agent sessions keeps model, skill, workspace and permission behavior within existing routing. Keeping goal and execution ownership separate avoids presenting a completed run as proof that the user's overall goal was fulfilled. The additive tables, contracts, SDK methods, REST routes and sidebar view preserve existing task/run identifiers and execution paths.

## Evidence

- Service and durable storage: `services/local-ai-core/src/butler/`, `services/local-ai-core/src/acp/store/butler-store.ts`, and registration in `acp/store/local-core-acp-store.ts`.
- Router, API, CLI and persona policy: `services/local-ai-core/src/router/workspace-router.ts`, `services/local-ai-core/src/runtime/handlers/butler-handler.ts`, `services/local-ai-core/src/cli/butler-cli-handlers.ts`, and `services/local-ai-core/src/thread/butler-message-policy.ts`.
- Shared interfaces and client: `packages/contracts/src/butler.ts` and `packages/core-sdk/src/butler.ts`.
- User interface and behavior checks: `src/pages/Butler/`, `tests/integration/butler-http.test.ts`, `tests/integration/butler-service.test.ts`, `tests/electron/lac-cli-butler.test.ts`, and `tests/contracts/butler-page-model.test.ts`.
- Official flow: [workflow diagram](../butler-orchestration.html) and [typed specification](../butler-orchestration.workflow.json). The initial proposal diagram and browser receipt are retained beside this record as `2026-10-12-butler-orchestration.workflow.json` and `2026-10-12-butler-orchestration.visual-check.json`.

## Validation

- Archify delivered the official L1 and Butler L2 sources: 9/9 checks each, zero errors and warnings. Visual checks passed at 1440x900, 1600x1000, 1920x1080, and 2048x1320 in both light and dark themes.
- `pnpm lint:arch`: passed for all 8 architecture specifications.
- Production renderer browser check against an isolated Core/ACP fixture: configured Butler, created and tracked a goal across two workspaces, sent a follow-up, observed both exact child results, and explicitly accepted the completed goal.
- `pnpm verify`: passed (typecheck, lint gates, architecture validation, test suite, and coverage thresholds).
- HTTP/CLI/ACP controlled fixtures are used for local integration behavior. Live model credentials and real external channel credentials are not part of that evidence.
