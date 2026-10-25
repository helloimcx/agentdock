# 2026-10-25 — Mesh Remote Operation Receipt Recovery

- Architecture Impact: Required.
- Base revision: `34db1201b43185fe15cbc4ed64fe51c3a2037ca2` (`origin/main`).
- Affected components: Mesh contracts, Core request persistence and WebSocket gateway, NodeAgent local storage, Mesh CLI and SDK, architecture documentation.
- Active provider: Archify at CI-pinned revision `25cf37080fc8b1dbe758a4efc3935b55f3327083`.
- As-built sequence: [Mesh remote operation recovery](2026-10-25-mesh-operation-recovery.html).
- L1 comparison: [before/delta/after](2026-10-25-mesh-operation-recovery-architecture-delta.html), [comparison receipt](2026-10-25-mesh-operation-recovery-architecture-delta.json).

## Semantic delta

Mesh now separates a caller's stable logical `operationId` from the persisted dispatch identity `mesh-request:<uuid>`. Core binds an operation ID to one node and a canonical digest of the capability, arguments and timeout. An identical submission returns the existing request; reusing the ID for a different node or payload returns HTTP 409.

New NodeAgent clients negotiate `execution-receipts-v1`. Before invoking a capability, the node reserves a bounded receipt entry and persists a `running` intent. It saves the terminal result before sending the WebSocket acknowledgement. If Core loses that acknowledgement or restarts, it queries the same authenticated node and attaches the saved observation to the original request. Per-node persisted cursors rotate receipt queries in batches of 100 so unresolved records cannot indefinitely block later pages.

The original dispatch state remains an audit fact. A recovered result appears under `MeshExecution.recovery`; it does not rewrite `interrupted`, `timed_out` or `cancelled`. Core never replays an operation. A crash between the external effect and the terminal receipt remains `unknown`.

Receipt storage is a private SQLite sidecar beside the configured node state file. It is bounded to 200 records, seven days of terminal receipt retention, 2 MiB per result and 16 MiB of total result/reservation bytes. If a new reservation cannot be made without removing unresolved work, the node rejects it before the capability runs. Core's operation index remains authoritative after a device receipt expires.

## Ownership and compatibility

- Core owns operation identity, request history, query cursors and the cross-restart recovery decision in `mesh_operations`, `mesh_executions` and `mesh_recovery_cursors`.
- Each device owns only its private execution-intent and result journal. The Mesh administrator token is not sent to the node.
- Older protocol-v1 nodes that omit the feature continue using the existing execution path. Existing callers may omit `operationId`; Core creates a fresh internal identity, preserving request-per-dispatch behavior.
- A node restart with a persisted `running` intent converts it to `unknown`; neither Core nor NodeAgent executes it again.
- `GET /api/local/v1/mesh/nodes/:nodeId/operations/:operationId`, SDK `getOperation`, and CLI `operation` expose authenticated operation status and recovery observations.

## Code and test evidence

- Contracts and validation: `packages/contracts/src/mesh.ts`, `apps/daemon/src/mesh/mesh-validation.ts`.
- Core identity, paging and recovery persistence: `apps/daemon/src/mesh/mesh-store.ts`, `apps/daemon/src/mesh/mesh-gateway.ts`.
- Private device journal and execution ordering: `apps/daemon/src/mesh/mesh-receipt-store.ts`, `apps/daemon/src/mesh/node-agent.ts`, `apps/daemon/src/mesh/node-cli.ts`.
- Client lookup: `packages/sdk/src/mesh.ts`.
- Regression tests: `tests/electron/mesh-store.test.ts`, `tests/electron/mesh-receipt-store.test.ts`, `tests/integration/mesh.test.ts`, `tests/integration/mesh-auth.test.ts`.

## Provider artifacts and validation

- L1 source SHA-256: `dfeaf7b37fc9a14d34457e97cf997e6aa52384544fc60673ba9a3d1f9eef5002`; delivered `system-architecture.html` SHA-256: `3e9934e0d58e1d3363886179fe40deebfa8eded2196206d1d3e965c38d03e053`.
- L2 sequence source SHA-256: `4c525a771ac22c5fd0e044b8352415120e3e6056d6b080b558923e9214037272`; delivered HTML SHA-256: `7df9bc6b3ef2eeb8e2890e32ee1388bb59cb691b808ca355fa04b0f89739df48`.
- [PASS] Archify comparison: 28/28 checks; one receipt database component, two protocol edges and one device boundary added.
- [PASS] CI-pinned `pnpm lint:arch`: 9 specifications passed 9 showcase checks each; 0 errors and 0 warnings.
- [PASS] L1 and L2 Archify delivery: 9/9 artifact checks each; both automated browser checks passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320, with light/dark captures.
- [PASS] Perceptual review inspected the delivered L1 and L2 artifacts in light and dark themes at 1440×900 and the L1 composition at 2048×1320; no visible clipping or label collisions found.
- [PASS] Focused Mesh store, receipt, gateway and SDK tests: 17/17 passed.
- [PASS] `pnpm typecheck`.
- [PASS] `ARCHIFY_BIN=.tools/archify/archify/bin/archify.mjs pnpm verify`: typecheck, all lint gates, all 9 architecture specifications, 1,135 compiled Node tests under coverage, and 80 BDD scenarios / 286 steps.
- [PASS] Final diff review and `git diff --check`. Independent review caught recovery-query starvation beyond the first 100 records; persisted per-node cursors and a 250-record restart regression test now cover bounded page rotation. Follow-up review found no remaining findings.
- [N/A] Physical-device testing was not performed; recovery was exercised through local HTTP/WebSocket integration with SQLite-backed Core and node stores.
