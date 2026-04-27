# Workspace Registry And Task Model

Phase 2 turns runtime visibility into a daily-use agent workstation. The first
slice is the shared contract layer for workspaces and tasks.

## Workspace Registry

The workspace registry is Local AI Core's durable list of workspaces. It should
be the owner of workspace identity, local path, default runtime, Git summary,
health, and recent task references.

Shared contracts:

- `WorkspaceRegistryEntry`
- `WorkspaceGitSummary`
- `WorkspaceHealthSummary`
- `WorkspaceRegistryCreateInput`
- `WorkspaceRegistryUpdateInput`

The existing `WorkspaceSummary` type remains available for current routes. New
Phase 2 APIs should use `WorkspaceRegistryEntry`.

## Task Model

The task model is the durable product object for agent work. A task can be
associated with a workspace, runtime, thread, run, logs, timeline entries,
artifacts, and approvals.

Shared contracts:

- `AgentTask`
- `AgentTaskStatus`
- `AgentTaskTimelineItem`
- `AgentTaskLogEntry`
- `AgentTaskArtifact`
- `AgentTaskCreateInput`
- `AgentTaskUpdateInput`
- `AgentTaskListQuery`
- `AgentTaskListResponse`

Task statuses:

- `created`
- `queued`
- `running`
- `waiting_for_user`
- `completed`
- `failed`
- `cancelled`

Timeline item types:

- `status_change`
- `message`
- `command`
- `file_change`
- `approval_requested`
- `approval_resolved`
- `error`
- `summary`

## Current Implementation

Local AI Core persists workspace registry entries and agent task records in
`local-core.db`.

Implemented APIs:

- `GET /api/local/v1/workspace-registry`
- `GET /api/local/v1/workspace-registry/:workspaceId`
- `POST /api/local/v1/workspace-registry`
- `PATCH /api/local/v1/workspace-registry/:workspaceId`
- `DELETE /api/local/v1/workspace-registry/:workspaceId`
- `GET /api/local/v1/tasks`
- `GET /api/local/v1/tasks/:taskId`
- `POST /api/local/v1/tasks`
- `PATCH /api/local/v1/tasks/:taskId`

Configured workspaces are synced into the registry with basic Git and health
summaries. Agent tasks are created automatically when a thread message starts a
run, and status is updated when the run waits for input, completes, cancels, or
fails.

Dashboard sections now show active tasks, waiting-for-user tasks, and recent
completions.

## Next Implementation Slice

1. Add richer task detail UI with full timeline/log/artifact inspection.
2. Add workspace registry editing controls in the desktop workspace page.
3. Add pagination/cursor behavior for large task histories.
4. Connect approvals and audit events in Phase 3.

## Validation

Use:

```sh
pnpm build:electron
node --test dist-electron/electron/workspace-task-store.test.js
pnpm build:renderer
pnpm test
```
