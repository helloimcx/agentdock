# Mesh Remote Operation Recovery Plan

This is the approved implementation baseline for [the Spec](../specs/2026-10-25-mesh-operation-recovery.md). The final implementation and validation evidence are recorded in [the architecture change record](../architecture/changes/2026-10-25-mesh-operation-recovery.md).

## Architecture Impact

**Required.** Mesh gains an optional receipt protocol, NodeAgent owns durable per-device operation receipts, and Core reconciles saved remote outcomes. This changes cross-process messages, data ownership, and recovery flow.

## Proposed flow

The proposal sequence diagram is [Mesh remote operation recovery](../architecture/changes/2026-10-25-mesh-operation-recovery.html).

```mermaid
sequenceDiagram
  participant Caller as Mesh caller
  participant Core as AgentDock Daemon
  participant DB as Core SQLite
  participant Node as Mesh NodeAgent
  participant Journal as Node receipt journal
  participant Target as Device operation
  Caller->>Core: submit stable operationId + request
  Core->>DB: claim operationId bound to nodeId + argument digest
  Core->>Node: execute(requestId, operationId)
  Node->>Journal: persist running intent
  Node->>Target: execute once
  Note over Node,Target: Crash after side effect and before terminal receipt remains unknown
  Node->>Journal: persist bounded terminal receipt
  Node-->>Core: result receipt
  Core->>DB: persist terminal result
  Core->>Node: after reconnect, query the same operationId
  Node->>Journal: read receipt (no execution)
  Journal-->>Node: completed / failed / unknown / expired
  Node-->>Core: return saved observation
  Core-->>Caller: return result or explicit uncertainty; never replay unknown
```

## Implementation steps

1. **Define additive contracts.** Update `packages/contracts/src/mesh.ts` with optional caller `operationId`, receipt observations, and a node feature name. Update `apps/daemon/src/mesh/mesh-validation.ts` to bound and normalize the new fields. Preserve `MeshExecution.id` as the request/dispatch ID.
2. **Persist Core operation ownership.** Update `apps/daemon/src/mesh/mesh-store.ts` with an additive index keyed by `operationId`, bound to `nodeId`, canonical request digest, and receipt-observation fields. Keep exact duplicates attached to the existing request. Reject target or digest mismatch before `send`. Do not rewrite existing request history.
3. **Persist device receipts.** Add `apps/daemon/src/mesh/mesh-receipt-store.ts`, owned by `NodeAgent`. Pass the configured `--state` path from `apps/daemon/src/mesh/node-cli.ts`; place the sidecar beside it, create it with owner-only permissions, and avoid symlink or overwrite hazards. Persist intent before any capability call and terminal result before websocket send. Retain at most 200 entries for 7 days, at most 2 MiB per result and 16 MiB total result data. Evict the oldest terminal result first. If capacity cannot be reserved without evicting unresolved work, reject receipt-backed execution before running the capability. Report expired/unknown states rather than re-executing when a result was evicted.
4. **Negotiate and reconcile.** Update `apps/daemon/src/mesh/node-agent.ts` to advertise `execution-receipts-v1`, reject changed arguments for a reused ID, return completed receipts for exact duplicates, and expose bounded read-only receipt lookup. Update `apps/daemon/src/mesh/mesh-gateway.ts` to request lookups only from a currently authenticated same-node session that advertised support, rotate through persisted 100-operation pages per node, and reconcile observations into the original Core row. Keep timeout, cancel, and interrupted dispatch status as original audit facts.
5. **Expose safe lookup.** Extend `packages/sdk/src/mesh.ts` and `apps/daemon/src/mesh/node-cli.ts` with caller-supplied operation IDs and `GET /nodes/:nodeId/operations/:operationId` lookup. Do not add administrator credentials to agent runtime environments. Keep APIs for old `mesh-request` IDs unchanged.
6. **Synchronize architecture after implementation.** Update `docs/architecture.md`, `docs/architecture/mesh.md`, the L1 typed system architecture, and one dated semantic change record; update `docs/architecture/overview.md` and the managed README block as required by architecture maintenance. Keep the proposal diagram as the design baseline and deliver a separate as-built diagram only after the code exists.

## Compatibility and migration

- Existing clients may omit `operationId`; Core retains request-per-dispatch behavior and generates an internal ID only for receipt tracking.
- Existing v1 nodes omit the optional receipt feature. Core never sends them receipt-query messages. Their ordinary execution path is unchanged.
- New nodes connected to old Core versions may advertise the optional feature, which old Core ignores. New Core queries only operations that were originally created with receipt support.
- Existing SQLite JSON rows remain readable. The new operation index contains only newly created receipt-aware operations; old rows remain accessible by `mesh-request` ID and are not falsely marked recovered.
- Sidecar receipt data is local to one node credential state and never contains the administrator token. Result bytes are bounded; stale or unpersisted outcomes are reported as unknown.

## Ordered verification plan

1. RED/GREEN for `MeshStore`: exact duplicate, digest conflict, legacy-row preservation, paged receipt queries across more than 100 unresolved requests, and recovery observations that do not erase the original dispatch status.
2. RED/GREEN for `MeshReceiptStore` and `NodeAgent`: pre-effect intent persistence, result-before-ack ordering, duplicate receipt response, running-after-restart unknown, ID collision, and storage-bound behavior.
3. Integration coverage for lost acknowledgement/reconnect, Core restart, node restart after a completed receipt, node restart after only an intent, wrong-node result, unsupported old node, cancellation/timeout races, and result expiry.
4. Run focused Mesh tests, affected type/build checks, `pnpm lint:arch`, and the repository-required risk-appropriate verification. Run one real local HTTP/WebSocket process test and compare the target-side effect count with the saved receipt.
5. Review the complete diff against the Spec, recheck API/CLI latency with real invocations, and record every unavailable real-device check honestly.

## Key design choices

- **Persist receipt, never replay uncertain work.** Receipts recover a lost acknowledgement only after the target-side result is saved. They cannot close the failure window between an external effect and saving its receipt.
- **Keep operation and request IDs separate.** The operation ID deduplicates caller intent; `mesh-request:<uuid>` remains the Mesh history and transport identity. Butler's Task/Delegation/Operation and external task IDs remain separate domains.
- **Keep receipt support optional.** Capability negotiation lets old nodes continue using Mesh v1 while updated nodes opt into recovery.
