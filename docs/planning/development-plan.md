# Development Plan

## Product Direction

Build the project into a local-first, cross-device AI agent workstation.

The product should help users manage agent runtimes, workspaces, tasks, devices,
security approvals, and automation from one app. The first wedge is not runtime
installation. The first wedge is reliable local agent detection: tell users
whether agent CLIs such as opencode, Claude Code, and Codex are already installed
on the current machine.

## Guiding Principles

- Start with detection before installation.
- Keep Local AI Core as the center of runtime, task, workspace, and device state.
- Treat agent work as tasks with status, logs, outputs, approvals, and history,
  not only as chat messages.
- Make mobile a companion control surface first, not a full IDE.
- Design cross-device support around trust, pairing, permissions, and status
  visibility before remote file editing.
- Keep plugin contracts stable and small before opening a plugin marketplace.
- Build security and audit features early enough that users trust agent actions.

## Explicit Non-Goals For The First Stages

- Do not implement automatic runtime installation yet.
- Do not build a public plugin marketplace yet.
- Do not make the mobile app a full desktop replacement.
- Do not support arbitrary remote filesystem browsing before task control and
  approval flows are stable.
- Do not add dynamic third-party plugin loading until static built-in plugin
  registration is reliable.

## Phase 0: Product And Architecture Baseline

Status: Complete. Baseline docs live in:

- `docs/product/product-baseline.md`
- `docs/product/glossary.md`
- `docs/architecture/state-ownership.md`
- `docs/architecture/runtime-installation-boundary.md`

### Goal

Turn the product direction into a shared implementation baseline.

### Scope

- Align naming for user-facing concepts:
  - Agent runtime / agent engine
  - Workspace
  - Task
  - Device
  - Local AI Core
  - Plugin
  - Approval
- Confirm the core domain model for runtime detection, task status, workspace
  metadata, and device presence.
- Review current Local AI Core API boundaries.
- Identify which state belongs in Local AI Core, renderer state, Electron, and
  shared contracts.
- Add architecture notes for runtime detection and future runtime installation.

### Deliverables

- Runtime detection contract draft.
- Task status contract draft.
- Device and workspace registry contract draft.
- Initial product terminology glossary.

### Acceptance Criteria

- The team can explain the product in one sentence.
- Runtime detection, task state, workspace state, and device state each have a
  clear owner.
- Future installation support has a reserved interface shape but no installer
  implementation.

## Phase 1: Agent Runtime Detection

### Goal

Show users which local agent CLIs/runtimes are installed on the current machine.
This phase answers "is it installed here?" before it answers "is it fully
configured and ready?"

### Scope

- Add local agent installation detection as a Local AI Core capability.
- Start with opencode detection.
- Add detection adapters for additional local agent CLIs after opencode proves
  the contract:
  - Claude Code, usually detected through the `claude` command.
  - Codex, usually detected through the `codex` command.
  - Aider, usually detected through the `aider` command.
  - Gemini CLI, command name to be confirmed during implementation.
- Detect:
  - Installed or not installed.
  - Resolved binary path, when available.
  - Version, when available.
  - Last check time
  - Detection error, if the check failed.
  - Manual next step when not installed.
- Treat provider login, credentials, model availability, and project-specific
  readiness as later health checks, not as Phase 1 installation detection.
- Expose runtime detection through Local AI Core APIs.
- Add renderer UI for runtime status.
- Add manual refresh.
- Add automatic refresh at app startup.

### Out Of Scope

- Automatic installation.
- Automatic updates.
- Credential collection.
- Login/provider readiness checks.
- Project-specific runtime readiness checks.
- Running destructive diagnostic commands.

### Deliverables

- Runtime detection contract in shared packages.
- Local AI Core runtime detection service.
- opencode detection adapter.
- Runtime status page or panel.
- Startup detection flow.
- Basic diagnostics logging.

### Acceptance Criteria

- A user can open the app and see whether opencode is installed locally.
- The UI distinguishes at least `installed`, `not_installed`, `error`, and
  `unknown`.
- The UI explains that a runtime is not installed without attempting to install
  it.
- Detection failures do not crash Local AI Core or the renderer.

### Edge Cases

- Binary exists but exits with an error.
- Binary exists but version output format changes.
- Multiple versions exist on PATH.
- Runtime is installed outside PATH.
- Runtime is installed but login status is unknown; Phase 1 should still report
  the runtime as installed.
- Detection command hangs.
- User changes PATH while the app is open.

## Phase 2: Workspace And Task Control Center

### Goal

Move the product from a chat surface toward an agent task workstation.

### Scope

- Add a task model for agent work:
  - Created
  - Queued
  - Running
  - Waiting for user
  - Completed
  - Failed
  - Cancelled
- Associate tasks with:
  - Workspace
  - Runtime
  - Thread
  - Device
  - Logs
  - Outputs
  - File changes, when available
- Add workspace registry:
  - Local path
  - Display name
  - Git metadata
  - Default runtime
  - Last active task
  - Health summary
