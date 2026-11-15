# Cloud Sandbox: complete runnable demonstration

This walkthrough exercises the repository's **real** Daemon → external run API → sandbox proxy → OpenSandbox → fake ACP agent → SSE and SQLite thread-history path. The fake ACP agent returns a deterministic answer, so **no real model credentials are needed**. It is a reproducible integration demo, not a production isolation benchmark or a prerecorded video.

## Requirements and security

- Docker Engine and Docker Compose v2; Node.js and pnpm for the orchestration script.
- Local ports `9831`, `14173` and `8080` available.
- **Trusted local Docker host only.** The development `docker-compose.yaml` mounts `/var/run/docker.sock` in OpenSandbox and grants host path mounts. Treat this as a high-privilege test environment; never expose the insecure service to untrusted users.

## Run the demo

From the root of a fresh clone:

```bash
pnpm install
pnpm e2e:compose
```

This runs the existing **`scripts/e2e-compose.mjs`**, which:

1. Builds `agentdock/pi-acp:local`, `agentdock/fake-acp:local`, Core and Web images.
2. Starts Core, Web and OpenSandbox containers with Docker Compose.
3. Waits for Web and Core health and verifies Core-to-OpenSandbox connectivity.
4. Runs deployment diagnostics.
5. Temporarily registers the fake ACP sandbox runtime and fake provider.
6. Calls `POST /api/local/v1/external/runs` using external user/project/thread IDs and a prompt.
7. Subscribes to the returned `events_url`, asserting an `external.run.snapshot` and streamed reply containing **`compose sandbox acp ok`**.
8. Reads `GET /api/local/v1/threads/:threadId`, verifies a persisted assistant final message, and checks the external-thread workspace path is isolated.
9. Restores the prior runtime config and removes the temporary provider in a `finally` block.

Success ends with `[e2e:compose] passed`. If the script errors, inspect the logs rather than reporting success. **This PR does not claim the authoring environment executed Docker or a live model.**

## Inspect the stack and API

```bash
docker compose ps
curl -fsS http://127.0.0.1:9831/api/local/v1/health
curl -fsS http://127.0.0.1:14173/api/local/v1/health
docker compose logs --tail=80 agentdock-core opensandbox-server
```

Open `http://127.0.0.1:14173` for the web UI. The full sandbox example is deliberately API-driven and does not require Electron.

During the script's temporary provider/image configuration, it submits this request (shown for understanding, **not** as an extra command to run after the test has cleaned up):

```http
POST /api/local/v1/external/runs
Content-Type: application/json

{
  "user_id": "compose-user",
  "external_project_id": "compose-project",
  "external_thread_id": "compose-thread",
  "title": "Compose E2E",
  "agent_type": "pi",
  "provider_id": "compose-e2e-provider",
  "prompt": "hello compose sandbox"
}
```

The response data carries `workspace_id`, `thread_id`, `run_id` and `events_url`. A consumer requests `GET {events_url}` (with the Daemon base origin), reading the run snapshot and stream updates as **Server-Sent Events**. The final result is independently stored in the thread. The IDs are generated, so do not hardcode them.

For real model-backed runs, configure a real sandbox runtime image, matching provider and secrets using [Cloud Sandbox and External Agent API](../architecture/cloud-sandbox-and-external-api.md). The documented fake run does not test live provider cost, arbitrary tool safety, multi-tenant isolation, or crash recovery; see [session recovery](../guides/agent-session-recovery.md).

## Troubleshooting

| Issue | First check |
| --- | --- |
| Core/Web unhealthy | `docker compose ps` and service logs; port conflicts |
| OpenSandbox unreachable | `AGENTDOCK_OPENSANDBOX_SERVER_URL`, server logs |
| Sandbox image missing | `docker compose build fake-acp-image` |
| Mount denied | `OPEN_SANDBOX_HOST_MOUNT_ALLOWLIST`, Docker Desktop shared paths and host directories |
| SSE reply absent | `events_url`, Core logs, per-run snapshot/stream checks |
| Docker permissions | Daemon socket permissions — do not bypass privilege controls |

## Cleanup

```bash
docker compose down
```

By default, this preserves named volumes (including Core SQLite data). Do **not** pass `-v` unless deleting that data is intentional. Inspect host-backed workspace/state roots separately before cleaning any generated files.
