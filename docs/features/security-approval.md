# Security, Approval, And Audit

Phase 3 makes agent execution auditable and approval-aware.

## Permission Model

Permission scopes:

- `workspace.read`
- `workspace.write`
- `command.execute`
- `network.access`
- `secrets.access`
- `git.modify`

Permission levels:

- `deny`
- `ask`
- `allow`

Default workspace policy:

- Read workspace: `allow`
- Write workspace: `ask`
- Execute command: `ask`
- Access network: `ask`
- Access secrets: `deny`
- Modify Git state: `ask`

Workspace security settings also include allow paths and deny paths. The first implementation persists the settings and emits permission change audit events; deeper path enforcement belongs in later command execution guards.

## Approval Requests

Approval requests are durable Local AI Core records. ACP permission prompts now create approval records, attach them to tasks, and resolve them when the user chooses an option.

Implemented API:

- `GET /api/local/v1/approvals`
- `GET /api/local/v1/approvals/:approvalId`
- `POST /api/local/v1/approvals`
- `POST /api/local/v1/approvals/:approvalId/resolve`

Approval statuses:

- `pending`
- `approved`
- `rejected`
- `cancelled`
- `expired`

## Command Risk Classification

Implemented API:

- `POST /api/local/v1/security/command-risk`

Risk levels:

- `low`: no current medium/high rule match.
- `medium`: dependency install/update, network download, or common Git state changes.
- `high`: recursive/destructive removal, privilege escalation, dangerous chmod/chown, destructive Git operations, disk formatting, or secret manager reads.

Classification records an audit event and returns required permission scopes.

## Audit Log

Implemented API:

- `GET /api/local/v1/audit-events`

Audit events are append-only from normal APIs and include runtime/task/command/approval/permission event types. Secret-like strings are redacted before task logs, approval text, and audit summaries are persisted.

## Dashboard

The dashboard now includes:

- Pending approvals.
- Recent audit events.

Thread-level permission cards remain the primary interactive approval surface. The dashboard is a control-center overview in this slice.

## Checkpoint And Rollback

The safest initial checkpoint strategy is research-only in this phase: prefer VCS-aware checkpoints before risky write or Git operations, and do not implement automatic rollback until command execution guards can reliably map file changes to tasks.

## Validation

Use:

```sh
pnpm build:electron
node --test dist-electron/electron/security-approval-store.test.js
pnpm build:renderer
pnpm test
```