- Add dashboard views:
  - Active tasks
  - Recent tasks
  - Installed agent status
  - Workspace health
- Add task timeline:
  - Planning
  - Reading context
  - Editing
  - Running commands
  - Waiting for approval
  - Verifying
  - Summarizing

### Deliverables

- Task contracts.
- Workspace registry contracts.
- Local AI Core persistence for tasks and workspaces.
- Dashboard UI.
- Workspace detail UI.
- Task detail UI.

### Acceptance Criteria

- Users can see all active and recent agent tasks in one place.
- Users can tell which workspace and runtime each task belongs to.
- Failed tasks show enough context for the user to act.
- The dashboard remains useful even when no supported local agent is installed.

### Edge Cases

- Task starts and runtime exits immediately.
- Workspace path no longer exists.
- Git metadata cannot be read.
- Task logs are large.
- App restarts while a task is running.

## Phase 3: Security, Approval, And Audit

### Goal

Make agent execution trustworthy enough for everyday work.

### Scope

- Add permission levels:
  - Read workspace
  - Write workspace
  - Execute command
  - Access network
  - Access secrets
  - Modify Git state
- Add approval requests for high-risk actions.
- Add command risk classification.
- Add file path allowlist and denylist support.
- Add audit log for:
  - Runtime detection
  - Task lifecycle
  - Commands
  - Approvals
  - Rejections
  - Permission changes
- Add redaction for secrets in logs where possible.
- Add checkpoint and rollback research, then implement the safest first version.

### Deliverables

- Permission model.
- Approval request contract.
- Approval UI.
- Audit log persistence.
- Initial command risk rules.
- Workspace security settings.

### Acceptance Criteria

- A high-risk command can request approval instead of running silently.
- A user can approve or reject an action from the desktop app.
- Audit history shows who approved what and when.
- Approval state survives renderer refresh.

### Edge Cases

- Approval request is created while user is offline.
- Runtime exits while waiting for approval.
- Same command is requested repeatedly.
- Logs contain secret-like strings.
- User changes permissions while a task is running.

## Phase 4: Mobile Companion MVP

### Goal

Let users control desktop agent work from a phone.

### Recommended Approach

Start with a mobile web or PWA companion before a full native app. This reduces
platform complexity while validating the core mobile use cases.

### Scope

- Device pairing from desktop to mobile.
- Mobile-friendly session authentication.
- View devices.
- View workspaces.
- View active and recent tasks.
- Create a simple task.
- View task progress.
- Approve or reject pending actions.
- Receive completion and approval-needed notifications.
- Pause, resume, or cancel a task where supported.

### Out Of Scope

- Full code editing on mobile.
- Full filesystem browsing.
- Complete Local AI Core execution on mobile.
- Native-only features until the PWA proves retention.

### Deliverables

- Mobile companion web/PWA shell.
- Pairing flow.
- Mobile task list.
- Mobile task detail.
- Mobile approval UI.
- Push notification proof of concept.

### Acceptance Criteria

- A user can pair their phone with the desktop app.
- A user can start a task from the phone and see it run on desktop.
- A user can approve a pending high-risk action from the phone.
- A user receives a notification when a task needs attention or completes.

### Edge Cases

- Desktop goes offline.
- Phone loses network during approval.
- Pairing QR code expires.
- Notification is delayed.
- Multiple phones are paired to one desktop.

## Phase 5: Cross-Device Workspace Graph

### Goal

Show users all their devices, workspaces, runtimes, and tasks from one app.

### Scope

- Device registry:
  - Device id
  - Display name
  - Platform
  - Online status
  - Last seen
  - Local AI Core version
  - Available runtimes
  - Workspaces
- Workspace graph:
  - Workspace exists on which device
  - Active task count
  - Installed agents per device
  - Last activity
- Cross-device routing:
  - Start task on selected device
  - View remote task status
  - Cancel remote task
  - Approve remote action
- Connection options:
  - LAN discovery
  - Tailscale-friendly direct connection
  - Relay fallback
- Device trust:
  - Pairing
  - Revocation
  - Permission scope
  - Device audit

### Deliverables

- Device registry in Local AI Core.
- Presence protocol.
- Device list UI.
- Workspace graph UI.
- Remote task control API.
- Pairing and revocation UI.

### Acceptance Criteria

- The app can show at least two devices and their workspaces.
- A user can see which device is running which task.
- A user can start or control a task on a selected trusted device.
- Revoked devices lose access.

### Edge Cases

- Two devices have the same workspace name.
- Same repo exists at different paths.
- Device clock skew affects last-seen display.
- Device comes online after a long offline period.
- Relay is unavailable but LAN is available.

## Phase 6: Mobile Local AI Core Lightweight Mode

### Goal

Support a lightweight Local AI Core mode on mobile after the companion workflow
has proven useful.

### Scope

