# 2026-10-04 — Transparent Remote Mesh Shell & Multi-Device Auto-Adaptation

- Architecture Impact: Required.
- Base revision: `codex/2026-10-04-transparent-remote-mesh-shell` branch, based on `main` (v0.1.84).
- Active provider: Archify; architecture specs validated via `pnpm lint:arch`.

## Semantic delta

Evolve Remote Workspace execution from MCP Stdio Bridge to **Transparent Shell Proxy with Dynamic Multi-Device Adaptation**:
1. **Transparent Shell Proxy (`agentdock-mesh-shell`)**: Introduced a lightweight, platform-neutral shell proxy executable. Injected via `SHELL` environment variable into Agent processes on remote workspaces, intercepting native terminal execution (`-c "<command>"`) and delegating directly to `MeshGateway.executeAndWait()` (`shell.exec`). Output and exit codes are transparently streamed back to the agent's native Bash tool.
2. **MCP Bridge Deprecation & Removal**: Completely removed `agentdock-remote-mesh` MCP server injection from `RemoteMeshExecutionBackend`. Eliminates tool call ambiguity (native Bash vs MCP bash), tool prefix pollution (`mcp__agentdock-remote-mesh__*`), and ACP MCP schema translation overhead.
3. **Multi-Device Dynamic Context Generation**: Dynamically resolves device metadata (`label`, `platform`: `android`, `linux`, `darwin`, `win32`) from registered Mesh nodes. Provisions device-adaptive `CLAUDE.md` and ACP `systemPrompt.append` into the workspace shadow directory. No hardcoded device names or operating system assumptions.
4. **Host Tool Disallowance**: Configured `disallowedTools: ['FileEdit', 'GlobTool']` in ACP session initialization for remote mesh workspaces to prevent server-host filesystem operations from leaking or interfering with the remote session.
5. **Shell Output Buffer Expansion**: Increased default `maxShellBytes` from 32 KiB to 512 KiB in `NodeCapabilities` to prevent premature truncation of system diagnostic commands (`df -h`, `termux-*`, `ps`, `ls`).

## Compatibility and evidence

Existing local execution (`deviceId: 'local'`) and sandbox backends remain unchanged. Remote workspaces continue to run agents on the server with zero container/sandbox setup while routing 100% of shell commands directly to the client device.

Evidence:
- `services/local-ai-core/src/execution/remote-mesh/agentdock-mesh-shell.ts`
- `services/local-ai-core/src/execution/remote-mesh/device-environment.ts`
- `services/local-ai-core/src/execution/remote-mesh/remote-mesh-backend.ts`
- `services/local-ai-core/src/mesh/node-capabilities.ts`
- `services/local-ai-core/src/acp/local-core-acp-session-coordinator.ts`
- `tests/integration/transparent-remote-mesh-shell.test.ts`
- `tests/integration/remote-workspace-mesh.test.ts`
