# Product Baseline

Phase 0 turns the product direction into a shared implementation baseline.

## Product Sentence

AgentDock is a local-first, cross-device AI agent workstation for managing agent runtimes, workspaces, tasks, approvals, devices, and automation from one control surface.

## First Wedge

The first wedge is reliable local agent runtime detection. On first launch, a user should be able to see which supported local agent CLIs are installed on this machine before the app attempts runtime installation, credential checks, or project-specific readiness checks.

## Core Concepts

- Agent runtime: a local agent CLI or engine that can perform work, such as opencode, Claude Code, Codex, Aider, or Gemini CLI.
- Workspace: a user-selected local project directory with durable identity, metadata, health state, and task history.
- Task: a durable unit of agent work with status, timeline, logs, artifacts, approvals, and links to workspace, runtime, thread, and device.
- Device: a trusted desktop or mobile endpoint that can observe or control work according to granted permissions.
- Local AI Core: the local service that owns durable runtime, workspace, task, device, plugin, and approval state.
- Plugin: a statically registered extension point for runtime detection, channels, knowledge providers, schedulers, or future runtime capabilities.
- Approval: a user decision that allows or denies a higher-risk action requested by an agent task.

## Domain Model Baseline

Runtime detection state is machine-local and owned by Local AI Core. It answers installation status and basic metadata only.

Workspace registry state is durable and owned by Local AI Core. It provides stable workspace identity, local path, display name, Git summary, default runtime, last active task, and health summary.

Task state is durable and owned by Local AI Core. Renderer components should treat task state as API data, not reconstruct task lifecycle from chat messages.

Device presence state is owned by Local AI Core. Device records and trust state should be synchronized through explicit pairing and permission flows, not inferred from ad hoc network reachability.

Approval state is owned by Local AI Core and will be connected to audit logs in the security phase.

## Phase 0 Deliverables

- Runtime detection contract draft: implemented in shared contracts and documented in [Runtime Detection](../features/runtime-detection.md).
- Task status contract draft: implemented in shared contracts and documented in [Workspace Task Model](../features/workspace-task-model.md).
- Device and workspace registry contract draft: see [Device And Workspace Registry](../features/device-workspace-registry.md).
- Initial product terminology glossary: see [Glossary](glossary.md).

## Acceptance Status

- Product sentence: complete.
- Runtime state owner: Local AI Core.
- Task state owner: Local AI Core.
- Workspace state owner: Local AI Core.
- Device state owner: Local AI Core, with richer implementation deferred.
- Future installation support: reserved interface shape documented in [Runtime Installation Boundary](../architecture/runtime-installation-boundary.md); no installer implementation is present.
