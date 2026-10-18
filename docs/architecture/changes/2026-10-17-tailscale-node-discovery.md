# 2026-10-17 — Native Tailscale node discovery and zero-config binding

- Architecture Impact: Required.
- Base revision: `ecc1d6c` (`origin/main`); PR #222 on branch `codex/2026-10-17-tailscale-node-discovery`.
- Prior semantic record: [2026-10-17 Monorepo peer topology normalization and daemon rename](2026-10-17-peer-topology-daemon-refactor.md).
- Active provider: Archify.

## Semantic delta

- Tailscale device discovery service (`apps/daemon/src/mesh/tailscale-service.ts`):
  - Integrates host Tailscale CLI (`tailscale status --json`) to detect local Tailnet presence, self node, and peer nodes.
  - 5-second TTL response caching with in-flight request deduplication prevents subprocess fork-spam.
  - Strict binary path discovery: checks `TAILSCALE_CMD` (throwing descriptive error if configured but non-existent), followed by standard OS paths (`/usr/local/bin`, `/Applications/...`, `/usr/bin`, `C:\Program Files\...`, and `PATH`).
  - Execution timeout bounded to 3000ms.
  - Cache versioning (`cacheVersion` counter) invalidates in-flight responses upon node binding to prevent race-condition repopulation of stale cache without `meshNodeId`.
- Authentication & trust boundary enforcement:
  - Both `GET /api/local/v1/mesh/tailscale/status` and `POST /api/local/v1/mesh/tailscale/bind` are protected management endpoints requiring `Authorization: Bearer <AGENTDOCK_MESH_ADMIN_TOKEN>`.
  - SDK Mesh client (`packages/sdk/src/mesh.ts`) and runtime client dynamically resolve admin tokens per request from caller memory or `localStorage` fallback without needing client recreation.
- Bound node identity & state model:
  - Discovered Tailscale nodes are registered via shared ID helper `tailscaleNodeId(name, dnsName)` yielding `node:ts:<sanitized-name>`.
  - Deterministic naming allows re-binding with identical sanitized names to idempotently update node records (persisting primary Tailscale IP in `label` and updating capabilities) while preserving `createdAt`. Sanitization symbol collapse (e.g. `gpu--server` vs `gpu-server`) updates the existing record rather than duplicating nodes.
  - Revocation preservation: re-binding a node whose status is `revoked` is strictly rejected to prevent bypassing administrator revocation.
  - Bound nodes are created with `status: 'offline'` and `token_hash: NULL`. Because Mesh dispatch requires a live connected WebSocket session, bound devices remain offline until an agent connects via `agentdock-node pair/connect`.
  - Single-source sanitization helper `sanitizeTailscaleName` and `tailscaleNodeId` exported from `@cc/superai-contracts` and `@cc/core-sdk/mesh`.
- Renderer UI:
  - Mesh Devices page (`apps/web/src/pages/Mesh/Devices.tsx`) renders discovered Tailnet peers with status badges, one-click bind actions, and English default fallbacks.
  - Added `AdminTokenCard` credential management card allowing users to configure or update `agentdock_mesh_token` stored in browser local storage, with dedicated `mesh.authRequired` messaging upon 401 Unauthorized responses.
  - Workspace configuration (`apps/web/src/pages/Desktop/workspace-sections.tsx` and `workspace-components.tsx`) displays discovered Tailscale devices in the execution target dropdown, surfacing binding errors and displaying a helpful configuration pointer when Mesh administrator authentication is required.

## Evidence

- Contracts: `packages/contracts/src/mesh.ts`.
- SDK: `packages/sdk/src/mesh.ts`, `packages/sdk/src/runtime.ts`.
- Daemon: `apps/daemon/src/mesh/tailscale-service.ts`, `apps/daemon/src/mesh/mesh-gateway.ts`, `apps/daemon/src/mesh/mesh-store.ts`.
- Web: `apps/web/src/pages/Mesh/Devices.tsx`, `apps/web/src/pages/Desktop/workspace-sections.tsx`, `apps/web/src/pages/Desktop/workspace-components.tsx`.
- Tests: `tests/integration/tailscale-mesh.test.ts`.
