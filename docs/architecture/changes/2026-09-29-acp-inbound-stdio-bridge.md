# Architecture Change Record: 2026-09-29 Inbound ACP Stdio Bridge

## Metadata

- **Date**: 2026-09-29
- **Task**: Issue #155 — [Inspiration] Inbound ACP server mode: expose Local AI Core managed agents to IDEs and external ACP clients
- **Architecture Impact**: `Required` (adds an inbound external integration surface: a Local AI Core consumer process that speaks the Agent Client Protocol agent-side over stdio so ACP clients such as the Zed editor can drive workspace agents)
- **Active Provider**: Archify — `[BLOCKED]` in the implementation environment (see Provider Artifacts below)
- **Status**: Proposed / Awaiting Approval

## Context & Rationale

AgentDock's ACP role was client-only: `LocalCoreAcpBackend` spawns claude/codex/pi/opencode adapters over stdio and orchestrates sessions, while external consumers use REST/SSE (`/api/local/v1/external/*`, OpenAI-compatible endpoint). ACP-native clients (Zed and other editors) therefore could not reuse workstation configuration (provider routing, skills, standards, cost tracking) and had to be configured per client.

The issue's suggested v1 is a stdio closed loop: bind one workspace at bridge start, map ACP sessions to threads, and stream agent progress back as ACP updates. The implementation deliberately keeps the Local AI Core daemon unchanged — the bridge is a pure consumer of the existing public HTTP+SSE surface, in the same layer and trust domain as the existing `lac` CLI domains and the renderer:

1. **ACP agent-side stdio server** (`services/local-ai-core/src/acp/server/acp-stdio-server.ts`): newline-delimited JSON-RPC framing mirrored from `local-core-acp-transport.ts`. Implements `initialize` (protocolVersion 1, `loadSession: false`), `session/new` (creates a thread in the bound workspace via `POST /threads`), `session/prompt` (sends `POST /threads/:id/messages`, awaits turn completion), `session/cancel` (notification → `POST /runs/:id/interrupt`), and emits `session/update` notifications (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`).
2. **Bridge event translation**: consumes the global `GET /api/local/v1/events` SSE stream, filters `{ type: 'stream.updated' }` bridge events by `replyCtx === runId`, and maps bridge kinds to ACP updates (assistant preview deltas via accumulated-text diffing, thought → thought chunk, tool → tool_call with status mapping over the real status vocabulary `running|completed|failed|error|cancelled`, plan/status/permission → annotated thought chunks, terminal `typing_stop` → `end_turn`, error status → thought chunk + `refusal`). Message-ID dedupe mirrors the OpenAI stream adapter.
3. **Session identity mapping**: the ACP `sessionId` domain *is* the core `threadId` domain (no second identifier space is introduced); unknown session ids are rejected (`-32002`), one prompt per session at a time (`-32003`).
4. **CLI entry**: `lac acp serve --workspace <id>` (`services/local-ai-core/src/cli/acp-cli-handlers.ts`), a long-running domain handler that serves stdio until the client closes it.

## Explicit v1 Non-Goals

- No WebSocket transport, connection-token auth (#119), or remote/multi-tenant exposure — the bridge trusts the local user like every other loopback consumer.
- No ACP `session/request_permission` round-trip: runs use the bound workspace's configured permission mode; a permission-gated run surfaces an annotated thought chunk and waits (documented limitation).
- No `loadSession`, no persisted session↔run mapping store, no MCP server pass-through, no IDE-side configuration UI.

## Changed Facts

- Added component: **ACP Inbound Bridge** (`services/local-ai-core/src/acp/server/` + `lac acp` CLI domain) — an optional local consumer process spawned by external ACP clients.
- Added public entry point: `lac acp serve` (stdio, agent-side ACP).
- Unchanged: Local AI Core daemon routes, data ownership, storage, event flow, dependency direction, and all existing entry points.

## Code Evidence

- `services/local-ai-core/src/acp/server/acp-stdio-server.ts` — protocol server and event translation
- `services/local-ai-core/src/acp/server/local-core-client.ts` — HTTP/SSE client over existing routes (`/threads`, `/threads/:id/messages`, `/runs/:id/interrupt`, `/events`)
- `services/local-ai-core/src/cli/acp-cli-handlers.ts`, `services/local-ai-core/src/cli/lac.ts` — CLI wiring
- `tests/integration/local-core-acp-stdio-server.test.ts` — integration tests against a fake core (envelope handling, SSE framing, streaming, cancel, error, and protocol-error paths)

## Provider Artifacts

- `[BLOCKED]` Provider validation/rendering: `pnpm lint:arch` requires `.agents/skills/archify/bin/archify.mjs`, which is not tracked in the repository and absent in the implementation environment; the maintainer-local skill could not be invoked. Per `docs/architecture/maintenance.md`, the last-known-good provider source and rendered artifacts under `docs/architecture/` are preserved untouched rather than replaced with an unvalidated candidate.
- `[N/A]` Provider comparison: no candidate source was produced while blocked.
- Suggested semantic delta for the next provider refresh: add the **ACP Inbound Bridge** consumer node adjacent to the existing `lac` CLI/renderer consumers on the L1 system architecture, connected over the existing `HTTP REST & SSE http://127.0.0.1:9831/api/local/v1/*` edge, plus an inbound `stdio (ACP)` edge from ACP clients (e.g. Zed).

## Validation

- `npx tsc -p tsconfig.electron.json --noEmit`: pass
- `pnpm test` (typecheck, renderer + electron builds, Node.js test runner, BDD): recorded in the PR description
- `pnpm lint:gates` members run individually (circular, duplicate, file-size, function-length, complexity): recorded in the PR description
- `pnpm lint:arch`: `[BLOCKED]` (archify CLI unavailable locally)
