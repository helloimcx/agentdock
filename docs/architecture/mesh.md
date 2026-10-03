# AgentDock Mesh v1

Mesh adds device tool execution to Local AI Core. ACP sessions, threads and agent tasks retain their existing execution paths. A Mesh request is a separate operation with its own identity and history; it is not an ACP run or an agent runtime installation.

```mermaid
flowchart LR
  ui[Device management UI] --> sdk[Core SDK mesh client]
  cli[agentdock-node admin commands] --> api[Authenticated Mesh REST API]
  sdk --> api
  api --> gateway[Mesh Gateway / Dispatcher]
  gateway --> db[(Core SQLite: identities and requests)]
  node[agentdock-node on Mac / Linux / Windows / Termux] -->|Outbound WebSocket: hello and heartbeat| gateway
  gateway -->|Execute / cancel| node
  node -->|Result| gateway
  node --> files[Approved directory: read and list]
  node --> shell[Optional command execution as device user]
```

## Ownership and transport

- Contracts: `packages/contracts/src/mesh.ts`; API client: `packages/core-sdk/src/mesh.ts`.
- Core owns identities, allowed capabilities and execution history in `mesh_nodes` / `mesh_executions`, in the existing `runtime/local-core.db`. Only hashes of pairing and device credentials are retained.
- `MeshGateway` attaches to the existing Core HTTP server. Nodes initiate WebSocket connections, so devices need no inbound listener or public IP. Internet, LAN and Tailscale are transport choices; no specific overlay is required.
- `bin/agentdock.mjs` forwards the Mesh WebSocket upgrade through the bundled web server, in addition to existing REST forwarding.
- The node owns its approved root, local credentials and command opt-in. Credentials are created exclusively with mode 0600; existing files are not overwritten. Use an operating-system ACL on Windows to restrict the credential and pairing files to the node user (POSIX mode bits do not establish a Windows ACL).
- The renderer owns temporary UI state. The administrator token remains in page memory, never a URL or browser storage. Results are fetched every three seconds while connected.

## Trust boundaries

Mesh is disabled unless `AGENTDOCK_MESH_ADMIN_TOKEN` is set. Generate a high-entropy random value and supply it securely to Core and administration clients. This token protects only Mesh endpoints; it does not add authentication to pre-existing Core APIs. Protect the complete Core surface when deploying publicly.

An administrator creates a device-specific, single-use pairing token valid for ten minutes. `/enroll` exchanges it for the device credential. The first WebSocket message supplies that credential; protocol v1 accepts only text messages, known capabilities and bounded payloads. A node cannot act as an administrator or finish another device's requests. Revocation invalidates both enrollment and connection credentials, closes the active connection and interrupts pending work.

The client requires HTTPS/WSS outside loopback, follows no redirects, and verifies TLS normally. `--allow-insecure` explicitly permits HTTP/WS on a trusted private network; it does not disable certificate verification. Termux's Android platform identification is descriptive metadata, not an attestation.

`filesystem.list` and `filesystem.read` resolve paths inside the configured root; absolute paths and symlink escapes are rejected. Files must be regular files and at most 32 KiB; the protocol returns base64 for binary-safe reads. Listing returns at most 100 entries. `filesystem.write` supports atomic file writes up to 1 MiB with automatic parent directory creation and path confinement within the approved root. These checks do not provide OS isolation against a hostile local process racing filesystem mutations. Choose a root writable only by trusted processes.

`shell.exec` is available only when pairing allows it and the node uses `--allow-shell`. It uses a program and argument array with `shell:false`, the approved root as the working directory, and a 32 KiB combined output limit. It runs with the device user's permissions and inherited environment; the working directory is not a filesystem or network sandbox. A successful Mesh result can contain a nonzero command `exitCode`, which callers must inspect.

## Remote Workspace Mesh Execution

When a Workspace is configured with `deviceId: 'node:<uuid>'`:
1. **Agent Process**: Runs on the Server (Local AI Core daemon host) with a physical working directory anchored at `<baseDir>/remote-shadow/<workspaceId>`.
2. **Transparent MCP Tool Bridge**: Local AI Core injects the `agentdock-remote-mesh` MCP stdio server providing standard `read_file`, `write_file`, `list_directory`, `execute_command`, and `bash` tools. Tool calls are dispatched synchronously to `MeshGateway.executeAndWait()` (`POST /api/local/v1/mesh/execute`).
3. **ACP Protocol Bridge**: When agents issue ACP filesystem requests (`fs/read_text_file`, `fs/write_text_file`), LocalCoreAcpTurnCoordinator routes them directly to `MeshGateway.executeAndWait()`, transparently returning UTF-8 contents without modifying the agent prompt.
4. **Zero Awareness**: To the LLM and the agent runtime (Pi, Claude Code, Codex, Hermes, OpenCode), the environment appears as a standard local workspace, requiring zero specialized prompts or awareness of the remote execution substrate.

## Requests and failure semantics

The administrator selects a node and advertised capability. Core validates capability authorization, online presence, bounded arguments and a 100–120000 ms deadline before dispatch. There are at most 256 pending requests in Core, 128 node connections and eight concurrent executions per node. Recent history APIs return up to 100 records; durable records are retained in SQLite.

