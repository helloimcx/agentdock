# Agent Command Architecture Optimization Plan

## Context

`/agent` now lets a user inspect, switch, and reset the agent runtime for the
current thread. The feature works across desktop, Lark, Weixin, and scheduled
same-thread runs because all of those entry points go through the workspace
router and Local Core ACP backend.

The current implementation is intentionally pragmatic: it reuses
`threads.agent_type` as the effective thread-level agent, resolves the workspace
default from project config, and handles `/agent` next to `/mode` in
`LocalCoreAcpBackend`. That keeps the first implementation small, but it leaves
several architecture seams that should be cleaned up before adding more thread
commands such as `/model`, `/knowledge`, or richer runtime health checks.

## Goals

- Keep slash command behavior consistent across desktop, channel gateways, and
  scheduler-triggered same-thread execution.
- Make thread-level command handling easy to extend without growing ACP session
  lifecycle code.
- Preserve the invariant that runtime selection happens before a new run starts.
- Make agent availability checks reflect actual runtime readiness, not only
  enabled capabilities.
- Make `/new` thread inheritance rules explicit and shared across channels.

## Non-Goals

- Do not add automatic agent installation in this plan.
- Do not change channel-specific command syntax.
- Do not move channel permission replies such as `allow`, `allow all`, or `deny`
  into the slash command layer.
- Do not add UI controls for switching agents until the command and state model
  are settled.

## Current State

### Command Handling

`LocalCoreAcpBackend` currently:

- Detects local slash commands.
- Handles `/mode`.
- Handles `/agent`.
- Writes assistant replies for command output.
- Emits bridge replies for channel delivery.
- Writes audit events.
- Starts normal ACP runs when the input is not a local command.

This is workable, but the backend now owns both ACP runtime lifecycle and
thread command semantics.

### Thread Agent State

`threads.agent_type` stores the effective agent for the thread. A newly created
thread starts with the workspace/project default agent. `/agent use <id>` updates
that same column. `/agent reset` sets it back to the project default.

Because only the effective value is stored, the system infers whether the value
is "default" or "thread override" by comparing it with the current project
default.

### Runtime Selection

`WorkspaceRouter` resolves the project route before sending a message. For
normal user messages, it checks `threads.agent_type` and builds a route with that
agent type. For local commands such as `/agent` and `/mode`, it resolves the
workspace default route so commands can still reset to the project default even
after the thread has been switched.

### Channel `/new`

Lark and Weixin `/new` create a fresh thread through `router.createThread()`.
That means the new thread uses the current project default agent. The gateways
currently inherit `agent_mode` from the previous thread, but they do not inherit
`agent_type`.

## Optimization Work

### 1. Extract A Thread Command Service

Create a command service for thread-local commands:

```text
services/local-ai-core/src/thread/thread-command-service.ts
```

Responsibilities:

- Parse local command intent from normalized text.
- Execute `/mode` and `/agent` command behavior.
- Return a structured command result:
  - display text
  - audit events to write
  - whether a normal ACP run should be skipped
  - optional bridge reply metadata

`LocalCoreAcpBackend` should only:

- Normalize the incoming message.
- Ask the command service whether it is a local command.
- Persist the user and assistant command messages.
- Emit bridge events.
- Start ACP only when the command service says no local command was handled.

Acceptance criteria:

- `/mode` and `/agent` behavior remains unchanged.
- `LocalCoreAcpBackend` no longer contains command-specific branching beyond
  delegating to the service.
- Unit tests for command behavior can instantiate the command service without
  constructing ACP transport/session dependencies.

### 2. Make Thread Agent Override Explicit

Add an explicit override field instead of overloading effective `agent_type`.

Proposed model:

```text
threads.agent_type              -- creation-time default/effective compatibility
threads.agent_type_override     -- nullable explicit thread override
```

Effective agent:

```text
agent_type_override || current project default agent
```

Migration:

- Add `agent_type_override TEXT`.
- Keep existing `agent_type` for compatibility and historical thread summaries.
- On write:
  - `/agent use <id>` writes `agent_type_override = <id>` and may also update
    `agent_type` as the current effective value during the compatibility period.
  - `/agent reset` clears `agent_type_override` and refreshes `agent_type` to the
    current project default.
