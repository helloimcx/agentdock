# 2026-10-04 — Read-only Mesh node overview

- Architecture Impact: Required.
- Base revision: `bc0b453a642e48e521d32dcc848694b99a6a7e10` (`origin/main` used for the final architecture comparison after rebase).
- Affected components: MeshGateway REST authorization, Core SDK Mesh client, React Mesh page, architecture documentation.
- Active provider: Archify; Before / Delta / After artifact: [2026-10-04-mesh-node-overview.html](2026-10-04-mesh-node-overview.html).

## Semantic delta

When Mesh is enabled, anonymous callers can use only `GET /api/local/v1/mesh/nodes` to read node inventory metadata. Pairing, revocation, dispatch/execution, request history, request lookup and cancellation remain protected by the existing administrator bearer token. Mesh remains disabled when `AGENTDOCK_MESH_ADMIN_TOKEN` is absent.

The Mesh page now presents a read-only node overview without a credential prompt. It polls node data and displays node label, ID, platform, status and capabilities. It no longer presents pairing, revocation, execution or request history controls.

## Trust and compatibility

The public read route reveals node ID, label, platform, advertised and allowed capabilities, presence, and timestamps to any caller able to reach Core's Mesh endpoint. This follows the approved scope for read-only node discovery. No schema, database, node protocol, WebSocket authorization, or administrative route behavior changes. Existing SDK callers that supply the admin token retain bearer authentication.

## Code evidence

- `services/local-ai-core/src/mesh/mesh-gateway.ts`: public read-only list branch follows the Mesh-enabled check and precedes administrator authorization.
- `packages/core-sdk/src/mesh.ts`: omits Authorization only when no token is supplied.
- `src/pages/Mesh/Devices.tsx` and `src/pages/Mesh/useMesh.ts`: read-only node listing UI and three-second refresh.
- `tests/integration/mesh-auth.test.ts`: anonymous list, disabled Mesh, protected management/history and SDK header assertions.

## Provider and validation

- Comparison artifact source: `docs/architecture/changes/2026-10-04-mesh-node-overview.candidate.json`.
- README and overview diagram facts: only Mesh node listing is public while Mesh is enabled; management requires administrator token.
- [PASS] Archify comparison: 28/28 checks; candidate matches the reviewed before/delta/after artifact.
- [PASS] `node scripts/lint-architecture.mjs`: 6 specifications passed 9 showcase checks each; 0 errors and 0 warnings.
- [PASS] `archify deliver architecture ...`: 9/9 showcase checks; source SHA-256 `f9884ed62b3b19ac46925aa76a35b8bac11eb7cb39cfd79ff8a90344f5786a7f`, artifact SHA-256 `065191c2f37a8356910a269fb7c56fd0cc8fec1424e904fe944eef73d94a362d`.
- [PASS] `archify visual-check`: automated browser containment and readability checks passed at 1440×900, 1600×1000, 1920×1080, and 2048×1320; light/dark captures passed. Perceptual review inspected the 1440×900 light and dark captures.
- [PASS] `tsc -p tsconfig.json --noEmit` and `tsc -p tests/bdd/tsconfig.json --noEmit`.
- [PASS] Renderer Vite build and Electron/backend TypeScript build with alias resolution.
- [PASS] Targeted Mesh auth integration tests: 4/4 passed, including anonymous node listing, disabled Mesh, rejected anonymous history/mutations, node-token rejection, and SDK headers.
- [PASS] Full compiled Node suite after rebase: 892/892 tests passed.
- [PASS] BDD suite: 80/80 scenarios and 286/286 steps passed.
- [PASS] `node scripts/coverage.mjs`: completed with configured coverage thresholds passing.
- [PASS] Circular, duplication, dead-code, file-size, function-length and ESLint complexity gates; 0 cycles, 0 duplicates, 169 dead-code symbols, 0 oversized files, 45 long functions at the existing limit, and 108 ESLint warnings at the existing limit. Changed implementation files pass focused ESLint with 0 warnings.
- [PASS] `git diff --check`.
- [N/A] A full interactive Mesh UI walkthrough was not run; the actual Mesh HTTP route was verified through the local integration server, and the renderer production build passed.