Each request uses `mesh-request:<uuid>`; each paired identity uses `node:<uuid>`. Node heartbeat acknowledgements update presence; both sides detect stale connections. Reconnect uses bounded exponential backoff. Replacing a connection interrupts its outstanding work and fences old callbacks and results.

Terminal states are `completed`, `failed`, `cancelled`, `timed_out` and `interrupted`. Late results cannot overwrite terminal history. Cancellation and timeout send an abort to the node; the node kills a spawned command process group on Unix (the immediate process on Windows). Already completed effects cannot be undone, and detached descendants outside that group can outlive cancellation. `cancelled` means cancellation was requested, not proof that no effects occurred.

Disconnect and Core restart mark pending requests `interrupted`: the outcome is unknown and requests are never automatically replayed. Users must inspect device state before retrying side effects. Offline devices return a conflict instead of silently redirecting requests to another device. Durable waiting queues, artifact streaming, remote ACP runtimes and Android-specific APIs are future capabilities.

## API

Prefix: `/api/local/v1/mesh`. All routes except enrollment and WebSocket handshake require `Authorization: Bearer <administrator token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/nodes` | List devices and presence |
| POST | `/pairings` | Create pairing (`label`, optional `allowShell`) |
| POST | `/enroll` | Consume `pairingToken`, return device credential |
| WebSocket | `/connect` | Device-authenticated protocol v1 |
| POST | `/nodes/:id/revoke` | Revoke a device |
| POST | `/requests` | Dispatch `nodeId`, `capability`, `args`, optional `timeoutMs` |
| GET | `/requests` | Recent history |
| GET | `/requests/:id` | Request status/result |
| POST | `/requests/:id/cancel` | Request cancellation |

## Running two devices

Build with `pnpm build`. Set `AGENTDOCK_MESH_ADMIN_TOKEN` securely before `pnpm start:core` or `agentdock serve`. The Device Mesh navigation entry opens the device management page. Enter the same administration credential to pair and manage devices.

Alternatively, use CLI commands from the repository root (an npm installation exposes `agentdock-node` directly):

```bash
# Administrator machine; AGENTDOCK_MESH_ADMIN_TOKEN is already injected.
node bin/agentdock-node.mjs pair --server https://agent.example.com \
  --label home-mac --output /secure/path/mac-pairing.json
```

Transfer the pairing file securely to the intended device, then run:

```bash
chmod 600 /secure/path/mac-pairing.json
node bin/agentdock-node.mjs connect --server https://agent.example.com \
  --root /path/to/shared-files --pairing-file /secure/path/mac-pairing.json \
  --state /secure/path/mac-node.json
```

Repeat pairing for a second device with its own label, approved directory and credential file. On reconnect, omit `--pairing-file`; reuse the existing state. A state file is bound to one server; use separate state files for separate servers. Securely remove consumed pairing files. If enrollment succeeded but the credential write failed, revoke that identity and pair again rather than replacing an unrelated credential file.

The default state path is `~/.agentdock/mesh-node.json`. The node needs the built package and Node.js 22 or newer; no Electron GUI is needed. Termux can run this Node client, but real Android device validation remains outstanding. APK background services, notifications, clipboard, camera and Android intents are not included in v1.

```bash
node bin/agentdock-node.mjs list --server https://agent.example.com
node bin/agentdock-node.mjs execute --server https://agent.example.com \
  --node 'node:<uuid>' --capability filesystem.read --args '{"path":"notes.txt"}'
node bin/agentdock-node.mjs status --server https://agent.example.com \
  --request 'mesh-request:<uuid>'
```

For command execution, add `--allow-shell` to both `pair` and `connect`, then dispatch `shell.exec` with `{"program":"git","arguments":["status","--short"]}`. The CLI outputs a request identity immediately; use `status`, `requests` or the UI to inspect the terminal outcome. SDK callers can use `mesh.createMeshClient(token, coreBaseUrl)` for the same operations. When configured as a Remote Workspace, Agent runtimes are automatically and transparently equipped with the `agentdock-remote-mesh` MCP server and ACP filesystem bridges.

## Validation evidence

`tests/integration/mesh.test.ts` exercises two independent nodes with separate roots over real HTTP/WebSocket connections, device authentication, enrollment reuse rejection, capability policy, file confinement, dispatch, results, timeout, cancellation, disconnect/reconnect and revocation. `tests/electron/mesh-store.test.ts` checks hash-only persistence, pairing expiry and restart recovery. `tests/electron/mesh-node-policy.test.ts` checks local shell opt-in, output/read/write bounds, cancellation and private credential-file handling. `tests/integration/mesh-auth.test.ts` checks role separation, disabled-by-default behavior, cross-device forged results, connection replacement and late-result fencing. `tests/integration/remote-workspace-mesh.test.ts` exercises end-to-end transparent tool dispatching, ACP filesystem RPC bridging, and MCP stdio execution. Live validation additionally exercised two CLI processes through the bundled WebSocket proxy, reconnect with saved credentials, and Chromium page operations including a byte-verified file download.

The L1 Archify specification has passed all 9 showcase checks via `pnpm lint:arch`. The interactive showcase HTML (`system-architecture.html`) has been delivered alongside the Mermaid reference view.

