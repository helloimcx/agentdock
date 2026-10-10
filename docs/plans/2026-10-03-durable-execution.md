# Durable execution — Plan

Date: 2026-10-03 (Asia/Shanghai). Status: Approved; implementation and verification complete (2026-10-04).
Authoritative behavior and acceptance criteria: [Spec](../specs/2026-10-03-durable-execution.md).
Architecture Impact: **Required** — new submission/outbox ownership, snapshot protocol and execution-recovery runtime/process boundary.

## Baseline and independent planning

Clean isolated worktree at `c133018`, fetched latest `origin/main`; branch `codex/2026-10-03-durable-execution`. No implementation edits before approval.

Implementation outcome and gate results are appended to the approved [architecture change record](../architecture/changes/2026-10-03-durable-execution.md).

Three independent senior-engineer plans were evaluated for correctness, simplicity, ownership, migration and failure semantics. Adopted transaction-safe admission, explicit final-report outbox receipts and a persistent revisioned projection. The user requested global SQLite on 2026-10-03: one dedicated ESM worker/Harness owns one database for all Durable conversations. Independent per-thread children must not open that shared storage. Core routes work through a typed multiplexed worker protocol; traditional ACP process ownership remains unchanged. Unsafe Durable tooling is excluded from the first trial instead of promising an unproven durable approval bridge. Existing ACP permission lifecycle still becomes persistent.

## Expected flow (not current implemented architecture)

[Interactive Archify workflow](../architecture/changes/2026-10-03-durable-execution.html) · [Typed source](../architecture/changes/2026-10-03-durable-execution.workflow.json).

The diagram represents proposed submission admission → runtime execution → final-report outbox → actual channel send → saved acknowledgement; snapshot subscription and optional Durable SQLite are side branches. Formal L1–L3/current facts remain unchanged until implementation exists. The semantic proposal is archived in [change record](../architecture/changes/2026-10-03-durable-execution.md).

## 1. Submission deduplication and dispatch

1. RED: real SQLite concurrent same-key/conflicting-payload/transaction-failure tests and response-loss regression.
2. Add focused submission store and schema migration. Refactor existing synchronous store writes into transaction-composable primitives; preallocate UUID-based execution identities.
3. Implement authenticated admission, canonical payload digest, conditional dispatch claims, per-thread ordinary-prompt serialization and cancellation. Separate special commands/permission actions from normal prompts; persist command results and interrupted intent.
4. Extend contracts, runtime handlers, router options and SDK additively. Carry stable keys from shared renderer controller, actual channel event IDs, AutomationRun/Scheduler run identities and external API. Do not manufacture deduplication identity from content.
5. Startup reconciles pending versus uncertain dispatch; ordinary ACP never automatically repeats an uncertain prompt. Runtime capability determines reconciliation.

Primary modules: `acp/store/`, `acp/local-core-acp-backend.ts`, `router/`, `runtime/handlers/thread-handler.ts`, external handlers, `packages/contracts`, `packages/core-sdk`, shared chat controller, channel inbound and Automation callers.

## 2. Final-report delivery recovery

1. RED: wrong-run final selection, assumed-success regression, pending/sending/receipt crash windows and double-final guard.
2. Add dedicated delivery outbox/attempt repository with immutable destination and payload, execution identity and state transitions. Commit execution result and final-report intent together where Core owns the transaction.
3. Add explicit channel send/receipt capability at `plugin-sdk`; Lark/Weixin adapters return real result classifications. Do not infer success from swallowed errors or synthetic `sched` IDs.
4. Make outbox the final-report owner, retaining progress/start bridge behavior. Final source is run-scoped. Thread-only output completes locally.
5. Replace generic restart failure with phase-specific reconciliation. Unknown sends are not automatically retried; add authorized reconcile/retry API/SDK/UI with audit and possible-duplicate explanation.
6. First-stage QA: real Core API with controlled runtime/gateway fixture; kill processes at each boundary and verify no model rerun or final-report duplication.

Primary modules: `automation/automation-action-executor.ts`, `automation-service.ts`, `acp/store/automation-store.ts`, `scheduler/`, `channel/`, `packages/plugin-sdk/src/channels.ts`, Automation/Cron renderer and i18n.

## 3. Persistent runtime snapshot

1. RED: watch-attachment race, reconnect, duplicate/gapped frames, bounded-buffer overflow and stale approval targeting.
2. Introduce lightweight per-thread projection/revision, with coalesced streaming persistence and immediate boundary flushes. Keep trace responsibilities unchanged.
3. Persist permission lifecycle/decisions before sending responses. After ACP process loss mark original callbacks expired/interrupted; restore no stale clickable decision.
4. Add snapshot REST and thread watch handshake: listener/buffer → consistent baseline → newer revisions. Enforce authentication, bounded buffers and resync behavior.
5. Shared chat reducer/controller consumes baseline and updates across desktop/web/H5. Old interfaces remain compatible.
6. Second-stage QA: open/refresh/reconnect during streaming, tools and approval; compare view with persisted facts.

Primary modules: `kernel/event-bus.ts`, `runtime/server.ts`, thread handlers, ACP turn/permission/projector modules, focused projection store, contracts/SDK and shared renderer chat state.

## 4. Optional Pi Durable SQLite trial

The approved write-capability extension is visualized in [the Pi Durable write approval flow](../architecture/changes/2026-10-04-pi-durable-write-approval.html) and its [typed source](../architecture/changes/2026-10-04-pi-durable-write-approval.workflow.json).

