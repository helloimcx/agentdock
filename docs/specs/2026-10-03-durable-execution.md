# Durable execution — Spec

- Date: 2026-10-03 (Asia/Shanghai)
- Status: Approved; implementation and verification complete (2026-10-04).
- Branch: `codex/2026-10-03-durable-execution`
- Base: `c133018` (`origin/main`, verified 2026-10-03)
- Complexity: Complex — cross-layer persistence, concurrent admission, external side effects, client synchronization and a new runtime.
- Architecture Impact: Required.

## Goal

Accept a user intent once despite retries, recover final-report delivery without rerunning the Agent, reconstruct the running thread after reconnect, then prove SQLite-backed execution recovery with an optional Pi Durable runtime. Deliver in that order under one approved baseline.

## Scope

1. Persistent submission admission, dispatch and recovery for thread prompts; propagate stable keys through SDK/renderer, channel, Automation/Scheduler and external run entry points.
2. Persistent final-report outbox for Automation/Scheduler, actual gateway receipts, recovery and explicit handling of uncertain sends.
3. Versioned persistent thread execution snapshot and race-free subscriptions, shared across desktop/web/H5 chat controllers; persistent permission lifecycle.
4. Opt-in `pi-durable` global ESM worker with SQLite, local text input, configured OpenAI-compatible model, safe workspace read tools, and approval-gated workspace text writes; restart recovery, cancel and snapshot projection.
5. Additive contracts/schema, relevant UI/i18n, tests, README New and current architecture maintenance.

## Non-goals

- Replace `pi`/`pi-acp`, migrate existing Pi JSONL or all Agent histories.
- PostgreSQL, shared multi-Core storage or distributed execution.
- Promise exactly-once model/tool execution for traditional ACP, or exactly-once external side effects without platform guarantees.
- Reliable replay of all immediate chat/progress messages; reliable outbox scope is scheduled/Automation final reports.
- Full Durable coding-agent parity, write/edit/bash tools, MCP, remote sandbox, subagent/fork UI or broad provider support in the initial trial.
- Upgrade Electron or install a machine-wide Node runtime. An explicitly configured compatible Node executable is supported.

## Behavior / Interfaces

### Submission

- Add optional `requestId` to prompt admission; keep existing `runId` responses and add `submissionId`, admission status and deduplication indication. No-key legacy clients create a new intent on each request.
- Deduplication domain is the authenticated thread and operation kind. Same key and same canonical semantic payload returns the original submission/run. Different payload for an existing key returns HTTP 409 without writes.
- The digest covers original content/parts and execution-affecting options, not regenerated knowledge/context, credentials or arbitrary client-supplied actor identity.
- Renderer generates one stable request key per intent and retains it on retry. Channels derive keys from actual platform event/message IDs plus instance identity. Automation uses its outer `automationRunId`, never its definition ID or underlying `acpRunId`.
- A single Core SQLite transaction admits submission, user message and reserved run/task IDs plus thread metadata. Network, provider calls and tool execution are outside transactions. Existing store methods with their own transactions must expose composable internal writes.
- Dispatcher claims pending submissions with conditional transitions and serializes ordinary prompts per thread. Queued cancellation targets only that submission. Preserve permission actions and supported steer semantics instead of queuing them as ordinary prompts.
- Slash commands also have keyed admission. Completed commands return their stored result, possibly with no Agent run. Uncertain partially executed commands are marked interrupted/unknown rather than blindly replayed; transaction-safe local effects should commit with the command outcome.
- On startup, pending submissions may dispatch. Traditional ACP dispatching/running submissions become interrupted/unknown, with explicit recovery diagnostics. They are not automatically re-prompted. Pi Durable submissions are reconciled using their original persistent identity.

### Delivery

- Core owns final-report outbox and attempt records. Immutable route/payload and exact source run/message identity are saved; never select the latest reply from the whole thread.
- One logical final report per outer Automation/Scheduler run and destination; states are `pending`, `sending`, `delivered`, `failed`, `unknown` (and cancellation/blocked handling where required).
- Execution completion and delivery completion are independent. Remote success requires a real platform acknowledgement/receipt; a synthetic local ID or `onBridgeEvent` returning is insufficient. Local delivery completes when its final thread result is persisted.
- Preserve best-effort start/progress bridge events. Outbox is the only final-report sender: suppress the old bridge final path for these runs. A channel can update an existing confirmed progress card if supported; it must not send a second final via a competing path.
- `pending` resumes without rerunning the Agent. `delivered` never resends. A `sending` attempt interrupted before local acknowledgement becomes `unknown` unless platform-specific query/idempotency proves an outcome.
- Only confirmed non-delivery can use bounded automatic retry. Timeout, disconnect or ambiguous response is not proof of failure. Unknown sends require authorized explicit reconciliation/retry, with an audit record and a visible possible-duplicate notice.
- Historical records receive no invented receipts and are not automatically resent. Deleted/revoked destinations are blocked/cancelled, not replaced by a new same-name route.