- Define mobile Local AI Core responsibilities:
  - Device identity
  - Pairing
  - Local cache
  - Notification routing
  - Approval state
  - Lightweight task metadata
- Explore mobile runtime constraints:
  - Background execution
  - File access
  - Battery impact
  - OS permissions
  - App Store review constraints
- Implement limited local core mode first.
- Defer full mobile agent execution until there is a strong use case.

### Out Of Scope

- Full coding agent runtime on mobile.
- Heavy local model inference by default.
- Long-running background jobs without explicit platform support.

### Deliverables

- Mobile core design note.
- Lightweight core implementation prototype.
- Mobile persistence layer.
- Sync protocol for task metadata and approvals.

### Acceptance Criteria

- Mobile can maintain trusted device identity.
- Mobile can cache recent tasks and approvals.
- Mobile behavior remains predictable when offline.
- Mobile core does not drain battery in normal idle use.

### Edge Cases

- App is killed by the OS.
- Background notification wakes the app late.
- User changes phone.
- User restores from backup.
- Device identity must be rotated.

## Phase 7: Plugin SDK And Ecosystem

### Goal

Turn built-in integrations into a stable plugin platform.

### Scope

- Finalize plugin manifest shape.
- Add plugin capability contracts:
  - Runtime detection
  - Runtime execution
  - Channel
  - Knowledge
  - Scheduler
  - UI contribution
  - Security policy
- Provide plugin templates.
- Add static plugin registry first.
- Add plugin health diagnostics.
- Add plugin permission declarations.
- Add signature and provenance design before dynamic loading.
- Document how to add a new runtime detection plugin.

### Deliverables

- `packages/plugin-sdk` contracts.
- Runtime detection plugin template.
- Built-in opencode detection plugin.
- Plugin diagnostics UI.
- Plugin authoring documentation.

### Acceptance Criteria

- A new built-in runtime detection plugin can be added without changing core
  detection service logic.
- Plugin health is visible in diagnostics.
- Plugin capabilities and permissions are visible to users.
- Dynamic third-party loading has a documented security design before it ships.

### Edge Cases

- Plugin throws during initialization.
- Plugin reports malformed capability data.
- Plugin version is incompatible with Local AI Core.
- Plugin depends on another plugin that is disabled.

## Suggested 90-Day Roadmap

### Days 1-15

- Finalize runtime detection contract.
- Add opencode detection in Local AI Core.
- Add runtime status UI.
- Add startup and manual refresh flows.
- Add detection diagnostics.

### Days 16-30

- Add task and workspace contracts.
- Add workspace registry.
- Add task list and task detail surfaces.
- Connect existing thread/runtime flows to task state where possible.
- Add runtime health summary to dashboard.

### Days 31-45

- Add approval request model.
- Add desktop approval UI.
- Add command risk classification baseline.
- Add audit log for runtime detection, tasks, and approvals.
- Add workspace permission settings.

### Days 46-60

- Add mobile/PWA shell.
- Add desktop-to-phone pairing.
- Add mobile task list and task detail.
- Add mobile approval flow.
- Add local notification and push notification proof of concept.

### Days 61-75

- Add device registry.
- Add device presence.
- Show remote devices and their workspaces.
- Add remote task status read APIs.
- Add device revocation.

### Days 76-90

- Add remote task control.
- Add workspace graph view.
- Harden mobile approval and notification flows.
- Add second runtime detection adapter after opencode.
- Publish initial plugin SDK design notes.

## Priority Stack

1. Runtime detection, starting with opencode.
2. Runtime and workspace status UI.
3. Task model and task dashboard.
4. Approval and audit model.
5. Mobile companion for task control and approval.
6. Device registry and cross-device workspace graph.
7. Lightweight mobile Local AI Core.
8. Plugin SDK and ecosystem hardening.

## Execution Checklist

### Phase 0: Product And Architecture Baseline

- [x] Confirm the one-sentence product positioning.
  - Documented in `docs/product/product-baseline.md`.
- [x] Finalize user-facing terminology for runtimes, workspaces, tasks, devices,
  plugins, approvals, and Local AI Core.
  - Documented in `docs/product/glossary.md`.
- [x] Define which state belongs in Local AI Core, renderer, Electron, and shared
  contracts.
  - Documented in `docs/architecture/state-ownership.md`.
- [x] Draft runtime detection contracts.
  - Implemented in shared contracts and documented in `docs/features/runtime-detection.md`.
- [x] Draft task status contracts.
  - Implemented in shared contracts and documented in `docs/features/workspace-task-model.md`.
- [x] Draft workspace registry contracts.
  - Implemented in shared contracts and documented in `docs/features/workspace-task-model.md`.
- [x] Draft device registry contracts.
  - Drafted in `docs/features/device-workspace-registry.md`.
- [x] Document the future runtime installation boundary without implementing
  installation.
  - Documented in `docs/architecture/runtime-installation-boundary.md`.

### Phase 1: Local Agent Installation Detection Only

