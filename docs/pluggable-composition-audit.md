# Plugin-First Composition Notes

The hardcoded composition points from the migration have been removed or isolated behind plugin registries.

## Local AI Core Composition

- Built-in plugins are registered through `services/local-ai-core/src/kernel/bootstrap.ts`.
- Capabilities are contributed by plugin manifests and collected by `LocalCoreCapabilityRegistry`.
- Runtime composition passes concrete stores, runtimes, and event bus dependencies into services through bootstrap.
- Plugin lifecycle and diagnostics are managed by the kernel, so plugin failures are isolated and visible.

## Renderer Composition

- `src/app/runtime.ts` stores the Local AI Core capability snapshot and derives feature support from it.
- `src/app/ui-contributions.tsx` is the renderer registry for built-in routes, nav items, and settings panels.
- `src/App.tsx` and `src/components/Layout/Sidebar.tsx` render from registry contributions instead of hardcoded page lists.

## Capability Declarations

- Plugin capability ids and manifests are the canonical source for channels, agents, knowledge providers, schedulers, and UI contributions.
- Renderer feature visibility is derived from `/api/local/v1/capabilities/snapshot`.
- Operational plugin state is visible through runtime status and `/api/local/v1/plugins/diagnostics`.
