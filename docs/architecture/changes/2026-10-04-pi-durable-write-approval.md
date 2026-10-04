# Pi Durable workspace write approval

Date: 2026-10-04. Status: implemented and validated.
Base: approved Pi Durable trial in [2026-10-03 durable execution](2026-10-03-durable-execution.md), on branch `codex/2026-10-03-durable-execution`.

## Changed architecture facts

- Pi Durable exposes `write_file` for workspace-local UTF-8 file creation or replacement; it does not receive direct filesystem write authority.
- The worker sends a correlated write request over its private JSON-lines protocol. Local AI Core binds it to the active thread, Core submission, and run, creates the persisted `workspace.write` approval, and presents the existing thread permission card.
- The existing keyed thread action resolves only the exact pending write approval. Core performs the side effect after the one-time decision; the approval is bound to the normalized workspace-relative path, proposed-content SHA-256, and pre-approval file baseline.
- Core rejects workspace-write policy `deny`, paths outside the real workspace, symlink targets, missing parent directories, invalid/NUL/oversized text, expired or stale decisions, and a baseline that changed while approval was pending. File content is staged beside the target and atomically published; new files use exclusive link publication.
- Pi Durable tool side effects are replay-unsafe. Pending write approvals expire on Core restart; an interrupted write tool is never automatically replayed.
- Delete, shell, MCP, and sandbox remain unavailable. One-time confirmation is required even if workspace write policy is `allow`; policy `deny` always blocks.

## Boundaries and rationale

This extends the existing Local AI Core-to-Durable worker protocol and reuses Core's approval store, audit trail, thread permission card, and keyed thread action. The worker remains the global Harness/SQLite owner, while Core owns filesystem access and authorization. No public endpoint, new database, or persistent credential is added. This keeps workspace mutation inside the same Core trust boundary as existing permission handling and prevents an old approval from surviving process recovery.

## Evidence

- Implementation: `services/local-ai-core/src/agents/pi-durable/{host.ts,protocol.ts,worker.mts,write-tool.mts,workspace-write.ts}`; `services/local-ai-core/src/acp/local-core-acp-backend.ts`; `services/local-ai-core/src/acp/local-core-acp-actions.ts`; `services/local-ai-core/src/acp/store/thread-runtime-store.ts`.
- Runtime projection and interfaces: `services/local-ai-core/src/acp/store/thread-execution-snapshot.ts`; `shared/desktop.ts`; existing `approval_requests` and `thread-action` interfaces.
- Tests: `tests/integration/pi-durable-write-safety.test.ts`, `tests/integration/pi-durable-write-approval.test.ts`.
- Workflow artifacts: [proposal flow](2026-10-04-pi-durable-write-approval.html) and [typed source](2026-10-04-pi-durable-write-approval.workflow.json); current as-built workflow is [durable execution](../durable-execution-workflow.html).

## Validation

- `pnpm typecheck`, `pnpm lint:gates`, `pnpm lint:arch`, and `pnpm verify` passed. The full suite ran 899 Node tests, 80 BDD scenarios / 286 steps, and coverage thresholds.
- Pi Durable focused integration and safety tests passed (8 tests); both updated architecture canvases passed showcase delivery and automated browser checks, including the durable workflow's light/dark endpoint captures.
- Atomic replacement rechecks the approved baseline immediately before rename. As with ordinary Node filesystem APIs, an unrelated external process can still race in the small interval between that check and rename; creation uses exclusive hard-link publication and fails if the target appeared.
- Live provider credentials and external channel delivery are not required for the controlled write-approval fixture.