- [x] Define installation status values: `installed`, `not_installed`, `error`,
  and `unknown`.
- [x] Add shared runtime detection result types.
- [x] Add shared runtime issue and remediation types.
- [ ] Add Local AI Core runtime detection registry.
  - Deferred: the current implementation uses a centralized detector plus
    service/store. A pluggable adapter registry should be added with the plugin
    SDK work, after the Phase 2 task/workspace model is stable.
- [x] Add Local AI Core runtime detection service.
- [x] Add timeout handling for detection commands.
- [x] Add startup runtime detection.
- [x] Add manual runtime refresh.
- [x] Persist the latest runtime detection result.
- [x] Emit runtime detection events.
- [x] Add opencode detection adapter.
- [x] Detect opencode binary path.
- [x] Detect opencode version.
- [x] Handle opencode not installed.
- [ ] Add Claude Code detection adapter.
  - Partial: bundled `claude-agent-acp` detection exists for the current desktop
    runtime path. Direct `claude` CLI detection is still pending.
- [ ] Detect Claude Code through the `claude` command.
- [x] Add Codex detection adapter.
- [x] Detect Codex through the `codex` command.
- [x] Handle opencode detection command failure.
- [x] Handle opencode detection timeout.
- [x] Add runtime list API.
- [x] Add single runtime status API.
- [x] Add refresh-all API.
- [x] Add refresh-one-runtime API.
- [x] Add renderer runtime status page or panel.
- [x] Add runtime status badges.
- [x] Add runtime details drawer or panel.
- [x] Add recommended manual action text.
- [x] Add Local AI Core unavailable state.
- [x] Add detection running state.
- [x] Add no supported local agents installed state.
- [x] Add diagnostics logging for detection.
- [x] Verify detection does not attempt installation.
- [x] Verify detection does not require provider login checks.

### Phase 2: Workspace And Task Control Center

- [x] Define workspace registry model.
- [x] Add workspace persistence in Local AI Core.
- [x] Add workspace add/remove/update flows.
- [x] Detect basic Git metadata for workspaces.
- [x] Add workspace health summary.
- [x] Define task model.
- [x] Define task lifecycle statuses.
- [x] Define task timeline item types.
- [x] Persist task records in Local AI Core.
- [x] Associate tasks with workspace, runtime, thread, and device.
- [x] Add active task list.
- [x] Add recent task list.
- [x] Add task detail view.
- [x] Add workspace detail view.
- [x] Add dashboard installed agents section.
- [x] Add dashboard active tasks section.
- [x] Add dashboard waiting-for-user section.
- [x] Add dashboard recent completions section.
- [x] Add large-log handling strategy.
- [x] Add app restart behavior for in-progress task state.

### Phase 3: Security, Approval, And Audit

- [x] Define permission scopes.
  - Documented in `docs/features/security-approval.md`.
- [x] Define permission levels: `deny`, `ask`, and `allow`.
  - Documented in `docs/features/security-approval.md`.
- [x] Add workspace security settings.
  - Persisted through `workspace_security_settings`.
- [x] Add approval request contract.
  - Implemented in `packages/contracts/src/local-core.ts`.
- [x] Add approval persistence.
  - Persisted through `approval_requests`.
- [x] Add desktop approval UI.
  - Thread permission cards remain the interactive approval surface; Dashboard adds pending approval overview.
- [x] Add approval resolve flow.
  - ACP permission responses resolve approval records.
- [x] Add command risk classification baseline.
  - Implemented in `services/local-ai-core/src/security/command-risk.ts`.
- [x] Add high-risk command rules.
- [x] Add medium-risk command rules.
- [x] Add audit event contract.
  - Implemented in `packages/contracts/src/local-core.ts`.
- [x] Persist audit events.
  - Persisted through `audit_events`.
- [x] Add audit log UI.
  - Dashboard adds recent audit overview.
- [x] Add secret redaction baseline for logs.
  - Applied to task logs, approval text, and audit summaries.
- [x] Add permission change audit events.
- [x] Add task lifecycle audit events.
- [x] Add approval audit events.
- [x] Research checkpoint and rollback options.
  - Documented in `docs/features/security-approval.md`.
- [x] Implement the safest initial rollback/checkpoint strategy.
  - Safest initial strategy is no automatic rollback yet; defer to VCS-aware checkpoints once command execution guards can map file changes reliably.

### Phase 4: Mobile Companion MVP

- [ ] Decide PWA versus native app for the first mobile companion.
- [ ] Design desktop-to-phone pairing flow.
- [ ] Add pairing token or QR code flow.
- [ ] Add mobile authentication/session model.
- [ ] Add mobile device list.
- [ ] Add mobile workspace list.
- [ ] Add mobile task list.
- [ ] Add mobile task detail.
- [ ] Add mobile create-task flow.
- [ ] Add mobile approval UI.
- [ ] Add mobile approve/reject flow.
- [ ] Add mobile task pause/resume/cancel actions where supported.
- [ ] Add notification proof of concept.
- [ ] Add task-completed notification.
- [ ] Add approval-needed notification.
- [ ] Handle expired pairing codes.
- [ ] Handle offline desktop state.