### Unified runtime snapshot

- Add a contracts/SDK snapshot endpoint and thread-scoped watch protocol. Snapshot contains schema version, thread revision/epoch, exact run identities, messages/committed partial answer, tools, queued submissions, permission lifecycle, delivery and usage/recovery capabilities.
- Core persists a lightweight runtime projection; trace remains observability, not a replay engine. State transitions and revision updates commit before broadcast. Streaming partial updates can coalesce; final/tool/permission/terminal transitions flush promptly.
- Watch registers and buffers before reading an atomic snapshot/revision, sends the baseline, then newer buffered changes. Reconnect begins with a fresh snapshot; stale revisions are ignored, gaps/overflow/epoch changes resynchronize. No permanent cursor replay guarantee is added.
- Permission requests and decisions persist with thread/run/session generation. Decisions commit before transport release. Traditional ACP requests lose actionability after their process dies; stale cards cannot authorize a new session. A snapshot reports this explicitly.
- All renderer chat surfaces use the same reducer/controller; legacy API/events remain additive-compatible. Thread watch inherits existing authentication/access checks and must stop on thread/workspace changes.

### Pi Durable trial (SQLite)

- Add experimental `pi-durable`; preserve original `pi`. Exact-pin the inspected upstream release (`@earendil-works/pi-durable` 1.0.1 and compatible Pi AI dependencies), verify actual published APIs during implementation.
- Build an isolated ESM worker as `.mjs`, with explicit packaging/copy rules and a Core-owned multiplexed request/response/event protocol. Do not change the whole CommonJS backend or rely on TypeScript's CommonJS-rewritten dynamic import.
- One Core-managed global Durable worker owns one Harness and one `pi-durable.sqlite` under the resolved Core user-data runtime directory. All Durable threads/workspaces use that database, each mapped to an independent Conversation; owned child conversations share it. Global means one Core user-data instance, not one database shared across machines or multiple Core processes. No per-thread/per-run DB or repository/cwd database.
- Only the global worker opens Durable storage. Core routes submit/watch/cancel by explicit thread/conversation/submission identities through a typed multiplexed protocol. Enforce exclusive worker/storage ownership with a host lock; do not rely solely on SQLite write locking. Traditional ACP runtimes retain their existing per-thread processes.
- Core owns thread/submission/business run/approval/delivery records; Durable owns model/tool checkpoints. Store explicit Core↔Durable identifiers. Use Core `submissionId` as upstream `requestId`; look up the existing submission after a crash between the two database writes. Do not claim a cross-database transaction.
- Startup starts the global worker once and loads/reconciles unfinished Durable conversations before resuming work. A worker crash marks all attached Durable runs recovering and restarts that worker with bounded backoff; thread close/idle release never shuts down the shared worker. Core shutdown drains/closes it once. Cancelling a run targets only its conversation and foreground descendants, never another thread. Restore model/environment/security definitions first. A process failure keeps the recoverable Core run pending for reconciliation instead of applying generic ACP terminal failure.
- Missing or changed credentials/provider/cwd/storage bindings block recovery with a diagnostic. Never silently create a fresh conversation, change model or fall back to unsafe local execution.
- Read and list tools remain workspace-scoped. `write_file` may create or replace a UTF-8 text file only inside the configured workspace. Each write requires a one-time `workspace.write` approval in the existing thread permission UI; no allow-all/session grant is offered for this tool, including when the workspace default is `allow`. A workspace default of `deny` rejects it. The approval covers the exact path and proposed content. Denial, timeout, expired approval, restart, workspace/security-policy change, or baseline conflict fails closed without writing. Approval callbacks are ephemeral; after Core restart, stale pending approvals are expired and an interrupted unsafe tool is never replayed. A later model retry must obtain a new approval.
- Write paths must remain inside the real workspace after resolving symlinks. Writes use an atomic same-directory temporary-file replacement. The tool captures the pre-approval target state and only writes if it is unchanged; if it already equals the approved content it reports idempotent success, otherwise it fails on conflict. Parent directories must already exist; no delete, shell, MCP, sandbox, binary write, or workspace-external operation is exposed.
- Existing Core `workspace.write` policy is checked before prompting: `deny` rejects without an approval; `ask` requests approval; `allow` permits the exact write subject to workspace/path constraints. Selecting Durable never bypasses that policy.
- Require Node >=22.19.0 and SQLite/ESM capability checks on the actual child executor. Electron 35.7.5 ships Node 22.16.0, below the upstream requirement. Standalone Core or an explicitly configured compatible Node executor can run the trial; unsupported desktop executor shows an unavailable capability, not a broken launch.
- No keys/secrets in Durable documents, snapshots or logs. Configured model credentials are rebuilt at launch. Client disconnect/wait cancellation does not cancel work; explicit interrupt does.

