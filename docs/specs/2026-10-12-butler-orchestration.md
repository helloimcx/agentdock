# Butler orchestration

Date: 2026-10-12. Approved: the user requested development after reviewing the product proposal.

## Goal

The user delegates goals to a Butler that coordinates agents in existing workspaces and follows their progress until delivery or a user decision.

## Scope

- Configure a dedicated existing workspace as the Butler; reuse its configured Agent and provider. A primary thread supports desktop entry; channel conversations in that workspace retain separate ownership.
- Durable goals with keyed child assignments, explicit workspace selection, dependencies, exact execution IDs and results.
- Dispatch across workspaces concurrently; serialize Butler assignments within a workspace. Preserve normal workspace permissions; do not copy owner allow-all or bypassPermissions into children.
- CLI and managed skill for natural language assignment, progress queries, followups and cancellation. UI for setup, conversation entry and delegated task inspection.
- Core follows committed run/submission/approval facts. Reconcile on events and bounded background checks. Persist notification identity before waking the owner; coalesce when the owner is busy.
- Owner may inspect a child thread and resolve its existing permission cards. Requests from other channel threads cannot inspect or mutate an owner's goal through Butler commands.

## Non-goals

No new model runtime, automatic provider selection, agent-to-agent unrestricted messaging, new channel connectors, or automatic permission approval. Run completion remains an execution fact; the Butler must evaluate the deliverable against the user's goal.

## Behavior / Interfaces

`/butler/profile` GET/PUT configures workspace and primary thread. `/butler/tasks` GET/POST lists and creates goals. `/butler/tasks/:id` GET, `/followup` POST and `/cancel` POST read and control goals. Owner thread is explicit and checked. `requestId` makes create/followup admission idempotent; conflicting duplicate payloads fail.

An assignment uses keys for dependencies in its goal; cycles, missing keys, duplicates, invalid/removed workspaces, recursion into the Butler workspace and oversized inputs fail before dispatch. Child IDs, goal IDs, AgentTask IDs and run IDs remain distinct.

Followup is a durable queued request, not a promise of immediate steering of a live run. Cancellation is persisted before interrupting executions; late completion cannot revive a cancelled goal. Failed dependencies block dependent work with an explicit outcome. Restarts reconstruct observations and resume unsent work; uncertain already-submitted execution is not blindly replayed.

## Constraints / Compatibility

Additive SQLite storage, shared contracts and SDK. Existing chat, workspace, Mesh, scheduled and automation paths preserve their behavior. Dedicated workspace selection is explicit. Progress summaries use actual state and results, never invented percentages. The Core must remain running for background orchestration.

## Acceptance Criteria

1. Configure a Butler and reach its primary chat from the UI; persona remains present on subsequent messages and channel threads in that workspace.
2. One goal delegates to two real-configured workspaces with independent child threads; independent children can execute concurrently and same-workspace children queue.
3. Dependencies run only after prerequisite completion; invalid graphs create no work.
4. Track the exact active execution and approval state; owner receives a coalesced completion/blockage update, with no per-token model calls.
5. Followups survive restart and retain their own request/run identities; cancellation prevents pending dispatch and cannot be undone by late events.
6. Restart does not duplicate acknowledged creation or execution; uncertain outcomes are explicit.
7. CLI owner checks and API validation reject cross-thread mutations and malformed data. Child permissions use existing rules.
8. UI, SDK, CLI, persistence and integration tests plus repository gates pass; real HTTP/CLI and browser QA are recorded truthfully.
