# Mesh Remote Operation Recovery

## Goal

Recover a device operation's saved result after a lost WebSocket acknowledgement or Core reconnect, and let callers safely repeat the same logical request without dispatching it twice.

## Scope

- Add an optional stable `operationId` to Mesh execution requests. Keep the existing `mesh-request:<uuid>` as the identity of one persisted Mesh request/dispatch.
- On Core, persist a canonical digest binding one `operationId` to one node and request, return the existing record for an identical repeat, and reject reuse with different input or target node.
- Negotiate an optional `execution-receipts-v1` node feature. Older nodes that do not advertise it continue using current protocol behavior.
- Give receipt-capable NodeAgent a private local SQLite journal beside its configured credentials state. Persist operation intent before execution and a bounded terminal receipt before returning the WebSocket result.
- After a same-node reconnect, query saved receipts for interrupted requests in rotating batches of at most 100 operations per node. Persist the per-node page cursor so unresolved `running` observations cannot starve later operations. Store a confirmed receipt separately from the original dispatch status so timeout/cancellation history remains accurate.
- Expose `GET /nodes/:nodeId/operations/:operationId` through the authenticated Mesh API and SDK/CLI. Do not pass the Mesh administrator token into Agent processes.

## Non-goals

- Automatically replay `shell.exec`, file writes, or any other remote side effect.
- Claim exactly-once execution for arbitrary commands or external systems.
- Infer a Mesh operation ID from Butler Task, Delegation, or Operation IDs. They represent different work; explicit trusted propagation can be designed separately.
- Add a remote queue, change ACP execution ownership, or replace Mesh with SSH.

## Behavior and interfaces

- A caller may supply a stable `operationId` for a logical Mesh action. If omitted, Core generates one for receipt tracking, but a caller that loses its initial HTTP response cannot deduplicate a later submission unless it had supplied the ID.
- `MeshExecution.id` remains a unique `mesh-request:<uuid>`. `operationId` identifies the caller's intent. A unique Core `operationId` mapping binds that intent to one `nodeId`, request, and argument digest.
- An identical duplicate returns the existing request and does not dispatch a second `execute`. A node or argument digest mismatch returns a conflict. An interrupted request is never turned into a fresh dispatch by resubmitting the same ID.
- New nodes advertise receipt support in the existing `hello` exchange. Core sends receipt queries only to a currently authenticated session for the same node. Queries are read-only and contain bounded batches of operation IDs and argument digests.
- NodeAgent records `running` before invoking a capability, then persists its bounded result/error before sending `result`. A matching completed receipt is returned without executing again. An ID with a different digest is rejected. An entry left `running` after process restart is reported as `unknown` and is never re-executed.
- Core stores `MeshExecution.recovery = { state, observedAt, result?, error? }` separately on the original request. `state` is `completed`, `failed`, `unknown`, `expired`, or `unsupported`; the dispatch's original `cancelled`, `timed_out`, or `interrupted` status remains visible.
- The receipt journal retains results for 7 days, up to 200 entries, 2 MiB per result, and 16 MiB of total result data. On pressure, it evicts the oldest terminal result first; if no space can be freed without evicting unresolved work, it rejects a new receipt-backed operation before its side effect starts. Core's operation mapping remains authoritative after a node receipt expires, so the same ID is not dispatched again.
- The unavoidable crash window between an external effect and saving its terminal receipt remains `unknown`. A Mesh receipt can recover only work for which the node durably recorded the result.

## Constraints and compatibility

- Architecture Impact: **Required**. This adds a public protocol feature, node-local persistence, and a cross-device reconciliation flow.
- Existing protocol-v1 nodes and clients remain compatible. Receipt messages require explicit feature negotiation; callers omitting `operationId` retain request-per-dispatch semantics.
- Core remains the owner of request history and identity mapping. Each device owns only its private execution receipt journal. Butler remains the owner of business-task state and external task references.
- Receipt reads require authenticated same-node transport. Result payloads are bounded and stored with the node's existing private-file protections; the global Mesh admin token is never sent to nodes.
- A Core database with old `mesh_executions` rows must start without data rewrite or loss. New operation indexes are additive. Legacy requests without a negotiated receipt identity remain readable and are never replayed; they are not upgraded retroactively into recoverable operations.

## Acceptance criteria

1. Reposting an identical `(operationId, nodeId, capability, args)` returns the original stored Mesh request and produces no second device dispatch.
2. Reusing an `operationId` with a different node, capability, or arguments is rejected before dispatch.
3. If the node durably saved a terminal result but Core missed the acknowledgement, a same-node reconnect restores that result to the original Core request without rerunning the capability.
4. If the node restarts with only a persisted `running` intent, reconciliation reports `unknown`; Core and NodeAgent do not execute that operation again.
5. `cancelled`, `timed_out`, and `interrupted` dispatch states remain in history when a later receipt observation is attached.
6. A receipt from another node, an unsupported node, an expired receipt, an oversized result, or a digest mismatch cannot mutate the matching request as a confirmed success.
7. Older nodes and callers that omit new fields continue their existing behavior.
8. Core restart preserves the request-to-operation mapping and can query a negotiated, reconnected node.
9. Existing Mesh persistence fixtures and stored request rows remain readable.
10. More than 100 unresolved receipt-backed operations are visited across successive reconnects, including after Core reconstruction.

## Test strategy

- Store tests: same-key same-payload deduplication; same-key mismatch; legacy rows; transactional recovery observation; result and retention bounds.
- NodeAgent tests: intent persisted before execution; terminal receipt saved before result send; duplicate completed key returns stored receipt; stale `running` key returns unknown; digest mismatch fails closed; storage capacity blocks execution before side effects.
- Integration tests over real local HTTP/WebSocket processes: dropped acknowledgement then reconnect; Core restart then reconnect; NodeAgent restart after completed receipt; NodeAgent restart after persisted intent; unsupported legacy node; cross-node and stale-session receipt; timeout/cancel observation; bounded receipt expiry.
- End-to-end QA: use the authenticated CLI/API to execute and query one receipt-backed operation through an isolated test node; verify the side effect count and returned receipt independently.

## Architecture records

On implementation, update `docs/architecture/mesh.md`, the L1 system diagram, one semantic change record, `docs/architecture/overview.md`, and the managed README architecture block. Validate the final typed specification and outputs with `pnpm lint:arch`. The proposal sequence diagram is [here](../architecture/changes/2026-10-25-mesh-operation-recovery.html).
