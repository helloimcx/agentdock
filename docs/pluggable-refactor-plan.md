# Pluggable Refactor Plan

This checklist turns the target architecture in [pluggable-architecture.md](./pluggable-architecture.md) into an executable refactor plan.

## Usage

- Keep this file updated as the single source of truth for the migration.
- Prefer small PRs per checkbox group.
- Do not start dynamic plugin loading before static registration is stable.
- Treat every phase as shippable on its own.

## Phase 0: Baseline And Guardrails

### Scope

Stabilize the current system before introducing registries and plugin abstractions.

### Tasks

- [x] Audit current hardcoded module composition in `services/local-ai-core/src/runtime/local-core-controller.ts`
- [x] Audit current hardcoded feature switches in `src/app/runtime.ts`
- [x] Audit current hardcoded routes in `src/App.tsx`
- [x] Audit current hardcoded nav items in `src/components/Layout/Sidebar.tsx`
- [x] Audit current capability declarations in `services/local-ai-core/src/router/workspace-router.ts`
- [x] Write a short ADR documenting why the system is moving from layered modules to plugin-based composition
- [x] Define naming conventions for plugin ids, capability ids, and feature ids
- [x] Define a folder convention for future plugins under `services/local-ai-core/src/plugins/`

### Exit Criteria

- [ ] The team agrees on plugin naming and directory conventions
- [x] The current hardcoded composition points are explicitly documented
- [ ] No new feature work adds more boolean-based feature switches

## Phase 1: Contracts And Kernel Skeleton

### Scope

Create the minimum kernel abstractions without changing business behavior.

### Tasks

- [x] Add `packages/plugin-sdk/` for plugin contracts and helper types
- [x] Add `PluginManifest` type
- [x] Add `RuntimePlugin` type
- [x] Add `PluginContext` type
- [x] Add `PluginHealth` type
- [x] Add `CapabilityRegistry` interfaces for agent, channel, knowledge, scheduler, and UI contributions
- [x] Add `kernel/plugin-registry.ts`
- [x] Add `kernel/capability-registry.ts`
- [x] Add `kernel/lifecycle-manager.ts`
- [x] Add `kernel/event-bus.ts`
- [x] Add `kernel/bootstrap.ts`
- [x] Add a minimal `kernel/diagnostics.ts`
- [x] Keep bootstrap static for now, with explicit imports of built-in plugins

### Suggested Paths

- `packages/plugin-sdk/src/index.ts`
- `services/local-ai-core/src/kernel/plugin-registry.ts`
- `services/local-ai-core/src/kernel/capability-registry.ts`
- `services/local-ai-core/src/kernel/lifecycle-manager.ts`
- `services/local-ai-core/src/kernel/event-bus.ts`
- `services/local-ai-core/src/kernel/bootstrap.ts`

### Exit Criteria

- [x] The kernel can register plugins and expose a capability snapshot
- [x] No business plugin is dynamically loaded yet
- [x] Existing behavior remains unchanged

## Phase 2: Replace Direct Composition With Bootstrap

### Scope

Move object wiring out of `LocalCoreController` and into a composition root.

### Tasks

- [x] Extract controller wiring logic into `kernel/bootstrap.ts`
- [x] Stop constructing concrete modules directly inside `LocalCoreController`
- [ ] Pass registries and resolved capabilities into controller/services through constructor injection
- [x] Move runtime-owned singletons behind a bootstrap container object
- [x] Ensure logs, stores, config readers, and event bus are created in one place only
- [x] Keep existing endpoints and API behavior unchanged

### Current Code To Untangle

- [x] `new AiVectorKnowledgeProvider(...)`
- [x] `new LocalCoreLarkGateway(...)`
- [x] `new SchedulerService(...)`
- [x] `new LarkScheduleAdapter(...)`
- [x] `createWorkspaceRouter(...)`

### Exit Criteria

- [x] `LocalCoreController` no longer acts as the main composition root
- [x] All built-in modules are created by bootstrap and injected
- [x] There is one obvious place to register built-in plugins

## Phase 3: Capability Extraction For Knowledge

### Scope

Turn knowledge handling into a first-class plugin capability.

### Tasks

- [x] Define `KnowledgePlugin` in `packages/plugin-sdk`
- [x] Adapt `packages/knowledge-api` to implement `KnowledgePlugin`
- [x] Move `AiVectorKnowledgeProvider` registration into a built-in plugin
- [x] Ensure thread-to-knowledge attachment remains outside the concrete provider where possible
- [x] Separate knowledge storage policy from knowledge provider implementation
- [x] Add a noop or disabled knowledge plugin registration path
- [x] Expose installed knowledge providers through runtime capabilities

### Current Code To Untangle

- [x] `packages/knowledge-api/src/ai-vector-provider.ts`
- [x] `packages/knowledge-api/src/index.ts`
- [x] knowledge references inside `WorkspaceRouter`
- [x] knowledge-specific settings persistence inside `LocalCoreController`

