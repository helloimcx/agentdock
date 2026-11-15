# Issue 289: Butler worker approvals

Status: implemented and verified on 2026-11-12.
Base: origin/main 465079d. Architecture Impact: Required (execution trust boundary, approval lifecycle, notification flow and public diagnostics).

## Goal

Enable unattended Butler core worker operations to execute their assigned work and deliver checkpoint/final reports without hanging on interactive command approvals, while making remaining approvals observable and preventing stale approvals after a run ends.

## Scope and behavior

- Apply `bypassPermissions` only to an execution proven to be an authorized Butler core worker operation, not permanently to its thread. The operation's submission, thread, run, task and delegation identities must be checked against durable, trusted server-side facts; untrusted prompt text, client-supplied identifiers and tool titles are not authority. Address admission and run-binding order explicitly, including recovery and follow-up runs. Normal conversations, other transports, unrelated runs and subsequent manual submissions retain their configured modes. Never reuse a session with an incompatible launch mode.
- This mode grants the worker execution permission to run arbitrary commands, including writes and destructive commands. It is not a read-only whitelist or a sandbox, and is limited in time and identity to the dispatched operation. Preserve any independently enforced sandbox and capability checks. Do not silently elevate existing in-flight runs; the new behavior applies on a new eligible operation.
- On terminal completion, failure, cancellation, timeout, process exit, or recovery, expire only still-pending agent execution approvals belonging to that exact thread and run. Handle resolve/expire races without overwriting a completed decision; expired approvals must not release a tool. Preserve available approval IDs and a bounded, sanitized command summary before losing actionable state. Error text says an approval was pending at termination without asserting unproven causation or replacing a more specific error.
- Expose optional delegation `blockedReason: 'pending_approval'` through existing task/info JSON only while the current execution has an actionable pending approval. Omit it for other waiting reasons and after resolution or termination; retain historical evidence separately. Keep response compatibility with older clients.
- After five minutes of a still-actionable pending approval, enqueue one durable, deduplicated reminder per approval for the task owner/manager using the existing notification route. Recheck before delivery, handle busy owner sessions and restart, and avoid repeated delivery after resolution. A configured channel route is used when available; otherwise notify the owner thread. Include IDs and sanitized bounded command context, not secrets.

## Non-goals and constraints

No global permission bypass, inference that arbitrary shell commands are read-only, loosening manager/worker capability checks, blind retries of business operations, or automatic approval of currently pending requests. Do not modify the existing unrelated dirty host worktree or assume its proposed report-command allowlist is safe. Existing terminal approvals may be repaired only when the exact terminal run and ownership can be proved.

## Acceptance criteria

1. A newly dispatched eligible core worker can run a representative query and submit checkpoint and final reports without an approval; persisted report and delegation state are correct. Follow-up and recovery cases preserve the same identity boundaries.
2. Ordinary user runs, legacy channel workers, forged/mismatched identities and subsequent user turns do not receive worker bypass. Mixed launch modes cannot leak through warm session reuse.
3. Completed, failed, interrupted, timed-out and crashed runs leave no actionable agent approval for that run; concurrent user resolution is not overwritten and unrelated approvals remain unchanged. Failed runs with a pending approval retain evidence without asserting an unproven cause.
4. `lac butler info --json` reports the reason only for a current actionable approval; unrelated awaiting-input cases and terminal runs do not report it. Existing clients accept the additional optional field.
5. A still-pending approval triggers one reminder after five minutes and it reaches the owner route. The queued reminder survives while that owner thread is busy; if a daemon restart expires the old ACP approval, the reminder is discarded and never replayed. Repeated reconciliation does not duplicate a delivered reminder.
6. Automated integration/security regression tests, applicable architecture gates and an actual daemon/ACP main-path exercise pass, or limitations are reported explicitly.

## Verification outcome

- All six acceptance criteria are covered by implementation and regression checks. The ACP fixture exercises a real daemon HTTP task dispatch, a child ACP process, a `session/request_permission` request, automatic `selected` response, no lingering pending approval, and unchanged persisted thread mode.
- `pnpm verify` passed on 2026-11-12, including typecheck, static gates, architecture lint, compiled tests, coverage thresholds and BDD (80 scenarios / 286 steps). The compiled test suite reported 1211 passed and one environment-dependent SSH test skipped.
- Independent review found no remaining High or Medium findings.
- Permission bypass is intentionally limited to one newly dispatched, server-owned Core worker operation. It can authorize arbitrary command execution and side effects during that operation; it is not a read-only mode or an OS sandbox.
