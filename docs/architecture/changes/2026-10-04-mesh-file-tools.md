# 2026-10-04 — Mesh runtime context, file routing and memory ownership

- Architecture Impact: Required.
- Base revision: `981a53acf5a7baf353ee8bdd51400e37659c5eeb`; implementation is in the `codex/2026-10-04-mesh-file-tools` worktree.
- Active provider: Archify. The planned workflow and the actual workflow use separate immutable source files and HTML exports.

## Semantic delta

Mesh sessions now describe a host control plane and a paired-device workspace target. ACP runtime processes, runtime configuration, credentials and provider-private memory remain on the Core host. Shell commands and workspace file operations are routed to a paired Mesh node only by an explicitly registered runtime profile; file operations are confined to the node's approved root and failures do not fall back to the host shadow workspace. Shell starts in that root but runs with the paired device user's normal OS permissions and is not confined to the root or an OS sandbox.

Claude Code disables its local ACP filesystem tools and receives a Mesh file MCP server. OpenCode denies its local workspace file tools, injects `AGENTS.md` and points its configured shell at the Mesh proxy. Pi uses a wrapper that exposes Mesh extension file and command tools while omitting local built-ins. Codex, Hermes, LocalCore ACP, Cursor, Gemini, Qoder and iFlow are gated from Mesh launch until their runtime-specific enforcement and context delivery are verified. Local and sandbox sessions retain their existing behavior.

Core workspace memory for Mesh workspaces is stored under a stable hashed namespace in Core user data rather than under `remote-shadow`. On first access, Markdown pages from the legacy shadow memory directory are copied into the Core-owned namespace; the old copies remain for recovery. Provider-private memory remains in the provider's host runtime home. Device files and volatile live state remain device-owned.

## Components and boundaries

- Changed: ACP runtime definitions and session coordinator (`services/local-ai-core/src/agents/`, `src/acp/local-core-acp-session-coordinator.ts`) own the runtime support profile, truthful context delivery and local-tool enforcement.
- Changed: Remote Mesh execution backend and file MCP/Pi extension (`src/execution/remote-mesh/`) own runtime wrappers, file-tool registration and dispatch through the existing authenticated Mesh API.
- Changed: Workspace memory service and Local AI Core server bindings keep Mesh Core memory under Core user data and copy legacy Markdown pages without deleting them.
- Existing boundary retained: `MeshGateway` and `agentdock-node` still authorize each request and confine paths to the node's approved root; no new public route, identity domain or node capability was added.

## Compatibility and migration

Three adapters are configured and covered by repository-level routing/configuration tests. This does not claim provider-version end-to-end validation for every installed runtime. Other registered runtimes fail before shadow directory creation, with a runtime-specific reason. Existing Mesh memory Markdown is copied lazily on first Core memory access; legacy files are preserved. Local and sandbox workspace paths remain unchanged.

Keep existing `lac` commands unchanged. Mesh already provides host-side `agentdock-node execute`; a future `lac mesh exec <node-id> -- <program> <arg>...` can be an additive operator/script command over the same gateway. It cannot replace runtime adapters because a command inside the agent's intercepted Shell runs on the device, and native file tools do not automatically invoke a CLI.

## Evidence

- Runtime profile and startup gate: `services/local-ai-core/src/agents/registry.ts`, `services/local-ai-core/src/execution/remote-mesh/remote-mesh-backend.ts`.
- Context and file routing: `services/local-ai-core/src/execution/remote-mesh/device-environment.ts`, `remote-mesh-mcp-server.ts`, `pi-mesh-extension.ts`, `services/local-ai-core/src/acp/local-core-acp-session-coordinator.ts`.
- Core memory namespace: `services/local-ai-core/src/runtime/server.ts`, `services/local-ai-core/src/memory/workspace-memory-service.ts`.
- Compatibility table: [Mesh runtime compatibility](../mesh-runtime-compatibility.md).
- Planned workflow: [Archify workflow source](2026-10-04-mesh-runtime-context.workflow.json) · [HTML](2026-10-04-mesh-runtime-context.html).
- As-built workflow: [Archify workflow source](2026-10-04-mesh-runtime-context-as-built.workflow.json) · [HTML](2026-10-04-mesh-runtime-context-as-built.html).

## Validation

- [PASS] `pnpm typecheck`.
- [PASS] Focused Mesh, shell, ACP metadata, filesystem and workspace-memory integration tests: 37 tests passed after the host-shell snapshot fix.
- [PASS] `pnpm lint:arch`: five architecture specs passed all nine showcase checks; the visual-check receipt was skipped as a non-spec JSON file.
- [PASS] Local documentation links checked across eight changed documentation files; `git diff --check` clean.
- [PASS] Archify delivered planned and as-built workflow HTML; automated browser containment/readability checks passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320. Captured light/dark screenshots at 1440×900 and 2048×1320 were visually inspected.
- [PASS] Independent review found that Claude's Mesh shell wrapper could execute snapshot command text on the Core host and write a model-selected cwd marker there. The wrapper now ignores snapshot bootstrap invocations and never writes that marker locally; a malicious marker regression test passes.
- [N/A] Physical devices and provider runtime binaries were not exercised end-to-end; “enabled” means adapter configured and repository-level behavior covered.
