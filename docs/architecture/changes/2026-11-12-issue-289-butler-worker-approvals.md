# Butler worker approvals and terminal lifecycle

Date: 2026-11-12. Base revision: `465079d` (`origin/main`). Implementation branch: `codex/2026-11-12-issue-289`.

## Architecture delta

Butler Core worker submissions now persist a per-submission `bypassPermissions` mode and receive a dedicated ACP session that closes at run end. This changes the trust boundary: an eligible worker run can execute arbitrary commands and side effects; it is not read-only and not an OS sandbox. The mode does not alter the saved thread mode, and legacy Channel worker submissions keep interactive permissions.

Terminal run updates expire only still-pending agent approvals for the exact `threadId + runId`. Approval resolution now requires the record to remain pending, so late actions cannot revive expired approvals. Failed/interrupted submissions retain a redacted, bounded diagnostic with approval IDs and command summaries alongside the original run error. Butler task info adds optional `delegation.blockedReason: "pending_approval"` while an exact run has an actionable approval. Butler notification persistence now records one five-minute reminder per approval, rechecks its current run and approval before queueing to the owner thread, and drops stale reminders. Startup expiration invalidates old ACP epoch approvals and their queued reminders.

## Affected components and data flow

- `ButlerDispatcher` adds run permission mode to the durable Core worker submission; it does not persist the elevated mode on the thread.
- ACP lifecycle stores expire exact-run pending approvals on terminal status and preserve failure context; `LocalSecurityStore` makes approve/expire a conditional transition.
- Butler observation projects actionable approval state to its shared contract; `ButlerNotifications` uses the existing owner-thread queue and delivery route for delayed reminders.
- Pi Durable write approvals share the approval store. Their timeout no longer restores a terminal run to `running`.
- No SQL migration, service, external endpoint, process, or network boundary was added. Existing task/info JSON gains one optional field.

## Rationale and compatibility

A report-only allowlist would not handle business commands that block before the report is submitted. A per-operation permission mode covers that unattended workflow while keeping the saved thread mode and Channel workers unchanged. The worker can run arbitrary commands in that one run; configured sandbox settings and run-bound Butler report capabilities remain separate controls. Existing approval records and Butler task JSON remain readable, old approval decisions are preserved, and stale approvals can no longer be approved after run end.

## Code and test evidence

- `apps/daemon/src/butler/butler-dispatcher.ts`: run-scoped Core worker permission submission.
- `apps/daemon/src/acp/local-core-acp-backend.ts`, `apps/daemon/src/acp/store/local-core-acp-store.ts`, `apps/daemon/src/acp/store/thread-runtime-store.ts`, and `apps/daemon/src/acp/store/security-store.ts`: session closure, exact-run expiry and conditional resolution.
- `apps/daemon/src/acp/store/butler-approval-lifecycle.ts`: startup and terminal approval diagnostics, stale reminder revalidation and queued batch cancellation.
- `apps/daemon/src/acp/store/thread-store.ts`: exact queued-message removal and collision-resistant generated message IDs.
- `apps/daemon/src/butler/butler-observation.ts`, `apps/daemon/src/butler/butler-notifications.ts`, and `packages/contracts/src/butler.ts`: live blocker projection and durable reminder.
- `tests/integration/butler-service.test.ts`, `tests/integration/butler-http.test.ts`, `tests/electron/acp-session-reclaim.test.ts`, `tests/electron/security-approval-store.test.ts`, and `tests/integration/pi-durable-write-approval.test.ts`: real daemon/ACP permission path, mode separation, diagnostics, expiry, reminder threshold/deduplication and terminal timer behavior.
- Expected flow: [approved plan](../../plans/2026-11-12-issue-289-butler-worker-approvals.md).

## Provider and validation

Provider: Archify, as declared by `diagram-provider.yaml`. Updated sources: `system-architecture.json` and `butler-orchestration.workflow.json`. Both diagrams were rendered, browser-checked and visually inspected; exported HTML and light/dark PNG artifacts are present. `pnpm lint:arch` passed 12 specifications with 0 failures.

`pnpm verify` passed on 2026-11-12: typecheck, lint gates, architecture lint, compiled test suite (1211 passed, one optional SSH test skipped), coverage thresholds, and BDD (80 scenarios / 286 steps). `git diff --check` passed. Independent review found no remaining High or Medium findings.

The full suite exposed a same-millisecond, cross-thread collision in automatically generated message IDs. The IDs now preserve the timestamp/role/sequence prefix and append a UUID; explicit message IDs remain unchanged. The previously failing ACP run-history tests pass after the fix.