### Phase 5: Cross-Device Workspace Graph

- [ ] Define device registry model.
- [ ] Add device identity.
- [ ] Add device pairing persistence.
- [ ] Add device revocation.
- [ ] Add device presence protocol.
- [ ] Show online/offline device status.
- [ ] Show Local AI Core version per device.
- [ ] Show installed agents per device.
- [ ] Show workspace list per device.
- [ ] Add workspace graph view.
- [ ] Add remote task status read API.
- [ ] Add remote task cancellation.
- [ ] Add remote approval support.
- [ ] Add LAN discovery research.
- [ ] Add Tailscale-friendly direct connection support.
- [ ] Add relay fallback design.
- [ ] Add device audit events.

### Phase 6: Mobile Local AI Core Lightweight Mode

- [ ] Define mobile Local AI Core responsibilities.
- [ ] Define mobile device identity behavior.
- [ ] Add mobile task metadata cache.
- [ ] Add mobile approval state cache.
- [ ] Add mobile notification state.
- [ ] Add offline behavior design.
- [ ] Research background execution constraints.
- [ ] Research battery impact constraints.
- [ ] Research file access constraints.
- [ ] Prototype lightweight Local AI Core mode.
- [ ] Validate app kill and restore behavior.
- [ ] Validate device identity rotation.

### Phase 7: Plugin SDK And Ecosystem

- [ ] Finalize plugin manifest shape.
- [ ] Add runtime detection plugin interface.
- [ ] Add capability declaration interface.
- [ ] Add permission declaration interface.
- [ ] Add plugin health check interface.
- [ ] Add static plugin registry.
- [ ] Convert opencode detection into a built-in plugin shape.
- [ ] Add plugin diagnostics UI.
- [ ] Add runtime detection plugin template.
- [ ] Add plugin authoring documentation.
- [ ] Add plugin version compatibility checks.
- [ ] Add plugin dependency handling.
- [ ] Design plugin signature and provenance model.
- [ ] Defer dynamic third-party plugin loading until security design is ready.

### Documentation Checklist

- [x] Create `docs/product/product-baseline.md`.
- [x] Create `docs/product/glossary.md`.
- [x] Create `docs/architecture/state-ownership.md`.
- [x] Create `docs/architecture/runtime-installation-boundary.md`.
- [x] Create `docs/features/runtime-detection.md`.
- [x] Create `docs/features/workspace-task-model.md`.
- [x] Create `docs/features/device-workspace-registry.md`.
- [x] Create `docs/features/security-approval.md`.
- [ ] Create `docs/features/mobile-companion.md`.
- [ ] Create `docs/features/cross-device-workspaces.md`.
- [ ] Create `docs/features/plugin-sdk-plan.md`.
- [x] Keep `docs/planning/todo.md` aligned with this development plan.
- [x] Add validation commands or manual QA notes to each detailed design doc.

## Success Metrics

- Time from first launch to first successful runtime detection.
- Runtime detection success rate.
- Percentage of users with at least one installed local agent.
- Weekly active workspaces.
- Weekly successful agent tasks.
- Percentage of tasks with visible status transitions.
- Approval request completion rate.
- Mobile pairing rate.
- Mobile approval usage rate.
- Multi-device activation rate.
- 7-day and 30-day retention.

## Product Risks

- The product becomes too broad before the first workflow is excellent.
- Runtime detection becomes unreliable across user environments.
- Security is treated as a later feature, reducing trust.
- Mobile app scope expands into full IDE complexity too early.
- Cross-device networking becomes hard to debug without strong diagnostics.
- Plugin abstractions become too flexible before real built-in plugins validate
  them.

## Near-Term Backlog

- Define Phase 2 workspace registry contracts.
- Define Phase 2 task contracts and lifecycle statuses.
- Add Local AI Core persistence for workspace and task records.
- Add workspace registry API endpoints.
- Add task list/detail API endpoints.
- Connect existing thread/runtime flows to task records.
- Add dashboard active tasks and waiting-for-user sections.
- Design task lifecycle states.
- Design approval request shape.
- Design device pairing flow.
- Decide whether the first mobile companion is PWA, React Native, or another
  host.
- Add direct Claude Code `claude` command detection.

## Phase 1 Implementation Breakdown

Status: complete for the first shippable runtime detection slice.

Implemented:

- Shared runtime detection result, issue, and recommended action contracts.
- Local AI Core runtime detection service and persisted store.
- Startup detection and manual refresh.
- Runtime list, single runtime, refresh-all, and refresh-one APIs.
- Runtime detection events for started, completed, failed, and status-changed
  states.
- Version and binary path detection for supported command-based runtimes.
- Timeout and failure handling that keeps a resolved runtime marked installed
  even when version detection fails.