### Exit Criteria

- [x] A second knowledge provider can be added without editing kernel code
- [x] The runtime reports active knowledge capabilities from registry state

## Phase 4: Capability Extraction For Channels

### Scope

Turn Lark into a channel plugin and remove channel-specific logic from core contracts where possible.

### Tasks

- [x] Define `ChannelPlugin` and `ChannelRoute` abstractions
- [x] Convert `LocalCoreLarkGateway` into a built-in `channel-lark` plugin
- [x] Move channel binding startup and shutdown into plugin lifecycle hooks
- [x] Replace channel-specific registration with registry lookup
- [x] Generalize platform pairing lifecycle to channel-agnostic events
- [x] Generalize route models so they do not require `type: 'lark_chat'` in core contracts
- [x] Keep current Lark behavior unchanged during extraction

### Current Code To Untangle

- [x] `services/local-ai-core/src/gateway/local-core-lark-gateway.ts`
- [x] scheduler route typing in `packages/contracts/src/local-core.ts`
- [x] Lark-specific methods inside `src/api/desktop.ts`
- [x] Lark-specific capability strings in `WorkspaceRouter.getCapabilities()`

### Exit Criteria

- [x] Lark is registered as a plugin, not instantiated as a hard dependency of the kernel
- [x] Core route contracts are channel-agnostic
- [x] Adding Slack or Discord would not require kernel edits

## Phase 5: Capability Extraction For Agents

### Scope

Make agent runtimes pluggable instead of encoding agent type logic into router/config mapping.

### Tasks

- [x] Define `AgentRuntime` capability
- [x] Convert opencode support into `agent-opencode`
- [x] Convert Claude Code support into `agent-claudecode`
- [x] Convert local core ACP support into `agent-localcore-acp`
- [x] Move workspace capability checks out of `WorkspaceRouter`
- [x] Replace hardcoded agent type arrays with registry queries
- [x] Split project config normalization from runtime selection logic
- [x] Keep workspace config translation in a thin adapter layer

### Current Code To Untangle

- [x] `services/local-ai-core/src/router/workspace-route-config.ts`
- [x] `services/local-ai-core/src/router/workspace-router.ts`
- [x] agent type constants in `shared/desktop.ts`

### Exit Criteria

- [x] `WorkspaceRouter` depends on `AgentRuntime` interfaces, not agent type strings
- [x] Adding a new agent runtime does not require editing router internals

## Phase 6: Scheduler Refactor

### Scope

Separate scheduler trigger logic from delivery/channel logic and register both through capabilities.

### Tasks

- [x] Define scheduler trigger and scheduler executor plugin contracts
- [x] Convert `LarkScheduleAdapter` into a scheduler delivery plugin
- [x] Keep cron as a built-in trigger plugin
- [x] Remove direct scheduler-to-Lark assumptions from `LocalCoreController`
- [x] Generalize scheduled job route and execution target models
- [x] Expose supported trigger types and delivery targets from registry state

### Current Code To Untangle

- [x] `services/local-ai-core/src/scheduler/adapters.ts`
- [x] `services/local-ai-core/src/scheduler/lark-schedule-adapter.ts`
- [x] `services/local-ai-core/src/scheduler/scheduler-service.ts`
- [x] scheduler bridge setup in `LocalCoreController`

### Exit Criteria

- [x] Scheduler no longer depends directly on Lark-specific adapter wiring
- [x] A new scheduled delivery target can be added as a plugin

## Phase 7: Event Bus Migration

### Scope

Replace direct cross-module callback chains with typed domain events.

### Tasks

- [ ] Define domain event types in plugin SDK or core contracts
- [ ] Publish `platform.message.received` from channel plugins
- [ ] Publish `thread.message.accepted` from thread orchestration
- [ ] Publish `run.started`, `run.progress`, `run.completed`, `run.failed`
- [ ] Publish scheduler lifecycle events
- [ ] Replace direct callback wiring where plugin-to-plugin interaction is currently explicit
- [ ] Keep synchronous direct calls only where request-response semantics are required

### Current Code To Untangle

- [ ] bridge event forwarding in `LocalCoreController`
- [ ] channel-triggered orchestration paths
- [ ] scheduler notifications
- [ ] renderer SSE update publication paths

### Exit Criteria

- [ ] Plugins collaborate primarily through typed events
- [ ] Removing one plugin does not require stubbing direct calls in multiple other modules

## Phase 8: Renderer Capability Snapshot

### Scope

Replace front-end booleans and hardcoded feature gates with a capability snapshot returned by Local AI Core.

### Tasks

- [ ] Add runtime capability snapshot API to Local AI Core
- [ ] Add corresponding types to `packages/contracts`
- [ ] Add snapshot client calls to `packages/core-sdk`
- [ ] Replace `supportsDesktopChat()` and related helpers with capability lookups
- [ ] Replace `getRuntimeProvider()`-driven feature assumptions where feature-level capability data is required
- [ ] Keep host/runtime provider info separate from feature capability info