## Constraints / Compatibility

- Use pnpm, preserve module boundaries, extend shared contracts/SDK instead of renderer ad-hoc fetches.
- Incremental migrations; preserve old history and old public call signatures. New status unions propagate through all mappers and i18n.
- Single Core/storage owner. Each identifier domain remains distinct; no generic `.id` substitution between Automation and execution.
- Legacy ACP history loading does not imply execution recovery. User-data files and sandbox/filesystem durability remain separate.
- Provider or runtime limitations are visible and tested; no silent downgrade or invented success.

## Acceptance Criteria

1. Twenty concurrent same-thread same-key same-payload admissions produce one user message, submission and run/task; all responses refer to the same IDs. Different payload returns 409; different threads are independent.
2. Injected failure at every admission write rolls back all related facts. Commit-before-dispatch crash preserves an actionable pending submission; response-loss retry creates no new intent.
3. Same-thread ordinary prompts execute serially; queued cancellation and permission actions preserve their intended targets. Keyed `/new` retry creates no duplicate thread.
4. A traditional ACP prompt with uncertain dispatch after restart is not resent. A stale permission callback is not actionable; failure to persist a decision does not send an approval.
5. Final report content comes from the target execution run, even with subsequent replies on that thread.
6. Execution success alone never marks a remote delivery complete. Gateway acknowledgement persists its real receipt; bridge and outbox do not double-send final reports.
7. Restart before send resumes delivery only; confirmed delivered reports do not resend. Crash after remote send and before local receipt becomes unknown without automatic resend on unsupported platforms.
8. Explicit unknown reconciliation/retry persists an audit record and survives restart. Historical runs do not spuriously resend.
9. Snapshot attachment interleaved with updates loses no state and duplicates no message. Reconnect/gap/overflow/epoch changes recover a current baseline; no cross-thread stale frames overwrite the selected thread.
10. Restart preserves committed partial answer, tools, queue and delivery facts; expired ACP approvals are visibly non-actionable.
11. Two Durable threads in different workspaces share exactly one database and one worker, while conversation history, cwd, model, credentials, tools, cancellation and outputs remain isolated; a second owner of the same storage is rejected. Conversation creation and its Core thread identity commit together inside Durable so a lost Core mapping can be recovered without creating a duplicate. SQLite resides in user data, never the repository.
12. Kill/restart around Durable submit/mapping/completion finds the same upstream submission and projects terminal messages/usage once. Reads remain workspace-scoped. Writes reject traversal/symlink escapes, await exact per-write approval, preserve existing Core policy, reject stale decisions and baseline conflicts, and apply atomically. Unsupported shell/delete/MCP/sandbox tooling never executes.
13. Actual ESM child executable, build output and packaged files pass compatibility smoke; insufficient Node/provider/sandbox configuration reports a clear capability error. Original Pi/other ACP paths still pass.
14. A real Core HTTP/WS main path proves retry, restart, delivery recovery and reconnect. Request latency/recovery timing is recorded; live model/channel tests without credentials are marked BLOCKED, not PASS.
15. Independent review has no unresolved Critical/High findings; `pnpm verify` and required architecture outputs/current facts/README agree with the implementation, with a per-criterion QA evidence matrix.

## Evidence and upstream references

- `services/local-ai-core/src/acp/local-core-acp-backend.ts`: message admission and asynchronous run launch.
- `services/local-ai-core/src/acp/store/thread-store.ts`: existing nested-transaction hazard.
- `services/local-ai-core/src/automation/automation-action-executor.ts`: run result selection and assumed delivery success.
- `services/local-ai-core/src/acp/store/automation-store.ts`: generic interrupted-run reconciliation.
- `services/local-ai-core/src/channel/base-channel-gateway.ts`: immediate outbound bridge ownership.
- `tsconfig.electron.json`: CommonJS compilation.
- [Pi Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md), [package metadata](https://github.com/earendil-works/pi/blob/main/packages/durable/package.json).
- [Electron 35.7.5 release](https://releases.electronjs.org/release/v35.7.5).