- Dashboard runtime status UI with installed, not installed, error, unknown, and
  checking states.

Validation:

- `pnpm build:electron`
- `node --test dist-electron/electron/agent-runtime-detector.test.js dist-electron/electron/runtime-detection-service.test.js`
- `pnpm build:renderer`
- `pnpm test`

Known Phase 1 follow-ups:

- Direct Claude Code CLI detection through the `claude` command.
- A true pluggable runtime detection adapter registry. This is intentionally
  deferred until plugin SDK hardening so Phase 2 can proceed on stable workspace
  and task primitives.

This phase should be treated as the first shippable product slice. The user
should be able to open the app and immediately understand whether the current
machine already has supported local agent CLIs installed.

### 1. Runtime Detection Domain Model

Add a shared runtime detection model with stable installation states.

Recommended runtime status values:

- `installed`: local agent CLI/runtime is installed and can be resolved.
- `not_installed`: local agent CLI/runtime cannot be found.
- `error`: detection ran but failed unexpectedly.
- `unknown`: detection has not run yet or current state cannot be determined.

Recommended detection result fields:

- `runtimeId`: stable id such as `opencode`.
- `displayName`: user-facing name such as `opencode`.
- `status`: current status.
- `version`: detected version, when available.
- `binaryPath`: resolved executable path, when available.
- `detectedAt`: timestamp.
- `summary`: short user-facing installation summary.
- `details`: optional longer diagnostic text.
- `issues`: list of structured issues.
- `recommendedActions`: safe manual installation or troubleshooting steps.
- `capabilities`: optional runtime capabilities detected or inferred.
- `raw`: optional internal diagnostic payload, kept out of normal UI.

Recommended issue fields:

- `code`: stable machine-readable issue id.
- `severity`: `info`, `warning`, or `error`.
- `message`: user-facing message.
- `help`: optional remediation text.

### 2. Local AI Core Runtime Detection Service

Add a Local AI Core service responsible for local agent installation detection
orchestration.

Responsibilities:

- Own the list of registered runtime detection adapters.
- Run detection on startup.
- Run detection on manual refresh.
- Apply timeouts to each detection command.
- Normalize adapter output into shared contracts.
- Persist the latest detection results.
- Emit runtime status events for renderer updates.
- Keep adapter failures isolated.

Suggested internal modules:

- `runtime-detection-service`
- `runtime-detection-registry`
- `runtime-detection-adapter`
- `runtime-detection-store`
- `runtime-detection-events`

Adapter interface sketch:

```ts
export interface RuntimeDetectionAdapter {
  id: string;
  displayName: string;
  detect(ctx: RuntimeDetectionContext): Promise<RuntimeDetectionResult>;
}
```

Context sketch:

```ts
export interface RuntimeDetectionContext {
  env: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs: number;
  logger: RuntimeDetectionLogger;
  exec: RuntimeDetectionExec;
}
```

### 3. Local Agent Detection Adapters

The first adapter should focus on opencode. Then add Claude Code and Codex using
the same contract.

Target commands:

- opencode: `opencode`
- Claude Code: `claude`
- Codex: `codex`

Detection steps:

- Resolve the target command from PATH.
- Run a version command with a short timeout.
- Parse version output.
- Return `installed` when the binary is found. Version is useful but should not
  be required for installation detection if the command exists.
- Return `not_installed` when the binary cannot be found.
- Return `error` when detection itself fails unexpectedly.

Do not mark an installed agent as not installed just because login, provider,
model, or project readiness is unknown. Those checks belong to a later health
or readiness layer.

Do not:

- Install opencode, Claude Code, Codex, or any other agent.
- Modify shell profile files.
- Write credentials.
- Check provider login as part of Phase 1 installation detection.
- Run project-affecting commands.
- Start long-running agent sessions.

### 4. Local AI Core API Surface

Add API endpoints or equivalent SDK methods for runtime detection.

Recommended endpoints:

- `GET /api/local/v1/runtimes`
- `GET /api/local/v1/runtimes/:runtimeId`
- `POST /api/local/v1/runtimes/refresh`
- `POST /api/local/v1/runtimes/:runtimeId/refresh`

Recommended event types:

- `runtime.detect.started`
- `runtime.detect.completed`
- `runtime.detect.failed`
- `runtime.status.changed`

The renderer should not run detection commands directly. It should only request
state or trigger refresh through Local AI Core.

### 5. Renderer Runtime Status UI

Add a local agent status surface that works even when no supported local agent is
installed.

Minimum UI:

- Runtime list.
- Status badge.
- Version and binary path where available.
- Last checked time.
- Manual refresh button.
- Details drawer or panel.
- Recommended manual action text.

Useful empty states:

- No runtime checks have run yet.
- No supported local agents installed.
- Local AI Core is unavailable.
- Detection is running.

Suggested visual states:

- `installed`: positive but understated.
- `not_installed`: neutral warning with manual setup steps.
- `error`: error state with retry and diagnostics.
- `unknown`: quiet placeholder.

