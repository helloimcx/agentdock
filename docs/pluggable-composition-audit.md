# Hardcoded Composition Audit

This audit captures the concrete composition points that the pluggable refactor needs to remove or isolate.

## Local AI Core Composition

`services/local-ai-core/src/runtime/local-core-controller.ts`

- Instantiates `AiVectorKnowledgeProvider` directly and owns knowledge settings persistence.
- Instantiates `WorkspaceRouter` directly through `createWorkspaceRouter(...)`.
- Instantiates `LocalCoreLarkGateway` directly and wires bridge callbacks inline.
- Instantiates `SchedulerService` and `LarkScheduleAdapter` directly.
- Builds the scheduler bridge inline with Lark-specific route assumptions.
- Owns logs, settings, config bootstrap, and CLI wrapper setup in the same constructor.

`services/local-ai-core/src/router/workspace-router.ts`

- Returns hardcoded capability strings from `getCapabilities()`.
- Couples scheduler bridge input to the `lark_chat` route model.
- Decides supported ACP agent runtimes from a hardcoded list.

## Renderer Composition

`src/app/runtime.ts`

- Exposes static boolean helpers such as `supportsDesktopChat()` and `supportsKnowledgeModule()`.
- Encodes runtime provider and feature support in process-level booleans instead of a server capability snapshot.

`src/App.tsx`

- Uses static runtime helpers to decide whether `/chat`, `/workspace`, and `/knowledge` should exist.
- Mixes desktop-managed redirects with feature availability checks in the route table.

`src/components/Layout/Sidebar.tsx`

- Defines sidebar navigation as a static `navItems` array.
- Filters visible items through hardcoded feature helper checks and `desktopManaged` branches.

## Capability Declarations

`services/local-ai-core/src/router/workspace-router.ts`

- Declares channels, agents, knowledge, scheduler trigger types, and scheduler platforms inline.
- Uses route and platform names that are tied to current built-in modules.
