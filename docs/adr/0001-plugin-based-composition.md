# ADR 0001: Move Local AI Core To Plugin-Based Composition

## Status

Accepted for the pluggable refactor baseline.

## Context

`services/local-ai-core` currently wires concrete business modules directly inside `LocalCoreController`.
The renderer also hardcodes runtime feature switches, routes, and sidebar navigation.
That layout makes each new agent runtime, channel, knowledge provider, or scheduler target require edits in multiple core files.

The current pressure points are:

- `services/local-ai-core/src/runtime/local-core-controller.ts` constructs concrete services directly.
- `services/local-ai-core/src/router/workspace-router.ts` publishes hardcoded capability strings.
- `src/app/runtime.ts` exposes boolean feature helpers instead of a capability snapshot.
- `src/App.tsx` and `src/components/Layout/Sidebar.tsx` gate routes and navigation with static checks.

## Decision

The system will move to a small kernel plus statically registered built-in plugins before any dynamic loading work starts.

Conventions for the migration:

- Plugin ids use dotted lowercase namespaces such as `builtin.agent-opencode` or `builtin.channel-lark`.
- Capability ids use `<kind>.<name>` such as `agent.opencode`, `channel.localcore-lark`, and `scheduler.cron`.
- Feature ids use dotted lowercase product areas such as `feature.chat`, `feature.knowledge`, and `feature.scheduler`.
- Built-in local-core plugins live under `services/local-ai-core/src/plugins/`.
- Kernel-only infrastructure lives under `services/local-ai-core/src/kernel/`.
- New feature work must not add boolean feature switches; expose capabilities through plugin contributions and the runtime capability snapshot.

## Consequences

- New capabilities can be registered in one composition root instead of editing controller internals.
- Renderer feature gating can move from booleans to capability snapshots incrementally.
- A failed plugin can degrade its own capability without forcing the whole runtime to know its concrete types.
- Phase 1 stays static: built-in plugins are imported explicitly, and no dynamic plugin loading is introduced yet.