### 6. Telemetry And Diagnostics

For local-first trust, diagnostics should be transparent and inspectable.

Capture:

- Detection start and end time.
- Adapter id.
- Runtime status.
- Duration.
- Error code.
- Timeout flag.
- Sanitized command metadata.

Avoid capturing:

- API keys.
- Full shell environment.
- Home directory secrets.
- Raw config files.

### 7. Phase 1 Test Suggestions

Because this snapshot currently uses smoke testing as the main verification path,
start with focused local tests if a runner is introduced later. Until then,
validate with deterministic manual or scriptable checks.

Suggested cases:

- opencode is not installed.
- opencode is installed and version command succeeds.
- opencode exists but version command exits non-zero; status should remain
  `installed` if the binary was resolved.
- opencode command hangs and times out.
- Claude Code is installed as `claude`.
- Codex is installed as `codex`.
- PATH contains multiple binaries for the same agent.
- Runtime detection refresh is triggered twice quickly.
- Local AI Core restarts and returns persisted latest status.
- Renderer loads while detection is still running.

## Phase 2 Implementation Breakdown

Phase 2 turns runtime visibility into a daily-use agent workstation.

Status: complete for the first workspace and task control-center slice.

Implemented:

- Shared workspace registry and task contracts.
- SQLite persistence for workspace registry entries and agent task records in
  Local AI Core.
- Workspace registry APIs for list, detail, create, update, and delete.
- Task APIs for list, detail, create, and update.
- Configured workspace sync into the registry with basic Git and health
  summaries.
- Automatic task creation when a thread message starts an agent run.
- Task status updates when runs enter waiting, complete, cancel, or fail states.
- Dashboard sections for active tasks, waiting-for-user tasks, and recent
  completions.

Validation:

- `pnpm build:electron`
- `node --test dist-electron/electron/workspace-task-store.test.js dist-electron/electron/runtime-detection-service.test.js`
- `pnpm build:renderer`
- `pnpm test`

### Phase 2 Preparation Status

Phase 1 has established the runtime status input needed by the control center:

- Runtime detection results are normalized in shared contracts.
- Local AI Core owns runtime detection state through a service and persisted
  store.
- Startup detection, manual refresh, and detection events are available.
- The dashboard can show installed, missing, errored, unknown, and checking
  runtime states.

Phase 2 should now add the product objects that runtime status attaches to:
workspaces and tasks. The first implementation slice should be contracts and
Local AI Core persistence, then dashboard/workspace/task UI.

Recommended Phase 2 execution order:

1. Add workspace and task contracts in `packages/contracts`.
2. Add file-backed or SQLite-backed Local AI Core persistence for workspaces and
   tasks.
3. Expose workspace registry and task list/detail APIs.
4. Attach existing threads and runtime choices to task records where possible.
5. Add dashboard sections for active tasks, waiting-for-user tasks, and recent
   completions.
6. Add workspace detail and task detail views.

Phase 2 first-slice acceptance criteria:

- A workspace has a stable id, path, display name, default runtime, Git summary,
  health summary, and recent task ids.
- A task has a stable id, workspace id, runtime id, thread id, status, timeline,
  timestamps, summary, and error fields.
- Local AI Core can list active tasks, recent tasks, and task detail after an app
  restart.
- The dashboard remains useful when no task has run yet.

### 1. Workspace Registry

The workspace registry should live in Local AI Core and expose normalized
workspace metadata to the renderer.

Recommended workspace fields:

- `workspaceId`
- `displayName`
- `path`
- `deviceId`
- `createdAt`
- `lastOpenedAt`
- `git`
- `defaultRuntimeId`
- `health`
- `activeTaskCount`
- `recentTaskIds`

Recommended Git fields:

- `isRepo`
- `branch`
- `remote`
- `dirty`
- `ahead`
- `behind`
- `lastCommit`

Workspace health should summarize problems without blocking use:

- Missing path.
- Git unavailable.
- No supported local agent installed.
- Permission issue.
- No known test command.

### 2. Task Model

Tasks should become the central product object.

Recommended task fields:

- `taskId`
- `workspaceId`
- `deviceId`
- `runtimeId`
- `threadId`
- `title`
- `prompt`
- `status`
- `createdAt`
- `startedAt`
- `completedAt`
- `updatedAt`
- `summary`
- `error`
- `timeline`
- `logs`
- `artifacts`
- `approvals`

Recommended task statuses:

- `created`
- `queued`
- `running`
- `waiting_for_user`
- `completed`
- `failed`
- `cancelled`

Recommended timeline item types:

- `status_change`
- `message`
- `command`
- `file_change`
- `approval_requested`
- `approval_resolved`
- `error`
- `summary`

### 3. Dashboard UI

The dashboard should answer four questions immediately:

- Which local agents are installed?
- What is running?
- What needs my attention?
- What recently changed?

Recommended dashboard sections:

