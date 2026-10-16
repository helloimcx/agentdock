# Butler implementation plan

Date: 2026-10-12. Base: origin/main ab7c192. Branch: codex/2026-10-12-butler-orchestration.

Architecture Impact: Required — adds Core-owned orchestration responsibilities, durable goals/delegations and cross-workspace asynchronous flow.

## Decisions

Three independent planning agents converged on ordinary workspace Agent sessions plus a Core-owned durable coordinator. Use managed skill + `lac butler` for model-facing tools, and WorkspaceRouter for dispatch. Do not reuse the scheduled conversation executor because it bypasses permissions. Observe exact run IDs, persist cancellation first, and distinguish queued followups from immediate steering.

## Steps

1. Add contracts and durable store; add failing tests for graph validation, ownership, duplicate admission, concurrency, cancellation and recovery.
2. Implement orchestrator with exact snapshot reconciliation and coalesced owner notifications. Wire lifecycle and router persona without adding a model driver.
3. Expose validated additive REST APIs, SDK, CLI and Butler managed skill.
4. Add Butler page and navigation: configure workspace, open chat, inspect assignments, follow up, cancel and reach child approvals.
5. Synchronize current architecture facts, one semantic change record, official diagrams, matrix and README New entry.
6. Independent review; repair valid findings. Run typecheck/build/static gates/integration/BDD/coverage through pnpm verify, then actual HTTP/CLI and browser checks.

## Storage and IDs

Butler storage lives in Core SQLite. Goal and child IDs never alias run IDs. Ownership follows origin thread; channel routing is retained only for that owner. Runtime processes and credentials remain in existing Agent infrastructure.

## Expected flow

The official current-state Archify workflow is [Butler orchestration](../architecture/butler-orchestration.html); the proposal diagram remains beside the change record as a design baseline.

## Validation

Automated tests cover async facts and side effects, including dependency validation, ownership, duplicate admission, workspace concurrency, follow-ups, cancellation, recovery and owner acceptance. Independent review found no remaining P1/P2 blockers. Production-renderer browser QA exercised profile setup, parallel cross-workspace execution, follow-up, exact child links and explicit parent acceptance using an isolated controlled ACP fixture. Archify deliver and visual checks passed; `pnpm lint:arch` and final `pnpm verify` passed. Live model/channel credentials are outside this validation evidence.
