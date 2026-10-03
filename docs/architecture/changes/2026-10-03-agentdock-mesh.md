# 2026-10-03 — AgentDock Mesh device tool execution

- Architecture Impact: Required.
- Base revision: `b63a44147e025592469c8911de5c499d21b57027`, initially clean working tree.
- Active provider: Archify; system-architecture.json passed showcase validation and delivered system-architecture.html.

## Semantic delta

Add a Device Plane under Local AI Core: persistent node identities and capability authorization, an outbound WebSocket gateway, a request dispatcher, and a portable `agentdock-node` client. Add Mesh REST administration, Core SDK support and a device management UI. Keep ACP sessions, local agent tasks and sandbox execution paths unchanged; Mesh request identities and lifecycle do not alias agent run identities.

Core owns `mesh_nodes` / `mesh_executions` in the existing SQLite database. Nodes own their local directory and execution policy. Pairing establishes a distinct device credential; the gateway intersects advertised capabilities with server permissions. File reads are bounded and confined to a chosen root. Command execution requires explicit opt-in at both ends and runs as the device user, without an OS sandbox.

The new trust boundary uses a separate Mesh administration token, expiring single-use pairing and hash-only retained device credentials. Node connections initiate outbound transport and use verified TLS for non-loopback destinations by default. The bundled web server now forwards Mesh WebSocket upgrades. Each node sees only its own dispatched requests; revocation fences active sessions. Core and node concurrency, message sizes, arguments and output are bounded.

Disconnect, revocation, replacement and restart interrupt unresolved operations without replay. Timeout/cancel asks the node to abort; completed side effects and uncertain outcomes remain visible in history. File results are transferred inline as bounded base64; bulk artifact transfer, queued offline work, remote ACP runtimes and dedicated Android APIs are deferred.

## Compatibility and evidence

Mesh routes are disabled unless `AGENTDOCK_MESH_ADMIN_TOKEN` is configured. Existing APIs and default local-only server binding retain their behavior. SQLite changes are additive. Package binaries now include `agentdock-node`; explicit `ws` dependencies support both source and compiled execution without relying on transitive hoisting.

Evidence: `packages/contracts/src/mesh.ts`, `packages/core-sdk/src/mesh.ts`, `services/local-ai-core/src/mesh/`, `runtime/server.ts`, `bin/agentdock*.mjs`, `src/pages/Mesh/`, and the Mesh tests listed in [the subsystem design](../mesh.md). The lint reporting test now requests verbose output explicitly, so its all-offenders assertion is stable in a dirty checkout; the production lint thresholds remain unchanged.

## Provider and verification

- L1 provider candidate: `system-architecture.json` adds Mesh Gateway and remote device nodes with stable new IDs.
- README and overview: current Mermaid fallback and delivered Archify interactive HTML showcase (`system-architecture.html`) document implemented Mesh edges.
- [PASS] Archify showcase validation / export: all 9 showcase checks passed via `pnpm lint:arch`; `system-architecture.html` delivered.
- [PASS] `pnpm test`: typechecks and both builds; 855 Node tests passed (one real sandbox test skipped for unavailable host capabilities); 80 BDD scenarios / 286 steps passed.
- [PASS] `pnpm lint:gates`: zero cycles / duplicate instances; 171 dead-symbol baseline; within thresholds. No Mesh complexity warnings.
- [PASS] `pnpm coverage`: all configured thresholds passed.
- [PASS] Live Core with bundled WebSocket proxy and two separate CLI processes: pairing, file reads, saved-credential reconnect and revocation.
- [PASS] Chromium UI: authenticate, inspect nodes, select a device, execute a file operation, download and inspect file bytes, create pairing and revoke a device; no page errors or credential retention in localStorage.
- [PASS] Mermaid 12.1.0 official parser and SVG renderer validated the current system fallback and Mesh subsystem diagrams. New documentation links and candidate component/edge references resolve.
- [PASS] `pnpm lint:arch`: passed with 5/5 architecture specifications passing showcase validation.
- [N/A] Physical Android / macOS / Windows testing, dedicated Android APIs and remote ACP agent execution were not performed.
