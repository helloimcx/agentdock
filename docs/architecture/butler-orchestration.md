# Butler LAC Orchestration

The Butler is a concrete channel bot that serves as the user's long-lived point of contact. In the new `core` transport, Local AI Core dispatches work directly to the workspace runtime bound to a configured managed bot. The bot roster remains the authorization and user-facing selection list; the worker's workspace, device, runtime, agent type, and provider are captured as a separate execution binding. The legacy `channel` transport continues to send app-scoped bot-to-bot messages for existing profiles and tasks.

## Ownership and dispatch

- The manager bot must be connected and its Butler thread must belong to its local Core workspace. Managed bots are selected by stable bot identity and explicit binding. Core mode does not require a shared group, group-visible names, or a connected managed-bot channel; it still requires the saved workspace runtime to remain available and match the captured execution binding.
- Legacy Channel submissions retain delivery certainty in the Butler ledger. An explicit HTTP 400 on an initial bot message is recorded as a failed submission; timeouts and other unconfirmed responses remain `unknown` and are not resent. During profile changes, Core locally closes only historical HTTP 400 submissions with no run ID or platform message ID. This recovery updates task, delegation, and operation records without sending a compensating, follow-up, or cancellation message to any bot.
- A core delegation gets its own worker thread and one or more distinct Operations. Core uses WorkspaceRouter and the ordinary ACP submission lifecycle. It does not copy the Butler's chat history or channel route into worker execution, and workers are instructed not to contact users or other bots.
- Task, Delegation, Operation, thread, run, and an external system's task ID are different identifier domains. SQLite owns the Butler business ledger; submission/run state remains owned by the ACP submission store.
- Goal ownership records a stable Butler principal: Lark instance plus workspace and platform user ID, or the local workspace principal for an unbound local thread. Orphan listing and reattachment require the same principal, so another member of the configured bot cannot take over a user's deleted conversation. Notification records are linked to one Task; reattachment moves only that Task's notices.
- `/api/local/v1/butler/agent` requires a Core-issued HMAC capability bound to the active thread/run; worker claims also resolve to one task and delegation. A worker can report its own operation, but cannot inspect the roster, create or extend goals, choose recipients, or act on another task through the supported `lac butler` interface. The capability is process-local, expires, and is regenerated when Core starts a new run. It does not sandbox arbitrary Shell or raw localhost HTTP access from a same-user local agent; those remain within Local AI Core's existing local trust boundary.
- Selected standalone `lac butler` commands can be routed through the remote Mesh host dispatcher using the launch thread/run context. The allowlist parses individual commands; ordinary Shell remains on the remote node. This is a narrow CLI route, not an OS sandbox for agents that already have Shell access.

## Durable task lifecycle

The new path separates business progress from a single agent run:

1. `create` or `delegate` records the goal and bot assignment before Core submits the worker operation. `delegate <task-id>` appends new work to that goal and is idempotent by request ID.
2. After creating an external side effect, a worker can use `lac butler report --phase checkpoint` to persist the exact external reference while its run is still active. The final report is bound to the same thread, run, and operation, and is settled only after the run ends successfully. A checkpoint is recovery data, not proof of completion.
3. A `waiting_external` final report wakes the Butler. The manager registers a read-only check plan with `watch`, including the precise check instructions and interval. Core persists the next check, deadline, budget, and an atomic lease in SQLite. A check queries the recorded external ID and does not resubmit the original side effect.
4. Unchanged checks are rescheduled with bounded backoff. A changed result, completion candidate, missing report, failure, permission request, exhausted budget, or binding mismatch wakes the owner thread or leaves a visible blocked state for the Butler to resolve.
5. A `succeeded` report enters `reviewing`; it is not an accepted business result. The Butler checks the evidence and calls `accept` with the exact report version. Only accepted delegations release dependent work. When every core delegation is accepted, the Task closes and the result is queued to the original Butler conversation.

Default tracking policy is a ten-minute interval, thirty checks, and a seven-day deadline. Intervals may be set from one minute to one day; the check budget is bounded to 1–200 and deadline to 1–30 days. These values are stored on the task so later profile changes do not rewrite an active goal.

Core recovery never automatically repeats an uncertain external side effect. If a run ends after a checkpoint, the external ID remains on the delegation and the Butler can explicitly register a read-only watch or follow up the worker. If Core restarts during a due check, the persisted lease and request identity prevent stale or duplicate writes. Check instructions and historic worker reports are treated as untrusted data in the worker prompt.

## Permissions, notifications, and cancellation

- Worker permissions stay in the worker workspace's existing permission lifecycle. Core surfaces the exact actionable approval ID to the owner conversation and never approves it on behalf of the user. Waiting for permission suspends routine checks.
- Important task changes are durably queued and delivered to the original owner thread, retaining its existing channel route. Internal worker activity and unchanged checks do not post into the shared bot group.
- If an owner thread is deleted, active goals pause in `waiting_for_user` with their external references and worker state intact; terminal goals retain their status and become recoverable if a notice is pending. Only a live Butler conversation with the same owner principal can list and reattach those goals. Reattachment moves that Task's notices only; other goals and their notices stay with their existing owners.
- `cancel --mode tracking` stops Butler tracking and interrupts active worker runs, but explicitly reports that an external download may continue. `cancel --mode external` asks the worker to cancel the recorded external task and verify the terminal state. Without a stable external reference or verifiable cancellation evidence, Core leaves the task blocked or awaiting confirmation rather than claiming it stopped.

## Legacy channel transport

Legacy tasks continue to use Lark group messages with explicit app-scoped bot mentions. That path still validates both bots' exact group-visible names against their respective app credentials and validates callbacks against sender, receiving runtime, group, operation, and task. Existing tasks keep their original transport; failures do not fall back from core to group messages or vice versa. Weixin Work remains available for ordinary channel conversations but is not a Butler worker transport in this version.

## Interfaces and artifacts

The Core API supports bot discovery and profile configuration, owner-scoped task create/list/get, `followup`, `cancel`, `complete`, `accept`, `watch`, and appending delegations. Agent commands use the capability-protected `/butler/agent` endpoint; local management HTTP routes follow the same-user trust model used by other Local AI Core APIs. Shared contracts and the SDK are in `packages/contracts/src/butler.ts` and `packages/core-sdk/src/butler.ts`; CLI handlers are in `services/local-ai-core/src/cli/butler-cli-handlers.ts`.

- [Current Butler workflow](butler-orchestration.html) and [typed source](butler-orchestration.workflow.json)
- [2026-10-17 implementation specification](../specs/2026-10-17-butler-lac-orchestration.md) and [implementation plan](../plans/2026-10-17-butler-lac-orchestration.md)
- [Semantic change record](changes/2026-10-17-butler-lac-orchestration.md)
- [Legacy Channel bot management record](changes/2026-10-13-butler-channel-bot-management.md) and [app-scoped mention correction](changes/2026-10-16-butler-app-scoped-lark-mentions.md)

The complete AgentDock clickable prototype is at [`design/index.html`](../../design/index.html). Its Butler configuration now includes the Core transport and persisted tracking policy; the real renderer is pending user confirmation of that prototype.
