# Cloud Sandbox And External Agent API

This document describes the current cloud execution path: Local AI Core creates or reuses external workspaces, starts sandboxed ACP runtimes through OpenSandbox, and exposes per-run streaming APIs for non-renderer callers.

## Top-Level Flow

```mermaid
flowchart TD
  Client["External system"] --> Projects["POST /api/local/v1/external/projects"]
  Client --> Runs["POST /api/local/v1/external/runs"]
  Runs --> ExternalHandler["external-handler"]
  ExternalHandler --> ExternalSvc["ExternalService"]
  ExternalSvc --> ExternalStore["external_projects / external_threads"]
  ExternalSvc --> Config["Runtime project config<br/>SQLite local-core.db"]
  ExternalSvc --> Router["WorkspaceRouter"]
  Router --> ACP["LocalCoreAcpBackend"]
  ACP --> SandboxProxy["sandbox stdio proxy"]
  SandboxProxy --> OpenSandbox["OpenSandbox Server"]
  OpenSandbox --> Container["Sandbox container"]
  Container --> Bridge["HTTP NDJSON ACP bridge"]
  Bridge --> ACP
  ACP --> Events["DesktopBridgeEvent"]
  Events --> SSE["GET /api/local/v1/external/runs/:runId/events"]
  SSE --> Client
```

## Sandbox Mode

Cloud sandbox mode is project configuration, not a renderer-only mode. Runtime project config is persisted in `<userData>/runtime/local-core.db` (SQLite `runtime_config` table is the single source of truth; the workspace registry is a derived mirror). A project selects a sandbox provider and runtime image through `agent.options.sandbox`; Local AI Core materializes that into an `AgentSandboxLaunchConfig` before launching the agent runtime.

Key behavior:

- Transport is normalized to `http-ndjson`; the old sandbox WebSocket proxy path is no longer the active compatibility path.
- OpenSandbox defaults to `http://127.0.0.1:8080`, or `AGENTDOCK_OPENSANDBOX_SERVER_URL` when set.
- Sandbox auth uses the configured provider `api_key_env`, defaulting to `OPEN_SANDBOX_API_KEY`.
- The workspace is mounted into the container at `/workspace` by default.
- Agent state is mounted at `/agent-state` by default and is scoped by `user`, `project`, `thread`, or `run`; the default for normal project config is `project`.
- Sandbox lifecycle defaults to `per_thread`, so a thread can reuse its sandbox/ACP session until the idle TTL expires.
- Resource overrides include timeout, idle seconds, warm pool size, CPU, memory, workspace mount path, and state mount path.
- Compose deployments can override the host-side state root with `AGENTDOCK_SANDBOX_STATE_HOST_ROOT`.

OpenSandbox launch requests carry workspace volumes, state volumes, resource settings, environment, and Kubernetes-safe metadata. Raw ids stay available in environment/config where exact values matter.

## External Agent API

The external API is for systems that need to run AgentDock without driving the desktop UI. It lives under `/api/local/v1/external/*` and still routes through the same Local AI Core workspace, thread, run, task, and ACP machinery as the renderer.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/local/v1/external/projects` | Create or reuse a workspace for `user_id` and `external_project_id`. |
| `POST /api/local/v1/external/runs` | Ensure the project/thread, send the prompt, and return `workspace_id`, `thread_id`, `run_id`, optional `task_id`, and `events_url`. |
| `GET /api/local/v1/external/runs/:runId/events` | Stream a snapshot plus bridge updates for one run over SSE. |
| `POST /api/local/v1/openai/chat/completions` | Accept OpenAI Chat Completions-style requests, map metadata to an external run, and return OpenAI-style JSON or SSE chunks with AgentDock extensions. |

`ExternalProjectEnsureInput` accepts `user_id`, `external_project_id`, optional display name, agent type, provider id, model, and metadata. `ExternalRunCreateInput` adds `external_thread_id`, title, and prompt.

Local AI Core maps external identities to internal state:

- `external_projects` stores the stable mapping from `(user_id, external_project_id)` to `workspaceId` and workspace path.
- `external_threads` stores the mapping from `(user_id, external_project_id, external_thread_id)` to a Local AI Core `threadId`.
- Workspace files default to `AGENTDOCK_EXTERNAL_WORKSPACE_ROOT`, or `<userData>/external-workspaces` when the environment variable is not set.
- External projects are persisted into the workspace registry with `deviceId: "external"` and metadata marking the external owner.
- External project config is persisted in the SQLite runtime config and enables sandbox mode with `state_scope: "project"` and `sandbox_lifecycle: "per_thread"` by default.

## OpenAI-Compatible Chat Completions

The OpenAI-compatible endpoint is intended for SDK-style clients that can set the Local AI Core base URL and send Chat Completions requests. It does not call OpenAI; it adapts the request to an AgentDock external run.

Identity is passed through the request body `metadata`:

```json
{
  "model": "gpt-4.1-mini",
  "stream": true,
  "metadata": {
    "user_id": "user-1",
    "project_id": "repo-1",
    "thread_id": "issue-42",
    "agent_type": "pi",
    "agentdock_progress_mode": "extension"
  },
  "messages": [
    { "role": "user", "content": "Summarize this repository." }
  ]
}
```

Rules:

- `metadata.user_id` and `metadata.project_id` are required; `metadata.thread_id` is optional.
- Body `user` may fill `user_id` only for legacy clients, but `metadata.user_id` is the canonical field.
- Runs from this endpoint always request sandbox execution and `bypassPermissions`/yolo permission mode.
- Request `model` is treated as a model override for the generated external project config.
- v1 supports text-only messages and `n=1`.

Streaming responses use the OpenAI `chat.completion.chunk` object and add an `agentdock` extension object. Final assistant text is emitted through `choices[0].delta.content`. Agent progress is emitted through `agentdock`:

- `agentdock.event = "thought_delta"` for thinking.
- `agentdock.event = "plan_update"` for planning.
- `agentdock.event = "tool_update"` for tool progress and results.
- `agentdock.event = "status"` or `"card"` for runtime status events.

By default, progress is extension-only so regular OpenAI SDK consumers see the assistant answer stream. Set `metadata.agentdock_progress_mode` to `"content"` to also include progress as concise Markdown in `delta.content`.

## Event Stream

External run SSE is scoped to one `runId`. New clients receive `external.run.snapshot`, then subsequent bridge events are sent as `external.run.stream` when the bridge `replyCtx` matches that run.

This keeps external API clients decoupled from global renderer events while preserving the same ACP progress model: assistant chunks, thinking, tool progress, permission state, final replies, and structured errors all originate from Local AI Core.

## Ownership Rules

- External callers own only their external ids and prompt input.
- Local AI Core owns project/thread/run/task persistence, SQLite-backed runtime project config, sandbox launch, and SSE delivery.
- OpenSandbox owns container creation and lifecycle after Local AI Core submits the launch request.
- Sandbox containers own agent runtime execution, but communicate only through the HTTP NDJSON ACP bridge.
- Renderer and Electron are not in the external run path.

## Diagnostics

Sandbox and external runs reuse the shared structured error model. Important sandbox error codes include `sandbox_unavailable`, `sandbox_unauthorized`, `sandbox_request_failed`, `sandbox_start_failed`, `sandbox_start_timeout`, and `sandbox_endpoint_missing`.

Use deployment diagnostics to verify Web/Core/OpenSandbox connectivity, Docker socket access, workspace mounts, state host paths, and registered sandbox images before relying on external runs in compose deployments.
