# Automation run and delivery correlation

Date: 2026-11-08. Base revision: `f80ada7956e6d45e9f9f193a2d622ba7d0bdd677`. Scope: the automation-only MVP approved for issue #279; Butler and ordinary chat task correlation remain out of scope.

## Semantic change

Automation-owned `thread_submissions` now persist an optional owner kind/ID in the same transaction as admission; existing rows gain nullable columns additively. An Automation Run stores its associated ACP thread and run IDs as soon as the thread submission admission returns, before the executor waits for completion, and emits `automation.run.updated` so an open details view refreshes. The destination was already durably saved before submission. Startup recovery resolves only the submission bearing that exact owner in the saved thread and workspace, checks any already persisted run ID for disagreement against the submission and owner-bound delivery, and never re-dispatches the Agent. A request ID match without the owner marker is rejected. Ambiguous or mismatched facts remain unlinked.

Automation details now group each activation's raw execution state and its own delivery state, and open the ACP trace only when `AutomationRun.acpRunId` or its matching outbox record proves the ACP run ID. Delivery joins require the `automation` owner kind and exact Automation Run ID; the existing workspace filter remains in force. A matching outbox record takes precedence over the mirrored Automation Run delivery summary, and execution success does not imply delivery success.

## Affected components and boundaries

- `AutomationActionExecutor` records the automation owner on the submission and restores the ACP run link only from matching owner and destination facts after restart.
- `AutomationService.listDeliveries` enforces the existing relationship by owner kind, run ID and workspace.
- The existing Automation REST/SDK and React detail view present the relationship; no public contract, route or authentication boundary was added. The local SQLite schema gains nullable submission owner columns and a unique partial owner index; existing submissions migrate with no owner.
- Core SQLite continues to own Automation run JSON, ACP submission/run records and delivery outbox records separately.

## Rationale and compatibility

The separate `AutomationRun.id` and ACP `runId` identify the trigger and its execution respectively. Persisting the association earlier closes the normal wait-time gap; recovery closes the remaining process-interruption gap only where durable facts prove the match. Existing API fields are reused, and old records without provable associations remain without an execution link. Delivery reconciliation controls remain available on the corresponding failed or unknown delivery.

## Plan diagram reference

The approved topology is in [`docs/plans/2026-11-08-task-correlation.md`](../../plans/2026-11-08-task-correlation.md): Automation Run → ACP admission and persisted run reference → independent outbox status → Automation detail and exact trace.

## Code evidence

- `apps/daemon/src/automation/automation-action-executor.ts`: capture `sendThreadMessage` admission result before `waitForRunCompletion`; persist the destination before admission; restore a run link only after matching request, operation kind, thread and workspace.
- `apps/daemon/src/automation/automation-service.ts`: filter outbox records by automation owner kind, selected run IDs, and workspace.
- `apps/web/src/pages/Automation/AutomationDetailModal.tsx`: show execution and delivery independently and link only the stored ACP run ID.
- `apps/daemon/src/acp/store/delivery-outbox-store.ts`: delivery ownership key and persistence remain unchanged.

## Validation

Prototype confirmation: received 2026-11-08. The additive owner columns preserve old rows with null ownership. TypeScript renderer and Electron checks passed with `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.electron.json --noEmit`; the production Vite renderer build passed. Archify validated the updated workflow; `scripts/lint-architecture.mjs` passed all 9 diagrams; separate Chrome browser-check and visual-check receipts passed with no overflow; the updated light and dark artifacts were inspected. The first two combined `finalize` attempts wrote the validated diagram but their sandboxed Chrome checks could not connect; the delivered artifact passed a host Chrome browser-check after each update. Automated tests and `pnpm verify` were not run. A direct `pnpm typecheck` attempt could not reach the npm registry, so the equivalent renderer and Electron TypeScript checks were run directly with the workspace's existing locked dependencies.
