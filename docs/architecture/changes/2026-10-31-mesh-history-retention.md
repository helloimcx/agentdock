# 2026-10-31 — Mesh core-side execution history retention

- Architecture Impact: Required.
- Base revision: `059c56446b7629afba66350fdda417f29345cb62` (`origin/main`).
- Affected components: Mesh Core request persistence (`mesh_executions`, `mesh_operations`), architecture documentation.
- No Archify specification changes: no component, boundary, protocol, or ownership change; the Archify L1/L2/L3 specs do not encode retention facts, so existing diagrams remain authoritative. `docs/architecture/mesh.md` prose updated to match the new lifecycle fact.

## Semantic delta

Core-side Mesh history was previously unbounded: every dispatch appended one `mesh_executions` row (with its full result JSON) and one `mesh_operations` dedup row, and no code path ever deleted either. The node-side receipt journal introduced on 2026-10-25 is bounded (200 records, seven-day result retention), but its core-side counterpart grew without limit; production data showed ~46 executions/day with startup `recover()` scanning and JSON-parsing every row.

`MeshStore.pruneHistory(now)` now deletes resolved executions older than seven days together with their `mesh_operations` rows. A record is prunable when it is not `running` and any of: its dispatch status is `completed` or `failed`; its `recovery.state` reached a terminal observation (`completed`, `failed`, `expired`, `unsupported`); or it can never receive a receipt (`receiptSupportedAtDispatch` is not true). In-flight `running` requests and still-recoverable receipt candidates are never pruned. `recover()` runs the sweep first, so restart orphans are preserved and marked `interrupted` as before.

Deleting an operation-index row ends that `operationId`'s dedup window. The seven-day retention matches the node receipt journal's result-retention window: within that window a replayed `operationId` is answered from the node's saved receipt without re-execution, and past it both sides treat the operation as expired, consistent with the documented "Saved result expired; operation was not replayed" behavior. History APIs (`GET /requests`, `GET /nodes/:id/operations/:operationId`) return the retained window only.

## Ownership and compatibility

- Core continues to own identity, request history, the operation index and query cursors; retention adds a deletion rule to existing tables, not a new owner or store.
- `mesh_recovery_cursors` offsets remain valid: `recoveryCandidates` re-filters and applies `offset % count`, so a shrunken candidate list rotates without starvation.
- Older callers see only shortened history beyond seven days; no API shape, protocol, or capability changes.

## Code and test evidence

- Retention sweep and startup hook: `apps/daemon/src/mesh/mesh-store.ts`.
- Regression tests: `tests/electron/mesh-store.test.ts` (retention semantics across terminal / receipt-resolved / unrecoverable / still-recoverable / running records; `recover()` prune-then-interrupt ordering).

## Validation

- [PASS] `npx tsx --test tests/electron/mesh-store.test.ts`: 7/7 (2 new retention tests, RED→GREEN).
- [PASS] `npx tsx --test tests/electron/mesh-receipt-store.test.ts tests/electron/mesh-node-policy.test.ts`: 6/6 unaffected.
- [PASS] `pnpm test`: full suite fail=0.
- [PASS] `pnpm lint:arch` local: all specifications validate; retention is not encoded in any Archify spec.