- Installed agents strip.
- Active tasks.
- Waiting for approval.
- Recent completed tasks.
- Workspace health.
- Device status placeholder for later phases.

### 4. Workspace Detail UI

Workspace detail should show:

- Workspace path and Git branch.
- Installed agent status for this workspace.
- Active task queue.
- Recent tasks.
- Common actions.
- Security settings entry point.
- Diagnostics entry point.

### 5. Task Detail UI

Task detail should show:

- Current status.
- Runtime and workspace.
- Timeline.
- Streaming logs.
- File changes when available.
- Approvals.
- Final summary.
- Error details.
- Retry or continue actions when supported.

## Phase 3 Implementation Breakdown

Security and approval should be designed as product primitives, not as hidden
implementation details.

### 1. Permission Model

Recommended permission scopes:

- `workspace.read`
- `workspace.write`
- `command.execute`
- `network.access`
- `secrets.access`
- `git.modify`
- `device.remote_control`

Recommended permission levels:

- `deny`
- `ask`
- `allow`

Default policy should be conservative:

- Read workspace: allow after workspace is added.
- Write workspace: ask or allow depending on user preference.
- Execute command: ask for high-risk commands.
- Network access: ask for unknown destinations.
- Secrets access: deny by default.
- Git modify: ask for push, reset, tag, publish, or branch deletion.

### 2. Approval Request Model

Recommended approval fields:

- `approvalId`
- `taskId`
- `workspaceId`
- `deviceId`
- `runtimeId`
- `kind`
- `riskLevel`
- `title`
- `description`
- `requestedAction`
- `createdAt`
- `expiresAt`
- `status`
- `resolvedBy`
- `resolvedAt`
- `decision`

Recommended approval kinds:

- `command`
- `file_write`
- `network`
- `secret`
- `git`
- `plugin_permission`

Recommended decisions:

- `approved_once`
- `approved_for_task`
- `approved_for_workspace`
- `rejected`

### 3. Risk Classification

Start with simple, explainable command rules.

High-risk examples:

- Deleting many files.
- Modifying Git history.
- Pushing to remotes.
- Publishing packages.
- Accessing SSH keys.
- Reading environment files.
- Running downloaded scripts.
- Changing system configuration.

Medium-risk examples:

- Installing dependencies.
- Running migrations.
- Writing generated files.
- Network calls to unknown domains.

Low-risk examples:

- Reading files inside approved workspace.
- Running tests.
- Running type checks.
- Listing directories.

### 4. Audit Log

Audit events should be immutable from normal UI.

Recommended audit events:

- Runtime detection completed.
- Workspace added or removed.
- Task created, started, completed, failed, or cancelled.
- Approval requested.
- Approval approved or rejected.
- Permission changed.
- Device paired or revoked.
- Plugin enabled or disabled.

Each event should include:

- Event id.
- Type.
- Timestamp.
- Actor.
- Device id.
- Workspace id, if applicable.
- Task id, if applicable.
- Sanitized payload.

## Phase 4-7 Planning Notes

### Mobile Companion First Slice

The first phone experience should be intentionally narrow:

- Pair with desktop.
- View active tasks.
- Start a simple task.
- Approve or reject actions.
- Receive notifications.

This is enough to create the core product magic: the computer does the work,
and the phone becomes the control surface.

### Cross-Device First Slice

The first cross-device release should avoid remote editing. It should focus on:

- Device presence.
- Installed agents per device.
- Workspace list per device.
- Active task state per device.
- Remote approval.
- Remote task cancellation.

### Mobile Local AI Core First Slice

Mobile Local AI Core should initially be a control and cache node:

- Device identity.
- Pairing state.
- Recent task cache.
- Approval state.
- Notification state.

Full mobile agent execution should wait until the companion workflow proves
retention and users clearly ask for phone-side execution.

### Plugin SDK First Slice

The first SDK slice should focus on runtime detection plugins:

- Manifest.
- Detection adapter interface.
- Capability declaration.
- Permission declaration.
- Health check.
- Diagnostics.

Runtime execution plugins, UI contribution plugins, channel plugins, and
knowledge plugins can build on this foundation.

## Suggested Documentation Set

As implementation begins, split detailed designs into smaller focused docs:

- `docs/product/product-baseline.md`
- `docs/product/glossary.md`
- `docs/architecture/state-ownership.md`
- `docs/architecture/runtime-installation-boundary.md`
- `docs/features/runtime-detection.md`
- `docs/features/workspace-task-model.md`
- `docs/features/device-workspace-registry.md`
- `docs/features/security-approval.md`
- `docs/features/mobile-companion.md`
- `docs/features/cross-device-workspaces.md`
- `docs/features/plugin-sdk-plan.md`

Each doc should include:

- Problem statement.
- User-facing behavior.
- Contracts.
- Local AI Core responsibilities.
- Renderer responsibilities.
- Electron responsibilities, if any.
- Edge cases.
- Validation plan.