- On read:
  - Thread detail should expose the effective agent.
  - Future UI can expose source metadata when needed.

Acceptance criteria:

- `/agent current` can report source without comparing strings.
- If project default changes from `codex` to `pi`, threads without overrides use
  `pi` automatically.
- Threads with explicit overrides keep their selected agent.

### 3. Move Agent Override Route Construction Into Route Config

`WorkspaceRouter` currently builds an agent-overridden project shape locally.
Move that behavior into route config helpers:

```text
services/local-ai-core/src/router/workspace-route-config.ts
```

Proposed helper:

```ts
createProjectConfigForAgentOverride(project, agentType)
```

The helper should document option inheritance:

- Keep workspace path, providers, model options, and environment.
- Drop command and args from the previous agent so the target agent can use its
  own launch defaults.
- Keep explicit command only when it is known to belong to the target agent.

Acceptance criteria:

- Router no longer mutates or reshapes project agent options inline.
- Agent override behavior is covered by route-config tests.
- Switching `codex -> pi -> hermes` never reuses the previous agent command.

### 4. Use Runtime Detection For `/agent list` And `/agent use`

Current `/agent` availability is based on enabled agent capabilities. That means
an enabled but not-installed runtime can be selected and fail at the next run.

Introduce an agent availability provider for the command service:

```ts
type AgentAvailability = {
  agentType: string;
  displayName: string;
  capabilityEnabled: boolean;
  detectionStatus: 'installed' | 'not_installed' | 'error' | 'unknown';
  selectable: boolean;
  summary?: string;
};
```

Selection policy:

- `installed`: selectable.
- `builtin`: selectable.
- `unknown`: either selectable with a warning or blocked with "refresh runtime
  detection first"; choose one policy and apply it consistently.
- `not_installed` / `error`: not selectable unless explicitly configured as a
  project command.

Acceptance criteria:

- `/agent list` distinguishes installed, unavailable, and unknown runtimes.
- `/agent use <id>` blocks clearly unavailable runtimes before a run starts.
- Error messages include the runtime detection summary when available.

### 5. Share `/new` Thread Initialization Rules

Extract channel thread initialization into a shared helper:

```text
services/local-ai-core/src/channel/shared/thread-initialization.ts
```

Rules:

- New channel thread uses project default agent.
- New channel thread may inherit `agent_mode` from the previous thread.
- New channel thread does not inherit `agent_type_override`.
- New channel thread does not inherit pending permission state or ACP session id.

Acceptance criteria:

- Lark and Weixin call the same helper for `/new`.
- Tests assert that `/new` inherits mode but not agent override.
- Future channels do not need to copy the same inheritance logic.

### 6. Improve Command Result Observability

Add command-specific audit and log metadata:

- command name
- thread id
- workspace id
- previous agent
- next agent
- source: desktop, lark, weixin, scheduler
- effective default agent

Acceptance criteria:

- Agent switch audit entries are queryable as `agent.changed`.
- Logs can explain whether a command changed only future runs or affected the
  next run immediately.

## Suggested Sequence

1. Extract `ThreadCommandService` while preserving the current data model.
2. Move agent override route shaping into `workspace-route-config.ts`.
3. Extract shared `/new` initialization rules for Lark and Weixin.
4. Add `agent_type_override` and migrate effective-agent reads.
5. Wire runtime detection into `/agent list` and `/agent use`.
6. Add UI affordances only after command behavior and source metadata are stable.

## Test Plan

- Slash parser tests for aliases and invalid commands.
- Command service tests for:
  - `/agent`
  - `/agent current`
  - `/agent list`
  - `/agent use <id>`
  - `/agent reset`
  - unavailable runtime
  - running task note
- Store migration tests for `agent_type_override`.
- Router tests for effective route selection.
- Channel tests for Lark and Weixin `/new` inheritance behavior.
- Scheduler same-thread test showing the next run uses the thread effective
  agent.

## Open Questions

- Should `unknown` runtime detection status block `/agent use`, or should it
  allow switching with a warning?
- Should `/agent list` show disabled plugins, or only enabled capability agents?
- Should `/agent reset` restore "current project default" or "thread creation
  default" after the project config changes?
- Should UI expose the source as `project default` vs `thread override` before
  adding a visual agent switcher?
