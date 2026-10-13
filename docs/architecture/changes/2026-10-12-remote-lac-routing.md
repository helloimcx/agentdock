# Remote Workspace LAC Routing

## Base and scope

- Base revision: `ab7c1926c702bbd8ebee137369c1c0b999848f1e` (implementation worktree based on this revision).
- Architecture impact: Required. A remote-workspace Shell request can now route to the host Local AI Core, and the Mesh shell authorization path has a new credential boundary.
- Affected components: `RemoteMeshExecutionBackend`, `agentdock-mesh-shell`, the host LAC dispatcher and stdio MCP server, `MeshGateway`, and the remote-device instructions.

## Changed facts

- Remote-workspace Bash keeps its dual destination: an ordinary command is sent to the configured Mesh node; one standalone, allowlisted `lac <domain> <action> ...` command is parsed into argv and run by the host Local AI Core CLI handlers. The host never evaluates the raw command string. LAC detection uses command position, so ordinary remote arguments and pipelines that merely mention `lac` stay remote. Only a recognized Claude bootstrap/eval/pwd wrapper is unwrapped; arbitrary conditional prefixes are preserved. Snapshot initialization stays on the node, and Claude's cwd marker may only be created inside that session's shadow temp directory. Unsupported compound LAC forms fail with an explicit message.
- The host LAC dispatcher allows no-file memory, scheduler, monitor and automation operations. Structured `agentdock-lac-control` MCP currently exposes read-only memory search/list and scheduler, monitor and automation list tools. Both entry points call the same dispatcher and use the launch workspace/thread context.
- Remote agents no longer receive `AGENTDOCK_MESH_ADMIN_TOKEN`, including when it is inherited from the Core process environment. The Core signs an expiring launch token that stays stable within a refresh window, and `POST /api/local/v1/mesh/shell/execute` accepts only `shell.exec` for the token's node. Existing Mesh and node shell opt-in policy still applies. The gateway verifies the signed workspace/thread claims but enforces node ID and capability at the execution route; the claims do not add a workspace-level Mesh execution filter.
- Core derives workspace/thread and channel context from the thread row for both ACP and the LAC MCP child. Mesh `runtime_env` cannot override those values, the host Core URL, or Shell routing variables. Scheduler and monitor ID operations carry workspace scope, which their handlers verify before reading or changing a target.
- Remote file arguments, LAC pipelines, redirects, substitutions and compound LAC calls are unsupported in this phase. Ordinary remote Shell pipelines remain supported. No remote-node LAC installation or host-side file materialization is introduced.

## Evidence and rationale

- Shared dispatcher and allowlist: `services/local-ai-core/src/execution/remote-mesh/lac-control.ts`.
- MCP tool server and launch injection: `services/local-ai-core/src/execution/remote-mesh/lac-control-mcp-server.ts`, `remote-mesh-backend.ts`.
- Shell routing and signed token enforcement: `agentdock-mesh-shell.ts`, `mesh-shell-token.ts`, `mesh-gateway.ts`.
- Tests: `tests/electron/remote-lac-control.test.ts`, `tests/electron/mesh-shell-token.test.ts`, `tests/integration/remote-lac-mcp-protocol.test.ts`, `tests/integration/remote-workspace-mesh.test.ts`, and `tests/integration/transparent-remote-mesh-shell.test.ts`.
- Active diagram provider: Archify. The L1 source is `docs/architecture/system-architecture.json`; the L2 control flow is `docs/architecture/remote-lac-control.workflow.json`. The README keeps the configured inline Mermaid mode.

## Compatibility and validation

- Existing non-LAC remote commands continue through Mesh. Existing standalone LAC CLI use becomes host-side compatibility routing when its command is allowlisted.
- Runtime-specific and physical-device smoke validation: `[N/A]` in this change run; launch configuration and the real Mesh HTTP/WebSocket gateway are covered by tests, but no agent runtime was started against a paired physical node.
- Initial L1 diagram candidates failed showcase geometry/readability checks and were revised. The final L1 and L2 sources each passed 9/9 Archify showcase checks with zero errors and warnings. Final browser checks passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320; light/dark screenshots were reviewed separately.
- Final artifact SHA-256: L1 `system-architecture.html` `f1645a1c82425517dc7fd674e7d34cd0b45c5ce88809f45680f396b7074fad71`; L2 `remote-lac-control.html` `9532bb59d4c56ba436f34119041534bf2536053466cc158e87bc38f3b4d0ec21`.
- Validation: `pnpm verify` passed, including typecheck, all lint gates, architecture validation, compiled Node tests, BDD tests, and coverage.
