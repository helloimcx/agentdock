# Runtime Installation Boundary

Automatic runtime installation is intentionally out of scope for the first stages. Phase 0 still reserves an interface shape so later installation work does not conflict with runtime detection.

## Current Rule

Runtime detection may inspect local commands and report status. It must not install packages, edit shell profile files, collect credentials, or mutate a workspace.

## Future Install Intent Shape

Future installation support should model an install request as a durable operation, not as an immediate renderer-side command.

Reserved fields:

- `runtimeId`: target runtime, such as `opencode` or `codex`.
- `deviceId`: device where installation should happen.
- `workspaceId`: optional workspace context when an installer needs project-specific notes.
- `requestedBy`: user or automation actor.
- `status`: `created`, `waiting_for_approval`, `running`, `completed`, `failed`, or `cancelled`.
- `plan`: human-readable steps before execution.
- `commands`: proposed commands, when command execution is required.
- `requiredPermissions`: permission set needed to proceed.
- `createdAt`, `updatedAt`, `completedAt`.
- `error`: structured failure details.

## Required Safety Gates

- Installation must require an explicit approval before executing commands.
- Proposed commands must be visible before execution.
- Install logs must be attached to the operation and audit log.
- The installer must not assume write access outside approved paths.
- Credential and provider login flows must remain separate from installation.

## Non-Implementation Commitment

No installer is implemented in Phase 0, Phase 1, or Phase 2. The current product only detects runtimes and reports manual next steps.
