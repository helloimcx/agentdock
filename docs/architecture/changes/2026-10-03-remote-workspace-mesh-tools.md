# 2026-10-03 — Remote Workspace Mesh Tool Execution

- Architecture Impact: Required.
- Base revision: `codex/2026-10-03-remote-workspace-mesh-tools` worktree, branched from `main`.
- Active provider: Archify; architecture specs validated via `pnpm lint:arch`.

## Semantic delta

Add **Remote Workspace Mesh Execution Mode** to AgentDock:
1. **Mesh Write Capability**: Added `filesystem.write` to Mesh protocol (`packages/contracts/src/mesh.ts` and `services/local-ai-core/src/mesh/node-capabilities.ts`) supporting atomic writes up to 1 MiB with parent directory auto-creation and realpath path confinement within `--root`.
2. **Synchronous Execution Gateway**: Extended `MeshGateway` with `executeAndWait()` and `POST /api/local/v1/mesh/execute` for synchronous request dispatch and immediate promise resolution when client results arrive via WebSocket.
3. **Execution Backend**: Implemented `RemoteMeshExecutionBackend` (`mode: 'mesh'`), anchoring server-side agent execution to a local shadow directory (`<baseDir>/remote-shadow/<workspaceId>`) to prevent filesystem ENOENT issues while delegating tools.
4. **Transparent MCP Tool Bridge**: Injected `agentdock-remote-mesh` MCP stdio server providing standard `read_file`, `write_file`, `list_directory`, `execute_command`, and `bash` tools that communicate with `MeshGateway.executeAndWait()` without modifying agent prompts or model expectations.
5. **ACP Protocol Bridge**: Wired `LocalCoreAcpTurnCoordinator` to transparently handle ACP filesystem RPC requests (`fs/read_text_file`, `fs/write_text_file`) by delegating directly to `MeshGateway.executeAndWait()` for remote sessions.
6. **Workspace UI**: Added device selector to Workspace creation dialog and basic settings panel in renderer (`src/pages/Desktop/`), allowing users to bind workspaces to online Mesh nodes (`node:<uuid>`) or local host (`local`).

## Compatibility and evidence

Existing local execution and sandbox container backends remain 100% untouched. Remote workspaces are opt-in when `device_id` starts with `node:`. Agents running on remote workspaces have zero awareness of the network jump, preserving compatibility with all ACP agent drivers (Pi, Claude Code, Codex, Hermes, OpenCode).

Evidence:
- `packages/contracts/src/mesh.ts`
- `packages/contracts/src/workspace.ts`
- `packages/plugin-sdk/src/agents.ts`
- `services/local-ai-core/src/mesh/node-capabilities.ts`
- `services/local-ai-core/src/mesh/mesh-gateway.ts`
- `services/local-ai-core/src/execution/remote-mesh/`
- `services/local-ai-core/src/acp/local-core-acp-transport.ts`
- `services/local-ai-core/src/acp/local-core-acp-turn-coordinator.ts`
- `tests/electron/mesh-node-policy.test.ts`
- `tests/integration/mesh.test.ts`
- `tests/integration/remote-workspace-mesh.test.ts`
- `src/pages/Desktop/`

## Provider and verification

- [PASS] `pnpm typecheck`: Clean (0 errors).
- [PASS] `pnpm build`: Electron and Renderer builds succeed without errors.
- [PASS] `pnpm test`: 860 Node.js tests passed (0 failed, 1 skipped); 80 Cucumber BDD scenarios (286 steps) passed.
- [PASS] `pnpm lint:gates`: 0 circular dependencies, 0.00% duplicates, dead code within limits, 108 complexity warnings (within baseline).
- [PASS] `pnpm lint:arch`: L1-L3 showcase validations passed.