### Current Code To Untangle

- [ ] `src/app/runtime.ts`
- [ ] feature guards in `src/App.tsx`
- [ ] capability-dependent branches in `Sidebar.tsx`

### Exit Criteria

- [ ] The renderer renders from runtime capability data, not fixed booleans
- [ ] Features can disappear or appear based on registered plugins

## Phase 9: Renderer Contribution Registries

### Scope

Make routes, nav items, and settings panels declarative contributions.

### Tasks

- [ ] Add UI contribution types for routes, nav items, and settings panels
- [ ] Add renderer-side registries for those contributions
- [ ] Replace hardcoded route declarations in `src/App.tsx`
- [ ] Replace hardcoded nav item list in `src/components/Layout/Sidebar.tsx`
- [ ] Replace hardcoded system/settings sections with registered panels
- [ ] Preserve route guards, ordering, and labels through manifest metadata
- [ ] Keep the initial built-in features registered statically

### Current Code To Untangle

- [ ] `src/App.tsx`
- [ ] `src/components/Layout/Sidebar.tsx`
- [ ] any page-specific feature switch helpers

### Exit Criteria

- [ ] Adding a new page does not require editing `src/App.tsx`
- [ ] Adding a new nav entry does not require editing `Sidebar.tsx`

## Phase 10: Config, Diagnostics, And Failure Isolation

### Scope

Add operational support so plugins can fail independently and be diagnosed.

### Tasks

- [ ] Add plugin-scoped config schema support
- [ ] Add plugin enable/disable state in runtime settings
- [ ] Add per-plugin health checks
- [ ] Add plugin diagnostics to runtime status
- [ ] Add a system page section for installed plugins and health
- [ ] Add logs that include plugin id and capability id
- [ ] Ensure a failed plugin is marked degraded instead of crashing bootstrap where possible

### Exit Criteria

- [ ] Plugin health is visible in the UI or system API
- [ ] Individual plugins can be disabled
- [ ] A single plugin failure does not take down unrelated features

## Phase 11: Cleanup And Deletion

### Scope

Remove compatibility shims and obsolete hardcoded paths after the plugin system is stable.

### Tasks

- [ ] Delete boolean feature helpers that are no longer needed
- [ ] Delete hardcoded capability arrays
- [ ] Delete route and nav duplication left from transition period
- [ ] Delete direct module construction paths bypassing bootstrap
- [ ] Consolidate temporary adapters created during migration
- [ ] Update docs to describe the final plugin-first architecture only

### Exit Criteria

- [ ] There is one canonical way to add a capability
- [ ] There is one canonical place to register built-in plugins
- [ ] No obsolete hardcoded feature switches remain

## Cross-Cutting Tests

### Kernel And Contracts

- [ ] Add tests for plugin registration order
- [ ] Add tests for dependency resolution
- [ ] Add tests for duplicate plugin id rejection
- [ ] Add tests for capability snapshot generation

### Knowledge

- [ ] Add tests proving knowledge provider registration is registry-driven
- [ ] Add tests proving disabled knowledge provider removes its capabilities cleanly

### Channels

- [ ] Add tests proving channel plugin lifecycle start and stop works
- [ ] Add tests proving channel route abstraction is not Lark-specific

### Agents

- [ ] Add tests proving agent runtime selection is registry-based
- [ ] Add tests for unsupported workspace-to-agent mismatch behavior

### Renderer

- [ ] Add tests for route rendering from contribution registry
- [ ] Add tests for nav rendering from contribution registry
- [ ] Add tests for capability-driven feature visibility

### End-To-End

- [ ] Run `pnpm test`
- [ ] Run `pnpm e2e:smoke`
- [ ] Add or update smoke coverage for plugin capability snapshot
- [ ] Add or update smoke coverage for degraded plugin state

## Suggested Delivery Order

- [ ] PR 1: plugin SDK plus kernel skeleton
- [ ] PR 2: bootstrap injection replacing controller composition
- [ ] PR 3: knowledge plugin extraction
- [ ] PR 4: channel plugin extraction
- [ ] PR 5: agent runtime extraction
- [ ] PR 6: scheduler extraction
- [ ] PR 7: runtime capability snapshot
- [ ] PR 8: renderer route and nav registries
- [ ] PR 9: diagnostics and plugin health
- [ ] PR 10: cleanup and compatibility removal

## Success Criteria

- [ ] Adding a new channel does not require kernel edits
- [ ] Adding a new knowledge provider does not require router edits
- [ ] Adding a new agent does not require workspace router edits
- [ ] Adding a new page does not require editing `src/App.tsx`
- [ ] Adding a new nav item does not require editing `Sidebar.tsx`
- [ ] The runtime exposes installed capabilities and plugin health
- [ ] Built-in modules are registered like plugins, not treated specially in the architecture