1. Pin actual published 1.0.1 dependency APIs; implement local ESM build/packaging entry. Verify executor engine/SQLite and surface capability diagnostics before any tool or model execution.
2. Add opt-in `agents/pi-durable/` definition, singleton worker host and typed submit/watch/cancel request/response/event protocol. Add a narrow runtime dispatch/cancel/state seam in Core; Durable uses the global worker while traditional runtimes keep ACP. Keep upstream Chord types behind the adapter. Support a configured compatible Node executable; default Electron 35 executor is unavailable for this trial unless its verified engine satisfies upstream. No Electron upgrade in scope.
3. Keep exactly one `pi-durable.sqlite` per Core user-data instance, owned by one worker/Harness, with a single owner lock. Persist one independent Conversation per Core thread and strict identifier domains. Create the conversation and its Core identity document atomically inside Durable, then save Core mapping; recover missing mappings by that identity. Never let per-thread children open the shared file.
4. Add durable submit metadata carrying Core submission identity; reconcile double-database crash windows with upstream requestId. Startup starts one worker and actively reattaches unfinished conversations/runs, restores registry/model/environment first, then resumes. Worker crash reconciles all attached runs with bounded restart backoff; Core shutdown drains it once. Thread idle close or deletion must not terminate the global host. Keep per-conversation credentials/cwd/cancel state isolated and use request correlation IDs for concurrent worker responses.
5. Override generic ACP process-failure/provider-mismatch behavior only for Durable capabilities: recoverable execution cannot be marked terminal or silently replaced. Missing recovery configuration is blocked.
6. Project native Durable state idempotently into the unified snapshot/messages/usage, support explicit cancel, and expose workspace-bounded text writes behind the `workspace.write` deny policy and a per-write thread approval card. Add a private worker approval request/decision protocol; Core persists/audits the approval and routes the existing keyed thread action back to the exact pending tool call. On restart, expire ephemeral pending Durable approvals before resuming.
7. Implement `write_file` in Core with realpath containment, target symlink rejection, pre-approval baseline capture, same-directory exclusive temporary-file + atomic create/rename, a 64 KiB UTF-8 content bound, and idempotent success only when current bytes already match the approved content. Reject divergent conflicts, missing parent directories, binary/NUL payloads, traversal/symlink escapes, policy denial and stale approval. Every write prompts even if workspace default is allow. Keep delete/bash/MCP/sandbox unavailable. The Pi tool is replay-unsafe so an interrupted side effect is never silently repeated.
8. Third-stage QA: one real SQLite and controlled provider/read/write tool; workspace policy allow/ask/deny; approve/reject/stale/restart decisions; duplicate owner; worker-wide crash recovery; concurrent threads/workspaces; cancellation; filesystem race/symlink/path/atomicity/idempotency/conflict cases; Core/worker kill at conversation-binding/submit/mapping/terminal transitions. Verify original Pi path separately.

Primary modules: new `agents/pi-durable/`, existing agent registration/launch, ACP transport/session/response coordination, runtime config/capabilities, build/packaging scripts, private runtime data path resolver, focused binding store and singleton worker lifecycle/protocol.

## Data / API / configuration changes

- Add submission, delivery/attempt and projection/binding tables via additive migrations; avoid inventing historical receipts or requeueing old unknown side effects.
- Add request/submission identity and statuses to shared contracts; preserve existing positional SDK signatures with optional arguments.
- Add thread snapshot/watch and audited delivery reconciliation endpoints; apply existing access checks.
- No public API is added for Durable approvals: use the existing approval records, thread permission card, keyed thread-action route, and security audit trail through a private worker protocol.
- Add experimental runtime selection and compatible Node executor path config; reject unsupported configuration explicitly.
- Runtime storage uses safe opaque thread keys and does not persist credentials.

## Verification and acceptance sequence

Each minimal slice follows RED → GREEN → REFACTOR; keep failing regression evidence. Unit tests cover path/policy/atomic-write reducers; integration tests cover the worker approval round-trip, existing thread action UI contract, security audit, stale approval after restart, and real filesystem writes; real SQLite and subprocess fault injection cover transaction/process boundaries. Add BDD scenarios where restart/retry behavior reads naturally.

Run targeted tests at each stage, then existing typecheck/build/static gates. For API changes, record real request admission latency and recovery timing, check queue/buffer bounds rather than inventing a performance threshold. Actual channels/models requiring credentials are separately recorded PASS or BLOCKED.

Before independent review, follow `docs/architecture/maintenance.md`: update `docs/architecture.md`, official system/ACP sequence/run lifecycle/scheduled-delivery specs, this semantic record, overview and README New/managed block. Render current actual artifacts; proposed diagrams must not be represented as implemented facts. Respect manifest `readme.mode: inline-mermaid`.

Final verification: `pnpm verify`, compatible-node runtime smoke, actual packaged path capability smoke, relevant application/API/UI main paths, and independent Spec/Architect/adversarial review by an agent not involved in implementation. Fix valid findings and rerun affected checks. Record each Spec AC in a QA evidence matrix.

## Known environment conditions and diagram evidence

- Dependencies are not installed in this worktree yet; install only in the implementation phase.
- `scripts/lint-architecture.mjs` currently requires `.agents/skills/archify/bin/archify.mjs`, absent in this checkout. Global skill CLI exists at `/Users/momo/.agents/skills/archify/bin/archify.mjs`. During implementation, resolve the gate's portable provider lookup without committing machine-specific paths; do not label the existing gate PASS.
- Diagram validation/delivery and browser receipts are stored alongside the artifact; report their actual outcome independently from implementation QA.
- Unsupported packaged Electron Node is a declared trial capability restriction. Live model/channel credentials, if unavailable, remain explicit external QA limitations.
